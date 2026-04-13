#!/bin/bash
# ============================================================================
# Shared environment setup for AIWH scripts
# ============================================================================
# Source this file at the top of any script that runs via OpenClaw crons or launchd:
#   source "$(dirname "$0")/lib/env.sh"   (from scripts/)
#   source "/opt/AIWH/core/scripts/lib/env.sh"  (from anywhere)
#
# Provides:
#   1. PATH — ensures homebrew tools are available
#   2. aiwh_load_secrets KEY1 KEY2 ... — loads secrets from encrypted store
#      Falls back to .env if secrets.enc doesn't exist yet
# ============================================================================

export PATH="/opt/AIWH/bin:/opt/homebrew/bin:/opt/homebrew/sbin:$PATH"

# OpenShell / Docker (Colima) — container isolation for agents
export DOCKER_HOST="${DOCKER_HOST:-unix:///Users/roboai/.colima/docker.sock}"
export XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-/opt/AIWH/.openshell/config}"
export XDG_DATA_HOME="${XDG_DATA_HOME:-/opt/AIWH/.openshell/data}"

AIWH_SECRETS_PY="/opt/AIWH/core/scripts/lib/secrets.py"
AIWH_SECRETS_FILE="${CLIENT_ROOT:-/opt/AIWH/client}/config/secrets.enc"
AIWH_ENV_FILE="/opt/AIWH/.openclaw/.env"

# Load secrets — encrypted store preferred, .env fallback
# Usage: aiwh_load_secrets KEY1 KEY2 ...
# Usage: aiwh_load_secrets --all
# ── Notification system ───────────────────────────────────────
# Uses OpenClaw's native outbound messaging — works with any configured channel.
# Falls back to Discord webhook if openclaw CLI isn't available.
#
# Usage: aiwh_notify "Pipeline complete for job X"
# Usage: aiwh_notify "Cost alert: $50 today" "spend"
#
# Categories map to notification targets in notifications.json:
#   general  — default, general updates
#   systems  — ops alerts, backup status, errors
#   publish  — video published, buffer status
#   spend    — cost alerts, budget warnings

AIWH_NOTIFY_CONFIG="${CLIENT_ROOT:-/opt/AIWH/client}/config/notifications.json"

aiwh_notify() {
  local message="$1"
  local category="${2:-general}"

  # Try OpenClaw native delivery first
  if command -v openclaw &>/dev/null && [[ -f "$AIWH_NOTIFY_CONFIG" ]]; then
    local channel target
    channel=$(python3 -c "import json; c=json.load(open('$AIWH_NOTIFY_CONFIG')); print(c.get('$category',c.get('general',{})).get('channel',''))" 2>/dev/null)
    target=$(python3 -c "import json; c=json.load(open('$AIWH_NOTIFY_CONFIG')); print(c.get('$category',c.get('general',{})).get('target',''))" 2>/dev/null)

    if [[ -n "$channel" && -n "$target" ]]; then
      if openclaw message send --channel "$channel" -t "$target" -m "$message" 2>/dev/null; then
        return 0
      fi
      # Primary failed — try failover channel if configured
      local fo_channel fo_target
      fo_channel=$(python3 -c "import json; c=json.load(open('$AIWH_NOTIFY_CONFIG')); print(c.get('failover',{}).get('channel',''))" 2>/dev/null)
      fo_target=$(python3 -c "import json; c=json.load(open('$AIWH_NOTIFY_CONFIG')); print(c.get('failover',{}).get('target',''))" 2>/dev/null)
      if [[ -n "$fo_channel" && -n "$fo_target" ]]; then
        openclaw message send --channel "$fo_channel" -t "$fo_target" -m "[Failover] $message" 2>/dev/null && return 0
      fi
    fi
  fi

  # Fallback: Discord webhook (legacy — for dev machine or unconfigured clients)
  local webhook=""
  case "$category" in
    systems) webhook="${DISCORD_WEBHOOK_SYSTEMS_BAY:-}" ;;
    publish) webhook="${DISCORD_WEBHOOK_PUBLISH_LEDGER:-}" ;;
    spend)   webhook="${DISCORD_WEBHOOK_SPEND_LEDGER:-}" ;;
    *)       webhook="${DISCORD_WEBHOOK_URL:-}" ;;
  esac

  if [[ -n "$webhook" ]]; then
    local payload
    payload=$(jq -n --arg msg "$message" '{content: $msg}' 2>/dev/null || echo "{\"content\":\"$message\"}")
    curl -s -X POST "$webhook" -H "Content-Type: application/json" -d "$payload" >/dev/null 2>&1 || true
  fi
}

aiwh_load_secrets() {
  if [[ -f "$AIWH_SECRETS_FILE" ]] && [[ -f "$AIWH_SECRETS_PY" ]]; then
    # Use encrypted secrets store — output is "export KEY='value'" lines
    local _secrets_output
    _secrets_output="$(python3 "$AIWH_SECRETS_PY" load "$@" 2>/dev/null || true)"
    if [[ -n "$_secrets_output" ]]; then
      eval "$_secrets_output"
      return 0
    fi
  fi
  # Fallback: source .env (legacy, will be removed after migration verified)
  if [[ -f "$AIWH_ENV_FILE" ]]; then
    set -a
    source "$AIWH_ENV_FILE"
    set +a
  fi
}

# ── Timeout utility ──────────────────────────────────────────
# macOS has no GNU timeout. Use gtimeout (brew install coreutils) or shell fallback.
# Usage: aiwh_run_with_timeout 600 python3 my_script.py --flag
# Returns the command's exit code, or 124 on timeout (matches GNU timeout behavior).
aiwh_run_with_timeout() {
  local secs="$1"; shift
  if command -v gtimeout &>/dev/null; then
    gtimeout --signal=TERM --kill-after=10 "$secs" "$@"
    return $?
  fi
  # Shell fallback: run in background, watchdog kills after $secs
  "$@" &
  local cmd_pid=$!
  ( sleep "$secs" && kill -TERM "$cmd_pid" 2>/dev/null && sleep 10 && kill -KILL "$cmd_pid" 2>/dev/null ) &
  local watchdog_pid=$!
  wait "$cmd_pid" 2>/dev/null
  local rc=$?
  kill "$watchdog_pid" 2>/dev/null; wait "$watchdog_pid" 2>/dev/null
  # If killed by SIGTERM (143), return 124 to match GNU timeout convention
  [[ $rc -eq 143 ]] && return 124
  return $rc
}

# ── Script separation (Phase 72) ─────────────────────────────
# core/scripts/ = read-only templates (updated by git)
# client/scripts/ = client customizations (preserved during updates)
# Resolution: client version wins if it exists, otherwise core version.

# Resolve script path: client/scripts/ override → core/scripts/ fallback
# Usage: script_path=$(aiwh_resolve_script "morning-briefing.sh")
aiwh_resolve_script() {
  local name="$1"
  local client_path="${CLIENT_ROOT:-/opt/AIWH/client}/scripts/$name"
  [ -f "$client_path" ] && echo "$client_path" || echo "/opt/AIWH/core/scripts/$name"
}

# Copy a script to client/scripts/ for customization by Branson.
# Engine scripts (infrastructure, security, licensing) are blocked.
# Usage: aiwh_activate_script "morning-briefing.sh"
aiwh_activate_script() {
  local name="$1"
  # Engine scripts — never activate
  case "$name" in
    lib/*|update-*|factory-*|prepare-*|reset-*|safe-bash*|delete-guard*|\
    hw-fingerprint*|license-check*|module-manager*|watchdog*|apply-upgrade*|\
    apply-agent-templates*|qa-test*|push-update*|start-*|sync-auth-profiles*|\
    aiwh-cli*|git-init-agents*|onboarding*|gen-docs-*)
      echo "ERROR: $name is an engine script and cannot be customized" >&2
      return 1
      ;;
  esac
  local src="/opt/AIWH/core/scripts/$name"
  local dst="${CLIENT_ROOT:-/opt/AIWH/client}/scripts/$name"
  [ -f "$src" ] || { echo "ERROR: $src not found" >&2; return 1; }
  [ -f "$dst" ] && { echo "Already activated at $dst" >&2; return 0; }
  mkdir -p "$(dirname "$dst")"
  cp "$src" "$dst" && chmod 755 "$dst"
  echo "Activated: $dst — edit this copy, core version stays as read-only template"
}

# Install a vetted skill to client/skills/ for this client.
# Usage: aiwh_install_skill /tmp/skill-name
# Product skills live in core/config/skills/ (read-only). Client skills go here.
# NEVER use "openclaw skills install" — it targets workspace/skills/ which bypasses filtering.
aiwh_install_skill() {
  local src="$1"
  [ -d "$src" ] || { echo "ERROR: $src is not a directory" >&2; return 1; }
  [ -f "$src/SKILL.md" ] || { echo "ERROR: $src/SKILL.md not found — not a valid skill" >&2; return 1; }
  local name=$(basename "$src")
  local dst="${CLIENT_ROOT:-/opt/AIWH/client}/skills/$name"
  [ -d "$dst" ] && { echo "Skill already installed at $dst" >&2; return 0; }
  mkdir -p "$dst"
  cp -r "$src"/* "$dst"/
  echo "Installed: $dst — skill will be discovered on next session"
}
