#!/bin/bash
set -euo pipefail
source /opt/AIWH/core/scripts/lib/env.sh

# Buffer Status Check — Polls Buffer API for scheduled jobs, updates DB when posted
# Cron: daily at 11:00 AEST (com.aiwh.buffer-status-check)

CLIENT_ROOT="${CLIENT_ROOT:-/opt/AIWH/client}"
DB="$CLIENT_ROOT/data/video-jobs.db"
ENV_FILE="/opt/AIWH/.openclaw/.env"
LOG_FILE="$CLIENT_ROOT/logs/buffer-check.log"

mkdir -p "$(dirname "$LOG_FILE")"

# Load secrets (encrypted store preferred, .env fallback)
aiwh_load_secrets BUFFER_API_TOKEN

: "${BUFFER_API_TOKEN:?Missing BUFFER_API_TOKEN}"

python3 << PYTHON
import sqlite3
import json
import urllib.request
import urllib.error
from datetime import datetime

db_path = "$DB"
log_path = "$LOG_FILE"
api_token = "$BUFFER_API_TOKEN"

def log(msg):
    ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    line = f"[{ts}] {msg}"
    with open(log_path, 'a') as f:
        f.write(line + '\n')

log("=== Buffer Status Check Started ===")

try:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # Get scheduled jobs with platform targets
    cur.execute("""SELECT job_id, topic, pillar, platform_targets, scheduled_time
                   FROM video_jobs WHERE status='scheduled' AND platform_targets IS NOT NULL
                   ORDER BY scheduled_time;""")
    jobs = cur.fetchall()

    if not jobs:
        print("REPORT:NO_SCHEDULED_JOBS")
        log("No scheduled jobs to check")
        exit(0)

    confirmed = []   # successfully posted
    pending = []     # still waiting
    errors = []      # API errors

    for job in jobs:
        job_id = job['job_id']
        topic = job['topic'] or job_id
        pillar = job['pillar'] or 'unknown'
        sched_time = job['scheduled_time'] or ''

        try:
            targets = json.loads(job['platform_targets'])
        except:
            errors.append({'job_id': job_id, 'topic': topic, 'reason': 'Invalid platform_targets JSON'})
            continue

        # Normalize: list/string -> dict (handles legacy data formats)
        if isinstance(targets, list):
            targets = {str(p): True for p in targets if isinstance(p, str)}
        elif isinstance(targets, str):
            targets = {p.strip(): True for p in targets.split(',') if p.strip()}
        if not isinstance(targets, dict):
            errors.append({'job_id': job_id, 'topic': topic, 'reason': 'platform_targets is not a dict'})
            continue

        # Collect platform names (values may be True, dict, or truthy)
        platforms = [p for p in targets.keys() if targets[p]]

        # Extract post_id — value may be a nested dict or a simple boolean
        ig_entry = targets.get('instagram', {})
        post_id = ig_entry.get('post_id') if isinstance(ig_entry, dict) else None
        if not post_id:
            pending.append({'job_id': job_id, 'topic': topic, 'pillar': pillar, 'platforms': platforms,
                           'buffer_status': 'no_post_id', 'reason': 'No Buffer post ID assigned'})
            continue

        try:
            body = json.dumps({
                "query": f'query {{ post(input: {{ id: "{post_id}" }}) {{ id status sentAt }} }}'
            }).encode('utf-8')
            req = urllib.request.Request(
                "https://api.buffer.com/graphql",
                data=body,
                headers={
                    "Authorization": f"Bearer {api_token}",
                    "Content-Type": "application/json",
                    "User-Agent": "AIWH/1.0"
                },
                method="POST"
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode('utf-8'))

            post_status = data.get('data', {}).get('post', {}).get('status', 'unknown')
            sent_at = data.get('data', {}).get('post', {}).get('sentAt', '')

            if post_status == 'sent':
                now = datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')
                cur.execute("UPDATE video_jobs SET status='posted', updated_at=? WHERE job_id=?;", (now, job_id))
                conn.commit()
                confirmed.append({'job_id': job_id, 'topic': topic, 'pillar': pillar,
                                 'platforms': platforms, 'sent_at': sent_at})
                log(f"  {job_id} -> posted")
            elif post_status == 'error':
                now = datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')
                cur.execute("UPDATE video_jobs SET status='failed', failure_reason=?, updated_at=? WHERE job_id=?;",
                            (f'Buffer post error (post_id: {post_id})', now, job_id))
                conn.commit()
                errors.append({'job_id': job_id, 'topic': topic, 'pillar': pillar,
                              'platforms': platforms, 'reason': 'Buffer post failed'})
                log(f"  {job_id} -> FAILED (Buffer error)")
            else:
                pending.append({'job_id': job_id, 'topic': topic, 'pillar': pillar,
                               'platforms': platforms, 'buffer_status': post_status,
                               'reason': f'Buffer status: {post_status}'})
                log(f"  {job_id} — {post_status}")
        except Exception as e:
            errors.append({'job_id': job_id, 'topic': topic, 'reason': str(e)})
            log(f"  ERROR {job_id} — {str(e)}")

    # Also get recent posted stats for context
    cur.execute("""SELECT COUNT(*) as total FROM video_jobs WHERE status='posted';""")
    total_posted = cur.fetchone()['total']
    cur.execute("""SELECT COUNT(*) as total FROM video_jobs WHERE status IN ('draft','scripted','voice_ready','avatar_processing','avatar_ready','captioned','qa_passed','approved');""")
    total_pipeline = cur.fetchone()['total']

    conn.close()

    # Output structured report for the agent
    report = {
        'confirmed_posted': confirmed,
        'still_pending': pending,
        'errors': errors,
        'stats': {
            'checked': len(jobs),
            'newly_posted': len(confirmed),
            'still_waiting': len(pending),
            'errors': len(errors),
            'total_posted_all_time': total_posted,
            'in_pipeline': total_pipeline,
        }
    }
    print("REPORT_JSON:" + json.dumps(report))
    log(f"=== Complete: {len(confirmed)} posted, {len(pending)} pending, {len(errors)} errors ===")

except Exception as e:
    print(f"REPORT_FATAL:{str(e)}")
    log(f"FATAL: {str(e)}")
    exit(1)
PYTHON
