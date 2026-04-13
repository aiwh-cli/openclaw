#!/bin/bash

# OpenClaw Restore Script
# Restore from backup with verification
# Usage: ./restore.sh [backup_name]

set -euo pipefail
source /opt/AIWH/core/scripts/lib/env.sh

BACKUP_DIR="/opt/AIWH/backups"
RESTORE_TO_DIR="${1:-.}"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

log "=========================================="
log "OpenClaw Restore Procedure"
log "=========================================="

# Find latest backup if none specified
if [ ! -f "$RESTORE_TO_DIR" ]; then
    LATEST_BACKUP=$(ls -t "$BACKUP_DIR"/openclaw-*.tar.gz 2>/dev/null | head -1)
    if [ -z "$LATEST_BACKUP" ]; then
        log "❌ ERROR: No backups found in $BACKUP_DIR"
        exit 1
    fi
else
    LATEST_BACKUP="$RESTORE_TO_DIR"
fi

log "Using backup: $LATEST_BACKUP"
log "Size: $(du -h "$LATEST_BACKUP" | cut -f1)"

# Create temp restore directory
RESTORE_DIR="/tmp/openclaw-restore-$(date +%s)"
mkdir -p "$RESTORE_DIR"
log "Restore temp directory: $RESTORE_DIR"

# Extract backup
log "Extracting backup..."
tar -xzf "$LATEST_BACKUP" -C "$RESTORE_DIR" || {
    log "❌ ERROR: Failed to extract backup"
    rm -rf "$RESTORE_DIR"
    exit 1
}
log "✓ Backup extracted"

# Verify key files exist
log "Verifying restored content..."
CHECKS=(
    "opt/AIWH/core/SOUL.md"
    "opt/AIWH/.git"
)

for check in "${CHECKS[@]}"; do
    if [ ! -e "$RESTORE_DIR/$check" ]; then
        log "❌ ERROR: Missing critical file: $check"
        log "Backup may be corrupted"
        rm -rf "$RESTORE_DIR"
        exit 1
    fi
done
log "✓ All critical files present"

# Show what will be restored
log ""
log "RESTORE PLAN:"
log "Source: $LATEST_BACKUP"
log "Target: /opt/AIWH (will be moved to /opt/AIWH.backup-DATE if current exists)"
log ""
log "This restore will:"
log "  1. Backup current /opt/AIWH to /opt/AIWH.backup-<timestamp>"
log "  2. Extract restored files to /opt/AIWH"
log "  3. Verify key files exist and .git is intact"
log ""

# Ask for confirmation
read -p "Continue with restore? (yes/no): " -r CONFIRM
if [ "$CONFIRM" != "yes" ]; then
    log "Restore cancelled"
    rm -rf "$RESTORE_DIR"
    exit 0
fi

# Backup current installation
if [ -d "/opt/AIWH" ]; then
    BACKUP_TIMESTAMP=$(date +%s)
    log "Backing up current /opt/AIWH to /opt/AIWH.backup-$BACKUP_TIMESTAMP"
    mv /opt/AIWH "/opt/AIWH.backup-$BACKUP_TIMESTAMP"
fi

# Restore
log "Restoring files..."
mv "$RESTORE_DIR/opt/AIWH" /opt/AIWH

# Verify restoration
log "Verifying restoration..."
if [ -f "/opt/AIWH/core/SOUL.md" ] && [ -d "/opt/AIWH/.git" ]; then
    log "✓ Restoration successful"
    log ""
    log "IMPORTANT: Next steps:"
    log "  1. Restart OpenClaw service (if running as service)"
    log "  2. Test basic functionality"
    log "  3. Check logs for any errors"
    log ""
    log "Backup of previous installation at: /opt/AIWH.backup-$BACKUP_TIMESTAMP"
    log "You can delete it once you confirm everything works."
else
    log "❌ ERROR: Restoration verification failed"
    log "Critical files missing or git directory corrupted"
    log ""
    log "RECOVERY:"
    if [ -d "/opt/AIWH.backup-$BACKUP_TIMESTAMP" ]; then
        log "Restoring original /opt/AIWH..."
        rm -rf /opt/AIWH
        mv "/opt/AIWH.backup-$BACKUP_TIMESTAMP" /opt/AIWH
        log "✓ Original restored"
    fi
    exit 1
fi

log "=========================================="
log "Restore completed at $(date)"
log "=========================================="
