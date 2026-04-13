#!/bin/bash
# cinematic-review-notify.sh — Zero-cost replacement for agent-based cron
# Checks for cinematic jobs stuck in review phases and posts Discord reminder.
# Runs via OpenClaw cron (shell mode) — no LLM tokens consumed.

set -euo pipefail
source /opt/AIWH/core/scripts/lib/env.sh

DB="${CLIENT_ROOT:-/opt/AIWH/client}/data/video-jobs.db"
LOG="${CLIENT_ROOT:-/opt/AIWH/client}/logs/cinematic-notify.log"
CHANNEL_ID="1477588774039978095"

# Load secrets (encrypted store preferred, .env fallback)
aiwh_load_secrets DISCORD_TOKEN

if [[ ! -f "$DB" ]]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: DB not found: $DB" >> "$LOG"
  exit 1
fi

# Query jobs in review phases
ROWS=$(sqlite3 "$DB" "SELECT cjob_id, title, phase, updated_at FROM cinematic_jobs WHERE phase LIKE '%_review' ORDER BY updated_at ASC;" 2>/dev/null || true)

if [[ -z "$ROWS" ]]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] No jobs awaiting review" >> "$LOG"
  exit 0
fi

# Build message
NOW_EPOCH=$(date +%s)
MSG="🎬 **Cinematic Review Needed**\n"

while IFS='|' read -r cjob_id title phase updated_at; do
  # Calculate hours waiting
  if [[ "$updated_at" =~ ^[0-9]{4}- ]]; then
    UPDATED_EPOCH=$(date -j -f "%Y-%m-%d %H:%M:%S" "$updated_at" +%s 2>/dev/null || date -j -f "%Y-%m-%dT%H:%M:%S" "${updated_at%%.*}" +%s 2>/dev/null || echo "0")
  else
    UPDATED_EPOCH=0
  fi

  if [[ "$UPDATED_EPOCH" -gt 0 ]]; then
    HOURS=$(( (NOW_EPOCH - UPDATED_EPOCH) / 3600 ))
    WAIT="${HOURS}h"
  else
    WAIT="unknown"
  fi

  MSG="${MSG}> **${title}** — awaiting \`${phase}\` (${WAIT})\n"
done <<< "$ROWS"

MSG="${MSG}> Review at: http://localhost:3001/#production"

# Post to Discord via bot API
PAYLOAD=$(printf '{"content": "%s"}' "$MSG")
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "https://discord.com/api/v10/channels/${CHANNEL_ID}/messages" \
  -H "Authorization: Bot ${DISCORD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" 2>/dev/null)

if [[ "$HTTP_CODE" == "200" ]]; then
  COUNT=$(echo "$ROWS" | wc -l | tr -d ' ')
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Notified: ${COUNT} jobs awaiting review" >> "$LOG"
else
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Discord API returned ${HTTP_CODE}" >> "$LOG"
  exit 1
fi
