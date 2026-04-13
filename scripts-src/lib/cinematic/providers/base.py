"""Base classes for all cinematic pipeline providers.

Each base class defines the interface that provider implementations must follow.
Providers are registered in the registry (providers/__init__.py) and resolved
at runtime from client config (cinematic-providers.json).
"""


class VideoProvider:
    """Interface for video generation (Veo, Runway, Kling, Higgsfield, Pika)."""

    def __init__(self, config):
        self.config = config

    def generate(self, prompt, first_frame_path, last_frame_path=None,
                 duration=8, aspect_ratio="16:9"):
        """Submit video generation. Returns operation/task ID or None."""
        raise NotImplementedError

    def poll(self, operation_id, timeout=600):
        """Poll for completion. Returns video URI/data or None."""
        raise NotImplementedError

    def download(self, result, dest_path):
        """Download video from result to dest_path. Returns True on success."""
        raise NotImplementedError


class ImageProvider:
    """Interface for image generation (Imagen, Stability AI, DALL-E, Flux)."""

    def __init__(self, config):
        self.config = config

    def generate(self, prompt, dest_dir, filename, aspect_ratio="16:9"):
        """Generate image. Returns local file path or None."""
        raise NotImplementedError


class AvatarProvider:
    """Interface for avatar/presenter video (HeyGen, D-ID, Synthesia)."""

    def __init__(self, config):
        self.config = config

    def submit(self, audio_url, avatar_id=None, width=1280, height=720):
        """Submit avatar video generation. Returns video_id or None."""
        raise NotImplementedError

    def poll(self, video_id, timeout=600):
        """Poll for completion. Returns video URL or None."""
        raise NotImplementedError


class TTSProvider:
    """Interface for text-to-speech (ElevenLabs, Google TTS, PlayHT, local XTTS)."""

    def __init__(self, config):
        self.config = config

    def synthesize(self, text, output_path, voice_id=None):
        """Generate TTS audio. Returns True on success."""
        raise NotImplementedError

    def synthesize_with_timestamps(self, text, audio_path, srt_path,
                                   voice_id=None):
        """Generate TTS with word-level timestamps + SRT. Returns True on success."""
        raise NotImplementedError


class StorageProvider:
    """Interface for media hosting (GDrive, OneDrive, R2, S3, local)."""

    def __init__(self, config):
        self.config = config

    def upload(self, local_path):
        """Upload file. Returns public URL or None."""
        raise NotImplementedError

    def get_public_url(self, file_id):
        """Get public download URL for a file ID."""
        raise NotImplementedError


class NotifyProvider:
    """Interface for notifications (Discord, Slack, Telegram, email)."""

    def __init__(self, config):
        self.config = config

    def send(self, message, category=None):
        """Send a notification message."""
        raise NotImplementedError


class CompositorProvider:
    """Interface for video composition/assembly (FFmpeg, Remotion, Kapwing).

    Takes raw assets (video clips, narration, BGM, captions) and composes
    them into a final polished video with transitions, overlays, and branding.
    """

    def __init__(self, config):
        self.config = config

    def compose(self, clips, narr_dir, output_dir, job, fmt, scale_filter):
        """Compose final video from assets.

        Args:
            clips: list of clip dicts from production_plan
            narr_dir: Path to narration directory (audio + SRT files)
            output_dir: Path to write final output
            job: dict with job config (bgm_path, captions_enabled, etc.)
            fmt: format dict (aspect, scale, etc.)
            scale_filter: FFmpeg-compatible scale filter string

        Returns:
            str path to final video file, or None on failure.
        """
        raise NotImplementedError

    def get_templates(self):
        """Return list of available composition templates.

        Returns:
            list of dicts with keys: id, name, description, category
        """
        return []
