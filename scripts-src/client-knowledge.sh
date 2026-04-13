#!/bin/bash

set -euo pipefail
source /opt/AIWH/core/scripts/lib/env.sh

# client-knowledge.sh — CLI wrapper for client_knowledge.db
# Manages client-specific learnings: add, search, list, publish, archive, stats

# Client DB lives in client workspace: /opt/AIWH/<client>/data/client_knowledge.db
# Falls back to AIWH_CLIENT_DIR env var, or current workspace
DB_PATH="${AIWH_CLIENT_DB:-${CLIENT_ROOT:-/opt/AIWH/client}/data/client_knowledge.db}"
ENV_FILE="/opt/AIWH/.openclaw/.env"

# Load OpenAI API key
load_api_key() {
  # Load secrets (encrypted store preferred, .env fallback)
  aiwh_load_secrets OPENAI_API_KEY
}

# Get embedding from OpenAI
get_embedding() {
  local text="$1"
  local response
  
  response=$(curl -s -X POST "https://api.openai.com/v1/embeddings" \
    -H "Authorization: Bearer $OPENAI_API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"model\": \"text-embedding-3-small\", \"input\": $(echo "$text" | jq -Rs .)}")
  
  local embedding
  embedding=$(echo "$response" | jq -r '.data[0].embedding')
  
  if [[ "$embedding" == "null" ]]; then
    echo "ERROR: Failed to get embedding. Response: $response" >&2
    return 1
  fi
  
  # Return as compact JSON
  echo "$embedding" | jq -c .
}

# Cosine similarity between two embedding vectors (as JSON arrays)
cosine_similarity() {
  local vec1="$1"
  local vec2="$2"
  
  jq -n \
    --argjson v1 "$vec1" \
    --argjson v2 "$vec2" \
    '
    def dot_product: reduce range(0; length) as $i (0; . + $v1[$i] * $v2[$i]);
    def magnitude: sqrt(reduce .[] as $x (0; . + $x * $x));
    
    ($v1 | dot_product) as $dot |
    ($v1 | magnitude) as $mag1 |
    ($v2 | magnitude) as $mag2 |
    if $mag1 == 0 or $mag2 == 0 then 0 else $dot / ($mag1 * $mag2) end
    '
}

# Command: add
cmd_add() {
  local category="" type="" content="" agents="" source="" expires=""
  
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --category) category="$2"; shift 2 ;;
      --type) type="$2"; shift 2 ;;
      --content) content="$2"; shift 2 ;;
      --agents) agents="$2"; shift 2 ;;
      --source) source="$2"; shift 2 ;;
      --expires) expires="$2"; shift 2 ;;
      *) echo "Unknown option: $1" >&2; return 1 ;;
    esac
  done
  
  # Validation
  if [[ -z "$category" || -z "$type" || -z "$content" ]]; then
    echo "ERROR: --category, --type, and --content are required" >&2
    return 1
  fi
  
  if [[ ! "$type" =~ ^(fact|pattern|framework|opinion)$ ]]; then
    echo "ERROR: --type must be one of: fact, pattern, framework, opinion" >&2
    return 1
  fi
  
  # Get embedding
  local embedding
  embedding=$(get_embedding "$content") || return 1
  
  # Prepare agents JSON (default to empty array)
  if [[ -z "$agents" ]]; then
    agents='[]'
  fi
  
  # Build SQL INSERT with proper escaping
  local content_esc="${content//\'/\'\'}"
  local category_esc="${category//\'/\'\'}"
  local type_esc="${type//\'/\'\'}"
  local source_esc="${source//\'/\'\'}"
  local expires_esc="${expires//\'/\'\'}"
  
  sqlite3 "$DB_PATH" <<EOSQL
INSERT INTO client_knowledge (content, category, knowledge_type, embedding, target_agents, source, expires_at)
VALUES (
  '$content_esc',
  '$category_esc',
  '$type_esc',
  '$embedding',
  '$agents',
  '$source_esc',
  '$expires_esc'
);
EOSQL
  
  local new_id
  new_id=$(sqlite3 "$DB_PATH" "SELECT id FROM client_knowledge ORDER BY rowid DESC LIMIT 1;")
  echo "Created: $new_id"
}

# Command: search
cmd_search() {
  local query="" agent="" count=5
  
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --query) query="$2"; shift 2 ;;
      --agent) agent="$2"; shift 2 ;;
      --count) count="$2"; shift 2 ;;
      *) echo "Unknown option: $1" >&2; return 1 ;;
    esac
  done
  
  if [[ -z "$query" ]]; then
    echo "ERROR: --query is required" >&2
    return 1
  fi
  
  # Get embedding for query
  local query_embedding
  query_embedding=$(get_embedding "$query") || return 1
  
  # Get all published entries as JSON
  local where_clause="WHERE status = 'published'"
  if [[ -n "$agent" ]]; then
    where_clause="$where_clause AND target_agents LIKE '%$agent%'"
  fi
  
  # Fetch entries, compute similarities, and rank
  local temp_file
  temp_file=$(mktemp)
  trap "rm -f $temp_file" EXIT
  
  sqlite3 "$DB_PATH" ".mode json" "SELECT id, content, category, knowledge_type, status, target_agents, created_at, embedding FROM client_knowledge $where_clause;" > "$temp_file"
  
  # Process with jq: for each entry, compute similarity and collect results
  jq -r '.[] | @base64' "$temp_file" | while IFS= read -r entry_b64; do
    local entry
    entry=$(echo "$entry_b64" | base64 -d)
    
    local entry_id stored_embedding_str
    entry_id=$(echo "$entry" | jq -r '.id')
    stored_embedding_str=$(echo "$entry" | jq -r '.embedding')
    
    if [[ -z "$entry_id" || -z "$stored_embedding_str" ]]; then
      continue
    fi
    
    # Normalize stored embedding to compact JSON
    local stored_embedding
    stored_embedding=$(echo "$stored_embedding_str" | jq -c .)
    
    # Compute similarity
    local similarity
    similarity=$(cosine_similarity "$query_embedding" "$stored_embedding" 2>/dev/null) || similarity="0"
    
    # Output with similarity
    echo "$entry" | jq ". + {similarity: $similarity}"
  done | jq -s 'sort_by(-.similarity) | .[0:'"$count"']' 2>/dev/null || echo "[]"
}

# Command: list
cmd_list() {
  local category="" status="published" output_format="table"
  
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --category) category="$2"; shift 2 ;;
      --status) status="$2"; shift 2 ;;
      --format) output_format="$2"; shift 2 ;;
      *) echo "Unknown option: $1" >&2; return 1 ;;
    esac
  done
  
  local where_clause="WHERE status = '$status'"
  if [[ -n "$category" ]]; then
    where_clause="$where_clause AND category = '$category'"
  fi
  
  if [[ "$output_format" == "json" ]]; then
    sqlite3 "$DB_PATH" ".mode json" "SELECT id, content, category, knowledge_type, status, version, created_at FROM client_knowledge $where_clause ORDER BY created_at DESC;"
  else
    sqlite3 "$DB_PATH" ".mode column" "SELECT id, category, knowledge_type, status, substr(content, 1, 60) as content_preview FROM client_knowledge $where_clause ORDER BY created_at DESC;"
  fi
}

# Command: publish
cmd_publish() {
  local id="$1"
  
  if [[ -z "$id" ]]; then
    echo "ERROR: Entry ID required" >&2
    return 1
  fi
  
  sqlite3 "$DB_PATH" "UPDATE client_knowledge SET status = 'published', updated_at = datetime('now') WHERE id = '$id';"
  echo "Published: $id"
}

# Command: archive
cmd_archive() {
  local id="$1"
  
  if [[ -z "$id" ]]; then
    echo "ERROR: Entry ID required" >&2
    return 1
  fi
  
  sqlite3 "$DB_PATH" "UPDATE client_knowledge SET status = 'archived', updated_at = datetime('now') WHERE id = '$id';"
  echo "Archived: $id"
}

# Command: stats
cmd_stats() {
  echo "=== Client Knowledge Stats ==="
  echo ""
  echo "By Category:"
  sqlite3 "$DB_PATH" ".mode column" "SELECT category, COUNT(*) as count FROM client_knowledge GROUP BY category ORDER BY count DESC;" || echo "(no data)"
  echo ""
  echo "By Status:"
  sqlite3 "$DB_PATH" ".mode column" "SELECT status, COUNT(*) as count FROM client_knowledge GROUP BY status ORDER BY count DESC;" || echo "(no data)"
  echo ""
  echo "By Type:"
  sqlite3 "$DB_PATH" ".mode column" "SELECT knowledge_type, COUNT(*) as count FROM client_knowledge GROUP BY knowledge_type ORDER BY count DESC;" || echo "(no data)"
  echo ""
  echo "Total:"
  sqlite3 "$DB_PATH" "SELECT COUNT(*) as total_entries FROM client_knowledge;"
}

# Main
main() {
  if [[ $# -lt 1 ]]; then
    echo "Usage: client-knowledge.sh <command> [options]"
    echo ""
    echo "Commands:"
    echo "  add --category <cat> --type <type> --content <text> [--agents <json>] [--source <src>] [--expires <iso8601>]"
    echo "  search --query <text> [--agent <agent>] [--count <n>]"
    echo "  list [--category <cat>] [--status <status>] [--format json|table]"
    echo "  publish <id>"
    echo "  archive <id>"
    echo "  stats"
    return 1
  fi
  
  load_api_key || return 1
  
  local cmd="$1"
  shift
  
  case "$cmd" in
    add) cmd_add "$@" ;;
    search) cmd_search "$@" ;;
    list) cmd_list "$@" ;;
    publish) cmd_publish "$@" ;;
    archive) cmd_archive "$@" ;;
    stats) cmd_stats "$@" ;;
    *) echo "Unknown command: $cmd" >&2; return 1 ;;
  esac
}

main "$@"
