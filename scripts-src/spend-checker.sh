#!/bin/bash
# Reads OpenClaw session JSONL files and outputs simple spend status
# Output: $CLIENT_ROOT/logs/spend-status.txt
# Uses same calculation as daily-cost-monitor.sh

BUDGET_FILE="/opt/AIWH/core/config/budget.json"
if [ -f "$BUDGET_FILE" ]; then
  WARN_THRESHOLD=$(python3 -c "import json; d=json.load(open('$BUDGET_FILE')); print(d.get('tiers',{}).get('warn', 4.00))")
  CRITICAL_THRESHOLD=$(python3 -c "import json; d=json.load(open('$BUDGET_FILE')); print(d.get('tiers',{}).get('soft_limit', 5.00))")
  HAIKU_THRESHOLD=$(python3 -c "import json; d=json.load(open('$BUDGET_FILE')); print(d.get('tiers',{}).get('haiku_only', 7.50))")
  SHUTOFF_THRESHOLD=$(python3 -c "import json; d=json.load(open('$BUDGET_FILE')); print(d.get('tiers',{}).get('shutoff', 10.00))")
else
  WARN_THRESHOLD=4.00
  CRITICAL_THRESHOLD=5.00
  HAIKU_THRESHOLD=7.50
  SHUTOFF_THRESHOLD=10.00
fi
OUTPUT="${CLIENT_ROOT:-/opt/AIWH/client}/logs/spend-status.txt"

SPEND=$(python3 - <<'PYEOF'
import os, json, glob
from datetime import datetime, timezone, timedelta

now_utc = datetime.now(timezone.utc)
aest_offset = timedelta(hours=10)
now_aest = now_utc + aest_offset
today_aest_start = now_aest.replace(hour=0, minute=0, second=0, microsecond=0) - aest_offset
today_aest_end = today_aest_start + timedelta(days=1) - timedelta(seconds=1)

total_cost = 0.0
for filepath in glob.glob("/opt/AIWH/.openclaw/agents/*/sessions/*.jsonl*"):
    try:
        with open(filepath, 'r') as f:
            for line in f:
                if not line.strip():
                    continue
                try:
                    entry = json.loads(line)
                    msg = entry.get('message', {})
                    if msg.get('role') != 'assistant' or 'usage' not in msg:
                        continue
                    ts_str = entry.get('timestamp')
                    if not ts_str:
                        continue
                    try:
                        ts = datetime.fromisoformat(ts_str.replace('Z', '+00:00'))
                    except:
                        continue
                    if ts.tzinfo is None:
                        ts = ts.replace(tzinfo=timezone.utc)
                    if today_aest_start <= ts <= today_aest_end:
                        cost = msg.get('usage', {}).get('cost', {}).get('total', 0)
                        if isinstance(cost, (int, float)):
                            total_cost += float(cost)
                except:
                    continue
    except:
        continue
print(f"{total_cost:.4f}")
PYEOF
)

SPEND_FMT=$(printf "%.2f" "$SPEND")

if (( $(echo "$SPEND >= $SHUTOFF_THRESHOLD" | bc -l) )); then
    echo "SHUTOFF $SPEND_FMT" > "$OUTPUT"
elif (( $(echo "$SPEND >= $HAIKU_THRESHOLD" | bc -l) )); then
    echo "HAIKU_ONLY $SPEND_FMT" > "$OUTPUT"
elif (( $(echo "$SPEND >= $CRITICAL_THRESHOLD" | bc -l) )); then
    echo "CRITICAL $SPEND_FMT" > "$OUTPUT"
elif (( $(echo "$SPEND >= $WARN_THRESHOLD" | bc -l) )); then
    echo "WARN $SPEND_FMT" > "$OUTPUT"
else
    echo "OK $SPEND_FMT" > "$OUTPUT"
fi

# Write to cost-monitor log only when status changes or every 5 min (not every 10s)
BUDGET_FMT=$(printf "%.2f" "$CRITICAL_THRESHOLD")
COST_LOG="${CLIENT_ROOT:-/opt/AIWH/client}/logs/cost-monitor.log"
PREV_STATUS=$(cat "${OUTPUT}.prev" 2>/dev/null || echo "")
CURRENT_STATUS=$(cat "$OUTPUT" | awk '{print $1}')
MINUTE=$(date +%M)

if [[ "$CURRENT_STATUS" != "$PREV_STATUS" ]] || [[ "$((10#$MINUTE % 5))" -eq 0 && "$(date +%S)" -lt 15 ]]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Daily spend: \$$SPEND_FMT / \$$BUDGET_FMT ($CURRENT_STATUS)" >> "$COST_LOG"
  echo "$CURRENT_STATUS" > "${OUTPUT}.prev"
fi
