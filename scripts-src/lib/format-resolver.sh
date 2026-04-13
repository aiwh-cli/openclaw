#!/bin/bash
# format-resolver.sh — Shell wrapper for format_resolver.py
# Source this in shell scripts: source /opt/AIWH/core/scripts/lib/format-resolver.sh
#
# Usage:
#   resolve_format instagram image_post   # prints "4:5" or "null"
#   resolve_format x video_reel           # prints "16:9"

_FR_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

resolve_format() {
  local platform="$1"
  local content_type="$2"
  local pillars_path="${3:-}"
  if [[ -n "$pillars_path" ]]; then
    python3 "$_FR_SCRIPT_DIR/format_resolver.py" resolve "$platform" "$content_type" "$pillars_path"
  else
    python3 "$_FR_SCRIPT_DIR/format_resolver.py" resolve "$platform" "$content_type"
  fi
}

get_all_formats() {
  python3 "$_FR_SCRIPT_DIR/format_resolver.py" all
}
