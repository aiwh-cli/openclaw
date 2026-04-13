#!/bin/bash
# Checks cron job health by verifying last-run timestamps
# Output: $CLIENT_ROOT/logs/cron-health.txt
# Format: OK|MISSED job_name last_run_timestamp

OUTPUT="${CLIENT_ROOT:-/opt/AIWH/client}/logs/cron-health.txt"
MAX_AGE_DAILY=90000    # 25 hours in seconds (daily jobs)
MAX_AGE_WEEKLY=650000  # ~7.5 days in seconds (weekly jobs)
NOW=$(date +%s)

> "$OUTPUT"

# Check backup (daily, should run by 23:30)
LATEST_BACKUP=$(ls -t /opt/AIWH/core/.backups/*.tar.gz 2>/dev/null | head -1)
if [ -n "$LATEST_BACKUP" ]; then
    BACKUP_AGE=$(( NOW - $(stat -f%m "$LATEST_BACKUP" 2>/dev/null || echo "$NOW") ))
    if [ "$BACKUP_AGE" -gt "$MAX_AGE_DAILY" ]; then
        echo "MISSED backup $(date -r $(stat -f%m "$LATEST_BACKUP") '+%Y-%m-%d %H:%M' 2>/dev/null || echo 'unknown')" >> "$OUTPUT"
    else
        echo "OK backup $(date -r $(stat -f%m "$LATEST_BACKUP") '+%Y-%m-%d %H:%M' 2>/dev/null)" >> "$OUTPUT"
    fi
else
    echo "MISSED backup never" >> "$OUTPUT"
fi

# Check knowledge extraction (daily, should run by 23:00)
# Primary: nightly-knowledge-pipeline.log (current pipeline as of 2026-03-01)
# Fallback: knowledge-extract.log (legacy — no longer written to)
KE_LOG="${CLIENT_ROOT:-/opt/AIWH/client}/logs/nightly-knowledge-pipeline.log"
if [ -f "$KE_LOG" ]; then
    KE_AGE=$(( NOW - $(stat -f%m "$KE_LOG") ))
    if [ "$KE_AGE" -gt "$MAX_AGE_DAILY" ]; then
        echo "MISSED knowledge-extract $(date -r $(stat -f%m "$KE_LOG") '+%Y-%m-%d %H:%M')" >> "$OUTPUT"
    else
        echo "OK knowledge-extract $(date -r $(stat -f%m "$KE_LOG") '+%Y-%m-%d %H:%M')" >> "$OUTPUT"
    fi
else
    echo "MISSED knowledge-extract never" >> "$OUTPUT"
fi

# Check cleanup (weekly, Sundays)
# Check dashboard script-scheduler DB for cleanup-check or media-cleanup last run
DB="/opt/AIWH/core/dashboard/mission-control.db"
CL_TS=0
if [ -f "$DB" ]; then
    # Get most recent cleanup run timestamp from script_cron_runs
    CL_DATE=$(sqlite3 "$DB" "SELECT started_at FROM script_cron_runs WHERE cron_id IN (SELECT id FROM script_crons WHERE name LIKE '%cleanup%') AND status='ok' ORDER BY started_at DESC LIMIT 1;" 2>/dev/null || echo "")
    if [ -n "$CL_DATE" ]; then
        CL_TS=$(date -jf "%Y-%m-%dT%H:%M:%S" "${CL_DATE%%.*}" "+%s" 2>/dev/null || echo "0")
    fi
fi
CL_AGE=$(( NOW - CL_TS ))
if [ "$CL_AGE" -gt "$MAX_AGE_WEEKLY" ]; then
    echo "MISSED cleanup $(date -r "$CL_TS" '+%Y-%m-%d %H:%M' 2>/dev/null || echo 'unknown')" >> "$OUTPUT"
else
    echo "OK cleanup $(date -r "$CL_TS" '+%Y-%m-%d %H:%M' 2>/dev/null || echo 'recent')" >> "$OUTPUT"
fi
