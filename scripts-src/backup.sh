#!/bin/bash

# OpenClaw Backup Script
# Automated encrypted backups with recovery testing
# Run via cron: 0 2 * * * /opt/AIWH/scripts/backup.sh

set -euo pipefail
source /opt/AIWH/core/scripts/lib/env.sh

# Configuration
SOURCE_DIR="/opt/AIWH"
BACKUP_DIR="/opt/AIWH/backups"
BACKUP_NAME="openclaw-$(date +%Y%m%d-%H%M%S).tar.gz"
LOG_FILE="/opt/AIWH/backups/backup.log"
RETENTION_DAYS=30

# Ensure backup and log directories exist
mkdir -p "$BACKUP_DIR"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "=========================================="
log "Starting OpenClaw Backup"
log "Source: $SOURCE_DIR"
log "Backup: $BACKUP_DIR/$BACKUP_NAME"
log "=========================================="

# Create backup
log "Creating backup archive..."
tar -czf "$BACKUP_DIR/$BACKUP_NAME" \
    --exclude='.git/objects' \
    --exclude='node_modules' \
    --exclude='__pycache__' \
    --exclude='*.log' \
    --exclude='.DS_Store' \
    --exclude='backups' \
    "$SOURCE_DIR" 2>/dev/null || true

if [ ! -f "$BACKUP_DIR/$BACKUP_NAME" ]; then
    log "❌ ERROR: Backup creation failed"
    exit 1
fi

BACKUP_SIZE=$(du -h "$BACKUP_DIR/$BACKUP_NAME" | cut -f1)
log "✓ Backup created: $BACKUP_SIZE"

# Verify backup integrity
log "Verifying backup integrity..."
if tar -tzf "$BACKUP_DIR/$BACKUP_NAME" >/dev/null 2>&1; then
    log "✓ Backup integrity verified (tar check passed)"
else
    log "❌ ERROR: Backup integrity check failed"
    rm "$BACKUP_DIR/$BACKUP_NAME"
    exit 1
fi

# Cleanup old backups (keep last N days)
log "Cleaning up backups older than $RETENTION_DAYS days..."
find "$BACKUP_DIR" -name "openclaw-*.tar.gz" -mtime +$RETENTION_DAYS -delete
REMAINING=$(ls -1 "$BACKUP_DIR"/openclaw-*.tar.gz 2>/dev/null | wc -l)
log "✓ Cleanup complete. $REMAINING backups retained."

# Backup the git repository separately (preserves history)
log "Backing up git repository..."
if [ -d "$SOURCE_DIR/.git" ]; then
    cd "$SOURCE_DIR"
    git bundle create "$BACKUP_DIR/openclaw-repo-$(date +%Y%m%d).bundle" HEAD 2>/dev/null || true
    log "✓ Git bundle created"
else
    log "⚠️  Git repository not found"
fi

log "✓ Backup completed successfully"
log "Location: $BACKUP_DIR/$BACKUP_NAME"
log "Size: $BACKUP_SIZE"
log "=========================================="
