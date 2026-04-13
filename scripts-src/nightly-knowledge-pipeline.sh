#!/bin/bash
# ═══════════════════════════════════════════════════════
# Nightly Knowledge Pipeline
# Runs the FULL chain: extract → embed → review → publish
# Designed to be called by OpenClaw cron (replaces standalone extract)
# ═══════════════════════════════════════════════════════

set -euo pipefail
source /opt/AIWH/core/scripts/lib/env.sh
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_FILE="${CLIENT_ROOT:-/opt/AIWH/client}/logs/nightly-knowledge-pipeline.log"
mkdir -p "$(dirname "$LOG_FILE")"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"; }

log "════════════════════════════════════════"
log "NIGHTLY KNOWLEDGE PIPELINE — START"
log "════════════════════════════════════════"

# ─── STEP 1: SKIPPED — Tag-based extraction replaced by LLM extraction (Step 1b) ───
# Tag-based extraction (extract-knowledge.py) is redundant: Step 1b's LLM extraction
# auto-categorizes all memory content without needing #knowledge-extraction tags.
# Script kept intact at extract-knowledge.py for manual use if needed.
log "STEP 1: Skipped (tag extraction superseded by LLM extraction in Step 1b)"
new_count=0; skip_count=0; fail_count=0

# ─── STEP 1b: LLM-based extraction (timeout: 10m) ───
log "STEP 1b: LLM-based extraction from memory files..."
llm_output=$(aiwh_run_with_timeout 600 python3 "$SCRIPT_DIR/llm-extract-knowledge.py" --hours 25 2>&1) || {
    [[ $? -eq 124 ]] && log "  WARNING: Step 1b timed out after 10m" || true
}
llm_new=$(echo "$llm_output" | grep -oE 'LLM Extracted: [0-9]+' | grep -oE '[0-9]+' | tail -1)
llm_new=${llm_new:-0}
log "  LLM extraction: ${llm_new} new entries"

# ─── STEP 1c: Extract cinematic knowledge from style grades (timeout: 5m) ───
log "STEP 1c: Extracting cinematic knowledge from style grades..."
cine_output=$(aiwh_run_with_timeout 300 python3 "$SCRIPT_DIR/extract-cinematic-knowledge.py" 2>&1) || {
    [[ $? -eq 124 ]] && log "  WARNING: Step 1c timed out after 5m" || true
}
cine_count=$(echo "$cine_output" | grep -oE 'Extracted [0-9]+ knowledge' | grep -oE '[0-9]+' | tail -1)
cine_count=${cine_count:-0}
cine_pushed=$(echo "$cine_output" | grep -oE '[0-9]+ pushed' | grep -oE '[0-9]+' | tail -1)
cine_pushed=${cine_pushed:-0}
log "  Cinematic: ${cine_count} patterns extracted, ${cine_pushed} pushed to Supabase"

# ─── STEP 2: Embed any entries with NULL embeddings (timeout: 15m total) ───
log "STEP 2: Embedding entries with NULL embeddings..."
embed_total=0
max_passes=10
pass=0
step2_start=$(date +%s)
while [ $pass -lt $max_passes ]; do
    # Check 15m budget
    elapsed=$(( $(date +%s) - step2_start ))
    if [ $elapsed -gt 900 ]; then
        log "  WARNING: Step 2 hit 15m budget at pass $pass"
        break
    fi

    pass=$((pass + 1))
    dry_output=$(bash "$SCRIPT_DIR/batch-embed.sh" --dry-run 2>&1)
    remaining=$(echo "$dry_output" | sed -n 's/.*Would have embedded: \([0-9]*\).*/\1/p' | tail -1)
    remaining=${remaining:-0}

    if [ "$remaining" = "0" ]; then
        break
    fi

    log "  Pass $pass: ${remaining} entries to embed..."
    embed_output=$(bash "$SCRIPT_DIR/batch-embed.sh" 2>&1)
    embedded=$(echo "$embed_output" | sed -n 's/.*Successfully embedded: \([0-9]*\).*/\1/p' | tail -1)
    embedded=${embedded:-0}
    embed_total=$((embed_total + embedded))
done
log "  Embedding complete: ${embed_total} entries embedded in ${pass} passes"

# ─── STEP 2b: Expire old drafts (>30 days) before review ───
log "STEP 2b: Expiring drafts older than 30 days..."
if [ -f "$SCRIPT_DIR/knowledge-review.sh" ]; then
    expire_output=$(aiwh_run_with_timeout 120 bash "$SCRIPT_DIR/knowledge-review.sh" --expire 30 2>&1) || {
        [[ $? -eq 124 ]] && log "  WARNING: Expire step timed out after 2m" || true
    }
    log "  $expire_output"
else
    log "  WARNING: knowledge-review.sh not found, skipping expire"
fi

# ─── STEP 3: Auto-review (publish ≥0.90, flag rest) (timeout: 5m) ───
log "STEP 3: Running auto-review..."
if [ -f "$SCRIPT_DIR/knowledge-review.sh" ]; then
    review_output=$(aiwh_run_with_timeout 300 bash "$SCRIPT_DIR/knowledge-review.sh" --auto 2>&1) || {
        [[ $? -eq 124 ]] && log "  WARNING: Step 3 timed out after 5m" || true
    }
    log "  Review: done"
    echo "$review_output" | grep -iE "publish|discord|skip|approve" | while read -r line; do
        log "  $line"
    done || true
else
    log "  WARNING: knowledge-review.sh not found, skipping review"
fi

# ─── STEP 3b: Second embed pass (review may have published unembedded entries) ───
log "STEP 3b: Post-review embedding pass..."
post_embed=0
for i in 1 2 3 4 5; do
    dry_out=$(bash "$SCRIPT_DIR/batch-embed.sh" --dry-run 2>&1)
    left=$(echo "$dry_out" | sed -n 's/.*Would have embedded: \([0-9]*\).*/\1/p' | tail -1)
    left=${left:-0}
    [ "$left" = "0" ] && break
    log "  Post-review pass $i: ${left} entries..."
    emb_out=$(bash "$SCRIPT_DIR/batch-embed.sh" 2>&1)
    done_count=$(echo "$emb_out" | sed -n 's/.*Successfully embedded: \([0-9]*\).*/\1/p' | tail -1)
    post_embed=$((post_embed + ${done_count:-0}))
done
log "  Post-review embedding: ${post_embed} additional entries embedded"

# ─── STEP 3c: Embed and publish client_knowledge.db entries (loop until exhausted) ───
log "STEP 3c: Processing client_knowledge.db (local entries)..."
client_total=0
client_failed=0
for client_pass in $(seq 1 10); do
    client_output=$(python3 "$SCRIPT_DIR/embed-client-knowledge.py" 2>&1) || true
    processed=$(echo "$client_output" | grep -oE '[0-9]+ processed' | grep -oE '[0-9]+' | head -1)
    processed=${processed:-0}
    failed=$(echo "$client_output" | grep -oE '[0-9]+ failed' | grep -oE '[0-9]+' | head -1)
    failed=${failed:-0}
    client_total=$((client_total + processed))
    client_failed=$((client_failed + failed))
    [[ "$processed" -eq 0 ]] && break
    log "  Pass $client_pass: ${processed} processed, ${failed} failed"
done
log "  Client knowledge: ${client_total} processed, ${client_failed} failed"

# ─── STEP 4: Final count ───
log "STEP 4: Final verification..."
# Load secrets (encrypted store preferred, .env fallback)
aiwh_load_secrets SUPABASE_URL SUPABASE_SERVICE_KEY
if [ -n "${SUPABASE_URL:-}" ] && [ -n "${SUPABASE_SERVICE_KEY:-}" ]; then
    total=$(curl -s "${SUPABASE_URL}/rest/v1/base_knowledge?select=id&status=eq.published" \
        -H "apikey: ${SUPABASE_SERVICE_KEY}" -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" | \
        python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "?")
    drafts=$(curl -s "${SUPABASE_URL}/rest/v1/base_knowledge?select=id&status=eq.draft" \
        -H "apikey: ${SUPABASE_SERVICE_KEY}" -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" | \
        python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "?")
    null_embed=$(curl -s "${SUPABASE_URL}/rest/v1/base_knowledge?select=id&embedding=is.null" \
        -H "apikey: ${SUPABASE_SERVICE_KEY}" -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" | \
        python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "?")
    log "  Published: ${total} | Drafts: ${drafts} | Null embeddings: ${null_embed}"
else
    log "  WARNING: Supabase env not loaded, skipping verification"
fi

# ─── STEP 5: Sync published entries from Supabase → local cache ───
log "STEP 5: Syncing Supabase → local base_knowledge_cache.db..."
if [ -f "$SCRIPT_DIR/sync-base-knowledge.sh" ]; then
    sync_output=$(bash "$SCRIPT_DIR/sync-base-knowledge.sh" 2>&1) || true
    sync_count=$(echo "$sync_output" | grep -oE 'Total: [0-9]+' | grep -oE '[0-9]+' | tail -1)
    sync_count=${sync_count:-0}
    log "  Sync: ${sync_count} entries in local cache"
else
    log "  WARNING: sync-base-knowledge.sh not found, skipping sync"
fi

log "════════════════════════════════════════"
log "NIGHTLY KNOWLEDGE PIPELINE — COMPLETE"
log "  Extracted (tags): ${new_count} new | LLM: ${llm_new} new | Cinematic: ${cine_count}"
log "  Embedded: ${embed_total} entries"
log "  Client knowledge: ${client_total} processed"
log "  Synced: ${sync_count:-?} entries in local cache"
log "  Published: see counts above"
log "════════════════════════════════════════"

# ─── STEP 6: Post summary to Discord ───
icon="✅"
[[ "${null_embed:-0}" != "0" && "${null_embed:-0}" != "?" ]] && icon="⚠️"
discord_msg="${icon} **Nightly Knowledge Pipeline — $(date '+%Y-%m-%d')**\n• Extracted: ${new_count} tags + ${llm_new} LLM + ${cine_count} cinematic\n• Embedded: ${embed_total} entries\n• Published: ${total:-?} total | ${drafts:-?} drafts | ${null_embed:-?} null embeddings\n• Client knowledge: ${client_total} processed\n• Local cache: ${sync_count:-?} entries synced"
aiwh_notify "$discord_msg" "systems"
