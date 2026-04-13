"""Phase handlers for the cinematic pipeline (phases 1-3 + assembly).

Phase 1 (analyze): LLM creates style bible + production plan.
Phase 2 (ref_images): Generate reference images via image provider.
Phase 3 (keyframes): Generate first/last keyframes per clip.
Phase 6 (assembly): FFmpeg concat + finalize.

Phases 4-5 are in generation.py (video_clips, narration).
"""

import json
import os
import subprocess
import time
from pathlib import Path

from cinematic.config import (
    CINEMATIC_DIR, CLIENT_ROOT, get_format, job_no_avatar,
)
from cinematic.db import (
    get_assets, get_job, insert_asset, update_job,
    auto_approve_generated,
)
from cinematic.providers import get_provider
from cinematic.utils import (
    claude_chat, log_cost, now_iso, realism_boost,
    get_duration, parse_json_response,
)

# Re-export generation phases so cli.py can import all from phases
from cinematic.generation import phase_video_clips, phase_narration  # noqa


def _get_provider_and_model():
    from llm_provider import get_provider_and_model
    return get_provider_and_model()


def _notify(message):
    try:
        get_provider('notify').send(message)
    except Exception:
        pass


def _fail_asset(db, asset_id):
    db.execute(
        "UPDATE cinematic_assets SET status='failed', "
        "updated_at=? WHERE asset_id=?", (now_iso(), asset_id))
    db.commit()


def _update_image_asset(db, asset_id, img_path, cjob_id, idx, label):
    if img_path:
        db.execute(
            "UPDATE cinematic_assets SET status='generated', "
            "file_path=?, updated_at=? WHERE asset_id=?",
            (img_path, now_iso(), asset_id))
        db.commit()
        log_cost("google", "imagen-3", 0.04,
                 f"{label} clip {idx+1} for {cjob_id}")
        return 0.04
    _fail_asset(db, asset_id)
    print("    FAILED")
    return 0.0


# ── Phase 1: Analyze ─────────────────────────────────────────────

def phase_analyze(db, job):
    """Use LLM to create style bible + production plan from brief."""
    cjob_id = job['cjob_id']
    job_dir = CINEMATIC_DIR / cjob_id
    job_dir.mkdir(parents=True, exist_ok=True)
    (job_dir / "brief.md").write_text(job['brief'])

    learned_context = _query_knowledge(job)
    ref_images, ref_context = _load_ref_images(job_dir)
    duration = job['target_duration_sec']
    prompt = _build_analysis_prompt(job, duration, ref_context,
                                     ref_images, learned_context)

    label = (f" (with {len(ref_images)} reference images)"
             if ref_images else "")
    print(f"  Calling Claude for analysis{label}...")
    result = claude_chat(prompt, temperature=0.8, max_tokens=16000,
                         images=ref_images if ref_images else None)
    if not result:
        update_job(db, cjob_id, phase='failed',
                   error_message='Claude analysis failed')
        return

    try:
        data = parse_json_response(result)
    except json.JSONDecodeError as e:
        (job_dir / "analysis_raw.txt").write_text(result)
        update_job(db, cjob_id, phase='failed',
                   error_message=f'JSON parse failed: {e}')
        return

    style_bible = json.dumps(data.get("style_bible", {}))
    production_plan = json.dumps(data.get("production_plan", {}))
    narration = data.get("narration_script", "")

    (job_dir / "style-bible.json").write_text(style_bible)
    (job_dir / "production-plan.json").write_text(production_plan)
    if narration:
        (job_dir / "narration-script.txt").write_text(narration)

    _ensure_ref_analysis(ref_images, data.get("ref_analysis", []),
                          job_dir)
    clip_count = len(data.get("production_plan", {}).get("clips", []))

    update_job(db, cjob_id,
               phase='analysis_review', style_bible=style_bible,
               production_plan=production_plan,
               narration_script=narration, clip_count=clip_count,
               total_cost_usd=job['total_cost_usd'] + 0.05)

    prov, model, _ = _get_provider_and_model()
    log_cost(prov, model, 0.05, f"Analysis for {cjob_id}")

    plan_data = data.get("production_plan", {})
    pc = sum(1 for c in plan_data.get("clips", [])
             if c.get("type") == "presenter")
    _notify(
        f"**Analysis Ready**\n> **Job:** {cjob_id}\n"
        f"> **Title:** {job['title']}\n"
        f"> **Clips:** {clip_count} ({pc} presenter)\n"
        f"> **Duration:** {job['target_duration_sec']}s\n\n"
        f"Review: http://localhost:3001/#production")
    print("  Analysis complete. Phase: analysis_review")


# ── Phase 2: Reference Images ────────────────────────────────────

def phase_ref_images(db, job):
    """Generate reference images using image provider."""
    cjob_id = job['cjob_id']
    job_dir = CINEMATIC_DIR / cjob_id / "refs"
    job_dir.mkdir(parents=True, exist_ok=True)

    style = json.loads(job['style_bible'] or '{}')
    plan = json.loads(job['production_plan'] or '{}')
    cinematic = [c for c in plan.get('clips', [])
                 if c.get('type') == 'cinematic']
    ref_prompts = _build_ref_prompts(cinematic, style)

    fmt = get_format(job)
    img = get_provider('image')
    print(f"  Generating {len(ref_prompts)} ref images ({fmt['aspect']})")
    cost = 0.0

    for i, prompt in enumerate(ref_prompts):
        print(f"  [{i+1}/{len(ref_prompts)}] Generating...")
        aid = insert_asset(db, cjob_id, 'ref_image', -1,
                           prompt, sequence=i)
        path = img.generate(prompt, str(job_dir),
                            f"ref-{i+1:02d}-v1.png",
                            aspect_ratio=fmt['aspect'])
        if path:
            db.execute(
                "UPDATE cinematic_assets SET status='generated', "
                "file_path=?, updated_at=? WHERE asset_id=?",
                (path, now_iso(), aid))
            db.commit()
            cost += 0.04
            log_cost("google", "imagen-3", 0.04,
                     f"Ref image {i+1} for {cjob_id}")
        else:
            _fail_asset(db, aid)
        time.sleep(8)

    update_job(db, cjob_id, phase='ref_review',
               total_cost_usd=job['total_cost_usd'] + cost)

    aa = auto_approve_generated(db, job, 'ref_image')
    gen = len(get_assets(db, cjob_id, 'ref_image', 'generated'))
    fail = len(get_assets(db, cjob_id, 'ref_image', 'failed'))
    if aa > 0 and gen == 0 and fail == 0:
        print("  All auto-approved, advancing to keyframes")
        update_job(db, cjob_id, phase='keyframes')
        return

    _notify(
        f"**Ref Images Ready**\n> **Job:** {cjob_id}\n"
        f"> {gen} to review ({aa} auto-approved) (${cost:.2f})\n\n"
        f"Review: http://localhost:3001/#production")
    print(f"  {gen} ref images. Phase: ref_review")


# ── Phase 3: Keyframes ───────────────────────────────────────────

def phase_keyframes(db, job):
    """Generate first and last keyframes per cinematic clip."""
    cjob_id = job['cjob_id']
    job_dir = CINEMATIC_DIR / cjob_id / "keyframes"
    job_dir.mkdir(parents=True, exist_ok=True)

    fmt = get_format(job)
    style = json.loads(job['style_bible'] or '{}')
    plan = json.loads(job['production_plan'] or '{}')
    clips = plan.get('clips', [])

    refs = get_assets(db, cjob_id, 'ref_image', 'approved')
    ref_ids = json.dumps([r['asset_id'] for r in refs])

    img = get_provider('image')
    cost = 0.0
    cc = 0
    suffix = _build_style_suffix(style)

    for clip in clips:
        idx = clip.get('index', 0)
        if clip.get('type', 'cinematic') == 'presenter':
            continue
        cc += 1

        # First keyframe
        base = clip.get('first_frame_prompt',
                        clip.get('image_gen_prompt',
                                 clip.get('description', '')))
        prompt, _ = realism_boost(f"{base} {suffix}", clip)
        print(f"  Clip {idx+1} FIRST...")
        aid = insert_asset(db, cjob_id, 'keyframe_first', idx,
                           prompt, sequence=0,
                           reference_asset_ids=ref_ids)
        path = img.generate(prompt, str(job_dir),
                            f"clip-{idx+1:02d}-first-v1.png",
                            aspect_ratio=fmt['aspect'])
        cost += _update_image_asset(db, aid, path, cjob_id, idx, "First")
        time.sleep(8)

        # Last keyframe
        last_base = clip.get('last_frame_prompt', '')
        if not last_base:
            continue
        prompt, _ = realism_boost(f"{last_base} {suffix}", clip)
        print(f"  Clip {idx+1} LAST...")
        aid = insert_asset(db, cjob_id, 'keyframe_last', idx,
                           prompt, sequence=0,
                           reference_asset_ids=ref_ids)
        path = img.generate(prompt, str(job_dir),
                            f"clip-{idx+1:02d}-last-v1.png",
                            aspect_ratio=fmt['aspect'])
        cost += _update_image_asset(db, aid, path, cjob_id, idx, "Last")
        time.sleep(8)

    update_job(db, cjob_id, phase='keyframe_review',
               total_cost_usd=job['total_cost_usd'] + cost)

    af = auto_approve_generated(db, job, 'keyframe_first')
    al = auto_approve_generated(db, job, 'keyframe_last')
    fg = len(get_assets(db, cjob_id, 'keyframe_first', 'generated'))
    lg = len(get_assets(db, cjob_id, 'keyframe_last', 'generated'))
    ff = len(get_assets(db, cjob_id, 'keyframe_first', 'failed'))
    lf = len(get_assets(db, cjob_id, 'keyframe_last', 'failed'))

    if (af + al) > 0 and fg + lg + ff + lf == 0:
        print("  All auto-approved, advancing to video_clips")
        update_job(db, cjob_id, phase='video_clips')
        return

    _notify(
        f"**Keyframes Ready**\n> **Job:** {cjob_id}\n"
        f"> {fg}+{lg} to review ({af+al} auto-approved)\n\n"
        f"Review: http://localhost:3001/#production")
    print(f"  {fg} first + {lg} last. Phase: keyframe_review")


# ── Phase 6: Assembly ─────────────────────────────────────────────

def phase_assembly(db, job):
    """Compose final video via the configured compositor provider.

    Dispatches to the compositor registered in cinematic-providers.json
    (default: ffmpeg). The compositor handles clip assembly, normalization,
    BGM mixing, and caption burn-in.
    """
    cjob_id = job['cjob_id']
    job_dir = CINEMATIC_DIR / cjob_id
    narr_dir = job_dir / "narration"
    output_dir = job_dir / "output"
    output_dir.mkdir(parents=True, exist_ok=True)
    fmt = get_format(job)
    sf = (f"scale={fmt['scale']}:force_original_aspect_ratio"
          f"=decrease,pad={fmt['scale']}:-1:-1:color=black")

    plan = json.loads(job['production_plan'] or '{}')
    clips = plan.get('clips', [])

    try:
        compositor = get_provider('compositor')
    except ValueError:
        # Fallback: if no compositor registered, use FFmpeg directly
        from cinematic.providers.compositor.ffmpeg_compositor import (
            FFmpegCompositor,
        )
        compositor = FFmpegCompositor({})

    print(f"  Compositor: {compositor.__class__.__name__}")
    final = compositor.compose(clips, narr_dir, output_dir, job, fmt, sf)

    if not final:
        update_job(db, cjob_id, phase='failed',
                   error_message='Assembly failed')
        return

    mb = os.path.getsize(final) / 1048576
    dur = get_duration(str(final))
    print(f"  Final: {final} ({mb:.1f}MB, {dur:.0f}s)")
    update_job(db, cjob_id, phase='final_review')

    _notify(
        f"**Final Review**\n> **Job:** {cjob_id}\n"
        f"> {dur:.0f}s | {mb:.1f}MB | ${job['total_cost_usd']:.2f}\n\n"
        f"Review: http://localhost:3001/#production")
    print("  Assembly complete. Phase: final_review")


# ── Helpers ───────────────────────────────────────────────────────

def _query_knowledge(job):
    try:
        script = "/opt/AIWH/core/scripts/knowledge-search-unified.sh"
        if not os.path.isfile(script):
            return ""
        r = subprocess.run(
            ["bash", script, "--query",
             f"cinematic style {job.get('title', '')}",
             "--agent", "video", "--count", "5"],
            capture_output=True, text=True, timeout=30,
            env={**os.environ, "CLIENT_ROOT": CLIENT_ROOT})
        if r.returncode == 0 and r.stdout.strip():
            knowledge = json.loads(r.stdout)
            items = [f"- [{k.get('knowledge_type','?')}] {k['content']}"
                     for k in knowledge if k.get('similarity', 0) > 0.3]
            if items:
                return ("\n\nLEARNED VISUAL PREFERENCES:\n"
                        + "\n".join(items[:5]))
    except Exception:
        pass
    return ""


def _load_ref_images(job_dir):
    ref_images = []
    ref_dir = job_dir / "input-refs"
    if ref_dir.is_dir():
        for f in sorted(ref_dir.iterdir()):
            if f.suffix.lower() in ('.png', '.jpg', '.jpeg',
                                     '.webp', '.gif'):
                ref_images.append(str(f))
    ref_context = ""
    if ref_images:
        print(f"  {len(ref_images)} reference image(s)")
        ref_context = (
            f"\n\nREFERENCE IMAGES: {len(ref_images)} attached. "
            "Describe EXACT appearance. Include 'ref_analysis' key.")
    return ref_images, ref_context


def _ensure_ref_analysis(ref_images, ref_analysis, job_dir):
    valid = [a for a in ref_analysis
             if a.get("description", "") not in ("N/A", "", "n/a")]
    if ref_images and not valid:
        r = claude_chat(
            f"Analyze {len(ref_images)} reference image(s). "
            "Respond with JSON array.", temperature=0.3,
            max_tokens=2000, images=ref_images)
        if r:
            try:
                ref_analysis = parse_json_response(r)
            except json.JSONDecodeError:
                pass
    if ref_analysis and any(a.get("description", "") for a in ref_analysis):
        (job_dir / "ref-analysis.json").write_text(
            json.dumps(ref_analysis, indent=2))


def _build_ref_prompts(cinematic_clips, style):
    palette = ', '.join(style.get('color_palette', ['cinematic tones']))
    mood = style.get('mood', 'cinematic')
    lighting = style.get('lighting', 'dramatic lighting')
    theme = style.get('visual_theme', 'cinematic')
    negative = style.get('negative_keywords', 'No text, no watermarks')

    prompts, seen = [], set()
    for clip in cinematic_clips:
        text = clip.get('first_frame_prompt',
                        clip.get('image_gen_prompt',
                                 clip.get('description', '')))
        key = ' '.join(text.split()[:6]).lower()
        if key not in seen and len(prompts) < 6:
            seen.add(key)
            prompts.append(text)
    while len(prompts) < 4:
        prompts.append(
            f"Cinematic establishing shot. {theme}. "
            f"{palette}. {mood}. {lighting}. Photorealistic. {negative}")
    return prompts


def _build_style_suffix(style):
    palette = ', '.join(style.get('color_palette', []))
    mood = style.get('mood', 'cinematic')
    lighting = style.get('lighting', 'dramatic')
    negative = style.get('negative_keywords', 'No text, no watermarks')
    return (f"Cinematic still frame. {mood}. {lighting}. "
            f"Color palette: {palette}. Photorealistic. {negative}")


def _build_analysis_prompt(job, duration, ref_context, ref_images,
                            learned_context):
    no_avatar = job_no_avatar(job)
    ref_schema = ""
    if ref_images:
        ref_schema = (',\n  "ref_analysis": '
                      '[{"filename": "...", "description": "..."}]')

    return f"""You are an elite cinematic video director. Create a production plan.

CREATIVE BRIEF:
{job['brief']}
{ref_context}

TARGET DURATION: {duration} seconds (STRICT — do not exceed this)

CLIP RULES:
- Cinematic clips: 5-8 seconds raw
- Presenter clips: 8-15 seconds each
- MAXIMUM {duration // 5} clips total (strict limit, sum of clip durations must not exceed {duration}s)
- Presenter ~20-30% of total
- If target is under 60s, keep to {max(2, duration // 8)}-{duration // 5} clips only

Respond with JSON (no markdown fences):
{{
  "style_bible": {{
    "color_palette": ["6 hex colors"], "mood": "...", "lighting": "...",
    "visual_references": "...", "visual_theme": "...",
    "texture_and_grade": "...", "negative_keywords": "..."
  }},
  "production_plan": {{
    "narrative_arc": "...",
    "clips": [{{
      "index": 0, "type": "cinematic or presenter", "duration_sec": 6,
      "description": "...", "first_frame_prompt": "80-150 words",
      "last_frame_prompt": "80-150 words", "action_prompt": "30-60 words",
      "camera_motion": "...", "narration_line": "15-25 words"
    }}]
  }},
  "narration_script": "~{duration * 150 // 60} words"{ref_schema}
}}

CRITICAL: first/last frame prompts MUST be visually distinct.
HYPER-REALISM FOR PEOPLE: include skin texture directives.
{'ALL clips must be type "cinematic" (no presenter).' if no_avatar else ''}
{learned_context}

Respond with ONLY valid JSON."""
