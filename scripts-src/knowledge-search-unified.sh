#!/bin/bash
set -euo pipefail
source /opt/AIWH/core/scripts/lib/env.sh

# knowledge-search-unified.sh — Unified search across base + client knowledge
# Usage: ./knowledge-search-unified.sh --query "text" --agent agent_id [--count 5]

usage() {
  cat >&2 <<EOF
Usage: $0 --query "search text" --agent agent_id [--count 5]

Options:
  --query TEXT    Search query (required)
  --agent ID      Target agent ID (required)
  --count N       Number of results (default: 5)
  --limit N       Alias for --count

Example:
  $0 --query "coaching pricing" --agent sales --count 10
EOF
  exit 1
}

# Parse arguments
QUERY=""
AGENT=""
COUNT=5

while [[ $# -gt 0 ]]; do
  case "$1" in
    --query) QUERY="$2"; shift 2 ;;
    --agent) AGENT="$2"; shift 2 ;;
    --count|--limit) COUNT="$2"; shift 2 ;;
    *) usage ;;
  esac
done

if [[ -z "$QUERY" ]] || [[ -z "$AGENT" ]]; then
  usage
fi

# Load secrets (encrypted store preferred, .env fallback)
aiwh_load_secrets OPENAI_API_KEY

if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  echo '{"error":"OPENAI_API_KEY not set"}' >&2
  exit 1
fi

# Database paths
CLIENT_ROOT="${CLIENT_ROOT:-/opt/AIWH/client}"
CLIENT_DB="${CLIENT_ROOT}/data/client_knowledge.db"
BASE_CACHE_DB="${CLIENT_ROOT}/data/base_knowledge_cache.db"

# Check at least one database exists
if [[ ! -f "$CLIENT_DB" ]] && [[ ! -f "$BASE_CACHE_DB" ]]; then
  echo '{"results":[],"error":"No knowledge databases found"}'
  exit 1
fi

# Generate embedding via OpenAI
echo "Generating embedding..." >&2
QUERY_EMBEDDING=$(curl -sf -X POST https://api.openai.com/v1/embeddings \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d "{
    \"model\": \"text-embedding-3-small\",
    \"input\": $(printf '%s' "$QUERY" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))")
  }" | python3 -c "import sys,json; print(json.dumps(json.load(sys.stdin)['data'][0]['embedding']))")

if [[ -z "$QUERY_EMBEDDING" ]] || [[ "$QUERY_EMBEDDING" == "null" ]]; then
  echo '{"results":[],"error":"Failed to generate embedding"}' >&2
  exit 1
fi

# Dump entries from both databases, compute cosine similarity in Python
# We pass agent name to Python for target_agents filtering
python3 - "$QUERY_EMBEDDING" "$AGENT" "$COUNT" "$BASE_CACHE_DB" "$CLIENT_DB" << 'PYEOF'
import json, sys, math, sqlite3, os

def cosine_sim(a, b):
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na > 0 and nb > 0 else 0.0

def parse_emb(raw):
    if not raw:
        return None
    if isinstance(raw, list):
        return raw
    if isinstance(raw, (bytes, memoryview)):
        raw = bytes(raw).decode('utf-8', errors='ignore')
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, str):
                parsed = json.loads(parsed)
            return parsed if isinstance(parsed, list) else None
        except Exception:
            return None
    return None

def matches_agent(target_agents_raw, agent):
    """Check if this entry targets the given agent or 'all'."""
    if not target_agents_raw:
        return True  # no filter = everyone
    try:
        agents = json.loads(target_agents_raw) if isinstance(target_agents_raw, str) else target_agents_raw
        if isinstance(agents, list):
            return 'all' in agents or agent in agents
    except Exception:
        pass
    # Fallback: string contains check
    return 'all' in str(target_agents_raw) or agent in str(target_agents_raw)

query_emb = json.loads(sys.argv[1])
agent = sys.argv[2]
count = int(sys.argv[3])
base_db_path = sys.argv[4]
client_db_path = sys.argv[5]

results = []

# Search base_knowledge_cache
if os.path.isfile(base_db_path):
    try:
        conn = sqlite3.connect(base_db_path)
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT id, content, category, knowledge_type, embedding, target_agents, source "
            "FROM base_knowledge WHERE status='published' AND is_archived=0 AND embedding IS NOT NULL"
        ).fetchall()
        conn.close()
        for row in rows:
            if not matches_agent(row['target_agents'], agent):
                continue
            emb = parse_emb(row['embedding'])
            if not emb:
                continue
            sim = cosine_sim(query_emb, emb)
            results.append({
                'source': 'base',
                'origin': row['source'] or 'unknown',
                'id': row['id'],
                'category': row['category'],
                'knowledge_type': row['knowledge_type'],
                'content': row['content'],
                'similarity': round(sim, 4)
            })
    except Exception as e:
        print(f"base_knowledge error: {e}", file=sys.stderr)

# Search client_knowledge
if os.path.isfile(client_db_path):
    try:
        conn = sqlite3.connect(client_db_path)
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT id, content, category, knowledge_type, embedding, target_agents, source "
            "FROM client_knowledge WHERE status='published' AND embedding IS NOT NULL"
        ).fetchall()
        conn.close()
        for row in rows:
            if not matches_agent(row['target_agents'], agent):
                continue
            emb = parse_emb(row['embedding'])
            if not emb:
                continue
            sim = cosine_sim(query_emb, emb)
            # Deduplicate: skip if base already has near-identical content
            content = row['content'] or ''
            is_dup = False
            for existing in results:
                if existing['source'] == 'base':
                    words_a = set(content.lower().split())
                    words_b = set((existing.get('content', '') or '').lower().split())
                    if words_a and words_b:
                        overlap = len(words_a & words_b) / len(words_a | words_b)
                        if overlap > 0.90:
                            is_dup = True
                            break
            if not is_dup:
                results.append({
                    'source': 'client',
                    'origin': row['source'] or 'unknown',
                    'id': row['id'],
                    'category': row['category'],
                    'knowledge_type': row['knowledge_type'],
                    'content': content,
                    'similarity': round(sim, 4)
                })
    except Exception as e:
        print(f"client_knowledge error: {e}", file=sys.stderr)

# Sort by similarity, return top N
results.sort(key=lambda x: x['similarity'], reverse=True)
top = results[:count]

print(json.dumps(top, indent=2))
PYEOF

# Log execution
LOG_DIR="${CLIENT_ROOT:-/opt/AIWH/client}/logs"
mkdir -p "$LOG_DIR"
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [unified] agent=${AGENT} query=\"${QUERY}\" count=${COUNT}" \
  >> "${LOG_DIR}/knowledge-search.log"
