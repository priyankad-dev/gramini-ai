"""Scheme lookup.

The single most important rule in this project lives here:

    The LLM never decides who is eligible for a government scheme.

Gemini is used for intent parsing, free chat and vision. It is NOT used to
generate scheme facts. A scheme answer is assembled deterministically from
data/schemes.json, in the user's language, and always carries the official
government link. If a scheme is not in the file, we say so instead of guessing.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import languages
import translate

DATA_FILE = Path(__file__).parent / "data" / "schemes.json"

# The languages schemes.json is actually written in. Everything else is carried
# across at runtime by translate.py, from these.
LANGS = languages.TIER1_CODES
DEFAULT_LANG = languages.DEFAULT_LANG


def _load() -> dict[str, Any]:
    with DATA_FILE.open(encoding="utf-8") as fh:
        return json.load(fh)


_DB = _load()


def reload_db() -> None:
    """Re-read schemes.json from disk (handy while editing data during the event)."""
    global _DB
    _DB = _load()


def data_status() -> str:
    """'sample' until the team verifies every scheme against its official portal."""
    return _DB.get("data_status", "sample")


def all_schemes() -> list[dict[str, Any]]:
    return _DB.get("schemes", [])


def get(scheme_id: str) -> dict[str, Any] | None:
    for s in all_schemes():
        if s["id"] == scheme_id:
            return s
    return None


def by_category(category: str) -> list[dict[str, Any]]:
    return [s for s in all_schemes() if s.get("category") == category]


def _normalise(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().lower())


# Words that appear in almost every scheme, so matching on them means nothing.
# Without this list, "laptop subsidy YOJANA" scores a point against every scheme
# whose name contains "yojana" and we hand back a confident, wrong answer.
_STOPWORDS = {
    "योजना", "सरकारी", "सरकार", "बताओ", "बताइए", "बता", "चाहिए", "मुझे", "क्या",
    "कैसे", "कहाँ", "कहां", "मिलेगा", "मिलेगी", "करें", "सांगा", "पाहिजे", "काय",
    "scheme", "schemes", "government", "tell", "about", "the", "and", "for",
    "what", "how", "where", "please", "want", "need", "give", "info",
    "information", "yojana", "sarkari",
    # Quantifiers and question words. Added so that "सारी योजनाएं बताओ" and
    # "what schemes are there" register as having no SUBJECT - which is what
    # makes them a request for the whole catalogue rather than for one scheme.
    "योजनाएं", "योजनाएँ", "योजनाओं", "योजनांची", "योजनांबद्दल", "स्कीम",
    "सारी", "सारे", "सब", "सभी", "कौन", "कौनसी", "कौन-सी", "सगळ्या", "कोणत्या",
    "है", "हैं", "बारे", "जानकारी", "लिस्ट", "सूची", "देखना", "देखो",
    "all", "which", "there", "are", "list", "any", "some", "available",
}

# A match must clear this to count. Below it we say "I do not know" instead of
# returning the least-wrong scheme, which is the whole point of the design.
_MIN_SCORE = 4

# "Tell me about government schemes" - a request for the whole catalogue rather
# than for any one scheme.
#
# These have to be recognised SEPARATELY from ordinary matching, because every
# word in them is a stopword. That is deliberate: "yojana" appears in most scheme
# names, so scoring on it would match everything at once. The result was that the
# broadest, most natural question a villager can ask - "सरकारी योजना बताओ" -
# scored zero and got a refusal.
_BROAD_QUERY_WORDS = (
    "योजना", "योजनाएं", "योजनाएँ", "योजनाओं", "सरकारी योजना", "सारी योजना",
    "सब योजना", "कौन कौन सी योजना", "क्या क्या योजना", "लिस्ट", "सूची",
    "योजना सांगा", "सगळ्या योजना", "कोणत्या योजना",
    "scheme", "schemes", "all schemes", "list", "what schemes", "which schemes",
    "government scheme", "government schemes", "sarkari yojana",
)

# Words that mean a CATEGORY rather than a specific scheme.
#
# Built as concept -> words, then inverted at import. The right-hand side is
# language knowledge, not scheme data, so it lives in code; the left-hand side is
# whatever `category` values exist in schemes.json, so adding a scheme in a new
# category needs no change here beyond naming its synonyms.
_CATEGORY_WORDS: dict[str, tuple[str, ...]] = {
    "farming": (
        "किसान", "खेती", "खेत", "फसल", "कृषि", "अनाज उगाना", "शेतकरी", "शेती", "पीक",
        "farmer", "farming", "agriculture", "crop", "cultivation", "kisan", "kheti",
    ),
    "health": (
        "स्वास्थ्य", "सेहत", "इलाज", "बीमारी", "अस्पताल", "डॉक्टर", "दवा", "मेडिकल",
        "आरोग्य", "उपचार", "रुग्णालय",
        "health", "hospital", "treatment", "medical", "doctor", "illness",
        "medicine", "sehat", "ilaj",
    ),
    "work": (
        # "नौकरी" / "naukri" are deliberately ABSENT. A government JOB is not
        # MGNREGA, and "सरकारी नौकरी कैसे मिलेगी" was being answered with a
        # rural wage-employment scheme - a confident, useless answer to someone
        # asking about recruitment.
        "रोजगार", "रोज़गार", "काम", "मजदूरी", "मज़दूरी", "मेहनत",
        "रोजगार हमी", "मजुरी", "मनरेगा",
        # English "job" is safe to include: the false positive was the HINDI
        # "नौकरी" (government recruitment), which stays out.
        "employment", "job", "jobs", "job card", "wage", "wages", "labour", "labor",
        "rojgar", "mgnrega", "nrega", "100 days",
    ),
    "housing": (
        "घर", "मकान", "आवास", "छत", "रहने", "घरकुल",
        "house", "home", "housing", "shelter", "awas", "makan",
    ),
    "pension": (
        "पेंशन", "बुढ़ापा", "वृद्धावस्था", "बुजुर्ग", "विधवा", "दिव्यांग",
        "निवृत्तीवेतन", "वृद्धापकाळ",
        "pension", "old age", "elderly", "widow", "disability", "disabled",
    ),
    "food": (
        "राशन", "अनाज", "गेहूं", "गेहूँ", "चावल", "खाना", "भोजन", "सस्ता अनाज",
        "रेशन", "धान्य", "अन्न",
        "ration", "food", "grain", "wheat", "rice", "foodgrain", "pds",
    ),
}

# concept word -> category, built once at import.
_WORD_TO_CATEGORY: dict[str, str] = {
    word: category
    for category, words in _CATEGORY_WORDS.items()
    for word in words
}

# Words that describe a SITUATION rather than a subject, and so point at several
# categories at once. "गरीबों की योजना" is not a housing question or a food
# question - it is all of them, and answering with one category would be a worse
# answer than answering with none.
_SITUATION_WORDS: dict[tuple[str, ...], tuple[str, ...]] = {
    ("गरीब", "गरीबी", "गरीबों", "ग़रीब", "निर्धन", "बीपीएल", "गरिबी", "गरीबांसाठी",
     "poor", "poverty", "bpl", "below poverty", "needy", "low income"):
        ("housing", "food", "health", "pension"),
    ("बुजुर्ग", "बुढ़ापा", "वृद्ध", "वृद्धांसाठी", "old", "elderly", "senior"):
        ("pension", "health"),
    ("महिला", "औरत", "विधवा", "स्त्री", "woman", "women", "widow"):
        ("pension", "health", "food"),
    ("किसान", "शेतकरी", "farmer", "kisan"):
        ("farming",),
}

_WORD_TO_CATEGORIES: dict[str, tuple[str, ...]] = {
    word: cats for words, cats in _SITUATION_WORDS.items() for word in words
}


def categories() -> set[str]:
    """Whatever categories the JSON actually uses. Never hard-coded."""
    return {s.get("category") for s in all_schemes() if s.get("category")}


def is_broad_query(query: str) -> bool:
    """Is the user asking for the whole catalogue rather than one scheme?

    True only when the sentence mentions schemes in general AND names no
    particular subject - "सरकारी योजना बताओ" is broad, "किसान योजना" is not.
    """
    q = _normalise(query)
    if not q:
        return False
    if not any(word in q for word in _BROAD_QUERY_WORDS):
        return False
    # If it also names a category or a scheme keyword, it is a narrower request.
    if _categories_in(q):
        return False
    return not _content_tokens(q)


def is_scheme_topic(query: str) -> bool:
    """Does this sentence name a subject we have schemes for?

    Used by intent.py so a bare category word ("farmer", "grain", "home") is
    routed to the local database instead of to free chat. Keeps the vocabulary
    in one place: a new category in schemes.json plus its synonyms above makes
    both search AND intent aware of it.
    """
    return bool(_categories_in(query)) or is_broad_query(query)


def _categories_in(query: str) -> set[str]:
    """Which categories does this sentence point at, via synonyms?

    Two kinds of word feed this: subject words ("health" -> health) and
    situation words ("गरीब" -> housing, food, health, pension), because some
    questions are about a person's circumstances rather than one topic.
    """
    q = _normalise(query)
    found: set[str] = set()
    for word, category in _WORD_TO_CATEGORY.items():
        if word in q:
            found.add(category)
    for word, cats in _WORD_TO_CATEGORIES.items():
        if word in q:
            found.update(cats)
    return found & categories()


def _content_tokens(text: str) -> set[str]:
    """Meaningful words only: length > 2, stopwords dropped."""
    return {
        t
        for t in re.split(r"[^\wऀ-ॿ]+", text)
        if len(t) > 2 and t not in _STOPWORDS
    }


def search(query: str, lang: str = DEFAULT_LANG) -> list[dict[str, Any]]:
    """Score schemes against a spoken query. Purely local — works with no network.

    Returns EVERY scheme that clears the threshold, best first. Callers decide
    how many to show; this never truncates, because "which schemes can I get?"
    is a question with more than one right answer.
    """
    q = _normalise(query)
    if not q:
        return []

    # "Tell me about government schemes" - the whole catalogue, in a stable
    # order so the spoken list does not reshuffle between identical questions.
    if is_broad_query(q):
        return list(all_schemes())

    # Category words the user actually said ("health", "स्वास्थ्य", "rojgar").
    # These are a STRONG signal: a person asking for health schemes wants every
    # health scheme, not the one whose prose happens to overlap most.
    wanted_categories = _categories_in(q)

    q_tokens = _content_tokens(q)

    scored: list[tuple[int, dict[str, Any]]] = []
    for scheme in all_schemes():
        # Two separate scores, and the difference between them is the whole
        # safety property. `strong` comes only from curated signals a human put
        # in schemes.json - the keyword lists and the scheme's own name.
        # `weak` comes from loose overlap with the descriptive prose.
        strong = 0

        # Keyword hits in any language: the user may mix Hindi and English.
        for kw_lang in LANGS:
            for kw in scheme.get("keywords", {}).get(kw_lang, []):
                kw_n = _normalise(kw)
                if not kw_n:
                    continue
                if kw_n in q:
                    strong += 10 if kw_lang == lang else 7
                    continue
                # Word-order-insensitive match. Real speech is "kisan KI yojana",
                # not the exact phrase "kisan yojana", so a plain substring test
                # misses most of what a user actually says.
                kw_tokens = {
                    t for t in re.split(r"[^\wऀ-ॿ]+", kw_n) if len(t) > 2
                }
                if kw_tokens and kw_tokens <= q_tokens:
                    strong += 6 if kw_lang == lang else 4

        # Scheme name mentioned directly.
        for name_lang in LANGS:
            name = _normalise(scheme.get("name", {}).get(name_lang, ""))
            if name and name in q:
                strong += 15

        # The user named this scheme's category, in any of the three languages.
        # Counts as a curated signal because the mapping is hand-written, not
        # inferred from prose - so it may create a match on its own.
        if scheme.get("category") in wanted_categories:
            strong += 8

        # A scheme is NEVER returned on descriptive overlap alone. Without this
        # guard, "mujhe laptop ke liye sarkari paisa chahiye" scored exactly 4
        # against Fasal Bima - +2 for "paisa" and +2 for "liye", both of which
        # appear in the crop-insurance prose - and we confidently offered a
        # farmer crop insurance for a laptop question. Two ordinary Hindi words
        # must not be able to manufacture a match.
        if strong <= 0:
            continue

        # Loose token overlap, so "mujhe ghar chahiye" still reaches the housing
        # scheme. Every descriptive field counts, not just what_you_get - the word
        # a user says ("kisan", "vidhwa") often lives in the eligibility line.
        # This only ever RANKS schemes that already cleared the guard above.
        #
        # Matched as WHOLE WORDS, not substrings: a substring test made "tell"
        # match "telling" inside the Soil Health Card description, which handed
        # an English farmer query to the wrong scheme.
        haystack_words = _content_tokens(
            " ".join(
                _normalise(scheme.get(field, {}).get(l, ""))
                for field in ("name", "what_you_get", "who_can_apply", "how_to_apply")
                for l in LANGS
            )
        )
        weak = sum(2 for t in q_tokens if t in haystack_words)

        score = strong + weak
        if score >= _MIN_SCORE:
            scored.append((score, scheme))

    scored.sort(key=lambda pair: pair[0], reverse=True)
    results = [scheme for _, scheme in scored]

    # Nothing matched, but the sentence was clearly about schemes in general
    # ("सारी योजनाएं बताओ", "what schemes are there"). Rather than refuse a
    # question we plainly understood, show the catalogue.
    #
    # Checked AFTER scoring, rather than by trying to enumerate every phrasing up
    # front - that is what left "कौन कौन सी योजना है" returning nothing.
    #
    # `q_tokens` must be empty for this to fire. Without that condition,
    # "बिजली का बिल माफ करने की योजना" and "free wifi scheme" matched nothing,
    # hit this fallback, and were answered with all nine schemes - turning a
    # refusal into a confident irrelevant answer, which is the exact failure the
    # whole design exists to prevent.
    if not results and not q_tokens and any(w in q for w in _BROAD_QUERY_WORDS):
        return list(all_schemes())

    return results


def _pick(field: Any, lang: str) -> Any:
    """Read a {hi, en, mr} block, falling back rather than returning nothing."""
    if not isinstance(field, dict):
        return field
    return field.get(lang) or field.get(DEFAULT_LANG) or field.get("en") or ""


def render(scheme: dict[str, Any], lang: str = DEFAULT_LANG) -> dict[str, Any]:
    """Turn one scheme into the exact shape the UI and the TTS engine need."""
    return {
        "id": scheme["id"],
        "icon": scheme.get("icon", "📄"),
        "category": scheme.get("category"),
        # Shipped to the client on purpose: the offline matcher in
        # frontend/src/lib/offline.js scores against these, so an answer given
        # with no network is the same answer given with one.
        "keywords": scheme.get("keywords", {}),
        "name": _pick(scheme.get("name"), lang),
        "what_you_get": _pick(scheme.get("what_you_get"), lang),
        "who_can_apply": _pick(scheme.get("who_can_apply"), lang),
        "papers_needed": _pick(scheme.get("papers_needed"), lang) or [],
        "how_to_apply": _pick(scheme.get("how_to_apply"), lang),
        "official_link": scheme.get("official_link"),
        "helpline": scheme.get("helpline"),
        "verified_on": scheme.get("verified_on"),
    }


# Spoken answers are built from these templates, not by the model.
_SPEECH = {
    "hi": (
        "{name}। इसमें क्या मिलता है: {what}। कौन ले सकता है: {who}। "
        "ज़रूरी कागज़: {papers}। कैसे लें: {how}। "
        "यह जानकारी सरकारी वेबसाइट {link} से ली गई है।"
    ),
    "en": (
        "{name}. What you get: {what}. Who can apply: {who}. "
        "Papers needed: {papers}. How to apply: {how}. "
        "This information comes from the official website {link}."
    ),
    "mr": (
        "{name}. यात काय मिळते: {what}. कोण घेऊ शकते: {who}. "
        "आवश्यक कागदपत्रे: {papers}. कसे मिळवायचे: {how}. "
        "ही माहिती सरकारी संकेतस्थळ {link} वरून घेतली आहे."
    ),
}

_JOIN = {"hi": ", ", "en": ", ", "mr": ", "}

_NOT_FOUND = {
    "hi": (
        "माफ़ कीजिए, इस योजना की पक्की जानकारी मेरे पास नहीं है। "
        "मैं अंदाज़े से नहीं बताऊँगा। अपने गाँव के CSC केंद्र या ग्राम पंचायत से पूछिए।"
    ),
    "en": (
        "Sorry, I do not have checked information about that scheme. "
        "I will not guess. Please ask at your village CSC centre or gram panchayat."
    ),
    "mr": (
        "माफ करा, या योजनेची तपासलेली माहिती माझ्याकडे नाही. "
        "मी अंदाजाने सांगणार नाही. कृपया गावातील CSC केंद्र किंवा ग्रामपंचायतीला विचारा."
    ),
}


def _trim(text: Any) -> str:
    """Drop a trailing full stop so the template's own one does not double up.

    Hindi and Marathi end sentences with a danda, so without this the spoken
    line comes out as "...khaate mein।।", which the TTS engine reads as an
    extra pause.
    """
    return str(text or "").strip().rstrip("।.").strip()


# For tier-2 languages the sentence is assembled from these labels rather than a
# hand-written template. Only the labels go through the translator - the facts
# themselves were already carried across by translate.translate_scheme, and the
# link is never handed to the model at all.
_SPEECH_LABELS = {
    "what": "इसमें क्या मिलता है",
    "who": "कौन ले सकता है",
    "papers": "ज़रूरी कागज़",
    "how": "कैसे लें",
    "source": "यह जानकारी इस सरकारी वेबसाइट से ली गई है",
}


def speech_text(rendered: dict[str, Any], lang: str = DEFAULT_LANG) -> str:
    """The sentence the phone reads aloud. Cited, and never model-authored."""
    lang = languages.clean(lang)
    papers = rendered.get("papers_needed") or []
    link = rendered.get("official_link", "")

    if languages.is_tier1(lang):
        return _SPEECH[lang].format(
            name=_trim(rendered.get("name")),
            what=_trim(rendered.get("what_you_get")),
            who=_trim(rendered.get("who_can_apply")),
            papers=_JOIN.get(lang, ", ").join(papers),
            how=_trim(rendered.get("how_to_apply")),
            link=link,
        )

    labels = translate.translate_map(_SPEECH_LABELS, lang, cache_prefix="speech.")
    return (
        f"{_trim(rendered.get('name'))}. "
        f"{labels['what']}: {_trim(rendered.get('what_you_get'))}. "
        f"{labels['who']}: {_trim(rendered.get('who_can_apply'))}. "
        f"{labels['papers']}: {', '.join(papers)}. "
        f"{labels['how']}: {_trim(rendered.get('how_to_apply'))}. "
        f"{labels['source']} {link}"
    )


def not_found_text(lang: str = DEFAULT_LANG) -> str:
    lang = languages.clean(lang)
    if languages.is_tier1(lang):
        return _NOT_FOUND[lang]
    # Refusing to guess must survive translation. If the translator is down we
    # say it in Hindi rather than saying nothing.
    return translate.translate_text(
        _NOT_FOUND[DEFAULT_LANG], lang, key="notFound"
    )


# Spoken preamble when several schemes match. Numbers are filled in, so the
# sentence is assembled here rather than written by the model.
_FOUND_MANY = {
    "hi": "मुझे {n} सरकारी योजनाएँ मिलीं। एक-एक करके बताता हूँ।",
    "en": "I found {n} government schemes. Let me tell you about each one.",
    "mr": "मला {n} सरकारी योजना सापडल्या. एक-एक करून सांगतो.",
}

_NUMBERED = {"hi": "योजना {i}", "en": "Scheme {i}", "mr": "योजना {i}"}

# Every matching scheme is spoken. No truncation here.
#
# This used to cut off at three, on the reasoning that nine descriptions is four
# minutes of audio. But truncating in the BACKEND means a user who cannot read
# never learns the other six exist - and "the ones you cannot hear are on the
# screen" is useless advice to someone who came here because they cannot read a
# screen. Length is handled where it belongs: the frontend speaks the answer in
# chunks and the user can stop at any point.
_CLOSING = {
    "hi": "यही {n} योजनाएँ मुझे मिलीं। किसी एक के बारे में और सुनना हो तो उसका नाम बोलिए।",
    "en": "Those are the {n} schemes I found. Say the name of any one to hear more about it.",
    "mr": "याच {n} योजना मला सापडल्या. एखादीबद्दल अधिक ऐकायचे असल्यास तिचे नाव सांगा.",
}


def _many_speech(rendered_list: list[dict[str, Any]], lang: str) -> str:
    """One spoken answer covering several schemes, built from the file."""
    lang = languages.clean(lang)
    count = len(rendered_list)

    def pick(bundle: dict[str, str], key: str) -> str:
        """The connective sentence, in the user's own language.

        Tier-2 languages get these translated too, and cached. Without it the
        scheme FACTS came out in Tamil while "I found 9 schemes" and "Scheme 3"
        stayed in Hindi - an answer that switches language mid-sentence sounds
        broken even when every fact in it is right.
        """
        if languages.is_tier1(lang):
            return bundle.get(lang) or bundle[DEFAULT_LANG]
        return translate.translate_text(
            bundle[DEFAULT_LANG], lang, key=f"listing.{key}"
        )

    parts = [pick(_FOUND_MANY, "found").format(n=count)]
    numbered = pick(_NUMBERED, "numbered")
    for index, rendered in enumerate(rendered_list, start=1):
        parts.append(f"{numbered.format(i=index)}. {speech_text(rendered, lang)}")
    parts.append(pick(_CLOSING, "closing").format(n=count))

    # Blank lines separate the schemes. The frontend splits on them to build its
    # speech queue, so a scheme is never cut in half across two utterances.
    return "\n\n".join(parts)


def answer(query: str, lang: str = DEFAULT_LANG) -> dict[str, Any]:
    """Full scheme answer for a spoken query. Never invents a scheme."""
    lang = languages.clean(lang)

    # The keyword lists in schemes.json are Hindi, English and Marathi. Someone
    # asking in Tamil would match none of them, so the QUESTION is carried into
    # Hindi first and matched there. Only the question moves - the answer is
    # still assembled from the verified file, not from the model.
    match_query, match_lang = query, lang
    if not languages.is_tier1(lang) and query:
        match_query = translate.translate_text(
            query, languages.PIVOT_LANG, key=f"q.{query[:60]}", force=True
        ) or query
        match_lang = languages.PIVOT_LANG

    matches = search(match_query, match_lang)
    if not matches:
        return {
            "found": False,
            "scheme": None,
            "others": [],
            "speech": not_found_text(lang),
            "data_status": data_status(),
        }

    rendered = [translate.translate_scheme(render(s, lang), lang) for s in matches]
    best = rendered[0]
    multiple = len(rendered) > 1

    return {
        "found": True,
        # `schemes` is the real answer: EVERY match, best first. The old
        # single-result shape is kept beside it so nothing that reads `scheme`
        # or `others` breaks.
        "schemes": rendered,
        "count": len(rendered),
        "scheme": best,
        "others": rendered[1:],
        "speech": _many_speech(rendered, lang) if multiple else speech_text(best, lang),
        "data_status": data_status(),
    }
