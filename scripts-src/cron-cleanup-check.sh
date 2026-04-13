#!/bin/bash
# cron-cleanup-check.sh — Zero-cost replacement for agent-based cleanup cron
# Checks disk usage and posts report to Discord.
set -euo pipefail
source /opt/AIWH/core/scripts/lib/env.sh

LOG="${CLIENT_ROOT:-/opt/AIWH/client}/logs/cleanup-check.log"
TODAY=$(TZ=Australia/Brisbane date '+%a %d %b %Y')

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"; }

log "Starting cleanup check"

# Gather disk stats
CORE_SIZE=$(du -sh /opt/AIWH/core 2>/dev/null | cut -f1)
JOBS_SIZE=$(du -sh /opt/AIWH/client/content/jobs 2>/dev/null | cut -f1 || echo "0")
OUTPUTS_SIZE=$(du -sh /opt/AIWH/core/outputs 2>/dev/null | cut -f1 || echo "N/A")
BACKUPS_SIZE=$(du -sh /opt/AIWH/core/.backups 2>/dev/null | cut -f1 || echo "N/A")
DISK_FREE=$(df -h /opt/AIWH 2>/dev/null | tail -1 | awk '{print $4}')
OLD_BACKUPS=$(find /opt/AIWH/core/.backups -name "*.tar.gz" -mtime +7 2>/dev/null | wc -l | tr -d ' ')
LARGE_LOGS=$(find /opt/AIWH/client/logs -name "*.log" -size +10M 2>/dev/null | while read f; do echo "$(basename "$f") ($(du -h "$f" | cut -f1))"; done)

if [[ -z "$LARGE_LOGS" ]]; then
  LARGE_LOGS="None"
fi

# Determine status
STATUS="Clean"
WARN=""
DISK_FREE_NUM=$(df /opt/AIWH 2>/dev/null | tail -1 | awk '{print $4}')
if [[ "${DISK_FREE_NUM:-0}" -lt 20000000 ]]; then
  STATUS="Needs attention"
  WARN="\n\n> :warning: Disk free below 20GB!"
fi
if [[ "$OLD_BACKUPS" -gt 0 ]]; then
  STATUS="Needs attention"
fi

MSG="**WEEKLY CLEANUP CHECK** — ${TODAY}\n\n**Disk Usage**\n> /opt/AIWH/core: ${CORE_SIZE}\n> Content jobs: ${JOBS_SIZE}\n> Outputs: ${OUTPUTS_SIZE}\n> Backups: ${BACKUPS_SIZE}\n> Disk free: ${DISK_FREE}\n\n**Cleanup Needed**\n> Old backups (>7 days): ${OLD_BACKUPS} files\n> Large logs (>10MB): ${LARGE_LOGS}\n\n**Status**: ${STATUS}${WARN}"

log "Check done: core=$CORE_SIZE jobs=$JOBS_SIZE free=$DISK_FREE old_backups=$OLD_BACKUPS status=$STATUS"

aiwh_notify "$MSG" "systems"
log "Discord notified"
