"""Generation phase handlers: video_clips and narration.

Phase 4 (video_clips): Generate video from approved keyframes.
Phase 5 (narration): Generate TTS audio + presenter avatar clips.
"""

import json
import os
import time

from cinematic.config import (
    CINEMATIC_DIR, get_format, job_no_avatar,
)
from cinematic.db import (
    get_assets, insert_asset, update_job,
    auto_approve_generated,
)
from cinematic.providers import get_provider
from cinematic.utils import (
    log_cost, now_iso, download_file,
)


def _notify(message):
    """Send notification via configured provider."""
    try:
        get_provider('notify').send(message)
    except Exception:
        pass


def _fail_asset(db, asset_id):
    """Mark an asset as failed."""
    db.execute(
        "UPDATE cinematic_assets SET status='failed', "
        "updated_at=? WHERE asset_id=?", (now_iso(), asset_id))
    db.commit()


# ── Phase 4: Video Clips ─────────────────────────────────────────

def phase_video_clips(db, job):
    """Generate video clips from approved keyframes via video provider."""
    cjob_id = job['cjob_id']
    job_dir = CINEMATIC_DIR / cjob_id / "clips"
    job_dir.mkdir(parents=True, exist_ok=True)

    plan = json.loads(job['production_plan'] or '{}')
    clips = plan.get('clips', [])
    style = json.loads(job['style_bible'] or '{}')
    fmt = get_format(job)
    video_provider = get_provider('video')
    cost = 0.0

    for clip in clips:
        idx = clip.get('index', 0)
        if clip.get('type', 'cinematic') == 'presenter':
            continue

        first_kf = db.execute(
            "SELECT * FROM cinematic_assets WHERE cjob_id=? "
            "AND clip_index=? AND asset_type='keyframe_first' "
            "AND status='approved' ORDER BY generation_version "
            "DESC LIMIT 1", (cjob_id, idx)).fetchone()

        if not first_kf or not first_kf['file_path']:
            print(f"  Clip {idx+1}: No approved first keyframe")
            continue

        last_kf = db.execute(
            "SELECT * FROM cinematic_assets WHERE cjob_id=? "
            "AND clip_index=? AND asset_type='keyframe_last' "
            "AND status='approved' ORDER BY generation_version "
            "DESC LIMIT 1", (cjob_id, idx)).fetchone()

        last_kf_path = (
            last_kf['file_path']
            if (last_kf and last_kf['file_path']
                and os.path.exists(last_kf['file_path']))
            else None)

        motion_prompt = _build_motion_prompt(clip, style)
        ref_ids = [first_kf['asset_id']]
        if last_kf:
            ref_ids.append(last_kf['asset_id'])
        asset_id = insert_asset(db, cjob_id, 'video_clip', idx,
                                motion_prompt, sequence=0,
                                reference_asset_ids=json.dumps(ref_ids))

        mode = "first+last frame" if last_kf_path else "single frame"
        print(f"  Clip {idx+1}: Submitting ({mode})...")
        op_name = video_provider.generate(
            motion_prompt, first_kf['file_path'], last_kf_path,
            duration=8, aspect_ratio=fmt['aspect'])

        if not op_name:
            _fail_asset(db, asset_id)
            print("    FAILED to submit")
            continue

        db.execute(
            "UPDATE cinematic_assets SET status='generating', "
            "runway_task_id=?, updated_at=? WHERE asset_id=?",
            (op_name, now_iso(), asset_id))
        db.commit()

        print(f"    Operation: {op_name[:60]}...")
        video_uri = video_provider.poll(op_name, timeout=600)

        if video_uri:
            vid_path = job_dir / f"clip-{idx+1:02d}-v1.mp4"
            if video_provider.download(video_uri, str(vid_path)):
                db.execute(
                    "UPDATE cinematic_assets SET status='generated', "
                    "file_path=?, updated_at=? WHERE asset_id=?",
                    (str(vid_path), now_iso(), asset_id))
                db.commit()
                cost += 0.80
                log_cost("google", "veo-3.1-fast", 0.80,
                         f"Video clip {idx+1} ({mode}) for {cjob_id}")
                print(f"    Clip {idx+1}: OK ({vid_path.name})")
            else:
                _fail_asset(db, asset_id)
                print(f"    Clip {idx+1}: Download FAILED")
        else:
            _fail_asset(db, asset_id)
            print(f"    Clip {idx+1}: Generation FAILED")
        time.sleep(2)

    update_job(db, cjob_id, phase='clip_review',
               total_cost_usd=job['total_cost_usd'] + cost)

    auto_approved = auto_approve_generated(db, job, 'video_clip')
    generated = len(get_assets(db, cjob_id, 'video_clip', 'generated'))
    clip_failed = len(get_assets(db, cjob_id, 'video_clip', 'failed'))
    if auto_approved > 0 and generated == 0 and clip_failed == 0:
        print("  All video clips auto-approved, advancing to narration")
        update_job(db, cjob_id, phase='narration')
        return

    _notify(
        f"**Video Clips Ready for Review**\n"
        f"> **Job:** {cjob_id} | **Title:** {job['title']}\n"
        f"> {generated} clips ({auto_approved} auto-approved) "
        f"(${cost:.2f})\n\n"
        f"Review in dashboard: http://localhost:3001/#production")
    print(f"  {generated} clips to review. Phase: clip_review")


# ── Phase 5: Narration ───────────────────────────────────────────

def phase_narration(db, job):
    """Generate per-clip narration audio + presenter clips."""
    cjob_id = job['cjob_id']
    job_dir = CINEMATIC_DIR / cjob_id
    narr_dir = job_dir / "narration"
    narr_dir.mkdir(parents=True, exist_ok=True)

    plan = json.loads(job['production_plan'] or '{}')
    clips = plan.get('clips', [])
    voice_id = job.get('voice_id') or None
    avatar_id = job.get('avatar_look_id') or None

    fmt = get_format(job)
    tts = get_provider('tts')
    avatar = get_provider('avatar')
    storage = get_provider('storage')
    cost = 0.0
    script = job.get('narration_script', '')

    if script:
        full_narr = narr_dir / "narration-full.mp3"
        print("  Generating full narration...")
        if tts.synthesize(script, str(full_narr), voice_id):
            print(f"    Saved ({os.path.getsize(full_narr)//1024}KB)")
            cost += 0.15
            log_cost("elevenlabs", "multilingual_v2", 0.15,
                     f"Full narration for {cjob_id}")

    print(f"  Per-clip narration for {len(clips)} clips...")
    presenter_count = presenter_ok = 0

    for clip in clips:
        idx = clip.get('index', 0)
        narr_line = clip.get('narration_line', '')
        clip_type = clip.get('type', 'cinematic')
        if not narr_line:
            continue

        clip_audio = narr_dir / f"clip-{idx+1:02d}-narration.mp3"
        clip_srt = narr_dir / f"clip-{idx+1:02d}-narration.srt"
        print(f"  Clip {idx+1} ({clip_type}): narration...")

        if job.get('captions_enabled', 0):
            ok = tts.synthesize_with_timestamps(
                narr_line, str(clip_audio), str(clip_srt), voice_id)
        else:
            ok = tts.synthesize(narr_line, str(clip_audio), voice_id)

        if not ok:
            print(f"    Failed clip {idx+1}")
            continue

        per_cost = max(0.005, len(narr_line) * 0.00003)
        cost += per_cost
        log_cost("elevenlabs", "multilingual_v2", per_cost,
                 f"Clip {idx+1} narration for {cjob_id}")

        if clip_type == 'presenter' and not job_no_avatar(job):
            presenter_count += 1
            c, s = _generate_presenter_clip(
                db, cjob_id, clip, idx, clip_audio, avatar_id,
                fmt, job_dir, avatar, storage)
            cost += c
            presenter_ok += s

    update_job(db, cjob_id, phase='assembly',
               total_cost_usd=job['total_cost_usd'] + cost)
    _notify(
        f"**Narration Complete**\n"
        f"> **Job:** {cjob_id} | Presenter: {presenter_ok}/"
        f"{presenter_count} | Cost: ${cost:.2f}")
    print(f"  Narration + {presenter_ok}/{presenter_count} presenters. "
          f"Phase: assembly")


# ── Internal helpers ──────────────────────────────────────────────

def _build_motion_prompt(clip, style):
    """Build motion prompt for video generation."""
    action = clip.get('action_prompt', '')
    motion = clip.get('camera_motion', 'slow cinematic movement')
    prompt = "Photorealistic cinematic scene."
    if action:
        prompt += f" {action}"
    prompt += f" Camera: {motion}."
    prompt += (f" {style.get('mood', 'Cinematic')}, "
               "hyper-realistic, film grain.")
    return prompt


def _generate_presenter_clip(db, cjob_id, clip, idx, clip_audio,
                              avatar_id, fmt, job_dir, avatar, storage):
    """Generate a single HeyGen presenter clip. Returns (cost, 0|1)."""
    print(f"  Clip {idx+1}: Generating presenter...")
    audio_url = storage.upload(str(clip_audio))
    if not audio_url:
        print("    Skipping: upload failed")
        return 0.0, 0

    video_id = avatar.submit(
        audio_url, avatar_id,
        width=fmt['width'], height=fmt['height'])
    if not video_id:
        print("    Skipping: submit failed")
        return 0.0, 0

    narr_line = clip.get('narration_line', '')
    aid = insert_asset(db, cjob_id, 'presenter_clip', idx,
                       clip.get('description', narr_line))
    db.execute(
        "UPDATE cinematic_assets SET status='generating', "
        "runway_task_id=? WHERE asset_id=?", (video_id, aid))
    db.commit()

    video_url = avatar.poll(video_id)
    if video_url:
        clips_dir = job_dir / "clips"
        clips_dir.mkdir(parents=True, exist_ok=True)
        clip_path = clips_dir / f"presenter-{idx+1:02d}-v1.mp4"
        if download_file(video_url, clip_path):
            db.execute(
                "UPDATE cinematic_assets SET status='generated', "
                "file_path=?, updated_at=? WHERE asset_id=?",
                (str(clip_path), now_iso(), aid))
            db.commit()
            log_cost("heygen", "avatar_v2", 0.50,
                     f"Presenter clip {idx+1} for {cjob_id}")
            return 0.50, 1
        else:
            _fail_asset(db, aid)
    else:
        _fail_asset(db, aid)
    return 0.0, 0
