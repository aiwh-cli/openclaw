#!/usr/bin/env python3
"""Provider-agnostic LLM abstraction for AIWH standalone scripts.

Reads provider/model config from openclaw.json. Supports:
- Anthropic (Messages API)
- OpenAI / OpenAI Codex OAuth (Chat Completions API)
- OpenRouter (Chat Completions API)
- Ollama (Chat Completions-compatible API)

Auth resolution: secrets.enc → auth-profiles.json (Codex OAuth) → env vars.
"""

import base64
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

# ── Paths ──────────────────────────────────────────────────────
_CORE_ROOT = Path("/opt/AIWH/core")
_SECRETS_PY = _CORE_ROOT / "scripts" / "lib" / "secrets.py"
_OPENCLAW_CONFIG = Path(os.environ.get(
    "OPENCLAW_STATE_DIR", "/opt/AIWH/.openclaw")) / "openclaw.json"
_AUTH_PROFILES_PATH = Path(os.environ.get(
    "OPENCLAW_STATE_DIR", "/opt/AIWH/.openclaw")) / "agents" / "main" / "agent" / "auth-profiles.json"

# ── Provider config ────────────────────────────────────────────
PROVIDERS = {
    "anthropic": {
        "endpoint": "https://api.anthropic.com/v1/messages",
        "format": "anthropic",
        "auth_header": "x-api-key",
        "secret_key": "ANTHROPIC_API_KEY",
    },
    "openai": {
        "endpoint": "https://api.openai.com/v1/chat/completions",
        "format": "openai",
        "auth_header": "Authorization",
        "auth_prefix": "Bearer ",
        "secret_key": "OPENAI_API_KEY",
    },
    "openai-codex": {
        "endpoint": "https://api.openai.com/v1/chat/completions",
        "format": "openai",
        "auth_header": "Authorization",
        "auth_prefix": "Bearer ",
        "secret_key": "OPENAI_API_KEY",
        "oauth": True,
    },
    "openrouter": {
        "endpoint": "https://openrouter.ai/api/v1/chat/completions",
        "format": "openai",
        "auth_header": "Authorization",
        "auth_prefix": "Bearer ",
        "secret_key": "OPENROUTER_API_KEY",
    },
    "ollama": {
        "endpoint": "http://localhost:11434/api/chat",
        "format": "openai",
        "auth_header": None,
        "secret_key": None,
    },
}

# ── Caches ─────────────────────────────────────────────────────
_openclaw_cfg = None
_secrets_cache = None
_secrets_cache_time = 0
_SECRETS_TTL = 300  # 5 min


def _load_openclaw_config():
    """Load and cache openclaw.json."""
    global _openclaw_cfg
    if _openclaw_cfg is None:
        try:
            with open(_OPENCLAW_CONFIG) as f:
                _openclaw_cfg = json.load(f)
        except Exception:
            _openclaw_cfg = {}
    return _openclaw_cfg


def _load_secrets():
    """Load secrets from encrypted store with TTL cache."""
    global _secrets_cache, _secrets_cache_time
    now = time.time()
    if _secrets_cache is not None and (now - _secrets_cache_time) < _SECRETS_TTL:
        return _secrets_cache
    env = {}
    if _SECRETS_PY.exists():
        try:
            result = subprocess.run(
                ["python3", str(_SECRETS_PY), "load", "--all"],
                capture_output=True, text=True, timeout=10,
            )
            for line in result.stdout.split("\n"):
                m = re.match(r"^export\s+([A-Z_][A-Z0-9_]*)='(.*)'$", line)
                if m:
                    env[m.group(1)] = m.group(2)
        except Exception:
            pass
    _secrets_cache = env
    _secrets_cache_time = now
    return env


def _load_auth_profiles():
    """Load OpenClaw auth-profiles.json for OAuth fallback."""
    try:
        with open(_AUTH_PROFILES_PATH) as f:
            return json.load(f)
    except Exception:
        return {}


# ── Config resolution ──────────────────────────────────────────

def get_provider_and_model(model_override=None):
    """Resolve provider and model from openclaw.json or override.

    Returns (provider_id, model_id, provider_config).
    """
    if model_override and "/" in model_override:
        provider_id, model_id = model_override.split("/", 1)
    else:
        cfg = _load_openclaw_config()
        model_ref = cfg.get("agents", {}).get("defaults", {}).get("model", {})
        full_model = model_ref.get("primary", "") if isinstance(model_ref, dict) else str(model_ref)
        if "/" in full_model:
            provider_id, model_id = full_model.split("/", 1)
        else:
            provider_id = "anthropic"
            model_id = full_model or "claude-sonnet-4-5"

    if model_override and "/" not in model_override:
        model_id = model_override

    provider_cfg = PROVIDERS.get(provider_id)
    if not provider_cfg:
        # Unknown provider — try OpenAI-compatible format
        provider_cfg = {
            "endpoint": f"https://{provider_id}.ai/api/v1/chat/completions",
            "format": "openai",
            "auth_header": "Authorization",
            "auth_prefix": "Bearer ",
            "secret_key": f"{provider_id.upper().replace('-', '_')}_API_KEY",
        }

    return provider_id, model_id, provider_cfg


def _resolve_api_key(provider_id, provider_cfg):
    """Resolve API key: secrets.enc → auth-profiles (OAuth) → env vars."""
    secret_key_name = provider_cfg.get("secret_key")

    # 1. secrets.enc
    if secret_key_name:
        secrets = _load_secrets()
        key = secrets.get(secret_key_name)
        if key:
            return key

    # 2. auth-profiles.json (Codex OAuth or stored API key)
    if provider_cfg.get("oauth") or provider_id in ("openai-codex", "openai", "anthropic"):
        profiles = _load_auth_profiles()
        for profile_id, cred in profiles.get("profiles", {}).items():
            if not profile_id.startswith(provider_id):
                continue
            if cred.get("type") == "api_key":
                return cred.get("key")
            if cred.get("type") == "oauth":
                access = cred.get("access")
                expires = cred.get("expires", 0)
                if access and (expires == 0 or expires > time.time() * 1000):
                    return access
                # Token expired — re-read file in case gateway refreshed it
                profiles_fresh = _load_auth_profiles()
                for pid, c in profiles_fresh.get("profiles", {}).items():
                    if pid.startswith(provider_id) and c.get("type") == "oauth":
                        return c.get("access")

    # 3. Environment variables
    if secret_key_name:
        return os.environ.get(secret_key_name, "")

    return ""


# ── Image handling ─────────────────────────────────────────────

_MEDIA_TYPES = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".webp": "image/webp",
}


def _encode_image(img_path):
    """Read and base64-encode an image file. Returns (b64_data, media_type) or None."""
    try:
        data = Path(img_path).read_bytes()
        b64 = base64.b64encode(data).decode("utf-8")
        ext = Path(img_path).suffix.lower()
        media_type = _MEDIA_TYPES.get(ext, "image/png")
        return b64, media_type
    except Exception as e:
        print(f"  Warning: could not load image {img_path}: {e}")
        return None


def _build_anthropic_content(prompt, images=None):
    """Build Anthropic Messages API content array."""
    if not images:
        return prompt
    content = []
    for img_path in images:
        result = _encode_image(img_path)
        if result:
            b64, media_type = result
            content.append({
                "type": "image",
                "source": {"type": "base64", "media_type": media_type, "data": b64},
            })
    content.append({"type": "text", "text": prompt})
    return content


def _openai_token_key(model_id):
    """Return the correct max-tokens parameter for OpenAI-compatible models.
    GPT-5.x, o1, o3, o4 models require 'max_completion_tokens' instead of 'max_tokens'."""
    m = model_id.lower()
    if any(m.startswith(p) for p in ("gpt-5", "o1", "o3", "o4")):
        return "max_completion_tokens"
    return "max_tokens"


_BILLING_PHRASES = ("usage limit", "credit balance", "plans & billing",
                    "insufficient credits", "insufficient balance")


def _build_openai_content(prompt, images=None):
    """Build OpenAI Chat Completions content array."""
    if not images:
        return prompt
    content = []
    for img_path in images:
        result = _encode_image(img_path)
        if result:
            b64, media_type = result
            content.append({
                "type": "image_url",
                "image_url": {"url": f"data:{media_type};base64,{b64}"},
            })
    content.append({"type": "text", "text": prompt})
    return content


# ── HTTP call with retry ───────────────────────────────────────

def _http_call(url, data, headers, timeout=300, retries=3):
    """Make an HTTP POST with retry on transient errors."""
    body = json.dumps(data).encode("utf-8")
    for attempt in range(retries):
        req = Request(url, data=body, headers=headers, method="POST")
        try:
            with urlopen(req, timeout=timeout) as resp:
                raw = resp.read().decode("utf-8").strip()
                # Some providers return extra data after JSON — parse only the first object
                try:
                    return json.loads(raw)
                except json.JSONDecodeError:
                    # Try to find the first complete JSON object
                    decoder = json.JSONDecoder()
                    obj, _ = decoder.raw_decode(raw)
                    return obj
        except HTTPError as e:
            err = e.read().decode()[:500]
            err_lower = err.lower()
            # Billing errors — skip immediately to fallback (no retry)
            if e.code in (400, 402) and any(p in err_lower for p in _BILLING_PHRASES):
                print(f"  Billing error (HTTP {e.code}) — skipping to fallback", file=sys.stderr)
                return None
            retryable = e.code in (429, 503, 500)
            if retryable and attempt < retries - 1:
                wait = (attempt + 1) * 10
                print(f"  HTTP {e.code} — retrying in {wait}s (attempt {attempt + 1}/{retries})", file=sys.stderr)
                time.sleep(wait)
                continue
            print(f"  HTTP {e.code}: {err}", file=sys.stderr)
            return None
        except (URLError, TimeoutError) as e:
            if attempt < retries - 1:
                wait = (attempt + 1) * 10
                print(f"  Network error — retrying in {wait}s: {e}", file=sys.stderr)
                time.sleep(wait)
                continue
            print(f"  Network error (giving up): {e}", file=sys.stderr)
            return None


# ── Public API ─────────────────────────────────────────────────

def _get_fallback_models():
    """Read fallback model chain from openclaw.json agents.defaults.model.fallbacks."""
    cfg = _load_openclaw_config()
    model_cfg = cfg.get("agents", {}).get("defaults", {}).get("model", {})
    if isinstance(model_cfg, dict):
        return model_cfg.get("fallbacks", [])
    return []


def _single_llm_call(prompt, model, max_tokens, temperature, images, timeout, retries):
    """Single-provider LLM call. Returns response text or None."""
    provider_id, model_id, provider_cfg = get_provider_and_model(model)
    api_key = _resolve_api_key(provider_id, provider_cfg)
    if provider_cfg["format"] == "anthropic":
        return _call_anthropic(prompt, model_id, max_tokens, temperature,
                               images, api_key, provider_cfg, timeout, retries)
    else:
        return _call_openai_compat(prompt, model_id, max_tokens, temperature,
                                   images, api_key, provider_cfg, timeout, retries)


def llm_call(prompt, model=None, max_tokens=4000, temperature=1.0,
             images=None, timeout=60, retries=3):
    """Make a provider-agnostic LLM call with automatic cross-provider fallback.

    Tries the primary model first, then each fallback from openclaw.json
    agents.defaults.model.fallbacks until one succeeds.

    Args:
        prompt: The user message text.
        model: Override model (e.g. "anthropic/claude-haiku-4-5"). If None, reads openclaw.json.
        max_tokens: Maximum tokens in response.
        temperature: Sampling temperature.
        images: Optional list of image file paths for vision/multimodal.
        timeout: HTTP timeout in seconds.
        retries: Number of retry attempts on transient errors.
    """
    result = _single_llm_call(prompt, model, max_tokens, temperature, images, timeout, retries)
    if result is not None:
        return result

    # Primary failed — try fallbacks
    fallbacks = _get_fallback_models()
    for fb_model in fallbacks:
        print(f"  [llm_provider] Primary failed, trying fallback: {fb_model}")
        result = _single_llm_call(prompt, fb_model, max_tokens, temperature, images, timeout, retries=1)
        if result is not None:
            return result

    return None


def _single_llm_call_raw(messages, model, max_tokens, temperature, timeout, retries):
    """Single-provider raw message LLM call. Returns response text or None."""
    provider_id, model_id, provider_cfg = get_provider_and_model(model)
    api_key = _resolve_api_key(provider_id, provider_cfg)

    if provider_cfg["format"] == "anthropic":
        headers = {
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        }
        data = {
            "model": model_id,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "messages": messages,
        }
        resp = _http_call(provider_cfg["endpoint"], data, headers, timeout, retries)
        if resp and "content" in resp:
            return resp["content"][0].get("text", "")
        return None
    else:
        headers = {"Content-Type": "application/json"}
        if provider_cfg.get("auth_header") and api_key:
            prefix = provider_cfg.get("auth_prefix", "")
            headers[provider_cfg["auth_header"]] = f"{prefix}{api_key}"
        data = {
            "model": model_id,
            _openai_token_key(model_id): max_tokens,
            "temperature": temperature,
            "messages": messages,
        }
        resp = _http_call(provider_cfg["endpoint"], data, headers, timeout, retries)
        if resp and "choices" in resp:
            return resp["choices"][0].get("message", {}).get("content", "")
        return None


def llm_call_raw(messages, model=None, max_tokens=4000, temperature=1.0,
                 timeout=60, retries=3):
    """Make a provider-agnostic LLM call with raw messages + cross-provider fallback.

    Args:
        messages: List of {"role": "user"|"assistant", "content": "..."} dicts.
        model: Override model. If None, reads openclaw.json.
    """
    result = _single_llm_call_raw(messages, model, max_tokens, temperature, timeout, retries)
    if result is not None:
        return result

    fallbacks = _get_fallback_models()
    for fb_model in fallbacks:
        print(f"  [llm_provider] Primary failed, trying fallback: {fb_model}")
        result = _single_llm_call_raw(messages, fb_model, max_tokens, temperature, timeout, retries=1)
        if result is not None:
            return result

    return None


# ── Provider-specific callers ──────────────────────────────────

def _call_anthropic(prompt, model_id, max_tokens, temperature,
                    images, api_key, provider_cfg, timeout, retries):
    """Call Anthropic Messages API."""
    if not api_key:
        print("  Warning: No API key for Anthropic — skipping LLM call")
        return None

    content = _build_anthropic_content(prompt, images)
    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
    }
    data = {
        "model": model_id,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "messages": [{"role": "user", "content": content}],
    }
    resp = _http_call(provider_cfg["endpoint"], data, headers, timeout, retries)
    if resp and "content" in resp:
        return resp["content"][0].get("text", "")
    return None


def _call_openai_compat(prompt, model_id, max_tokens, temperature,
                        images, api_key, provider_cfg, timeout, retries):
    """Call OpenAI-compatible Chat Completions API (OpenAI, OpenRouter, Ollama, Codex)."""
    content = _build_openai_content(prompt, images)
    headers = {"Content-Type": "application/json"}
    if provider_cfg.get("auth_header") and api_key:
        prefix = provider_cfg.get("auth_prefix", "")
        headers[provider_cfg["auth_header"]] = f"{prefix}{api_key}"

    data = {
        "model": model_id,
        _openai_token_key(model_id): max_tokens,
        "temperature": temperature,
        "messages": [{"role": "user", "content": content}],
    }
    resp = _http_call(provider_cfg["endpoint"], data, headers, timeout, retries)
    if resp and "choices" in resp:
        return resp["choices"][0].get("message", {}).get("content", "")
    return None


# ── Convenience ────────────────────────────────────────────────

def get_default_model_id(role="primary"):
    """Get the full model reference (provider/model) from openclaw.json."""
    cfg = _load_openclaw_config()
    model_ref = cfg.get("agents", {}).get("defaults", {}).get("model", {})
    return model_ref.get(role, "") if isinstance(model_ref, dict) else str(model_ref)


def get_provider_name():
    """Get the current provider name from openclaw.json."""
    provider_id, _, _ = get_provider_and_model()
    return provider_id
