#!/bin/bash
# ============================================================================
# AIWH Hourly Local Backup to Desktop
# ============================================================================
# Creates encrypted tar.gz of /opt/AIWH to Desktop — outside the blast radius.
# Keeps a rolling window of 6 archives. Notifies Discord on failure only.
#
# GUARDRAILS:
#   - NEVER deletes source files. Only manages its own archive rotation.
#   - Backup destination is OUTSIDE /opt/AIWH (survives a full wipe).
#   - Only deletes old archives in its own ARCHIVE_DIR (pattern: aiwh-*.tar.gz.enc)
#
# Schedule: Every 1 hour via launchd (com.aiwh.backup-local.plist)
# ============================================================================

set -euo pipefail
source /opt/AIWH/core/scripts/lib/env.sh

# --- Configuration ---
SOURCE_DIR="/opt/AIWH"
BACKUP_ROOT="/Users/roboai/Desktop/AIWH-Backups"
ARCHIVE_DIR="${BACKUP_ROOT}/archives"
LOG_DIR="${BACKUP_ROOT}/logs"
ENCRYPT_KEY_FILE="/opt/AIWH/.openclaw/backup-encryption-key"
ENV_FILE="/opt/AIWH/.openclaw/.env"
MAX_ARCHIVES=6

DATE=$(date +%Y%m%d-%H%M%S)
HOSTNAME=$(hostname -s)
ARCHIVE_NAME="aiwh-${HOSTNAME}-${DATE}"

# --- Functions ---
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

notify_failure() {
    local msg="$1"
    log "FAILURE: $msg"
    aiwh_notify "⚠️ **BACKUP FAILURE** ($(date '+%H:%M %d %b'))\n${msg}" "systems"
}

# --- Setup ---
mkdir -p "$ARCHIVE_DIR" "$LOG_DIR"

log "=========================================="
log "Starting hourly backup"

# --- Preflight ---
if [ ! -d "$SOURCE_DIR" ]; then
    notify_failure "/opt/AIWH does not exist — nothing to back up."
    exit 1
fi

if [ ! -f "$ENCRYPT_KEY_FILE" ]; then
    notify_failure "Encryption key not found at $ENCRYPT_KEY_FILE"
    exit 1
fi

# --- Create tar.gz ---
TMPARCHIVE="${ARCHIVE_DIR}/${ARCHIVE_NAME}.tar.gz"
ENCRYPTED="${ARCHIVE_DIR}/${ARCHIVE_NAME}.tar.gz.enc"

log "Creating archive from ${SOURCE_DIR}..."
START_TIME=$(date +%s)

if ! tar czf "$TMPARCHIVE" \
    --exclude='.DS_Store' \
    --exclude='*.tar.gz' \
    --exclude='*.tar.gz.enc' \
    --exclude='backups' \
    --exclude='.git' \
    --exclude='node_modules' \
    --exclude='__pycache__' \
    --exclude='.venv' \
    --exclude='.openclaw/logs' \
    --exclude='.openclaw/browser' \
    --exclude='.openclaw/agents/*/sessions' \
    -C / \
    opt/AIWH 2>/dev/null; then
    notify_failure "tar creation failed"
    rm -f "$TMPARCHIVE"
    exit 1
fi

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
ARCHIVE_SIZE=$(du -h "$TMPARCHIVE" | cut -f1)
log "Archive created: ${ARCHIVE_SIZE} in ${DURATION}s"

# --- Verify integrity ---
if ! tar tzf "$TMPARCHIVE" >/dev/null 2>&1; then
    notify_failure "Archive integrity check failed"
    rm -f "$TMPARCHIVE"
    exit 1
fi

# --- Encrypt with AES-256-CBC ---
ENCRYPT_PASS=$(cat "$ENCRYPT_KEY_FILE")
if ! openssl enc -aes-256-cbc -salt -pbkdf2 -iter 100000 \
    -in "$TMPARCHIVE" -out "$ENCRYPTED" \
    -pass "pass:${ENCRYPT_PASS}" 2>/dev/null; then
    notify_failure "Encryption failed"
    rm -f "$TMPARCHIVE" "$ENCRYPTED"
    exit 1
fi

rm -f "$TMPARCHIVE"
ENC_SIZE=$(du -h "$ENCRYPTED" | cut -f1)
log "Encrypted: $(basename "$ENCRYPTED") (${ENC_SIZE})"

# --- Rotate: keep only newest MAX_ARCHIVES ---
# Uses bash globbing + stat instead of ls — avoids macOS TCC issues under launchd
shopt -s nullglob
archives=("${ARCHIVE_DIR}"/aiwh-*.tar.gz.enc)
shopt -u nullglob
ARCHIVE_COUNT=${#archives[@]}

if [ "$ARCHIVE_COUNT" -gt "$MAX_ARCHIVES" ]; then
    # Sort by mtime descending (newest first) using stat, then delete oldest
    DELETE_COUNT=$((ARCHIVE_COUNT - MAX_ARCHIVES))
    log "Rotating: removing ${DELETE_COUNT} oldest archive(s) (keeping ${MAX_ARCHIVES})"
    sorted=$(for f in "${archives[@]}"; do stat -f '%m %N' "$f" 2>/dev/null; done | sort -rn | tail -n "$DELETE_COUNT" | cut -d' ' -f2-)
    while IFS= read -r old; do
        [ -z "$old" ] && continue
        log "  Removed: $(basename "$old")"
        rm -f "$old" || log "  WARNING: Failed to remove $(basename "$old")"
    done <<< "$sorted"
fi

shopt -s nullglob
remaining=("${ARCHIVE_DIR}"/aiwh-*.tar.gz.enc)
shopt -u nullglob
log "Done. Desktop archives: ${#remaining[@]}/${MAX_ARCHIVES}"
log "=========================================="
