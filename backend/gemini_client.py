"""Gemini access layer.

Everything that talks to the model goes through here, so this is the one place
that has to be honest about failure. Three properties matter more than features:

1. It degrades instead of crashing. No key, no network, spent quota - every call
   returns None and the app falls back to its verified local data. The demo never
   shows a white screen.
2. It says WHY it failed. "No internet" and "quota spent" look identical to a
   user and need opposite responses, so the reason is classified and surfaced.
3. It never hides an exception. Full tracebacks go to the log at debug level;
   callers get a clean None plus a machine-readable reason.

Configuration is read once at import, validated, and reported at startup.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import random
import re
import time
import traceback
import uuid
from typing import Any

log = logging.getLogger("gramini.gemini")

# --------------------------------------------------------------------- version

try:
    import google.genai as _genai_pkg

    SDK_VERSION: str = getattr(_genai_pkg, "__version__", "unknown")
except Exception:  # pragma: no cover - SDK missing entirely
    SDK_VERSION = "not installed"

# ----------------------------------------------------------------------- config

# Prefer an EXPLICIT model name over a "-latest" alias.
#
# Free-tier quota is counted per underlying model per day. An alias hides which
# model that is: asking for `gemini-flash-latest` produced a 429 naming
# `gemini-3.6-flash`, so the quota being spent belonged to a model nobody had
# configured. With an explicit name, the model in .env is the model in the error.
MODEL = os.getenv("GEMINI_MODEL", "gemini-3.5-flash")

# Tried in order when the configured model turns out to be invalid. Google
# retires model names without warning - `gemini-2.5-flash` returned 404
# "no longer available to new users" mid-project - so a wrong name must degrade
# to a working one rather than take the whole app down.
# Ordered by capability, and deliberately long. Each entry is a separate 20/day
# bucket, so a five-deep chain is a hundred requests before the app has to say
# no - which is the difference between surviving a demo and not.
MODEL_FALLBACKS: tuple[str, ...] = (
    "gemini-3.5-flash",
    "gemini-3.1-flash-lite",
    "gemini-3.5-flash-lite",
    "gemini-3-flash-preview",
    "gemini-flash-latest",
    "gemini-flash-lite-latest",
)

# Retry only failures that a retry can actually fix.
MAX_ATTEMPTS = int(os.getenv("GEMINI_MAX_ATTEMPTS", "3"))
BACKOFF_BASE = 0.6      # seconds
BACKOFF_CAP = 8.0

RETRYABLE = {"busy", "network", "dns", "timeout", "ssl", "server"}

# Largest decoded camera frame accepted for vision.
MAX_IMAGE_BYTES = 8 * 1024 * 1024


def _mask(key: str | None) -> str:
    """Show enough of a key to identify it, never enough to use it."""
    if not key:
        return "<missing>"
    if len(key) <= 12:
        return f"{key[:2]}…{key[-2:]} ({len(key)} chars)"
    return f"{key[:6]}…{key[-4:]} ({len(key)} chars)"


_RAW_KEYS: list[tuple[str, str]] = []
for _label, _env in (("primary", "GEMINI_API_KEY"), ("backup", "GEMINI_API_KEY_BACKUP")):
    _value = os.getenv(_env)
    if _value:
        # A trailing space or a quote pasted in from a terminal makes a key look
        # present while failing every request with a confusing 400.
        _value = _value.strip().strip("\"'")
    if _value:
        _RAW_KEYS.append((_label, _value))

_clients: list[tuple[str, Any]] = []
_import_error: str | None = None
_config_error: str | None = None

try:
    from google import genai
    from google.genai import errors as genai_errors
    from google.genai import types as genai_types

    for _label, _key in _RAW_KEYS:
        try:
            _clients.append((_label, genai.Client(api_key=_key)))
        except Exception as exc:  # pragma: no cover - depends on env
            log.error("could not build Gemini client for %s key: %s", _label, exc)
            log.debug("%s", traceback.format_exc())
except Exception as exc:  # pragma: no cover - SDK not installed
    genai = None            # type: ignore[assignment]
    genai_types = None      # type: ignore[assignment]
    genai_errors = None     # type: ignore[assignment]
    _import_error = f"{type(exc).__name__}: {exc}"
    log.error("google-genai could not be imported: %s", _import_error)

if not _RAW_KEYS:
    _config_error = (
        "No GEMINI_API_KEY found. Copy backend/.env.example to backend/.env and "
        "paste a key from https://aistudio.google.com/apikey. Scheme answers, "
        "weather and the language switch still work without it; free chat and "
        "the camera do not."
    )
    log.error("CONFIG: %s", _config_error)


# ------------------------------------------------------------- failure tracking

_last_failure: str | None = None      # short reason code
_last_error_detail: str | None = None  # one-line human detail
_last_http_status: int | None = None
_last_failed_at: float | None = None
_last_text_length: int | None = None

# Whether Google Search grounding works on this key. None = not yet probed.
_search_supported: bool | None = None

# Set once a model name has been proven to work, so a bad GEMINI_MODEL is
# corrected once rather than on every request.
_resolved_model: str | None = None

# Models known to be out of quota, and when we found out.
#
# Free-tier quota is 20 requests per model per day and BOTH keys draw on the
# same per-project pool, so a second key buys nothing once a model is spent.
# What does help is a different model, since the limit is counted per model.
# Rather than make someone edit .env mid-demo, an exhausted model is remembered
# here and the next one is used automatically.
_exhausted_models: dict[str, float] = {}

# How long before an exhausted model is worth trying again. The daily quota
# resets at midnight Pacific, but per-minute limits clear in under a minute, and
# the 429 body often carries a retryDelay of ~30s. Ten minutes is long enough to
# avoid pointless retries and short enough to pick a model back up mid-event.
EXHAUSTED_RETRY_AFTER = float(os.getenv("GEMINI_EXHAUSTED_RETRY_S", "600"))


def last_failure() -> str | None:
    return _last_failure


def _record_failure(reason: str, detail: str, status: int | None) -> None:
    global _last_failure, _last_error_detail, _last_http_status, _last_failed_at
    _last_failure = reason
    _last_error_detail = detail
    _last_http_status = status
    _last_failed_at = time.time()


def _clear_failure() -> None:
    global _last_failure, _last_error_detail, _last_http_status
    _last_failure = None
    _last_error_detail = None
    _last_http_status = None


def _http_status(exc: Exception) -> int | None:
    """Pull the HTTP status out of an SDK error, whatever shape it arrives in."""
    for attr in ("code", "status_code"):
        value = getattr(exc, attr, None)
        if isinstance(value, int):
            return value
    match = re.search(r"\b(4\d\d|5\d\d)\b", str(exc))
    return int(match.group(1)) if match else None


def _classify(exc: Exception) -> tuple[str, int | None]:
    """Turn any exception into (reason, http_status).

    The reason drives both the retry decision and the sentence the user hears,
    so the categories are the ones that need different handling - not the ones
    the SDK happens to raise.
    """
    status = _http_status(exc)
    name = type(exc).__name__
    text = str(exc).lower()

    # Transport problems first: these never carry an HTTP status, and they are
    # the ones worth retrying.
    if "getaddrinfo" in text or "name or service not known" in text or "nodename" in text:
        return "dns", None
    if "ssl" in text or "certificate" in text or "tlsv1" in name.lower():
        return "ssl", None
    if "timeout" in text or "timed out" in text or "deadline" in text:
        return "timeout", None
    if (
        "connect" in text
        or "connection" in text
        or "unreachable" in text
        or "reset by peer" in text
    ):
        return "network", None

    if status == 400:
        # Usually a malformed key or a bad request body.
        if "api key" in text or "api_key" in text:
            return "bad_key", 400
        return "bad_request", 400
    if status == 401 or "unauthenticated" in text:
        return "bad_key", status or 401
    if status == 403 or "permission_denied" in text or "permission denied" in text:
        return "forbidden", status or 403
    if status == 404 or "not_found" in text or "is not found" in text:
        return "bad_model", status or 404
    if status == 429 or "resource_exhausted" in text or "quota" in text:
        return "quota", status or 429
    if status is not None and 500 <= status < 600:
        return "busy" if status == 503 else "server", status
    if "unavailable" in text or "overloaded" in text:
        return "busy", status or 503

    return "other", status


def available() -> bool:
    return bool(_clients)


def _sleep_for(attempt: int) -> float:
    """Exponential backoff with jitter, capped."""
    delay = min(BACKOFF_CAP, BACKOFF_BASE * (2 ** attempt))
    return delay * (0.5 + random.random() * 0.5)


def _is_exhausted(model: str) -> bool:
    """Has this model 429'd recently enough that trying again is a waste?"""
    marked = _exhausted_models.get(model)
    if marked is None:
        return False
    if time.time() - marked > EXHAUSTED_RETRY_AFTER:
        # Cooled off - let it be tried again.
        _exhausted_models.pop(model, None)
        return False
    return True


def _model_chain(preferred: str) -> list[str]:
    """Models to try, in order, skipping ones known to be out of quota.

    The preferred model always comes first. If everything is marked exhausted the
    preferred one is still returned, because a stale mark should never leave the
    app with nothing to call.
    """
    chain: list[str] = []
    for candidate in (preferred, *MODEL_FALLBACKS):
        if candidate not in chain:
            chain.append(candidate)

    usable = [m for m in chain if not _is_exhausted(m)]
    return usable or [preferred]


# --------------------------------------------------------------------- requests


PARSER_VERSION = "2"  # bump when the extraction rules below change


def extract_text(response: Any) -> str:
    """Get the answer out of a response, whatever shape it arrives in.

    `response.text` is a convenience accessor that works for the common case,
    but it is not guaranteed:

      * it is None when the candidate was blocked (finish_reason SAFETY or
        RECITATION), because there are no parts to join;
      * on thinking models the parts list can contain reasoning parts marked
        `thought=True`, which must NOT be shown to the user;
      * a response can carry several text parts that need joining.

    So `.text` is tried first and the candidate tree is walked as a fallback.
    Thought parts are always skipped - showing the model's private reasoning to
    a villager asking about a pension would be worse than saying nothing.
    """
    direct = getattr(response, "text", None)
    if isinstance(direct, str) and direct.strip():
        return direct.strip()

    collected: list[str] = []
    for candidate in (getattr(response, "candidates", None) or []):
        content = getattr(candidate, "content", None)
        for part in (getattr(content, "parts", None) or []):
            if getattr(part, "thought", None):
                continue  # internal reasoning, not an answer
            piece = getattr(part, "text", None)
            if isinstance(piece, str) and piece.strip():
                collected.append(piece.strip())
        if collected:
            break  # first candidate only

    return "\n".join(collected).strip()


def _response_debug(response: Any) -> dict[str, Any]:
    """Everything worth logging about a response, defensively read."""
    info: dict[str, Any] = {}
    try:
        candidates = getattr(response, "candidates", None) or []
        info["candidate_count"] = len(candidates)
        if candidates:
            first = candidates[0]
            info["finish_reason"] = str(getattr(first, "finish_reason", None))
            ratings = getattr(first, "safety_ratings", None)
            if ratings:
                info["safety_ratings"] = [
                    f"{getattr(r, 'category', '?')}={getattr(r, 'probability', '?')}"
                    for r in ratings
                ]
            content = getattr(first, "content", None)
            parts = getattr(content, "parts", None) or []
            info["part_count"] = len(parts)
            info["thought_parts"] = sum(1 for p in parts if getattr(p, "thought", None))
        feedback = getattr(response, "prompt_feedback", None)
        if feedback:
            info["prompt_feedback"] = str(feedback)
        usage = getattr(response, "usage_metadata", None)
        if usage:
            info["tokens_out"] = getattr(usage, "candidates_token_count", None)
            info["tokens_thoughts"] = getattr(usage, "thoughts_token_count", None)
    except Exception as exc:  # pragma: no cover - purely diagnostic
        info["debug_error"] = f"{type(exc).__name__}: {exc}"
    return info


def _call_once(
    client: Any,
    model: str,
    contents: Any,
    config: Any,
    request_id: str,
    key_label: str,
    grounded: bool = False,
) -> tuple[str | None, str | None, int | None]:
    """One attempt. Returns (text, failure_reason, http_status)."""
    started = time.time()
    try:
        response = client.models.generate_content(
            model=model, contents=contents, config=config
        )
    except Exception as exc:
        reason, status = _classify(exc)
        log.warning(
            "[%s] key=%s model=%s grounded=%s FAILED reason=%s status=%s in %.2fs\n"
            "        %s: %s",
            request_id, key_label, model, grounded, reason, status,
            time.time() - started, type(exc).__name__, str(exc)[:300],
        )
        # The full traceback is kept, never discarded - it just does not spam the
        # console at warning level.
        log.debug("[%s] traceback:\n%s", request_id, traceback.format_exc())
        return None, reason, status

    text = extract_text(response)
    elapsed = time.time() - started

    if not text:
        # A 200 with no usable text is a safety block, a recitation block, or a
        # response that spent its whole budget on thinking. None of those are
        # transport failures, so retrying the identical prompt cannot help.
        debug = _response_debug(response)
        log.warning(
            "[%s] key=%s model=%s returned 200 with NO TEXT in %.2fs: %s",
            request_id, key_label, model, elapsed, debug,
        )
        log.debug("[%s] full response:\n%s", request_id, response)
        return None, "empty", 200

    global _last_text_length
    _last_text_length = len(text)
    log.info(
        "[%s] key=%s model=%s grounded=%s OK %d chars in %.2fs%s",
        request_id, key_label, model, grounded, len(text), elapsed,
        "" if log.level > logging.DEBUG else f" {_response_debug(response)}",
    )
    return text, None, 200


def _generate(
    contents: Any,
    system: str | None = None,
    model: str | None = None,
    search: bool = False,
) -> str | None:
    """Generate text, retrying transient failures and rotating keys.

    Order of escalation, which matters:
      1. Retry the SAME key with exponential backoff, for failures a retry can
         fix (network, DNS, timeout, 503). Switching keys on a network blip just
         burns the second key's quota on a request that was never going to land.
      2. Move to the next key for failures that are specific to a key
         (quota, auth).
      3. Give up, record why, return None.
    """
    if not _clients:
        if _config_error:
            _record_failure("no_key", _config_error, None)
        elif _import_error:
            _record_failure("no_sdk", _import_error, None)
        return None

    global _resolved_model

    preferred = model or _resolved_model or MODEL
    request_id = uuid.uuid4().hex[:8]

    config = None
    if genai_types is not None and (system or search):
        kwargs: dict[str, Any] = {}
        if system:
            kwargs["system_instruction"] = system
        if search:
            kwargs["tools"] = [
                genai_types.Tool(google_search=genai_types.GoogleSearch())
            ]
        try:
            config = genai_types.GenerateContentConfig(**kwargs)
        except Exception as exc:
            log.error("[%s] could not build request config: %s", request_id, exc)
            log.debug("[%s] traceback:\n%s", request_id, traceback.format_exc())
            _record_failure("bad_request", f"{type(exc).__name__}: {exc}", None)
            return None

    chain = _model_chain(preferred)
    log.info(
        "[%s] request model=%s search=%s keys=%d%s",
        request_id, chain[0], search, len(_clients),
        f" (falling back from {preferred})" if chain[0] != preferred else "",
    )

    last_reason: str | None = None
    last_status: int | None = None

    for model_index, target_model in enumerate(chain):
        model_reasons: list[str] = []

        for key_label, client in _clients:
            for attempt in range(MAX_ATTEMPTS):
                text, reason, status = _call_once(
                    client, target_model, contents, config, request_id,
                    key_label, grounded=search,
                )
                if text:
                    _clear_failure()
                    # Remember a model that works, so the next request starts
                    # here instead of paying the failed calls again.
                    if not model and target_model != _resolved_model:
                        if model_index:
                            log.warning(
                                "[%s] switched to %s and it worked. Using it from "
                                "now on; %s will be retried in %.0f minutes.",
                                request_id, target_model, preferred,
                                EXHAUSTED_RETRY_AFTER / 60,
                            )
                        _resolved_model = target_model
                    return text

                last_reason, last_status = reason, status
                model_reasons.append(reason or "other")

                if reason in RETRYABLE and attempt < MAX_ATTEMPTS - 1:
                    delay = _sleep_for(attempt)
                    log.info(
                        "[%s] retrying in %.1fs (attempt %d/%d, reason=%s)",
                        request_id, delay, attempt + 2, MAX_ATTEMPTS, reason,
                    )
                    time.sleep(delay)
                    continue
                # Not retryable, or attempts exhausted: try the next key.
                break

        # Every key failed on this model. If that was quota or a dead model
        # name, another MODEL may still work - both limits are per model.
        if all(r in ("quota", "bad_model") for r in model_reasons) and model_reasons:
            # BUT: a grounded request has its own, much smaller quota. Marking
            # the model exhausted because SEARCH was refused would walk the app
            # away from a model whose ordinary generation is perfectly fine -
            # and since grounding is refused on every free key, that would
            # exhaust the entire fallback chain on the first chat message.
            if not search:
                _exhausted_models[target_model] = time.time()
            else:
                log.debug(
                    "[%s] %s refused GROUNDED request (%s); not marking the model "
                    "exhausted - plain generation is unaffected",
                    request_id, target_model, model_reasons[0],
                )
                break
            if model_index + 1 < len(chain):
                log.warning(
                    "[%s] %s is out of quota on every key - trying %s instead",
                    request_id, target_model, chain[model_index + 1],
                )
                continue

        # Anything else (auth, network, safety) will fail the same way on every
        # model, so there is nothing to gain by working through the list.
        break

    detail = f"{last_reason} (HTTP {last_status})" if last_status else str(last_reason)
    log.error(
        "[%s] no model answered. last=%s tried=%s",
        request_id, detail, ", ".join(chain),
    )
    _record_failure(last_reason or "other", detail, last_status)
    return None


# ----------------------------------------------------------------- public calls


def generate_text(
    prompt: str, system: str | None = None, model: str | None = None
) -> str | None:
    return _generate(prompt, system=system, model=model)


def generate_grounded(
    prompt: str, system: str | None = None, model: str | None = None
) -> tuple[str | None, bool]:
    """Answer using live web search where that is permitted.

    Returns (text, was_grounded). Grounding is a billed feature; on a free key it
    returns 429 for every request. Rather than pay that failure on every single
    question, support is probed once and remembered, and thereafter the search
    tool is simply not attached.
    """
    global _search_supported

    if _search_supported is not False:
        grounded = _generate(prompt, system=system, model=model, search=True)
        if grounded:
            if _search_supported is None:
                log.info("Google Search grounding is available on this key")
            _search_supported = True
            return grounded, True

        # Distinguish "grounding is not allowed" from "this one request failed".
        if _last_failure in ("quota", "forbidden", "bad_request", "bad_model"):
            if _search_supported is None:
                log.warning(
                    "Google Search grounding unavailable (%s) - it needs a billed "
                    "account. Answering from model knowledge instead; live facts "
                    "such as weather come from their own APIs.",
                    _last_failure,
                )
            _search_supported = False

    plain = _generate(prompt, system=system, model=model)
    return plain, False


def generate_json(
    prompt: str, system: str | None = None, model: str | None = None
) -> dict[str, Any] | None:
    """Ask for JSON and survive the model wrapping it in a markdown fence."""
    raw = _generate(prompt, system=system, model=model)
    if not raw:
        return None

    cleaned = re.sub(r"^```(?:json)?|```$", "", raw.strip(), flags=re.MULTILINE).strip()
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", cleaned, flags=re.DOTALL)
        if not match:
            log.warning("model did not return JSON: %r", raw[:200])
            return None
        try:
            parsed = json.loads(match.group(0))
        except json.JSONDecodeError:
            log.warning("model returned broken JSON: %r", raw[:200])
            return None

    return parsed if isinstance(parsed, dict) else None


def describe_image(
    image_data_url: str, prompt: str, system: str | None = None
) -> str | None:
    """Send one captured camera frame to Gemini.

    The frame arrives as `data:image/jpeg;base64,<payload>`. The prefix is
    stripped and the decoded bytes go to the model as an inline image part - not
    as text - with the MIME type taken from the prefix.
    """
    if not _clients:
        if _config_error:
            _record_failure("no_key", _config_error, None)
        elif _import_error:
            _record_failure("no_sdk", _import_error, None)
        return None
    if genai_types is None:
        return None

    header, _, payload = (image_data_url or "").partition(",")
    # A zero-sized canvas encodes as "data:," - a capture taken before the video
    # had a frame. Reject it here rather than spend a model call on nothing.
    match = re.match(r"data:(image/[\w.+-]+);base64$", header.strip())
    if not match or not payload.strip():
        log.warning("image is not a base64 image data URL (header=%r)", header[:40])
        _record_failure("bad_image", "not a base64 image data URL", None)
        return None
    mime = match.group(1)

    try:
        image_bytes = base64.b64decode(re.sub(r"\s+", "", payload), validate=True)
    except Exception as exc:
        log.warning("bad image payload: %s", exc)
        log.debug("traceback:\n%s", traceback.format_exc())
        _record_failure("bad_image", f"undecodable base64: {exc}", None)
        return None

    # Gemini caps a whole inline request at 20 MB. The camera downscales to
    # ~150 KB, so anything near the cap is not a camera frame.
    if not image_bytes or len(image_bytes) > MAX_IMAGE_BYTES:
        log.warning("image size %d bytes is outside 1..%d", len(image_bytes), MAX_IMAGE_BYTES)
        _record_failure("bad_image", f"image is {len(image_bytes)} bytes", None)
        return None

    log.info("vision: sending %s image, %d KB", mime, len(image_bytes) // 1024)
    part = genai_types.Part.from_bytes(data=image_bytes, mime_type=mime)
    return _generate([prompt, part], system=system)


# -------------------------------------------------------------- startup checks


def validate_model() -> tuple[str, bool]:
    """Confirm the configured model exists, falling back if it does not.

    Returns (model_in_use, was_changed). Never raises: an unreachable network at
    startup must not stop the server, because everything that does not need
    Gemini still works.
    """
    global _resolved_model

    if not _clients:
        _resolved_model = MODEL
        return MODEL, False

    _, client = _clients[0]
    try:
        listed = {
            m.name.replace("models/", "")
            for m in client.models.list()
            if "generateContent" in (getattr(m, "supported_actions", None) or ["generateContent"])
        }
    except Exception as exc:
        reason, status = _classify(exc)
        log.warning(
            "could not list models (%s%s) - trusting GEMINI_MODEL=%s as configured",
            reason, f" HTTP {status}" if status else "", MODEL,
        )
        log.debug("traceback:\n%s", traceback.format_exc())
        _resolved_model = MODEL
        return MODEL, False

    if MODEL in listed:
        _resolved_model = MODEL
        return MODEL, False

    for candidate in MODEL_FALLBACKS:
        if candidate in listed:
            log.error(
                "GEMINI_MODEL=%r is not available to this key. Falling back to %r. "
                "Update backend/.env to silence this.",
                MODEL, candidate,
            )
            _resolved_model = candidate
            return candidate, True

    log.error(
        "GEMINI_MODEL=%r is not available and no fallback matched. "
        "Available to this key: %s", MODEL, ", ".join(sorted(listed)[:8]),
    )
    _resolved_model = MODEL
    return MODEL, False


def startup_check() -> dict[str, Any]:
    """Prove at boot that a real request works, and say so in the log.

    Called once from main.py. Everything here is diagnostic: it never raises, and
    a failure only means the AI-dependent features are degraded.
    """
    log.info("─" * 62)
    log.info("Gemini configuration")
    log.info("  google-genai SDK : %s", SDK_VERSION)
    for label, key in _RAW_KEYS:
        log.info("  %-16s : %s", f"{label} key", _mask(key))
    if not _RAW_KEYS:
        log.error("  API keys         : NONE FOUND")
        log.error("  %s", _config_error)
        log.info("─" * 62)
        return {"ok": False, "reason": "no_key", "detail": _config_error}
    if _import_error:
        log.error("  SDK import       : FAILED - %s", _import_error)
        log.info("─" * 62)
        return {"ok": False, "reason": "no_sdk", "detail": _import_error}

    model, changed = validate_model()
    log.info("  model            : %s%s", model, "  (auto-corrected)" if changed else "")

    started = time.time()
    reply = generate_text("Reply with the single word: OK")
    elapsed = time.time() - started

    if reply:
        log.info("  startup request  : OK in %.2fs -> %r", elapsed, reply[:40])
        log.info("─" * 62)
        return {"ok": True, "model": model, "seconds": round(elapsed, 2)}

    log.error(
        "  startup request  : FAILED (%s) after %.2fs", _last_failure, elapsed
    )
    log.error("  detail           : %s", _last_error_detail)
    log.error("  %s", _advice(_last_failure))
    log.info("─" * 62)
    return {
        "ok": False,
        "reason": _last_failure,
        "detail": _last_error_detail,
        "advice": _advice(_last_failure),
    }


_ADVICE = {
    "quota": (
        "Free-tier quota is spent for this model. Quota is counted PER MODEL per "
        "day, so switching GEMINI_MODEL in backend/.env to another model "
        "(gemini-3.1-flash-lite, gemini-2.0-flash) restores service immediately. "
        "It also resets at midnight Pacific."
    ),
    "bad_key": "The API key was rejected. Regenerate it at https://aistudio.google.com/apikey.",
    "forbidden": "The key exists but is not permitted to use this model or feature.",
    "bad_model": "The model name does not exist. Check GEMINI_MODEL in backend/.env.",
    "dns": "DNS could not resolve Google's API. Check the network or a VPN.",
    "ssl": "TLS failed - often a corporate proxy intercepting HTTPS.",
    "timeout": "The request timed out. The network is reachable but slow.",
    "network": "Could not connect. The network is down or blocked.",
    "busy": "Google reported the model as overloaded. Retrying usually works.",
    "no_key": "No API key configured.",
    "empty": "The model returned no text, usually a safety block.",
}


def _advice(reason: str | None) -> str:
    return _ADVICE.get(reason or "", "Unclassified failure - see the log for the traceback.")


def raw_probe(prompt: str = "Say Hello", use_search: bool = False) -> dict[str, Any]:
    """One un-wrapped request, reported in full. Debugging only.

    Deliberately bypasses the retry, key-rotation and model-fallback machinery so
    that what comes back is the SDK's actual behaviour rather than this module's
    interpretation of it. Backs /api/test-gemini.
    """
    out: dict[str, Any] = {
        "prompt": prompt,
        "grounding_requested": use_search,
        "sdk_version": SDK_VERSION,
        "parser_version": PARSER_VERSION,
        "model": _resolved_model or MODEL,
    }
    if not _clients:
        out["error"] = _config_error or _import_error or "no clients"
        return out

    key_label, client = _clients[0]
    out["key"] = key_label

    config = None
    if use_search and genai_types is not None:
        config = genai_types.GenerateContentConfig(
            tools=[genai_types.Tool(google_search=genai_types.GoogleSearch())]
        )

    started = time.time()
    try:
        response = client.models.generate_content(
            model=out["model"], contents=prompt, config=config
        )
    except Exception as exc:
        reason, status_code = _classify(exc)
        out.update({
            "ok": False,
            "elapsed_seconds": round(time.time() - started, 2),
            "exception_type": type(exc).__name__,
            "google_error_code": getattr(exc, "code", None),
            "http_status": status_code,
            "reason": reason,
            "message": str(exc)[:1500],
            "traceback": traceback.format_exc(),
            "advice": _advice(reason),
        })
        return out

    out.update({
        "ok": True,
        "elapsed_seconds": round(time.time() - started, 2),
        "response_text": getattr(response, "text", None),
        "parsed_text": extract_text(response),
        "raw_repr": str(response)[:4000],
        **_response_debug(response),
    })
    out["parser_recovered_text"] = bool(
        not (getattr(response, "text", None) or "").strip() and out["parsed_text"]
    )
    return out


def status(public: bool = False) -> dict[str, Any]:
    """Everything /api/health needs to diagnose this layer without the log.

    `public=True` drops the masked key list. Masked is not secret, but a public
    endpoint should not publish the prefix and length of a live credential -
    that is free reconnaissance for no benefit to anyone legitimate.
    """
    keys = (
        [] if public
        else [{"label": label, "masked": _mask(key)} for label, key in _RAW_KEYS]
    )
    return {
        "available": available(),
        "sdk_version": SDK_VERSION,
        "parser_version": PARSER_VERSION,
        "last_text_length": _last_text_length,
        "keys_configured": len(_RAW_KEYS),
        "keys": keys,
        "model": _resolved_model or MODEL,
        "model_configured": MODEL,
        "model_auto_corrected": bool(_resolved_model and _resolved_model != MODEL),
        "search_grounding": (
            "unknown" if _search_supported is None
            else ("available" if _search_supported else "unavailable (needs billing)")
        ),
        "quota_exhausted": _last_failure == "quota",
        "models_exhausted": sorted(_exhausted_models),
        "models_untried": [
            m for m in (MODEL, *MODEL_FALLBACKS) if not _is_exhausted(m)
        ],
        "all_models_exhausted": all(
            _is_exhausted(m) for m in (MODEL, *MODEL_FALLBACKS)
        ),
        "last_error": _last_failure,
        "last_error_detail": _last_error_detail,
        "last_http_status": _last_http_status,
        "last_error_age_seconds": (
            round(time.time() - _last_failed_at, 1) if _last_failed_at else None
        ),
        "advice": _advice(_last_failure) if _last_failure else None,
        "import_error": _import_error,
        "config_error": _config_error,
    }
