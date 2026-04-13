#!/bin/bash
# generate-social-image.sh — Generate images for social posts using the configured image provider.
# Generates per-platform-format images: e.g., 4:5 for Instagram, 16:9 for X.
# Deduplicates: same ratio across platforms = one generation.
#
# Usage: generate-social-image.sh [--job-id <id>]
#   Without --job-id: processes all image_post jobs with no image_path.
#   With --job-id: processes only that specific job.

source /opt/AIWH/core/scripts/lib/env.sh
set -euo pipefail

CLIENT_ROOT="${CLIENT_ROOT:-/opt/AIWH/client}"
DB_PATH="$CLIENT_ROOT/data/video-jobs.db"
PROVIDERS_CONFIG="$CLIENT_ROOT/config/cinematic-providers.json"
PILLARS_CONFIG="$CLIENT_ROOT/config/content-pillars.json"
SOCIAL_DIR="$CLIENT_ROOT/content/social"
SCRIPT_LIB="$(dirname "$0")/lib"

log() { echo "[$(date -u +%H:%M:%S)] social-image: $*"; }

# Check image provider config
IMAGE_PROVIDER=$(python3 -c "
import json, sys
try:
    with open(sys.argv[1]) as f: cfg = json.load(f)
    print(cfg.get('image', {}).get('provider', 'none'))
except Exception: print('none')
" "$PROVIDERS_CONFIG" 2>/dev/null)

if [ "$IMAGE_PROVIDER" = "none" ] || [ -z "$IMAGE_PROVIDER" ]; then
    log "Image provider not configured — upload images manually via dashboard"
    exit 0
fi

log "Image provider: $IMAGE_PROVIDER"

JOB_FILTER=""
if [ "${1:-}" = "--job-id" ] && [ -n "${2:-}" ]; then
    JOB_FILTER="$2"
fi

# Query jobs + generate per-platform-format images + update DB
python3 -c "
import json, os, sys, sqlite3
from datetime import datetime, timezone

sys.path.insert(0, '$SCRIPT_LIB')
os.environ.setdefault('CLIENT_ROOT', '$CLIENT_ROOT')

from cinematic.providers import get_provider
from format_resolver import resolve_format, imagen_ratio

db = sqlite3.connect('$DB_PATH')
db.row_factory = sqlite3.Row

where = \"content_type='image_post' AND (image_path IS NULL OR image_path='') AND status IN ('draft','pending_review')\"
job_filter = '$JOB_FILTER'
if job_filter:
    where += f\" AND job_id='{job_filter}'\"
jobs = db.execute(f'SELECT job_id, script, topic, pillar, platform_targets FROM video_jobs WHERE {where}').fetchall()

if not jobs:
    print('  No image posts need generation')
    sys.exit(0)

print(f'  Found {len(jobs)} image post(s) to generate')
provider = get_provider('image')

# Load target platforms
try:
    with open('$PILLARS_CONFIG') as f:
        pillars = json.load(f)
    default_platforms = pillars.get('target_platforms', ['instagram'])
except Exception:
    default_platforms = ['instagram']

now = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
updated = 0

for job in jobs:
    job_id = job['job_id']
    prompt = job['script'] or job['topic'] or ''
    if not prompt:
        print(f'  {job_id}: no image prompt — skipping')
        continue

    # Get target platforms from job or defaults
    try:
        pt = json.loads(job['platform_targets']) if job['platform_targets'] else default_platforms
        if isinstance(pt, dict): pt = list(pt.keys())
    except Exception:
        pt = default_platforms

    # Collect unique ratios needed per platform
    ratio_platforms = {}  # ratio -> [platforms]
    for platform in pt:
        ratio = resolve_format(platform, 'image_post', '$PILLARS_CONFIG')
        if ratio:
            ratio_platforms.setdefault(ratio, []).append(platform)

    if not ratio_platforms:
        print(f'  {job_id}: no platforms support image_post format — skipping')
        continue

    # Generate one image per unique ratio (with Imagen compat + crop)
    image_map = {}  # ratio -> path
    for ratio, platforms in ratio_platforms.items():
        folder_name = platforms[0]
        dest_dir = os.path.join('$SOCIAL_DIR', folder_name, 'images')
        os.makedirs(dest_dir, exist_ok=True)
        safe_ratio = ratio.replace(':', 'x')
        filename = f'{job_id}_{safe_ratio}.png'

        # Map to Imagen-compatible ratio if needed
        gen_ratio, needs_crop = imagen_ratio(ratio)
        plat_list = ', '.join(platforms)
        gen_label = f'{gen_ratio}→crop→{ratio}' if needs_crop else ratio
        print(f'  {job_id}: generating {gen_label} for {plat_list}...')
        result = provider.generate(prompt, dest_dir, filename, gen_ratio)
        if result and needs_crop:
            # Crop to exact target ratio using sips (macOS) or ffmpeg
            import subprocess
            w, h = ratio.split(':')
            target_w, target_h = int(w), int(h)
            # Read actual dimensions
            probe = subprocess.run(['sips', '-g', 'pixelWidth', '-g', 'pixelHeight', result],
                                   capture_output=True, text=True)
            dims = {}
            for line in probe.stdout.splitlines():
                if 'pixelWidth' in line: dims['w'] = int(line.split(':')[-1].strip())
                if 'pixelHeight' in line: dims['h'] = int(line.split(':')[-1].strip())
            if dims.get('w') and dims.get('h'):
                src_w, src_h = dims['w'], dims['h']
                # Calculate crop dimensions maintaining target ratio
                crop_h = int(src_w * target_h / target_w)
                if crop_h > src_h:
                    crop_w = int(src_h * target_w / target_h)
                    crop_h = src_h
                else:
                    crop_w = src_w
                # Center crop
                off_x = (src_w - crop_w) // 2
                off_y = (src_h - crop_h) // 2
                crop_file = result.replace('.png', f'_crop.png')
                subprocess.run(['sips', '-c', str(crop_h), str(crop_w), result, '--out', crop_file],
                               capture_output=True)
                if os.path.exists(crop_file) and os.path.getsize(crop_file) > 0:
                    os.replace(crop_file, result)
                    print(f'    cropped {src_w}x{src_h} → {crop_w}x{crop_h} ({ratio})')
        if result and os.path.exists(result):
            image_map[ratio] = result
            print(f'    saved: {result}')
        else:
            print(f'    generation failed for {ratio}')

    if not image_map:
        print(f'  {job_id}: all generations failed')
        continue

    # Update DB: image_paths (JSON map) + image_path (primary, backward compat)
    primary_path = list(image_map.values())[0]
    db.execute(
        'UPDATE video_jobs SET image_path=?, image_paths=?, updated_at=? WHERE job_id=?',
        (primary_path, json.dumps(image_map), now, job_id)
    )
    updated += 1

db.commit()
db.close()
print(f'Updated {updated} job(s) with image paths')
" 2>&1

log "Done"
