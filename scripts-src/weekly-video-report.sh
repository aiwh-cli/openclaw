#!/usr/bin/env bash
set -euo pipefail
source /opt/AIWH/core/scripts/lib/env.sh
# Weekly Video Pipeline Performance Report

DB="${CLIENT_ROOT:-/opt/AIWH/client}/data/video-jobs.db"
REPORT_FILE="${CLIENT_ROOT:-/opt/AIWH/client}/logs/weekly-video-report.txt"
SEVEN_DAYS_AGO=$(date -u -v-7d '+%Y-%m-%dT00:00:00Z' 2>/dev/null || date -u -d '7 days ago' '+%Y-%m-%dT00:00:00Z')

TOTAL_CREATED=$(sqlite3 "$DB" "SELECT COUNT(*) FROM video_jobs WHERE created_at >= '$SEVEN_DAYS_AGO';")
SCHEDULED=$(sqlite3 "$DB" "SELECT COUNT(*) FROM video_jobs WHERE status IN ('scheduled','posted') AND created_at >= '$SEVEN_DAYS_AGO';")
FAILED=$(sqlite3 "$DB" "SELECT COUNT(*) FROM video_jobs WHERE status IN ('voice_failed','avatar_failed','avatar_timeout','caption_failed','qa_failed','script_too_long','rejected') AND created_at >= '$SEVEN_DAYS_AGO';")
POSTED=$(sqlite3 "$DB" "SELECT COUNT(*) FROM video_jobs WHERE status='posted' AND created_at >= '$SEVEN_DAYS_AGO';")

STATUS_BREAKDOWN=$(sqlite3 -separator ' → ' "$DB" "SELECT status, COUNT(*) FROM video_jobs WHERE created_at >= '$SEVEN_DAYS_AGO' GROUP BY status ORDER BY COUNT(*) DESC;")

AVG_PIPELINE_HOURS=$(sqlite3 "$DB" "
  SELECT COALESCE(ROUND(AVG((julianday(updated_at) - julianday(created_at)) * 24), 1), 0)
  FROM video_jobs
  WHERE status IN ('scheduled','posted','approved','qa_passed')
    AND created_at >= '$SEVEN_DAYS_AGO';")

PILLAR_DIST=$(sqlite3 -separator ': ' "$DB" "SELECT COALESCE(pillar,'unset'), COUNT(*) FROM video_jobs WHERE created_at >= '$SEVEN_DAYS_AGO' GROUP BY pillar ORDER BY COUNT(*) DESC;")

QUEUE_DEPTH=$(sqlite3 "$DB" "SELECT COUNT(*) FROM video_jobs WHERE status NOT IN ('posted','rejected','voice_failed','avatar_failed','avatar_timeout','caption_failed','qa_failed','script_too_long');")

WEEK_END=$(date '+%Y-%m-%d')

REPORT="📊 **Weekly Video Pipeline Report** (week ending ${WEEK_END})

**Summary**
• Total created: **${TOTAL_CREATED}**
• Scheduled/Posted: **${SCHEDULED}**
• Failed: **${FAILED}**
• Posted (live): **${POSTED}**
• Avg pipeline time: **${AVG_PIPELINE_HOURS}h** (created → final status)
• Active queue depth: **${QUEUE_DEPTH}**

**Status Breakdown**
$(echo "$STATUS_BREAKDOWN" | sed 's/^/• /')

**Pillar Distribution**
$(echo "$PILLAR_DIST" | sed 's/^/• /')"

echo "$REPORT" > "$REPORT_FILE"
echo "$REPORT"

# Post to Discord
aiwh_notify "$REPORT" "publish"
