#!/bin/bash
# AIWH Heartbeat — system health check + fleet reporting
# Runs every 8 hours via LaunchDaemon
source /opt/AIWH/core/scripts/lib/env.sh

set -e

CLIENT_DIR="${CLIENT_ROOT:-/opt/AIWH/client}"
AIWH_ROOT="/opt/AIWH"
HEALTH_FILE="$CLIENT_DIR/logs/health.json"
LOG_FILE="$CLIENT_DIR/logs/heartbeat.log"
mkdir -p "$(dirname "$LOG_FILE")" "$(dirname "$HEALTH_FILE")"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"; }
log "=== HEARTBEAT START ==="

# ── Gather health data ───────────────────────────────────────

# Version
VERSION=$(cd "$AIWH_ROOT" && git describe --tags 2>/dev/null || git rev-parse --short HEAD 2>/dev/null || echo "unknown")
OC_VERSION=$(openclaw --version 2>/dev/null | head -1 || echo "unknown")

# Client ID
CLIENT_ID="unknown"
if [[ -f "$AIWH_ROOT/core/config/license.json" ]]; then
  CLIENT_ID=$(python3 -c "import json; print(json.load(open('$AIWH_ROOT/core/config/license.json')).get('client_id','unknown'))" 2>/dev/null || echo "unknown")
fi

# Dashboard status
DASHBOARD="down"
if curl -sf http://localhost:3001/api/auth/status > /dev/null 2>&1; then
  DASHBOARD="running"
fi

# Gateway status
GATEWAY="down"
if pgrep -f "openclaw.*gateway" > /dev/null 2>&1; then
  GATEWAY="running"
fi

# Disk
DISK_FREE_GB=$(df / | tail -1 | awk '{printf "%.1f", $4/1048576}')
DISK_USED_PCT=$(df / | tail -1 | awk '{print $5}')

# Tailscale
TAILSCALE_STATUS=$(tailscale status --json 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('BackendState','unknown'))" 2>/dev/null || echo "not installed")
TAILSCALE_IP=$(tailscale ip -4 2>/dev/null || echo "none")

# Modules
MODULES_ACTIVE="[]"
if [[ -f "$AIWH_ROOT/core/config/license.json" ]]; then
  MODULES_ACTIVE=$(python3 -c "import json; print(json.dumps(json.load(open('$AIWH_ROOT/core/config/license.json')).get('modules_active',[])))" 2>/dev/null || echo "[]")
fi

# Uptime
UPTIME_HOURS=$(python3 -c "import subprocess,re; out=subprocess.check_output(['uptime']).decode(); m=re.search(r'up\s+(\d+)\s+day',out); d=int(m.group(1)) if m else 0; m2=re.search(r'(\d+):(\d+)',out); h=int(m2.group(1))+d*24 if m2 else d*24; print(h)" 2>/dev/null || echo "0")

# Recent errors (count error lines in last 24h across agent logs)
ERRORS_24H=0
if [[ -d "$CLIENT_DIR/logs" ]]; then
  ERRORS_24H=$(find "$CLIENT_DIR/logs" -name "*.log" -mtime -1 -exec grep -ci "ERROR\|FAIL\|FATAL" {} \; 2>/dev/null | awk '{s+=$1} END {print s+0}')
fi

# Last successful cron
LAST_CRON=""
if [[ -f "$CLIENT_DIR/logs/video-publisher-agent.log" ]]; then
  LAST_CRON=$(grep "RUN END" "$CLIENT_DIR/logs/video-publisher-agent.log" 2>/dev/null | tail -1 | grep -o '[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}T[0-9:]*Z' || echo "")
fi

# ── Write health file ────────────────────────────────────────

python3 -c "
import json, datetime
health = {
    'client_id': '$CLIENT_ID',
    'version': '$VERSION',
    'openclaw_version': '$OC_VERSION',
    'dashboard': '$DASHBOARD',
    'gateway': '$GATEWAY',
    'disk_free_gb': float('$DISK_FREE_GB'),
    'disk_used_pct': '$DISK_USED_PCT',
    'uptime_hours': int('$UPTIME_HOURS'),
    'tailscale': '$TAILSCALE_STATUS',
    'tailscale_ip': '$TAILSCALE_IP',
    'modules_active': $MODULES_ACTIVE,
    'errors_24h': int('$ERRORS_24H'),
    'last_cron_success': '$LAST_CRON' or None,
    'reported_at': datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00', 'Z'),
}
json.dump(health, open('$HEALTH_FILE', 'w'), indent=2)
print(json.dumps(health, indent=2))
"

log "Health: dashboard=$DASHBOARD gateway=$GATEWAY disk=$DISK_USED_PCT errors=$ERRORS_24H"

# ── License validation + phone-home (Theme AB.2.8) ──────────

REG_FILE="$CLIENT_DIR/config/device-registration.json"

# Check license expiry
VALID_UNTIL=""
if [[ -f "$AIWH_ROOT/core/config/license.json" ]]; then
  VALID_UNTIL=$(python3 -c "import json; print(json.load(open('$AIWH_ROOT/core/config/license.json')).get('valid_until',''))" 2>/dev/null || echo "")
  if [[ -n "$VALID_UNTIL" ]]; then
    DAYS_LEFT=$(python3 -c "
import datetime
vu = datetime.datetime.fromisoformat('$VALID_UNTIL'.replace('Z','+00:00'))
now = datetime.datetime.now(datetime.timezone.utc)
print(max(0, (vu - now).days))
" 2>/dev/null || echo "999")
    if [[ "$DAYS_LEFT" -eq 0 ]]; then
      log "  ⚠ LICENSE EXPIRED"
    elif [[ "$DAYS_LEFT" -le 30 ]]; then
      log "  ⚠ License expiring in ${DAYS_LEFT} days"
    fi
  fi
fi

# Phone-home (if heartbeat URL configured)
HEARTBEAT_URL=$(python3 -c "import json; print(json.load(open('$AIWH_ROOT/core/config/license.json')).get('heartbeat_url',''))" 2>/dev/null || echo "")
HW_FINGERPRINT=$(python3 -c "import json,os; f='$REG_FILE'; print(json.load(open(f)).get('hardware_fingerprint','unknown') if os.path.exists(f) else 'unknown')" 2>/dev/null || echo "unknown")
CC_ACTIVE=$(python3 -c "import json; print(json.dumps(json.load(open('$AIWH_ROOT/core/config/license.json')).get('command_centres_active',[])))" 2>/dev/null || echo "[]")

if [[ -n "$HEARTBEAT_URL" ]]; then
  PAYLOAD="{\"fingerprint\":\"$HW_FINGERPRINT\",\"version\":\"$VERSION\",\"command_centres\":$CC_ACTIVE,\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}"
  HTTP_CODE=$(curl -sf -o /dev/null -w "%{http_code}" -X POST "$HEARTBEAT_URL" \
    -H "Content-Type: application/json" -d "$PAYLOAD" --connect-timeout 10 --max-time 30 2>/dev/null || echo "000")

  if [[ "$HTTP_CODE" =~ ^2 ]]; then
    log "  Heartbeat phone-home: OK ($HTTP_CODE)"
    # Reset failure counter
    python3 -c "
import json,os,datetime
f='$REG_FILE'; reg = json.load(open(f)) if os.path.exists(f) else {}
reg['last_heartbeat'] = datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00','Z')
reg['consecutive_failures'] = 0
reg['degraded_mode'] = False
json.dump(reg, open(f,'w'), indent=2)
"
  else
    log "  Heartbeat phone-home: FAILED ($HTTP_CODE)"
    # Increment failure counter
    python3 -c "
import json,os
f='$REG_FILE'; reg = json.load(open(f)) if os.path.exists(f) else {}
fails = reg.get('consecutive_failures', 0) + 1
reg['consecutive_failures'] = fails
if fails >= 30: reg['degraded_mode'] = True
json.dump(reg, open(f,'w'), indent=2)
print(f'Consecutive failures: {fails}' + (' — DEGRADED MODE' if fails >= 30 else ''))
"
  fi
else
  log "  Phone-home: skipped (no heartbeat_url in license.json)"
fi

log "=== HEARTBEAT END ==="
