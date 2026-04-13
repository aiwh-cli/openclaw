#!/bin/bash
source /opt/AIWH/core/scripts/lib/env.sh
# Watchdog - Health Monitor & Auto-Recovery
# Runs every 5 minutes via LaunchDaemon
# Checks OpenClaw gateway + agents, restarts if needed

WATCHDOG_LOG="/opt/AIWH/system/watchdog/health.log"
MAX_LOG_SIZE=1048576  # 1MB

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] WATCHDOG: $1" >> "$WATCHDOG_LOG"
}

# Rotate log if too large
if [ -f "$WATCHDOG_LOG" ] && [ $(stat -f%z "$WATCHDOG_LOG" 2>/dev/null || echo 0) -gt $MAX_LOG_SIZE ]; then
  mv "$WATCHDOG_LOG" "${WATCHDOG_LOG}.old"
  log "Log rotated"
fi

# Check if OpenClaw gateway is running
GATEWAY_PID=$(pgrep -f "openclaw.*gateway" 2>/dev/null)

if [ -z "$GATEWAY_PID" ]; then
  log "ERROR: OpenClaw gateway not running! Attempting restart..."
  
  # Try to restart via launchctl
  launchctl kickstart -k gui/$(id -u)/ai.openclaw.gateway 2>/dev/null
  sleep 5
  
  # Verify restart
  GATEWAY_PID=$(pgrep -f "openclaw.*gateway" 2>/dev/null)
  if [ -z "$GATEWAY_PID" ]; then
    log "CRITICAL: Gateway restart FAILED. Manual intervention needed."
    /usr/bin/osascript -e 'display notification "OpenClaw gateway crashed and could not restart!" with title "AIWH Alert"' 2>/dev/null
  else
    log "Gateway restarted successfully. PID: $GATEWAY_PID"
  fi
else
  log "OK: Gateway running (PID: $GATEWAY_PID)"
fi

# Check Tailscale connectivity
TS_STATUS=$(tailscale status --json 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('BackendState','unknown'))" 2>/dev/null)
if [ "$TS_STATUS" = "Running" ]; then
  log "OK: Tailscale connected"
else
  log "WARNING: Tailscale status: $TS_STATUS"
fi

# Check disk space
DISK_AVAIL=$(df -g / | tail -1 | awk '{print $4}')
if [ "$DISK_AVAIL" -lt 10 ]; then
  log "WARNING: Low disk space: ${DISK_AVAIL}GB remaining"
  /usr/bin/osascript -e "display notification \"Low disk space: ${DISK_AVAIL}GB remaining\" with title \"AIWH Alert\"" 2>/dev/null
fi
