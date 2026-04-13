#!/bin/bash
# Nightly Summary — Posts daily task/system summary to Discord
# Runs at 23:00 AEST — reads from mission-control.db (source of truth for tasks)

# Ensure proper PATH for cron execution (includes homebrew binaries)
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
DB_FILE="/opt/AIWH/core/dashboard/mission-control.db"
CONTEXT_FILE="${CLIENT_ROOT:-/opt/AIWH/client}/CONTEXT.md"
LOG_DIR="${CLIENT_ROOT:-/opt/AIWH/client}/logs"
MEMORY_FILE="/opt/AIWH/core/memory/$(date '+%Y-%m-%d').md"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting nightly summary generation..."

# Count current statuses from mission-control.db
ACTIVE=$(sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM tasks WHERE status IN ('in_progress','planned','review');" 2>/dev/null || echo "0")
DONE=$(sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM tasks WHERE status='done';" 2>/dev/null || echo "0")
BLOCKED=$(sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM tasks WHERE status='blocked';" 2>/dev/null || echo "0")

# Step 2: Append nightly note to CONTEXT.md
cat >> "$CONTEXT_FILE" << EOF

## Nightly Update ($(date '+%Y-%m-%d %H:%M:%S'))

**Tasks Summary:**
- Active: $ACTIVE
- Completed: $DONE
- Blocked: $BLOCKED

**Cron Health:**
- Backup: $([ -f "$LOG_DIR/backup-snapshot.log" ] && (tail -1 "$LOG_DIR/backup-snapshot.log" | grep -qi "success\|created\|complete" && echo "✅" || echo "⏳") || echo "⏳")
- Cleanup: $([ -f "$LOG_DIR/cleanup-cron.log" ] && (tail -1 "$LOG_DIR/cleanup-cron.log" | grep -qi "complete\|success" && echo "✅" || echo "⏳") || echo "⏳")
- Extraction: $([ -f "$LOG_DIR/knowledge-extract.log" ] && (tail -1 "$LOG_DIR/knowledge-extract.log" | grep -qi "extracted\|success\|complete" && echo "✅" || echo "⏳") || echo "⏳")

**Discord Updates Posted:**
- Morning briefing: #ceo-briefing
- Task status changes: #task-ledger
- System events: #systems-bay

**Next Actions:**
Review tomorrow morning at 08:00 AEST.

---
EOF

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Nightly summary complete"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Nightly summary complete — task counts from mission-control.db"

# Post summary to Discord #systems-bay
SUMMARY="📋 **Nightly Summary** ($(date '+%d %b %Y'))
Active: $ACTIVE | Completed: $DONE | Blocked: $BLOCKED
Source: mission-control.db"
openclaw message send --channel discord --target 1474185560393257107 --message "$SUMMARY" 2>/dev/null || echo "[$(date '+%Y-%m-%d %H:%M:%S')] WARN: Discord send failed" >> $LOG_DIR/nightly-summary.log

# Log completion
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Nightly summary generated" >> $LOG_DIR/nightly-summary.log
