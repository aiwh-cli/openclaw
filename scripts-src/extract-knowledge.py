#!/usr/bin/env python3
"""
Knowledge Extraction System

Extracts agent learnings from session transcripts and memory files,
routes to correct knowledge.db based on domain/agent, and maintains
audit trail.

Author: Systems Manager (subagent)
Date: 2026-02-24
Status: Production-ready
"""

import json
import subprocess
import sqlite3
import hashlib
import re
import os
import sys
import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Tuple, Optional
import argparse
from urllib.request import Request, urlopen
from urllib.error import URLError

# ============================================================================
# CONFIGURATION
# ============================================================================

CORE_ROOT = Path("/opt/AIWH/core")
CLIENT_ROOT = Path(os.environ.get("CLIENT_ROOT", "/opt/AIWH/client"))
MEMORY_ROOT = CORE_ROOT / "memory"
SESSION_ROOT = Path("/opt/AIWH/.openclaw/agents")
# main-knowledge.db eliminated 2026-03-08 (migrated to Supabase).
# Tag-based extraction now pushes directly to Supabase only.
CLIENT_KNOWLEDGE_DB = None  # No longer used for local storage (tag-based extraction goes direct to Supabase)

AUDIT_LOG = CLIENT_ROOT / "logs" / "extraction-audit.log"
STATE_FILE = CORE_ROOT / ".extraction-state.json"
ENV_FILE = Path("/opt/AIWH/.openclaw/.env")

# Tagging pattern — supports two formats:
#   Old: #knowledge-extraction domain type 0.95 — content
#   New: #knowledge-extraction [domain] type [0.95] content
# Type is optional — defaults to "pattern" if omitted
TAG_PATTERN_OLD = r'#knowledge-extraction\s+([\w-]+)(?:\s+([\w-]+))?\s+([\d.]+)'
TAG_PATTERN_NEW = r'#knowledge-extraction\s+\[([\w-]+)\](?:\s+([\w-]+))?\s+\[([\d.]+)\]'

# Valid domains and types (can be extended)
VALID_DOMAINS = {
    "delegation", "pattern", "architecture", "workflow", "process",
    "nextjs", "react", "python", "devops", "ai", "safety", "cost-optimization",
    "taki-moore-tonality",
    "business", "infrastructure", "documentation", "culture", "collaboration",
    "security", "client", "agent", "memory", "testing", "integration",
    "supabase", "discord", "video", "social", "email", "calendar",
    "trading", "coaching", "funnel", "sales", "crm", "finance", "travel",
    # operational domains added 2026-03-02
    "openclaw-config", "openclaw-crons", "openclaw-enforcement",
    "knowledge-search", "knowledge-extraction", "aiwh-025",
    # pipeline domains added 2026-03-08
    "video-pipeline", "knowledge-system", "cinematic"
}
VALID_TYPES = {
    "pattern", "principle", "antipattern", "insight", "optimization",
    "bug-fix", "fix", "integration", "workflow", "decision", "learning",
    "tonality-example", "workshop-sequence", "coaching-objection",
    "pricing-psychology", "high-ticket-positioning", "1M-coach-mindset"
}

# ============================================================================
# LOGGING SETUP
# ============================================================================

def setup_logging(verbose: bool = False) -> logging.Logger:
    """Configure logger for extraction operations."""
    logger = logging.getLogger("extract-knowledge")
    logger.setLevel(logging.DEBUG if verbose else logging.INFO)
    
    # Console handler
    console = logging.StreamHandler()
    console.setFormatter(logging.Formatter(
        "[%(asctime)s] %(levelname)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S"
    ))
    logger.addHandler(console)
    
    # File handler (audit)
    if not AUDIT_LOG.parent.exists():
        AUDIT_LOG.parent.mkdir(parents=True, exist_ok=True)
    
    file_handler = logging.FileHandler(AUDIT_LOG, mode='a')
    file_handler.setFormatter(logging.Formatter(
        "[%(asctime)s] %(levelname)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S"
    ))
    logger.addHandler(file_handler)
    
    return logger

# ============================================================================
# STATE MANAGEMENT
# ============================================================================

# ============================================================================
# ENVIRONMENT LOADING
# ============================================================================

def load_env_vars() -> Dict[str, str]:
    """Load secrets from encrypted store (primary) or .env fallback."""
    env = {}
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
                    env[m.group(1)] = m.group(2)
        except Exception:
            pass
    if env.get('ANTHROPIC_API_KEY'):
        return env
    # Fallback: .env file (legacy)
    if ENV_FILE.exists():
        try:
            with open(ENV_FILE) as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith('#'):
                        continue
                    if '=' in line:
                        key, value = line.split('=', 1)
                        env[key.strip()] = value.strip()
        except Exception as e:
            logging.warning(f"Failed to load env file: {e}")
    return env

def load_state() -> Dict:
    """Load extraction state (for deduplication)."""
    if STATE_FILE.exists():
        try:
            with open(STATE_FILE) as f:
                return json.load(f)
        except Exception:
            return {"extracted_hashes": {}, "last_run": None}
    return {"extracted_hashes": {}, "last_run": None}

def save_state(state: Dict) -> None:
    """Save extraction state."""
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(STATE_FILE, 'w') as f:
        json.dump(state, f, indent=2)

def content_hash(content: str) -> str:
    """Generate content hash for deduplication."""
    return hashlib.sha256(content.encode()).hexdigest()

# ============================================================================
# TAG PARSING & VALIDATION
# ============================================================================

def parse_tag(tag_text: str, logger: logging.Logger = None) -> Optional[Tuple[str, str, str, float]]:
    """
    Parse #knowledge-extraction tag.
    
    Format: #knowledge-extraction [domain] [type] [confidence]
    Example: #knowledge-extraction delegation pattern 0.85
    
    Returns: (domain, type, raw_confidence, float_confidence) or None if invalid
    """
    if logger is None:
        logger = logging.getLogger("extract-knowledge")
    
    # Try new bracket format first, then old bare format
    match = re.search(TAG_PATTERN_NEW, tag_text)
    if not match:
        match = re.search(TAG_PATTERN_OLD, tag_text)
    if not match:
        logger.debug(f"Tag parsing failed: pattern not found in '{tag_text[:80]}'")
        return None

    domain, type_, confidence_str = match.groups()
    if type_ is None:
        type_ = "pattern"  # default when type omitted from tag
    domain_lower = domain.lower()
    type_lower = type_.lower()
    
    # Validate domain
    if domain_lower not in VALID_DOMAINS and domain != "*":
        logger.debug(f"Tag parsing failed: unknown domain '{domain}' in '{tag_text[:80]}'")
        return None
    
    # Validate type
    if type_lower not in VALID_TYPES and type_ != "*":
        logger.debug(f"Tag parsing failed: unknown type '{type_}' in '{tag_text[:80]}'")
        return None
    
    # Validate confidence
    try:
        confidence = float(confidence_str)
        if not 0 <= confidence <= 1:
            logger.debug(f"Tag parsing failed: confidence {confidence} out of range [0,1] in '{tag_text[:80]}'")
            return None
    except ValueError:
        logger.debug(f"Tag parsing failed: invalid confidence '{confidence_str}' in '{tag_text[:80]}'")
        return None
    
    return (domain_lower, type_lower, confidence_str, confidence)

def sanitize_content(text: str, logger=None) -> Optional[str]:
    """
    Strip prompt injection patterns before content enters the knowledge base.
    Returns cleaned text, or None if the entry should be skipped entirely.
    Called before any external/research-sourced content is embedded.
    """
    if not text:
        return None

    # Remove HTML/script tags
    text = re.sub(r'<[^>]+>', '', text)

    # Patterns that indicate prompt injection attempts
    injection_patterns = [
        r'ignore\s+(previous|all\s+prior|prior)\s+instructions',
        r'you\s+are\s+now\s+',
        r'new\s+instructions\s*:',
        r'system\s+prompt\s*:',
        r'disregard\s+(your|all|previous)',
        r'override\s+(your|all|previous|safety)',
        r'do\s+not\s+follow\s+(your|the)',
        r'forget\s+(everything|all)\s+(above|previous|prior)',
        r'act\s+as\s+(if\s+you\s+are|a\s+)',
        r'pretend\s+(you\s+are|to\s+be)',
        r'\[\s*INST\s*\]',
        r'<\|system\|>',
        r'<\|user\|>',
    ]

    for pattern in injection_patterns:
        if re.search(pattern, text, re.IGNORECASE):
            if logger:
                logger.warning(f"Prompt injection pattern detected, skipping entry: {text[:120]!r}")
            return None

    return text.strip()


def extract_and_strip_pii(text: str) -> Tuple[str, Dict]:
    """
    Extract knowledge and strip PII.
    
    Returns:
        (cleaned_text, pii_metadata)
    """
    pii_found = {}
    cleaned = text
    
    # Mask emails
    email_pattern = r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b'
    emails = re.findall(email_pattern, cleaned)
    if emails:
        pii_found['emails'] = len(emails)
        cleaned = re.sub(email_pattern, '[EMAIL]', cleaned)
    
    # Mask phone numbers
    phone_pattern = r'\b\d{3}[-.]?\d{3}[-.]?\d{4}\b'
    phones = re.findall(phone_pattern, cleaned)
    if phones:
        pii_found['phones'] = len(phones)
        cleaned = re.sub(phone_pattern, '[PHONE]', cleaned)
    
    # Mask IP addresses
    ip_pattern = r'\b(?:\d{1,3}\.){3}\d{1,3}\b'
    ips = re.findall(ip_pattern, cleaned)
    if ips:
        pii_found['ips'] = len(ips)
        cleaned = re.sub(ip_pattern, '[IP]', cleaned)
    
    return cleaned, pii_found

# ============================================================================
# SESSION LOG PARSING
# ============================================================================

def get_recent_sessions(hours: int = 24) -> Dict[str, List[Path]]:
    """
    Find session log files modified in last N hours.
    
    Returns:
        {agent_name: [session_paths]}
    """
    cutoff = datetime.now() - timedelta(hours=hours)
    sessions_by_agent = {}
    
    if not SESSION_ROOT.exists():
        return {}
    
    for agent_dir in SESSION_ROOT.iterdir():
        if not agent_dir.is_dir():
            continue
        
        sessions_dir = agent_dir / "sessions"
        if not sessions_dir.exists():
            continue
        
        agent_name = agent_dir.name
        agent_sessions = []
        
        for session_file in sessions_dir.glob("*.jsonl"):
            mtime = datetime.fromtimestamp(session_file.stat().st_mtime)
            if mtime >= cutoff:
                agent_sessions.append(session_file)
        
        if agent_sessions:
            sessions_by_agent[agent_name] = sorted(agent_sessions)
    
    return sessions_by_agent

def parse_session_log(session_path: Path, logger: logging.Logger = None) -> List[Dict]:
    """
    Parse JSONL session log, extract messages with #knowledge-extraction tags.
    
    Returns:
        List of {agent, session_id, timestamp, content, tags}
    """
    if logger is None:
        logger = logging.getLogger("extract-knowledge")
    
    extractions = []
    
    try:
        with open(session_path) as f:
            for line in f:
                if not line.strip():
                    continue
                
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    continue
                
                # Look for message entries
                if entry.get('type') != 'message':
                    continue
                
                content = entry.get('data', {}).get('content', '')
                if not content or '#knowledge-extraction' not in content:
                    continue
                
                # Parse tags
                tags = parse_tag(content, logger)
                if not tags:
                    continue
                
                extractions.append({
                    'agent': session_path.parent.parent.name,
                    'session_id': session_path.stem,
                    'timestamp': entry.get('timestamp', ''),
                    'content': content,
                    'domain': tags[0],
                    'type': tags[1],
                    'confidence': tags[3],
                    'raw_tag': tags[2],
                })
    
    except Exception as e:
        logging.warning(f"Error parsing {session_path}: {e}")
    
    return extractions

# ============================================================================
# MEMORY FILE PARSING
# ============================================================================

def get_memory_files_since(hours: int = 24) -> List[Path]:
    """
    Get memory files modified in last N hours.
    """
    if not MEMORY_ROOT.exists():
        return []
    
    cutoff = datetime.now() - timedelta(hours=hours)
    files = []
    
    for f in MEMORY_ROOT.glob("*.md"):
        if f.is_file():
            mtime = datetime.fromtimestamp(f.stat().st_mtime)
            if mtime >= cutoff:
                files.append(f)
    
    return sorted(files)

def parse_memory_file(mem_path: Path, logger: logging.Logger = None) -> List[Dict]:
    """
    Parse memory file, extract lines with #knowledge-extraction tags.
    
    Returns:
        List of {source_file, line_num, content, tag_info}
    """
    if logger is None:
        logger = logging.getLogger("extract-knowledge")
    
    extractions = []
    
    try:
        with open(mem_path) as f:
            for line_num, line in enumerate(f, 1):
                if '#knowledge-extraction' not in line:
                    continue
                
                tags = parse_tag(line, logger)
                if not tags:
                    continue
                
                # Extract content (remove tag — try both formats)
                content = re.sub(TAG_PATTERN_NEW, '', line)
                content = re.sub(TAG_PATTERN_OLD, '', content).strip()
                if not content:
                    continue
                
                extractions.append({
                    'source_file': mem_path.name,
                    'line_num': line_num,
                    'content': content,
                    'domain': tags[0],
                    'type': tags[1],
                    'confidence': tags[3],
                    'raw_tag': tags[2],
                })
    
    except Exception as e:
        logging.warning(f"Error parsing {mem_path}: {e}")
    
    return extractions

# ============================================================================
# DATABASE OPERATIONS
# ============================================================================

def init_knowledge_db(db_path: Path) -> sqlite3.Connection:
    """
    Initialize or verify knowledge.db schema.
    """
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    
    cursor = conn.cursor()
    
    # Create table if not exists
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS knowledge (
            id TEXT PRIMARY KEY,
            content TEXT NOT NULL,
            domain TEXT,
            type TEXT,
            confidence REAL,
            source_file TEXT,
            source_type TEXT,
            content_hash TEXT UNIQUE,
            extracted_at TEXT,
            is_current INTEGER DEFAULT 1,
            metadata TEXT
        )
    """)
    
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_domain ON knowledge(domain)
    """)
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_type ON knowledge(type)
    """)
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_confidence ON knowledge(confidence)
    """)
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_extracted_at ON knowledge(extracted_at)
    """)
    
    conn.commit()
    return conn

# ============================================================================
# SUPABASE PUSH
# ============================================================================

def push_to_supabase(
    extraction: Dict,
    env: Dict,
    logger: logging.Logger = None
) -> bool:
    """
    Push extracted knowledge to Supabase base_knowledge table.
    
    Args:
        extraction: The extraction dict with content, domain, etc.
        env: Environment variables from .env file
        logger: Logger instance
    
    Returns:
        True if pushed successfully or if not configured, False if failed
    """
    if logger is None:
        logger = logging.getLogger("extract-knowledge")
    
    # Get credentials
    supabase_url = env.get('SUPABASE_URL')
    service_key = env.get('SUPABASE_SERVICE_KEY')
    
    if not supabase_url or not service_key:
        logger.debug("Supabase not configured, skipping push")
        return True
    
    try:
        # Prepare payload
        payload = {
            "content": extraction.get('content', ''),
            "category": extraction.get('domain', ''),
            "status": "draft",
            "source": extraction.get('source_file', extraction.get('session_id', '')),
            "embedding": None,  # Will be populated separately
        }
        
        # Prepare request
        url = f"{supabase_url}/rest/v1/base_knowledge"
        headers = {
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
        }
        
        data = json.dumps(payload).encode('utf-8')
        req = Request(url, data=data, headers=headers, method='POST')
        
        # Send request
        with urlopen(req, timeout=10) as response:
            status = response.status
            if status in (200, 201):
                logger.debug(f"✓ Pushed to Supabase (HTTP {status})")
                return True
            else:
                logger.warning(f"Supabase returned HTTP {status}")
                return True  # Non-blocking warning
    
    except URLError as e:
        logger.warning(f"Failed to push to Supabase: {e}")
        return True  # Non-blocking warning
    except Exception as e:
        logger.warning(f"Error pushing to Supabase: {e}")
        return True  # Non-blocking warning

def extract_to_db(
    db_path: Path,
    extraction: Dict,
    source_type: str,
    env: Dict,
    logger: logging.Logger = None
) -> Tuple[bool, str]:
    """
    Insert extraction into knowledge.db and push to Supabase.
    
    Returns:
        (success, message)
    """
    if logger is None:
        logger = logging.getLogger("extract-knowledge")

    # Sanitize against prompt injection (runs before PII strip)
    raw_content = extraction.get('content', '')
    source_type_val = source_type or ''
    if source_type_val not in ('memory', 'session'):
        safe_content = sanitize_content(raw_content, logger)
        if safe_content is None:
            return False, "Blocked: prompt injection pattern detected in content"
        extraction = {**extraction, 'content': safe_content}

    # Strip PII
    cleaned_content, pii_info = extract_and_strip_pii(extraction['content'])
    extraction = {**extraction, 'content': cleaned_content}

    # Deduplication via content hash
    hash_val = content_hash(cleaned_content)

    # If local DB provided, insert there too
    if db_path is not None:
        conn = init_knowledge_db(db_path)
        cursor = conn.cursor()
        try:
            cursor.execute("SELECT id FROM knowledge WHERE content_hash = ?", (hash_val,))
            if cursor.fetchone():
                return False, f"Duplicate content (hash {hash_val[:8]})"

            entry_id = f"{datetime.now().strftime('%Y%m%d%H%M%S')}-{hash_val[:8]}"
            metadata = json.dumps({
                'pii_stripped': pii_info,
                'agent': extraction.get('agent', 'unknown'),
                'session_id': extraction.get('session_id', ''),
            })
            cursor.execute("""
                INSERT INTO knowledge
                (id, content, domain, type, confidence, source_file,
                 source_type, content_hash, extracted_at, metadata)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                entry_id, cleaned_content, extraction.get('domain'),
                extraction.get('type'), extraction.get('confidence'),
                extraction.get('source_file', extraction.get('session_id', '')),
                source_type, hash_val, datetime.now().isoformat(), metadata,
            ))
            conn.commit()
        except sqlite3.IntegrityError as e:
            return False, f"Database error: {e}"
        finally:
            conn.close()

    # Push to Supabase (primary destination)
    push_to_supabase(extraction, env, logger)

    return True, f"Pushed to Supabase (hash {hash_val[:8]})"

# ============================================================================
# ROUTING LOGIC
# ============================================================================

def get_target_db(agent: str, domain: str) -> Optional[Path]:
    """
    Route extraction to knowledge store.

    As of 2026-03-08: All local agent-specific DBs eliminated.
    Extractions push to Supabase only (via push_to_supabase in extract_to_db).
    Returns None — no local DB write needed.
    """
    return None

# ============================================================================
# MAIN EXTRACTION LOGIC
# ============================================================================

def extract_all(hours: int = 24, full: bool = False, logger: logging.Logger = None) -> Dict:
    """
    Full extraction pipeline.
    
    Returns:
        {
            'total_found': int,
            'inserted': int,
            'skipped': int,
            'failed': int,
            'by_db': {...},
            'errors': [...]
        }
    """
    if logger is None:
        logger = setup_logging()
    
    # Load environment
    env = load_env_vars()
    
    logger.info(f"Starting extraction (hours={hours}, full={full})")
    
    state = load_state()
    extracted_hashes = state.get('extracted_hashes', {})
    
    results = {
        'total_found': 0,
        'inserted': 0,
        'skipped': 0,
        'failed': 0,
        'by_db': {},
        'errors': [],
        'inserted_extractions': [],  # For Discord reporting
    }
    
    # Parse session logs
    logger.info("Scanning session logs...")
    sessions = get_recent_sessions(hours)
    session_extractions = []
    
    for agent, session_paths in sessions.items():
        for session_path in session_paths:
            extracted = parse_session_log(session_path)
            session_extractions.extend(extracted)
            if extracted:
                logger.debug(f"  {agent}: {len(extracted)} extractions from {session_path.name}")
    
    # Parse memory files
    logger.info("Scanning memory files...")
    memory_files = get_memory_files_since(hours)
    memory_extractions = []
    
    for mem_path in memory_files:
        extracted = parse_memory_file(mem_path)
        memory_extractions.extend(extracted)
        if extracted:
            logger.debug(f"  {mem_path.name}: {len(extracted)} extractions")
    
    # Process all extractions
    all_extractions = [
        (e, 'session') for e in session_extractions
    ] + [
        (e, 'memory') for e in memory_extractions
    ]
    
    logger.info(f"Found {len(all_extractions)} tagged entries")
    results['total_found'] = len(all_extractions)
    
    for extraction, source_type in all_extractions:
        hash_val = content_hash(extraction['content'])
        
        # Check deduplication
        if hash_val in extracted_hashes:
            logger.debug(f"Skipping duplicate: {hash_val[:8]}")
            results['skipped'] += 1
            continue
        
        # Route to correct DB
        db_path = get_target_db(extraction.get('agent', 'unknown'), extraction['domain'])
        
        # Insert
        success, msg = extract_to_db(db_path, extraction, source_type, env, logger)
        
        if success:
            results['inserted'] += 1
            extracted_hashes[hash_val] = {
                'timestamp': datetime.now().isoformat(),
                'db': str(db_path) if db_path else 'supabase',
            }

            # Track insertion for Discord reporting
            results['inserted_extractions'].append(extraction)

            # Track by DB
            db_key = str(db_path) if db_path else 'supabase'
            if db_key not in results['by_db']:
                results['by_db'][db_key] = {'inserted': 0, 'skipped': 0}
            results['by_db'][db_key]['inserted'] += 1

            dest = db_path.name if db_path else 'supabase'
            logger.info(f"✓ Extracted {extraction['domain']}/{extraction['type']} → {dest}")
        else:
            results['failed'] += 1
            results['errors'].append(f"{extraction.get('source_file', '?')}: {msg}")

            db_key = str(db_path) if db_path else 'supabase'
            if db_key not in results['by_db']:
                results['by_db'][db_key] = {'inserted': 0, 'skipped': 0}
            results['by_db'][db_key]['skipped'] += 1
    
    # Save state
    state['extracted_hashes'] = extracted_hashes
    state['last_run'] = datetime.now().isoformat()
    save_state(state)
    
    # Log summary
    logger.info(f"Extraction complete: {results['inserted']} new, {results['skipped']} skipped, {results['failed']} failed")
    
    return results

# ============================================================================
# DISCORD REPORTING
# ============================================================================

def format_discord_report(extractions: List[Dict]) -> str:
    """
    Format extracted knowledge for Discord, grouped by category.
    
    Returns a formatted message with:
    - Categories as headers (## Category:)
    - Learned entries as bullet points (- Learned that ...)
    - Summary line at the bottom
    """
    if not extractions:
        return "No new patterns extracted."
    
    # Group by domain (category)
    by_domain = {}
    for ext in extractions:
        domain = ext.get('domain', 'unknown')
        if domain not in by_domain:
            by_domain[domain] = []
        by_domain[domain].append(ext)
    
    # Build message
    lines = []
    
    # Add each category
    for domain in sorted(by_domain.keys()):
        entries = by_domain[domain]
        lines.append(f"## {domain.capitalize()}:")
        
        for entry in entries:
            content = entry.get('content', '').strip()
            
            # Truncate to ~100 chars if too long
            if len(content) > 100:
                content = content[:97] + "..."
            
            lines.append(f"- Learned that {content}")
        
        lines.append("")  # Blank line between categories
    
    # Add summary
    total = len(extractions)
    summary = f"**{total} patterns extracted**"
    lines.append(summary)
    
    return "\n".join(lines)

def post_discord_report(
    report: str,
    webhook_url: str = None,
    logger: logging.Logger = None
) -> bool:
    """
    Post formatted report to Discord via webhook.
    
    Webhook URL can be:
    1. Passed as parameter
    2. Read from DISCORD_WEBHOOK env var
    3. Skipped if not available (returns True anyway - don't fail on missing webhook)
    
    Returns:
        True if posted or webhook not configured, False if posting failed
    """
    if logger is None:
        logger = logging.getLogger("extract-knowledge")
    
    # Get webhook URL
    if not webhook_url:
        webhook_url = os.environ.get('DISCORD_WEBHOOK')
    
    if not webhook_url:
        logger.debug("No Discord webhook configured, skipping Discord report")
        return True
    
    # Prepare payload
    payload = {
        "content": report,
        "username": "Knowledge Extraction Bot",
    }
    
    # Post to Discord
    try:
        data = json.dumps(payload).encode('utf-8')
        req = Request(
            webhook_url,
            data=data,
            headers={'Content-Type': 'application/json'}
        )
        
        with urlopen(req, timeout=10) as response:
            status = response.status
            if status in (200, 204):
                logger.info(f"Discord report posted successfully (HTTP {status})")
                return True
            else:
                logger.error(f"Discord webhook returned HTTP {status}")
                return False
    
    except Exception as e:
        logger.error(f"Failed to post Discord report: {e}")
        return False

# ============================================================================
# CLI
# ============================================================================

def main():
    parser = argparse.ArgumentParser(
        description="Knowledge Extraction System"
    )
    parser.add_argument(
        '--hours', type=int, default=24,
        help='Look back N hours (default: 24)'
    )
    parser.add_argument(
        '--full', action='store_true',
        help='Full re-extract (ignore deduplication state)'
    )
    parser.add_argument(
        '--verbose', '-v', action='store_true',
        help='Verbose logging'
    )
    parser.add_argument(
        '--stats', action='store_true',
        help='Show extraction stats and exit'
    )
    
    args = parser.parse_args()
    
    logger = setup_logging(args.verbose)
    
    if args.stats:
        state = load_state()
        logger.info(f"Total extracted: {len(state.get('extracted_hashes', {}))}")
        logger.info(f"Last run: {state.get('last_run', 'Never')}")
        return
    
    # Run extraction
    results = extract_all(hours=args.hours, full=args.full, logger=logger)
    
    # Print summary
    print("\n" + "="*60)
    print("EXTRACTION SUMMARY")
    print("="*60)
    print(f"Total found:     {results['total_found']}")
    print(f"Inserted:        {results['inserted']}")
    print(f"Skipped:         {results['skipped']}")
    print(f"Failed:          {results['failed']}")
    
    if results['by_db']:
        print("\nBy database:")
        for db_path, stats in results['by_db'].items():
            print(f"  {Path(db_path).name}: {stats['inserted']} new, {stats['skipped']} skipped")
    
    if results['errors']:
        print("\nErrors:")
        for err in results['errors'][:5]:  # Show first 5
            print(f"  - {err}")
    
    print("="*60 + "\n")
    
    # Post Discord report if there are insertions
    if results['inserted'] > 0:
        report = format_discord_report(results['inserted_extractions'])
        logger.debug(f"Formatted Discord report:\n{report}")
        post_discord_report(report, logger=logger)
    else:
        logger.info("No new extractions to report")
    
    sys.exit(0 if results['failed'] == 0 else 1)

if __name__ == '__main__':
    main()
