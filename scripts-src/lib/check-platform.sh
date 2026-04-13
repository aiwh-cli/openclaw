#!/bin/bash
# ============================================================================
# check-platform.sh — Deterministic platform detection for any LLM tier
# ============================================================================
# Returns the active platform ID for a given category (crm, accounting, etc.)
# Designed to work when called by Haiku-tier agents — one call, one answer.
#
# Usage:
#   check-platform.sh crm          → "gohighlevel" or "none"
#   check-platform.sh accounting   → "xero" or "none"
#   check-platform.sh --all        → JSON: {"crm":"gohighlevel","accounting":"none",...}
#   check-platform.sh --list       → List all categories
#
# Returns exit 0 if a platform is found, exit 1 if "none".
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/env.sh"

REGISTRY="${REGISTRY:-/opt/AIWH/core/config/platform-registry.json}"

if [[ ! -f "$REGISTRY" ]]; then
  echo "none"
  exit 1
fi

# Check if a single credential exists in the secrets store
_has_credential() {
  local key="$1"
  aiwh_load_secrets "$key" 2>/dev/null
  [[ -n "${!key:-}" ]]
}

# Get active platform for a category
_detect_platform() {
  local category="$1"
  local result
  result=$(python3 -c "
import json, sys
reg = json.load(open('$REGISTRY'))
cat = reg.get('$category', [])
for p in cat:
    print(p['id'] + '|' + p['credential'])
" 2>/dev/null)

  while IFS='|' read -r platform_id credential_key; do
    [[ -z "$platform_id" ]] && continue
    if _has_credential "$credential_key"; then
      echo "$platform_id"
      return 0
    fi
  done <<< "$result"

  echo "none"
  return 1
}

# List all categories
_list_categories() {
  python3 -c "
import json
reg = json.load(open('$REGISTRY'))
for cat in sorted(reg.keys()):
    platforms = ', '.join(p['label'] for p in reg[cat])
    print(f'{cat}: {platforms}')
" 2>/dev/null
}

# Detect all categories as JSON
_detect_all() {
  local categories
  categories=$(python3 -c "
import json
reg = json.load(open('$REGISTRY'))
for cat in reg.keys():
    print(cat)
" 2>/dev/null)

  echo "{"
  local first=true
  while read -r cat; do
    [[ -z "$cat" ]] && continue
    local platform
    platform=$(_detect_platform "$cat")
    if [[ "$first" == "true" ]]; then
      first=false
    else
      echo ","
    fi
    printf '  "%s": "%s"' "$cat" "$platform"
  done <<< "$categories"
  echo ""
  echo "}"
}

# --- Main ---
case "${1:-}" in
  --all)
    _detect_all
    ;;
  --list)
    _list_categories
    ;;
  --help|-h|"")
    echo "Usage: check-platform.sh <category>  (crm, accounting, storage, email, video, voice)"
    echo "       check-platform.sh --all       (detect all categories as JSON)"
    echo "       check-platform.sh --list      (list available categories)"
    exit 0
    ;;
  *)
    _detect_platform "$1"
    ;;
esac
