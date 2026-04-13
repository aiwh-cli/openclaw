#!/usr/bin/env bash
# log-rotate.sh — Rotate all AIWH logs. Keep 7 days, compress old.
# Runs daily at 2am via script-cron. Safe to run manually.
#
# Usage:
#   log-rotate.sh              # Rotate all logs
#   log-rotate.sh --truncate   # Also truncate oversized logs (>20MB)

source /opt/AIWH/core/scripts/lib/env.sh

CLIENT_ROOT="${CLIENT_ROOT:-/opt/AIWH/client}"
OC_STATE="${OPENCLAW_STATE_DIR:-/opt/AIWH/.openclaw}"
KEEP_DAYS=7
MAX_SIZE_MB=20
TRUNCATE_MODE=false
[[ "${1:-}" == "--truncate" ]] && TRUNCATE_MODE=true

ROTATED=0
COMPRESSED=0
TRUNCATED=0

log() { echo "[$(date '+%Y-%m-%d %H:%M')] $1"; }

# All log directories to manage
LOG_DIRS=(
  "$CLIENT_ROOT/logs"
  "$OC_STATE/logs"
  "/opt/AIWH/core/logs"
)

# Rotate a single log file: mv foo.log → foo.log.1, compress foo.log.2+
rotate_log() {
  local f="$1"
  [[ ! -f "$f" ]] && return
  local size_kb=$(du -k "$f" 2>/dev/null | cut -f1)
  [[ "$size_kb" -lt 10 ]] && return  # Skip tiny files (<10KB)

  # Shift old rotated files: .6→.7, .5→.6, etc.
  for i in $(seq $((KEEP_DAYS - 1)) -1 1); do
    local next=$((i + 1))
    [[ -f "${f}.$i" ]] && mv "${f}.$i" "${f}.$next"
    [[ -f "${f}.$i.gz" ]] && mv "${f}.$i.gz" "${f}.$next.gz"
  done

  # Current → .1
  cp "$f" "${f}.1"
  : > "$f"  # Truncate current (safe — processes reopen on write)
  ((ROTATED++))

  # Compress .2+ (skip .1 — may still be written to by tail -f readers)
  for i in $(seq 2 "$KEEP_DAYS"); do
    if [[ -f "${f}.$i" && ! -f "${f}.$i.gz" ]]; then
      gzip "${f}.$i" 2>/dev/null && ((COMPRESSED++))
    fi
  done

  # Delete beyond retention
  for i in $(seq $((KEEP_DAYS + 1)) 20); do
    rm -f "${f}.$i" "${f}.$i.gz" 2>/dev/null
  done
}

# Truncate oversized logs (>20MB) immediately without rotation
truncate_oversized() {
  local f="$1"
  [[ ! -f "$f" ]] && return
  local size_mb=$(du -m "$f" 2>/dev/null | cut -f1)
  if [[ "$size_mb" -gt "$MAX_SIZE_MB" ]]; then
    log "Truncating oversized: $(basename "$f") (${size_mb}MB > ${MAX_SIZE_MB}MB)"
    # Keep last 1000 lines, discard rest
    tail -1000 "$f" > "${f}.tmp" && mv "${f}.tmp" "$f"
    ((TRUNCATED++))
  fi
}

# ── Main ────────────────────────────────────────────────────────────────────
log "Starting log rotation"

for dir in "${LOG_DIRS[@]}"; do
  [[ ! -d "$dir" ]] && continue
  for logfile in "$dir"/*.log "$dir"/*.jsonl; do
    [[ ! -f "$logfile" ]] && continue
    # Skip already-rotated files (.log.1, .log.2.gz, etc.)
    [[ "$logfile" =~ \.[0-9]+$ ]] && continue
    [[ "$logfile" =~ \.[0-9]+\.gz$ ]] && continue

    if $TRUNCATE_MODE; then
      truncate_oversized "$logfile"
    fi
    rotate_log "$logfile"
  done
done

log "Done: $ROTATED rotated, $COMPRESSED compressed, $TRUNCATED truncated"
