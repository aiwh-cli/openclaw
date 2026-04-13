"""Configuration and environment loading for the cinematic pipeline.

Loads API keys from secrets.enc (preferred) or .env fallback.
Provides shared constants, format helpers, and Google auth.
"""

import json
import os
import subprocess
import sys
from pathlib import Path

# ── Paths ────────────────────────────────────────────────────────

CLIENT_ROOT = os.environ.get("CLIENT_ROOT", "/opt/AIWH/client")
DB_PATH = CLIENT_ROOT + "/data/video-jobs.db"
CINEMATIC_DIR = Path(CLIENT_ROOT + "/content/cinematic")
ENV_FILE = "/opt/AIWH/.openclaw/.env"
SECRETS_PY = "/opt/AIWH/core/scripts/lib/secrets.py"
SECRETS_ENC = os.path.join(CLIENT_ROOT, "config", "secrets.enc")
OPENCLAW_CONFIG_PATH = "/opt/AIWH/.openclaw/openclaw.json"

# ── FFmpeg paths ─────────────────────────────────────────────────

FFMPEG = "/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg"
FFPROBE = "/opt/homebrew/opt/ffmpeg-full/bin/ffprobe"
if not os.path.exists(FFMPEG):
    FFMPEG = "ffmpeg"
    FFPROBE = "ffprobe"

# ── Format / Aspect Ratio ───────────────────────────────────────

FORMAT_MAP = {
    "16:9": {"width": 1280, "height": 720, "aspect": "16:9",
             "scale": "1280:720"},
    "9:16": {"width": 720, "height": 1280, "aspect": "9:16",
             "scale": "720:1280"},
    "1:1":  {"width": 1024, "height": 1024, "aspect": "1:1",
             "scale": "1024:1024"},
}

# ── Safety filter rules ─────────────────────────────────────────
# Terms that trigger Google Vertex AI content policy rejections.
# These get replaced with safe alternatives before sending to Imagen/Veo.

PROMPT_SANITIZE_RULES = [
    (r'\brobot\s+child\b', 'small companion robot'),
    (r'\bchild\s+robot\b', 'small companion robot'),
    (r'\bai\s+child\b', 'small AI companion'),
    (r'\brobot\s+kid\b', 'small companion robot'),
    (r'\brobot\s+baby\b', 'small companion robot'),
    (r'\bchild\b(?=.*\brobot\b)', 'young person'),
    (r'\bminor\b(?=.*\bnude\b)', ''),
    (r'\bnude\b', ''),
    (r'\bnaked\b', ''),
    (r'\bweapon\b', 'tool'),
    (r'\bgun\b', 'device'),
    (r'\bblood\b', 'red liquid'),
    (r'\bviolence\b', 'intensity'),
    (r'\bexplod\w*\b', 'burst'),
]

# ── Environment loading ─────────────────────────────────────────

_env_cache = None

_NEEDED_KEYS = [
    "GOOGLE_CLOUD_PROJECT", "ELEVENLABS_API_KEY",
    "ELEVENLABS_VOICE_ID", "HEYGEN_API_KEY", "HEYGEN_AVATAR_ID",
    "DISCORD_WEBHOOK_URL",
]


def _load_env():
    """Load secrets from encrypted store or .env fallback. Cached."""
    global _env_cache
    if _env_cache is not None:
        return _env_cache

    env = {}
    # Try encrypted store first
    if os.path.exists(SECRETS_ENC) and os.path.exists(SECRETS_PY):
        try:
            result = subprocess.run(
                [sys.executable, SECRETS_PY, "load"] + _NEEDED_KEYS,
                capture_output=True, text=True, timeout=10)
            for line in result.stdout.strip().split("\n"):
                if line.startswith("export ") and "=" in line:
                    kv = line[7:]  # strip "export "
                    k, _, v = kv.partition("=")
                    env[k] = v.strip("'")
        except Exception:
            pass

    # Fallback to .env file
    if not env and os.path.exists(ENV_FILE):
        with open(ENV_FILE) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    k, v = line.split('=', 1)
                    env[k] = v.strip('"').strip("'")

    _env_cache = env
    return env


def get_env(key, default=""):
    """Get a single environment/secret value."""
    return _load_env().get(key, default)


# ── Google Cloud auth ────────────────────────────────────────────

_token_cache = {"token": "", "expires": 0}

def gcloud_token():
    """Get a fresh OAuth2 access token via refresh token (no gcloud CLI needed)."""
    import time, json as _json
    now = time.time()
    if _token_cache["token"] and _token_cache["expires"] > now + 60:
        return _token_cache["token"]
    # Try refresh token from application_default_credentials.json
    creds_path = os.path.expanduser("~/.config/gcloud/application_default_credentials.json")
    try:
        with open(creds_path) as f:
            creds = _json.load(f)
        refresh_token = creds.get("refresh_token")
        client_id = creds.get("client_id")
        client_secret = creds.get("client_secret")
        if refresh_token and client_id and client_secret:
            import urllib.request, urllib.parse
            data = urllib.parse.urlencode({
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
                "client_id": client_id,
                "client_secret": client_secret,
            }).encode()
            req = urllib.request.Request("https://oauth2.googleapis.com/token", data=data,
                                         headers={"Content-Type": "application/x-www-form-urlencoded"})
            resp = urllib.request.urlopen(req, timeout=10)
            result = _json.loads(resp.read())
            if result.get("access_token"):
                _token_cache["token"] = result["access_token"]
                _token_cache["expires"] = now + result.get("expires_in", 3600)
                return _token_cache["token"]
    except Exception as e:
        print(f"  WARN: refresh token failed ({e}), falling back to gcloud CLI")
    # Fallback: gcloud CLI
    try:
        result = subprocess.run(
            ["/opt/homebrew/bin/gcloud", "auth", "print-access-token"],
            capture_output=True, text=True, timeout=10
        )
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
        print(f"  ERROR: gcloud auth failed: {result.stderr[:200]}")
    except Exception as e:
        print(f"  ERROR: gcloud auth exception: {e}")
    return ""


def vertex_headers():
    """Build auth headers for Vertex AI API calls."""
    return {
        "Authorization": f"Bearer {gcloud_token()}",
        "Content-Type": "application/json"
    }


def vertex_base_url():
    """Build Vertex AI base URL from config."""
    project = get_env("GOOGLE_CLOUD_PROJECT", "")
    region = "us-central1"
    return (
        f"https://{region}-aiplatform.googleapis.com/v1/"
        f"projects/{project}/locations/{region}/"
        f"publishers/google/models"
    )


def google_region():
    """Return the Google Cloud region."""
    return "us-central1"


# ── Format helpers ───────────────────────────────────────────────

def get_format(job):
    """Get format dimensions from job's output_format field."""
    try:
        fmt = job["output_format"] or "16:9"
    except (KeyError, TypeError):
        fmt = "16:9"
    return FORMAT_MAP.get(fmt, FORMAT_MAP["16:9"])


def job_no_avatar(job):
    """Check if job has no_avatar flag set."""
    try:
        return bool(job["no_avatar"])
    except (KeyError, TypeError):
        return False


# ── OpenClaw config ──────────────────────────────────────────────

_openclaw_config = None


def load_openclaw_config():
    """Load and cache openclaw.json."""
    global _openclaw_config
    if _openclaw_config is None:
        try:
            with open(OPENCLAW_CONFIG_PATH) as f:
                _openclaw_config = json.load(f)
        except Exception:
            _openclaw_config = {}
    return _openclaw_config
