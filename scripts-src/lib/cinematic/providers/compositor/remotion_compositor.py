"""Remotion compositor — professional video composition via React/Remotion.

Replaces FFmpeg assembly with Remotion's React-based rendering engine for:
- Animated transitions between clips (crossfade, slide, fade-black)
- Branded intro/outro sequences with logo and tagline
- Word-by-word animated captions (spring physics, highlight active word)
- Professional motion graphics and text overlays

Renders locally on the Mac Mini via Node.js subprocess.
"""

import json
import os
import subprocess
import time
from pathlib import Path

from cinematic.providers.base import CompositorProvider


REMOTION_DIR = Path(__file__).resolve().parents[3] / "remotion"
RENDER_SCRIPT = REMOTION_DIR / "render.js"
TEMPLATE_DEFAULTS = (Path(__file__).resolve().parents[4]
                     / "config" / "remotion-template-defaults.json")
CLIENT_ROOT = os.environ.get('CLIENT_ROOT', '/opt/AIWH/client')
CLIENT_TEMPLATES = Path(CLIENT_ROOT) / "config" / "remotion-templates.json"

FORMAT_TO_COMPOSITION = {
    '16:9': 'CinematicLandscape',
    '9:16': 'CinematicPortrait',
    '1:1': 'CinematicLandscape',  # square uses landscape layout
}

FORMAT_TO_RESOLUTION = {
    '16:9': (1920, 1080),
    '9:16': (1080, 1920),
    '1:1': (1080, 1080),
}


class RemotionCompositor(CompositorProvider):
    """Compose final video using Remotion's React-based renderer."""

    def compose(self, clips, narr_dir, output_dir, job, fmt, scale_filter):
        """Build Remotion config and render via Node.js subprocess."""
        from cinematic.db import get_db

        db = get_db()
        cjob_id = job['cjob_id']
        output_path = str(output_dir / "final.mp4")
        aspect = fmt.get('aspect', '16:9') if isinstance(fmt, dict) else '16:9'

        # Gather approved clips
        clip_data = self._build_clip_data(db, cjob_id, clips, narr_dir)
        if not clip_data:
            print("  [remotion] No clips to compose")
            return None

        # Load brand/template config
        brand = self._load_brand_config()
        template_config = self._load_template_config()

        # Build SRT path for captions
        srt_path = ""
        if job.get('captions_enabled'):
            combined_srt = narr_dir / "combined.srt"
            if combined_srt.exists():
                srt_path = str(combined_srt)
            else:
                # Try individual clip SRTs
                srts = sorted(narr_dir.glob("clip-*.srt"))
                if srts:
                    srt_path = str(srts[0])  # first SRT as fallback

        # Calculate total duration
        total_sec = sum(c['durationSec'] for c in clip_data)
        intro_sec = 3 if brand.get('introText') else 0
        outro_sec = 3 if brand.get('outroText') else 0
        total_frames = int((total_sec + intro_sec + outro_sec) * 30)

        # Select composition by format
        composition_id = FORMAT_TO_COMPOSITION.get(aspect, 'CinematicLandscape')
        width, height = FORMAT_TO_RESOLUTION.get(aspect, (1920, 1080))

        # Build render config
        config = {
            'compositionId': composition_id,
            'durationInFrames': total_frames,
            'fps': 30,
            'width': width,
            'height': height,
            'inputProps': {
                'clips': clip_data,
                'brand': brand,
                'captions': {
                    'enabled': bool(job.get('captions_enabled')),
                    'style': job.get('caption_style', 'clean'),
                    'position': job.get('caption_position', 'bottom'),
                    'srtPath': srt_path,
                },
                'bgm': {
                    'path': job.get('bgm_path', ''),
                    'volume': float(job.get('bgm_volume', 0.3)),
                },
                'transition': {
                    'type': template_config.get('transition_style', 'crossfade'),
                    'durationFrames': template_config.get('transition_frames', 15),
                },
            },
        }

        config_path = output_dir / "remotion-config.json"
        config_path.write_text(json.dumps(config, indent=2))

        # Render via subprocess
        return self._render(config_path, output_path)

    def get_templates(self):
        templates = []
        if TEMPLATE_DEFAULTS.exists():
            try:
                data = json.loads(TEMPLATE_DEFAULTS.read_text())
                templates = data.get('templates', [])
            except (json.JSONDecodeError, OSError):
                pass
        return templates

    def _build_clip_data(self, db, cjob_id, clips, narr_dir):
        """Build clip data array from approved assets."""
        broll = {r['clip_index']: dict(r) for r in db.execute(
            "SELECT * FROM cinematic_assets WHERE cjob_id=? "
            "AND asset_type='video_clip' AND status='approved' "
            "ORDER BY clip_index", (cjob_id,)).fetchall()}

        pres = {r['clip_index']: dict(r) for r in db.execute(
            "SELECT * FROM cinematic_assets WHERE cjob_id=? "
            "AND asset_type='presenter_clip' "
            "AND status IN ('generated','approved') "
            "ORDER BY clip_index", (cjob_id,)).fetchall()}

        if not broll and not pres:
            return []

        result = []
        for clip in clips:
            idx = clip.get('index', 0)
            asset = broll.get(idx) or pres.get(idx)
            if not asset or not asset.get('file_path'):
                continue
            clip_type = clip.get('type', 'cinematic')
            duration = clip.get('duration_sec', 6)

            # Find narration audio for this clip
            narr_path = ""
            narr_dur = 0
            narr_file = narr_dir / f"clip-{idx+1:02d}.mp3"
            if narr_file.exists():
                narr_path = str(narr_file)
                try:
                    from cinematic.utils import get_duration
                    narr_dur = get_duration(narr_path)
                except Exception:
                    narr_dur = duration

            result.append({
                'index': idx,
                'type': clip_type,
                'filePath': asset['file_path'],
                'durationSec': duration,
                'narrationPath': narr_path,
                'narrationDurationSec': narr_dur,
            })
        return result

    def _load_brand_config(self):
        """Load brand config from client template overrides."""
        defaults = {
            'colors': ['#1a1a2e', '#16213e', '#0f3460', '#e94560'],
            'font': 'Inter',
            'introText': '',
            'outroText': '',
        }
        if CLIENT_TEMPLATES.exists():
            try:
                data = json.loads(CLIENT_TEMPLATES.read_text())
                brand = data.get('brand', {})
                defaults.update({k: v for k, v in brand.items() if v})
            except (json.JSONDecodeError, OSError):
                pass
        return defaults

    def _load_template_config(self):
        """Load template customization (transitions, etc.)."""
        defaults = {
            'transition_style': 'crossfade',
            'transition_frames': 15,
        }
        if CLIENT_TEMPLATES.exists():
            try:
                data = json.loads(CLIENT_TEMPLATES.read_text())
                defaults.update({k: v for k, v in data.items()
                                 if k != 'brand' and v})
            except (json.JSONDecodeError, OSError):
                pass
        return defaults

    def _render(self, config_path, output_path):
        """Spawn Remotion render subprocess and wait for completion."""
        if not RENDER_SCRIPT.exists():
            print(f"  [remotion] render.js not found at {RENDER_SCRIPT}")
            return None

        node = "/opt/homebrew/bin/node"
        if not os.path.isfile(node):
            node = "node"

        cmd = [node, str(RENDER_SCRIPT),
               "--config", str(config_path),
               "--output", output_path]

        print(f"  [remotion] Starting render: {output_path}")
        try:
            result = subprocess.run(
                cmd, capture_output=True, text=True, timeout=600,
                cwd=str(REMOTION_DIR),
                env={**os.environ,
                     'PATH': f"/opt/homebrew/bin:/opt/homebrew/sbin:"
                             f"{os.environ.get('PATH', '/usr/bin:/bin')}"})

            if result.returncode != 0:
                print(f"  [remotion] Render failed (exit {result.returncode})")
                if result.stderr:
                    for line in result.stderr.strip().split('\n')[-5:]:
                        print(f"    {line}")
                return None

            if os.path.isfile(output_path) and os.path.getsize(output_path) > 100_000:
                mb = os.path.getsize(output_path) / 1048576
                print(f"  [remotion] Render complete: {mb:.1f}MB")
                return output_path
            else:
                print("  [remotion] Output file missing or too small")
                return None

        except subprocess.TimeoutExpired:
            print("  [remotion] Render timed out (10min)")
            return None
        except FileNotFoundError:
            print(f"  [remotion] Node.js not found: {node}")
            return None
