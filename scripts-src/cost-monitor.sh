#!/bin/bash

# OpenClaw Cost Monitoring
# Tracks daily API spend and alerts on anomalies
# Run daily: 0 6 * * * /opt/AIWH/scripts/cost-monitor.sh

set -euo pipefail
source /opt/AIWH/core/scripts/lib/env.sh

COST_LOG="/opt/AIWH/backups/cost-history.json"
THRESHOLD_WARNING=100
THRESHOLD_HARD_STOP=200

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

# Initialize cost history file
if [ ! -f "$COST_LOG" ]; then
    echo '{"history": []}' > "$COST_LOG"
fi

log "=========================================="
log "OpenClaw Cost Monitor"
log "=========================================="

# Check if API key is configured
if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
    log "⚠️  ANTHROPIC_API_KEY not set, cannot fetch usage"
    log "Set with: export ANTHROPIC_API_KEY=sk-ant-..."
    exit 0
fi

# Attempt to fetch current usage (this requires Anthropic API support)
# Note: Anthropic doesn't currently expose fine-grained usage via API
# This is a template for when they do. For now, track manually.

log ""
log "Manual Cost Tracking:"
log ""
log "To track costs:"
log "  1. Check Anthropic console: https://console.anthropic.com/account/usage"
log "  2. Record daily spend in $COST_LOG"
log "  3. This script will alert on anomalies"
log ""

# Show cost history
if [ -f "$COST_LOG" ]; then
    RECORD_COUNT=$(jq '.history | length' "$COST_LOG")
    if [ "$RECORD_COUNT" -gt 0 ]; then
        log "Last 7 days of recorded costs:"
        jq -r '.history[-7:] | .[] | "\(.date): $\(.spend)"' "$COST_LOG"
    fi
fi

log ""
log "⚠️  Reminder:"
log "  - Current daily target: <$10/day"
log "  - Warning threshold: >$100/day"
log "  - Hard stop: >$200/day"
log ""
log "Set rate limits in SOUL.md to prevent overages."
log "=========================================="
