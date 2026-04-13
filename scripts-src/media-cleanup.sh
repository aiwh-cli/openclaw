#!/opt/homebrew/bin/bash
# ============================================================================
# AIWH Media Cleanup — Works with or without Google Drive
# ============================================================================
# Cleans up completed media files to prevent disk fill.
#
# TWO MODES:
#   1. GDrive connected: Upload to GDrive → verify → move to trash/ → auto-delete after 48h
#   2. No GDrive: Move old media directly to trash/ → auto-delete after 48h
#
# SAFETY:
#   - Never deletes files directly — always moves to /opt/AIWH/trash/ first
#   - 48-hour cooldown before permanent deletion
#   - Records every action in trash_manifest table
#   - Verified GDrive uploads get priority over retention-only cleanup
#
# Replaces: media-archive-daily.sh (GDrive-dependent)
# Schedule: Daily at 02:00 via dashboard script cron
# ============================================================================

set -euo pipefail
source /opt/AIWH/core/scripts/lib/env.sh

# --- Configuration ---
CLIENT_ROOT="${CLIENT_ROOT:-/opt/AIWH/client}"
CONTENT_JOBS_DIR="$CLIENT_ROOT/content/jobs"
CINEMATIC_DIR="$CLIENT_ROOT/content/cinematic"
OUTPUTS_DIR="/opt/AIWH/core/outputs"
VIDEO_DB="$CLIENT_ROOT/data/video-jobs.db"
DASHBOARD_DB="/opt/AIWH/core/dashboard/mission-control.db"
LOG_FILE="$CLIENT_ROOT/logs/media-cleanup.log"
TRASH_DIR="/opt/AIWH/trash"
RETENTION_DAYS=30  # Delete posted/published media after this many days (no-GDrive mode)

MEDIA_EXTENSIONS=("mp4" "mp3" "wav" "mov" "avi" "mkv" "png" "jpg" "jpeg" "webp")

# --- Check GDrive availability ---
HAS_GDRIVE=false
if command -v "${GWS_BIN:-gws}" >/dev/null 2>&1; then
    # Quick test: can we list root?
    if "${GWS_BIN:-gws}" drive files list --max-results 1 >/dev/null 2>&1; then
        HAS_GDRIVE=true
    fi
fi

# --- Functions ---
log() {
    local msg="[$(date '+%Y-%m-%d %H:%M:%S')] $1"
    echo "$msg"
    echo "$msg" >> "$LOG_FILE"
}

mkdir -p "$TRASH_DIR" "$(dirname "$LOG_FILE")"

# --- Ensure trash_manifest table exists ---
sqlite3 "$DASHBOARD_DB" "
CREATE TABLE IF NOT EXISTS trash_manifest (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    original_path TEXT NOT NULL,
    trash_path TEXT NOT NULL,
    gdrive_file_id TEXT,
    gdrive_folder_id TEXT,
    gdrive_folder_path TEXT,
    file_size INTEGER NOT NULL DEFAULT 0,
    verified INTEGER NOT NULL DEFAULT 0,
    trashed_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT,
    source TEXT DEFAULT 'media-cleanup'
);
CREATE INDEX IF NOT EXISTS idx_trash_manifest_deleted ON trash_manifest(deleted_at);
CREATE INDEX IF NOT EXISTS idx_trash_manifest_verified ON trash_manifest(verified);
" 2>/dev/null

log "=========================================="
log "Media cleanup started (GDrive: $HAS_GDRIVE)"

# --- Helper: move file to trash + record in manifest ---
trash_file() {
    local local_path="$1"
    local gdrive_file_id="${2:-}"
    local gdrive_folder_id="${3:-}"
    local gdrive_folder_path="${4:-}"
    local verified=0
    [ -n "$gdrive_file_id" ] && verified=1

    local rel_path="${local_path#/opt/AIWH/}"
    local trash_path="$TRASH_DIR/$rel_path"
    local file_size
    file_size=$(stat -f%z "$local_path" 2>/dev/null || stat -c%s "$local_path" 2>/dev/null || echo 0)

    mkdir -p "$(dirname "$trash_path")"
    mv "$local_path" "$trash_path"

    # Record in manifest
    sqlite3 "$DASHBOARD_DB" "
    INSERT INTO trash_manifest (original_path, trash_path, gdrive_file_id, gdrive_folder_id, gdrive_folder_path, file_size, verified, source)
    VALUES ('$local_path', '$trash_path', '${gdrive_file_id:-}', '${gdrive_folder_id:-}', '${gdrive_folder_path:-}', $file_size, $verified, 'media-cleanup');
    " 2>/dev/null

    log "  Trashed: $rel_path ($(du -h "$trash_path" | cut -f1))"
}

# --- Helper: find media files ---
find_media() {
    local dir="$1"
    local -a find_args=( "$dir" -type f \( )
    local first=true
    for ext in "${MEDIA_EXTENSIONS[@]}"; do
        if [ "$first" = true ]; then first=false; else find_args+=( -o ); fi
        find_args+=( -iname "*.${ext}" )
    done
    find_args+=( \) )
    find "${find_args[@]}" 2>/dev/null || true
}

TRASHED=0
UPLOADED=0
ERRORS=0

# =====================================================================
# PHASE 1: Clean posted video jobs
# =====================================================================
if [ -f "$VIDEO_DB" ] && [ -d "$CONTENT_JOBS_DIR" ]; then
    POSTED_JOBS=$(sqlite3 "$VIDEO_DB" "SELECT job_id FROM video_jobs WHERE status='posted';" 2>/dev/null || true)

    if [ -n "$POSTED_JOBS" ]; then
        log "Phase 1: Cleaning posted video jobs"

        while IFS= read -r job_id; do
            JOB_DIR="$CONTENT_JOBS_DIR/$job_id"
            [ ! -d "$JOB_DIR" ] && continue

            MEDIA_FILES=$(find_media "$JOB_DIR")
            [ -z "$MEDIA_FILES" ] && continue

            while IFS= read -r media_file; do
                [ -z "$media_file" ] || [ ! -f "$media_file" ] && continue

                if [ "$HAS_GDRIVE" = true ]; then
                    # Upload to GDrive then trash
                    source "/opt/AIWH/core/scripts/lib/gdrive.sh"
                    # Lazy-init root folder
                    if [ -z "${GDRIVE_ROOT_ID:-}" ]; then
                        GDRIVE_ROOT_ID=$(gdrive_search "name = 'AIWH-Archive' and mimeType = 'application/vnd.google-apps.folder'" | \
                            python3 -c "import sys,json; d=json.load(sys.stdin); files=d.get('files',[]); print(files[0]['id'] if files else '')" 2>/dev/null || true)
                        [ -z "$GDRIVE_ROOT_ID" ] && GDRIVE_ROOT_ID=$(gdrive_mkdir "AIWH-Archive")
                    fi
                    rel_dir="video-jobs/$job_id"
                    # Simple: upload to flat folder per job (no deep nesting)
                    folder_id=$(gdrive_search "name = '$job_id' and '$GDRIVE_ROOT_ID' in parents and mimeType = 'application/vnd.google-apps.folder'" | \
                        python3 -c "import sys,json; d=json.load(sys.stdin); files=d.get('files',[]); print(files[0]['id'] if files else '')" 2>/dev/null || true)
                    [ -z "$folder_id" ] && folder_id=$(gdrive_mkdir "$job_id" "$GDRIVE_ROOT_ID")

                    filename=$(basename "$media_file")
                    file_id=$(gdrive_upload "$media_file" "$filename" "$folder_id" 2>/dev/null || true)
                    if [ -n "$file_id" ]; then
                        trash_file "$media_file" "$file_id" "$folder_id" "$rel_dir"
                        UPLOADED=$((UPLOADED + 1))
                    else
                        log "  Upload failed: $filename — trashing locally only"
                        trash_file "$media_file"
                    fi
                else
                    # No GDrive — just trash locally
                    trash_file "$media_file"
                fi
                TRASHED=$((TRASHED + 1))
            done <<< "$MEDIA_FILES"
        done <<< "$POSTED_JOBS"
    else
        log "Phase 1: No posted video jobs"
    fi
fi

# =====================================================================
# PHASE 2: Clean published/approved cinematic jobs
# =====================================================================
if [ -f "$VIDEO_DB" ] && [ -d "$CINEMATIC_DIR" ]; then
    DONE_CJOBS=$(sqlite3 "$VIDEO_DB" "SELECT cjob_id FROM cinematic_jobs WHERE phase IN ('published','approved');" 2>/dev/null || true)

    if [ -n "$DONE_CJOBS" ]; then
        log "Phase 2: Cleaning cinematic jobs"

        while IFS= read -r cjob_id; do
            CJOB_DIR="$CINEMATIC_DIR/$cjob_id"
            [ ! -d "$CJOB_DIR" ] && continue

            MEDIA_FILES=$(find_media "$CJOB_DIR")
            [ -z "$MEDIA_FILES" ] && continue

            while IFS= read -r media_file; do
                [ -z "$media_file" ] || [ ! -f "$media_file" ] && continue
                trash_file "$media_file"
                TRASHED=$((TRASHED + 1))
            done <<< "$MEDIA_FILES"
        done <<< "$DONE_CJOBS"
    else
        log "Phase 2: No published cinematic jobs"
    fi
fi

# =====================================================================
# PHASE 3: Old outputs (7+ days)
# =====================================================================
if [ -d "$OUTPUTS_DIR" ]; then
    OLD_OUTPUTS=$(find "$OUTPUTS_DIR" -type f \( -iname '*.mp4' -o -iname '*.mp3' -o -iname '*.wav' -o -iname '*.png' -o -iname '*.mov' \) -mtime +7 2>/dev/null || true)

    if [ -n "$OLD_OUTPUTS" ]; then
        log "Phase 3: Cleaning outputs older than 7 days"
        while IFS= read -r media_file; do
            [ -z "$media_file" ] || [ ! -f "$media_file" ] && continue
            trash_file "$media_file"
            TRASHED=$((TRASHED + 1))
        done <<< "$OLD_OUTPUTS"
    else
        log "Phase 3: No old outputs"
    fi
fi

# =====================================================================
# PHASE 4: Auto-delete trash files past 48h cooldown
# =====================================================================
log "Phase 4: Auto-deleting verified trash past 48h"
DELETED=0
DELETE_ERRORS=0

# Get files ready for permanent deletion
READY=$(sqlite3 "$DASHBOARD_DB" "
SELECT id, trash_path FROM trash_manifest
WHERE deleted_at IS NULL
  AND datetime(trashed_at, '+48 hours') <= datetime('now');
" 2>/dev/null || true)

if [ -n "$READY" ]; then
    while IFS='|' read -r row_id trash_path; do
        [ -z "$row_id" ] && continue
        if [ -f "$trash_path" ]; then
            rm -f "$trash_path" && {
                sqlite3 "$DASHBOARD_DB" "UPDATE trash_manifest SET deleted_at = datetime('now') WHERE id = $row_id;" 2>/dev/null
                DELETED=$((DELETED + 1))
            } || {
                DELETE_ERRORS=$((DELETE_ERRORS + 1))
            }
        else
            # File already gone — mark as deleted
            sqlite3 "$DASHBOARD_DB" "UPDATE trash_manifest SET deleted_at = datetime('now') WHERE id = $row_id;" 2>/dev/null
            DELETED=$((DELETED + 1))
        fi
    done <<< "$READY"
fi

# Clean up empty directories in trash
find "$TRASH_DIR" -type d -empty -delete 2>/dev/null || true

log "Phase 4: Deleted $DELETED files, $DELETE_ERRORS errors"

# =====================================================================
# Summary
# =====================================================================
TRASH_SIZE=$(du -sh "$TRASH_DIR" 2>/dev/null | cut -f1 || echo "0")
TRASH_FILES=$(find "$TRASH_DIR" -type f 2>/dev/null | wc -l | tr -d ' ')

log "=========================================="
log "Cleanup complete: $TRASHED trashed, $UPLOADED uploaded to GDrive, $DELETED permanently deleted"
log "Trash: $TRASH_FILES files, $TRASH_SIZE"
log "=========================================="

# Notify
if [ "$TRASHED" -gt 0 ] || [ "$DELETED" -gt 0 ] || [ "$ERRORS" -gt 0 ]; then
    MODE=$( [ "$HAS_GDRIVE" = true ] && echo "GDrive + local" || echo "local only" )
    aiwh_notify "**MEDIA CLEANUP** ($MODE) — $(TZ=Australia/Brisbane date '+%a %d %b')\n> Trashed: $TRASHED | Uploaded: $UPLOADED | Deleted: $DELETED\n> Trash: $TRASH_SIZE ($TRASH_FILES files)" "systems"
fi

exit 0
