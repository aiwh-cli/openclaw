"""Retry logic for failed/rejected cinematic assets.

Handles prompt rewriting with feedback, production plan updates,
and re-generation via image/video providers.
"""

import json
import os
import time

from cinematic.config import CINEMATIC_DIR, get_format
from cinematic.db import update_job
from cinematic.providers import get_provider
from cinematic.utils import now_iso, claude_chat, log_cost


def retry_assets(db, job, retryable, fmt, cjob_id):
    """Retry failed/rejected assets. Returns (cost, success_count)."""
    cost = 0.0
    success = 0
    image_provider = get_provider('image')
    video_provider = get_provider('video')

    for asset in retryable:
        atype = asset['asset_type']
        clip_idx = asset['clip_index']
        prompt = asset['prompt']
        asset_id = asset['asset_id']
        rejection_notes = asset['grade_notes'] or ''

        # Rewrite prompt with feedback
        if rejection_notes:
            prompt = _rewrite_prompt_with_feedback(prompt, rejection_notes)
            _update_plan_with_feedback(
                db, job, asset, rejection_notes, prompt, cjob_id)

        if atype in ('ref_image', 'keyframe_first', 'keyframe_last'):
            c, s = _retry_image_asset(
                db, asset, prompt, fmt, cjob_id, image_provider)
            cost += c
            success += s

        elif atype == 'video_clip':
            c, s = _retry_video_asset(
                db, asset, prompt, fmt, cjob_id, video_provider)
            cost += c
            success += s
        else:
            print(f"  Skipping unsupported retry for {atype}")

    return cost, success


def _retry_image_asset(db, asset, prompt, fmt, cjob_id, provider):
    """Retry a single image asset. Returns (cost, success_int)."""
    atype = asset['asset_type']
    clip_idx = asset['clip_index']
    asset_id = asset['asset_id']
    ver = (asset['generation_version'] or 1) + 1

    if atype == 'ref_image':
        out_dir = CINEMATIC_DIR / cjob_id / "refs"
        filename = (f"ref-{clip_idx+1:02d}-v{ver}.png"
                    if clip_idx >= 0
                    else f"ref-retry-{asset_id[:8]}.png")
    else:
        out_dir = CINEMATIC_DIR / cjob_id / "keyframes"
        ktype = "first" if atype == "keyframe_first" else "last"
        filename = f"clip-{clip_idx+1:02d}-{ktype}-v{ver}.png"

    out_dir.mkdir(parents=True, exist_ok=True)
    print(f"  Retrying {atype} clip {clip_idx+1} (v{ver})...")
    img_path = provider.generate(
        prompt, str(out_dir), filename, aspect_ratio=fmt['aspect'])

    if img_path:
        db.execute(
            "UPDATE cinematic_assets SET status='generated', "
            "file_path=?, generation_version=?, updated_at=? "
            "WHERE asset_id=?",
            (img_path, ver, now_iso(), asset_id))
        db.commit()
        log_cost("google", "imagen-3", 0.04,
                 f"Retry {atype} v{ver} for {cjob_id}")
        time.sleep(8)
        return 0.04, 1
    else:
        print("    Still failed")
        time.sleep(8)
        return 0.0, 0


def _retry_video_asset(db, asset, prompt, fmt, cjob_id, provider):
    """Retry a single video clip asset. Returns (cost, success_int)."""
    clip_idx = asset['clip_index']
    asset_id = asset['asset_id']
    ver = (asset['generation_version'] or 1) + 1
    out_dir = CINEMATIC_DIR / cjob_id / "clips"
    out_dir.mkdir(parents=True, exist_ok=True)

    first_kf_path, last_kf_path = _find_keyframe_paths(db, asset)

    if not first_kf_path:
        print(f"  Clip {clip_idx+1}: No first keyframe, skipping")
        return 0.0, 0

    mode = "first+last frame" if last_kf_path else "single frame"
    print(f"  Retrying video_clip {clip_idx+1} v{ver} ({mode})...")
    op_name = provider.generate(
        prompt, first_kf_path, last_kf_path,
        duration=8, aspect_ratio=fmt['aspect'])

    if not op_name:
        print("    FAILED to submit")
        return 0.0, 0

    db.execute(
        "UPDATE cinematic_assets SET status='generating', "
        "runway_task_id=?, updated_at=? WHERE asset_id=?",
        (op_name, now_iso(), asset_id))
    db.commit()

    video_uri = provider.poll(op_name, timeout=600)
    if video_uri:
        vid_path = out_dir / f"clip-{clip_idx+1:02d}-v{ver}.mp4"
        if provider.download(video_uri, str(vid_path)):
            db.execute(
                "UPDATE cinematic_assets SET status='generated', "
                "file_path=?, generation_version=?, updated_at=? "
                "WHERE asset_id=?",
                (str(vid_path), ver, now_iso(), asset_id))
            db.commit()
            log_cost("google", "veo-3.1-fast", 0.80,
                     f"Retry clip {clip_idx+1} v{ver} for {cjob_id}")
            print(f"    Clip {clip_idx+1}: OK ({vid_path.name})")
            time.sleep(2)
            return 0.80, 1
        else:
            print(f"    Clip {clip_idx+1}: Download FAILED")
            db.execute(
                "UPDATE cinematic_assets SET status='failed', "
                "updated_at=? WHERE asset_id=?",
                (now_iso(), asset_id))
            db.commit()
    else:
        print(f"    Clip {clip_idx+1}: Veo timed out")
        db.execute(
            "UPDATE cinematic_assets SET status='failed', "
            "updated_at=? WHERE asset_id=?",
            (now_iso(), asset_id))
        db.commit()

    time.sleep(2)
    return 0.0, 0


def _rewrite_prompt_with_feedback(prompt, notes):
    """Rewrite an image/video prompt incorporating rejection feedback."""
    print(f"  Applying feedback: {notes[:80]}")
    rewrite = claude_chat(
        f"Rewrite this image generation prompt incorporating the "
        f"user's feedback.\n\nOriginal:\n{prompt}\n\n"
        f"Feedback:\n{notes}\n\n"
        f"Output ONLY the new prompt.",
        temperature=0.7, max_tokens=1500)
    if rewrite:
        prompt = rewrite.strip()
        print(f"  Rewritten prompt: {prompt[:120]}...")
    return prompt


def _update_plan_with_feedback(db, job, asset, notes, new_prompt,
                                cjob_id):
    """Update production plan prompts when assets get feedback."""
    if new_prompt == asset['prompt']:
        return

    plan = json.loads(job.get('production_plan') or '{}')
    clips = plan.get('clips', [])
    plan_updated = False
    atype = asset['asset_type']
    clip_idx = asset['clip_index']

    target_indices = _resolve_target_indices(
        atype, asset, clips, clip_idx)

    for pi in target_indices:
        clip = clips[pi]
        for field in ['first_frame_prompt', 'last_frame_prompt',
                       'video_prompt', 'image_gen_prompt']:
            old_val = clip.get(field, '')
            if not old_val:
                continue
            new_val = claude_chat(
                f"Rewrite this visual prompt with feedback.\n\n"
                f"Original:\n{old_val}\n\nFeedback:\n{notes}\n\n"
                f"Output ONLY the new prompt.",
                temperature=0.7, max_tokens=1500)
            if new_val:
                clips[pi][field] = new_val.strip()
                plan_updated = True

        old_narr = clip.get('narration_line', '')
        if old_narr:
            new_narr = claude_chat(
                f"Rewrite this narration line to match revised visuals."
                f"\n\nOriginal:\n{old_narr}\n\n"
                f"Visual feedback:\n{notes}\n\n"
                f"Keep 15-25 words. Output ONLY the new line.",
                temperature=0.7, max_tokens=200)
            if new_narr:
                clips[pi]['narration_line'] = new_narr.strip()
                plan_updated = True

    if plan_updated:
        plan['clips'] = clips
        new_plan_json = json.dumps(plan)
        all_lines = [c.get('narration_line', '') for c in clips
                      if c.get('narration_line')]
        new_script = '\n\n'.join(all_lines)
        update_job(db, cjob_id, production_plan=new_plan_json,
                   narration_script=new_script)
        (CINEMATIC_DIR / cjob_id / "production-plan.json").write_text(
            new_plan_json)
        (CINEMATIC_DIR / cjob_id / "narration-script.txt").write_text(
            new_script)
        job.update(dict(db.execute(
            "SELECT * FROM cinematic_jobs WHERE cjob_id=?",
            (cjob_id,)).fetchone()))
        print("  Updated production plan to match feedback")


def _resolve_target_indices(atype, asset, clips, clip_idx):
    """Resolve which clip indices to update based on asset type."""
    if atype == 'ref_image':
        seq = asset['sequence'] if asset['sequence'] is not None else -1
        if seq >= 0:
            cclips = [i for i, c in enumerate(clips)
                      if c.get('type', 'cinematic') == 'cinematic']
            if seq < len(cclips):
                return [cclips[seq]]
    elif clip_idx >= 0:
        return [
            i for i, c in enumerate(clips)
            if c.get('index', i) == clip_idx]
    return []


def _find_keyframe_paths(db, asset):
    """Find first and last keyframe file paths for a video clip."""
    ref_ids = json.loads(asset['reference_asset_ids'] or '[]')
    first_kf_path = None
    last_kf_path = None
    for rid in ref_ids:
        ref_row = db.execute(
            "SELECT * FROM cinematic_assets WHERE asset_id=?",
            (rid,)).fetchone()
        if (ref_row and ref_row['file_path']
                and os.path.exists(ref_row['file_path'])):
            if ref_row['asset_type'] == 'keyframe_first':
                first_kf_path = ref_row['file_path']
            elif ref_row['asset_type'] == 'keyframe_last':
                last_kf_path = ref_row['file_path']
    return first_kf_path, last_kf_path
