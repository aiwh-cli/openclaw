"""ElevenLabs text-to-speech provider.

Supports both basic TTS and TTS with word-level timestamps for
caption generation (SRT output).
"""

import base64
import json
import os
import urllib.request

from cinematic.providers.base import TTSProvider
from cinematic.config import get_env
from cinematic.utils import chars_to_words, write_srt


class ElevenLabsProvider(TTSProvider):
    """ElevenLabs TTS provider."""

    BASE_URL = "https://api.elevenlabs.io/v1/text-to-speech"

    def __init__(self, config):
        super().__init__(config)
        self.model_id = config.get('model', 'eleven_multilingual_v2')
        self.stability = config.get('stability', 0.5)
        self.similarity_boost = config.get('similarity_boost', 0.75)
        self.style = config.get('style', 0.5)

    def _api_key(self):
        """Resolve ElevenLabs API key from environment."""
        return get_env("ELEVENLABS_API_KEY", "")

    def _default_voice_id(self):
        """Resolve default voice ID from environment."""
        return get_env("ELEVENLABS_VOICE_ID", "")

    def _voice_settings(self):
        """Build voice settings dict."""
        return {
            "stability": self.stability,
            "similarity_boost": self.similarity_boost,
            "style": self.style,
            "use_speaker_boost": True
        }

    def synthesize(self, text, output_path, voice_id=None):
        """Generate TTS audio. Returns True on success."""
        vid = voice_id or self._default_voice_id()
        body = json.dumps({
            "text": text,
            "model_id": self.model_id,
            "voice_settings": self._voice_settings()
        }).encode()

        req = urllib.request.Request(
            f"{self.BASE_URL}/{vid}",
            data=body,
            headers={
                "xi-api-key": self._api_key(),
                "Content-Type": "application/json"
            }
        )
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                with open(output_path, 'wb') as f:
                    f.write(resp.read())
            return (os.path.exists(output_path)
                    and os.path.getsize(output_path) > 0)
        except Exception as e:
            print(f"    ElevenLabs TTS error: {e}")
            return False

    def synthesize_with_timestamps(self, text, audio_path, srt_path,
                                   voice_id=None):
        """Generate TTS with word-level timestamps + SRT file."""
        vid = voice_id or self._default_voice_id()
        body = json.dumps({
            "text": text,
            "model_id": self.model_id,
            "voice_settings": self._voice_settings(),
            "output_format": "mp3_44100_128"
        }).encode()

        req = urllib.request.Request(
            f"{self.BASE_URL}/{vid}/with-timestamps",
            data=body,
            headers={
                "xi-api-key": self._api_key(),
                "Content-Type": "application/json"
            }
        )
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                data = json.loads(resp.read())

            # Write audio (base64-encoded)
            audio_b64 = data.get("audio_base64", "")
            if audio_b64:
                with open(audio_path, 'wb') as f:
                    f.write(base64.b64decode(audio_b64))

            # Extract alignment data and write SRT
            alignment = data.get("alignment", {})
            chars = alignment.get("characters", [])
            char_starts = alignment.get(
                "character_start_times_seconds", [])
            char_ends = alignment.get(
                "character_end_times_seconds", [])

            if chars and char_starts and char_ends:
                words = chars_to_words(chars, char_starts, char_ends)
                write_srt(words, srt_path)
                return True
            elif (os.path.exists(audio_path)
                    and os.path.getsize(audio_path) > 0):
                return True
            return False
        except Exception as e:
            print(f"    Timestamps TTS failed ({e}), "
                  "falling back to regular TTS")
            return self.synthesize(text, audio_path, voice_id)
