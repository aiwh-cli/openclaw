#!/usr/bin/env python3
"""
extract-cinematic-knowledge.py — Extract knowledge from cinematic style_grades

Reads style_grades from video-jobs.db, aggregates patterns from high-grade (4-5)
and low-grade (1-2) prompts, and pushes knowledge entries to Supabase.

Runs as part of nightly-knowledge-pipeline.sh.
"""

import os
import sys
import json
import re
import subprocess
import sqlite3
import hashlib
import logging
from datetime import datetime
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError

# --- Config ---
CLIENT_ROOT = os.environ.get("CLIENT_ROOT", "/opt/AIWH/client")
DB_PATH = os.path.join(CLIENT_ROOT, "data", "video-jobs.db")
LOG_DIR = os.path.join(CLIENT_ROOT, "logs")
STAGING_DIR = os.path.join(os.environ.get("AIWH_CORE", "/opt/AIWH/core"), "data", "staging")

# Supabase config from env
ENV_FILE = os.environ.get("AIWH_OPENCLAW_ENV", "/opt/AIWH/.openclaw/.env")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("cinematic-knowledge")


def load_env():
    """Load secrets from encrypted store (primary) or .env fallback."""
    # Primary: encrypted secrets via secrets.py
    secrets_py = Path("/opt/AIWH/core/scripts/lib/secrets.py")
    if secrets_py.exists():
        try:
            result = subprocess.run(
                ['python3', str(secrets_py), 'load', '--all'],
                capture_output=True, text=True, timeout=10
            )
            for line in result.stdout.split('\n'):
                m = re.match(r"^export\s+([A-Z_][A-Z0-9_]*)='(.*)'$", line)
                if m:
                    os.environ.setdefault(m.group(1), m.group(2))
        except Exception:
            pass
    if os.environ.get('ANTHROPIC_API_KEY'):
        return
    # Fallback: .env file (legacy)
    if os.path.isfile(ENV_FILE):
        with open(ENV_FILE) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, _, val = line.partition("=")
                    os.environ.setdefault(key.strip(), val.strip())


def get_grades():
    """Fetch all style_grades from DB."""
    if not os.path.isfile(DB_PATH):
        logger.error(f"DB not found: {DB_PATH}")
        return []
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    rows = conn.execute("""
        SELECT grade, asset_type, prompt_used, style_tags, color_palette,
               composition_type, motion_type, mood, cjob_id, created_at
        FROM style_grades ORDER BY grade DESC
    """).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def extract_patterns(grades):
    """Aggregate patterns from grades into knowledge entries."""
    entries = []

    # High-grade patterns (4-5)
    high = [g for g in grades if g["grade"] >= 4]
    low = [g for g in grades if g["grade"] <= 2]

    if len(high) >= 3:
        # Aggregate by asset_type
        by_type = {}
        for g in high:
            t = g["asset_type"]
            if t not in by_type:
                by_type[t] = []
            by_type[t].append(g)

        for asset_type, items in by_type.items():
            if len(items) < 2:
                continue

            # Extract common prompt elements
            prompts = [i["prompt_used"] for i in items if i["prompt_used"]]
            moods = [i["mood"] for i in items if i.get("mood")]
            palettes = [i["color_palette"] for i in items if i.get("color_palette")]

            # Find recurring prompt phrases (simplified: look for common long substrings)
            common_phrases = find_common_phrases(prompts)

            content = (
                f"Cinematic {asset_type} quality pattern (from {len(items)} high-grade examples, "
                f"avg grade {sum(i['grade'] for i in items)/len(items):.1f}/5): "
            )

            if common_phrases:
                content += f"Recurring high-quality prompt elements: {'; '.join(common_phrases[:5])}. "

            if moods:
                from collections import Counter
                top_moods = Counter(moods).most_common(3)
                content += f"Preferred moods: {', '.join(m for m, _ in top_moods)}. "

            if palettes:
                from collections import Counter
                top_palettes = Counter(palettes).most_common(2)
                content += f"Preferred palettes: {', '.join(p for p, _ in top_palettes)}. "

            entries.append({
                "content": content.strip(),
                "category": "cinematic",
                "knowledge_type": "pattern",
                "target_agents": ["video", "copywriter"],
                "confidence": min(0.85, 0.60 + len(items) * 0.02),
                "source": f"style_grades:{asset_type}:high"
            })

    # Anti-patterns from low grades
    if len(low) >= 2:
        by_type = {}
        for g in low:
            t = g["asset_type"]
            if t not in by_type:
                by_type[t] = []
            by_type[t].append(g)

        for asset_type, items in by_type.items():
            prompts = [i["prompt_used"] for i in items if i["prompt_used"]]
            common_phrases = find_common_phrases(prompts)

            content = (
                f"Cinematic {asset_type} anti-pattern (from {len(items)} low-grade examples, "
                f"avg grade {sum(i['grade'] for i in items)/len(items):.1f}/5): "
                f"AVOID these prompt patterns. "
            )

            if common_phrases:
                content += f"Problematic elements: {'; '.join(common_phrases[:5])}. "

            # Include specific example of what went wrong
            worst = min(items, key=lambda x: x["grade"])
            if worst["prompt_used"]:
                snippet = worst["prompt_used"][:200]
                content += f"Example rejected prompt (grade {worst['grade']}): \"{snippet}...\""

            entries.append({
                "content": content.strip(),
                "category": "cinematic",
                "knowledge_type": "antipattern",
                "target_agents": ["video", "copywriter"],
                "confidence": min(0.80, 0.55 + len(items) * 0.03),
                "source": f"style_grades:{asset_type}:low"
            })

    # Overall style preference summary
    if len(grades) >= 10:
        avg_grade = sum(g["grade"] for g in grades) / len(grades)
        high_count = len(high)
        low_count = len(low)
        total = len(grades)

        content = (
            f"Cinematic style grading summary ({total} grades, avg {avg_grade:.1f}/5): "
            f"{high_count} high-grade (4-5), {low_count} low-grade (1-2). "
            f"Approval rate: {high_count/total*100:.0f}%. "
        )

        # Most common asset types in high grades
        from collections import Counter
        high_types = Counter(g["asset_type"] for g in high)
        content += f"Best performing asset types: {', '.join(f'{t} ({c})' for t, c in high_types.most_common(3))}."

        entries.append({
            "content": content.strip(),
            "category": "cinematic",
            "knowledge_type": "fact",
            "target_agents": ["video", "all"],
            "confidence": 0.90,
            "source": "style_grades:summary"
        })

    return entries


def find_common_phrases(texts, min_len=15, min_count=2):
    """Find recurring phrases across multiple texts (simplified approach)."""
    if len(texts) < 2:
        return []

    # Extract 3-5 word chunks and find common ones
    from collections import Counter
    chunks = Counter()
    for text in texts:
        words = text.split()
        for size in [3, 4, 5]:
            for i in range(len(words) - size + 1):
                chunk = " ".join(words[i:i+size])
                if len(chunk) >= min_len:
                    chunks[chunk] += 1

    # Return phrases that appear in at least min_count texts
    return [phrase for phrase, count in chunks.most_common(20) if count >= min_count]


def content_hash(content):
    return hashlib.sha256(content.encode()).hexdigest()[:16]


def push_to_supabase(entry):
    """Push a single knowledge entry to Supabase base_knowledge."""
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        logger.warning("Supabase not configured, writing to staging JSONL")
        return False

    payload = {
        "content": entry["content"],
        "category": entry["category"],
        "knowledge_type": entry["knowledge_type"],
        "target_agents": entry["target_agents"],
        "status": "draft",
        "source": entry.get("source", "cinematic-extraction"),
    }

    try:
        req = Request(
            f"{url}/rest/v1/base_knowledge",
            data=json.dumps(payload).encode(),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {key}",
                "apikey": key,
                "Prefer": "return=minimal",
            },
            method="POST",
        )
        urlopen(req, timeout=15)
        return True
    except HTTPError as e:
        body = e.read().decode() if hasattr(e, "read") else str(e)
        logger.error(f"Supabase POST failed: {e.code} — {body}")
        return False
    except Exception as e:
        logger.error(f"Supabase error: {e}")
        return False


def write_staging(entries):
    """Write entries to staging JSONL as fallback."""
    os.makedirs(STAGING_DIR, exist_ok=True)
    path = os.path.join(STAGING_DIR, f"cinematic-knowledge-{datetime.now().strftime('%Y%m%d')}.jsonl")
    with open(path, "a") as f:
        for entry in entries:
            f.write(json.dumps({
                "content": entry["content"],
                "category": entry["category"],
                "knowledge_type": entry["knowledge_type"],
                "target_agents": entry["target_agents"],
                "status": "draft",
                "source": entry.get("source", "cinematic-extraction"),
            }) + "\n")
    return path


def main():
    load_env()

    logger.info(f"Reading style_grades from {DB_PATH}")
    grades = get_grades()

    if not grades:
        logger.info("No style grades found, nothing to extract")
        return

    logger.info(f"Found {len(grades)} style grades")
    entries = extract_patterns(grades)

    if not entries:
        logger.info("No patterns extracted (need more data)")
        return

    logger.info(f"Extracted {len(entries)} knowledge entries")

    pushed = 0
    failed = 0
    for entry in entries:
        h = content_hash(entry["content"])
        logger.info(f"  [{entry['knowledge_type']}] {entry['content'][:80]}... (hash={h})")
        if push_to_supabase(entry):
            pushed += 1
        else:
            failed += 1

    if failed > 0:
        path = write_staging([e for e in entries])
        logger.warning(f"{failed} entries failed to push, written to {path}")

    logger.info(f"Done: {pushed} pushed to Supabase, {failed} failed")


if __name__ == "__main__":
    main()
