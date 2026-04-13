#!/bin/bash
# cron-market-signals.sh — Weekly market signal scraper
# Searches Reddit + forums for industry signals, extracts insights via LLM,
# saves to client_knowledge.db (local only — never leaves the machine).
#
# Usage: ./cron-market-signals.sh [--limit N]

set -euo pipefail
source /opt/AIWH/core/scripts/lib/env.sh

CLIENT_ROOT="${CLIENT_ROOT:-/opt/AIWH/client}"
LOG_FILE="$CLIENT_ROOT/logs/market-signals.log"
KNOWLEDGE_DB="$CLIENT_ROOT/data/client_knowledge.db"
PROFILE="$CLIENT_ROOT/config/client-profile.md"

LIMIT=5
[[ "${1:-}" == "--limit" ]] && LIMIT="${2:-5}"
[[ "$LIMIT" =~ ^[0-9]+$ ]] || LIMIT=5

mkdir -p "$(dirname "$LOG_FILE")"
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"; }

log "=== Market Signal Scan ==="

aiwh_load_secrets BRAVE_API_KEY 2>/dev/null || true
if [[ -z "${BRAVE_API_KEY:-}" ]]; then
    log "BRAVE_API_KEY not set — skipping market signal scan"
    exit 0
fi

# Extract industry from client profile
industry=""
if [[ -f "$PROFILE" ]]; then
    industry=$(grep -i '^\- \*\*Niche:\*\*' "$PROFILE" | sed 's/.*\*\*Niche:\*\* *//' | head -1)
fi
if [[ -z "$industry" ]]; then
    log "No industry found in client-profile.md — skipping"
    exit 0
fi
log "Industry: $industry"

# Ensure client_knowledge.db exists (pass path via sys.argv)
if [[ ! -f "$KNOWLEDGE_DB" ]]; then
    python3 -c "
import sqlite3, sys
conn = sqlite3.connect(sys.argv[1])
conn.execute('''CREATE TABLE IF NOT EXISTS client_knowledge (
    id INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT NOT NULL,
    category TEXT, knowledge_type TEXT, version INTEGER DEFAULT 1,
    embedding TEXT, embedding_model TEXT, target_agents TEXT DEFAULT '[\"all\"]',
    status TEXT DEFAULT 'draft', source TEXT, expires_at TEXT,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
    is_archived INTEGER DEFAULT 0, content_hash TEXT UNIQUE, reference TEXT
)''')
conn.commit(); conn.close()
" "$KNOWLEDGE_DB"
fi

# Build broader search queries (no exact-match quotes — niche names are too specific)
queries=(
    "$industry trends site:reddit.com"
    "$industry challenges site:reddit.com"
    "$industry market trends 2026"
)

inserted=0
for query in "${queries[@]}"; do
    [[ $inserted -ge $LIMIT ]] && break
    log "Searching: $query"

    # URL-encode query via sys.argv (no shell interpolation in Python)
    encoded_q=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$query")

    results=$(curl -sf --max-time 15 \
        "https://api.search.brave.com/res/v1/web/search?q=${encoded_q}&count=5" \
        -H "X-Subscription-Token: $BRAVE_API_KEY" \
        -H "Accept: application/json" 2>/dev/null) || { log "  Search failed"; continue; }

    # Extract titles + descriptions (data via stdin, no interpolation)
    snippets=$(echo "$results" | python3 -c "
import json, sys
data = json.load(sys.stdin)
for r in (data.get('web', {}).get('results', []))[:5]:
    t, d = r.get('title', ''), r.get('description', '')
    if t and d: print(f'{t} | {d}')
" 2>/dev/null) || continue

    [[ -z "$snippets" ]] && continue

    # Distill via LLM — pass snippets + industry via sys.argv
    signal=$(python3 -c "
import sys
sys.path.insert(0, '/opt/AIWH/core/scripts/lib')
from llm_provider import llm_call

snippets_text = sys.argv[1]
industry_name = sys.argv[2]

prompt = (
    f'You are a market intelligence analyst for the {industry_name} industry.\n'
    f'Given these search results, extract 1 actionable market signal.\n'
    f'Format: A 2-3 sentence insight about a trend, opportunity, or shift.\n'
    f'Do NOT include URLs or source attributions in your response.\n\n'
    f'Search results:\n{snippets_text}\n\nMarket signal:'
)
try:
    result = llm_call(prompt, max_tokens=200, temperature=0.7, timeout=30)
    if result and len(result.strip()) > 20:
        print(result.strip())
except Exception as e:
    print(f'ERROR: {e}', file=sys.stderr)
" "$snippets" "$industry" 2>/dev/null) || continue

    # Reject empty, error, or garbage LLM output
    if [[ -z "$signal" ]] || [[ "$signal" == ERROR* ]] || \
       [[ "$signal" == *"HTTP "* ]] || [[ "$signal" == *"credit balance"* ]] || \
       [[ "$signal" == *"api.anthropic.com"* ]] || [[ ${#signal} -lt 30 ]]; then
      log "  Skipping invalid signal output (${#signal} chars): ${signal:0:80}"
      continue
    fi

    # Insert into client_knowledge.db — all data via sys.argv
    if python3 -c "
import sqlite3, hashlib, sys
from datetime import datetime

content, db_path = sys.argv[1], sys.argv[2]
h = hashlib.sha256(content.encode()).hexdigest()
conn = sqlite3.connect(db_path)
try:
    conn.execute(
        '''INSERT INTO client_knowledge
           (content, category, knowledge_type, target_agents, status, source, content_hash, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)''',
        (content, 'market-signal', 'insight', '[\"all\"]', 'published',
         'cron-market-signals', h, datetime.now().isoformat(), datetime.now().isoformat())
    )
    conn.commit()
except sqlite3.IntegrityError:
    pass
finally:
    conn.close()
" "$signal" "$KNOWLEDGE_DB" 2>/dev/null; then
        ((inserted++)) || true
        log "  Signal inserted: ${signal:0:80}..."
    fi
done

log "=== Done: $inserted signals inserted ==="
