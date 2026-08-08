"""Record the sentences the app will need, before the network is gone.

    .venv\\Scripts\\python.exe prewarm_audio.py            # hi, en, mr
    .venv\\Scripts\\python.exe prewarm_audio.py hi         # one language
    .venv\\Scripts\\python.exe prewarm_audio.py --schemes  # also every scheme answer

Why: `speechSynthesis` works offline, but only with LOCAL voices, and every
Indian-language voice Chrome offers on a stock machine is one of Google's REMOTE
voices. With no network the browser lists a Hindi voice and cannot use it, so the
app goes silent - which is precisely the situation PS07 asks it to survive.

Everything recorded here is text the app already produces. Nothing new is
written, and no scheme fact is generated: the WAV is a recording of a sentence
that schemes.py assembled from the verified JSON.
"""

from __future__ import annotations

import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

import audio_cache  # noqa: E402
import languages  # noqa: E402
import main as app_main  # noqa: E402  - for the fixed phrases it owns
import schemes  # noqa: E402


def common_phrases(lang: str) -> list[tuple[str, str]]:
    """(label, text) for everything the app says without being asked."""
    out: list[tuple[str, str]] = []

    def add(label: str, bundle: dict) -> None:
        text = bundle.get(lang)
        if text:
            out.append((label, text))

    add("greeting", {
        "hi": "रामराम भाईजी! मैं ग्रामिणी हूँ। बताइए, मैं आपकी क्या मदद करूँ?",
        "en": "Namaste! I am Gramini. Tell me, how can I help you?",
        "mr": "रामराम दादा! मी ग्रामिणी आहे. सांगा, मी तुमची काय मदत करू?",
    })
    add("lang-confirm", app_main._LANG_CONFIRM)
    add("offline-reply", app_main._OFFLINE_REPLY)
    add("ai-busy", app_main._AI_BUSY_REPLY)
    add("vision-fail", app_main._VISION_FAIL)
    add("not-found", schemes._NOT_FOUND)
    add("camera-open", {
        "hi": "कैमरा खोल रहा हूँ। जो दिखाना है, सामने रखिए।",
        "en": "Opening the camera. Hold up what you want to show me.",
        "mr": "कॅमेरा उघडत आहे. जे दाखवायचे आहे ते समोर धरा.",
    })
    add("weather-fail", {
        "hi": "अभी मौसम की जानकारी नहीं मिल पा रही। इंटरनेट आने पर दोबारा पूछिए।",
        "en": "I cannot get the weather right now. Please ask again when the internet is back.",
        "mr": "सध्या हवामानाची माहिती मिळत नाही. इंटरनेट आल्यावर पुन्हा विचारा.",
    })
    add("help", {
        "hi": "आप मुझसे सरकारी योजना, मौसम, सेहत और अपने हक़ के बारे में पूछ सकते हैं। "
              "बस बोलिए, जैसे 'किसान की योजना बताओ' या 'आज मौसम कैसा रहेगा'।",
        "en": "You can ask me about government schemes, the weather, health and your "
              "rights. Just speak, for example 'tell me about farmer schemes' or "
              "'what is the weather today'.",
        "mr": "तुम्ही मला सरकारी योजना, हवामान, आरोग्य आणि तुमच्या हक्कांबद्दल विचारू शकता. "
              "फक्त बोला, जसे 'शेतकऱ्यांची योजना सांगा' किंवा 'आजचे हवामान कसे आहे'.",
    })
    add("weather-offline", {
        "hi": "यह जानकारी थोड़ी पुरानी है, क्योंकि अभी इंटरनेट नहीं है।",
        "en": "This information is a little old, because there is no internet right now.",
        "mr": "ही माहिती थोडी जुनी आहे, कारण सध्या इंटरनेट नाही.",
    })
    return out


def scheme_phrases(lang: str) -> list[tuple[str, str]]:
    """One recording per scheme - the exact sentence the app would speak."""
    out = []
    for scheme in schemes.all_schemes():
        rendered = schemes.render(scheme, lang)
        out.append((f"scheme:{scheme['id']}", schemes.speech_text(rendered, lang)))
    return out


def warm(lang: str, include_schemes: bool) -> tuple[int, int]:
    items = common_phrases(lang)
    if include_schemes:
        items += scheme_phrases(lang)

    print(f"\n{languages.get(lang).endonym}  ({lang}) - {len(items)} phrase(s)")
    made = skipped = 0
    for label, text in items:
        if audio_cache.has(text, lang):
            skipped += 1
            print(f"  · {label:24s} already cached")
            continue
        filename = audio_cache.generate(text, lang, label=label)
        if filename:
            made += 1
            print(f"  ✓ {label:24s} {filename}")
        else:
            print(f"  ✗ {label:24s} FAILED (quota or network)")
    return made, skipped


def main_cli() -> int:
    include_schemes = "--schemes" in sys.argv
    codes = [a for a in sys.argv[1:] if not a.startswith("-")] or ["hi", "en", "mr"]

    unknown = [c for c in codes if not languages.is_supported(c)]
    if unknown:
        print(f"unknown language code(s): {', '.join(unknown)}")
        return 2

    print(f"Recording on {audio_cache.TTS_MODEL}")
    if include_schemes:
        print("Including every scheme answer - this uses a lot of quota.")

    total_made = 0
    for code in codes:
        made, _ = warm(code, include_schemes)
        total_made += made

    stats = audio_cache.summary()
    print(f"\ncache: {stats['clips']} clip(s) {stats['by_language']}")
    print(f"new this run: {total_made}")
    if total_made == 0 and stats["clips"] == 0:
        print(
            "\nNothing was recorded. Usually quota - TTS has its own daily limit.\n"
            "Re-running is cheap: it only records what is still missing."
        )
        return 1
    print("\nThese sentences will now speak with no network at all.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main_cli())
