"""Pre-generated speech, for when the browser cannot speak.

Why this exists:

`speechSynthesis` is a browser API and works offline - but only with LOCAL
voices. Every Indian-language voice Chrome offers on a stock Windows machine is
one of Google's REMOTE voices (`localService: false`), fetched over the network
each time. So with no internet the browser has a Hindi voice listed and cannot
actually use it, and the app goes silent exactly when PS07 says it must not.

The answer is to record the sentences we know we will need, while the network is
up, and play the files back when it is not. Gemini's TTS models produce the
audio; it is written as WAV under audio_cache/ and served as a static file.

Two rules, both load-bearing:

  * Only text the app ALREADY generates is recorded. This is a cache of our own
    verified sentences, never a place where new wording appears.
  * A cache miss is not an error. The caller falls back to the browser, and
    then to text on screen.
"""

from __future__ import annotations

import hashlib
import io
import json
import logging
import re
import struct
import threading
import time
import traceback
import wave
from pathlib import Path
from typing import Any

import gemini_client
import languages

log = logging.getLogger("gramini.audio")

CACHE_DIR = Path(__file__).parent / "audio_cache"
INDEX_FILE = CACHE_DIR / "index.json"

TTS_MODEL = "gemini-2.5-flash-preview-tts"

# Free-tier quota is counted PER MODEL per day, and recording a language needs
# ~18 calls - more than one model allows. Rotating across every TTS model
# multiplies the budget, exactly as gemini_client does for chat.
TTS_MODELS = (
    "gemini-2.5-flash-preview-tts",
    "gemini-3.1-flash-tts-preview",
    "gemini-2.5-pro-preview-tts",
)

# Models seen to be out of quota, and when. Retried after a cool-off rather than
# hammered, so a spent model does not slow every later request.
_exhausted: dict[str, float] = {}
EXHAUSTED_RETRY_AFTER = 600.0

# Gemini's prebuilt voices. Picked once per language so a cached clip and a live
# clip in the same language sound like the same speaker.
VOICE_FOR_LANG = {
    "hi": "Kore",
    "en": "Puck",
    "mr": "Kore",
}
DEFAULT_VOICE = "Kore"

_lock = threading.Lock()
_index: dict[str, Any] | None = None


def _load_index() -> dict[str, Any]:
    global _index
    if _index is not None:
        return _index
    if INDEX_FILE.exists():
        try:
            _index = json.loads(INDEX_FILE.read_text(encoding="utf-8"))
        except Exception as exc:
            log.warning("audio cache index unreadable, starting fresh: %s", exc)
            _index = {}
    else:
        _index = {}
    return _index


def _save_index() -> None:
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        INDEX_FILE.write_text(
            json.dumps(_index or {}, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    except Exception as exc:
        log.warning("could not write audio cache index: %s", exc)


def key_for(text: str, lang: str) -> str:
    """Stable id for a sentence in a language.

    Normalised first so trailing punctuation or doubled spaces do not produce a
    second recording of the same sentence.
    """
    norm = re.sub(r"\s+", " ", (text or "").strip())
    digest = hashlib.sha1(f"{lang}|{norm}".encode("utf-8")).hexdigest()[:16]
    return f"{lang}-{digest}"


def _pcm_to_wav(pcm: bytes, rate: int = 24000, channels: int = 1, width: int = 2) -> bytes:
    """Gemini returns headerless PCM; browsers need a RIFF header."""
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(channels)
        handle.setsampwidth(width)
        handle.setframerate(rate)
        handle.writeframes(pcm)
    return buffer.getvalue()


def _rate_from_mime(mime: str) -> int:
    match = re.search(r"rate=(\d+)", mime or "")
    return int(match.group(1)) if match else 24000


def has(text: str, lang: str) -> str | None:
    """Return the cached filename for this sentence, or None."""
    key = key_for(text, lang)
    with _lock:
        entry = _load_index().get(key)
    if not entry:
        return None
    path = CACHE_DIR / entry["file"]
    return entry["file"] if path.exists() else None


def generate(text: str, lang: str, label: str = "") -> str | None:
    """Record one sentence. Needs network. Returns the filename, or None.

    Never raises: a failure here only means the browser will have to speak it.
    """
    if not text or not text.strip():
        return None

    existing = has(text, lang)
    if existing:
        return existing

    if not gemini_client.available():
        return None

    key = key_for(text, lang)
    voice = VOICE_FOR_LANG.get(lang, DEFAULT_VOICE)

    pcm = None
    rate = 24000
    try:
        from google.genai import types as genai_types

        config = genai_types.GenerateContentConfig(
            response_modalities=["AUDIO"],
            speech_config=genai_types.SpeechConfig(
                voice_config=genai_types.VoiceConfig(
                    prebuilt_voice_config=genai_types.PrebuiltVoiceConfig(
                        voice_name=voice
                    )
                )
            ),
        )

        # Every model, every key, skipping models known to be spent.
        usable = [
            m for m in TTS_MODELS
            if time.time() - _exhausted.get(m, 0) > EXHAUSTED_RETRY_AFTER
        ] or list(TTS_MODELS)

        for model in usable:
            if pcm:
                break
            quota_on_every_key = True
            for label_, client in gemini_client._clients:  # noqa: SLF001 - same package
                try:
                    response = client.models.generate_content(
                        model=model, contents=text, config=config
                    )
                    part = response.candidates[0].content.parts[0]
                    pcm = part.inline_data.data
                    rate = _rate_from_mime(getattr(part.inline_data, "mime_type", ""))
                    quota_on_every_key = False
                    break
                except Exception as exc:
                    reason, status = gemini_client._classify(exc)  # noqa: SLF001
                    if reason != "quota":
                        quota_on_every_key = False
                    log.debug(
                        "TTS failed model=%s key=%s (%s%s)", model, label_, reason,
                        f" HTTP {status}" if status else "",
                    )
            if quota_on_every_key and not pcm:
                _exhausted[model] = time.time()
                log.info("TTS model %s is out of quota - trying the next one", model)
    except Exception as exc:
        log.warning("TTS unavailable: %s", exc)
        log.debug("traceback:\n%s", traceback.format_exc())
        return None

    if not pcm:
        log.warning("no TTS model could record %r (all quota spent)", label or text[:30])
        return None

    filename = f"{key}.wav"
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        (CACHE_DIR / filename).write_bytes(_pcm_to_wav(pcm, rate=rate))
    except Exception as exc:
        log.warning("could not write audio file: %s", exc)
        return None

    with _lock:
        index = _load_index()
        index[key] = {
            "file": filename,
            "lang": lang,
            "label": label or text[:60],
            "chars": len(text),
        }
        _save_index()

    log.info("cached audio: %s (%s, %d chars)", label or text[:40], lang, len(text))
    return filename


def summary() -> dict[str, Any]:
    """For /api/health - how much speech survives an outage."""
    with _lock:
        index = _load_index()
    by_lang: dict[str, int] = {}
    for entry in index.values():
        by_lang[entry.get("lang", "?")] = by_lang.get(entry.get("lang", "?"), 0) + 1
    return {"clips": len(index), "by_language": by_lang}


def manifest() -> dict[str, str]:
    """key -> filename, for the frontend to keep so it can look up offline."""
    with _lock:
        index = _load_index()
    return {key: entry["file"] for key, entry in index.items()}
