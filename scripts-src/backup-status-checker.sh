#!/bin/bash
# Checks backup freshness
# Output: $CLIENT_ROOT/logs/backup-status.txt
# Format: OK|STALE age_hours

OUTPUT="${CLIENT_ROOT:-/opt/AIWH/client}/logs/backup-status.txt"
MAX_HOURS=26
NOW=$(date +%s)

LATEST=$(ls -t /opt/AIWH/core/.backups/*.tar.gz 2>/dev/null | head -1)
if [ -z "$LATEST" ]; then
    echo "STALE 999" > "$OUTPUT"
    exit 0
fi

FILE_TIME=$(stat -f%m "$LATEST" 2>/dev/null || echo "$NOW")
AGE_HOURS=$(( (NOW - FILE_TIME) / 3600 ))

if [ "$AGE_HOURS" -gt "$MAX_HOURS" ]; then
    echo "STALE $AGE_HOURS" > "$OUTPUT"
else
    echo "OK $AGE_HOURS" > "$OUTPUT"
fi
