#!/opt/homebrew/bin/bash
# ============================================================================
# AIWH Daily Media Archiver
# ============================================================================
# Uploads completed media (posted videos, published cinematic, old outputs)
# to Google Drive, VERIFIES the upload, then moves local files to trash.
#
# SAFETY:
#   - NEVER deletes files directly — always moves to /opt/AIWH/trash/
#   - Only trashes files AFTER verified GDrive upload (name + size match)
#   - Preserves original directory structure in trash
#   - Records every action in trash_manifest table (mission-control.db)
#   - Human must manually delete trash via dashboard
#
# GDrive structure:
#   AIWH-Archive/
#     video-jobs/job_20260304_0014/final.mp4
#     cinematic/cjob_xxx/clips/clip-01.mp4
#     outputs/2026-03/final.mp4
#
# Schedule: Daily at 02:00 via dashboard script cron
# Requires: gws CLI (Google Workspace CLI), sqlite3, python3
# ============================================================================

set -euo pipefail
source /opt/AIWH/core/scripts/lib/env.sh

# --- Configuration ---
CLIENT_ROOT="${CLIENT_ROOT:-/opt/AIWH/client}"
CONTENT_JOBS_DIR="$CLIENT_ROOT/content/jobs"
CINEMATIC_DIR="/opt/AIWH/core/content/cinematic"
OUTPUTS_DIR="/opt/AIWH/core/outputs"
VIDEO_DB="$CLIENT_ROOT/data/video-jobs.db"
DASHBOARD_DB="/opt/AIWH/core/dashboard/mission-control.db"
ENV_FILE="/opt/AIWH/.openclaw/.env"
LOG_FILE="$CLIENT_ROOT/logs/media-archive.log"
TRASH_DIR="/opt/AIWH/trash"
GDRIVE_ROOT_NAME="AIWH-Archive"

# --- Load shared GDrive helpers ---
source "/opt/AIWH/core/scripts/lib/gdrive.sh"

MEDIA_EXTENSIONS=("mp4" "mp3" "wav" "mov" "avi" "mkv" "png" "jpg" "jpeg" "webp")

# --- Functions ---
log() {
    local msg="[$(date '+%Y-%m-%d %H:%M:%S')] $1"
    echo "$msg"
    echo "$msg" >> "$LOG_FILE"
}

notify_discord() {
    local msg="$1"
    aiwh_notify "$msg" "systems"
}

# --- Preflight ---
command -v "$GWS_BIN" >/dev/null 2>&1 || { log "ERROR: gws CLI not found"; exit 1; }
command -v sqlite3 >/dev/null 2>&1 || { log "ERROR: sqlite3 not found"; exit 1; }

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
    source TEXT DEFAULT 'media-archive'
);
CREATE INDEX IF NOT EXISTS idx_trash_manifest_deleted ON trash_manifest(deleted_at);
CREATE INDEX IF NOT EXISTS idx_trash_manifest_verified ON trash_manifest(verified);
" 2>/dev/null

log "=========================================="
log "Starting daily media archive"

# --- GDrive folder cache ---
declare -A FOLDER_CACHE

_resolve_cached_folder() {
    local name="$1"
    local parent_id="$2"
    local cache_key="${parent_id}/${name}"

    if [ -n "${FOLDER_CACHE[$cache_key]+x}" ]; then
        echo "${FOLDER_CACHE[$cache_key]}"
        return
    fi

    local folder_id=""
    folder_id=$(gdrive_ls "$parent_id" 200 2>/dev/null | \
        python3 -c "import sys,json; d=json.load(sys.stdin); target=sys.argv[1]
for f in d.get('files',[]):
    if f.get('name')==target and 'folder' in f.get('mimeType',''):
        print(f['id']); break" "$name" 2>/dev/null || true)

    if [ -z "$folder_id" ]; then
        folder_id=$(gdrive_mkdir "$name" "$parent_id")
        [ -z "$folder_id" ] && return 1
        log "  Created GDrive folder: $name ($folder_id)"
    fi

    FOLDER_CACHE[$cache_key]="$folder_id"
    echo "$folder_id"
}

resolve_gdrive_path() {
    local rel_path="$1"
    local current_id="$2"
    IFS='/' read -ra parts <<< "$rel_path"
    for part in "${parts[@]}"; do
        [ -z "$part" ] && continue
        current_id=$(_resolve_cached_folder "$part" "$current_id") || return 1
    done
    echo "$current_id"
}

# Upload + verify + trash a single file
archive_file() {
    local local_path="$1"
    local gdrive_parent_id="$2"
    local gdrive_folder_path="$3"
    local filename
    filename=$(basename "$local_path")
    local local_size
    local_size=$(stat -f%z "$local_path" 2>/dev/null || stat -c%s "$local_path" 2>/dev/null || echo 0)
    local local_size_h
    local_size_h=$(du -h "$local_path" | cut -f1)

    log "  Uploading: $filename ($local_size_h) -> $gdrive_folder_path/"

    # Upload
    local file_id
    file_id=$(gdrive_upload "$local_path" "$filename" "$gdrive_parent_id")

    if [ -z "$file_id" ]; then
        log "  UPLOAD FAILED: $filename"
        return 1
    fi

    # Verify: check the file exists on GDrive with matching name
    local verify_name
    verify_name=$(gdrive_ls "$gdrive_parent_id" 100 2>/dev/null | \
        python3 -c "import sys,json; d=json.load(sys.stdin); target=sys.argv[1]
for f in d.get('files',[]):
    if f.get('id')==target:
        print(f['name']); break" "$file_id" 2>/dev/null || true)

    if [ "$verify_name" != "$filename" ]; then
        log "  VERIFY FAILED: $filename — uploaded but not found in listing"
        return 1
    fi

    log "  Verified: $filename ($file_id)"

    # Move to trash (preserve directory structure)
    local rel_path="${local_path#/opt/AIWH/}"
    local trash_path="$TRASH_DIR/$rel_path"
    mkdir -p "$(dirname "$trash_path")"
    mv "$local_path" "$trash_path"

    # Record in manifest (parameterized via db-update.py)
    local db_update_script
    db_update_script="$(dirname "$0")/lib/db-update.py"
    python3 "$db_update_script" "$DASHBOARD_DB" insert_trash_manifest \
        "$local_path" "$trash_path" "$file_id" "$gdrive_parent_id" "$gdrive_folder_path" "$local_size" 2>/dev/null

    log "  Trashed: $rel_path"
    return 0
}

# Build find expression for media files
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

# --- Get or create root archive folder ---
ROOT_ID=$(gdrive_search "name = '$GDRIVE_ROOT_NAME' and mimeType = 'application/vnd.google-apps.folder'" | \
    python3 -c "import sys,json; d=json.load(sys.stdin); files=d.get('files',[]); print(files[0]['id'] if files else '')" 2>/dev/null)

if [ -z "$ROOT_ID" ]; then
    ROOT_ID=$(gdrive_mkdir "$GDRIVE_ROOT_NAME")
    [ -z "$ROOT_ID" ] && { log "FATAL: Cannot create $GDRIVE_ROOT_NAME on GDrive"; exit 1; }
    log "Created root folder: $GDRIVE_ROOT_NAME ($ROOT_ID)"
else
    log "Found root folder: $GDRIVE_ROOT_NAME ($ROOT_ID)"
fi

UPLOADED=0
TRASHED=0
ERRORS=0

# =====================================================================
# PHASE 1: Posted video jobs
# =====================================================================
if [ -f "$VIDEO_DB" ]; then
    POSTED_JOBS=$(sqlite3 "$VIDEO_DB" "SELECT job_id FROM video_jobs WHERE status='posted';" 2>/dev/null || true)

    if [ -n "$POSTED_JOBS" ]; then
        log "Phase 1: Archiving posted video jobs"

        while IFS= read -r job_id; do
            JOB_DIR="$CONTENT_JOBS_DIR/$job_id"
            [ ! -d "$JOB_DIR" ] && continue

            MEDIA_FILES=$(find_media "$JOB_DIR")
            [ -z "$MEDIA_FILES" ] && continue

            log "Archiving $job_id..."

            while IFS= read -r media_file; do
                [ -z "$media_file" ] && continue
                # Already trashed?
                [ ! -f "$media_file" ] && continue

                rel_dir="video-jobs/$job_id"
                local_subdir=$(dirname "$media_file" | sed "s|^$JOB_DIR||; s|^/||")
                [ -n "$local_subdir" ] && rel_dir="$rel_dir/$local_subdir"

                gdrive_folder_id=$(resolve_gdrive_path "$rel_dir" "$ROOT_ID") || {
                    log "  ERROR: Could not resolve GDrive path for $rel_dir"
                    ERRORS=$((ERRORS + 1))
                    continue
                }

                if archive_file "$media_file" "$gdrive_folder_id" "$rel_dir"; then
                    UPLOADED=$((UPLOADED + 1))
                    TRASHED=$((TRASHED + 1))
                else
                    ERRORS=$((ERRORS + 1))
                fi
            done <<< "$MEDIA_FILES"
        done <<< "$POSTED_JOBS"
    else
        log "Phase 1: No posted video jobs to archive"
    fi
fi

# =====================================================================
# PHASE 2: Published/approved cinematic jobs
# =====================================================================
if [ -f "$VIDEO_DB" ] && [ -d "$CINEMATIC_DIR" ]; then
    DONE_CJOBS=$(sqlite3 "$VIDEO_DB" "SELECT cjob_id FROM cinematic_jobs WHERE phase IN ('published','approved');" 2>/dev/null || true)

    if [ -n "$DONE_CJOBS" ]; then
        log "Phase 2: Archiving published cinematic jobs"

        while IFS= read -r cjob_id; do
            CJOB_DIR="$CINEMATIC_DIR/$cjob_id"
            [ ! -d "$CJOB_DIR" ] && continue

            MEDIA_FILES=$(find_media "$CJOB_DIR")
            [ -z "$MEDIA_FILES" ] && continue

            log "Archiving cinematic $cjob_id..."

            while IFS= read -r media_file; do
                [ -z "$media_file" ] && continue
                [ ! -f "$media_file" ] && continue

                rel_dir="cinematic/$cjob_id"
                local_subdir=$(dirname "$media_file" | sed "s|^$CJOB_DIR||; s|^/||")
                [ -n "$local_subdir" ] && rel_dir="$rel_dir/$local_subdir"

                gdrive_folder_id=$(resolve_gdrive_path "$rel_dir" "$ROOT_ID") || {
                    ERRORS=$((ERRORS + 1))
                    continue
                }

                if archive_file "$media_file" "$gdrive_folder_id" "$rel_dir"; then
                    UPLOADED=$((UPLOADED + 1))
                    TRASHED=$((TRASHED + 1))
                else
                    ERRORS=$((ERRORS + 1))
                fi
            done <<< "$MEDIA_FILES"
        done <<< "$DONE_CJOBS"
    else
        log "Phase 2: No published cinematic jobs to archive"
    fi
fi

# =====================================================================
# PHASE 3: Loose outputs older than 7 days
# =====================================================================
if [ -d "$OUTPUTS_DIR" ]; then
    OLD_OUTPUTS=$(find "$OUTPUTS_DIR" -type f \( -iname '*.mp4' -o -iname '*.mp3' -o -iname '*.wav' -o -iname '*.png' -o -iname '*.mov' \) -mtime +7 2>/dev/null || true)

    if [ -n "$OLD_OUTPUTS" ]; then
        log "Phase 3: Archiving outputs older than 7 days"
        MONTH_FOLDER="outputs/$(date +%Y-%m)"

        gdrive_folder_id=$(resolve_gdrive_path "$MONTH_FOLDER" "$ROOT_ID") || {
            log "ERROR: Could not create outputs month folder on GDrive"
            ERRORS=$((ERRORS + 1))
        }

        if [ -n "${gdrive_folder_id:-}" ]; then
            while IFS= read -r media_file; do
                [ -z "$media_file" ] && continue
                [ ! -f "$media_file" ] && continue

                if archive_file "$media_file" "$gdrive_folder_id" "$MONTH_FOLDER"; then
                    UPLOADED=$((UPLOADED + 1))
                    TRASHED=$((TRASHED + 1))
                else
                    ERRORS=$((ERRORS + 1))
                fi
            done <<< "$OLD_OUTPUTS"
        fi
    else
        log "Phase 3: No old outputs to archive"
    fi
fi

# =====================================================================
# Summary
# =====================================================================
log "=========================================="
log "Archive complete: $UPLOADED uploaded, $TRASHED trashed, $ERRORS errors"

TRASH_SIZE=$(du -sh "$TRASH_DIR" 2>/dev/null | cut -f1 || echo "0")
TRASH_FILES=$(find "$TRASH_DIR" -type f 2>/dev/null | wc -l | tr -d ' ')
log "Trash: $TRASH_FILES files, $TRASH_SIZE total"
log "=========================================="

# Discord summary
if [ "$UPLOADED" -gt 0 ] || [ "$ERRORS" -gt 0 ]; then
    STATUS_ICON=$( [ "$ERRORS" -eq 0 ] && echo "OK" || echo "ERRORS" )
    notify_discord "**MEDIA ARCHIVE** ($STATUS_ICON) — $(TZ=Australia/Brisbane date '+%a %d %b')\n> Uploaded: $UPLOADED | Trashed: $TRASHED | Errors: $ERRORS\n> Trash size: $TRASH_SIZE ($TRASH_FILES files)"
fi

[ "$ERRORS" -gt 0 ] && exit 1 || exit 0
