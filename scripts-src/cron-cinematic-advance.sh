#!/bin/bash
# cron-cinematic-advance.sh — Zero-cost replacement for agent-based cinematic advance cron
# Runs cinematic-producer.py run-pending and logs results.
set -euo pipefail
source /opt/AIWH/core/scripts/lib/env.sh

LOG="${CLIENT_ROOT:-/opt/AIWH/client}/logs/cinematic-advance-cron.log"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"; }

log "Starting cinematic advance (run-pending)"

# Run pending cinematic jobs through automated phases
OUTPUT=$(python3 "$SCRIPT_DIR/cinematic-producer.py" run-pending 2>&1) || true
EXIT_CODE=$?

# Count results
ADVANCED=$(echo "$OUTPUT" | grep -c "Advanced\|Completed\|→" 2>/dev/null) || ADVANCED=0
FAILED=$(echo "$OUTPUT" | grep -c "ERROR\|Failed\|failed" 2>/dev/null) || FAILED=0
REVIEW=$(echo "$OUTPUT" | grep -c "review" 2>/dev/null) || REVIEW=0

log "Done (exit=$EXIT_CODE): advanced=$ADVANCED failed=$FAILED awaiting_review=$REVIEW"

# Log last few lines of output for debugging
echo "$OUTPUT" | tail -10 >> "$LOG"

if [[ "$FAILED" -gt 0 ]]; then
  # Post failure to Discord
  ERR_LINES=$(echo "$OUTPUT" | grep -i "error\|fail" | head -3 | tr '\n' '\\n')
  MSG="**Cinematic Advance Error**\n> ${FAILED} jobs failed during run-pending\n> ${ERR_LINES}"
  aiwh_notify "$MSG" "systems"
fi
