#!/bin/bash
# ============================================================================
# GHL CLI — Bash wrapper for ghl-api.py
# ============================================================================
# Usage: ghl.sh contacts list --limit 5
#        ghl.sh contacts create --email "x@y.com" --first "Jo"
#        ghl.sh opportunities list-pipelines
#        ghl.sh conversations send --id "conv123" --type SMS --message "Hello"
#
# Sources env.sh for PATH, loads GHL secrets, calls ghl-api.py.
# Agents call this via bash tool.
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/lib/env.sh"

# Load GHL credentials
aiwh_load_secrets GHL_API_KEY GHL_LOCATION_ID

if [[ -z "${GHL_API_KEY:-}" || -z "${GHL_LOCATION_ID:-}" ]]; then
  echo "ERROR: GHL credentials not found. Run: python3 secrets.py store GHL_API_KEY '<token>'" >&2
  exit 1
fi

export GHL_API_KEY GHL_LOCATION_ID

exec python3 "${SCRIPT_DIR}/lib/ghl-api.py" "$@"
