#!/bin/bash
source /opt/AIWH/core/scripts/lib/env.sh
# Spend Watchdog — Runs continuously, checks every 10 seconds
# Alerts: immediate on first WARN ($4.50) and CRITICAL ($5.00), then 8hr cooldown
# Also refreshes cron-health and backup status every 5 min

ALERT_FLAG_DIR="/tmp/aiwh-alerts"
mkdir -p "$ALERT_FLAG_DIR"
PIDFILE="/tmp/aiwh-spend-watchdog.pid"
LOGFILE="${CLIENT_ROOT:-/opt/AIWH/client}/logs/spend-watchdog.log"

# Write PID for management
echo $$ > "$PIDFILE"

# Cleanup on exit
trap "rm -f $PIDFILE; exit 0" SIGTERM SIGINT

CYCLE=0

while true; do
    # --- Spend check (every 10s) ---
    /opt/AIWH/core/scripts/spend-checker.sh 2>/dev/null

    SPEND_STATUS=$(cat "${CLIENT_ROOT:-/opt/AIWH/client}/logs/spend-status.txt" 2>/dev/null)
    SPEND_LEVEL=$(echo "$SPEND_STATUS" | awk '{print $1}')
    SPEND_AMOUNT=$(echo "$SPEND_STATUS" | awk '{print $2}')

    if [ "$SPEND_LEVEL" != "OK" ]; then
        BUCKET=$(( 10#$(date +%H) / 8 ))
        FLAG="$ALERT_FLAG_DIR/spend-${SPEND_LEVEL}-$(date +%Y-%m-%d)-${BUCKET}"
        if [ ! -f "$FLAG" ]; then
            case "$SPEND_LEVEL" in
                SHUTOFF)    MSG="🛑 **SHUTOFF**: \$${SPEND_AMOUNT} — all crons paused, emergency only" ;;
                HAIKU_ONLY) MSG="🟠 **Haiku-Only Mode**: \$${SPEND_AMOUNT} — Sonnet/Opus disabled" ;;
                CRITICAL)   MSG="🚨 **BUDGET EXCEEDED**: \$${SPEND_AMOUNT} / \$5.00 daily limit" ;;
                WARN)       MSG="⚠️ **Spend Warning**: \$${SPEND_AMOUNT} — approaching \$5 limit" ;;
            esac
            aiwh_notify "$MSG" "spend"
            touch "$FLAG"
            echo "[$(date '+%Y-%m-%d %H:%M:%S')] ALERT: $MSG" >> "$LOGFILE"
        fi
    fi

    # --- Cron health + backup check (every 5 min = 30 cycles) ---
    if [ $((CYCLE % 30)) -eq 0 ]; then
        /opt/AIWH/core/scripts/cron-health-checker.sh 2>/dev/null
        /opt/AIWH/core/scripts/backup-status-checker.sh 2>/dev/null

        # Cron alert (8hr cooldown)
        if grep -q "^MISSED" "${CLIENT_ROOT:-/opt/AIWH/client}/logs/cron-health.txt" 2>/dev/null; then
            BUCKET=$(( 10#$(date +%H) / 8 ))
            FLAG="$ALERT_FLAG_DIR/cron-missed-$(date +%Y-%m-%d)-${BUCKET}"
            if [ ! -f "$FLAG" ]; then
                MISSED=$(grep "^MISSED" "${CLIENT_ROOT:-/opt/AIWH/client}/logs/cron-health.txt" | tr '\n' ', ')
                aiwh_notify "🚨 **Cron Missed**: ${MISSED}" "systems"
                touch "$FLAG"
            fi
        fi

        # Backup alert (8hr cooldown)
        BACKUP_LEVEL=$(awk '{print $1}' "${CLIENT_ROOT:-/opt/AIWH/client}/logs/backup-status.txt" 2>/dev/null)
        if [ "$BACKUP_LEVEL" = "STALE" ]; then
            BUCKET=$(( 10#$(date +%H) / 8 ))
            FLAG="$ALERT_FLAG_DIR/backup-stale-$(date +%Y-%m-%d)-${BUCKET}"
            if [ ! -f "$FLAG" ]; then
                aiwh_notify "⚠️ **Backup Stale**: $(cat "${CLIENT_ROOT:-/opt/AIWH/client}/logs/backup-status.txt")" "systems"
                touch "$FLAG"
            fi
        fi
    fi

    # Cleanup old flags daily
    if [ $((CYCLE % 8640)) -eq 0 ] && [ "$CYCLE" -gt 0 ]; then
        find "$ALERT_FLAG_DIR" -type f -mtime +1 -delete 2>/dev/null
    fi

    CYCLE=$((CYCLE + 1))
    sleep 10
done
