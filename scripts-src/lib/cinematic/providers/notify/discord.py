"""Discord webhook notification provider."""

from cinematic.providers.base import NotifyProvider
from cinematic.config import get_env
from cinematic.utils import api_call


class DiscordProvider(NotifyProvider):
    """Discord webhook notifications."""

    def send(self, message, category=None):
        """Send a Discord notification via webhook."""
        webhook_url = get_env("DISCORD_WEBHOOK_URL", "")
        if not webhook_url:
            return
        try:
            api_call(
                webhook_url,
                {"content": f"[Cinematic Producer] {message}"},
                {"Content-Type": "application/json"}
            )
        except Exception:
            pass
