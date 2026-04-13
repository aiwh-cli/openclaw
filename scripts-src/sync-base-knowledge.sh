#!/bin/bash
set -euo pipefail
source /opt/AIWH/core/scripts/lib/env.sh

# sync-base-knowledge.sh
# Syncs published base_knowledge entries from Supabase to local SQLite cache

ENV_FILE="/opt/AIWH/.openclaw/.env"
# Cache DB lives in client workspace: /opt/AIWH/<client>/data/base_knowledge_cache.db
CACHE_DB="${AIWH_CACHE_DB:-${CLIENT_ROOT:-/opt/AIWH/client}/data/base_knowledge_cache.db}"
LOG_FILE="${CLIENT_ROOT:-/opt/AIWH/client}/logs/sync-base-knowledge.log"

DRY_RUN=false
FORCE_REDOWNLOAD=false
SKIP_SUB_CHECK=false

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    --force) FORCE_REDOWNLOAD=true; shift ;;
    --skip-sub-check) SKIP_SUB_CHECK=true; shift ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

# Setup
mkdir -p "$(dirname "$CACHE_DB")" "$(dirname "$LOG_FILE")"

log_msg() {
  local msg="$1"
  echo "[$(date +'%Y-%m-%d %H:%M:%S')] $msg" | tee -a "$LOG_FILE"
}

# Load secrets (encrypted store preferred, .env fallback)
aiwh_load_secrets SUPABASE_URL SUPABASE_ANON_KEY

# ===== SUBSCRIPTION CHECK =====
check_subscription() {
  # If --skip-sub-check flag is set, bypass the check
  if [[ "$SKIP_SUB_CHECK" == "true" ]]; then
    return 0
  fi
  
  local sub_file="${CLIENT_ROOT:-/opt/AIWH/client}/config/subscription.json"
  
  # Check if file exists
  if [[ ! -f "$sub_file" ]]; then
    log_msg "⚠️ WARNING: subscription.json not found — syncing anyway (knowledge is core, not gated by subscription)"
    return 0
  fi

  # Check if jq is available
  if ! command -v jq &> /dev/null; then
    log_msg "⚠️ WARNING: jq not found. Cannot parse subscription file — syncing anyway."
    return 0
  fi

  # Validate JSON
  if ! jq empty "$sub_file" 2>/dev/null; then
    log_msg "⚠️ WARNING: subscription.json is invalid JSON — syncing anyway"
    return 0
  fi

  # Extract fields
  local status=$(jq -r '.status // empty' "$sub_file" 2>/dev/null || echo "")
  local expires=$(jq -r '.expires // empty' "$sub_file" 2>/dev/null || echo "")

  # Check status — warn but don't block
  if [[ "$status" != "active" ]]; then
    log_msg "⚠️ WARNING: Subscription status is '${status}' (not active) — syncing anyway. Knowledge sync is never blocked."
    return 0
  fi

  # Check expiration date — warn but don't block
  if [[ -z "$expires" ]]; then
    log_msg "⚠️ WARNING: No expiration date in subscription.json — syncing anyway"
    return 0
  fi

  # Compare dates — warn if expired but still sync
  local today=$(date -u +%Y-%m-%d)
  if [[ "$expires" < "$today" ]]; then
    log_msg "⚠️ WARNING: Subscription expired on ${expires} — syncing anyway. Notify client to renew."
    aiwh_notify "⚠️ **Subscription expired** (${expires}). Knowledge sync still running but please renew." "systems" 2>/dev/null || true
    return 0
  fi

  log_msg "✓ Subscription valid (expires: $expires)"
  return 0
}

log_msg "=========================================="
log_msg "Starting base_knowledge sync"
log_msg "=========================================="
log_msg "Mode: $([ "$DRY_RUN" = true ] && echo 'DRY-RUN' || echo 'LIVE')"
log_msg "Database: $CACHE_DB"

# Check subscription before proceeding
if ! check_subscription; then
  exit 0
fi

# Init DB
init_db() {
  sqlite3 "$CACHE_DB" <<EOF
CREATE TABLE IF NOT EXISTS base_knowledge (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  category TEXT,
  knowledge_type TEXT,
  version INTEGER DEFAULT 1,
  embedding TEXT,
  embedding_model TEXT,
  target_agents TEXT,
  status TEXT,
  source TEXT,
  expires_at TEXT,
  created_at TEXT,
  updated_at TEXT,
  is_archived INTEGER DEFAULT 0,
  sync_timestamp TEXT
);
CREATE INDEX IF NOT EXISTS idx_status ON base_knowledge(status);
CREATE INDEX IF NOT EXISTS idx_is_archived ON base_knowledge(is_archived);
EOF
}

init_db

# Fetch from Supabase
ENTRIES_FILE=$(mktemp)
trap "rm -f '$ENTRIES_FILE'" EXIT

log_msg "Fetching from Supabase..."

OFFSET=0
PAGE_SIZE=1000
TOTAL=0

while true; do
  RESPONSE=$(mktemp)
  trap "rm -f '$ENTRIES_FILE' '$RESPONSE'" EXIT
  
  RANGE="$OFFSET-$((OFFSET + PAGE_SIZE - 1))"
  
  curl -s \
    -H "apikey: $SUPABASE_ANON_KEY" \
    -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
    -H "Range: $RANGE" \
    -H "Range-Unit: items" \
    "$SUPABASE_URL/rest/v1/base_knowledge?status=eq.published&order=id" \
    -o "$RESPONSE" 2>&1
  
  # Validate JSON
  if ! jq empty "$RESPONSE" 2>/dev/null; then
    log_msg "Error: Invalid JSON response"
    exit 1
  fi
  
  # Check for errors
  if jq -e '.code' "$RESPONSE" >/dev/null 2>&1; then
    log_msg "Error: $(jq -r '.message' "$RESPONSE")"
    exit 1
  fi
  
  COUNT=$(jq 'length' "$RESPONSE")
  [[ "$COUNT" -eq 0 ]] && break
  
  TOTAL=$((TOTAL + COUNT))
  log_msg "Fetched page: $((OFFSET / PAGE_SIZE + 1)) entries: $COUNT"
  
  # Append to entries file
  jq -c '.[]' "$RESPONSE" >> "$ENTRIES_FILE"
  
  [[ "$COUNT" -lt "$PAGE_SIZE" ]] && break
  OFFSET=$((OFFSET + PAGE_SIZE))
done

log_msg "Total entries fetched: $TOTAL"

if [[ "$TOTAL" -eq 0 ]]; then
  log_msg "No entries to sync"
  exit 0
fi

# Process with Python for safe JSON/SQL handling
python3 << PYTHON_EOF
import json
import sqlite3
from datetime import datetime, timezone
import sys

db_path = "$CACHE_DB"
entries_file = "$ENTRIES_FILE"
dry_run = $([[ "$DRY_RUN" == "true" ]] && echo "True" || echo "False")
force_redownload = $([[ "$FORCE_REDOWNLOAD" == "true" ]] && echo "True" || echo "False")
sync_timestamp = datetime.now(timezone.utc).isoformat()

new_count = 0
updated_count = 0
skipped_count = 0
archived_count = 0

# Read remote IDs and process entries
remote_ids = set()

try:
  conn = sqlite3.connect(db_path)
  cursor = conn.cursor()
  
  # Process each entry
  with open(entries_file, 'r') as f:
    for line in f:
      if not line.strip():
        continue
      
      try:
        entry = json.loads(line)
      except json.JSONDecodeError:
        print(f"Skipping invalid JSON: {line[:50]}", file=sys.stderr)
        continue
      
      entry_id = entry.get('id')
      if not entry_id:
        continue
      
      remote_ids.add(entry_id)
      
      # Check if exists
      cursor.execute("SELECT version FROM base_knowledge WHERE id = ?", (entry_id,))
      row = cursor.fetchone()
      
      version = entry.get('version', 1)
      
      if row is None:
        # New entry
        new_count += 1
        if not dry_run:
          cursor.execute("""
            INSERT INTO base_knowledge (
              id, content, category, knowledge_type, version, embedding, 
              embedding_model, target_agents, status, source, expires_at,
              created_at, updated_at, is_archived, sync_timestamp
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          """, (
            entry_id,
            entry.get('content', ''),
            entry.get('category'),
            entry.get('knowledge_type'),
            version,
            json.dumps(entry.get('embedding')) if entry.get('embedding') else None,
            entry.get('embedding_model'),
            json.dumps(entry.get('target_agents')) if entry.get('target_agents') else None,
            entry.get('status'),
            entry.get('source'),
            entry.get('expires_at'),
            entry.get('created_at'),
            entry.get('updated_at'),
            0,
            sync_timestamp
          ))
      elif force_redownload or version != row[0]:
        # Updated entry
        updated_count += 1
        if not dry_run:
          cursor.execute("""
            UPDATE base_knowledge SET
              content = ?, category = ?, knowledge_type = ?, version = ?,
              embedding = ?, embedding_model = ?, target_agents = ?,
              status = ?, source = ?, expires_at = ?, updated_at = ?,
              is_archived = 0, sync_timestamp = ?
            WHERE id = ?
          """, (
            entry.get('content', ''),
            entry.get('category'),
            entry.get('knowledge_type'),
            version,
            json.dumps(entry.get('embedding')) if entry.get('embedding') else None,
            entry.get('embedding_model'),
            json.dumps(entry.get('target_agents')) if entry.get('target_agents') else None,
            entry.get('status'),
            entry.get('source'),
            entry.get('expires_at'),
            entry.get('updated_at'),
            sync_timestamp,
            entry_id
          ))
      else:
        # Skipped
        skipped_count += 1
  
  # Check for archived entries
  cursor.execute("SELECT id FROM base_knowledge WHERE is_archived = 0")
  local_ids = {row[0] for row in cursor.fetchall()}
  
  for local_id in local_ids - remote_ids:
    archived_count += 1
    if not dry_run:
      cursor.execute(
        "UPDATE base_knowledge SET is_archived = 1, sync_timestamp = ? WHERE id = ?",
        (sync_timestamp, local_id)
      )
  
  # Get total
  cursor.execute("SELECT COUNT(*) FROM base_knowledge WHERE is_archived = 0")
  total_count = cursor.fetchone()[0]
  
  if not dry_run:
    conn.commit()
  
  conn.close()
  
  print(f"New: {new_count}, Updated: {updated_count}, Skipped: {skipped_count}, Archived: {archived_count}, Total: {total_count}")
  
except Exception as e:
  print(f"Error: {e}", file=sys.stderr)
  sys.exit(1)
PYTHON_EOF

# Touch the DB to update mtime even when all entries are skipped (no writes needed)
# This prevents false staleness alerts when the data is already up-to-date
if [[ -f "$CACHE_DB" ]]; then
  touch "$CACHE_DB"
fi

# ===== CACHE STALENESS CHECK =====
# If cache is >48hr old after sync attempt, something is wrong — alert
if [[ -f "$CACHE_DB" ]]; then
  cache_age_sec=$(python3 -c "
import os, time
mtime = os.path.getmtime('$CACHE_DB')
print(int(time.time() - mtime))
" 2>/dev/null || echo "0")
  if [[ "$cache_age_sec" -gt 172800 ]]; then
    cache_age_hrs=$((cache_age_sec / 3600))
    log_msg "ERROR: base_knowledge_cache.db is ${cache_age_hrs}h old (>48h). Agents may have stale knowledge."
    aiwh_notify "🚨 **Knowledge cache stale**: base_knowledge_cache.db is ${cache_age_hrs}h old. Sync may be failing." "systems" 2>/dev/null || true
  fi
fi

log_msg "=========================================="
log_msg "Sync completed successfully"
log_msg "=========================================="
