"""The one place a language is defined.

Adding a language to this app means adding a row to LANGUAGES. Nothing else in
the codebase may hard-code a language code.

Two tiers, and the difference between them is a promise to the user:

  TIER 1  hi, en, mr
          Every visible string and every scheme fact was written or checked by
          a person. Works with no network at all.

  TIER 2  everything else
          The interface and the spoken answers are machine-translated at runtime
          from the tier-1 text. The app SAYS SO on screen. Needs network the
          first time a language is used; after that it is cached.

The rule that does not bend: a tier-2 translation is only ever made from text
that a human already verified in tier 1. The model translates checked facts. It
never sources them, and it is never asked who is eligible for anything.
"""

from __future__ import annotations

from typing import Any, NamedTuple


class Language(NamedTuple):
    code: str
    endonym: str        # what speakers call it, in their own script
    english: str        # what an English speaker calls it
    bcp47: str          # for SpeechRecognition and speechSynthesis
    aliases: tuple[str, ...]  # how a user might NAME this language out loud
    tier: int


# Tier 1 - hand-written, hand-verified, works offline.
_TIER1: tuple[Language, ...] = (
    Language("hi", "हिंदी", "Hindi", "hi-IN",
             ("हिंदी", "हिन्दी", "hindi", "hindee"), 1),
    Language("en", "English", "English", "en-IN",
             ("अंग्रेज़ी", "अंग्रेजी", "इंग्लिश", "इंग्रजी", "english", "angrezi",
              "inglish", "inglish"), 1),
    Language("mr", "मराठी", "Marathi", "mr-IN",
             ("मराठी", "marathi", "marathee"), 1),
)

# Tier 2 - the rest of the Eighth Schedule, plus the ones a rural user is most
# likely to actually speak. Aliases include the endonym, the English name, and
# common romanised spellings, because speech-to-text will not agree with us on
# how to spell a language name.
_TIER2: tuple[Language, ...] = (
    Language("bn", "বাংলা", "Bengali", "bn-IN",
             ("বাংলা", "bangla", "bengali", "बांग्ला", "बंगाली"), 2),
    Language("te", "తెలుగు", "Telugu", "te-IN",
             ("తెలుగు", "telugu", "तेलुगु", "तेलगु"), 2),
    # "தமிழ" not "தமிழ்": a user says "தமிழில் பேசு" (speak IN Tamil), and the
    # inflected form drops the virama, so the dictionary form never matches.
    # Every alias here has to be a stem that survives inflection.
    Language("ta", "தமிழ்", "Tamil", "ta-IN",
             ("தமிழ", "tamil", "तमिल", "तमिळ"), 2),
    Language("gu", "ગુજરાતી", "Gujarati", "gu-IN",
             ("ગુજરાતી", "gujarati", "गुजराती"), 2),
    Language("kn", "ಕನ್ನಡ", "Kannada", "kn-IN",
             ("ಕನ್ನಡ", "kannada", "कन्नड़", "कन्नड"), 2),
    Language("ml", "മലയാളം", "Malayalam", "ml-IN",
             ("മലയാള", "malayalam", "मलयालम"), 2),
    Language("pa", "ਪੰਜਾਬੀ", "Punjabi", "pa-IN",
             ("ਪੰਜਾਬੀ", "punjabi", "panjabi", "पंजाबी"), 2),
    Language("or", "ଓଡ଼ିଆ", "Odia", "or-IN",
             ("ଓଡ଼ିଆ", "odia", "oriya", "ओड़िया", "उड़िया"), 2),
    Language("as", "অসমীয়া", "Assamese", "as-IN",
             ("অসমীয়া", "assamese", "asamiya", "असमिया"), 2),
    Language("ur", "اردو", "Urdu", "ur-IN",
             ("اردو", "urdu", "उर्दू"), 2),
    Language("ne", "नेपाली", "Nepali", "ne-NP",
             ("नेपाली", "nepali"), 2),
    Language("sa", "संस्कृतम्", "Sanskrit", "sa-IN",
             ("संस्कृत", "संस्कृतम्", "sanskrit"), 2),
    Language("sd", "سنڌي", "Sindhi", "sd-IN",
             ("سنڌي", "sindhi", "सिंधी"), 2),
    Language("ks", "کٲشُر", "Kashmiri", "ks-IN",
             ("کٲشُر", "kashmiri", "कश्मीरी"), 2),
    Language("kok", "कोंकणी", "Konkani", "kok-IN",
             ("कोंकणी", "konkani"), 2),
    Language("mai", "मैथिली", "Maithili", "mai-IN",
             ("मैथिली", "maithili"), 2),
    Language("doi", "डोगरी", "Dogri", "doi-IN",
             ("डोगरी", "dogri"), 2),
    Language("mni", "ꯃꯤꯇꯩꯂꯣꯟ", "Manipuri", "mni-IN",
             ("manipuri", "meitei", "मणिपुरी"), 2),
    Language("sat", "ᱥᱟᱱᱛᱟᱲᱤ", "Santali", "sat-IN",
             ("santali", "santhali", "संताली"), 2),
    Language("brx", "बड़ो", "Bodo", "brx-IN",
             ("बोडो", "bodo", "boro"), 2),
    Language("bho", "भोजपुरी", "Bhojpuri", "bho-IN",
             ("भोजपुरी", "bhojpuri"), 2),
)

LANGUAGES: dict[str, Language] = {lang.code: lang for lang in _TIER1 + _TIER2}

DEFAULT_LANG = "hi"
TIER1_CODES: tuple[str, ...] = tuple(lang.code for lang in _TIER1)
ALL_CODES: tuple[str, ...] = tuple(LANGUAGES)

# The language a tier-2 translation is made FROM. Hindi, because the tier-1
# scheme text is richest there and every tier-2 language here is Indian.
PIVOT_LANG = "hi"


# The Unicode block each language is written in, used to catch a translator that
# answered in the wrong language. Models slip: asked for Tamil, they sometimes
# hand back Hindi. Without this check that slip gets cached and shown forever.
_SCRIPT_RANGES: dict[str, tuple[tuple[int, int], ...]] = {
    "deva": ((0x0900, 0x097F),),
    "beng": ((0x0980, 0x09FF),),
    "guru": ((0x0A00, 0x0A7F),),
    "gujr": ((0x0A80, 0x0AFF),),
    "orya": ((0x0B00, 0x0B7F),),
    "taml": ((0x0B80, 0x0BFF),),
    "telu": ((0x0C00, 0x0C7F),),
    "knda": ((0x0C80, 0x0CFF),),
    "mlym": ((0x0D00, 0x0D7F),),
    "arab": ((0x0600, 0x06FF), (0x0750, 0x077F)),
    "mtei": ((0xABC0, 0xABFF),),
    "olck": ((0x1C50, 0x1C7F),),
    "latn": ((0x0041, 0x005A), (0x0061, 0x007A)),
}

_LANG_SCRIPT: dict[str, str] = {
    "hi": "deva", "mr": "deva", "ne": "deva", "sa": "deva", "kok": "deva",
    "mai": "deva", "doi": "deva", "brx": "deva", "bho": "deva",
    "bn": "beng", "as": "beng",
    "pa": "guru", "gu": "gujr", "or": "orya",
    "ta": "taml", "te": "telu", "kn": "knda", "ml": "mlym",
    "ur": "arab", "sd": "arab", "ks": "arab",
    "mni": "mtei", "sat": "olck",
    "en": "latn",
}


def looks_like(text: str, code: str) -> bool:
    """Is this text plausibly written in `code`'s script?

    Deliberately lenient - a correct translation may carry a URL, a rupee figure
    or an English acronym. It only asks whether ANY character belongs to the
    expected block, which is enough to catch a whole answer in the wrong script.
    """
    script = _LANG_SCRIPT.get(code)
    if not script or not text:
        return True
    ranges = _SCRIPT_RANGES[script]
    return any(
        any(low <= ord(ch) <= high for low, high in ranges) for ch in text
    )


# Which language to assume when a script is shared by several. Devanagari is
# deliberately absent: Hindi and Marathi cannot be told apart by script, so that
# case is escalated to the model instead of guessed here.
_SCRIPT_DEFAULT: dict[str, str] = {
    "beng": "bn",
    "guru": "pa",
    "gujr": "gu",
    "orya": "or",
    "taml": "ta",
    "telu": "te",
    "knda": "kn",
    "mlym": "ml",
    "arab": "ur",
    "mtei": "mni",
    "olck": "sat",
}

# Below this share of letters, a script is treated as incidental. A Hindi
# sentence carrying "CSC" or "Aadhaar" must not be read as English.
_SCRIPT_CONFIDENCE = 0.6


def detect_script_language(text: str) -> str | None:
    """Which language is this text WRITTEN in? Local, instant, no network.

    Returns None for Devanagari (ambiguous between Hindi, Marathi and others),
    for Latin (English and romanised Hindi look identical), and whenever no
    script clearly dominates. None means "not confident" - the caller should
    leave the language alone rather than guess.
    """
    if not text:
        return None

    counts: dict[str, int] = {}
    letters = 0
    for ch in text:
        if not ch.isalpha():
            continue
        letters += 1
        for script, ranges in _SCRIPT_RANGES.items():
            if any(low <= ord(ch) <= high for low, high in ranges):
                counts[script] = counts.get(script, 0) + 1
                break

    if letters < 4 or not counts:
        return None

    script, hits = max(counts.items(), key=lambda pair: pair[1])
    if hits / letters < _SCRIPT_CONFIDENCE:
        return None

    return _SCRIPT_DEFAULT.get(script)


def is_supported(code: str | None) -> bool:
    return bool(code) and code in LANGUAGES


def clean(code: str | None) -> str:
    """Any unknown code becomes the default rather than an error."""
    return code if is_supported(code) else DEFAULT_LANG


def is_tier1(code: str) -> bool:
    return code in TIER1_CODES


def get(code: str) -> Language:
    return LANGUAGES[clean(code)]


def name_of(code: str) -> str:
    """English name, for putting inside a prompt to the model."""
    return LANGUAGES[clean(code)].english


def detect_named_language(text: str) -> str | None:
    """Which language is this sentence ASKING FOR? None if it names none.

    Longest alias first, so "hindi" inside "hindi-english" does not win over a
    more specific match, and so two-word names are tried before one-word ones.
    """
    lowered = text.lower()
    best: tuple[int, str] | None = None
    for lang in LANGUAGES.values():
        for alias in lang.aliases:
            if alias.lower() in lowered:
                if best is None or len(alias) > best[0]:
                    best = (len(alias), lang.code)
    return best[1] if best else None


def as_dicts() -> list[dict[str, Any]]:
    """The registry, for the frontend. One fetch and the UI knows every language.

    `aliases` is shipped too, because the offline matcher in
    frontend/src/lib/offline.js has to recognise a spoken language name with no
    network. Switching out of a language you cannot read is the one thing that
    must never depend on a server being up.
    """
    return [
        {
            "code": lang.code,
            "endonym": lang.endonym,
            "english": lang.english,
            "bcp47": lang.bcp47,
            "tier": lang.tier,
            "aliases": list(lang.aliases),
        }
        for lang in LANGUAGES.values()
    ]
