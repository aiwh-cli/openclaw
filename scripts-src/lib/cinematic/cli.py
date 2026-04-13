"""CLI command handlers for the cinematic pipeline.

9 commands: create, run, run-pending, review, approve-phase,
retry-failed, status, list, help.
"""

import json
import sys

from cinematic.config import get_format
from cinematic.db import (
    get_db, gen_id, get_job, update_job, get_assets,
    check_review_gate,
)
from cinematic.phases import (
    phase_analyze, phase_ref_images, phase_keyframes,
    phase_video_clips, phase_narration, phase_assembly,
)
from cinematic.utils import now_iso

# ── Phase dispatch ───────────────────────────────────────────────

PHASE_HANDLERS = {
    'brief': lambda db, job: (
        update_job(db, job['cjob_id'], phase='analyzing'),
        phase_analyze(db, get_job(db, job['cjob_id']))
    ),
    'analyzing': phase_analyze,
    'ref_images': phase_ref_images,
    'keyframes': phase_keyframes,
    'video_clips': phase_video_clips,
    'narration': phase_narration,
    'assembly': phase_assembly,
}

REVIEW_PHASES = {
    'analysis_review', 'ref_review', 'keyframe_review',
    'clip_review', 'final_review',
}
TERMINAL_PHASES = {'approved', 'published', 'failed', 'cancelled'}


def run_job(cjob_id):
    """Run phases until a review/terminal gate is hit."""
    db = get_db()
    while True:
        job = get_job(db, cjob_id)
        phase = job['phase']

        if phase in REVIEW_PHASES:
            print(f"  Job {cjob_id} waiting for review (phase: {phase})")
            break
        if phase in TERMINAL_PHASES:
            print(f"  Job {cjob_id} in terminal phase: {phase}")
            break

        handler = PHASE_HANDLERS.get(phase)
        if handler:
            print(f"  Running phase: {phase}")
            handler(db, job)
        else:
            print(f"  No handler for phase: {phase}")
            break
    db.close()


# ── CLI Commands ─────────────────────────────────────────────────

def cmd_create(args):
    """Create a new cinematic job and auto-run analysis."""
    title = args[0] if args else None
    if not title:
        print("Usage: create <title> --brief <text> "
              "[--duration 120] [--clips 10]")
        sys.exit(1)

    brief, duration, clips, bgm = "", 120, 10, ""
    i = 1
    while i < len(args):
        if args[i] == '--brief' and i + 1 < len(args):
            brief = args[i + 1]; i += 2
        elif args[i] == '--duration' and i + 1 < len(args):
            duration = int(args[i + 1]); i += 2
        elif args[i] == '--clips' and i + 1 < len(args):
            clips = int(args[i + 1]); i += 2
        elif args[i] == '--bgm' and i + 1 < len(args):
            bgm = args[i + 1]; i += 2
        else:
            i += 1

    if not brief:
        print("ERROR: --brief is required")
        sys.exit(1)

    db = get_db()
    cjob_id = gen_id()
    n = now_iso()
    db.execute(
        "INSERT INTO cinematic_jobs (cjob_id, title, brief, "
        "target_duration_sec, clip_count, bgm_path, phase, "
        "created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
        (cjob_id, title, brief, duration, clips, bgm, 'brief', n, n))
    db.commit()

    print(f"Created: {cjob_id}")
    print(f"  Title: {title}")
    print(f"  Duration: {duration}s | Clips: {clips}")

    run_job(cjob_id)
    db.close()


def cmd_run(args):
    """Run a specific job to its next phase."""
    if not args:
        print("Usage: run <cjob_id>")
        sys.exit(1)
    run_job(args[0])


def cmd_run_pending(args):
    """Run all non-review, non-terminal jobs."""
    db = get_db()
    jobs = db.execute(
        "SELECT cjob_id, phase FROM cinematic_jobs "
        "WHERE phase NOT IN (?,?,?,?,?,?,?,?,?)",
        tuple(REVIEW_PHASES | TERMINAL_PHASES)
    ).fetchall()

    if not jobs:
        print("No pending jobs")
        return

    for job in jobs:
        print(f"\n=== {job['cjob_id']} (phase: {job['phase']}) ===")
        run_job(job['cjob_id'])
    db.close()


def cmd_review(args):
    """Review an individual asset (approve/reject/regen)."""
    if len(args) < 2:
        print("Usage: review <cjob_id> <asset_id> --grade <1-5> "
              "[--action approve|reject|regen] [--notes ...]")
        sys.exit(1)

    cjob_id, asset_id = args[0], args[1]
    grade, action, notes = None, 'approve', ''

    i = 2
    while i < len(args):
        if args[i] == '--grade' and i + 1 < len(args):
            grade = int(args[i + 1]); i += 2
        elif args[i] == '--action' and i + 1 < len(args):
            action = args[i + 1]; i += 2
        elif args[i] == '--notes' and i + 1 < len(args):
            notes = args[i + 1]; i += 2
        else:
            i += 1

    if grade is None:
        print("ERROR: --grade required")
        sys.exit(1)

    db = get_db()
    job = get_job(db, cjob_id)

    new_status = ('approved' if action == 'approve'
                  else ('rejected' if action == 'reject'
                        else 'regenerating'))
    db.execute(
        "UPDATE cinematic_assets SET status=?, grade=?, grade_notes=?, "
        "reviewed_at=?, updated_at=? WHERE asset_id=? AND cjob_id=?",
        (new_status, grade, notes, now_iso(), now_iso(),
         asset_id, cjob_id))

    asset = db.execute(
        "SELECT * FROM cinematic_assets WHERE asset_id=?",
        (asset_id,)).fetchone()
    if asset:
        db.execute(
            "INSERT INTO style_grades (cjob_id, asset_id, asset_type, "
            "grade, prompt_used, review_source, created_at) "
            "VALUES (?,?,?,?,?,?,?)",
            (cjob_id, asset_id, asset['asset_type'], grade,
             asset['prompt'], 'human', now_iso()))

    db.commit()
    print(f"  Asset {asset_id}: {action} (grade {grade})")

    phase = job['phase']
    gate_map = {
        'ref_review': ('ref_image', 'keyframes'),
        'keyframe_review': ('keyframe_', 'video_clips'),
        'clip_review': ('video_clip', 'narration'),
    }
    if phase in gate_map:
        asset_prefix, next_phase = gate_map[phase]
        check_review_gate(db, cjob_id, asset_prefix, next_phase)
    db.close()


def cmd_approve_phase(args):
    """Approve an entire review phase and advance."""
    if not args:
        print("Usage: approve-phase <cjob_id> [--grade <1-5>]")
        sys.exit(1)

    cjob_id = args[0]
    grade, notes = 4, ''

    i = 1
    while i < len(args):
        if args[i] == '--grade' and i + 1 < len(args):
            grade = int(args[i + 1]); i += 2
        elif args[i] == '--notes' and i + 1 < len(args):
            notes = args[i + 1]; i += 2
        else:
            i += 1

    db = get_db()
    job = get_job(db, cjob_id)
    phase = job['phase']

    advance_map = {
        'analysis_review': ('ref_images', 'analysis_grade',
                            'analysis_notes'),
        'ref_review': ('keyframes', None, None),
        'keyframe_review': ('video_clips', None, None),
        'clip_review': ('narration', None, None),
        'final_review': ('approved', 'final_grade', 'final_notes'),
    }

    if phase not in advance_map:
        print(f"  Cannot approve phase: {phase}")
        sys.exit(1)

    next_phase, grade_col, notes_col = advance_map[phase]
    extra = {}
    if grade_col:
        extra[grade_col] = grade
    if notes_col:
        extra[notes_col] = notes
    update_job(db, cjob_id, phase=next_phase, **extra)
    print(f"  Phase {phase} approved. Advancing to {next_phase}")

    run_job(cjob_id)
    db.close()


def cmd_retry_failed(args):
    """Re-generate only failed assets for a job."""
    from cinematic.retry import retry_assets

    if not args:
        print("Usage: retry-failed <cjob_id>")
        return

    cjob_id = args[0]
    db = get_db()
    job_row = db.execute(
        "SELECT * FROM cinematic_jobs WHERE cjob_id=?",
        (cjob_id,)).fetchone()
    if not job_row:
        print(f"Job not found: {cjob_id}")
        db.close()
        return

    job = dict(job_row)
    original_phase = job['phase']
    db.execute(
        "UPDATE cinematic_jobs SET phase='retrying', updated_at=? "
        "WHERE cjob_id=?", (now_iso(), cjob_id))
    db.commit()

    retryable = db.execute(
        "SELECT * FROM cinematic_assets WHERE cjob_id=? "
        "AND status IN ('failed','rejected','regenerating') "
        "ORDER BY asset_type, clip_index", (cjob_id,)).fetchall()

    if not retryable:
        print("No failed or rejected assets to retry")
        db.execute(
            "UPDATE cinematic_jobs SET phase=?, updated_at=? "
            "WHERE cjob_id=?", (original_phase, now_iso(), cjob_id))
        db.commit()
        db.close()
        return

    fmt = get_format(job)
    print(f"  Retrying {len(retryable)} assets for {cjob_id}")
    cost, success = retry_assets(db, job, retryable, fmt, cjob_id)

    if cost > 0:
        db.execute(
            "UPDATE cinematic_jobs SET total_cost_usd=total_cost_usd+?,"
            " updated_at=? WHERE cjob_id=?",
            (cost, now_iso(), cjob_id))
        db.commit()

    db.execute(
        "UPDATE cinematic_jobs SET phase=?, updated_at=? WHERE cjob_id=?",
        (original_phase, now_iso(), cjob_id))
    db.commit()
    print(f"  Retry complete: {success}/{len(retryable)} "
          f"recovered (${cost:.2f})")
    db.close()


def cmd_status(args):
    """Show job status and asset summary."""
    if not args:
        print("Usage: status <cjob_id>")
        sys.exit(1)

    db = get_db()
    job = get_job(db, args[0])

    print(f"\n  Job: {job['cjob_id']}")
    print(f"  Title: {job['title']}")
    print(f"  Phase: {job['phase']}")
    print(f"  Duration: {job['target_duration_sec']}s | "
          f"Clips: {job['clip_count']}")
    print(f"  Cost: ${job['total_cost_usd']:.2f}")
    print(f"  Created: {job['created_at']}")

    if job.get('error_message'):
        print(f"  ERROR: {job['error_message']}")

    for atype in ['ref_image', 'keyframe_first', 'keyframe_last',
                   'video_clip']:
        total = len(get_assets(db, args[0], atype))
        approved = len(get_assets(db, args[0], atype, 'approved'))
        generated = len(get_assets(db, args[0], atype, 'generated'))
        rejected = len(get_assets(db, args[0], atype, 'rejected'))
        if total:
            print(f"  {atype}: {total} total ({approved} approved, "
                  f"{generated} pending, {rejected} rejected)")
    db.close()


def cmd_list(args):
    """List cinematic jobs, optionally filtered by phase."""
    phase_filter = None
    if len(args) >= 2 and args[0] == '--phase':
        phase_filter = args[1]

    db = get_db()
    sql = ("SELECT cjob_id, title, phase, total_cost_usd, created_at "
           "FROM cinematic_jobs")
    params = []
    if phase_filter:
        sql += " WHERE phase=?"
        params.append(phase_filter)
    sql += " ORDER BY created_at DESC LIMIT 20"

    rows = db.execute(sql, params).fetchall()
    if not rows:
        print("No cinematic jobs found")
        return

    for r in rows:
        print(f"  {r['cjob_id']}  {r['phase']:20s}  "
              f"${r['total_cost_usd']:.2f}  {r['title']}")
    db.close()
