#!/bin/bash

# Daily Cost Monitor — Scans all agent sessions for daily spend
# Alerts on Discord if daily total >= $4.50
# Logs to $CLIENT_ROOT/logs/cost-monitor.log
# Run every 5 minutes via crontab

set -euo pipefail
source /opt/AIWH/core/scripts/lib/env.sh

SESSIONS_DIR="/opt/AIWH/.openclaw/agents"
LOG_DIR="${CLIENT_ROOT:-/opt/AIWH/client}/logs"
ALERT_FLAG="/tmp/aiwh-cost-alert-$(date +%Y-%m-%d)"
BUDGET_FILE="/opt/AIWH/core/config/budget.json"
if [ -f "$BUDGET_FILE" ]; then
  DAILY_LIMIT=$(python3 -c "import json; d=json.load(open('$BUDGET_FILE')); print(d.get('daily_budget', 5.00))")
  WARN_PCT=$(python3 -c "import json; d=json.load(open('$BUDGET_FILE')); print(d.get('warn_threshold_pct', 0.90))")
  THRESHOLD=$(echo "$DAILY_LIMIT * $WARN_PCT" | bc -l)
else
  THRESHOLD=4.50
  DAILY_LIMIT=5.00
fi
DISCORD_CHANNEL="1474185278364188775"

# Ensure log directory exists
mkdir -p "$LOG_DIR"

# Run Python script to calculate daily spend
SPEND=$(python3 - <<'EOF'
import os
import json
import glob
from datetime import datetime, timezone, timedelta

# AEST = UTC+10
# Today in AEST: starts at previous day 14:00 UTC, ends at current day 13:59:59 UTC
now_utc = datetime.now(timezone.utc)
aest_start = now_utc.replace(hour=14, minute=0, second=0, microsecond=0) - timedelta(days=1)
aest_end = aest_start + timedelta(days=1) - timedelta(seconds=1)

total_cost = 0.0

# Scan all agent session files
sessions_glob = "/opt/AIWH/.openclaw/agents/*/sessions/*.jsonl*"
for filepath in glob.glob(sessions_glob):
    try:
        with open(filepath, 'r') as f:
            for line in f:
                if not line.strip():
                    continue
                try:
                    entry = json.loads(line)
                    msg = entry.get('message', {})
                    
                    # Only process assistant messages with usage data
                    if msg.get('role') != 'assistant' or 'usage' not in msg:
                        continue
                    
                    # Parse timestamp from entry
                    ts_str = entry.get('timestamp')
                    if not ts_str:
                        continue
                    
                    # Handle ISO format timestamps
                    try:
                        if 'Z' in ts_str:
                            ts = datetime.fromisoformat(ts_str.replace('Z', '+00:00'))
                        else:
                            ts = datetime.fromisoformat(ts_str)
                    except:
                        continue
                    
                    # Ensure timezone aware
                    if ts.tzinfo is None:
                        ts = ts.replace(tzinfo=timezone.utc)
                    
                    # Check if within today's AEST window
                    if aest_start <= ts <= aest_end:
                        cost = msg.get('usage', {}).get('cost', {}).get('total', 0)
                        if isinstance(cost, (int, float)):
                            total_cost += float(cost)
                except json.JSONDecodeError:
                    continue
                except Exception:
                    continue
    except Exception:
        continue


# Also include cinematic producer costs from ledger
ledger_path = os.environ.get("CLIENT_ROOT", "/opt/AIWH/client") + "/logs/cinematic-costs.jsonl"
if os.path.exists(ledger_path):
    today_str = (now_utc + timedelta(hours=10)).strftime("%Y-%m-%d")
    with open(ledger_path) as lf:
        for line in lf:
            try:
                e = json.loads(line)
                if e.get("date") == today_str:
                    total_cost += float(e.get("cost_usd", 0))
            except:
                continue

print(f"{total_cost:.4f}")
EOF
)

# Format spend for output
SPEND_FORMATTED=$(printf "%.2f" "$SPEND")
REMAINING=$(python3 -c "print(f'{max(0, 5.00 - $SPEND):.2f}')")

# Write to log
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Daily spend: \$$SPEND_FORMATTED / \$$DAILY_LIMIT (remaining: \$$REMAINING)" >> "$LOG_DIR/cost-monitor.log"

# Alert on Discord if threshold exceeded and not already alerted today
# Uses webhook directly — openclaw CLI not reliable in cron PATH
if (( $(echo "$SPEND >= $THRESHOLD" | bc -l) )) && [ ! -f "$ALERT_FLAG" ]; then
    MESSAGE="⚠️ DAILY SPEND ALERT: \$$SPEND_FORMATTED / \$$DAILY_LIMIT limit reached. Remaining: \$$REMAINING"
    aiwh_notify "$MESSAGE" "spend"
    touch "$ALERT_FLAG"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ALERT: Sent Discord notification for spend: \$$SPEND_FORMATTED" >> "$LOG_DIR/cost-monitor.log"
fi

# Always output to stdout for logging
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Daily spend: \$$SPEND_FORMATTED / \$$DAILY_LIMIT (remaining: \$$REMAINING)"
