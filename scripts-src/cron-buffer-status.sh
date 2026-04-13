#!/bin/bash
# cron-buffer-status.sh — Zero-cost replacement for agent-based buffer check cron
# Runs buffer status check + urgency poll and posts Discord report.
set -euo pipefail
source /opt/AIWH/core/scripts/lib/env.sh

LOG="${CLIENT_ROOT:-/opt/AIWH/client}/logs/buffer-status-cron.log"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TODAY=$(TZ=Australia/Brisbane date '+%a %d %b %Y')

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"; }

log "Starting buffer status check"

# Run buffer check
BUFFER_OUT=$(bash "$SCRIPT_DIR/check-buffer-status.sh" 2>&1) || true

# Extract JSON from output
REPORT_JSON=$(echo "$BUFFER_OUT" | grep "^REPORT_JSON:" | sed 's/^REPORT_JSON://')

if [[ -z "$REPORT_JSON" ]]; then
  # Fallback: just report script ran
  MSG="**BUFFER STATUS CHECK** — ${TODAY}\n\n> Script ran but produced no structured output.\n> Check logs: $LOG"
  log "No REPORT_JSON in output"
else
  # Parse JSON fields
  POSTED=$(echo "$REPORT_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('confirmed_posted',[])))") 2>/dev/null || echo "?"
  PENDING=$(echo "$REPORT_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('still_pending',[])))") 2>/dev/null || echo "?"
  ERRORS=$(echo "$REPORT_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('errors',[])))") 2>/dev/null || echo "?"
  TOTAL=$(echo "$REPORT_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('stats',{}).get('total_posted_all_time','?'))") 2>/dev/null || echo "?"
  IN_PIPE=$(echo "$REPORT_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('stats',{}).get('in_pipeline','?'))") 2>/dev/null || echo "?"

  MSG="**BUFFER STATUS CHECK** — ${TODAY}\n\n**Newly Confirmed Posted** (${POSTED})\n**Still Pending** (${PENDING})\n**Errors** (${ERRORS})\n\n**Pipeline Summary**\n> Total posted (all time): ${TOTAL}\n> In pipeline: ${IN_PIPE}"
  log "Posted=$POSTED Pending=$PENDING Errors=$ERRORS"
fi

# Run urgency poll
URGENCY_OUT=$(bash "$SCRIPT_DIR/video-urgency-poll.sh" 2>&1) || true
URGENCY_SUMMARY=$(echo "$URGENCY_OUT" | tail -3 | tr '\n' ' ')
if [[ -n "$URGENCY_SUMMARY" ]]; then
  MSG="${MSG}\n\n**Urgency Poll**: ${URGENCY_SUMMARY}"
fi

aiwh_notify "$MSG" "publish"
log "Discord notified"
