#!/usr/bin/env python3
"""Safe parameterized DB operations for pipeline agents.

Usage:
  db-update.py <db_path> update_job_status <job_id> <status> [scheduled_time] [platform_targets] [failure_reason]
  db-update.py <db_path> select_job <job_id>
  db-update.py <db_path> select_field <job_id> <field_name>
  db-update.py <db_path> update_field <job_id> <field_name> <value>
  db-update.py <db_path> select_approved_jobs
  db-update.py <db_path> next_job_id
  db-update.py <db_path> create_job <topic> [--pillar X] [--hook X] [--platforms X] [--priority X] [--scheduled-for-date X] [--avatar-look-id X]
  db-update.py <db_path> count_jobs <job_id>
  db-update.py <db_path> select_jobs_by_status <status>
  db-update.py <db_path> select_all_jobs
  db-update.py <db_path> retry_job <job_id>
"""

import sys
import sqlite3
import json
from datetime import datetime, timezone

# Fields allowed for single-field updates
ALLOWED_FIELDS = {'caption', 'platform_targets', 'video_r2_url', 'video_gdrive_url',
                  'status', 'scheduled_time', 'failure_reason', 'script', 'hook',
                  'retry_count', 'last_failed_stage', 'voice_audio_path',
                  'avatar_video_path', 'captioned_video_path', 'heygen_video_id',
                  'final_transcript', 'priority', 'scheduled_for_date', 'avatar_look_id',
                  'content_type', 'captions', 'image_path', 'image_paths'}

# Fields allowed for reads (superset — includes read-only columns)
READABLE_FIELDS = ALLOWED_FIELDS | {'topic', 'pillar', 'job_id', 'created_at', 'updated_at'}

# All valid statuses for validation
VALID_STATUSES = {'draft', 'planned', 'scripted', 'voice_ready', 'avatar_processing',
                  'avatar_ready', 'captioned', 'qa_passed', 'qa_failed', 'approved',
                  'scheduled', 'posted', 'script_too_long', 'voice_failed',
                  'avatar_failed', 'avatar_timeout', 'caption_failed', 'rejected',
                  'urgent_review', 'pending_review', 'failed'}

# Retry mapping: failed status → previous passing state
RETRY_MAP = {
    'script_too_long': 'draft',
    'voice_failed': 'scripted',
    'avatar_failed': 'voice_ready',
    'avatar_timeout': 'avatar_processing',
    'caption_failed': 'avatar_ready',
    'qa_failed': 'captioned',
    'rejected': 'qa_passed',
}

def get_db(db_path):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn

def now_utc():
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')

def update_job_status(db_path, job_id, status, scheduled_time=None, platform_targets=None, failure_reason=None):
    conn = get_db(db_path)
    fields = ['status=?', 'updated_at=?']
    values = [status, now_utc()]

    if scheduled_time:
        fields.append('scheduled_time=?')
        values.append(scheduled_time)
        fields.append('failure_reason=NULL')

    if platform_targets:
        fields.append('platform_targets=?')
        values.append(platform_targets)

    if failure_reason:
        fields.append('failure_reason=?')
        values.append(failure_reason)
    elif not scheduled_time:
        pass  # don't clear failure_reason unless scheduling

    values.append(job_id)
    sql = f"UPDATE video_jobs SET {', '.join(fields)} WHERE job_id=?"
    conn.execute(sql, values)
    conn.commit()
    conn.close()

def select_job(db_path, job_id):
    conn = get_db(db_path)
    row = conn.execute("SELECT * FROM video_jobs WHERE job_id=?", (job_id,)).fetchone()
    conn.close()
    if row:
        print(json.dumps([dict(row)]))
    else:
        print('[]')

def select_field(db_path, job_id, field_name):
    if field_name not in READABLE_FIELDS:
        print(f"ERROR: field '{field_name}' not allowed", file=sys.stderr)
        sys.exit(1)
    conn = get_db(db_path)
    row = conn.execute(f"SELECT {field_name} FROM video_jobs WHERE job_id=?", (job_id,)).fetchone()
    conn.close()
    if row:
        print(row[0] if row[0] is not None else '')
    else:
        print('')

def update_field(db_path, job_id, field_name, value):
    if field_name not in ALLOWED_FIELDS:
        print(f"ERROR: field '{field_name}' not allowed", file=sys.stderr)
        sys.exit(1)
    conn = get_db(db_path)
    conn.execute(f"UPDATE video_jobs SET {field_name}=?, updated_at=? WHERE job_id=?",
                 (value, now_utc(), job_id))
    conn.commit()
    conn.close()

def select_approved_jobs(db_path):
    conn = get_db(db_path)
    rows = conn.execute("SELECT job_id FROM video_jobs WHERE status='approved' ORDER BY CASE WHEN priority='urgent' THEN 0 ELSE 1 END, created_at ASC").fetchall()
    conn.close()
    for row in rows:
        print(row[0])

def next_job_id(db_path):
    today = datetime.now(timezone.utc).strftime('%Y%m%d')
    conn = get_db(db_path)
    row = conn.execute(
        "SELECT MAX(CAST(SUBSTR(job_id, -4) AS INTEGER)) FROM video_jobs WHERE job_id LIKE ?",
        (f'job_{today}_%',)
    ).fetchone()
    conn.close()
    max_counter = row[0] if row and row[0] is not None else 0
    print(f"job_{today}_{max_counter + 1:04d}")

def create_job(db_path, topic, pillar=None, hook=None, platform_targets=None,
               priority='normal', scheduled_for_date=None, avatar_look_id=None):
    today = datetime.now(timezone.utc).strftime('%Y%m%d')
    conn = get_db(db_path)
    row = conn.execute(
        "SELECT MAX(CAST(SUBSTR(job_id, -4) AS INTEGER)) FROM video_jobs WHERE job_id LIKE ?",
        (f'job_{today}_%',)
    ).fetchone()
    max_counter = row[0] if row and row[0] is not None else 0
    job_id = f"job_{today}_{max_counter + 1:04d}"
    now = now_utc()

    conn.execute("""INSERT INTO video_jobs (
        job_id, topic, pillar, hook, script, final_transcript,
        voice_audio_path, avatar_video_path, captioned_video_path,
        status, platform_targets, scheduled_time, heygen_video_id,
        created_at, updated_at, priority, scheduled_for_date, avatar_look_id
    ) VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, 'draft', ?, NULL, NULL, ?, ?, ?, ?, ?)""",
        (job_id, topic, pillar, hook, platform_targets, now, now, priority, scheduled_for_date, avatar_look_id))
    conn.commit()

    row = conn.execute("SELECT * FROM video_jobs WHERE job_id=?", (job_id,)).fetchone()
    conn.close()
    print(json.dumps([dict(row)]) if row else '[]')

def count_jobs(db_path, job_id):
    conn = get_db(db_path)
    row = conn.execute("SELECT COUNT(*) FROM video_jobs WHERE job_id=?", (job_id,)).fetchone()
    conn.close()
    print(row[0])

def select_jobs_by_status(db_path, status):
    if status not in VALID_STATUSES:
        print(f"ERROR: Invalid status '{status}'", file=sys.stderr)
        sys.exit(1)
    conn = get_db(db_path)
    rows = conn.execute("SELECT * FROM video_jobs WHERE status=? ORDER BY created_at DESC", (status,)).fetchall()
    conn.close()
    print(json.dumps([dict(r) for r in rows]))

def select_all_jobs(db_path):
    conn = get_db(db_path)
    rows = conn.execute("SELECT * FROM video_jobs ORDER BY created_at DESC").fetchall()
    conn.close()
    print(json.dumps([dict(r) for r in rows]))

def retry_job(db_path, job_id):
    conn = get_db(db_path)
    row = conn.execute("SELECT status FROM video_jobs WHERE job_id=?", (job_id,)).fetchone()
    if not row:
        print(f"ERROR: Job not found: {job_id}", file=sys.stderr)
        conn.close()
        sys.exit(1)
    current = row[0]
    if current not in RETRY_MAP:
        print(f"ERROR: Job status '{current}' is not a failed state and cannot be retried", file=sys.stderr)
        conn.close()
        sys.exit(1)
    new_status = RETRY_MAP[current]
    conn.execute("UPDATE video_jobs SET status=?, updated_at=? WHERE job_id=?",
                 (new_status, now_utc(), job_id))
    conn.commit()
    row = conn.execute("SELECT * FROM video_jobs WHERE job_id=?", (job_id,)).fetchone()
    conn.close()
    print(json.dumps([dict(row)]) if row else '[]')

def insert_trash_manifest(db_path, original_path, trash_path, gdrive_file_id,
                          gdrive_folder_id, gdrive_folder_path, file_size):
    conn = get_db(db_path)
    conn.execute("""INSERT INTO trash_manifest
        (original_path, trash_path, gdrive_file_id, gdrive_folder_id, gdrive_folder_path, file_size, verified)
        VALUES (?, ?, ?, ?, ?, ?, 1)""",
        (original_path, trash_path, gdrive_file_id, gdrive_folder_id, gdrive_folder_path, int(file_size)))
    conn.commit()
    conn.close()

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print(__doc__, file=sys.stderr)
        sys.exit(1)

    db_path = sys.argv[1]
    cmd = sys.argv[2]

    if cmd == 'update_job_status':
        if len(sys.argv) < 5:
            print("Usage: update_job_status <job_id> <status> [scheduled_time] [platform_targets] [failure_reason]", file=sys.stderr)
            sys.exit(1)
        update_job_status(
            db_path,
            sys.argv[3],  # job_id
            sys.argv[4],  # status
            sys.argv[5] if len(sys.argv) > 5 and sys.argv[5] != '' else None,
            sys.argv[6] if len(sys.argv) > 6 and sys.argv[6] != '' else None,
            sys.argv[7] if len(sys.argv) > 7 and sys.argv[7] != '' else None,
        )
    elif cmd == 'select_job':
        select_job(db_path, sys.argv[3])
    elif cmd == 'select_field':
        select_field(db_path, sys.argv[3], sys.argv[4])
    elif cmd == 'update_field':
        # Accept value from argv[5] or stdin (stdin avoids shell quoting issues with long JSON)
        if len(sys.argv) > 5:
            val = sys.argv[5]
        else:
            val = sys.stdin.read().strip()
        update_field(db_path, sys.argv[3], sys.argv[4], val)
    elif cmd == 'select_approved_jobs':
        select_approved_jobs(db_path)
    elif cmd == 'next_job_id':
        next_job_id(db_path)
    elif cmd == 'create_job':
        if len(sys.argv) < 4:
            print("Usage: create_job <topic> [--pillar X] [--hook X] [--platforms X] [--priority X] [--scheduled-for-date X] [--avatar-look-id X]", file=sys.stderr)
            sys.exit(1)
        topic = sys.argv[3]
        kwargs = {}
        i = 4
        while i < len(sys.argv):
            if sys.argv[i] == '--pillar' and i + 1 < len(sys.argv):
                kwargs['pillar'] = sys.argv[i + 1]; i += 2
            elif sys.argv[i] == '--hook' and i + 1 < len(sys.argv):
                kwargs['hook'] = sys.argv[i + 1]; i += 2
            elif sys.argv[i] == '--platforms' and i + 1 < len(sys.argv):
                kwargs['platform_targets'] = sys.argv[i + 1]; i += 2
            elif sys.argv[i] == '--priority' and i + 1 < len(sys.argv):
                kwargs['priority'] = sys.argv[i + 1]; i += 2
            elif sys.argv[i] == '--scheduled-for-date' and i + 1 < len(sys.argv):
                kwargs['scheduled_for_date'] = sys.argv[i + 1]; i += 2
            elif sys.argv[i] == '--avatar-look-id' and i + 1 < len(sys.argv):
                kwargs['avatar_look_id'] = sys.argv[i + 1]; i += 2
            else:
                print(f"Unknown option: {sys.argv[i]}", file=sys.stderr)
                sys.exit(1)
        create_job(db_path, topic, **kwargs)
    elif cmd == 'count_jobs':
        count_jobs(db_path, sys.argv[3])
    elif cmd == 'select_jobs_by_status':
        select_jobs_by_status(db_path, sys.argv[3])
    elif cmd == 'select_all_jobs':
        select_all_jobs(db_path)
    elif cmd == 'retry_job':
        retry_job(db_path, sys.argv[3])
    elif cmd == 'insert_trash_manifest':
        if len(sys.argv) < 9:
            print("Usage: insert_trash_manifest <original_path> <trash_path> <gdrive_file_id> <gdrive_folder_id> <gdrive_folder_path> <file_size>", file=sys.stderr)
            sys.exit(1)
        insert_trash_manifest(db_path, sys.argv[3], sys.argv[4], sys.argv[5],
                              sys.argv[6], sys.argv[7], sys.argv[8])
    else:
        print(f"Unknown command: {cmd}", file=sys.stderr)
        sys.exit(1)
