"""Live weather for a spoken place name.

Why this module exists at all:

Gemini cannot see the internet. The API *call* travels over the network, but the
model only knows its training data, so "what is the weather today" gets a polite
non-answer. Gemini can be given a Google Search tool, but that needs a billed
account and returns 429 on every free key.

Weather is one of the four things this app promises on its front screen, and for
a farmer it is the one that changes what they do that day. So it comes from
Open-Meteo: free, no API key, no quota, no sign-up.

The same rule as schemes applies: the model does not invent the forecast. The
numbers are fetched, and the sentence is assembled from them.

Pipeline
    spoken text
      -> extract_place        pull the place out of a sentence
      -> normalise            strip "district", "जिला", state names, honorifics
      -> cache lookup         30-minute TTL, survives a dead network
      -> geocode              seven-step ladder, Devanagari included
      -> forecast             Open-Meteo
      -> describe             sentence built from the numbers

Every stage logs, and a failure at any stage degrades to the stage before it
rather than to silence.
"""

from __future__ import annotations

import json
import logging
import threading
import time
import traceback
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

log = logging.getLogger("gramini.weather")

GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
TIMEOUT = 8

CACHE_FILE = Path(__file__).parent / "data" / "weather_cache.json"
CACHE_TTL = 30 * 60          # 30 minutes: a forecast older than this is stale
STALE_MAX = 24 * 60 * 60     # but serve up to a day old rather than nothing

# Where to look when the user names no place. Pune, because that is where the
# event is; a real deployment would use the phone's location.
DEFAULT_PLACE = {"name": "Pune", "lat": 18.5204, "lon": 73.8567}

_lock = threading.Lock()


# --------------------------------------------------------------- transliteration

_CONSONANTS = {
    "क": "k", "ख": "kh", "ग": "g", "घ": "gh", "ङ": "ng",
    "च": "ch", "छ": "chh", "ज": "j", "झ": "jh", "ञ": "n",
    "ट": "t", "ठ": "th", "ड": "d", "ढ": "dh", "ण": "n",
    "त": "t", "थ": "th", "द": "d", "ध": "dh", "न": "n",
    "प": "p", "फ": "ph", "ब": "b", "भ": "bh", "म": "m",
    "य": "y", "र": "r", "ल": "l", "व": "v", "ळ": "l",
    "श": "sh", "ष": "sh", "स": "s", "ह": "h",
    "क़": "q", "ख़": "kh", "ग़": "g", "ज़": "z", "ड़": "r", "ढ़": "rh", "फ़": "f",
}
_VOWELS = {
    "अ": "a", "आ": "aa", "इ": "i", "ई": "ee", "उ": "u", "ऊ": "oo",
    "ए": "e", "ऐ": "ai", "ओ": "o", "औ": "au", "ऋ": "ri",
}
_MATRAS = {
    "ा": "a", "ि": "i", "ी": "ee", "ु": "u", "ू": "oo",
    "े": "e", "ै": "ai", "ो": "o", "ौ": "au", "ृ": "ri",
}
_VIRAMA = "्"
_NASALS = {"ं": "n", "ँ": "n", "ः": "h"}


def _is_devanagari(text: str) -> bool:
    return any("ऀ" <= ch <= "ॿ" for ch in text)


def transliterate(text: str, inherent: bool | str = True) -> str:
    """Rough Devanagari -> Latin, good enough for a gazetteer to match on.

    Rule-based on purpose: instant, free, works offline, and place names are
    exactly where a model would be creative when it must not be.

    The implicit 'a' after a consonant is the hard part, because Hindi deletes
    it inconsistently. Three modes are generated and the geocoder picks:

        True    keep every one    नागपुर -> nagapur
        False   drop every one    नागपुर -> nagpur
        "first" keep only the first, drop the rest - which is the actual rule
                most of the time:  जलगांव -> jalgaanv -> Jalgaon
                (not "jalagaanv", and not "jlgaanv")
    """
    out: list[str] = []
    consonants_seen = 0
    index = 0
    while index < len(text):
        ch = text[index]
        nxt = text[index + 1] if index + 1 < len(text) else ""

        if ch in _CONSONANTS:
            out.append(_CONSONANTS[ch])
            consonants_seen += 1
            if nxt in _MATRAS:
                out.append(_MATRAS[nxt])
                index += 2
                continue
            if nxt == _VIRAMA:
                index += 2
                continue
            if inherent == "first":
                keep = consonants_seen == 1
            else:
                keep = bool(inherent)
            # Never at the very end of a word: Hindi drops it there always.
            #
            # A following nasal does NOT suppress it - "रं" is "ran", not "rn",
            # which is the difference between Aurangabad and "aurngabad".
            if keep and index + 1 < len(text):
                out.append("a")
            index += 1
            continue

        if ch in _VOWELS:
            out.append(_VOWELS[ch])
        elif ch in _NASALS:
            out.append(_NASALS[ch])
        elif ch in _MATRAS:
            out.append(_MATRAS[ch])
        elif not ("ऀ" <= ch <= "ॿ"):
            out.append(ch)
        index += 1

    return "".join(out).strip()


def _spelling_variants(romanised: str) -> list[str]:
    """Common English spellings of the same Indian place name.

    Gazetteers are inconsistent, and so is transliteration: Beed/Bid,
    Latur/Latoor, Jalgaon/Jalgaanv. Cheap to try, so try them.
    """
    variants: list[str] = []

    # "-गांव" is the village suffix and is always written "-gaon" in English.
    # These go FIRST: a raw "jalgav" finds some unrelated hamlet, and a
    # confidently wrong village is worse than no answer at all.
    for bad, good in (("gaanv", "gaon"), ("ganv", "gaon"), ("gaav", "gaon"),
                      ("gav", "gaon"), ("gaanw", "gaon"), ("aanv", "aon")):
        if bad in romanised:
            variants.append(romanised.replace(bad, good))

    variants.append(romanised)
    variants.append(romanised.replace("aa", "a"))
    variants.append(romanised.replace("ee", "i").replace("oo", "u"))
    return variants


# ------------------------------------------------------------- place extraction

# Words that surround a place name rather than being one.
_NOISE = {
    # Hindi
    "में", "मे", "का", "की", "के", "आज", "कल", "मौसम", "बारिश", "बरसात", "कैसा",
    "कैसी", "रहेगा", "रहेगी", "होगा", "होगी", "क्या", "बताओ", "बताइए", "तापमान",
    "गर्मी", "ठंड", "धूप", "बादल", "मुझे", "हाल", "समाचार", "और", "है", "हैं",
    # Marathi
    "मध्ये", "आजचे", "हवामान", "पाऊस", "कसे", "काय", "सांगा", "पडेल", "आहे",
    "राहील", "होईल", "उद्या", "थंडी", "ऊन", "किती", "चे", "ची", "च्या",
    # English
    "weather", "rain", "raining", "today", "tomorrow", "what", "is", "the",
    "in", "at", "will", "it", "be", "how", "temperature", "forecast", "tell",
    "me", "about", "of", "for", "there", "now", "like", "hot", "cold",
}

# Administrative suffixes. "Beed district" and "Beed" are the same place to a
# gazetteer, but the suffix makes the lookup miss.
_ADMIN_SUFFIX = {
    "district", "dist", "taluka", "tehsil", "tahsil", "city", "town", "village",
    "जिला", "जिल्हा", "जिले", "तालुका", "तहसील", "शहर", "गाँव", "गांव", "ग्राम",
    "नगर", "पुर",  # only stripped when standing alone as a separate word
}

# Indian states and union territories, in English and Devanagari. A state name
# following a city is context for a human and noise for a geocoder: searching
# "Vrindavan Uttar Pradesh" returns nothing, "Vrindavan" returns the town.
_STATES = {
    "andhra", "arunachal", "assam", "bihar", "chhattisgarh", "goa", "gujarat",
    "haryana", "himachal", "jharkhand", "karnataka", "kerala", "madhya",
    "maharashtra", "manipur", "meghalaya", "mizoram", "nagaland", "odisha",
    "orissa", "punjab", "rajasthan", "sikkim", "tamil", "nadu", "telangana",
    "tripura", "uttar", "uttarakhand", "pradesh", "bengal", "west", "delhi",
    "kashmir", "jammu", "ladakh", "puducherry", "chandigarh",
    "महाराष्ट्र", "गुजरात", "राजस्थान", "पंजाब", "हरियाणा", "बिहार", "झारखंड",
    "ओडिशा", "केरल", "कर्नाटक", "तमिलनाडु", "तेलंगाना", "आंध्र", "उत्तर",
    "प्रदेश", "मध्य", "पश्चिम", "बंगाल", "दिल्ली", "उत्तराखंड", "छत्तीसगढ़",
    "हिमाचल", "जम्मू", "कश्मीर", "गोवा", "असम",
}

# Two-letter state codes people actually say: "Indore MP", "Jaipur RJ".
_STATE_CODES = {
    "mp", "up", "mh", "gj", "rj", "pb", "hr", "br", "jh", "od", "kl", "ka",
    "tn", "ts", "ap", "wb", "dl", "uk", "cg", "hp", "jk", "ga", "as",
}


def _clean_token(token: str) -> str:
    return token.strip(",.?!।'\"()").strip()


def extract_place(text: str) -> str | None:
    """Pull a likely place name out of a spoken sentence.

    Handles every shape the users in testing produced:
        "Pune"                    -> Pune
        "Weather in Pune"         -> Pune
        "उज्जैन में मौसम"          -> उज्जैन
        "वृंदावन उत्तर प्रदेश"     -> वृंदावन      (state dropped)
        "बीड जिला"                -> बीड          (suffix dropped)
        "Indore MP"               -> Indore       (state code dropped)
        "Beed district"           -> Beed
    """
    if not text:
        return None

    tokens = [_clean_token(t) for t in text.split()]
    kept: list[str] = []
    for token in tokens:
        if not token or len(token) < 2:
            continue
        low = token.lower()
        if low in _NOISE or low in _ADMIN_SUFFIX or low in _STATES:
            continue
        if low in _STATE_CODES and kept:
            # Only a state code when something already precedes it, so the word
            # "up" in "what is up" cannot be mistaken for Uttar Pradesh.
            continue
        kept.append(token)

    if not kept:
        return None
    # At most three words: longer than that and it is a sentence, not a place.
    return " ".join(kept[:3])


def normalise(name: str) -> str:
    """Strip anything administrative that a gazetteer will not recognise."""
    tokens = [_clean_token(t) for t in name.split() if _clean_token(t)]
    kept = [
        t for t in tokens
        if t.lower() not in _ADMIN_SUFFIX and t.lower() not in _STATES
    ]
    return " ".join(kept) if kept else name.strip()


# ------------------------------------------------------------------ http helper


def _get(url: str, params: dict[str, Any]) -> dict[str, Any] | None:
    query = urllib.parse.urlencode(params)
    try:
        with urllib.request.urlopen(f"{url}?{query}", timeout=TIMEOUT) as response:
            return json.loads(response.read().decode("utf-8"))
    except Exception as exc:
        log.warning("  request failed (%s): %s", type(exc).__name__, exc)
        log.debug("traceback:\n%s", traceback.format_exc())
        return None


# ---------------------------------------------------------------------- geocode


def _lookup(name: str) -> dict[str, Any] | None:
    data = _get(GEOCODE_URL, {"name": name, "count": 1, "language": "en", "format": "json"})
    results = (data or {}).get("results") or []
    if not results:
        return None
    hit = results[0]
    return {
        "name": hit.get("name"),
        "lat": hit.get("latitude"),
        "lon": hit.get("longitude"),
        "admin": hit.get("admin1"),
        "country": hit.get("country"),
    }


def _candidates(raw: str) -> list[str]:
    """The seven-step ladder, cheapest and most specific first."""
    cleaned = normalise(raw)
    tokens = cleaned.split()

    ladder: list[str] = [
        raw,                                   # 1. exactly what was said
        cleaned,                               # 2. suffixes and state removed
    ]
    if tokens:
        ladder.append(tokens[0])               # 3. first token
        if len(tokens) > 1:
            ladder.append(tokens[-1])          # 4. last token

    # 5/6 are covered by `normalise`, which drops state names and admin suffixes.

    # 7. transliteration, both schwa treatments, plus spelling variants.
    source = cleaned or raw
    if _is_devanagari(source):
        # "first" leads because it matches how these names are actually spelt.
        for mode in ("first", False, True):
            romanised = transliterate(source, inherent=mode)
            if romanised:
                ladder.extend(_spelling_variants(romanised))
        first = tokens[0] if tokens else ""
        if first and _is_devanagari(first) and first != source:
            for mode in ("first", False):
                ladder.extend(_spelling_variants(transliterate(first, inherent=mode)))

    seen: set[str] = set()
    ordered: list[str] = []
    for candidate in ladder:
        candidate = (candidate or "").strip()
        if candidate and candidate.lower() not in seen:
            seen.add(candidate.lower())
            ordered.append(candidate)
    return ordered


def find_place(name: str) -> dict[str, Any] | None:
    """Resolve a spoken place name to coordinates. Returns None if unfound."""
    if not name:
        return None

    ladder = _candidates(name)
    log.info("  geocoding %r -> trying %s", name, ladder)

    for step, candidate in enumerate(ladder, start=1):
        found = _lookup(candidate)
        if found:
            log.info(
                "  resolved on step %d (%r) -> %s, %s (%.4f, %.4f)",
                step, candidate, found["name"], found.get("admin"),
                found["lat"], found["lon"],
            )
            return found

    log.warning("  no geocoder match for %r after %d attempts", name, len(ladder))
    return None


# ------------------------------------------------------------------------ cache


def _load_cache() -> dict[str, Any]:
    if not CACHE_FILE.exists():
        return {}
    try:
        return json.loads(CACHE_FILE.read_text(encoding="utf-8"))
    except Exception as exc:
        log.warning("weather cache unreadable, starting fresh: %s", exc)
        return {}


def _save_cache(cache: dict[str, Any]) -> None:
    try:
        CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
        CACHE_FILE.write_text(
            json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    except Exception as exc:
        log.warning("could not write weather cache: %s", exc)
        log.debug("traceback:\n%s", traceback.format_exc())


def _cache_key(place: dict[str, Any]) -> str:
    # Round to ~1km: two requests for the same town must share a cache entry.
    return f"{round(float(place['lat']), 2)},{round(float(place['lon']), 2)}"


def _name_keys(place_name: str) -> set[str]:
    """Every spelling of a name that should hit the same cache entry."""
    cleaned = normalise(place_name).strip().lower()
    keys = {cleaned, place_name.strip().lower()}
    if _is_devanagari(cleaned):
        for mode in ("first", False, True):
            romanised = transliterate(cleaned, inherent=mode)
            keys.update(v.lower() for v in _spelling_variants(romanised) if v)
    return {k for k in keys if k}


def find_cached_by_name(place_name: str) -> tuple[dict[str, Any] | None, float]:
    """Find a cached forecast without touching the network.

    This is what makes an offline answer possible at all. Geocoding needs the
    internet, so when the network is down the coordinate lookup fails BEFORE the
    cache is ever consulted - and the user would be told their own district
    could not be found while its forecast sat on disk. Matching on the name
    first closes that gap.
    """
    wanted = _name_keys(place_name)
    with _lock:
        cache = _load_cache()
    now = time.time()
    best: tuple[dict[str, Any] | None, float] = (None, 0.0)
    for entry in cache.values():
        stored = str(entry.get("location") or "").strip().lower()
        if not stored:
            continue
        if stored in wanted or any(w and (w in stored or stored in w) for w in wanted):
            age = now - float(entry.get("fetched_at", 0))
            if best[0] is None or age < best[1]:
                best = (entry, age)
    return best


def _read_cached(place: dict[str, Any]) -> tuple[dict[str, Any] | None, float]:
    """Return (entry, age_seconds). Entry is None when nothing is stored."""
    with _lock:
        entry = _load_cache().get(_cache_key(place))
    if not entry:
        return None, 0.0
    return entry, time.time() - float(entry.get("fetched_at", 0))


def _write_cached(place: dict[str, Any], report: dict[str, Any]) -> None:
    with _lock:
        cache = _load_cache()
        cache[_cache_key(place)] = {
            "location": place.get("name"),
            "latitude": place["lat"],
            "longitude": place["lon"],
            "fetched_at": time.time(),
            "weather_data": report,
        }
        # Keep the file small: a hackathon demo does not need a thousand towns.
        if len(cache) > 60:
            oldest = sorted(cache, key=lambda k: cache[k].get("fetched_at", 0))
            for key in oldest[: len(cache) - 60]:
                cache.pop(key, None)
        _save_cache(cache)
    log.info("  cached forecast for %s", place.get("name"))


def cache_summary() -> dict[str, Any]:
    """For /api/health - how much weather survives a network outage."""
    with _lock:
        cache = _load_cache()
    now = time.time()
    return {
        "entries": len(cache),
        "places": [entry.get("location") for entry in cache.values()][:12],
        "freshest_seconds": (
            round(min((now - float(e.get("fetched_at", 0)) for e in cache.values()), default=0))
            if cache else None
        ),
    }


# --------------------------------------------------------------------- forecast

_WMO = {
    0: {"hi": "आसमान साफ़ है", "en": "the sky is clear", "mr": "आकाश स्वच्छ आहे"},
    1: {"hi": "ज़्यादातर साफ़ है", "en": "mostly clear", "mr": "बहुतांश स्वच्छ"},
    2: {"hi": "कुछ बादल हैं", "en": "partly cloudy", "mr": "काही ढग आहेत"},
    3: {"hi": "बादल छाए हैं", "en": "cloudy", "mr": "ढगाळ आहे"},
    45: {"hi": "कोहरा है", "en": "foggy", "mr": "धुके आहे"},
    48: {"hi": "कोहरा है", "en": "foggy", "mr": "धुके आहे"},
    51: {"hi": "हल्की बूँदाबाँदी है", "en": "light drizzle", "mr": "हलकी रिमझिम"},
    53: {"hi": "बूँदाबाँदी हो रही है", "en": "drizzle", "mr": "रिमझिम पाऊस"},
    55: {"hi": "तेज़ बूँदाबाँदी है", "en": "heavy drizzle", "mr": "जोरदार रिमझिम"},
    61: {"hi": "हल्की बारिश हो रही है", "en": "light rain", "mr": "हलका पाऊस"},
    63: {"hi": "बारिश हो रही है", "en": "raining", "mr": "पाऊस पडत आहे"},
    65: {"hi": "तेज़ बारिश हो रही है", "en": "heavy rain", "mr": "जोरदार पाऊस"},
    71: {"hi": "बर्फ़ गिर रही है", "en": "snowing", "mr": "बर्फ पडत आहे"},
    80: {"hi": "बौछारें पड़ रही हैं", "en": "rain showers", "mr": "सरी पडत आहेत"},
    81: {"hi": "तेज़ बौछारें हैं", "en": "heavy showers", "mr": "जोरदार सरी"},
    82: {"hi": "बहुत तेज़ बौछारें हैं", "en": "violent showers", "mr": "अतिजोरदार सरी"},
    95: {"hi": "आँधी-तूफ़ान है", "en": "a thunderstorm", "mr": "गडगडाटी वादळ"},
    96: {"hi": "ओले के साथ तूफ़ान है", "en": "thunderstorm with hail", "mr": "गारांसह वादळ"},
    99: {"hi": "ओले के साथ तेज़ तूफ़ान है", "en": "severe hailstorm", "mr": "तीव्र गारपीट"},
}


def fetch(place: dict[str, Any]) -> dict[str, Any] | None:
    data = _get(FORECAST_URL, {
        "latitude": place["lat"],
        "longitude": place["lon"],
        "current": "temperature_2m,relative_humidity_2m,weather_code",
        "daily": "temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code",
        "timezone": "Asia/Kolkata",
        "forecast_days": 2,
    })
    if not data or "current" not in data:
        return None

    current = data["current"]
    daily = data.get("daily", {})

    def day(index: int, key: str) -> Any:
        values = daily.get(key) or []
        return values[index] if len(values) > index else None

    return {
        "place": place.get("name") or DEFAULT_PLACE["name"],
        "admin": place.get("admin"),
        "temp_now": round(current.get("temperature_2m", 0)),
        "humidity": current.get("relative_humidity_2m"),
        "code": current.get("weather_code"),
        "today_max": round(day(0, "temperature_2m_max") or 0),
        "today_min": round(day(0, "temperature_2m_min") or 0),
        "rain_today": day(0, "precipitation_probability_max"),
        "rain_tomorrow": day(1, "precipitation_probability_max"),
        "source": "Open-Meteo",
    }


def describe(report: dict[str, Any], lang: str) -> str:
    """Build the spoken sentence from the numbers. No model involved."""
    lang = lang if lang in ("hi", "en", "mr") else "hi"
    sky = _WMO.get(report.get("code"), _WMO[3])[lang]
    place = report["place"]
    rain = report.get("rain_today") or 0
    rain_tomorrow = report.get("rain_tomorrow") or 0

    if lang == "en":
        text = (
            f"In {place} it is {report['temp_now']} degrees right now and {sky}. "
            f"Today it will be between {report['today_min']} and {report['today_max']} degrees. "
        )
        if rain >= 60:
            text += f"There is a strong chance of rain today, about {rain} per cent. Cover your grain and spray later. "
        elif rain >= 30:
            text += f"There is some chance of rain today, about {rain} per cent. "
        else:
            text += "Rain is unlikely today. "
        if rain_tomorrow >= 60:
            text += f"Tomorrow the chance of rain is higher, about {rain_tomorrow} per cent."
        return text.strip()

    if lang == "mr":
        text = (
            f"{place} मध्ये आत्ता {report['temp_now']} अंश तापमान आहे आणि {sky}. "
            f"आज तापमान {report['today_min']} ते {report['today_max']} अंशांदरम्यान राहील. "
        )
        if rain >= 60:
            text += f"आज पावसाची शक्यता जास्त आहे, सुमारे {rain} टक्के. धान्य झाकून ठेवा आणि फवारणी नंतर करा. "
        elif rain >= 30:
            text += f"आज पावसाची थोडी शक्यता आहे, सुमारे {rain} टक्के. "
        else:
            text += "आज पाऊस पडण्याची शक्यता कमी आहे. "
        if rain_tomorrow >= 60:
            text += f"उद्या पावसाची शक्यता जास्त आहे, सुमारे {rain_tomorrow} टक्के."
        return text.strip()

    text = (
        f"{place} में अभी {report['temp_now']} डिग्री तापमान है और {sky}. "
        f"आज तापमान {report['today_min']} से {report['today_max']} डिग्री के बीच रहेगा। "
    )
    if rain >= 60:
        text += f"आज बारिश की पूरी संभावना है, करीब {rain} प्रतिशत। अनाज ढक दीजिए और छिड़काव बाद में कीजिए। "
    elif rain >= 30:
        text += f"आज हल्की बारिश हो सकती है, करीब {rain} प्रतिशत। "
    else:
        text += "आज बारिश की संभावना कम है। "
    if rain_tomorrow >= 60:
        text += f"कल बारिश की संभावना ज़्यादा है, करीब {rain_tomorrow} प्रतिशत।"
    return text.strip()


_STALE_NOTE = {
    "hi": " यह जानकारी थोड़ी पुरानी है, क्योंकि अभी इंटरनेट नहीं है।",
    "en": " This information is a little old, because there is no internet right now.",
    "mr": " ही माहिती थोडी जुनी आहe, कारण सध्या इंटरनेट नाही.",
}

_UNKNOWN_PLACE = {
    "hi": "मैं {name} का मौसम नहीं ढूँढ पाया। कृपया अपने ज़िले का नाम बताइए।",
    "en": "I could not find the weather for {name}. Please tell me your district name.",
    "mr": "मला {name} चे हवामान सापडले नाही. कृपया तुमच्या जिल्ह्याचे नाव सांगा.",
}

_NO_DATA = {
    "hi": "अभी मौसम की जानकारी नहीं मिल पा रही। इंटरनेट आने पर दोबारा पूछिए।",
    "en": "I cannot get the weather right now. Please ask again when the internet is back.",
    "mr": "सध्या हवामानाची माहिती मिळत नाही. इंटरनेट आल्यावर पुन्हा विचारा.",
}


def answer(place_name: str | None, lang: str) -> dict[str, Any] | None:
    """Full weather answer for a spoken place.

    Order: fresh cache -> live fetch -> stale cache -> honest failure.

    If the user NAMED a place we could not resolve, we say so rather than
    quietly reporting somewhere else. Telling a farmer in Jalgaon it will not
    rain, when the forecast was for Pune, is exactly the confident wrong answer
    this project exists to avoid.
    """
    log.info("weather request: place=%r lang=%s", place_name, lang)

    if place_name:
        normalised = normalise(place_name)
        if normalised != place_name:
            log.info("  normalised %r -> %r", place_name, normalised)
        place = find_place(place_name)
        if not place:
            # Geocoding needs the network. Before giving up, check whether this
            # place was answered earlier - an offline user asking about their own
            # district must not be told it does not exist.
            entry, age = find_cached_by_name(place_name)
            if entry and age < STALE_MAX:
                log.warning(
                    "  geocoder unreachable - answering %r from cache (%.0f min old)",
                    entry.get("location"), age / 60,
                )
                report = entry["weather_data"]
                note = _STALE_NOTE.get(lang) or _STALE_NOTE["hi"]
                return {
                    "report": report, "cached": True, "stale": True,
                    "cache_age_seconds": round(age),
                    "speech": describe(report, lang) + note,
                }

            template = _UNKNOWN_PLACE.get(lang) or _UNKNOWN_PLACE["hi"]
            return {
                "report": None,
                "unknown_place": place_name,
                "cached": False,
                "speech": template.format(name=normalised or place_name),
            }
    else:
        place = DEFAULT_PLACE
        log.info("  no place named, defaulting to %s", place["name"])

    entry, age = _read_cached(place)

    if entry and age < CACHE_TTL:
        log.info("  CACHE HIT (%.0fs old) - no network request", age)
        report = entry["weather_data"]
        return {"report": report, "cached": True, "cache_age_seconds": round(age),
                "speech": describe(report, lang)}

    log.info("  cache %s - fetching from Open-Meteo",
             f"stale ({age:.0f}s)" if entry else "miss")
    report = fetch(place)

    if report:
        _write_cached(place, report)
        return {"report": report, "cached": False, "cache_age_seconds": 0,
                "speech": describe(report, lang)}

    # Network failed. Anything cached beats nothing, as long as we say so.
    if entry and age < STALE_MAX:
        log.warning("  network failed - serving cached forecast %.0f minutes old", age / 60)
        report = entry["weather_data"]
        note = _STALE_NOTE.get(lang) or _STALE_NOTE["hi"]
        return {
            "report": report,
            "cached": True,
            "stale": True,
            "cache_age_seconds": round(age),
            "speech": describe(report, lang) + note,
        }

    log.error("  network failed and no usable cache for %s", place.get("name"))
    return {"report": None, "cached": False,
            "speech": _NO_DATA.get(lang) or _NO_DATA["hi"]}


# ------------------------------------------------------- background cache warm


def refresh_cache(places: list[dict[str, Any]] | None = None) -> None:
    """Re-fetch everything already cached, in the background.

    Called on startup so that a network which is up NOW leaves the app able to
    answer when it goes down later - which is the whole point on venue wifi.
    """
    def _run() -> None:
        targets = places
        if targets is None:
            with _lock:
                cache = _load_cache()
            targets = [
                {"name": e.get("location"), "lat": e["latitude"], "lon": e["longitude"]}
                for e in cache.values()
            ]
        if not any(t for t in targets if t.get("name") == DEFAULT_PLACE["name"]):
            targets.append(DEFAULT_PLACE)

        refreshed = 0
        for place in targets:
            try:
                report = fetch(place)
                if report:
                    _write_cached(place, report)
                    refreshed += 1
            except Exception as exc:  # pragma: no cover - background best effort
                log.warning("background refresh failed for %s: %s", place.get("name"), exc)
                log.debug("traceback:\n%s", traceback.format_exc())
        if refreshed:
            log.info("weather cache warmed: %d place(s)", refreshed)

    threading.Thread(target=_run, name="weather-refresh", daemon=True).start()
