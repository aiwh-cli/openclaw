#!/usr/bin/env bash
# delivery-queue-cleanup.sh — Weekly cleanup of stale delivery queue messages.
# Logs failures to client/logs/delivery-failures.log, removes messages >7 days old.
# Engine script (core/scripts/), not activatable. $0 cost (no LLM).

set -euo pipefail
source "$(dirname "$0")/lib/env.sh"

QUEUE_DIR="${OPENCLAW_STATE_DIR:-/opt/AIWH/.openclaw}/delivery-queue/failed"
LOG_FILE="${CLIENT_ROOT:-/opt/AIWH/client}/logs/delivery-failures.log"
MAX_AGE_DAYS=7
DRY_RUN=false

[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

if [[ ! -d "$QUEUE_DIR" ]]; then
  echo "No failed delivery queue directory found at $QUEUE_DIR"
  exit 0
fi

count=0
cleaned=0
now_ms=$(date +%s)000

for f in "$QUEUE_DIR"/*.json; do
  [[ -f "$f" ]] || continue
  count=$((count + 1))

  # Extract enqueued timestamp (ms) and error from JSON
  enqueued_ms=$(python3 -c "import json,sys; d=json.load(open('$f')); print(d.get('enqueuedAt',0))" 2>/dev/null || echo "0")
  last_error=$(python3 -c "import json,sys; d=json.load(open('$f')); print(d.get('lastError','unknown'))" 2>/dev/null || echo "unknown")
  retry_count=$(python3 -c "import json,sys; d=json.load(open('$f')); print(d.get('retryCount',0))" 2>/dev/null || echo "0")
  channel=$(python3 -c "import json,sys; d=json.load(open('$f')); print(d.get('channel','?'))" 2>/dev/null || echo "?")
  target=$(python3 -c "import json,sys; d=json.load(open('$f')); print(d.get('to','?'))" 2>/dev/null || echo "?")

  # Calculate age in days
  age_ms=$((now_ms - enqueued_ms))
  age_days=$((age_ms / 86400000))

  if [[ $age_days -ge $MAX_AGE_DAYS ]]; then
    # Log before removing
    timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    echo "[$timestamp] REMOVED stale message: file=$(basename "$f") age=${age_days}d channel=$channel target=$target error=\"$last_error\" retries=$retry_count" >> "$LOG_FILE"

    if [[ "$DRY_RUN" == "true" ]]; then
      echo "[dry-run] Would remove: $(basename "$f") (${age_days}d old, error: $last_error)"
    else
      rm -f "$f"
    fi
    cleaned=$((cleaned + 1))
  fi
done

echo "Delivery queue cleanup: $count total, $cleaned stale (>${MAX_AGE_DAYS}d), $(( count - cleaned )) kept"

if [[ $cleaned -gt 0 && "$DRY_RUN" != "true" ]]; then
  aiwh_notify "Delivery queue cleanup: removed $cleaned stale messages (>${MAX_AGE_DAYS}d old)" "systems"
fi
