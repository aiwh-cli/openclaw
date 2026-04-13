"""Database operations for the cinematic pipeline.

CRUD for cinematic_jobs and cinematic_assets tables.
Includes auto-approve logic and review gate checks.
"""

import json
import sqlite3
import sys
import uuid
from datetime import datetime

from cinematic.config import DB_PATH
from cinematic.utils import now_iso


# ── Connection ───────────────────────────────────────────────────

def get_db():
    """Open a database connection with Row factory and WAL mode."""
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA journal_mode=WAL")
    return db


# ── ID generation ────────────────────────────────────────────────

def gen_id(prefix="cjob"):
    """Generate a sequential job ID like cjob_20260327_0001."""
    today = datetime.now().strftime("%Y%m%d")
    db = get_db()
    row = db.execute(
        "SELECT MAX(CAST(SUBSTR(cjob_id, -4) AS INTEGER)) "
        "FROM cinematic_jobs WHERE cjob_id LIKE ?",
        (f'{prefix}_{today}_%',)
    ).fetchone()
    n = (row[0] or 0) + 1
    db.close()
    return f"{prefix}_{today}_{n:04d}"


# ── Job CRUD ─────────────────────────────────────────────────────

def get_job(db, cjob_id):
    """Fetch a job by ID. Exits with error if not found."""
    row = db.execute(
        "SELECT * FROM cinematic_jobs WHERE cjob_id=?", (cjob_id,)
    ).fetchone()
    if not row:
        print(f"ERROR: Job {cjob_id} not found")
        sys.exit(1)
    return dict(row)


def update_job(db, cjob_id, **fields):
    """Update job fields with automatic updated_at timestamp."""
    fields['updated_at'] = now_iso()
    sets = ', '.join(f"{k}=?" for k in fields)
    vals = list(fields.values()) + [cjob_id]
    db.execute(
        f"UPDATE cinematic_jobs SET {sets} WHERE cjob_id=?", vals)
    db.commit()


# ── Asset CRUD ───────────────────────────────────────────────────

def get_assets(db, cjob_id, asset_type=None, status=None):
    """Fetch assets for a job, optionally filtered by type and status."""
    sql = "SELECT * FROM cinematic_assets WHERE cjob_id=?"
    params = [cjob_id]
    if asset_type:
        sql += " AND asset_type=?"
        params.append(asset_type)
    if status:
        sql += " AND status=?"
        params.append(status)
    sql += " ORDER BY clip_index, sequence, generation_version"
    return [dict(r) for r in db.execute(sql, params).fetchall()]


def insert_asset(db, cjob_id, asset_type, clip_index, prompt, **extra):
    """Insert a new asset record. Returns the generated asset_id."""
    asset_id = str(uuid.uuid4())[:12]
    n = now_iso()
    fields = {
        'asset_id': asset_id, 'cjob_id': cjob_id,
        'asset_type': asset_type, 'clip_index': clip_index,
        'prompt': prompt, 'status': 'pending',
        'created_at': n, 'updated_at': n, **extra
    }
    cols = ', '.join(fields.keys())
    placeholders = ', '.join('?' for _ in fields)
    db.execute(
        f"INSERT INTO cinematic_assets ({cols}) VALUES ({placeholders})",
        list(fields.values()))
    db.commit()
    return asset_id


# ── Auto-approve logic ──────────────────────────────────────────

def auto_approve_generated(db, job, asset_type):
    """Try to auto-approve all 'generated' assets of a type.
    Returns count approved.
    """
    assets = db.execute(
        "SELECT asset_id FROM cinematic_assets "
        "WHERE cjob_id=? AND asset_type=? AND status='generated'",
        (job['cjob_id'], asset_type)
    ).fetchall()
    count = 0
    for a in assets:
        if try_auto_approve(db, job, a['asset_id'], asset_type):
            count += 1
    return count


def try_auto_approve(db, job, asset_id, asset_type):
    """Check if asset can be auto-approved based on confidence + job settings."""
    auto_map = {
        'ref_image': 'auto_approve_refs',
        'keyframe_first': 'auto_approve_keyframes',
        'keyframe_last': 'auto_approve_keyframes',
        'video_clip': 'auto_approve_clips',
    }
    flag_col = auto_map.get(asset_type)
    if not flag_col or not job.get(flag_col, 0):
        return False

    threshold = job.get('autonomy_threshold', 4.0)

    row = db.execute(
        "SELECT COUNT(*) as n, AVG(grade) as avg "
        "FROM style_grades WHERE asset_type=?",
        (asset_type,)
    ).fetchone()
    if not row or row['n'] < 15:
        return False  # Need minimum 15 samples

    sample_factor = min(1.0, row['n'] / 30)
    grade_factor = row['avg'] / 5.0
    confidence = sample_factor * grade_factor

    if confidence < (threshold / 5.0):
        return False

    predicted_grade = round(row['avg'])
    now = now_iso()
    db.execute(
        "UPDATE cinematic_assets SET status='approved', grade=?, "
        "grade_notes='auto-approved', reviewed_at=?, updated_at=? "
        "WHERE asset_id=?",
        (predicted_grade, now, now, asset_id)
    )
    db.execute(
        "INSERT INTO style_grades (cjob_id, asset_id, asset_type, grade, "
        "prompt_used, review_source, created_at) VALUES "
        "(?,?,?,?,(SELECT prompt FROM cinematic_assets WHERE asset_id=?),"
        "'auto',?)",
        (job['cjob_id'], asset_id, asset_type, predicted_grade, asset_id, now)
    )
    db.commit()
    print(f"    AUTO-APPROVED: {asset_type} "
          f"(confidence={confidence:.2f}, predicted_grade={predicted_grade})")
    return True


# ── Review gate ──────────────────────────────────────────────────

def check_review_gate(db, cjob_id, asset_type, next_phase):
    """Check if all assets of a type are resolved. Advances phase if so."""
    pending = db.execute(
        "SELECT COUNT(*) FROM cinematic_assets "
        "WHERE cjob_id=? AND asset_type LIKE ? "
        "AND status IN ('generated','generating','pending','regenerating')",
        (cjob_id, f'{asset_type}%')
    ).fetchone()[0]

    approved = db.execute(
        "SELECT COUNT(*) FROM cinematic_assets "
        "WHERE cjob_id=? AND asset_type LIKE ? AND status='approved'",
        (cjob_id, f'{asset_type}%')
    ).fetchone()[0]

    if pending > 0:
        return False

    if approved >= 1:
        update_job(db, cjob_id, phase=next_phase)
        print(f"  Gate passed: {approved} approved. Advancing to {next_phase}")
        return True

    print(f"  Gate blocked: {approved} approved, {pending} pending")
    return False
