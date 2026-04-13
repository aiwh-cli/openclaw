"""Assembly helpers for the cinematic pipeline.

Handles FFmpeg operations: B-roll speed adjustment, normalization,
concatenation, BGM mixing, and caption burn-in.
"""

import os
import subprocess

from cinematic.config import FFMPEG
from cinematic.utils import (
    get_duration, combine_clip_srts, get_ass_style, srt_to_ass,
)


def assemble_clips(clips, broll_map, presenter_map, narr_dir,
                    output_dir, fmt):
    """Build assembled clip list with speed-adjusted B-roll.

    Returns list of (clip_index, file_path, has_audio) tuples.
    """
    assembled = []
    for clip in clips:
        idx = clip.get('index', 0)
        clip_type = clip.get('type', 'cinematic')

        if clip_type == 'presenter':
            pc = presenter_map.get(idx)
            if pc and pc['file_path'] and os.path.exists(pc['file_path']):
                assembled.append((idx, pc['file_path'], True))
                print(f"  Clip {idx+1}: Presenter clip")
            else:
                print(f"  Clip {idx+1}: Presenter clip MISSING")
        else:
            bc = broll_map.get(idx)
            if not bc or not bc['file_path'] or not os.path.exists(
                    bc['file_path']):
                print(f"  Clip {idx+1}: B-roll MISSING, skipping")
                continue

            narr_audio = narr_dir / f"clip-{idx+1:02d}-narration.mp3"
            clip_out = output_dir / f"clip-{idx+1:02d}-merged.mp4"

            if narr_audio.exists():
                _merge_broll_narration(
                    bc['file_path'], str(narr_audio), str(clip_out), idx)
                if (clip_out.exists()
                        and os.path.getsize(clip_out) > 10000):
                    assembled.append((idx, str(clip_out), True))
                else:
                    assembled.append((idx, bc['file_path'], False))
                    print("    Merge failed, using raw B-roll")
            else:
                assembled.append((idx, bc['file_path'], False))
                print(f"  Clip {idx+1}: B-roll only (no narration)")

    return assembled


def finalize_video(assembled, output_dir, narr_dir, job, fmt,
                    scale_filter):
    """Normalize, concat, add BGM and captions.

    Returns final file path string or None on failure.
    """
    # Step 1: Normalize all clips
    normalized = _normalize_clips(assembled, output_dir, scale_filter)
    if not normalized:
        return None

    # Step 2: Concatenate
    concat_out = _concatenate(normalized, output_dir)
    if not concat_out:
        return None

    # Step 3: Add BGM
    final_out = _add_bgm(concat_out, output_dir, job)
    if not final_out or not final_out.exists():
        return None
    if os.path.getsize(final_out) < 100000:
        return None

    # Step 4: Caption burn-in
    _burn_captions(final_out, assembled, narr_dir, output_dir, job, fmt)

    return str(final_out)


def _merge_broll_narration(video_path, audio_path, output_path, idx):
    """Merge B-roll video with narration audio, speed-adjusting video."""
    vid_dur = get_duration(video_path)
    narr_dur = get_duration(audio_path)

    if vid_dur > 0 and narr_dur > 0:
        pts_factor = max(0.5, min(2.0, narr_dur / vid_dur))
        subprocess.run([
            FFMPEG, '-y', '-i', video_path, '-i', audio_path,
            '-filter:v', f'setpts={pts_factor:.4f}*PTS',
            '-map', '0:v', '-map', '1:a',
            '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
            '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
            '-shortest', output_path
        ], capture_output=True, timeout=60)
        speed_pct = (1.0 / pts_factor - 1) * 100
        print(f"  Clip {idx+1}: speed-adjusted "
              f"({pts_factor:.2f}x, {speed_pct:+.0f}%)")
    else:
        subprocess.run([
            FFMPEG, '-y', '-i', video_path, '-i', audio_path,
            '-map', '0:v', '-map', '1:a',
            '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
            '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
            '-shortest', output_path
        ], capture_output=True, timeout=60)
        print(f"  Clip {idx+1}: B-roll + narration (no speed adjust)")


def _normalize_clips(assembled, output_dir, scale_filter):
    """Normalize all clips to consistent format for concat."""
    normalized = []
    for i, (idx, clip_path, clip_has_audio) in enumerate(assembled):
        norm_path = output_dir / f"norm-{i:03d}.mp4"
        if clip_has_audio:
            cmd = [
                FFMPEG, '-y', '-i', clip_path,
                '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
                '-vf', scale_filter, '-r', '30',
                '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
                '-ac', '2', str(norm_path)]
        else:
            cmd = [
                FFMPEG, '-y', '-i', clip_path,
                '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
                '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
                '-vf', scale_filter, '-r', '30',
                '-map', '0:v', '-map', '1:a',
                '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
                '-ac', '2', '-shortest', str(norm_path)]
        subprocess.run(cmd, capture_output=True, timeout=120)
        if norm_path.exists():
            normalized.append(str(norm_path))
    return normalized


def _concatenate(normalized, output_dir):
    """Concatenate normalized clips via ffmpeg concat demuxer."""
    concat_file = output_dir / "concat.txt"
    with open(concat_file, 'w') as f:
        for p in normalized:
            f.write(f"file '{p}'\n")

    concat_out = output_dir / "concat-raw.mp4"
    subprocess.run([
        FFMPEG, '-y', '-f', 'concat', '-safe', '0',
        '-i', str(concat_file), '-c', 'copy', str(concat_out)
    ], capture_output=True, timeout=300)

    return concat_out if concat_out.exists() else None


def _add_bgm(concat_out, output_dir, job):
    """Add background music to concatenated video."""
    from cinematic.utils import get_duration as _get_dur

    final_out = output_dir / "final.mp4"
    bgm_path = job.get('bgm_path', '')
    bgm_vol = float(job.get('bgm_volume', 0) or 0.3)

    if bgm_path and os.path.exists(bgm_path):
        dur = _get_dur(str(concat_out)) or job['target_duration_sec']
        subprocess.run([
            FFMPEG, '-y', '-i', str(concat_out), '-i', bgm_path,
            '-filter_complex',
            f'[0:a]volume=1.0[main];'
            f'[1:a]atrim=0:{dur:.0f},volume={bgm_vol:.2f},'
            f'afade=t=out:st={max(dur-4, 1):.0f}:d=4[bgm];'
            f'[main][bgm]amix=inputs=2:duration=longest:'
            f'dropout_transition=3[aout]',
            '-map', '0:v', '-map', '[aout]',
            '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
            '-movflags', '+faststart', str(final_out)
        ], capture_output=True, timeout=300)
    else:
        subprocess.run([
            FFMPEG, '-y', '-i', str(concat_out),
            '-c', 'copy', '-movflags', '+faststart', str(final_out)
        ], capture_output=True, timeout=60)

    return final_out


def _burn_captions(final_out, assembled, narr_dir, output_dir, job, fmt):
    """Burn captions into the final video if enabled."""
    captions_enabled = job.get('captions_enabled', 0)
    if not captions_enabled:
        return

    combined_srt = combine_clip_srts(narr_dir, assembled, output_dir)
    if not combined_srt or not os.path.exists(combined_srt):
        return

    caption_pos = job.get('caption_position', 'bottom')
    caption_style = job.get('caption_style', 'clean')
    captioned_out = output_dir / "final-captioned.mp4"

    ass_style = get_ass_style(caption_pos, caption_style, fmt)
    ass_path = output_dir / "captions.ass"
    srt_to_ass(combined_srt, ass_path, ass_style)

    subprocess.run([
        FFMPEG, '-y', '-i', str(final_out),
        '-vf', f"ass='{ass_path}'",
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
        '-c:a', 'copy', '-movflags', '+faststart',
        str(captioned_out)
    ], capture_output=True, timeout=300)

    if (captioned_out.exists()
            and os.path.getsize(captioned_out) > 100000):
        os.rename(str(captioned_out), str(final_out))
        print(f"  Captions burned in ({caption_style}, {caption_pos})")
    else:
        print("  Caption burn-in failed, keeping uncaptioned")
