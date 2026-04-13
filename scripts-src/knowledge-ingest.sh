#!/bin/bash
#
# knowledge-ingest.sh — Full pipeline for knowledge ingestion
#
# PURPOSE: Takes a JSONL file of knowledge entries and handles the full pipeline:
# POST to Supabase → embed → publish.
#
# USAGE:
#   ./knowledge-ingest.sh /path/to/entries.jsonl
#   ./knowledge-ingest.sh /path/to/entries.jsonl --source custom-source-name
#   ./knowledge-ingest.sh /path/to/entries.jsonl --dry-run
#   ./knowledge-ingest.sh /path/to/entries.jsonl --source custom --dry-run
#
# OPTIONS:
#   --source NAME    Override the source field (default: filename without extension)
#   --dry-run        Validate JSONL but don't POST, embed, or publish
#
# REQUIREMENTS:
#   - curl, jq installed
#   - /opt/AIWH/.openclaw/.env with SUPABASE_URL, SUPABASE_SERVICE_KEY, OPENAI_API_KEY
#   - /opt/AIWH/core/scripts/batch-embed.sh exists
#

set -euo pipefail
source /opt/AIWH/core/scripts/lib/env.sh

# ============================================================================
# Configuration & Argument Parsing
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="/opt/AIWH/.openclaw/.env"
BATCH_EMBED_SCRIPT="${SCRIPT_DIR}/batch-embed.sh"

JSONL_FILE=""
SOURCE_OVERRIDE=""
DRY_RUN=false

# Parse arguments
if [[ $# -eq 0 ]]; then
  echo "Usage: $0 <jsonl_file> [--source SOURCE] [--dry-run]"
  echo ""
  echo "Arguments:"
  echo "  <jsonl_file>        Path to JSONL file with knowledge entries"
  echo ""
  echo "Options:"
  echo "  --source SOURCE     Override source field (default: filename without extension)"
  echo "  --dry-run           Validate JSONL but don't POST/embed/publish"
  exit 1
fi

JSONL_FILE="$1"
shift || true

# Parse remaining arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --source)
      SOURCE_OVERRIDE="$2"
      shift 2
      ;;
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
# Validation
# ============================================================================

# Check JSONL file exists
if [[ ! -f "$JSONL_FILE" ]]; then
  echo "ERROR: JSONL file not found: $JSONL_FILE"
  exit 1
fi

# Check environment file exists
if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: Environment file not found: $ENV_FILE"
  exit 1
fi

# Check batch-embed script exists
if [[ ! -f "$BATCH_EMBED_SCRIPT" ]]; then
  echo "ERROR: batch-embed script not found: $BATCH_EMBED_SCRIPT"
  exit 1
fi

# ============================================================================
# Load secrets (encrypted store preferred, .env fallback)
# ============================================================================

aiwh_load_secrets SUPABASE_URL SUPABASE_SERVICE_KEY OPENAI_API_KEY

# ============================================================================
# Constants & Counters
# ============================================================================

SUPABASE_TABLE="base_knowledge"

POSTED_COUNT=0
VALIDATION_FAILED=0
POST_FAILED=0
EMBEDDED_COUNT=0
PUBLISHED_COUNT=0

LOG_FILE="${SCRIPT_DIR}/../logs/knowledge-ingest.log"
mkdir -p "$(dirname "$LOG_FILE")"

log_msg() {
  local msg="$1"
  echo "[$(date +'%Y-%m-%d %H:%M:%S')] $msg" | tee -a "$LOG_FILE"
}

# ============================================================================
# Determine source field
# ============================================================================

if [[ -n "$SOURCE_OVERRIDE" ]]; then
  SOURCE_FIELD="$SOURCE_OVERRIDE"
else
  # Extract filename without extension
  SOURCE_FIELD=$(basename "$JSONL_FILE" .jsonl)
fi

log_msg "=========================================="
log_msg "Knowledge Ingestion Pipeline Started"
log_msg "=========================================="
log_msg "JSONL File: $JSONL_FILE"
log_msg "Source Field: $SOURCE_FIELD"
log_msg "Mode: $([ "$DRY_RUN" = true ] && echo 'DRY-RUN' || echo 'LIVE')"
log_msg "Supabase URL: $SUPABASE_URL"
log_msg "Table: $SUPABASE_TABLE"
log_msg ""

# ============================================================================
# Validate JSONL File
# ============================================================================

log_msg "Validating JSONL file..."

entry_line_num=0
while IFS= read -r line; do
  entry_line_num=$((entry_line_num + 1))
  
  # Skip empty lines
  if [[ -z "$line" ]]; then
    continue
  fi
  
  # Validate JSON
  if ! echo "$line" | jq . > /dev/null 2>&1; then
    log_msg "  ✗ Line $entry_line_num: Invalid JSON"
    VALIDATION_FAILED=$((VALIDATION_FAILED + 1))
    continue
  fi
  
  # Extract required fields
  category=$(echo "$line" | jq -r '.category // empty' 2>/dev/null)
  content=$(echo "$line" | jq -r '.content // empty' 2>/dev/null)
  knowledge_type=$(echo "$line" | jq -r '.knowledge_type // empty' 2>/dev/null)
  
  # Validate required fields
  if [[ -z "$category" ]]; then
    log_msg "  ✗ Line $entry_line_num: Missing required field 'category'"
    VALIDATION_FAILED=$((VALIDATION_FAILED + 1))
    continue
  fi
  
  if [[ -z "$content" ]]; then
    log_msg "  ✗ Line $entry_line_num: Missing required field 'content'"
    VALIDATION_FAILED=$((VALIDATION_FAILED + 1))
    continue
  fi
  
  if [[ -z "$knowledge_type" ]]; then
    log_msg "  ✗ Line $entry_line_num: Missing required field 'knowledge_type'"
    VALIDATION_FAILED=$((VALIDATION_FAILED + 1))
    continue
  fi
  
  # Log success
  preview="${content:0:60}"
  if [[ ${#content} -gt 60 ]]; then
    preview="${preview}..."
  fi
  log_msg "  ✓ Line $entry_line_num: Valid | Category: $category | Type: $knowledge_type | Content: $preview"
  
done < "$JSONL_FILE"

if [[ $VALIDATION_FAILED -gt 0 ]]; then
  log_msg ""
  log_msg "ERROR: Validation failed for $VALIDATION_FAILED entries. Aborting."
  exit 1
fi

log_msg "✓ All entries validated successfully"
log_msg ""

# ============================================================================
# POST entries to Supabase (if not dry-run)
# ============================================================================

if [[ "$DRY_RUN" == true ]]; then
  log_msg "[DRY-RUN] Skipping POST step"
else
  log_msg "POSTing entries to Supabase..."
  
  entry_num=0
  while IFS= read -r line; do
    entry_num=$((entry_num + 1))
    
    # Skip empty lines
    if [[ -z "$line" ]]; then
      continue
    fi
    
    # Add source field to entry
    entry=$(echo "$line" | jq --arg source "$SOURCE_FIELD" '. + {source: $source}')
    
    # Extract fields for logging
    category=$(echo "$entry" | jq -r '.category')
    content=$(echo "$entry" | jq -r '.content')
    preview="${content:0:60}"
    if [[ ${#content} -gt 60 ]]; then
      preview="${preview}..."
    fi
    
    # POST to Supabase (with Prefer header to get response)
    url="${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}"
    response=$(curl -s -X POST "$url" \
      -H "apikey: ${SUPABASE_SERVICE_KEY}" \
      -H "Content-Type: application/json" \
      -H "Prefer: return=representation" \
      -d "$entry")
    
    # Response is an array, so extract first element
    id=$(echo "$response" | jq -r '.[0].id // empty' 2>/dev/null)
    error=$(echo "$response" | jq -r '.[0].message // empty' 2>/dev/null)
    
    # Check if we got an ID
    if [[ -n "$id" && "$id" != "null" ]]; then
      log_msg "  ✓ Entry $entry_num POSTed | ID: $id | Category: $category | Content: $preview"
      POSTED_COUNT=$((POSTED_COUNT + 1))
    else
      # Check for error message
      if [[ -n "$error" && "$error" != "null" ]]; then
        log_msg "  ✗ Entry $entry_num FAILED | Error: $error"
      else
        # Try to parse error from root level
        error=$(echo "$response" | jq -r '.message // empty' 2>/dev/null)
        if [[ -n "$error" && "$error" != "null" ]]; then
          log_msg "  ✗ Entry $entry_num FAILED | Error: $error"
        else
          log_msg "  ✗ Entry $entry_num FAILED | No ID in response"
        fi
      fi
      POST_FAILED=$((POST_FAILED + 1))
    fi
    
    # Small delay to respect rate limits
    sleep 0.2
    
  done < "$JSONL_FILE"
  
  log_msg ""
  log_msg "POST Summary: $POSTED_COUNT successfully posted, $POST_FAILED failed"
  
  if [[ $POST_FAILED -gt 0 ]]; then
    log_msg "⚠ Some entries failed to POST. Continuing with embedding..."
  fi
fi

# ============================================================================
# Embed entries (if not dry-run)
# ============================================================================

if [[ "$DRY_RUN" == true ]]; then
  log_msg "[DRY-RUN] Skipping embedding step"
else
  log_msg ""
  log_msg "Running batch embedding..."
  
  # Run batch-embed until no more NULL embeddings
  max_iterations=5
  iteration=0
  
  while [[ $iteration -lt $max_iterations ]]; do
    iteration=$((iteration + 1))
    log_msg "Embedding iteration #$iteration..."
    
    # Run batch-embed in dry-run mode to check how many entries need embedding
    dry_output=$("$BATCH_EMBED_SCRIPT" --dry-run 2>&1 | tail -20)
    null_count=$(echo "$dry_output" | grep -c "DRY-RUN\]" || echo 0)
    
    if [[ $null_count -eq 0 ]]; then
      log_msg "✓ No more entries with NULL embeddings"
      break
    fi
    
    log_msg "Found $null_count entries to embed..."
    
    # Run batch-embed for real
    "$BATCH_EMBED_SCRIPT" >> "$LOG_FILE" 2>&1 || true
    
    log_msg "✓ Embedding iteration #$iteration complete"
    sleep 1
  done
  
  log_msg "✓ Embedding pipeline complete"
fi

# ============================================================================
# Publish entries (if not dry-run)
# ============================================================================

if [[ "$DRY_RUN" == true ]]; then
  log_msg "[DRY-RUN] Skipping publish step"
else
  log_msg ""
  log_msg "Publishing entries with source='$SOURCE_FIELD'..."
  
  # Prepare payload to update status
  url="${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?source=eq.${SOURCE_FIELD}"
  payload='{"status":"published"}'
  
  response=$(curl -s -X PATCH "$url" \
    -H "apikey: ${SUPABASE_SERVICE_KEY}" \
    -H "Content-Type: application/json" \
    -d "$payload")
  
  # Count updated entries from response
  if echo "$response" | jq . > /dev/null 2>&1; then
    PUBLISHED_COUNT=$(echo "$response" | jq 'length' 2>/dev/null || echo 0)
    
    if [[ $PUBLISHED_COUNT -gt 0 ]]; then
      log_msg "✓ Successfully published $PUBLISHED_COUNT entries"
    else
      # Check if it's an error response
      error=$(echo "$response" | jq -r '.message // empty')
      if [[ -n "$error" ]]; then
        log_msg "⚠ Publish response: $error"
      else
        log_msg "⚠ No entries were updated (may already be published)"
      fi
    fi
  else
    log_msg "✗ Failed to parse publish response"
  fi
fi

# ============================================================================
# Final Summary
# ============================================================================

log_msg ""
log_msg "=========================================="
log_msg "Summary"
log_msg "=========================================="
log_msg "Total validated: $((POSTED_COUNT + POST_FAILED))"
log_msg "Posted: $POSTED_COUNT"
log_msg "POST failed: $POST_FAILED"

if [[ "$DRY_RUN" == false ]]; then
  log_msg "Embedded: $EMBEDDED_COUNT (via batch-embed pipeline)"
  log_msg "Published: $PUBLISHED_COUNT"
fi

log_msg "Mode: $([ "$DRY_RUN" = true ] && echo 'DRY-RUN' || echo 'LIVE')"
log_msg "=========================================="

# Exit with appropriate code
if [[ $VALIDATION_FAILED -gt 0 || $POST_FAILED -gt 0 ]]; then
  log_msg "⚠ Pipeline completed with some failures. Check log for details."
  exit 1
else
  log_msg "✓ Pipeline completed successfully"
  exit 0
fi
