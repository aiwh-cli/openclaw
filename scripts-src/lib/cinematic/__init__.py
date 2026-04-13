"""Cinematic pipeline package.

Modular structure with provider abstraction for 6 services:
video (Veo), image (Imagen), avatar (HeyGen), tts (ElevenLabs),
storage (GDrive), notify (Discord).

Usage from main script:
    from cinematic.cli import cmd_create, cmd_run, ...
    from cinematic.providers import get_provider
"""

__version__ = "2.0.0"
