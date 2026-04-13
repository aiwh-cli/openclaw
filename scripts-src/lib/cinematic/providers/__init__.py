"""Provider registry for the cinematic pipeline.

Maps provider types (video, image, avatar, tts, storage, notify) to their
implementation classes. Implementations self-register on import via register().
Provider selection reads from $CLIENT_ROOT/config/cinematic-providers.json.
"""

import json
import os

# Registry maps provider names to their implementation classes
REGISTRY = {
    'video': {},
    'image': {},
    'avatar': {},
    'tts': {},
    'storage': {},
    'notify': {},
    'compositor': {},
}

_DEFAULTS = {
    'video': 'veo',
    'image': 'imagen',
    'avatar': 'heygen',
    'tts': 'elevenlabs',
    'storage': 'gdrive',
    'notify': 'discord',
    'compositor': 'ffmpeg',
}


def register(provider_type, name, cls):
    """Register a provider implementation class."""
    REGISTRY[provider_type][name] = cls


def get_provider(provider_type):
    """Load and instantiate provider from client config. Falls back to defaults."""
    _auto_register()
    config = _load_config()
    entry = config.get(provider_type, {})
    name = entry.get('provider', _DEFAULTS.get(provider_type, ''))
    provider_config = entry.get('config', {})
    cls = REGISTRY[provider_type].get(name)
    if not cls:
        available = list(REGISTRY[provider_type].keys())
        raise ValueError(
            f"Unknown {provider_type} provider: {name}. "
            f"Available: {available}"
        )
    return cls(provider_config)


_config_cache = None


def _load_config():
    """Load cinematic-providers.json with caching."""
    global _config_cache
    if _config_cache is not None:
        return _config_cache
    client_root = os.environ.get('CLIENT_ROOT', '/opt/AIWH/client')
    config_path = os.path.join(client_root, 'config', 'cinematic-providers.json')
    try:
        with open(config_path) as f:
            _config_cache = json.load(f)
    except FileNotFoundError:
        _config_cache = {}
    return _config_cache


def reset_config_cache():
    """Clear cached config (useful for testing)."""
    global _config_cache
    _config_cache = None


def _auto_register():
    """Import and register all provider implementations.
    Called lazily on first get_provider() to avoid circular imports.
    """
    global _registered
    if _registered:
        return
    _registered = True
    from cinematic.providers.video.veo import VeoProvider
    from cinematic.providers.image.imagen import ImagenProvider
    from cinematic.providers.avatar.heygen import HeyGenProvider
    from cinematic.providers.tts.elevenlabs import ElevenLabsProvider
    from cinematic.providers.storage.gdrive import GDriveProvider
    from cinematic.providers.notify.discord import DiscordProvider
    from cinematic.providers.compositor.ffmpeg_compositor import FFmpegCompositor
    from cinematic.providers.compositor.remotion_compositor import RemotionCompositor

    register('video', 'veo', VeoProvider)
    register('image', 'imagen', ImagenProvider)
    register('avatar', 'heygen', HeyGenProvider)
    register('tts', 'elevenlabs', ElevenLabsProvider)
    register('storage', 'gdrive', GDriveProvider)
    register('notify', 'discord', DiscordProvider)
    register('compositor', 'ffmpeg', FFmpegCompositor)
    register('compositor', 'remotion', RemotionCompositor)


_registered = False
