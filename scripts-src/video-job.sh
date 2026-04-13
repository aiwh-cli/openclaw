#!/bin/bash

source /opt/AIWH/core/scripts/lib/env.sh
set -e

DB_PATH="${CLIENT_ROOT:-/opt/AIWH/client}/data/video-jobs.db"
AVATAR_CONFIG="${CLIENT_ROOT:-/opt/AIWH/client}/config/avatar-config.json"
DB_UPDATE="$(dirname "$0")/lib/db-update.py"

# Helper: Get avatar_look_id for a pillar from config
get_avatar_look_id() {
  local pillar="$1"
  if [ -z "$pillar" ] || [ ! -f "$AVATAR_CONFIG" ]; then
    echo ""
    return
  fi
  python3 -c "
import json, sys
with open(sys.argv[1]) as f:
    cfg = json.load(f)
p = cfg.get('pillars',{}).get(sys.argv[2],{})
print(p.get('avatar_look_id',''))
" "$AVATAR_CONFIG" "$pillar" 2>/dev/null
}

# Helper: Get ISO 8601 timestamp
iso_now() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

# Helper: Run db-update.py
db() {
  python3 "$DB_UPDATE" "$DB_PATH" "$@"
}

# Helper: Validate status (delegated to Python via VALID_STATUSES)
validate_status() {
  local status="$1"
  local valid_statuses=(
    'draft'
    'planned'
    'scripted'
    'voice_ready'
    'avatar_processing'
    'avatar_ready'
    'captioned'
    'qa_passed'
    'approved'
    'scheduled'
    'posted'
    'script_too_long'
    'voice_failed'
    'avatar_failed'
    'avatar_timeout'
    'caption_failed'
    'qa_failed'
    'rejected'
    'urgent_review'
  )

  for valid in "${valid_statuses[@]}"; do
    if [ "$valid" == "$status" ]; then
      return 0
    fi
  done

  echo "ERROR: Invalid status '$status'" >&2
  return 1
}

# Command: create
cmd_create() {
  local topic="$1"
  local pillar=""
  local hook=""
  local platforms=""
  local priority="normal"
  local scheduled_for_date=""

  shift
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --pillar)
        pillar="$2"
        shift 2
        ;;
      --hook)
        hook="$2"
        shift 2
        ;;
      --platforms)
        platforms="$2"
        shift 2
        ;;
      --priority)
        priority="$2"
        shift 2
        ;;
      --scheduled-for-date)
        scheduled_for_date="$2"
        shift 2
        ;;
      *)
        echo "Unknown option: $1" >&2
        exit 1
        ;;
    esac
  done

  # Auto-resolve avatar_look_id from pillar
  local avatar_look_id=""
  if [ -n "$pillar" ]; then
    avatar_look_id=$(get_avatar_look_id "$pillar")
  fi

  # Convert platforms to JSON if provided
  local platform_targets=""
  if [ -n "$platforms" ]; then
    platform_targets='{"instagram": false, "twitter": false, "tiktok": false, "youtube": false'
    IFS=',' read -ra PLATFORMS <<< "$platforms"
    for platform in "${PLATFORMS[@]}"; do
      platform=$(echo "$platform" | xargs)  # trim whitespace
      platform_targets="${platform_targets/\"${platform}\": false/\"${platform}\": true}"
    done
    platform_targets="${platform_targets}}"
  fi

  # Build args for db-update.py create_job
  local args=("create_job" "$topic")
  [ -n "$pillar" ] && args+=("--pillar" "$pillar")
  [ -n "$hook" ] && args+=("--hook" "$hook")
  [ -n "$platform_targets" ] && args+=("--platforms" "$platform_targets")
  [ -n "$priority" ] && args+=("--priority" "$priority")
  [ -n "$scheduled_for_date" ] && args+=("--scheduled-for-date" "$scheduled_for_date")
  [ -n "$avatar_look_id" ] && args+=("--avatar-look-id" "$avatar_look_id")

  db "${args[@]}"
}

# Command: update
cmd_update() {
  local job_id="$1"
  shift

  # Check if job exists
  local exists=$(db count_jobs "$job_id")
  if [ "$exists" -eq 0 ]; then
    echo "ERROR: Job not found: $job_id" >&2
    exit 1
  fi

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --status)
        validate_status "$2" || exit 1
        db update_field "$job_id" status "$2"
        shift 2
        ;;
      --script)
        db update_field "$job_id" script "$2"
        shift 2
        ;;
      --voice-path)
        db update_field "$job_id" voice_audio_path "$2"
        shift 2
        ;;
      --avatar-video)
        db update_field "$job_id" avatar_video_path "$2"
        shift 2
        ;;
      --heygen-id)
        db update_field "$job_id" heygen_video_id "$2"
        shift 2
        ;;
      --captioned-video)
        db update_field "$job_id" captioned_video_path "$2"
        shift 2
        ;;
      --priority)
        db update_field "$job_id" priority "$2"
        shift 2
        ;;
      --scheduled-for-date)
        db update_field "$job_id" scheduled_for_date "$2"
        shift 2
        ;;
      --avatar-look-id)
        db update_field "$job_id" avatar_look_id "$2"
        shift 2
        ;;
      --transcript)
        db update_field "$job_id" final_transcript "$2"
        shift 2
        ;;
      *)
        echo "Unknown option: $1" >&2
        exit 1
        ;;
    esac
  done

  # Return updated record
  db select_job "$job_id"
}

# Command: query
cmd_query() {
  local status="$1"
  validate_status "$status" || exit 1
  db select_jobs_by_status "$status"
}

# Command: list
cmd_list() {
  db select_all_jobs
}

# Command: get
cmd_get() {
  local job_id="$1"

  local exists=$(db count_jobs "$job_id")
  if [ "$exists" -eq 0 ]; then
    echo "ERROR: Job not found: $job_id" >&2
    exit 1
  fi

  db select_job "$job_id"
}

# Command: retry
cmd_retry() {
  local job_id="$1"
  db retry_job "$job_id"
}

# Main dispatcher
case "${1:-}" in
  create)
    shift
    cmd_create "$@"
    ;;
  update)
    shift
    cmd_update "$@"
    ;;
  query)
    shift
    cmd_query "$@"
    ;;
  list)
    cmd_list
    ;;
  get)
    shift
    cmd_get "$@"
    ;;
  retry)
    shift
    cmd_retry "$@"
    ;;
  *)
    echo "Usage: video-job.sh <command> [args]"
    echo ""
    echo "Commands:"
    echo "  create <topic> [--pillar <cat>] [--hook <text>] [--platforms <list>] [--priority urgent|normal] [--scheduled-for-date YYYY-MM-DD]"
    echo "  update <job_id> [--status <status>] [--script <text>] [--voice-path <path>] [--priority urgent|normal] [--scheduled-for-date YYYY-MM-DD]"
    echo "                   [--avatar-video <path>] [--heygen-id <id>]"
    echo "                   [--captioned-video <path>] [--transcript <text>]"
    echo "  query <status>"
    echo "  list"
    echo "  get <job_id>"
    echo "  retry <job_id>"
    exit 1
    ;;
esac
