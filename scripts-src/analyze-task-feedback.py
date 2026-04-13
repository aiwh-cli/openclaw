#!/usr/bin/env python3
"""
Weekly Feedback Analysis — Reads agent_task_log, calculates success rates,
identifies failure patterns, and posts a summary to Discord.
Runs Monday 8AM via dashboard script_cron.
"""

import json
import os
import sqlite3
import subprocess
import sys
from collections import defaultdict
from datetime import datetime, timedelta

DB_PATH = os.path.join(
    os.environ.get('CLIENT_ROOT', '/opt/AIWH/client'),
    '../core/dashboard/mission-control.db'
)
# Normalize path
DB_PATH = os.path.normpath(DB_PATH)

LOG_PATH = os.path.join(
    os.environ.get('CLIENT_ROOT', '/opt/AIWH/client'),
    'logs/feedback-analysis.log'
)


def log(msg):
    ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    line = f"[{ts}] {msg}"
    print(line)
    try:
        os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
        with open(LOG_PATH, 'a') as f:
            f.write(line + '\n')
    except Exception:
        pass


def notify(msg):
    """Send notification via aiwh_notify."""
    try:
        subprocess.run(
            ['bash', '-c', f'source /opt/AIWH/core/scripts/lib/env.sh && aiwh_notify "{msg}" "knowledge"'],
            timeout=15, capture_output=True
        )
    except Exception as e:
        log(f"Notification failed: {e}")


def analyze():
    if not os.path.exists(DB_PATH):
        log(f"Database not found: {DB_PATH}")
        return

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    # Get entries from last 7 days
    cutoff = (datetime.utcnow() - timedelta(days=7)).strftime('%Y-%m-%d %H:%M:%S')
    rows = conn.execute(
        "SELECT * FROM agent_task_log WHERE created_at >= ? ORDER BY created_at DESC",
        (cutoff,)
    ).fetchall()

    if not rows:
        log("No task log entries in the past 7 days. Nothing to analyze.")
        notify("📊 Weekly feedback: No agent task logs recorded this week. Pipeline logging not yet active.")
        conn.close()
        return

    log(f"Analyzing {len(rows)} entries from past 7 days")

    # Group by agent
    by_agent = defaultdict(list)
    for r in rows:
        by_agent[r['agent_id']].append(dict(r))

    # Calculate per-agent stats
    summary_lines = []
    total_success = 0
    total_fail = 0

    for agent_id, entries in sorted(by_agent.items()):
        success = sum(1 for e in entries if e['outcome'] == 'success')
        failure = sum(1 for e in entries if e['outcome'] == 'failure')
        partial = sum(1 for e in entries if e['outcome'] == 'partial')
        unknown = sum(1 for e in entries if e['outcome'] == 'unknown')
        total = len(entries)
        total_success += success
        total_fail += failure

        rate = f"{success}/{total}" if total > 0 else "N/A"
        avg_quality = None
        scores = [e['quality_score'] for e in entries if e['quality_score'] is not None]
        if scores:
            avg_quality = round(sum(scores) / len(scores), 2)

        line = f"  {agent_id}: {rate} success"
        if avg_quality is not None:
            line += f", avg quality {avg_quality}"
        if failure > 0:
            line += f", {failure} failures"
        summary_lines.append(line)

    # Top failure patterns
    failures = [r for r in rows if dict(r)['outcome'] == 'failure' and dict(r)['error_message']]
    failure_patterns = defaultdict(int)
    for f in failures:
        err = dict(f)['error_message'][:80]  # First 80 chars as pattern key
        failure_patterns[err] += 1
    top_failures = sorted(failure_patterns.items(), key=lambda x: -x[1])[:3]

    # Build report
    report = f"📊 Weekly Feedback Analysis ({len(rows)} entries, {len(by_agent)} agents)\n"
    report += f"Overall: {total_success} success, {total_fail} failures\n"
    report += "\n".join(summary_lines)
    if top_failures:
        report += "\n\nTop failure patterns:"
        for pattern, count in top_failures:
            report += f"\n  ({count}x) {pattern}"

    log(report)

    # Store analysis as meta-entry
    conn.execute(
        "INSERT INTO agent_task_log (agent_id, action_type, output_summary, outcome, metadata, created_at) "
        "VALUES (?, ?, ?, ?, ?, datetime('now'))",
        ('system', 'weekly_analysis', report[:500], 'success',
         json.dumps({'total': len(rows), 'agents': len(by_agent), 'success': total_success, 'failures': total_fail}))
    )
    conn.commit()
    conn.close()

    # Notify
    notify(report[:500])
    log("Analysis complete")

    # Run failure-to-knowledge pipeline if it exists
    ftk_script = '/opt/AIWH/core/scripts/failure-to-knowledge.py'
    if os.path.exists(ftk_script) and total_fail > 0:
        log(f"Running failure-to-knowledge pipeline ({total_fail} failures)...")
        try:
            result = subprocess.run(
                ['python3', ftk_script],
                timeout=120, capture_output=True, text=True,
                env={**os.environ, 'PATH': f'/opt/homebrew/bin:{os.environ.get("PATH", "")}'}
            )
            log(f"Failure-to-knowledge: exit {result.returncode}")
            if result.stdout.strip():
                log(result.stdout.strip())
        except Exception as e:
            log(f"Failure-to-knowledge error: {e}")


if __name__ == '__main__':
    analyze()
