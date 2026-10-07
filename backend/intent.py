"""Intent parsing.

Two layers, on purpose:

1. A local rule layer that costs nothing and cannot fail. It catches the
   commands the demo depends on - above all "change the app language", which
   is our headline feature. It must work on venue wifi that has died.
2. Gemini, for everything the rules do not recognise.

If both layers miss, we fall back to GENERAL_CHAT. The app never crashes on a
sentence it does not understand.
"""

from __future__ import annotations

import re
from typing import Any

import gemini_client
import languages
import schemes

INTENTS = (
    "CHANGE_UI_LANGUAGE",
    "SET_MODE",
    "WEATHER_QUERY",
    "SCHEME_QUERY",
    "CAMERA_OPEN",
    "REPEAT_LAST",
    "GENERAL_CHAT",
)

SUPPORTED_LANGS = languages.ALL_CODES

# Verbs that mean "switch to". These are only ever checked TOGETHER with a
# language name, so short words like "बोल" cannot fire on their own.
#
# The list spans languages on purpose: a Tamil speaker asks for Tamil IN Tamil,
# and at that moment the app is still running in Hindi. If the verb list only
# held Hindi words, the one feature that gets someone out of a language they
# cannot read would be the one feature they could not reach.
_SWITCH_WORDS = (
    # Hindi / Marathi
    "कर दो", "करो", "कर दे", "में कर", "बदल", "चेंज", "में बात",
    "बोल", "बोलो", "बोलिए", "सांग", "सांगा", "मध्ये कर", "बदला", "कर",
    # English
    "change", "switch", "speak", "talk", "set to", "make it", "in",
    # What the recogniser actually WRITES. In Hindi mode, "speak in English" is
    # transcribed in Devanagari ("स्पीक इन इंग्लिश"); in English mode, "हिंदी में
    # बोलो" comes back romanised ("Hindi mein bolo"). Without these, a spoken
    # switch fell through to scheme search or chat, and once in English there
    # was no way back by voice.
    "स्पीक", "टॉक", "स्विच",
    "bolo", "boliye", "bolie", "bola", "baat", "badlo", "badal do", "sanga",
    # Bengali / Assamese / Odia
    "বল", "বলুন", "কথা বল", "কও", "କୁହ", "କଥା",
    # Telugu / Kannada / Tamil / Malayalam
    "మాట్లాడు", "చెప్పు", "ಮಾತಾಡು", "ಹೇಳು", "பேசு", "சொல்", "സംസാരിക്കൂ", "പറയൂ",
    # Gujarati / Punjabi / Urdu
    "બોલો", "વાત", "ਬੋਲੋ", "ਗੱਲ", "بولو", "بات",
)

# Voice as the remote control for the interface itself, not just a way to ask
# questions. "Show me the writing screen" is a UI command, and it has to work
# from the rules layer so it survives a dead network.
_CHAT_MODE_WORDS = (
    "चैट मोड", "चैट मोड ऑन", "लिखकर बात", "लिख कर बात", "लिखने वाला", "टाइप करके",
    "कीबोर्ड", "लिखना है", "टाइप वाला",
    "चॅट मोड", "लिहून बोल", "टाइप करून",
    "chat mode", "text mode", "typing mode", "keyboard mode", "let me type",
    "i want to type", "write instead",
)

_VOICE_MODE_WORDS = (
    "वॉयस मोड", "वॉइस मोड", "आवाज़ मोड", "आवाज मोड", "बोलकर बात", "बोल कर बात",
    "माइक वापस", "माइक खोल", "बोलना है",
    "आवाज मोड", "बोलून बोल",
    "voice mode", "speak mode", "mic mode", "let me talk", "i want to speak",
    "back to voice",
)

# Weather is one of the four things on the front screen, and the only one whose
# answer changes every day. It gets its own intent so it can be routed to a live
# forecast instead of the model, which has no idea what today looks like.
_WEATHER_WORDS = (
    "मौसम", "बारिश", "बरसात", "बादल", "धूप", "गर्मी", "ठंड", "तापमान", "आँधी",
    "हवामान", "पाऊस", "ऊन", "थंडी",
    "weather", "rain", "raining", "temperature", "forecast", "hot today",
    "cold today", "storm",
)

_CAMERA_WORDS = (
    "कैमरा", "फोटो", "तस्वीर", "दिखाना", "दिखाऊं", "दिखाऊँ", "स्कैन",
    "कॅमेरा", "फोटो काढ", "दाखव",
    "camera", "photo", "picture", "scan", "show you", "look at this",
)

_REPEAT_WORDS = (
    "फिर से", "दोबारा", "दुबारा", "वापस बोलो", "क्या कहा",
    "पुन्हा", "परत सांग",
    "repeat", "say again", "again please", "what did you say",
)

_SCHEME_WORDS = (
    "योजना", "स्कीम", "सरकारी", "पेंशन", "बीमा", "लोन", "कर्ज", "सब्सिडी",
    "अनुदान", "राशन", "जॉब कार्ड", "मुफ्त", "मुफ़्त", "पैसा मिलेगा", "आवास",
    "घर", "इलाज", "अस्पताल", "मजदूरी", "किसान", "फसल", "मिट्टी",
    "योजना", "अनुदान", "निवृत्तीवेतन", "विमा", "शेतकरी", "पीक", "घरकुल",
    "scheme", "yojana", "subsidy", "pension", "insurance", "loan", "ration",
    "job card", "free treatment", "government help", "benefit", "eligible",
)


def _contains(text: str, words: tuple[str, ...]) -> bool:
    """Does the sentence contain any of these trigger words?

    Latin words are matched on WORD BOUNDARIES, everything else as a substring.
    That split is not cosmetic: a plain substring test made "rain" fire inside
    "grain" and "foodgrain", so asking about foodgrain returned a weather
    forecast. The same trap catches "brain", "training", "terrain".

    Indic scripts keep the substring test on purpose - they agglutinate, so
    "मौसम" legitimately appears inside "मौसमी" and a boundary test would miss it.
    """
    for word in words:
        if word.isascii():
            if re.search(rf"(?<![a-z0-9]){re.escape(word)}(?![a-z0-9])", text):
                return True
        elif word in text:
            return True
    return False


def rule_parse(text: str) -> dict[str, Any] | None:
    """Local, offline, instant. Returns None when it is not confident."""
    lowered = text.lower().strip()
    if not lowered:
        return None

    # 1. Language switch. Needs a language name AND a switching verb, so
    #    "hindi mein kya milta hai" is not mistaken for a command.
    named = languages.detect_named_language(lowered)
    if named and _contains(lowered, _SWITCH_WORDS):
        return {"intent": "CHANGE_UI_LANGUAGE", "lang": named, "query": None,
                "source": "rules"}

    # 2. Interface mode. Checked before camera and scheme words, because
    #    "लिखकर बात करो" contains none of those but is unambiguous.
    if _contains(lowered, _CHAT_MODE_WORDS):
        return {"intent": "SET_MODE", "mode": "chat", "lang": None, "query": None,
                "source": "rules"}
    if _contains(lowered, _VOICE_MODE_WORDS):
        return {"intent": "SET_MODE", "mode": "voice", "lang": None, "query": None,
                "source": "rules"}

    # 3. Repeat.
    if _contains(lowered, _REPEAT_WORDS):
        return {"intent": "REPEAT_LAST", "lang": None, "query": None, "source": "rules"}

    # 4. Camera.
    if _contains(lowered, _CAMERA_WORDS):
        return {"intent": "CAMERA_OPEN", "lang": None, "query": None, "source": "rules"}

    # 5. Weather. Checked before schemes, because "आज बारिश होगी क्या" is about
    #    the sky, while "फसल बीमा" is about a scheme even though both mention rain.
    if _contains(lowered, _WEATHER_WORDS) and not _contains(lowered, _SCHEME_WORDS):
        return {"intent": "WEATHER_QUERY", "lang": None, "query": text,
                "source": "rules"}

    # 6. Scheme talk.
    #
    # The category vocabulary is asked for rather than duplicated here, so a bare
    # "farmer", "grain" or "home" routes to a scheme lookup, and a scheme added
    # to schemes.json in a new category becomes reachable without touching this
    # file. Duplicating the word lists is how "farmer" ended up being answered by
    # free chat while "किसान" worked.
    if _contains(lowered, _SCHEME_WORDS) or schemes.is_scheme_topic(lowered):
        return {"intent": "SCHEME_QUERY", "lang": None, "query": text, "source": "rules"}

    return None


_SYSTEM = """You are the intent parser for Gramini AI, a voice app used by rural Indian users.
You never answer the user. You only classify what they said.

Reply with ONE JSON object and nothing else. No markdown, no explanation.

Shape:
{"intent": "<INTENT>", "lang": "<code>" | null, "mode": "chat" | "voice" | null,
 "query": "<string>" | null, "spoken_language": "<code>" | null}

"spoken_language" is which language the user is WRITING IN right now - not what
they are asking for. Set it only when you are certain, and leave it null when
the sentence is short or mixes languages. Getting it wrong changes the whole
app's language for someone who never asked, so null is the safe answer.

"lang" is only for CHANGE_UI_LANGUAGE. Use one of these codes:
""" + ", ".join(
    f"{lang.code} ({lang.english})" for lang in languages.LANGUAGES.values()
) + """

Intents:
- CHANGE_UI_LANGUAGE : the user wants the APP itself to switch language. Set "lang".
- SET_MODE           : the user wants to change HOW they talk to the app, not what
                       about. Set "mode" to "chat" if they want to type or write,
                       or "voice" if they want to go back to speaking.
- SCHEME_QUERY       : the user asks about a government scheme, benefit, subsidy,
                       pension, insurance, loan, ration, housing, hospital or job card.
                       Set "query" to what they are asking about.
- WEATHER_QUERY      : the user asks about weather, rain, temperature or a forecast.
                       Put any place they named into "query".
- CAMERA_OPEN        : the user wants to show something to the camera or take a photo.
- REPEAT_LAST        : the user asks you to repeat the last answer.
- GENERAL_CHAT       : anything else, including weather and general questions.

The user may speak any Indian language, or a mix of one with English.
Transcription may be wrong; guess the most likely meaning."""


def detect_language(text: str, current: str) -> str | None:
    """Which language is the user SPEAKING? None means 'leave it alone'.

    SCRIPT ONLY - instant, offline, free. A sentence in Tamil script is Tamil.

    It deliberately does NOT call the model. The first version did, and because
    Devanagari cannot settle Hindi vs Marathi by script alone, that meant an
    extra model call on EVERY Hindi turn - roughly doubling quota burn on a free
    tier that allows 20 calls a day. The app then began reporting "no internet"
    on a working connection, because a quota failure looked like an outage.

    Hindi/Marathi disambiguation still happens, but inside the intent call that
    was being made anyway - see `parse`. Detection never costs a request of its
    own.

    Conservative by design: switching the interface out from under someone who
    did not ask is worse than staying put, so unsure returns None.
    """
    text = (text or "").strip()
    if len(text) < 8:
        return None

    by_script = languages.detect_script_language(text)
    if by_script and by_script != current:
        return by_script
    return None


def parse(text: str) -> dict[str, Any]:
    """Rules first, then Gemini, then a safe default."""
    if rule_hit := rule_parse(text):
        return rule_hit

    parsed = gemini_client.generate_json(
        f'The user said: "{text}"', system=_SYSTEM
    )

    if parsed and parsed.get("intent") in INTENTS:
        lang = parsed.get("lang")
        # Free of charge: this call was already being made for the intent.
        spoken = parsed.get("spoken_language")
        spoken = spoken if languages.is_supported(spoken) else None
        if parsed["intent"] == "SET_MODE":
            mode = parsed.get("mode")
            return {
                "intent": "SET_MODE",
                "mode": mode if mode in ("chat", "voice") else "chat",
                "lang": None,
                "query": None,
                "spoken_language": spoken,
                "source": "gemini",
            }
        return {
            "intent": parsed["intent"],
            "lang": lang if lang in SUPPORTED_LANGS else None,
            "query": parsed.get("query") or text,
            "spoken_language": spoken,
            "source": "gemini",
        }

    return {"intent": "GENERAL_CHAT", "lang": None, "query": text,
            "spoken_language": None, "source": "fallback"}
