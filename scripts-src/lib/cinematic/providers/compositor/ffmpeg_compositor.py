"""FFmpeg compositor — wraps the existing assembly pipeline as a CompositorProvider.

This is the default compositor. It delegates to cinematic.assembly which uses
FFmpeg subprocess calls for: speed-adjustment, normalization, concatenation,
BGM mixing, and caption burn-in.

Zero behavior change from the original phase_assembly() flow.
"""

import json
import os
from pathlib import Path

from cinematic.providers.base import CompositorProvider


class FFmpegCompositor(CompositorProvider):
    """Compose final video using FFmpeg (existing assembly pipeline)."""

    def compose(self, clips, narr_dir, output_dir, job, fmt, scale_filter):
        """Assemble clips via FFmpeg concat + finalize.

        Delegates to assemble_clips() for speed-adjusted B-roll/presenter
        merging, then finalize_video() for normalize → concat → BGM → captions.
        """
        from cinematic.assembly import assemble_clips, finalize_video
        from cinematic.db import get_db

        db = get_db()
        cjob_id = job['cjob_id']

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
            return None

        assembled = assemble_clips(clips, broll, pres, narr_dir,
                                   output_dir, fmt)
        if not assembled:
            return None

        assembled.sort(key=lambda x: x[0])
        return finalize_video(assembled, output_dir, narr_dir, job,
                              fmt, scale_filter)

    def get_templates(self):
        return [{
            'id': 'ffmpeg-standard',
            'name': 'Standard (FFmpeg)',
            'description': 'Direct concatenation with crossfade-free cuts, '
                           'caption burn-in, and BGM mixing.',
            'category': 'cinematic',
        }]
