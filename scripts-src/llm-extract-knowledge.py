#!/usr/bin/env python3
"""
LLM-based Knowledge Extraction (Step 1b of nightly pipeline)

Uses Claude Haiku to extract reusable knowledge from memory files without
requiring #knowledge-extraction tags. Applies semantic deduplication via
OpenAI embeddings (cosine similarity) before inserting.

Scan scope (all in core/ — Branson's workspace, your IP):
  - /opt/AIWH/core/MEMORY.md (institutional memory)
  - /opt/AIWH/core/memory/*.md (daily session logs)
  - /opt/AIWH/core/modules/*/MEMORY.md (agent learnings)
  - /opt/AIWH/core/modules/*/memory/*.md (agent daily logs)

All failures are non-blocking — existing pipeline is unaffected.

Usage:
  python3 llm-extract-knowledge.py --hours 25
  python3 llm-extract-knowledge.py --hours 48 --dry-run
  python3 llm-extract-knowledge.py --hours 25 --threshold 0.92
"""

import json
import sqlite3
import hashlib
import math
import sys
import os
import re
import subprocess
import logging
import argparse
from datetime import datetime, timedelta
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

# ============================================================================
# CONFIGURATION
# ============================================================================

ENV_FILE = Path("/opt/AIWH/.openclaw/.env")
_CORE_ROOT = Path("/opt/AIWH/core")
_CLIENT_ROOT = Path(os.environ.get("CLIENT_ROOT", "/opt/AIWH/client"))
CLIENT_KNOWLEDGE_DB = _CLIENT_ROOT / "data" / "client_knowledge.db"
LOG_FILE = _CLIENT_ROOT / "logs" / "llm-extract-knowledge.log"

# LLM provider abstraction (reads openclaw.json for provider/model)
sys.path.insert(0, str(_CORE_ROOT / "scripts" / "lib"))
from llm_provider import llm_call  # noqa: E402
OPENAI_EMBED_API = "https://api.openai.com/v1/embeddings"
EMBED_MODEL = "text-embedding-3-small"

VALID_CATEGORIES = [
    "video", "integration", "infrastructure", "process", "architecture",
    "openclaw-crons", "openclaw-config", "openclaw-enforcement",
    "delegation", "workflow", "nextjs", "react", "python", "devops", "ai",
    "safety", "cost-optimization", "business", "documentation", "culture",
    "collaboration", "security", "client", "agent", "memory", "testing",
    "supabase", "discord", "social", "email", "calendar", "trading",
    "coaching", "funnel", "sales", "crm", "finance", "knowledge-search",
    "knowledge-extraction",
]

VALID_TYPES = [
    "pattern", "antipattern", "insight", "bug-fix", "optimization",
    "decision", "principle", "workflow", "learning", "integration",
]

EXTRACT_PROMPT_TEMPLATE = """You are a knowledge extraction specialist. Read the following memory file and extract reusable knowledge patterns that AI agents could benefit from knowing.

Extract entries that are:
- Reusable patterns, anti-patterns, or lessons learned
- Architecture or design decisions with rationale
- System-specific behaviours, gotchas, or configurations
- Process improvements or workflow insights

DO NOT extract:
- Session-specific data (specific job IDs, run timestamps, temporary state)
- Obvious common knowledge or generic programming advice
- Personal or credential information
- Content too vague to be actionable without further context

For each entry, return a JSON array of objects with EXACTLY these fields:
- "content": Clear, self-contained 2-4 sentence knowledge statement. Must be understandable without the source file.
- "category": One of: {categories}
- "knowledge_type": One of: {types}
- "confidence": Float 0.0-1.0 (how reusable and reliable this pattern is; 0.90+ means auto-publish tonight)
- "target_agents": Array of valid agent IDs. ONLY use these values: "all", "copywriter", "video", "research", "social", "sales", "funnel", "crm-manager", "cfo", "calendar-manager", "email-manager", "systems", "coach", "trading", "travel", "builder-manager", "security-manager", "ai-council", "scheduler", "module-manager", "main". Use ["all"] if broadly applicable.

Return ONLY a valid JSON array. If nothing extractable is found, return [].

Memory file content:
---
{content}
---"""

# ============================================================================
# LOGGING
# ============================================================================

def setup_logging():
    logger = logging.getLogger("llm-extract")
    logger.setLevel(logging.INFO)
    fmt = logging.Formatter(
        "[%(asctime)s] %(levelname)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S"
    )
    ch = logging.StreamHandler()
    ch.setFormatter(fmt)
    logger.addHandler(ch)
    try:
        LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        fh = logging.FileHandler(LOG_FILE, mode='a')
        fh.setFormatter(fmt)
        logger.addHandler(fh)
    except Exception:
        pass  # Log to console only if file handler fails
    return logger

# ============================================================================
# ENVIRONMENT
# ============================================================================

def load_env():
    """Load secrets from encrypted store (primary) or .env fallback."""
    env = {}
    # Primary: encrypted secrets via secrets.py
    secrets_py = _CORE_ROOT / "scripts" / "lib" / "secrets.py"
    if secrets_py.exists():
        try:
            result = subprocess.run(
                ['python3', str(secrets_py), 'load', '--all'],
                capture_output=True, text=True, timeout=10
            )
            for line in result.stdout.split('\n'):
                m = re.match(r"^export\s+([A-Z_][A-Z0-9_]*)='(.*)'$", line)
                if m:
                    env[m.group(1)] = m.group(2)
        except Exception:
            pass
    if env:  # secrets.py loaded successfully
        return env
    # Fallback: .env file (legacy, may not exist)
    if ENV_FILE.exists():
        try:
            with open(ENV_FILE) as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith('#') or '=' not in line:
                        continue
                    key, val = line.split('=', 1)
                    env[key.strip()] = val.strip()
        except Exception:
            pass
    return env

# ============================================================================
# FILE DISCOVERY
# ============================================================================

def get_modified_files(hours):
    cutoff = datetime.now() - timedelta(hours=hours)
    found = []

    # Branson's MEMORY.md (core root)
    single = _CORE_ROOT / "MEMORY.md"
    if single.exists() and single.is_file():
        if datetime.fromtimestamp(single.stat().st_mtime) >= cutoff:
            found.append(single)

    # Branson's daily logs (core/memory/)
    mem_dir = _CORE_ROOT / "memory"
    if mem_dir.is_dir():
        for f in mem_dir.glob("*.md"):
            if f.is_file() and datetime.fromtimestamp(f.stat().st_mtime) >= cutoff:
                found.append(f)

    # Agent MEMORY.md and daily logs (core/modules/{module}/{agent}/)
    modules_dir = _CORE_ROOT / "modules"
    if modules_dir.is_dir():
        for f in modules_dir.glob("*/*/MEMORY.md"):
            if f.is_file() and datetime.fromtimestamp(f.stat().st_mtime) >= cutoff:
                found.append(f)
        for f in modules_dir.glob("*/*/memory/*.md"):
            if f.is_file() and datetime.fromtimestamp(f.stat().st_mtime) >= cutoff:
                found.append(f)

    # Deduplicate while preserving order
    seen = set()
    unique = []
    for f in found:
        key = str(f.resolve())
        if key not in seen:
            seen.add(key)
            unique.append(f)
    return sorted(unique)

# ============================================================================
# SUPABASE: FETCH EXISTING EMBEDDINGS FOR SEMANTIC DEDUP
# ============================================================================

def fetch_existing_embeddings(env, logger):
    """Fetch all non-null embeddings from Supabase. Returns list of embedding vectors."""
    supabase_url = env.get('SUPABASE_URL', '')
    service_key = env.get('SUPABASE_SERVICE_KEY', '')
    if not supabase_url or not service_key:
        logger.warning("Supabase not configured — skipping semantic dedup")
        return []
    try:
        url = (
            f"{supabase_url}/rest/v1/base_knowledge"
            f"?select=id,embedding&embedding=not.is.null&limit=1000"
        )
        req = Request(url, headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Accept": "application/json",
        })
        with urlopen(req, timeout=20) as resp:
            rows = json.loads(resp.read().decode())
        embeddings = []
        for row in rows:
            emb = row.get('embedding')
            if isinstance(emb, list) and emb:
                embeddings.append(emb)
        logger.info(f"Fetched {len(embeddings)} existing embeddings for dedup")
        return embeddings
    except Exception as e:
        logger.warning(f"Failed to fetch embeddings for dedup: {e} — will skip semantic dedup")
        return []

# ============================================================================
# HAIKU EXTRACTION
# ============================================================================

def call_haiku(content, env, logger):
    """Call LLM to extract knowledge entries. Returns list of dicts.
    Uses llm_provider for provider-agnostic calls (reads openclaw.json).
    """
    prompt = EXTRACT_PROMPT_TEMPLATE.format(
        categories=", ".join(VALID_CATEGORIES),
        types=", ".join(VALID_TYPES),
        content=content[:8000],  # Avoid token overflow
    )

    try:
        text = llm_call(prompt, max_tokens=4000, temperature=1.0, timeout=60)
        if not text:
            logger.warning("LLM returned empty response — skipping extraction")
            return []
        text = text.strip()

        # Strip markdown code fences if Haiku wraps the JSON
        if text.startswith('```'):
            text = re.sub(r'^```[a-z]*\s*', '', text)
            text = re.sub(r'\s*```$', '', text.strip())

        # Try parsing JSON directly
        try:
            entries = json.loads(text)
            if not isinstance(entries, list):
                logger.warning(f"Haiku returned non-list: {type(entries)}")
                return []
            return entries
        except json.JSONDecodeError as e:
            logger.warning(f"JSON parse failed (attempt 1): {e} — raw text: {text[:200]}")

        # Attempt 2: Extract JSON array from mixed text (Haiku sometimes adds prose)
        array_match = re.search(r'\[[\s\S]*\]', text)
        if array_match:
            try:
                entries = json.loads(array_match.group())
                if isinstance(entries, list):
                    logger.info("JSON recovered via regex extraction (attempt 2)")
                    return entries
            except json.JSONDecodeError:
                pass

        # Attempt 3: Fix common JSON issues (trailing commas, unescaped quotes/newlines)
        try:
            cleaned = re.sub(r',\s*([}\]])', r'\1', text)  # Remove trailing commas
            # Fix unescaped newlines inside JSON strings
            in_string = False
            fixed_chars = []
            i = 0
            while i < len(cleaned):
                c = cleaned[i]
                if c == '"' and (i == 0 or cleaned[i-1] != '\\'):
                    in_string = not in_string
                    fixed_chars.append(c)
                elif c == '\n' and in_string:
                    fixed_chars.append('\\n')
                else:
                    fixed_chars.append(c)
                i += 1
            cleaned = ''.join(fixed_chars)
            entries = json.loads(cleaned)
            if isinstance(entries, list):
                logger.info("JSON recovered via cleanup (attempt 3)")
                return entries
        except json.JSONDecodeError:
            pass

        # Attempt 4: Parse individual JSON objects from the text
        try:
            individual_entries = []
            for obj_match in re.finditer(r'\{[^{}]*\}', text):
                try:
                    obj = json.loads(obj_match.group())
                    if 'content' in obj:
                        individual_entries.append(obj)
                except json.JSONDecodeError:
                    continue
            if individual_entries:
                logger.info(f"JSON recovered via individual object extraction (attempt 4): {len(individual_entries)} entries")
                return individual_entries
        except Exception:
            pass

        logger.error(f"All JSON parse attempts failed. Raw Haiku output ({len(text)} chars): {text[:300]}")
        return []

    except json.JSONDecodeError as e:
        logger.error(f"Invalid JSON from LLM: {e}")
        return []
    except Exception as e:
        logger.warning(f"Unexpected error calling LLM: {e}")
        return []

# ============================================================================
# EMBEDDINGS & SEMANTIC DEDUP
# ============================================================================

def cosine_sim(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    return dot / (na * nb) if na * nb > 0 else 0.0


def get_embedding(text, env, logger):
    """Get OpenAI text-embedding-3-small vector. Returns list of floats or None."""
    api_key = env.get('OPENAI_API_KEY', '')
    if not api_key:
        return None
    try:
        payload = json.dumps({"input": text, "model": EMBED_MODEL}).encode('utf-8')
        req = Request(
            OPENAI_EMBED_API,
            data=payload,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            method='POST',
        )
        with urlopen(req, timeout=20) as resp:
            result = json.loads(resp.read().decode())
        return result['data'][0]['embedding']
    except Exception as e:
        logger.warning(f"OpenAI embedding failed: {e}")
        return None


def is_semantic_duplicate(embedding, existing_embeddings, threshold):
    for ex in existing_embeddings:
        if cosine_sim(embedding, ex) >= threshold:
            return True
    return False

# ============================================================================
# VALIDATION
# ============================================================================

def validate_and_normalise(entry, logger):
    """Validate entry dict from Haiku. Normalises in-place. Returns True if usable."""
    if not isinstance(entry, dict):
        return False

    content = str(entry.get('content', '')).strip()
    if len(content) < 20:
        return False
    entry['content'] = content

    # Normalise category with fallback
    cat = str(entry.get('category', '')).strip().lower()
    if cat not in VALID_CATEGORIES:
        logger.debug(f"Unknown category '{cat}' — defaulting to 'process'")
        cat = 'process'
    entry['category'] = cat

    # Normalise knowledge_type with fallback
    ktype = str(entry.get('knowledge_type', '')).strip().lower()
    if ktype not in VALID_TYPES:
        logger.debug(f"Unknown knowledge_type '{ktype}' — defaulting to 'insight'")
        ktype = 'insight'
    entry['knowledge_type'] = ktype

    # Normalise confidence
    try:
        conf = float(entry.get('confidence', 0.5))
        entry['confidence'] = max(0.0, min(1.0, conf))
    except (TypeError, ValueError):
        entry['confidence'] = 0.5

    # Normalise target_agents — must be valid agent IDs
    VALID_AGENTS = {'all','copywriter','video','research','social','sales','funnel',
        'crm-manager','cfo','calendar-manager','email-manager','systems','coach',
        'trading','travel','builder-manager','security-manager','ai-council',
        'scheduler','module-manager','main'}
    AGENT_ALIASES = {'devops':'systems','ai':'ai-council','publisher':'video',
        'researcher':'research','ops':'systems','ceo':'main','hr':'main',
        'builder':'builder-manager','architect':'builder-manager','marketing':'social',
        'infrastructure':'systems','workflow':'systems','finance':'cfo',
        'engineer':'builder-manager','strategy':'main','business':'main'}
    ta = entry.get('target_agents', ['all'])
    if isinstance(ta, str):
        ta = [ta]
    if not isinstance(ta, list):
        ta = ['all']
    # Map invalid IDs to valid ones
    cleaned = []
    for a in ta:
        a = a.strip().lower()
        if a in VALID_AGENTS:
            cleaned.append(a)
        elif a in AGENT_ALIASES:
            cleaned.append(AGENT_ALIASES[a])
        # else: drop invalid tag silently
    entry['target_agents'] = cleaned if cleaned else ['all']

    return True

# ============================================================================
# DATABASE WRITES
# ============================================================================

def init_sqlite(db_path):
    """Initialize client_knowledge table matching the schema used by knowledge-search-unified.sh."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    conn.execute("""
        CREATE TABLE IF NOT EXISTS client_knowledge (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            content TEXT NOT NULL,
            category TEXT,
            knowledge_type TEXT,
            version INTEGER DEFAULT 1,
            embedding TEXT,
            embedding_model TEXT,
            target_agents TEXT DEFAULT '["all"]',
            status TEXT DEFAULT 'draft',
            source TEXT,
            expires_at TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now')),
            is_archived INTEGER DEFAULT 0,
            content_hash TEXT UNIQUE,
            reference TEXT
        )
    """)
    # Add reference column if table already exists without it
    try:
        conn.execute("ALTER TABLE client_knowledge ADD COLUMN reference TEXT")
    except sqlite3.OperationalError:
        pass  # Column already exists
    conn.commit()
    return conn


def insert_sqlite(conn, entry, source):
    """Insert entry into client_knowledge table. Returns True if new, False if duplicate."""
    content_hash = hashlib.sha256(entry['content'].encode()).hexdigest()
    target_agents = json.dumps(entry.get('target_agents', ['all']))
    try:
        conn.execute(
            """INSERT INTO client_knowledge
               (content, category, knowledge_type, target_agents, status,
                source, content_hash, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                entry['content'],
                entry.get('category', ''),
                entry.get('knowledge_type', ''),
                target_agents,
                'draft',
                source,
                content_hash,
                datetime.now().isoformat(),
                datetime.now().isoformat(),
            )
        )
        conn.commit()
        return True
    except sqlite3.IntegrityError:
        return False  # content_hash UNIQUE violation = duplicate


def insert_supabase(entry, source, env, logger):
    """POST entry to Supabase base_knowledge as draft. Always returns True (non-blocking)."""
    supabase_url = env.get('SUPABASE_URL', '')
    service_key = env.get('SUPABASE_SERVICE_KEY', '')
    if not supabase_url or not service_key:
        return True

    target_agents = entry.get('target_agents', ['all'])
    if isinstance(target_agents, str):
        target_agents = [target_agents]

    payload = json.dumps({
        "content": entry.get('content', ''),
        "category": entry.get('category', ''),
        "knowledge_type": entry.get('knowledge_type', ''),
        "status": "draft",
        "source": source,
        "target_agents": target_agents,
    }).encode('utf-8')

    try:
        req = Request(
            f"{supabase_url}/rest/v1/base_knowledge",
            data=payload,
            headers={
                "apikey": service_key,
                "Authorization": f"Bearer {service_key}",
                "Content-Type": "application/json",
                "Prefer": "return=minimal",
            },
            method='POST',
        )
        with urlopen(req, timeout=15) as resp:
            if resp.status not in (200, 201, 204):
                logger.warning(f"Supabase insert returned HTTP {resp.status}")
    except Exception as e:
        logger.warning(f"Supabase insert failed (non-critical): {e}")

    return True  # Always non-blocking

# ============================================================================
# MAIN
# ============================================================================

def main():
    parser = argparse.ArgumentParser(
        description="LLM-based knowledge extraction from memory files (Step 1b)"
    )
    parser.add_argument(
        '--hours', type=int, default=25,
        help='Scan files modified in last N hours (default: 25)'
    )
    parser.add_argument(
        '--dry-run', action='store_true',
        help='Extract but do not write to SQLite or Supabase'
    )
    parser.add_argument(
        '--threshold', type=float, default=0.92,
        help='Cosine similarity threshold for semantic dedup (default: 0.92)'
    )
    args = parser.parse_args()

    logger = setup_logging()
    env = load_env()
    source = f"llm-extract-{datetime.now().strftime('%Y-%m-%d')}"

    # Discover modified files
    files = get_modified_files(args.hours)
    logger.info(f"Scanning {len(files)} files modified in last {args.hours}h")

    if not files:
        print(f"LLM Extracted: 0 new, 0 skipped (semantic dup), 0 failed | files: 0 scanned")
        return

    # Fetch existing embeddings once (for semantic dedup across all files)
    existing_embeddings = fetch_existing_embeddings(env, logger)

    # Open SQLite connection (unless dry-run)
    db_conn = None
    if not args.dry_run:
        try:
            db_conn = init_sqlite(CLIENT_KNOWLEDGE_DB)
        except Exception as e:
            logger.warning(f"Cannot open SQLite ({e}) — writes will be skipped")

    new_count = 0
    skipped_count = 0
    failed_count = 0

    for fpath in files:
        logger.info(f"Processing: {fpath}")

        try:
            content = fpath.read_text(encoding='utf-8', errors='replace')
        except Exception as e:
            logger.warning(f"Cannot read {fpath}: {e}")
            failed_count += 1
            continue

        if not content.strip():
            logger.debug(f"Empty file: {fpath}")
            continue

        # Extract with Haiku
        entries = call_haiku(content, env, logger)
        if not entries:
            logger.info(f"  No entries extracted from {fpath.name}")
            continue

        logger.info(f"  Haiku returned {len(entries)} candidate entries from {fpath.name}")

        for entry in entries:
            if not validate_and_normalise(entry, logger):
                logger.debug(f"  Invalid entry skipped: {str(entry)[:80]}")
                failed_count += 1
                continue

            if args.dry_run:
                logger.info(
                    f"  [DRY-RUN] [{entry['category']}/{entry['knowledge_type']}]"
                    f" conf={entry['confidence']:.2f}: {entry['content'][:80]}"
                )
                new_count += 1
                continue

            # Semantic dedup: get embedding for this entry
            embedding = get_embedding(entry['content'], env, logger)

            if embedding and existing_embeddings:
                if is_semantic_duplicate(embedding, existing_embeddings, args.threshold):
                    logger.info(
                        f"  Semantic duplicate (threshold={args.threshold}): "
                        f"{entry['content'][:60]}..."
                    )
                    skipped_count += 1
                    continue

            # Write to SQLite
            if db_conn is not None:
                inserted = insert_sqlite(db_conn, entry, source)
                if not inserted:
                    logger.debug(f"  Hash duplicate in SQLite: {entry['content'][:60]}")
                    skipped_count += 1
                    continue

            # Write to Supabase (only if we have SERVICE_KEY — dev/product owner mode)
            # Client Mac Minis only have the anon key (read-only) — they write locally only
            if env.get('SUPABASE_SERVICE_KEY', ''):
                insert_supabase(entry, source, env, logger)

            # Add to in-memory embedding cache to prevent same-run duplicates
            if embedding is not None:
                existing_embeddings.append(embedding)

            logger.info(
                f"  ✓ Inserted [{entry['category']}/{entry['knowledge_type']}]"
                f" conf={entry['confidence']:.2f}"
            )
            new_count += 1

    if db_conn is not None:
        db_conn.close()

    # Pipeline-parseable summary line (grep target in nightly-knowledge-pipeline.sh)
    print(
        f"LLM Extracted: {new_count} new, {skipped_count} skipped (semantic dup),"
        f" {failed_count} failed | files: {len(files)} scanned"
    )


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        # Fatal error — report zeros and exit 0 so the pipeline is never blocked
        logging.getLogger("llm-extract").exception(f"Fatal error: {e}")
        print("LLM Extracted: 0 new, 0 skipped (semantic dup), 0 failed | files: 0 scanned")
        sys.exit(0)
