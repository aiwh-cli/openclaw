#!/bin/bash
# knowledge-search.sh
# Shell wrapper for AIWH knowledge search system
# Takes a query + agent name → returns JSON search results from Supabase

set -euo pipefail
source /opt/AIWH/core/scripts/lib/env.sh

# ============================================================================
# ARGUMENT PARSING
# ============================================================================

QUERY=""
AGENT=""
COUNT=3

while [[ $# -gt 0 ]]; do
  case $1 in
    --query)
      QUERY="$2"
      shift 2
      ;;
    --agent)
      AGENT="$2"
      shift 2
      ;;
    --count)
      COUNT="$2"
      shift 2
      ;;
    *)
      echo "Error: Unknown argument '$1'" >&2
      echo "Usage: $0 --query TEXT --agent NAME [--count N]" >&2
      exit 1
      ;;
  esac
done

# Validate required arguments
if [[ -z "$QUERY" ]]; then
  echo "Error: --query is required" >&2
  exit 1
fi

if [[ -z "$AGENT" ]]; then
  echo "Error: --agent is required" >&2
  exit 1
fi

# ============================================================================
# Load secrets (encrypted store preferred, .env fallback)
# ============================================================================

aiwh_load_secrets OPENAI_API_KEY SUPABASE_URL SUPABASE_SERVICE_KEY

# ============================================================================
# GET EMBEDDING FROM OPENAI
# ============================================================================

get_embedding() {
  local query_text="$1"
  
  local response
  response=$(curl -s -X POST https://api.openai.com/v1/embeddings \
    -H "Authorization: Bearer $OPENAI_API_KEY" \
    -H "Content-Type: application/json" \
    -d "{
      \"input\": \"$query_text\",
      \"model\": \"text-embedding-3-small\"
    }" 2>/dev/null)
  
  # Check if response contains an error
  if echo "$response" | grep -q '"error"'; then
    return 1
  fi
  
  # Extract embedding array from response
  echo "$response" | python3 -c "import sys, json; data = json.load(sys.stdin); print(json.dumps(data['data'][0]['embedding']))" 2>/dev/null || return 1
}

# ============================================================================
# KEYWORD FALLBACK SEARCH
# ============================================================================

keyword_fallback_search() {
  local keyword="$1"
  local agent_name="$2"
  local match_count="$3"
  
  # URL encode the keyword
  local encoded_keyword=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$keyword'))")
  
  local response
  response=$(curl -s -G "${SUPABASE_URL}/rest/v1/base_knowledge" \
    -H "apikey: $SUPABASE_SERVICE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
    -H "Content-Type: application/json" \
    --data-urlencode "select=id,content,category,agent" \
    --data-urlencode "content=ilike.*${keyword}*" \
    --data-urlencode "or=(agent.eq.${agent_name},agent.eq.all)" \
    --data-urlencode "limit=${match_count}" 2>/dev/null)

  echo "$response"
}

# ============================================================================
# SEARCH KNOWLEDGE VIA RPC
# ============================================================================

search_knowledge() {
  local embedding="$1"
  local agent_name="$2"
  local match_count="$3"
  
  local response
  response=$(curl -s -X POST "${SUPABASE_URL}/rest/v1/rpc/search_knowledge" \
    -H "apikey: $SUPABASE_SERVICE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
    -H "Content-Type: application/json" \
    -d "{
      \"query_embedding\": $embedding,
      \"agent_name\": \"$agent_name\",
      \"match_count\": $match_count
    }" 2>/dev/null)
  
  echo "$response"
}

# ============================================================================
# MAIN LOGIC
# ============================================================================

# Try to get embedding from OpenAI
EMBEDDING=$(get_embedding "$QUERY" 2>/dev/null) || {
  echo "Warning: OpenAI API call failed, falling back to keyword search" >&2
  EMBEDDING=""
}

RESULTS=""

is_valid_json_array() {
  python3 -c "import sys, json; d = json.load(sys.stdin); assert isinstance(d, list)" 2>/dev/null
}

if [[ -n "$EMBEDDING" ]]; then
  # Use semantic search with embedding
  RESULTS=$(search_knowledge "$EMBEDDING" "$AGENT" "$COUNT")

  # Check if Supabase returned a valid array (errors return objects, not arrays)
  if ! echo "$RESULTS" | is_valid_json_array; then
    echo "Warning: Supabase RPC search failed, falling back to keyword search" >&2
    RESULTS=$(keyword_fallback_search "$QUERY" "$AGENT" "$COUNT")
  fi
else
  # Use keyword fallback search directly
  RESULTS=$(keyword_fallback_search "$QUERY" "$AGENT" "$COUNT")
fi

# ============================================================================
# OUTPUT RESULTS
# ============================================================================

# If no results or invalid response, output empty array
if [[ -z "$RESULTS" ]] || ! echo "$RESULTS" | is_valid_json_array; then
  RESULTS="[]"
fi

# Log execution
RESULT_COUNT=$(echo "$RESULTS" | python3 -c "import sys, json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
LOG_DIR="${CLIENT_ROOT:-/opt/AIWH/client}/logs"
mkdir -p "$LOG_DIR"
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] agent=${AGENT} query=\"${QUERY}\" results=${RESULT_COUNT}" \
  >> "${LOG_DIR}/knowledge-search.log"

echo "$RESULTS"
