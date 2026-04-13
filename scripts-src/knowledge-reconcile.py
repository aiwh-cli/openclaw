#!/usr/bin/env python3
"""
Knowledge Reconciliation & Cleanup

Finds contradictions, stale entries, and near-duplicates in knowledge databases.
Runs weekly (Sunday 9pm) before the nightly pipeline.

Modes:
  --db supabase   Process Supabase base_knowledge (requires SERVICE_KEY)
  --db client     Process local client_knowledge.db
  --db both       Process both (default)

Usage:
  python3 knowledge-reconcile.py                    # both DBs, live
  python3 knowledge-reconcile.py --dry-run           # preview only
  python3 knowledge-reconcile.py --db client         # local only
  python3 knowledge-reconcile.py --dup-threshold 0.95 --contradiction-threshold 0.85
"""

import json
import math
import re
import subprocess
import os
import sys
import sqlite3
import logging
import argparse
from datetime import datetime, timedelta
from pathlib import Path
from urllib.request import Request, urlopen

# ── Config ──────────────────────────────────────────────
_CLIENT_ROOT = Path(os.environ.get("CLIENT_ROOT", "/opt/AIWH/client"))
_CORE_ROOT = Path("/opt/AIWH/core")
CLIENT_DB = _CLIENT_ROOT / "data" / "client_knowledge.db"
LOG_FILE = _CLIENT_ROOT / "logs" / "knowledge-reconcile.log"

# LLM provider abstraction (reads openclaw.json for provider/model)
sys.path.insert(0, str(_CORE_ROOT / "scripts" / "lib"))
from llm_provider import llm_call  # noqa: E402

# ── Logging ─────────────────────────────────────────────
def setup_logging():
    logger = logging.getLogger("reconcile")
    logger.setLevel(logging.INFO)
    fmt = logging.Formatter("[%(asctime)s] %(levelname)s: %(message)s", datefmt="%Y-%m-%d %H:%M:%S")
    ch = logging.StreamHandler()
    ch.setFormatter(fmt)
    logger.addHandler(ch)
    try:
        LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        fh = logging.FileHandler(LOG_FILE, mode='a')
        fh.setFormatter(fmt)
        logger.addHandler(fh)
    except Exception:
        pass
    return logger

# ── Env ─────────────────────────────────────────────────
def load_env():
    env = dict(os.environ)
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
                    env.setdefault(m.group(1), m.group(2))
        except Exception:
            pass
    if env.get('ANTHROPIC_API_KEY'):
        return env
    # Fallback: .env file (legacy)
    env_file = Path("/opt/AIWH/.openclaw/.env")
    if env_file.exists():
        try:
            for line in env_file.read_text().splitlines():
                line = line.strip()
                if not line or line.startswith('#') or '=' not in line:
                    continue
                k, v = line.split('=', 1)
                env.setdefault(k.strip(), v.strip())
        except Exception:
            pass
    return env

# ── Math ────────────────────────────────────────────────
def cosine_sim(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    return dot / (na * nb) if na * nb > 0 else 0.0

# ── Haiku contradiction check ───────────────────────────
def check_contradiction(entry_a, entry_b, env, logger):
    """Ask LLM if two entries contradict each other. Returns (bool, explanation)."""
    prompt = (
        "Do these two knowledge entries contradict each other? "
        "Answer ONLY 'YES' or 'NO' on the first line, then a one-line explanation.\n\n"
        f"Entry A: {entry_a}\n\nEntry B: {entry_b}"
    )
    try:
        text = llm_call(prompt, max_tokens=100, temperature=0, timeout=30)
        if not text:
            return False, "LLM returned empty response"
        text = text.strip()
        first_line = text.split('\n')[0].strip().upper()
        explanation = text.split('\n')[1].strip() if '\n' in text else text
        return first_line.startswith('YES'), explanation
    except Exception as e:
        logger.warning(f"Contradiction check failed: {e}")
        return False, str(e)

# ── Staleness check (AI-powered) ────────────────────────
def load_agent_context(logger):
    """Load current agent SOUL.md/TOOLS.md files for staleness comparison."""
    modules_dir = _CORE_ROOT / "modules"
    if not modules_dir.exists():
        return {}
    context = {}
    for soul in modules_dir.glob("**/SOUL.md"):
        agent_name = soul.parent.name
        try:
            content = soul.read_text(errors='replace')[:2000]
            tools_path = soul.parent / "TOOLS.md"
            if tools_path.exists():
                content += "\n\n--- TOOLS.md ---\n" + tools_path.read_text(errors='replace')[:1000]
            context[agent_name] = content
        except Exception:
            pass
    logger.info(f"Loaded context for {len(context)} agents")
    return context


def check_staleness_ai(entry, agent_context, env, logger):
    """Use LLM to check if an entry is still consistent with current agent configs."""
    content = entry.get('content', '')
    target_agents = entry.get('target_agents', '["all"]')
    if isinstance(target_agents, str):
        try:
            target_agents = json.loads(target_agents)
        except (json.JSONDecodeError, TypeError):
            target_agents = ['all']

    # Find relevant agent context
    relevant_context = ""
    if 'all' in target_agents:
        for name in list(agent_context.keys())[:3]:
            relevant_context += f"\n--- {name} ---\n{agent_context[name][:500]}\n"
    else:
        for agent in target_agents:
            if agent in agent_context:
                relevant_context += f"\n--- {agent} ---\n{agent_context[agent][:800]}\n"

    if not relevant_context:
        return False, "no agent context available"

    prompt = (
        "You are checking if a knowledge entry contains FACTUALLY WRONG or OUTDATED information "
        "when compared to the current system configuration.\n\n"
        f"KNOWLEDGE ENTRY:\n{content}\n\n"
        f"CURRENT AGENT CONFIGURATION:\n{relevant_context}\n\n"
        "Rules:\n"
        "- Mark STALE ONLY if the entry contains a SPECIFIC FACTUAL CLAIM that is DIRECTLY "
        "CONTRADICTED by the current configuration (e.g., wrong model name, wrong word count, "
        "wrong file path, wrong command syntax).\n"
        "- If the entry is general advice, a pattern, or a principle that is not contradicted, "
        "mark it as CURRENT even if the config doesn't explicitly mention it.\n"
        "- When in doubt, mark CURRENT. False positives (archiving good knowledge) are worse "
        "than false negatives (keeping slightly outdated knowledge).\n\n"
        "Answer format: First line ONLY 'CURRENT' or 'STALE'. Second line: one-sentence explanation."
    )
    try:
        text = llm_call(prompt, max_tokens=100, temperature=0, timeout=30)
        if not text:
            return False, "LLM returned empty response"
        text = text.strip()
        lines = [l.strip() for l in text.split('\n') if l.strip()]
        verdict = lines[0].upper() if lines else "CURRENT"
        explanation = lines[1] if len(lines) > 1 else (lines[0] if lines else "no explanation")
        is_stale = 'STALE' in verdict
        return is_stale, explanation
    except Exception as e:
        logger.warning(f"Staleness AI check failed: {e}")
        return False, str(e)

# ── Fetch entries from a database ───────────────────────
def fetch_supabase_entries(env, logger, include_drafts=False):
    """Fetch published (and optionally draft) entries with embeddings from Supabase."""
    url = env.get('SUPABASE_URL', '')
    key = env.get('SUPABASE_SERVICE_KEY', '')
    if not url or not key:
        logger.warning("Supabase not configured — skipping")
        return []
    statuses = ['published']
    if include_drafts:
        statuses.append('draft')
    try:
        entries = []
        for status in statuses:
            offset = 0
            while True:
                req = Request(
                    f"{url}/rest/v1/base_knowledge?status=eq.{status}&embedding=not.is.null"
                    f"&select=id,content,category,knowledge_type,embedding,created_at,status,source"
                    f"&order=id&offset={offset}&limit=500",
                    headers={"apikey": key, "Authorization": f"Bearer {key}", "Accept": "application/json"}
                )
                with urlopen(req, timeout=30) as resp:
                    batch = json.loads(resp.read().decode())
                if not batch:
                    break
                entries.extend(batch)
                offset += len(batch)
                if len(batch) < 500:
                    break
            logger.info(f"Fetched {sum(1 for e in entries if e.get('status') == status)} {status} entries from Supabase")
        return entries
    except Exception as e:
        logger.warning(f"Failed to fetch Supabase entries: {e}")
        return []


def fetch_client_entries(logger):
    """Fetch published entries with embeddings from client_knowledge.db."""
    if not CLIENT_DB.exists():
        return []
    try:
        conn = sqlite3.connect(str(CLIENT_DB))
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT id, content, category, knowledge_type, embedding, created_at "
            "FROM client_knowledge WHERE status='published' AND embedding IS NOT NULL"
        ).fetchall()
        conn.close()
        entries = [dict(r) for r in rows]
        logger.info(f"Fetched {len(entries)} published entries from client_knowledge.db")
        return entries
    except Exception as e:
        logger.warning(f"Failed to fetch client entries: {e}")
        return []

# ── Archive an entry ────────────────────────────────────
def archive_entry(entry_id, reason, db_type, env, logger, dry_run):
    """Archive an entry in the specified database."""
    if dry_run:
        logger.info(f"  [DRY-RUN] Would archive {db_type} entry {str(entry_id)[:12]}... — {reason}")
        return
    if db_type == "supabase":
        url = env.get('SUPABASE_URL', '')
        key = env.get('SUPABASE_SERVICE_KEY', '')
        if url and key:
            try:
                payload = json.dumps({"status": "archived"}).encode()
                req = Request(
                    f"{url}/rest/v1/base_knowledge?id=eq.{entry_id}",
                    data=payload, method='PATCH',
                    headers={"apikey": key, "Authorization": f"Bearer {key}",
                             "Content-Type": "application/json", "Prefer": "return=minimal"}
                )
                urlopen(req, timeout=15)
            except Exception as e:
                logger.warning(f"Failed to archive Supabase entry {entry_id}: {e}")
    elif db_type == "client":
        try:
            conn = sqlite3.connect(str(CLIENT_DB))
            conn.execute(
                "UPDATE client_knowledge SET status='archived', is_archived=1, "
                "updated_at=datetime('now') WHERE id=?", (entry_id,)
            )
            conn.commit()
            conn.close()
        except Exception as e:
            logger.warning(f"Failed to archive client entry {entry_id}: {e}")
    logger.info(f"  Archived {db_type} entry {str(entry_id)[:12]}... — {reason}")

# ── Parse embedding from various formats ────────────────
def parse_embedding(raw):
    """Parse embedding from string or list."""
    if isinstance(raw, list):
        return raw
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                return parsed
        except (json.JSONDecodeError, TypeError):
            pass
    return None

# ── Main reconciliation ────────────────────────────────
def reconcile(entries, db_type, env, logger, args):
    """Run all reconciliation checks on a list of entries."""
    stats = {"contradictions": 0, "stale": 0, "near_dupes": 0, "flagged": 0, "quality": 0}

    if not entries:
        logger.info(f"No entries to reconcile in {db_type}")
        return stats

    # Parse embeddings
    parsed = []
    for e in entries:
        emb = parse_embedding(e.get('embedding'))
        if emb:
            parsed.append({**e, 'embedding_vec': emb})

    logger.info(f"Processing {len(parsed)} entries with valid embeddings ({db_type})")

    # Sort by date — newest first (newest = most authoritative)
    parsed.sort(key=lambda e: e.get('created_at', ''), reverse=True)
    archived_ids = set()

    # ── Evolution chains: same topic entries → only keep latest ──
    # If entries are >dup_threshold similar, they're about the same thing.
    # The NEWEST one represents the latest understanding. Archive all older ones.
    logger.info(f"Checking evolution chains + near-duplicates (threshold={args.dup_threshold})...")
    for i, a in enumerate(parsed):
        if a['id'] in archived_ids:
            continue
        for j, b in enumerate(parsed):
            if j <= i or b['id'] in archived_ids:
                continue
            sim = cosine_sim(a['embedding_vec'], b['embedding_vec'])
            if sim >= args.dup_threshold:
                # a is newer (sorted newest-first), b is older → archive b
                archive_entry(b['id'],
                    f"superseded by newer entry {str(a['id'])[:12]} (sim={sim:.3f})",
                    db_type, env, logger, args.dry_run)
                archived_ids.add(b['id'])
                stats['near_dupes'] += 1

        if i > 0 and i % 100 == 0:
            logger.info(f"  Checked {i}/{len(parsed)} entries...")

    # ── Contradiction detection (related but conflicting) ──
    # For entries with moderate similarity, ask Haiku if they contradict.
    # Newer entry ALWAYS wins — it represents evolved understanding.
    logger.info(f"Checking contradictions (threshold={args.contradiction_threshold})...")
    for i, a in enumerate(parsed):
        if a['id'] in archived_ids:
            continue
        for j, b in enumerate(parsed):
            if j <= i or b['id'] in archived_ids:
                continue
            sim = cosine_sim(a['embedding_vec'], b['embedding_vec'])
            if args.contradiction_threshold <= sim < args.dup_threshold:
                is_contra, explanation = check_contradiction(
                    a['content'], b['content'], env, logger
                )
                if is_contra:
                    # a is newer → archive b (older contradicting entry)
                    archive_entry(b['id'],
                        f"contradicts newer entry {str(a['id'])[:12]}: {explanation}",
                        db_type, env, logger, args.dry_run)
                    archived_ids.add(b['id'])
                    stats['contradictions'] += 1

        if i > 0 and i % 50 == 0:
            logger.info(f"  Checked {i}/{len(parsed)} for contradictions...")

    # ── Quality noise filter (free — no LLM calls) ──
    logger.info("Checking content quality...")
    html_re = re.compile(r'<(div|span|nav|script|style|header|footer|section|ul|ol|li)\b', re.I)
    url_re = re.compile(r'https?://\S+')
    quality_archived = 0
    for e in entries:
        if e['id'] in archived_ids:
            continue
        content = (e.get('content') or '').strip()
        # Too short to be useful knowledge
        if len(content) < 30:
            archive_entry(e['id'], f"low quality: content too short ({len(content)} chars)",
                          db_type, env, logger, args.dry_run)
            archived_ids.add(e['id'])
            quality_archived += 1
            continue
        # Mostly HTML markup
        if html_re.search(content):
            tag_count = len(html_re.findall(content))
            if tag_count >= 3:
                archive_entry(e['id'], f"low quality: HTML markup ({tag_count} tags)",
                              db_type, env, logger, args.dry_run)
                archived_ids.add(e['id'])
                quality_archived += 1
                continue
        # Content is mostly URLs (>50% of length)
        urls = url_re.findall(content)
        url_chars = sum(len(u) for u in urls)
        if url_chars > len(content) * 0.5 and len(urls) >= 2:
            archive_entry(e['id'], f"low quality: mostly URLs ({len(urls)} links)",
                          db_type, env, logger, args.dry_run)
            archived_ids.add(e['id'])
            quality_archived += 1
    if quality_archived:
        logger.info(f"  Quality filter archived {quality_archived} entries")
        stats['quality'] = quality_archived

    # ── AI-powered staleness check against current agent files ──
    logger.info("Checking staleness against current agent configurations...")
    agent_context = load_agent_context(logger)
    # Only check entries not already archived, sample to control API costs
    remaining = [e for e in entries if e['id'] not in archived_ids]
    # Check oldest entries first (most likely stale). Auto-scale batch: 30 normally, 100 if backlog >50
    remaining.sort(key=lambda e: e.get('created_at', ''))
    batch_size = 100 if len(remaining) > 50 else 30
    checked = 0
    for e in remaining[:batch_size]:
        is_stale, reason = check_staleness_ai(e, agent_context, env, logger)
        if is_stale:
            archive_entry(e['id'], f"stale (AI): {reason}",
                          db_type, env, logger, args.dry_run)
            archived_ids.add(e['id'])
            stats['stale'] += 1
        checked += 1
        if checked % 10 == 0:
            logger.info(f"  Staleness checked {checked}/{min(len(remaining), batch_size)} entries...")

    # ── Age-based flagging (>90 days, short content = low value) ──
    cutoff = (datetime.now() - timedelta(days=90)).isoformat()
    for e in entries:
        if e['id'] in archived_ids:
            continue
        created = e.get('created_at', '')
        if created and created < cutoff and len(e.get('content', '')) < 50:
            logger.info(f"  Flagged old short entry {str(e['id'])[:12]} for review")
            stats['flagged'] += 1

    return stats


def main():
    parser = argparse.ArgumentParser(description="Knowledge reconciliation & cleanup")
    parser.add_argument('--db', choices=['supabase', 'client', 'both'], default='both')
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--include-drafts', action='store_true',
                        help='Also process draft entries (for one-time cleanup)')
    parser.add_argument('--dup-threshold', type=float, default=0.95,
                        help='Cosine similarity for near-duplicate detection (default: 0.95)')
    parser.add_argument('--contradiction-threshold', type=float, default=0.85,
                        help='Min similarity to check for contradictions (default: 0.85)')
    args = parser.parse_args()

    logger = setup_logging()
    env = load_env()

    logger.info("=" * 50)
    logger.info(f"KNOWLEDGE RECONCILIATION — {args.db.upper()}")
    logger.info(f"Mode: {'DRY-RUN' if args.dry_run else 'LIVE'}")
    logger.info("=" * 50)

    total_stats = {"contradictions": 0, "stale": 0, "near_dupes": 0, "flagged": 0, "quality": 0}

    if args.db in ('supabase', 'both'):
        entries = fetch_supabase_entries(env, logger, include_drafts=args.include_drafts)
        stats = reconcile(entries, "supabase", env, logger, args)
        for k in total_stats:
            total_stats[k] += stats[k]

    if args.db in ('client', 'both'):
        entries = fetch_client_entries(logger)
        stats = reconcile(entries, "client", env, logger, args)
        for k in total_stats:
            total_stats[k] += stats[k]

    summary = (
        f"Reconciliation complete: "
        f"{total_stats['contradictions']} contradictions, "
        f"{total_stats['stale']} stale, "
        f"{total_stats['near_dupes']} near-duplicates, "
        f"{total_stats['quality']} low-quality, "
        f"{total_stats['flagged']} flagged for review"
    )
    logger.info(summary)
    print(summary)


if __name__ == '__main__':
    main()
