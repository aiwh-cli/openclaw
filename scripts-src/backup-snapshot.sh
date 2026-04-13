#!/bin/bash
# ============================================================================
# AIWH Hourly Backup Snapshot
# ============================================================================
# Creates tar.gz of ALL of /opt/AIWH (code, configs, databases, sessions,
# logs, client data) — everything except media files and trash.
#
# Runs every 4 hours via dashboard script cron.
# Keeps 12 snapshots locally (~2 days) + 12 on Google Drive (~2 days).
#
# INCLUDES: sessions, logs, node_modules, .env, databases, memory, configs
# EXCLUDES: media files (mp4/mp3/wav/mov in content dirs), trash, old backups,
#           .git, __pycache__, .venv, .DS_Store
#
# Also uploads RECOVERY.md alongside the snapshot on GDrive.
# ============================================================================

set -euo pipefail
source /opt/AIWH/core/scripts/lib/env.sh

BACKUP_DIR="/opt/AIWH/core/.backups"
TIMESTAMP=$(date +%Y-%m-%d_%H%M)
SNAPSHOT="$BACKUP_DIR/snapshot-$TIMESTAMP.tar.gz"
GDRIVE_BACKUP_FOLDER="1xzP9IWdw-PS_YW4PxZrUyxkahtonuj9I"  # AIWH-Backups folder in Drive
GDRIVE_FILENAME="snapshot-$TIMESTAMP.tar.gz"
RECOVERY_DOC="/opt/AIWH/core/docs/RECOVERY.md"
ENV_FILE="/opt/AIWH/.openclaw/.env"

# Load shared GDrive helpers
source "/opt/AIWH/core/scripts/lib/gdrive.sh"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"; }

mkdir -p "$BACKUP_DIR"

# ── Copy LaunchD plists into snapshot (so they're backed up) ──
LAUNCHD_DIR="/opt/AIWH/core/config/launchd"
mkdir -p "$LAUNCHD_DIR"
cp -f ~/Library/LaunchAgents/com.aiwh.*.plist "$LAUNCHD_DIR/" 2>/dev/null || true

log "Starting backup snapshot of /opt/AIWH"

# ── Create snapshot ──
# Backs up ALL of /opt/AIWH except media files and meta-backups
tar -czf "$SNAPSHOT" \
    --exclude='.git' \
    --exclude='__pycache__' \
    --exclude='.DS_Store' \
    --exclude='.venv' \
    --exclude='node_modules' \
    --exclude='openclaw' \
    --exclude='aiwh-website' \
    --exclude='.openclaw/browser' \
    --exclude='.next' \
    --exclude='.claude' \
    --exclude='.openshell' \
    --exclude='bin/openshell' \
    --exclude='core/.backups' \
    --exclude='backups' \
    --exclude='trash' \
    --exclude='logs' \
    --exclude='*.tar.gz' \
    --exclude='*.tar.gz.enc' \
    --exclude='client/content/jobs/*/*.mp4' \
    --exclude='client/content/jobs/*/*.mp3' \
    --exclude='client/content/jobs/*/*.wav' \
    --exclude='client/content/jobs/*/*.mov' \
    --exclude='client/content/jobs/*/assets/*.mp4' \
    --exclude='client/content/jobs/*/assets/*.mp3' \
    --exclude='client/content/jobs/*/assets/*.wav' \
    --exclude='core/content/cinematic/*/*.mp4' \
    --exclude='core/content/cinematic/*/*.mp3' \
    --exclude='core/content/cinematic/*/*.wav' \
    --exclude='core/content/cinematic/*/*.png' \
    --exclude='core/content/cinematic/*/clips/*.mp4' \
    --exclude='core/content/cinematic/*/keyframes/*.png' \
    --exclude='core/outputs/*.mp4' \
    --exclude='core/outputs/*.mp3' \
    --exclude='core/outputs/*.wav' \
    --exclude='core/outputs/*.png' \
    --exclude='system/license' \
    -C /opt/AIWH \
    . || { rc=$?; if [ $rc -eq 1 ]; then log "WARNING: Some files changed during backup (tar exit 1)"; else log "ERROR: tar failed (exit $rc)"; exit 1; fi; }

size=$(ls -lh "$SNAPSHOT" | awk '{print $5}')
log "Snapshot created: $SNAPSHOT ($size)"

# ── Local retention: keep last 6 snapshots (~1 day at 6/day) ──
ls -1t "$BACKUP_DIR"/snapshot-*.tar.gz 2>/dev/null | tail -n +7 | while read -r old; do
    rm -f "$old" && log "Rotated old snapshot: $(basename "$old")"
done
snapshot_count=$(ls -1 "$BACKUP_DIR"/snapshot-*.tar.gz 2>/dev/null | wc -l | tr -d ' ')
log "Local snapshots kept: $snapshot_count (max 12)"

# ── Encrypt before GDrive upload (AES-256-CBC, matches desktop backup format) ──
ENCRYPT_KEY_FILE="/opt/AIWH/.openclaw/backup-encryption-key"
ENCRYPTED_SNAPSHOT="$BACKUP_DIR/snapshot-$TIMESTAMP.tar.gz.enc"

if command -v "$GWS_BIN" >/dev/null 2>&1; then
    if [ -f "$ENCRYPT_KEY_FILE" ]; then
        ENCRYPT_PASS=$(cat "$ENCRYPT_KEY_FILE")
        if openssl enc -aes-256-cbc -salt -pbkdf2 -iter 100000 \
            -in "$SNAPSHOT" -out "$ENCRYPTED_SNAPSHOT" \
            -pass "pass:${ENCRYPT_PASS}" 2>/dev/null; then
            log "Encrypted snapshot: $(ls -lh "$ENCRYPTED_SNAPSHOT" | awk '{print $5}')"
            UPLOAD_FILE="$ENCRYPTED_SNAPSHOT"
            UPLOAD_NAME="snapshot-$TIMESTAMP.tar.gz.enc"
        else
            log "WARNING: Encryption failed — uploading unencrypted (fix key!)"
            UPLOAD_FILE="$SNAPSHOT"
            UPLOAD_NAME="$GDRIVE_FILENAME"
        fi
    else
        log "WARNING: No encryption key at $ENCRYPT_KEY_FILE — uploading unencrypted"
        UPLOAD_FILE="$SNAPSHOT"
        UPLOAD_NAME="$GDRIVE_FILENAME"
    fi

    log "Uploading to Google Drive..."
    if UPLOAD_ID=$(gdrive_upload "$UPLOAD_FILE" "$UPLOAD_NAME" "$GDRIVE_BACKUP_FOLDER") && [ -n "$UPLOAD_ID" ]; then
        log "Uploaded to Google Drive: $UPLOAD_NAME ($UPLOAD_ID)"
    else
        log "WARNING: GDrive upload failed (will retry next run)"
    fi

    # Clean up local encrypted file (local unencrypted snapshot stays for restore)
    [ -f "$ENCRYPTED_SNAPSHOT" ] && rm -f "$ENCRYPTED_SNAPSHOT"

    # Upload RECOVERY.md alongside (overwrite if exists)
    if [ -f "$RECOVERY_DOC" ]; then
        gdrive_upload "$RECOVERY_DOC" "RECOVERY.md" "$GDRIVE_BACKUP_FOLDER" >/dev/null 2>&1 && \
            log "Uploaded RECOVERY.md to GDrive" || \
            log "WARNING: RECOVERY.md upload failed"
    fi

    # Clean up old Drive snapshots (keep last 6 — matches both encrypted and unencrypted)
    OLD_IDS=$(gdrive_ls "$GDRIVE_BACKUP_FOLDER" 100 2>/dev/null | python3 -c "
import sys, json
data = json.load(sys.stdin)
files = [f for f in data.get('files', []) if 'snapshot-' in f.get('name','') and f.get('name','').endswith(('.tar.gz','.tar.gz.enc'))]
files.sort(key=lambda f: f.get('modifiedTime',''), reverse=True)
for f in files[6:]:
    print(f['id'])
" 2>/dev/null || true)

    if [ -n "$OLD_IDS" ]; then
        while IFS= read -r fid; do
            [ -z "$fid" ] && continue
            gdrive_delete "$fid" && \
                log "Cleaned up old Drive snapshot: $fid" || \
                log "WARNING: Failed to delete Drive snapshot: $fid"
        done <<< "$OLD_IDS"
    fi
else
    log "WARNING: gws CLI not available — skipping GDrive upload (local snapshots only)"
fi

# ── Also rotate encrypted snapshots locally ──
ls -1t "$BACKUP_DIR"/snapshot-*.tar.gz.enc 2>/dev/null | tail -n +7 | while read -r old; do
    rm -f "$old" && log "Rotated old encrypted snapshot: $(basename "$old")"
done

log "Backup snapshot complete"

# ── Notify ──
aiwh_notify "**BACKUP** — $(TZ=Australia/Brisbane date '+%a %d %b %H:%M')\n> File: snapshot-$TIMESTAMP ($size)\n> Local copies: $snapshot_count\n> GDrive: $([ "${HAS_GDRIVE_UPLOAD:-false}" = true ] && echo 'uploaded' || echo 'local only')" "systems" 2>/dev/null || true
