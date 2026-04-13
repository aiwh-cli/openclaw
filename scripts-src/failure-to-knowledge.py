#!/usr/bin/env python3
"""
Failure-to-Knowledge Pipeline — Reads failures from agent_task_log,
groups similar failures, uses Haiku to distill lessons learned,
inserts as draft knowledge entries in client_knowledge.db.
"""

import hashlib
import json
import os
import sqlite3
import subprocess
import sys
from collections import defaultdict
from datetime import datetime, timedelta

MC_DB = os.path.normpath(os.path.join(
    os.environ.get('CLIENT_ROOT', '/opt/AIWH/client'),
    '../core/dashboard/mission-control.db'
))
CLIENT_DB = os.path.join(
    os.environ.get('CLIENT_ROOT', '/opt/AIWH/client'),
    'data/client_knowledge.db'
)
LOG_PATH = os.path.join(
    os.environ.get('CLIENT_ROOT', '/opt/AIWH/client'),
    'logs/failure-to-knowledge.log'
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


# LLM provider abstraction (reads openclaw.json for provider/model)
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "lib"))
from llm_provider import llm_call  # noqa: E402


def call_haiku(prompt):
    """Call LLM to distill a lesson from failures.
    Uses llm_provider for provider-agnostic calls (reads openclaw.json).
    """
    try:
        return llm_call(prompt, max_tokens=200, temperature=1.0, timeout=30)
    except Exception as e:
        log(f"LLM call failed: {e}")
        return None


def process_failures():
    if not os.path.exists(MC_DB):
        log(f"Mission control DB not found: {MC_DB}")
        return

    conn = sqlite3.connect(MC_DB)
    conn.row_factory = sqlite3.Row

    cutoff = (datetime.utcnow() - timedelta(days=7)).strftime('%Y-%m-%d %H:%M:%S')
    failures = conn.execute(
        "SELECT * FROM agent_task_log WHERE outcome='failure' AND created_at >= ? ORDER BY created_at DESC",
        (cutoff,)
    ).fetchall()
    conn.close()

    if not failures:
        log("No failures in the past 7 days. Nothing to learn from.")
        return

    log(f"Found {len(failures)} failures in past 7 days")

    # Group by agent + error pattern (first 60 chars)
    groups = defaultdict(list)
    for f in failures:
        f = dict(f)
        key = f"{f['agent_id']}:{(f.get('error_message') or 'unknown')[:60]}"
        groups[key].append(f)

    log(f"Grouped into {len(groups)} failure patterns")

    # Open client knowledge DB
    if not os.path.exists(CLIENT_DB):
        log(f"Client knowledge DB not found: {CLIENT_DB}")
        return

    client_conn = sqlite3.connect(CLIENT_DB)
    created = 0

    for pattern_key, entries in groups.items():
        agent_id = entries[0]['agent_id']
        error_msg = entries[0].get('error_message', 'unknown')
        count = len(entries)
        action = entries[0].get('action_type', 'unknown')

        # Build prompt for Haiku
        prompt = (
            f"An AI agent '{agent_id}' performing '{action}' failed {count} time(s) this week.\n"
            f"Error: {error_msg[:200]}\n\n"
            f"Distill a single actionable lesson learned from this failure in 1-2 sentences. "
            f"Start with 'When [doing X], [avoid/ensure Y] because [reason].' "
            f"Be specific and practical, not generic."
        )

        lesson = call_haiku(prompt)
        if not lesson:
            # Fallback: create a simple lesson without LLM
            lesson = f"When {agent_id} performs {action}, failures occurred {count}x: {error_msg[:150]}. Investigate root cause."

        # Check for duplicate (content hash)
        content_hash = hashlib.sha256(lesson.encode()).hexdigest()[:16]
        existing = client_conn.execute(
            "SELECT id FROM client_knowledge WHERE content_hash = ?", (content_hash,)
        ).fetchone()
        if existing:
            log(f"  Skipped duplicate for {pattern_key}")
            continue

        # Insert as draft
        client_conn.execute(
            "INSERT INTO client_knowledge (content, category, knowledge_type, target_agents, status, source, content_hash) "
            "VALUES (?, 'operational', 'lesson_learned', ?, 'draft', 'failure-lesson', ?)",
            (lesson, json.dumps([agent_id]), content_hash)
        )
        created += 1
        log(f"  Created draft: [{agent_id}] {lesson[:80]}...")

    client_conn.commit()
    client_conn.close()

    log(f"Done: {created} new draft knowledge entries from {len(groups)} failure patterns")


if __name__ == '__main__':
    process_failures()
