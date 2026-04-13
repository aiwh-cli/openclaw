#!/usr/bin/env python3
"""
Embed and publish draft entries in client_knowledge.db.

Called by nightly-knowledge-pipeline.sh (Step 3c).
Processes up to 50 entries per run to respect OpenAI rate limits.
Auto-publishes all entries (client knowledge has no review gate).

Usage:
  python3 embed-client-knowledge.py
  python3 embed-client-knowledge.py --dry-run
  python3 embed-client-knowledge.py --limit 20
"""

import json
import os
import sqlite3
import sys
import argparse
from pathlib import Path
from urllib.request import Request, urlopen

CLIENT_ROOT = Path(os.environ.get("CLIENT_ROOT", "/opt/AIWH/client"))
CLIENT_DB = CLIENT_ROOT / "data" / "client_knowledge.db"
OPENAI_API = "https://api.openai.com/v1/embeddings"
EMBED_MODEL = "text-embedding-3-small"


def get_api_key():
    """Get OpenAI API key from env (loaded by env.sh/aiwh_load_secrets)."""
    return os.environ.get("OPENAI_API_KEY", "")


def get_drafts(conn, limit):
    """Fetch draft entries needing embeddings."""
    try:
        rows = conn.execute(
            "SELECT id, content FROM client_knowledge "
            "WHERE status='draft' AND (embedding IS NULL OR embedding = '') "
            "LIMIT ?",
            (limit,)
        ).fetchall()
        return [{"id": r[0], "content": r[1]} for r in rows]
    except sqlite3.OperationalError:
        return []


def get_embedding(text, api_key):
    """Get OpenAI text-embedding-3-small vector."""
    payload = json.dumps({"input": text, "model": EMBED_MODEL}).encode()
    req = Request(OPENAI_API, data=payload, headers={
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }, method="POST")
    with urlopen(req, timeout=20) as resp:
        result = json.loads(resp.read().decode())
    return result["data"][0]["embedding"]


def main():
    parser = argparse.ArgumentParser(description="Embed + publish client_knowledge drafts")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be processed")
    parser.add_argument("--limit", type=int, default=50, help="Max entries per run (default: 50)")
    args = parser.parse_args()

    if not CLIENT_DB.exists():
        print("Client knowledge: 0 processed (DB not found)")
        return

    api_key = get_api_key()
    if not api_key and not args.dry_run:
        print("Client knowledge: 0 processed (no OPENAI_API_KEY)")
        return

    conn = sqlite3.connect(str(CLIENT_DB))
    drafts = get_drafts(conn, args.limit)

    if not drafts:
        print("Client knowledge: 0 processed (no drafts)")
        conn.close()
        return

    if args.dry_run:
        print(f"Client knowledge: {len(drafts)} would be processed (dry-run)")
        for d in drafts:
            print(f"  id={d['id']}: {d['content'][:80]}...")
        conn.close()
        return

    processed = 0
    failed = 0
    for entry in drafts:
        try:
            embedding = get_embedding(entry["content"], api_key)
            conn.execute(
                "UPDATE client_knowledge SET embedding = ?, embedding_model = ?, "
                "status = 'published', updated_at = datetime('now') WHERE id = ?",
                (json.dumps(embedding), EMBED_MODEL, entry["id"])
            )
            conn.commit()
            processed += 1
        except Exception as e:
            print(f"  Error embedding id={entry['id']}: {e}", file=sys.stderr)
            failed += 1

    conn.close()
    print(f"Client knowledge: {processed} processed, {failed} failed")


if __name__ == "__main__":
    main()
