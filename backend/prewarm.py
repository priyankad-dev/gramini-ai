"""Fill the translation cache before the demo, not during it.

Run this the night before, on wifi you trust:

    .venv\\Scripts\\python.exe prewarm.py            # the four headline languages
    .venv\\Scripts\\python.exe prewarm.py ta bn      # only these
    .venv\\Scripts\\python.exe prewarm.py --all      # every tier-2 language

Why it exists: free-tier Gemini quota is counted per model per day, and it is
small. A language translated live on stage is a language that can 429 on stage.
Once this has run, `data/translations/<code>.json` exists and the app answers in
that language with no network at all.

The UI strings are warmed separately, by the frontend, the first time a language
is used - they live in the frontend and it posts them to /api/ui-strings.
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

import languages  # noqa: E402
import main  # noqa: E402  - for the fixed phrases it owns
import schemes  # noqa: E402
import translate  # noqa: E402

logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")

# The languages worth having ready. Four, not twenty, because each one costs
# real quota and a demo shows two or three.
HEADLINE = ("ta", "bn", "te", "gu")


def fixed_phrases() -> dict[str, str]:
    """Every canned sentence the app can speak, in the pivot language."""
    return {
        "langConfirm": main._LANG_CONFIRM_NEUTRAL,
        "notFound": schemes._NOT_FOUND[languages.PIVOT_LANG],
        "offlineReply": main._OFFLINE_REPLY[languages.PIVOT_LANG],
        "visionFail": main._VISION_FAIL[languages.PIVOT_LANG],
        "cameraOpening": "कैमरा खोल रहा हूँ। जो दिखाना है, सामने रखिए।",
    }


def warm(code: str) -> bool:
    lang = languages.get(code)
    print(f"\n{lang.endonym}  ({lang.english}, {code})")

    phrases = fixed_phrases()
    got = translate.translate_map(phrases, code)
    ok = got != phrases
    print(f"  phrases      {'ok' if ok else 'FAILED'}")
    if ok:
        print(f"    confirm: {got['langConfirm'][:70]}")

    labels = translate.translate_map(
        schemes._SPEECH_LABELS, code, cache_prefix="speech."
    )
    print(f"  speech labels {'ok' if labels != schemes._SPEECH_LABELS else 'FAILED'}")

    # Success is measured on the descriptive fields, not on `name`. Scheme names
    # are proper nouns and may legitimately come back looking similar, so using
    # the name as the check reported failures that had not happened.
    done = 0
    for scheme in schemes.all_schemes():
        rendered = schemes.render(scheme, code)
        out = translate.translate_scheme(rendered, code)
        if any(
            out.get(field) and out.get(field) != rendered.get(field)
            for field in ("what_you_get", "who_can_apply", "how_to_apply")
        ):
            done += 1
    total = len(schemes.all_schemes())
    print(f"  schemes      {done}/{total} translated")

    return ok and done == total


def main_cli() -> int:
    args = [a for a in sys.argv[1:] if a != "--all"]
    if "--all" in sys.argv:
        codes = [c for c in languages.ALL_CODES if not languages.is_tier1(c)]
    elif args:
        codes = args
    else:
        codes = list(HEADLINE)

    unknown = [c for c in codes if not languages.is_supported(c)]
    if unknown:
        print(f"unknown language code(s): {', '.join(unknown)}")
        print(f"known: {', '.join(languages.ALL_CODES)}")
        return 2

    codes = [c for c in codes if not languages.is_tier1(c)]
    if not codes:
        print("Nothing to do - those languages are hand-written already.")
        return 0

    print(f"Warming {len(codes)} language(s) on {translate.TRANSLATE_MODEL}")
    failed = [code for code in codes if not warm(code)]

    print(f"\ncached on disk: {', '.join(translate.cached_languages()) or 'none'}")
    if failed:
        print(
            f"\nINCOMPLETE: {', '.join(failed)}.\n"
            "Usually quota. Wait a few minutes and run it again - it only fetches\n"
            "what is still missing, so re-running is cheap."
        )
        return 1
    print("\nAll done. These languages now work with no network.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main_cli())
