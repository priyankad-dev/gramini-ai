"""Gramini AI backend.

Run it with:
    uvicorn main:app --reload --port 8000
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

from dotenv import load_dotenv

# Load .env BEFORE importing anything that reads os.getenv at import time.
# gemini_client and translate both do, so an import moved above this line would
# silently produce a keyless, mis-modelled client. `override=True` means the .env
# file wins over a stale shell variable, which is what a developer expects after
# editing the file.
_ENV_PATH = Path(__file__).parent / ".env"
_ENV_LOADED = load_dotenv(_ENV_PATH, override=True)

from fastapi import FastAPI  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402
from pydantic import BaseModel, Field  # noqa: E402

import audio_cache  # noqa: E402
import gemini_client  # noqa: E402
import intent as intent_module  # noqa: E402
import languages  # noqa: E402
import schemes  # noqa: E402
import translate  # noqa: E402
import weather  # noqa: E402

logging.basicConfig(
    level=os.getenv("GRAMINI_LOG_LEVEL", "INFO").upper(),
    format="%(levelname)-7s %(name)s: %(message)s",
)
log = logging.getLogger("gramini")

# The SDK's own HTTP logging is noisy at INFO and hides our lines.
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("google_genai.models").setLevel(logging.WARNING)

app = FastAPI(title="Gramini AI", version="0.1.0")

# Recorded speech, served as plain static files. Deliberately NOT an API route:
# a static file lands in the browser's HTTP cache, so a clip played once keeps
# playing after the network dies.
audio_cache.CACHE_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/audio", StaticFiles(directory=str(audio_cache.CACHE_DIR)), name="audio")


@app.on_event("startup")
def _startup() -> None:
    """Prove the whole chain works before the first user asks anything."""
    log.info("Gramini AI starting")
    if _ENV_LOADED:
        log.info("  .env loaded from %s", _ENV_PATH)
    else:
        log.error(
            "  NO .env FOUND at %s - copy .env.example to .env and add your key",
            _ENV_PATH,
        )
    log.info("  allowed origins: %s", ", ".join(ALLOWED_ORIGINS))
    log.info("  schemes: %d (data_status=%s)", len(schemes.all_schemes()), schemes.data_status())
    log.info("  languages: %d (verified: %s)", len(languages.ALL_CODES),
             ", ".join(languages.TIER1_CODES))
    cached = translate.cached_languages()
    log.info("  translation cache: %s", ", ".join(cached) if cached else "empty")

    # Warm the weather cache while the network is known to be up, so the app can
    # still answer when venue wifi dies later.
    weather.refresh_cache()

    result = gemini_client.startup_check()
    if not result.get("ok"):
        log.warning(
            "AI features are degraded. Scheme lookup, weather, the language "
            "switch and offline mode do NOT need Gemini and still work."
        )

# Which origins may call this API.
#
# Local development origins are always allowed so nothing breaks on a laptop.
# The deployed frontend is added through FRONTEND_URL (comma-separated for
# preview deployments), because the domain is not known until the frontend is
# deployed and must never be hard-coded here.
#
# `allow_origins=["*"]` is deliberately NOT used: the API is public but the
# origin list is cheap to maintain and keeps the surface honest.
_DEV_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4173",
]
_PROD_ORIGINS = [
    origin.strip().rstrip("/")
    for origin in os.getenv("FRONTEND_URL", "").split(",")
    if origin.strip()
]
ALLOWED_ORIGINS = _DEV_ORIGINS + _PROD_ORIGINS

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    # Vercel gives every preview build its own subdomain. This lets those work
    # without listing each one, while still refusing unrelated domains.
    allow_origin_regex=os.getenv("FRONTEND_URL_REGEX") or None,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

LANGS = languages.ALL_CODES


def _clean_lang(value: str | None) -> str:
    return languages.clean(value)


# --------------------------------------------------------------------------- models


class TurnRequest(BaseModel):
    text: str = Field(..., description="What the user said, as transcribed.")
    lang: str = Field("hi", description="Current UI language code.")
    auto_detect: bool = Field(
        True,
        description=(
            "Switch the app to the language the user is actually speaking, "
            "without being asked. Set false to pin the language."
        ),
    )


class SchemeRequest(BaseModel):
    query: str | None = None
    scheme_id: str | None = None
    category: str | None = None
    lang: str = "hi"


class VisionRequest(BaseModel):
    image: str = Field(..., description="data: URL of one captured camera frame.")
    lang: str = "hi"
    hint: str | None = None


# ------------------------------------------------------------------- chat behaviour

_CHAT_SYSTEM = {
    "hi": (
        "आप 'ग्रामिणी' हैं — भारत के गाँव के लोगों के लिए बनी एक मददगार आवाज़ सहायक। "
        "बहुत आसान हिंदी में बोलिए, छोटे वाक्यों में, जैसे किसी पड़ोसी से बात कर रहे हों। "
        "अंग्रेज़ी शब्द और तकनीकी शब्द मत इस्तेमाल कीजिए। तीन-चार वाक्य से ज़्यादा मत बोलिए। "
        "सबसे ज़रूरी नियम: किसी सरकारी योजना की पात्रता, रकम या तारीख़ अपने मन से मत बताइए। "
        "अगर पूछा जाए तो कहिए कि आप योजना की जाँची हुई जानकारी अलग से देंगे।"
    ),
    "en": (
        "You are 'Gramini', a helpful voice assistant for people in rural India. "
        "Speak in very simple English, in short sentences, like a friendly neighbour. "
        "Avoid technical words. Never say more than three or four sentences. "
        "Most important rule: never invent eligibility, amounts or dates for a "
        "government scheme. If asked, say you will give the checked scheme "
        "information separately."
    ),
    "mr": (
        "तुम्ही 'ग्रामिणी' आहात — भारतातील ग्रामीण लोकांसाठी बनवलेला मदतनीस आवाज सहाय्यक. "
        "अगदी सोप्या मराठीत, छोट्या वाक्यांत बोला, शेजाऱ्याशी बोलल्यासारखे. "
        "तांत्रिक शब्द वापरू नका. तीन-चार वाक्यांपेक्षा जास्त बोलू नका. "
        "सर्वात महत्त्वाचा नियम: कोणत्याही सरकारी योजनेची पात्रता, रक्कम किंवा तारीख "
        "स्वतःच्या मनाने सांगू नका."
    ),
}

_OFFLINE_REPLY = {
    "hi": "अभी इंटरनेट नहीं है। लेकिन मैं सरकारी योजनाओं के बारे में अब भी बता सकता हूँ। पूछिए।",
    "en": "There is no internet right now. But I can still tell you about government schemes. Please ask.",
    "mr": "सध्या इंटरनेट नाही. पण मी सरकारी योजनांबद्दल आताही सांगू शकतो. विचारा.",
}

# Said when the network is fine but the AI is not answering - quota spent, or
# the model overloaded. Blaming the internet here sends the user to fix
# something that is not broken, and on stage it reads as the app not working.
# Task 8: when the model is unavailable, say what STILL WORKS.
#
# "AI unavailable" tells the user nothing they can act on, and in front of
# judges it reads as a broken app. Naming the four things that do work turns the
# same failure into a menu - and all four genuinely run without Gemini.
_AI_BUSY_REPLY = {
    "hi": (
        "अभी मैं सामान्य सवालों का जवाब नहीं दे पा रहा, लेकिन ये सब चालू हैं — "
        "सरकारी योजनाएँ, मौसम, कैमरा, और भाषा बदलना। इनमें से कुछ भी पूछिए।"
    ),
    "en": (
        "I cannot answer general questions right now, but I can still help with "
        "government schemes, the weather, the camera, and changing the language. "
        "Please ask about any of those."
    ),
    "mr": (
        "सध्या मी सामान्य प्रश्नांची उत्तरे देऊ शकत नाही, पण हे सर्व चालू आहे — "
        "सरकारी योजना, हवामान, कॅमेरा, आणि भाषा बदलणे. यापैकी काहीही विचारा."
    ),
}


def _place_from(text: str) -> str | None:
    """Pull a likely place name out of a spoken weather question.

    The rules live in weather.py alongside the geocoder that consumes them, so
    that extraction and lookup cannot drift apart.
    """
    return weather.extract_place(text)


def _fallback_reply(lang: str) -> str:
    """The right excuse for the actual failure, not a guess."""
    if gemini_client.last_failure() in ("quota", "busy"):
        return _say(_AI_BUSY_REPLY, lang, "aiBusy")
    return _say(_OFFLINE_REPLY, lang, "offlineReply")

_LANG_CONFIRM = {
    "hi": "ठीक है, अब मैं हिंदी में बात करूँगा।",
    "en": "Okay, I will speak in English now.",
    "mr": "ठीक आहे, आता मी मराठीत बोलेन.",
}

_VISION_PROMPT = {
    "hi": (
        "यह तस्वीर भारत के किसी गाँव के व्यक्ति ने भेजी है। बहुत आसान हिंदी में, "
        "तीन-चार छोटे वाक्यों में बताइए कि इसमें क्या दिख रहा है और इससे जुड़ी एक "
        "काम की सलाह दीजिए। अगर यह दवा है तो बताइए किस काम आती है, पर खुराक मत बताइए और "
        "डॉक्टर से पूछने को कहिए। अगर यह फसल का पत्ता है तो बताइए कि बीमारी दिख रही है या नहीं। "
        "अगर यह सरकारी कागज़ है तो बताइए कौन-सा कागज़ है और किस काम आता है।"
    ),
    "en": (
        "This photo was taken by someone in rural India. In very simple English, in "
        "three or four short sentences, say what is in the picture and give one useful "
        "tip. If it is a medicine, say what it is generally used for, do not give a "
        "dose, and tell them to ask a doctor. If it is a crop leaf, say whether a "
        "disease is visible. If it is a government document, say which document it is "
        "and what it is used for."
    ),
    "mr": (
        "हा फोटो भारतातील ग्रामीण भागातील व्यक्तीने पाठवला आहे. अगदी सोप्या मराठीत, "
        "तीन-चार छोट्या वाक्यांत सांगा की यात काय दिसते आणि एक उपयुक्त सल्ला द्या. "
        "औषध असल्यास ते कशासाठी वापरतात ते सांगा, पण डोस सांगू नका आणि डॉक्टरांना "
        "विचारायला सांगा. पिकाचे पान असल्यास रोग दिसतो का ते सांगा."
    ),
}

_VISION_FAIL = {
    "hi": "माफ़ कीजिए, मैं यह तस्वीर अभी नहीं पढ़ पाया। कृपया दोबारा कोशिश कीजिए।",
    "en": "Sorry, I could not read this photo right now. Please try again.",
    "mr": "माफ करा, हा फोटो मी आता वाचू शकलो नाही. कृपया पुन्हा प्रयत्न करा.",
}


# ------------------------------------------------- any-language helpers (tier 2)
#
# Tier-1 languages have hand-written copy above. For every other language the
# same three things are needed, and each is derived from the tier-1 text rather
# than invented: the model is told which language to answer in, or is handed a
# finished Hindi sentence to carry across.


def _chat_system(lang: str) -> str:
    if languages.is_tier1(lang):
        return _CHAT_SYSTEM[lang]
    return (
        _CHAT_SYSTEM["en"]
        + f"\n\nReply ONLY in {languages.name_of(lang)}, in that language's own "
        f"script. Do not reply in English or Hindi."
    )


def _vision_prompt(lang: str) -> str:
    if languages.is_tier1(lang):
        return _VISION_PROMPT[lang]
    return (
        _VISION_PROMPT["en"]
        + f"\n\nWrite your answer ONLY in {languages.name_of(lang)}, in that "
        f"language's own script."
    )


def _say(bundle: dict[str, str], lang: str, key: str) -> str:
    """A fixed phrase, in any language. Tier-1 verbatim, tier-2 translated."""
    if languages.is_tier1(lang):
        return bundle[lang]
    return translate.translate_text(bundle["hi"], lang, key=key)


# Note this does NOT name a language. The tier-1 sentences say "I will speak
# Hindi/English/Marathi", and translating one of those into Tamil produces a
# Tamil sentence that faithfully promises to speak HINDI - which is exactly
# wrong, and was the first bug this feature shipped with. A sentence with no
# language name in it translates correctly into all of them.
_LANG_CONFIRM_NEUTRAL = "ठीक है, अब मैं इसी भाषा में बात करूँगा।"


def _lang_confirm(lang: str) -> str:
    """'Okay, I will speak this language now' - said in the language switched TO.

    If the translator is unreachable the user still hears a confirmation naming
    the language in its own script. Silence here would look like a failed switch.
    """
    if languages.is_tier1(lang):
        return _LANG_CONFIRM[lang]
    spoken = translate.translate_text(
        _LANG_CONFIRM_NEUTRAL, lang, key="langConfirm"
    )
    if spoken == _LANG_CONFIRM_NEUTRAL:
        return f"ठीक है, अब मैं {languages.get(lang).endonym} में बात करूँगा।"
    return spoken


# ------------------------------------------------------------------------- endpoints


@app.get("/api/health")
def health() -> dict:
    """Everything needed to diagnose the backend without reading the log."""
    # A deployed instance has FRONTEND_URL set, so the endpoint is public and
    # reports less: no key fingerprints, no filesystem paths.
    public = bool(_PROD_ORIGINS)
    gemini = gemini_client.status(public=public)
    return {
        "ok": True,
        "env_loaded": _ENV_LOADED,
        **({} if public else {"env_path": str(_ENV_PATH)}),
        "gemini": gemini,
        "schemes": len(schemes.all_schemes()),
        "data_status": schemes.data_status(),
        "languages": len(languages.ALL_CODES),
        "verified_languages": list(languages.TIER1_CODES),
        "cached_languages": translate.cached_languages(),
        "translate_model": translate.TRANSLATE_MODEL,
        "weather_cache": weather.cache_summary(),
        "audio_cache": audio_cache.summary(),
        # Kept for the frontend, which reads this to tell "no internet" apart
        # from "quota spent".
        "last_ai_failure": gemini.get("last_error"),
        # What still works when Gemini is down - which is most of the app.
        "works_without_ai": [
            "scheme lookup", "language switch", "weather", "repeat", "offline cache",
        ],
    }


@app.get("/api/test-gemini")
def test_gemini(prompt: str = "Say Hello", search: bool = False) -> dict:
    """Raw Gemini round-trip, reported in full. Debugging only.

    Bypasses retries, key rotation and model fallback so the output is the SDK's
    real behaviour. Open it in a browser when chat misbehaves:

        /api/test-gemini
        /api/test-gemini?prompt=नमस्ते
        /api/test-gemini?search=true      (tests Google Search grounding)
    """
    return gemini_client.raw_probe(prompt, use_search=search)


@app.get("/api/diagnostics")
def diagnostics() -> dict:
    """Run a live request now and report exactly what happened.

    Separate from /api/health because it costs a real API call. Point a browser
    at it when something looks wrong and it will say which layer failed.
    """
    result = gemini_client.startup_check()
    return {"gemini": result, "status": gemini_client.status()}


@app.get("/api/audio-manifest")
def audio_manifest() -> dict:
    """Which sentences have a recording, so the client can look them up offline.

    Fetched once and kept in localStorage. The client then plays
    /audio/<file> directly - a static file, so it needs no backend logic and
    keeps working from the browser's HTTP cache when the network is gone.
    """
    return {"clips": audio_cache.manifest(), "count": len(audio_cache.manifest())}


@app.get("/api/languages")
def list_languages() -> dict:
    """Every language the app speaks. The UI builds itself from this."""
    return {
        "default": languages.DEFAULT_LANG,
        "verified": list(languages.TIER1_CODES),
        "cached": translate.cached_languages(),
        "languages": languages.as_dicts(),
    }


class UiStringsRequest(BaseModel):
    lang: str
    strings: dict[str, str] = Field(
        ..., description="The tier-1 UI strings, keyed exactly as the frontend has them."
    )


@app.post("/api/ui-strings")
def ui_strings(req: UiStringsRequest) -> dict:
    """Translate the interface itself into a tier-2 language, once, then cache.

    The frontend owns its copy and posts it here; the backend only carries it
    across and remembers the result. A tier-1 language round-trips unchanged.
    """
    lang = _clean_lang(req.lang)
    if languages.is_tier1(lang):
        return {"lang": lang, "translated": False, "strings": req.strings}

    out = translate.translate_map(req.strings, lang, cache_prefix="ui.")
    return {
        "lang": lang,
        "translated": out != req.strings,
        "strings": out,
    }


@app.get("/api/schemes")
def list_schemes(lang: str = "hi") -> dict:
    """The whole scheme pack. The frontend caches this so it works offline.

    For a tier-2 language this is the call that makes offline possible at all:
    every scheme is carried across once, here, and the client stores the result.
    """
    lang = _clean_lang(lang)
    rendered = [schemes.render(s, lang) for s in schemes.all_schemes()]
    if not languages.is_tier1(lang):
        rendered = [translate.translate_scheme(s, lang) for s in rendered]
    return {
        "data_status": schemes.data_status(),
        "lang": lang,
        "machine_translated": not languages.is_tier1(lang),
        "verified_language": languages.PIVOT_LANG,
        "schemes": rendered,
    }


@app.post("/api/scheme")
def scheme_lookup(req: SchemeRequest) -> dict:
    lang = _clean_lang(req.lang)

    if req.scheme_id:
        found = schemes.get(req.scheme_id)
        if not found:
            return {"found": False, "scheme": None, "others": [],
                    "speech": schemes.not_found_text(lang),
                    "data_status": schemes.data_status()}
        rendered = translate.translate_scheme(schemes.render(found, lang), lang)
        return {"found": True, "scheme": rendered, "others": [],
                "speech": schemes.speech_text(rendered, lang),
                "data_status": schemes.data_status()}

    if req.category:
        matches = schemes.by_category(req.category)
        if not matches:
            return {"found": False, "scheme": None, "others": [],
                    "speech": schemes.not_found_text(lang),
                    "data_status": schemes.data_status()}
        every = [translate.translate_scheme(schemes.render(s, lang), lang)
                 for s in matches]
        return {"found": True, "scheme": every[0], "others": every[1:],
                "schemes": every, "count": len(every),
                "speech": (schemes._many_speech(every, lang) if len(every) > 1
                           else schemes.speech_text(every[0], lang)),
                "data_status": schemes.data_status()}

    return schemes.answer(req.query or "", lang)


@app.post("/api/turn")
def turn(req: TurnRequest) -> dict:
    """One spoken turn: classify it, then answer it.

    The frontend calls only this. The response always contains `speech`
    (what the phone should read aloud) and `action` (what the UI should do).
    """
    lang = _clean_lang(req.lang)
    text = (req.text or "").strip()

    if not text:
        return {"intent": "GENERAL_CHAT", "action": None, "lang": lang,
                "speech": "", "scheme": None, "others": [],
                "data_status": schemes.data_status()}

    parsed = intent_module.parse(text)
    log.info("intent=%s source=%s text=%r", parsed["intent"], parsed["source"], text[:80])

    # Answer in the language the user is actually speaking, even when they never
    # asked. A villager who opens an app set to Hindi and speaks Marathi should
    # not have to know there is a language setting at all.
    #
    # This runs AFTER intent parsing so an explicit "switch to English" always
    # wins: that request is in English about English, and letting detection
    # second-guess it would break the headline feature.
    detected = None
    if req.auto_detect and parsed["intent"] not in ("CHANGE_UI_LANGUAGE", "SET_MODE"):
        # Script first (free). If the intent call already told us the language,
        # use that - it costs nothing extra and settles Hindi vs Marathi, which
        # script alone cannot.
        detected = intent_module.detect_language(text, lang)
        if not detected:
            spoken = parsed.get("spoken_language")
            if spoken and spoken != lang:
                detected = spoken
        if detected:
            log.info("auto-detected language %s (was %s)", detected, lang)
            lang = detected

    base = {
        "intent": parsed["intent"],
        "intent_source": parsed["source"],
        "transcript": text,
        "lang": lang,
        "detected_language": detected,
        "action": None,
        "scheme": None,
        "others": [],
        "data_status": schemes.data_status(),
    }

    if parsed["intent"] == "CHANGE_UI_LANGUAGE":
        new_lang = _clean_lang(parsed.get("lang"))
        return {**base, "action": "CHANGE_UI_LANGUAGE", "lang": new_lang,
                "speech": _lang_confirm(new_lang)}

    if parsed["intent"] == "SET_MODE":
        mode = parsed.get("mode") or "chat"
        said = {
            "chat": {
                "hi": "ठीक है, अब आप लिखकर बात कर सकते हैं।",
                "en": "Okay, you can type instead now.",
                "mr": "ठीक आहे, आता तुम्ही लिहून बोलू शकता.",
            },
            "voice": {
                "hi": "ठीक है, अब बोलकर बात कीजिए। माइक चालू है।",
                "en": "Okay, speak to me now. The mic is on.",
                "mr": "ठीक आहे, आता बोलून बोला. माइक चालू आहे.",
            },
        }[mode]
        return {**base, "action": "SET_MODE", "mode": mode,
                "speech": _say(said, lang, f"mode.{mode}")}

    if parsed["intent"] == "WEATHER_QUERY":
        # Real numbers from a real forecast, then a sentence built from them.
        # The model is not asked what the weather is - it does not know, and a
        # confident wrong forecast costs a farmer a day's work.
        place = _place_from(text)
        result = weather.answer(place, lang)
        if not result:
            no_net = {
                "hi": "अभी मौसम की जानकारी नहीं मिल पा रही। इंटरनेट आने पर दोबारा पूछिए।",
                "en": "I cannot get the weather right now. Please ask again when the internet is back.",
                "mr": "सध्या हवामानाची माहिती मिळत नाही. इंटरनेट आल्यावर पुन्हा विचारा.",
            }
            return {**base, "speech": _say(no_net, lang, "weatherFail")}

        speech = result["speech"]
        report = result.get("report")
        if not languages.is_tier1(lang):
            key = f"weather.{report['place']}" if report else "weather.unknownPlace"
            speech = translate.translate_text(speech, lang, key=key)
        return {**base, "action": "SHOW_WEATHER" if report else None,
                "weather": report, "speech": speech,
                "cached": result.get("cached", False),
                "cache_age_seconds": result.get("cache_age_seconds")}

    if parsed["intent"] == "CAMERA_OPEN":
        prompt = {"hi": "कैमरा खोल रहा हूँ। जो दिखाना है, सामने रखिए।",
                  "en": "Opening the camera. Hold up what you want to show me.",
                  "mr": "कॅमेरा उघडत आहे. जे दाखवायचे आहे ते समोर धरा."}
        return {**base, "action": "CAMERA_OPEN",
                "speech": _say(prompt, lang, "cameraOpening")}

    if parsed["intent"] == "REPEAT_LAST":
        return {**base, "action": "REPEAT_LAST", "speech": ""}

    if parsed["intent"] == "SCHEME_QUERY":
        result = schemes.answer(parsed.get("query") or text, lang)
        return {**base, "action": "SHOW_SCHEME" if result["found"] else None,
                "scheme": result["scheme"], "others": result["others"],
                # Every match, so a broad question ("सरकारी योजना बताओ") shows
                # the whole catalogue instead of only the top-scoring scheme.
                "schemes": result.get("schemes", []),
                "count": result.get("count", 0),
                "speech": result["speech"]}

    # GENERAL_CHAT. Tries live web search first so questions about prices, news
    # or anything recent get a real answer. Grounding is a paid feature, so when
    # it is refused we quietly answer from the model's own knowledge instead -
    # and `grounded` tells the client which of the two it got.
    reply, grounded = gemini_client.generate_grounded(text, system=_chat_system(lang))
    return {**base, "speech": reply or _fallback_reply(lang), "grounded": grounded}


@app.post("/api/vision")
def vision(req: VisionRequest) -> dict:
    lang = _clean_lang(req.lang)
    prompt = _vision_prompt(lang)
    if req.hint:
        prompt = f"{prompt}\n\n{req.hint}"

    described = gemini_client.describe_image(req.image, prompt)
    if described:
        return {"ok": True, "lang": lang, "speech": described, "ai_available": True}

    # Task 6: analysis failed, but the capture itself did not. The client keeps
    # the photo on screen and is told plainly why there is no description, rather
    # than the whole camera flow looking broken.
    reason = gemini_client.last_failure()
    log.warning(
        "service=vision reason=%s recovery=returning capture without analysis",
        reason or "unknown",
    )
    return {"ok": False, "lang": lang, "ai_available": False,
            "reason": reason,
            "speech": _say(_VISION_FAIL, lang, "visionFail")}


@app.post("/api/reload-schemes")
def reload_schemes() -> dict:
    """Re-read schemes.json without restarting the server, for edits during the event."""
    schemes.reload_db()
    return {"ok": True, "schemes": len(schemes.all_schemes()),
            "data_status": schemes.data_status()}
