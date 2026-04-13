#!/usr/bin/env python3
"""Platform format resolver — returns the correct aspect ratio for (platform, content_type).

Reads platform_formats from content-pillars.json. Handles both:
- Legacy flat format: {"instagram": "9:16"} — treated as video_reel only
- Hierarchical format: {"instagram": {"video_reel": "9:16", "image_post": "4:5"}}

Usage as library:
    from format_resolver import resolve_format
    ratio = resolve_format("instagram", "image_post")  # "4:5"

Usage as CLI:
    python3 format_resolver.py resolve instagram image_post   # prints "4:5"
    python3 format_resolver.py defaults                       # prints full default matrix as JSON
    python3 format_resolver.py migrate                        # migrates content-pillars.json in-place
"""

import json
import os
import sys

CLIENT_ROOT = os.environ.get("CLIENT_ROOT", "/opt/AIWH/client")
PILLARS_PATH = os.path.join(CLIENT_ROOT, "config", "content-pillars.json")

# Default format matrix. Uses the IDEAL ratio per platform — generate-social-image.sh
# handles provider limitations (e.g., Imagen 3 generates 3:4 then crops to 4:5).
DEFAULTS = {
    "instagram": {"video_reel": "9:16", "image_post": "4:5", "text_post": None},
    "x":         {"video_reel": "16:9", "image_post": "16:9", "text_post": None},
    "linkedin":  {"video_reel": "16:9", "image_post": "16:9", "text_post": None},
    "tiktok":    {"video_reel": "9:16", "image_post": None, "text_post": None},
    "facebook":  {"video_reel": "16:9", "image_post": "4:5", "text_post": None},
}

# Map target ratios to nearest Imagen 3 compatible ratio for generation.
# After generation, the image is cropped to the exact target ratio.
IMAGEN_COMPAT = {
    "4:5": "3:4",      # generate 3:4, crop to 4:5
    "1.91:1": "16:9",  # generate 16:9, crop to 1.91:1
}
IMAGEN_NATIVE = {"1:1", "3:4", "4:3", "9:16", "16:9"}


def imagen_ratio(target_ratio):
    """Return the Imagen-compatible ratio to generate, and whether cropping is needed."""
    if target_ratio in IMAGEN_NATIVE:
        return target_ratio, False
    compat = IMAGEN_COMPAT.get(target_ratio)
    if compat:
        return compat, True
    return target_ratio, False  # let the provider handle/reject it


def _load_formats(pillars_path=None):
    """Load platform_formats from content-pillars.json."""
    path = pillars_path or PILLARS_PATH
    try:
        with open(path) as f:
            return json.load(f).get("platform_formats", {})
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def is_legacy(platform_formats):
    """Check if format is old flat style (values are strings, not dicts)."""
    return any(isinstance(v, str) for v in platform_formats.values())


def migrate_legacy(platform_formats):
    """Convert flat format to hierarchical, preserving existing values as video_reel."""
    result = {}
    for platform, value in platform_formats.items():
        if isinstance(value, str):
            defaults = DEFAULTS.get(platform, {})
            result[platform] = {
                "video_reel": value,
                "image_post": defaults.get("image_post"),
                "text_post": None,
            }
        else:
            result[platform] = value
    # Add any default platforms not in config
    for platform, defaults in DEFAULTS.items():
        if platform not in result:
            result[platform] = dict(defaults)
    return result


def resolve_format(platform, content_type, pillars_path=None):
    """Return aspect ratio for (platform, content_type), or None if unsupported."""
    formats = _load_formats(pillars_path)
    if is_legacy(formats):
        formats = migrate_legacy(formats)

    platform_cfg = formats.get(platform)
    if isinstance(platform_cfg, dict):
        return platform_cfg.get(content_type)
    if isinstance(platform_cfg, str) and content_type == "video_reel":
        return platform_cfg
    return DEFAULTS.get(platform, {}).get(content_type)


def get_all_formats(pillars_path=None):
    """Return full format matrix (hierarchical), merging config with defaults."""
    formats = _load_formats(pillars_path)
    if is_legacy(formats):
        formats = migrate_legacy(formats)
    # Merge with defaults for any missing platforms
    result = dict(DEFAULTS)
    for platform, cfg in formats.items():
        if isinstance(cfg, dict):
            result[platform] = cfg
    return result


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "help"

    if cmd == "resolve" and len(sys.argv) >= 4:
        result = resolve_format(sys.argv[2], sys.argv[3],
                                sys.argv[4] if len(sys.argv) > 4 else None)
        print(result if result else "null")

    elif cmd == "defaults":
        print(json.dumps(DEFAULTS, indent=2))

    elif cmd == "all":
        print(json.dumps(get_all_formats(), indent=2))

    elif cmd == "migrate":
        path = sys.argv[2] if len(sys.argv) > 2 else PILLARS_PATH
        with open(path) as f:
            cfg = json.load(f)
        old = cfg.get("platform_formats", {})
        if is_legacy(old):
            cfg["platform_formats"] = migrate_legacy(old)
            with open(path, "w") as f:
                json.dump(cfg, f, indent=2)
            print(f"Migrated {path}: flat → hierarchical")
        else:
            print(f"Already hierarchical: {path}")

    else:
        print("Usage: format_resolver.py <resolve|defaults|all|migrate> [args]")
        sys.exit(1)
