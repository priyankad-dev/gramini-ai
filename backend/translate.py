"""Runtime translation for tier-2 languages.

What this is allowed to do:
    take text a human already verified, and say the same thing in another
    language.

What it is not allowed to do:
    produce a scheme fact. It never sees a question. It never decides who is
    eligible for anything. It is handed finished, checked sentences and asked
    only to carry them across.

Everything is cached to disk under data/translations/<code>.json, so the second
demo of a language costs nothing and works if the venue wifi dies afterwards.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
from pathlib import Path
from typing import Any

import gemini_client
import languages

log = logging.getLogger("gramini.translate")

# Translation runs on a DIFFERENT model from chat and vision, on purpose.
# Free-tier quota is counted per model, so bulk-translating twenty languages on
# the demo's own model would burn the quota that the live demo needs. A lite
# model is also faster, and translating already-verified sentences is the one
# job where the smaller model loses nothing.
TRANSLATE_MODEL = os.getenv("GEMINI_TRANSLATE_MODEL", "gemini-3.5-flash-lite")

CACHE_DIR = Path(__file__).parent / "data" / "translations"
_lock = threading.Lock()
_memory: dict[str, dict[str, str]] = {}


def _cache_path(code: str) -> Path:
    return CACHE_DIR / f"{code}.json"


def _cache_key(prefix: str, key: str, source: str) -> str:
    """Cache key carries a fingerprint of the SOURCE text.

    Without this, editing an English or Hindi sentence leaves every language
    serving the old translation forever. That is not hypothetical: the first
    version of the language-switch confirmation said "I will speak Hindi", and
    fixing the source silently kept the wrong Tamil until this was added.
    """
    digest = hashlib.sha1(source.encode("utf-8")).hexdigest()[:8]
    return f"{prefix}{key}#{digest}"


def _load(code: str) -> dict[str, str]:
    if code in _memory:
        return _memory[code]
    path = _cache_path(code)
    data: dict[str, str] = {}
    if path.exists():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:  # pragma: no cover - corrupt cache is not fatal
            log.warning("bad translation cache for %s: %s", code, exc)
            data = {}
    _memory[code] = data
    return data


def _save(code: str) -> None:
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        _cache_path(code).write_text(
            json.dumps(_memory.get(code, {}), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    except Exception as exc:  # pragma: no cover - read-only disk is not fatal
        log.warning("could not write translation cache for %s: %s", code, exc)


_SYSTEM = (
    "You are a translator for a voice app used by rural Indian villagers, many "
    "of whom cannot read. Translate the given text into {target}.\n\n"
    "Rules:\n"
    "- Use the simplest everyday words a villager would use out loud. Short "
    "sentences. No officialese, no English loanwords where a common local word "
    "exists.\n"
    "- Keep every number, rupee amount, age, percentage and date EXACTLY as "
    "given. Never round, never convert, never drop one.\n"
    "- Keep website addresses and phone numbers EXACTLY as they are, in Latin "
    "script. Never translate or re-spell them.\n"
    "- Scheme names are proper nouns: do not replace them with different words, "
    "but DO write them in the target language's own script so the reader can "
    "sound them out. A name left in Devanagari is unreadable to someone who "
    "does not read Devanagari.\n"
    "- Do not add anything. Do not explain. Do not leave anything out.\n"
    "- Reply with ONE JSON object mapping each input key to its translation, "
    "and nothing else."
)


def translate_map(
    items: dict[str, str], target: str, *, cache_prefix: str = "", force: bool = False
) -> dict[str, str]:
    """Translate a batch of strings. Returns the input unchanged on failure.

    Falling back to the source language is deliberate: showing verified Hindi is
    honest, showing nothing is not.

    Tier-1 targets are skipped, because that text is already hand-written in the
    language asked for. `force=True` overrides that for the one case where we
    genuinely do want to translate INTO a tier-1 language: carrying a user's
    question into Hindi so it can be matched against the Hindi keyword lists.
    """
    target = languages.clean(target)
    if not items or (languages.is_tier1(target) and not force):
        return items

    with _lock:
        cache = _load(target)
        missing = {
            key: value
            for key, value in items.items()
            if value and _cache_key(cache_prefix, key, value) not in cache
        }

    if missing:
        payload = json.dumps(missing, ensure_ascii=False)
        result = gemini_client.generate_json(
            payload,
            system=_SYSTEM.format(target=languages.name_of(target)),
            model=TRANSLATE_MODEL,
        )
        if result:
            rejected = []
            with _lock:
                cache = _load(target)
                for key, source in missing.items():
                    value = result.get(key)
                    if not isinstance(value, str) or not value.strip():
                        continue
                    value = value.strip()
                    # Never cache an answer in the wrong script. Leaving the key
                    # uncached means the source text shows instead, and the next
                    # run gets another try - both better than a permanent lie
                    # about which language the user is reading.
                    if not languages.looks_like(value, target):
                        rejected.append(key)
                        continue
                    cache[_cache_key(cache_prefix, key, source)] = value
                _save(target)
            if rejected:
                log.warning(
                    "%s: dropped %d translation(s) in the wrong script: %s",
                    target, len(rejected), ", ".join(rejected[:6]),
                )
        else:
            log.warning("translation to %s failed; falling back to source", target)

    with _lock:
        cache = _load(target)
        return {
            key: cache.get(_cache_key(cache_prefix, key, value), value)
            for key, value in items.items()
        }


def translate_text(text: str, target: str, *, key: str, force: bool = False) -> str:
    """One string, cached under an explicit key."""
    if not text:
        return text
    return translate_map({key: text}, target, force=force).get(key, text)


def translate_scheme(rendered: dict[str, Any], target: str) -> dict[str, Any]:
    """Carry one already-verified scheme card into a tier-2 language.

    `official_link`, `helpline` and `id` are never touched - those are the parts
    a user acts on, and a translated phone number would be a disaster.
    """
    target = languages.clean(target)
    if languages.is_tier1(target):
        return rendered

    out = dict(rendered)
    prefix = f"scheme.{rendered.get('id')}."

    flat = {
        field: rendered.get(field) or ""
        for field in ("name", "what_you_get", "who_can_apply", "how_to_apply")
    }
    papers = rendered.get("papers_needed") or []
    for index, paper in enumerate(papers):
        flat[f"paper{index}"] = paper

    done = translate_map(flat, target, cache_prefix=prefix)

    for field in ("name", "what_you_get", "who_can_apply", "how_to_apply"):
        if done.get(field):
            out[field] = done[field]
    if papers:
        out["papers_needed"] = [
            done.get(f"paper{index}", paper) for index, paper in enumerate(papers)
        ]

    # The UI shows a badge from this. The user is told, not quietly served a
    # machine translation of something that decides whether they get money.
    out["machine_translated"] = True
    out["verified_language"] = languages.PIVOT_LANG
    return out


def cached_languages() -> list[str]:
    """Which tier-2 languages already have a cache on disk (so work offline)."""
    if not CACHE_DIR.exists():
        return []
    return sorted(path.stem for path in CACHE_DIR.glob("*.json"))
