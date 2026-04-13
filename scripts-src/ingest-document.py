#!/usr/bin/env python3
"""
Document Ingestion Pipeline

Parses PDF/DOCX/PPTX/MD/TXT files, chunks by document structure,
distills knowledge via Haiku, embeds, and publishes to client_knowledge.db.

Key principles:
- DISTILL, never copy-paste. Haiku rephrases into self-contained statements.
- NO file paths, system-specific references, or platform-specific commands.
- Prompt injection defense on input AND output.
- Reference tracking: document name, section, page number.

Usage:
  python3 ingest-document.py /path/to/file.pdf
  python3 ingest-document.py /path/to/file.docx --dry-run
  python3 ingest-document.py /path/to/file.md --max-entries 100
"""

import json
import hashlib
import math
import os
import re
import sys
import sqlite3
import logging
import argparse
from datetime import datetime
from pathlib import Path
from urllib.request import Request, urlopen

# ── Config ──────────────────────────────────────────────
_CLIENT_ROOT = Path(os.environ.get("CLIENT_ROOT", "/opt/AIWH/client"))
CLIENT_DB = _CLIENT_ROOT / "data" / "client_knowledge.db"
LOG_FILE = _CLIENT_ROOT / "logs" / "document-ingest.log"

OPENAI_EMBED_API = "https://api.openai.com/v1/embeddings"
EMBED_MODEL = "text-embedding-3-small"

SUPPORTED_EXTENSIONS = {'.pdf', '.docx', '.pptx', '.md', '.txt', '.json', '.jsonl', '.csv'}

# Add lib/ to path for document_parsers and llm_provider imports
sys.path.insert(0, str(Path(__file__).parent / "lib"))
from llm_provider import llm_call  # noqa: E402

# Prompt injection patterns to strip from input
INJECTION_PATTERNS = [
    r'ignore\s+(all\s+)?previous\s+instructions',
    r'you\s+are\s+now\s+a',
    r'forget\s+everything',
    r'disregard\s+(all\s+)?(prior|previous)',
    r'new\s+instructions?\s*:',
    r'system\s*:\s*you',
    r'<\s*system\s*>',
    r'act\s+as\s+(if\s+)?you\s+are',
]

# Patterns that should never appear in extracted knowledge
OUTPUT_BLOCKLIST = [
    'delete', 'rm -rf', 'drop table', 'exec(', 'eval(',
    'ignore previous', 'system prompt', 'you are now',
    'execute command', 'run command', 'sudo ',
]

# ── Logging ─────────────────────────────────────────────
def setup_logging():
    logger = logging.getLogger("doc-ingest")
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
def load_api_keys():
    """Load API keys from environment (set by env.sh / aiwh_load_secrets)."""
    return {
        'ANTHROPIC_API_KEY': os.environ.get('ANTHROPIC_API_KEY', ''),
        'OPENAI_API_KEY': os.environ.get('OPENAI_API_KEY', ''),
    }


# ── File Parsing (imported from lib/document_parsers.py) ─
from document_parsers import PARSERS


# ── Sanitization ────────────────────────────────────────
def sanitize_input(text):
    """Strip potential prompt injection patterns from source text."""
    cleaned = text
    for pattern in INJECTION_PATTERNS:
        cleaned = re.sub(pattern, '[REDACTED]', cleaned, flags=re.IGNORECASE)
    return cleaned


def validate_output(entry_content):
    """Check extracted knowledge for suspicious patterns. Returns (ok, reason)."""
    content_lower = entry_content.lower()
    for blocked in OUTPUT_BLOCKLIST:
        if blocked in content_lower:
            return False, f"blocked pattern: '{blocked}'"
    return True, ""


# ── Haiku Distillation ──────────────────────────────────
DISTILL_PROMPT = """You are a knowledge extraction specialist. Read this document section and DISTILL reusable knowledge from it.

CRITICAL RULES:
1. REPHRASE everything — never copy-paste from the source. Write clean, self-contained 2-4 sentence statements.
2. DISTILL the concept — extract the WHY and WHAT, not platform-specific HOW. If the source mentions specific file paths, commands, or tool-specific steps, extract the PRINCIPLE behind them instead.
3. NO file paths, system references, or platform-specific commands in your output. Knowledge must be understandable without the source document.
4. Each entry must be SELF-CONTAINED — understandable on its own without reading the full document.
5. Focus on: frameworks, patterns, principles, decision rationale, best practices, methodologies.
6. Skip: generic advice, obvious facts, credential/config specifics, table-of-contents entries.

Return a JSON array of objects with EXACTLY these fields:
- "content": Self-contained 2-4 sentence knowledge statement (rephrased, not copied)
- "category": One of: business, process, architecture, integration, security, workflow, sales, coaching, devops, ai, documentation, finance, social, video, knowledge-extraction
- "knowledge_type": One of: pattern, antipattern, insight, decision, principle, workflow, framework, learning
- "confidence": Float 0.0-1.0 (how reusable and reliable)
- "target_agents": Array of agent names that benefit, e.g. ["sales", "copywriter"] or ["all"]

Return ONLY valid JSON. If nothing extractable, return [].

Document section ({section}):
---
{content}
---"""


def distill_chunk(chunk, env, logger):
    """Send chunk to LLM for knowledge distillation. Returns list of entries.
    Uses llm_provider for provider-agnostic calls (reads openclaw.json).
    """
    sanitized = sanitize_input(chunk['text'][:6000])
    prompt = DISTILL_PROMPT.format(
        section=chunk['section'],
        content=sanitized,
    )

    try:
        text = llm_call(prompt, max_tokens=2000, temperature=1.0, timeout=60)
        if not text:
            return []
        text = text.strip()

        # Strip markdown code fences
        if text.startswith('```'):
            text = re.sub(r'^```[a-z]*\s*', '', text)
            text = re.sub(r'\s*```$', '', text.strip())

        # Parse JSON with fallbacks
        try:
            entries = json.loads(text)
        except json.JSONDecodeError:
            array_match = re.search(r'\[[\s\S]*\]', text)
            if array_match:
                try:
                    entries = json.loads(array_match.group())
                except json.JSONDecodeError:
                    return []
            else:
                return []

        if not isinstance(entries, list):
            return []
        return entries

    except Exception as e:
        logger.warning(f"  LLM distillation failed: {e}")
        return []


# ── Embedding ───────────────────────────────────────────
def get_embedding(text, env):
    """Get OpenAI embedding vector."""
    api_key = env.get('OPENAI_API_KEY', '')
    if not api_key:
        return None
    try:
        payload = json.dumps({"input": text, "model": EMBED_MODEL}).encode()
        req = Request(OPENAI_EMBED_API, data=payload, headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }, method='POST')
        with urlopen(req, timeout=20) as resp:
            result = json.loads(resp.read().decode())
        return result['data'][0]['embedding']
    except Exception:
        return None


# ── Database ────────────────────────────────────────────
def init_db():
    """Initialize client_knowledge table if needed."""
    CLIENT_DB.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(CLIENT_DB))
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
    try:
        conn.execute("ALTER TABLE client_knowledge ADD COLUMN reference TEXT")
    except sqlite3.OperationalError:
        pass
    conn.commit()
    return conn


def insert_entry(conn, entry, reference, source, embedding):
    """Insert a knowledge entry. Returns True if new."""
    content_hash = hashlib.sha256(entry['content'].encode()).hexdigest()
    target_agents = json.dumps(entry.get('target_agents', ['all']))
    ref_json = json.dumps(reference)
    emb_json = json.dumps(embedding) if embedding else None
    try:
        conn.execute(
            """INSERT INTO client_knowledge
               (content, category, knowledge_type, target_agents, status,
                source, content_hash, embedding, embedding_model, reference,
                created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                entry['content'],
                entry.get('category', 'process'),
                entry.get('knowledge_type', 'insight'),
                target_agents,
                'published' if embedding else 'draft',
                source,
                content_hash,
                emb_json,
                EMBED_MODEL if embedding else None,
                ref_json,
                datetime.now().isoformat(),
                datetime.now().isoformat(),
            )
        )
        conn.commit()
        return True
    except sqlite3.IntegrityError:
        return False


# ── Main ────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Ingest document into knowledge base")
    parser.add_argument('file', help='Path to document (PDF, DOCX, PPTX, MD, TXT)')
    parser.add_argument('--dry-run', action='store_true', help='Extract but do not write')
    parser.add_argument('--max-entries', type=int, default=500, help='Max entries to extract')
    parser.add_argument('--skip-embed', action='store_true', help='Skip embedding (faster, entries stay as drafts)')
    args = parser.parse_args()

    logger = setup_logging()
    env = load_api_keys()
    file_path = Path(args.file)

    if not file_path.exists():
        logger.error(f"File not found: {file_path}")
        sys.exit(1)

    ext = file_path.suffix.lower()
    if ext not in SUPPORTED_EXTENSIONS:
        logger.error(f"Unsupported format: {ext} (supported: {', '.join(SUPPORTED_EXTENSIONS)})")
        sys.exit(1)

    doc_name = file_path.stem
    source = f"document:{doc_name}"

    logger.info(f"{'=' * 50}")
    logger.info(f"DOCUMENT INGESTION: {file_path.name}")
    logger.info(f"Format: {ext} | Mode: {'DRY-RUN' if args.dry_run else 'LIVE'}")
    logger.info(f"{'=' * 50}")

    # Parse
    parse_fn = PARSERS[ext]
    chunks = parse_fn(file_path, logger)

    if not chunks:
        logger.warning("No chunks extracted from document")
        print(f"Document ingestion: 0 entries (no content found)")
        return

    # Filter out tiny chunks
    chunks = [c for c in chunks if len(c['text']) > 30]
    logger.info(f"Processing {len(chunks)} chunks (after filtering)")

    # Distill
    conn = None if args.dry_run else init_db()
    total_new = 0
    total_skipped = 0
    total_blocked = 0

    for i, chunk in enumerate(chunks):
        if total_new >= args.max_entries:
            logger.info(f"Reached max entries limit ({args.max_entries})")
            break

        entries = distill_chunk(chunk, env, logger)
        if not entries:
            continue

        for entry in entries:
            if not isinstance(entry, dict) or not entry.get('content'):
                continue
            if len(entry['content']) < 20:
                continue

            # Validate output
            ok, reason = validate_output(entry['content'])
            if not ok:
                logger.warning(f"  BLOCKED entry: {reason} — {entry['content'][:60]}")
                total_blocked += 1
                continue

            reference = {
                'document': doc_name,
                'section': chunk['section'],
                'page': chunk.get('page'),
            }

            if args.dry_run:
                conf = entry.get('confidence', 0.5)
                logger.info(
                    f"  [DRY-RUN] [{entry.get('category', '?')}/{entry.get('knowledge_type', '?')}] "
                    f"conf={conf:.2f}: {entry['content'][:80]}..."
                )
                total_new += 1
                continue

            # Embed immediately (unless --skip-embed)
            embedding = None
            if not args.skip_embed:
                embedding = get_embedding(entry['content'], env)

            inserted = insert_entry(conn, entry, reference, source, embedding)
            if inserted:
                total_new += 1
                status = "published" if embedding else "draft"
                logger.info(f"  ✓ [{status}] {entry['content'][:60]}...")
            else:
                total_skipped += 1

        if (i + 1) % 10 == 0:
            logger.info(f"  Progress: {i + 1}/{len(chunks)} chunks processed")

    if conn:
        conn.close()

    summary = (
        f"Document ingestion: {total_new} new, {total_skipped} duplicates, "
        f"{total_blocked} blocked | chunks: {len(chunks)} | doc: {file_path.name}"
    )
    logger.info(summary)
    print(summary)


if __name__ == '__main__':
    main()
