#!/bin/bash
# Morning Briefing — Posts daily status to #ceo-briefing at 08:00 AEST
# Executed by OpenClaw cron; directly posts to Discord via sessions_send
# REAL DATA: Reads from mission-control.db, cost tracking, and actual system logs

# Ensure proper PATH for cron execution (includes homebrew binaries)
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
DB_FILE="/opt/AIWH/core/dashboard/mission-control.db"
LOG_DIR="${CLIENT_ROOT:-/opt/AIWH/client}/logs"
LOG_FILE="$LOG_DIR/morning-briefing.log"
TODAY=$(date '+%d %b')  # Format like "24 Feb"

# ============================================================================
# 1. COUNT TASKS BY STATUS (from mission-control.db)
# ============================================================================

ACTIVE_COUNT=$(sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM tasks WHERE status IN ('in_progress','planned','review');" 2>/dev/null || echo "0")
BLOCKED_COUNT=$(sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM tasks WHERE status='blocked';" 2>/dev/null || echo "0")

# ============================================================================
# 2. COUNT COMPLETED TASKS (done status)
# ============================================================================
DONE_TODAY=$(sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM tasks WHERE status='done';" 2>/dev/null || echo "0")

# ============================================================================
# 3. GET BUDGET STATUS (real-time from JSONL session files)
# ============================================================================
TOTAL="5.00"
SPENT=$(python3 - <<'PYEOF'
import os, json, glob
from datetime import datetime, timezone, timedelta

now_utc = datetime.now(timezone.utc)
aest_offset = timedelta(hours=10)
now_aest = now_utc + aest_offset
today_start_aest = now_aest.replace(hour=0, minute=0, second=0, microsecond=0)
today_start_utc = today_start_aest - aest_offset
today_end_utc = today_start_utc + timedelta(days=1)
start_str = today_start_utc.strftime('%Y-%m-%dT%H:%M:%S')
end_str = today_end_utc.strftime('%Y-%m-%dT%H:%M:%S')

total = 0.0
for fp in glob.glob('/opt/AIWH/.openclaw/agents/*/sessions/*.jsonl*'):
    if '.lock' in fp: continue
    try:
        with open(fp) as f:
            for line in f:
                if '"usage"' not in line: continue
                d = json.loads(line)
                ts = d.get('timestamp','')
                if ts < start_str or ts >= end_str: continue
                msg = d.get('message',{})
                if msg.get('role') == 'assistant' and 'usage' in msg:
                    c = msg['usage'].get('cost',{}).get('total',0)
                    if isinstance(c,(int,float)): total += c
    except: continue
print(f"{total:.2f}")
PYEOF
)
REMAINING=$(python3 -c "print(f'{max(0, 5.00 - float(\"$SPENT\")):.2f}')")

# ============================================================================
# 4. SYSTEM HEALTH CHECKS (actual checks, not static strings)
# ============================================================================

# Backup: Check if backup-snapshot.log has recent successful run
BACKUP_STATUS="⏳"
BACKUP_MSG="No recent backup"
if [ -f "$LOG_DIR/backup-snapshot.log" ]; then
    LAST_BACKUP=$(tail -1 "$LOG_DIR/backup-snapshot.log" 2>/dev/null)
    if echo "$LAST_BACKUP" | grep -qi "snapshot created\|success\|complete"; then
        BACKUP_STATUS="✅"
        BACKUP_MSG="Last backup: $(echo "$LAST_BACKUP" | cut -d' ' -f1-3 || echo 'recent')"
    fi
fi

# Cleanup: Check cleanup-cron.log for last Sunday run
CLEANUP_STATUS="⏳"
CLEANUP_MSG="No recent cleanup"
if [ -f "$LOG_DIR/cleanup-cron.log" ]; then
    LAST_CLEANUP=$(tail -1 "$LOG_DIR/cleanup-cron.log" 2>/dev/null)
    if echo "$LAST_CLEANUP" | grep -qi "complete\|success"; then
        CLEANUP_STATUS="✅"
        CLEANUP_MSG="Cleanup: $(echo "$LAST_CLEANUP" | cut -d' ' -f1-3 || echo 'recent')"
    fi
fi

# Extraction: Check knowledge-extract.log for last 23:00 run
EXTRACTION_STATUS="⏳"
EXTRACTION_MSG="No recent extraction"
if [ -f "$LOG_DIR/knowledge-extract.log" ]; then
    LAST_EXTRACT=$(tail -1 "$LOG_DIR/knowledge-extract.log" 2>/dev/null)
    if echo "$LAST_EXTRACT" | grep -qi "extracted\|success\|complete"; then
        EXTRACTION_STATUS="✅"
        EXTRACTION_MSG="Extraction: $(echo "$LAST_EXTRACT" | cut -d' ' -f1-3 || echo 'recent')"
    fi
fi

# Gateway: Run `openclaw gateway status` and check for operational status
GATEWAY_STATUS="✅"
GATEWAY_MSG="Operational"
if command -v openclaw &> /dev/null; then
    GW_OUTPUT=$(openclaw gateway status 2>&1)
    if echo "$GW_OUTPUT" | grep -qi "operational\|running\|active"; then
        GATEWAY_STATUS="✅"
        GATEWAY_MSG="$(echo "$GW_OUTPUT" | head -1 | cut -d' ' -f1-3 || echo 'Operational')"
    else
        GATEWAY_STATUS="⏳"
        GATEWAY_MSG="$(echo "$GW_OUTPUT" | head -1 || echo 'Check manually')"
    fi
else
    GATEWAY_STATUS="⏳"
    GATEWAY_MSG="openclaw CLI not available"
fi

# ============================================================================
# 5. FORMAT DISCORD MESSAGE WITH REAL DATA
# ============================================================================
MESSAGE="🌅 **MORNING BRIEFING** — $(date '+%A, %B %d, %Y')

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 **TASK STATUS**
🟢 ACTIVE: $ACTIVE_COUNT tasks in progress
🔴 BLOCKED: $BLOCKED_COUNT tasks
✅ COMPLETED TODAY: $DONE_TODAY

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚡ **TODAY'S ACTIONS**
• See #task-ledger for active tasks
• See #approvals-deploy for blockers requiring approval
• See #product-hq for website status
• See #growth-hq for copy/avatar progress

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

💰 **DAILY BUDGET**
Limit: \$$TOTAL
Spent: \$$SPENT
Remaining: \$$REMAINING

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚙️ **SYSTEM HEALTH**
$BACKUP_STATUS Backup (23:30): $BACKUP_MSG
$CLEANUP_STATUS Cleanup (Sundays 06:00): $CLEANUP_MSG
$EXTRACTION_STATUS Extraction (23:00): $EXTRACTION_MSG
$GATEWAY_STATUS Gateway: $GATEWAY_MSG

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ============================================================================
# 6. LOG AND OUTPUT
# ============================================================================

# Log the briefing with timestamp
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Morning briefing generated" >> "$LOG_FILE"
echo "─────────────────────────────────────────────────────────────" >> "$LOG_FILE"
echo "Active: $ACTIVE_COUNT | Blocked: $BLOCKED_COUNT | Completed Today: $DONE_TODAY" >> "$LOG_FILE"
echo "Budget: Spent $SPENT of $TOTAL | Remaining: $REMAINING" >> "$LOG_FILE"
echo "Gateway: $GATEWAY_STATUS | Backup: $BACKUP_STATUS | Extraction: $EXTRACTION_STATUS" >> "$LOG_FILE"
echo "" >> "$LOG_FILE"

# Post to Discord #ceo-briefing
openclaw message send --channel discord --target 1474184891015893142 --message "$MESSAGE" 2>/dev/null || echo "[$(date '+%Y-%m-%d %H:%M:%S')] WARN: Discord send failed" >> "$LOG_FILE"

# Also output to stdout for logging
echo "$MESSAGE"

exit 0
