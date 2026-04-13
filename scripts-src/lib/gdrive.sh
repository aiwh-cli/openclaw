#!/bin/bash
# ============================================================================
# Google Drive helpers using gws CLI (Google Workspace CLI)
# ============================================================================
# Source this file: source "$(dirname "$0")/lib/gdrive.sh"
#
# Provides:
#   gdrive_upload FILE NAME PARENT_ID  → prints file ID
#   gdrive_ls PARENT_ID                → prints JSON files array
#   gdrive_search QUERY [PARENT_ID]    → prints JSON files array
#   gdrive_mkdir NAME [PARENT_ID]      → prints folder ID
#   gdrive_delete FILE_ID              → deletes permanently
#   gdrive_download FILE_ID OUT_PATH   → downloads file
#   gdrive_share FILE_ID               → shares with anyone (reader)
#
# Uses ADC (Application Default Credentials) — no GOG_KEYRING_PASSWORD needed.
# ============================================================================

GWS_BIN="${GWS_BIN:-/opt/homebrew/bin/gws}"

# Suppress gws token cache warnings (harmless with ADC fallback)
_gws() {
    "$GWS_BIN" "$@" 2>&1 | grep -v "^warning:" | grep -v "^hint:" | grep -v "^Using keyring"
}

# Upload a file to Google Drive
# Usage: gdrive_upload /path/to/file "display-name.ext" "parentFolderId"
# Prints: file ID on success, empty on failure
gdrive_upload() {
    local file="$1"
    local name="$2"
    local parent_id="$3"
    _gws drive files create \
        --upload "$file" \
        --json "{\"name\":\"$name\",\"parents\":[\"$parent_id\"]}" \
        | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null
}

# List files in a folder
# Usage: gdrive_ls "parentFolderId" [pageSize]
# Prints: JSON with files array
gdrive_ls() {
    local parent_id="$1"
    local page_size="${2:-100}"
    _gws drive files list \
        --params "{\"q\":\"'${parent_id}' in parents\",\"pageSize\":${page_size},\"fields\":\"files(id,name,mimeType,size,modifiedTime)\"}"
}

# Search files by name query
# Usage: gdrive_search "name contains 'backup'" [parentFolderId]
# Prints: JSON with files array
gdrive_search() {
    local query="$1"
    local parent_id="${2:-}"
    local q="$query"
    if [ -n "$parent_id" ]; then
        q="$query and '${parent_id}' in parents"
    fi
    _gws drive files list \
        --params "{\"q\":\"${q}\",\"fields\":\"files(id,name,mimeType,size,modifiedTime)\",\"orderBy\":\"modifiedTime desc\"}"
}

# Create a folder
# Usage: gdrive_mkdir "FolderName" ["parentFolderId"]
# Prints: folder ID
gdrive_mkdir() {
    local name="$1"
    local parent_id="${2:-}"
    local parents_json=""
    if [ -n "$parent_id" ]; then
        parents_json=",\"parents\":[\"$parent_id\"]"
    fi
    _gws drive files create \
        --json "{\"name\":\"$name\",\"mimeType\":\"application/vnd.google-apps.folder\"${parents_json}}" \
        | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null
}

# Delete a file permanently
# Usage: gdrive_delete "fileId"
gdrive_delete() {
    local file_id="$1"
    _gws drive files delete --params "{\"fileId\":\"$file_id\"}" >/dev/null 2>&1
}

# Download a file
# Usage: gdrive_download "fileId" "/path/to/output"
gdrive_download() {
    local file_id="$1"
    local output="$2"
    _gws drive files get \
        --params "{\"fileId\":\"$file_id\",\"alt\":\"media\"}" \
        --output "$output"
}

# Share a file with anyone (read-only link)
# Usage: gdrive_share "fileId"
gdrive_share() {
    local file_id="$1"
    _gws drive permissions create \
        --params "{\"fileId\":\"$file_id\"}" \
        --json '{"role":"reader","type":"anyone"}' >/dev/null 2>&1
}
