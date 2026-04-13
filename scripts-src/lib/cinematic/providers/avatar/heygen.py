"""HeyGen avatar/presenter video generation provider.

Consolidated to use v2 API for both submit and poll (fixes v1/v2 mismatch).
"""

import json
import time
import urllib.request

from cinematic.providers.base import AvatarProvider
from cinematic.config import get_env
from cinematic.utils import api_call


class HeyGenProvider(AvatarProvider):
    """HeyGen avatar video generation."""

    BASE_URL = "https://api.heygen.com"

    def __init__(self, config):
        super().__init__(config)
        self.api_version = config.get('api_version', 'v2')

    def _api_key(self):
        """Resolve HeyGen API key from environment."""
        return get_env("HEYGEN_API_KEY", "")

    def _default_avatar_id(self):
        """Resolve default avatar ID from environment."""
        return get_env("HEYGEN_AVATAR_ID", "")

    def _headers(self):
        """Build HeyGen API headers."""
        return {
            "X-Api-Key": self._api_key(),
            "Content-Type": "application/json"
        }

    def submit(self, audio_url, avatar_id=None, width=1280, height=720,
               background=None):
        """Submit HeyGen avatar video generation. Returns video_id or None."""
        aid = avatar_id or self._default_avatar_id()
        payload = {
            "video_inputs": [{
                "character": {
                    "type": "avatar",
                    "avatar_id": aid,
                    "avatar_style": "normal"
                },
                "voice": {
                    "type": "audio",
                    "audio_url": audio_url
                }
            }],
            "dimension": {
                "width": width,
                "height": height
            }
        }
        if background:
            payload["background"] = background
        resp = api_call(
            f"{self.BASE_URL}/{self.api_version}/video/generate",
            payload,
            self._headers()
        )
        if resp and "data" in resp:
            return resp["data"].get("video_id")
        return None

    def submit_with_text(self, text, voice_id, avatar_id=None,
                         width=1280, height=720, background='green'):
        """Submit HeyGen video with text-to-speech voice (no audio URL needed).

        Args:
            text: Script text for TTS.
            voice_id: HeyGen voice ID.
            avatar_id: Avatar ID (falls back to default).
            width/height: Video dimensions.
            background: 'green' for chroma key, 'black', or a dict
                        like {"type": "color", "value": "#00FF00"}.
        Returns: video_id or None.
        """
        aid = avatar_id or self._default_avatar_id()

        if isinstance(background, dict):
            bg_config = background
        elif background == 'green':
            bg_config = {"type": "color", "value": "#00FF00"}
        elif background == 'black':
            bg_config = {"type": "color", "value": "#000000"}
        else:
            bg_config = {"type": "color", "value": "#00FF00"}

        resp = api_call(
            f"{self.BASE_URL}/{self.api_version}/video/generate",
            {
                "video_inputs": [{
                    "character": {
                        "type": "avatar",
                        "avatar_id": aid,
                        "avatar_style": "normal"
                    },
                    "voice": {
                        "type": "text",
                        "input_text": text,
                        "voice_id": voice_id
                    }
                }],
                "dimension": {
                    "width": width,
                    "height": height
                },
                "background": bg_config
            },
            self._headers()
        )
        if resp and "data" in resp:
            return resp["data"].get("video_id")
        return None

    def poll(self, video_id, timeout=600):
        """Poll HeyGen video status. Always uses v1 status endpoint."""
        elapsed = 0
        while elapsed < timeout:
            time.sleep(30)
            elapsed += 30
            try:
                req = urllib.request.Request(
                    f"{self.BASE_URL}/v1/"
                    f"video_status.get?video_id={video_id}",
                    headers=self._headers(),
                    method="GET"
                )
                with urllib.request.urlopen(req, timeout=30) as resp:
                    data = json.loads(resp.read())
            except Exception:
                continue

            status = data.get("data", {}).get("status", "")
            if status == "completed":
                return data["data"].get("video_url")
            elif status == "failed":
                err = data.get('data', {}).get('error', 'unknown')
                print(f"    HeyGen FAILED: {err}")
                return None
            print(f"    HeyGen: {status} ({elapsed}s)")

        print(f"    HeyGen: TIMEOUT after {timeout}s")
        return None
