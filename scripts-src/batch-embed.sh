#!/bin/bash
#
# batch-embed.sh — Batch embedding script for base_knowledge
#
# PURPOSE: Find all entries in Supabase base_knowledge table with NULL embeddings,
# generate embeddings via OpenAI API (text-embedding-3-small), and update them.
#
# USAGE:
#   ./batch-embed.sh                 # Run for real
#   ./batch-embed.sh --dry-run       # Preview what would be embedded
#
# REQUIREMENTS:
#   - curl, jq installed
#   - /opt/AIWH/.openclaw/.env with SUPABASE_URL, SUPABASE_SERVICE_KEY, OPENAI_API_KEY
#

set -euo pipefail
source /opt/AIWH/core/scripts/lib/env.sh

# ============================================================================
# Configuration
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="/opt/AIWH/.openclaw/.env"
DRY_RUN=false

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# ============================================================================
# Load secrets (encrypted store preferred, .env fallback)
# ============================================================================

aiwh_load_secrets SUPABASE_URL SUPABASE_SERVICE_KEY OPENAI_API_KEY

# ============================================================================
# Constants
# ============================================================================

SUPABASE_TABLE="base_knowledge"
EMBEDDING_MODEL="text-embedding-3-small"
EMBEDDING_DIM=1536
BATCH_SIZE=5  # Process in small batches to respect rate limits

# ============================================================================
# Logging & counters
# ============================================================================

TOTAL_FETCHED=0
TOTAL_EMBEDDED=0
TOTAL_FAILED=0
LOG_FILE="${SCRIPT_DIR}/../logs/batch-embed.log"

# Ensure log directory exists
mkdir -p "$(dirname "$LOG_FILE")"

log_msg() {
  local msg="$1"
  echo "[$(date +'%Y-%m-%d %H:%M:%S')] $msg" | tee -a "$LOG_FILE"
}

# ============================================================================
# Fetch entries with NULL embeddings
# ============================================================================

fetch_null_embeddings() {
  local limit="${1:-100}"
  local offset="${2:-0}"
  
  local query="embedding=is.null"
  local url="${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?${query}&limit=${limit}&offset=${offset}&order=id.asc"
  
  curl -s -X GET "$url" \
    -H "apikey: ${SUPABASE_SERVICE_KEY}" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json"
}

# ============================================================================
# Generate embedding via OpenAI API
# ============================================================================

generate_embedding() {
  local text="$1"
  
  # Escape text for JSON
  local escaped_text=$(printf '%s\n' "$text" | jq -Rs .)
  
  local payload="{\"input\": $escaped_text, \"model\": \"${EMBEDDING_MODEL}\"}"
  
  local response=$(curl -s -X POST "https://api.openai.com/v1/embeddings" \
    -H "Authorization: Bearer ${OPENAI_API_KEY}" \
    -H "Content-Type: application/json" \
    -d "$payload")
  
  # Extract embedding vector from response
  echo "$response" | jq -r '.data[0].embedding // empty' 2>/dev/null
}

# ============================================================================
# Update entry with embedding in Supabase
# ============================================================================

update_embedding() {
  local entry_id="$1"
  local embedding="$2"
  
  local url="${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?id=eq.${entry_id}"
  
  # Build payload with embedding array
  local payload="{\"embedding\": $embedding}"
  
  local response=$(curl -s -X PATCH "$url" \
    -H "apikey: ${SUPABASE_SERVICE_KEY}" \
    -H "Content-Type: application/json" \
    -d "$payload")
  
  # Check for errors in response
  if echo "$response" | jq -e '.message // .error' > /dev/null 2>&1; then
    echo "ERROR"
  else
    echo "OK"
  fi
}

# ============================================================================
# Process embeddings
# ============================================================================

process_entries() {
  local offset=0
  local batch_count=0
  
  while true; do
    log_msg "Fetching batch at offset $offset..."
    
    local entries=$(fetch_null_embeddings "$BATCH_SIZE" "$offset")
    
    # Parse the JSON array
    local count=$(echo "$entries" | jq 'length' 2>/dev/null || echo 0)
    
    if [[ "$count" -eq 0 ]]; then
      log_msg "No more entries to process."
      break
    fi
    
    TOTAL_FETCHED=$((TOTAL_FETCHED + count))
    batch_count=$((batch_count + 1))
    log_msg "Batch #$batch_count: Found $count entries with NULL embeddings"
    
    # Process each entry in the batch
    while IFS= read -r line; do
      local id=$(echo "$line" | jq -r '.id // empty')
      local content=$(echo "$line" | jq -r '.content // empty')
      
      # Skip if id is empty
      if [[ -z "$id" ]]; then
        continue
      fi
      
      # Truncate content preview for logging (first 80 chars)
      local preview="${content:0:80}"
      if [[ ${#content} -gt 80 ]]; then
        preview="${preview}..."
      fi
      
      if [[ "$DRY_RUN" == true ]]; then
        log_msg "[DRY-RUN] Would embed: ID=$id | Content: $preview"
      else
        log_msg "Embedding: ID=$id | Content: $preview"
        
        # Generate embedding
        local embedding=$(generate_embedding "$content")
        
        # Check if embedding was generated
        if [[ -z "$embedding" ]]; then
          log_msg "  ✗ FAILED to generate embedding for ID=$id"
          TOTAL_FAILED=$((TOTAL_FAILED + 1))
          continue
        fi
        
        # Verify embedding is an array with correct dimensions
        local dim=$(echo "$embedding" | jq 'length' 2>/dev/null || echo 0)
        if [[ "$dim" -ne "$EMBEDDING_DIM" ]]; then
          log_msg "  ✗ FAILED: Embedding has $dim dimensions, expected $EMBEDDING_DIM for ID=$id"
          TOTAL_FAILED=$((TOTAL_FAILED + 1))
          continue
        fi
        
        # Update Supabase
        local result=$(update_embedding "$id" "$embedding")
        
        if [[ "$result" == "OK" ]]; then
          log_msg "  ✓ Successfully embedded ID=$id"
          TOTAL_EMBEDDED=$((TOTAL_EMBEDDED + 1))
        else
          log_msg "  ✗ FAILED to update ID=$id in Supabase"
          TOTAL_FAILED=$((TOTAL_FAILED + 1))
        fi
      fi
    done < <(echo "$entries" | jq -c '.[]')
    
    offset=$((offset + BATCH_SIZE))
    
    # Small delay to respect rate limits
    sleep 1
  done
}

# ============================================================================
# Main
# ============================================================================

main() {
  log_msg "=========================================="
  log_msg "Batch Embedding Script Started"
  log_msg "=========================================="
  log_msg "Mode: $([ "$DRY_RUN" = true ] && echo 'DRY-RUN' || echo 'REAL')"
  log_msg "Supabase URL: $SUPABASE_URL"
  log_msg "Table: $SUPABASE_TABLE"
  log_msg "Embedding Model: $EMBEDDING_MODEL"
  log_msg "Dimensions: $EMBEDDING_DIM"
  log_msg ""
  
  process_entries
  
  log_msg ""
  log_msg "=========================================="
  log_msg "Summary"
  log_msg "=========================================="
  log_msg "Total entries fetched: $TOTAL_FETCHED"
  
  if [[ "$DRY_RUN" == true ]]; then
    log_msg "[DRY-RUN] Would have embedded: $TOTAL_FETCHED entries"
  else
    log_msg "Successfully embedded: $TOTAL_EMBEDDED entries"
    log_msg "Failed: $TOTAL_FAILED entries"
    
    if [[ $TOTAL_FAILED -gt 0 ]]; then
      log_msg "⚠ Some entries failed. Check log for details."
    fi
  fi
  
  log_msg "=========================================="
  
  # Exit with appropriate code
  if [[ $TOTAL_FAILED -gt 0 && "$DRY_RUN" == false ]]; then
    exit 1
  fi
}

main
