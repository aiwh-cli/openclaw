#!/usr/bin/env bash
##############################################################################
# reset-client-data.sh — Reset client/ and .openclaw/ to shipping state.
#
# Called by prepare-for-shipping.sh. Wipes all AIWH-specific data so the
# Mac Mini starts clean for a new client. Preserves directory structure
# and DB schemas (empty tables, no rows).
#
# SAFETY:
#   * All destructive ops stash-first into $OPENCLAW/trash/reset-backup-<ts>/
#     (7-day recoverable). A janitor sweep removes trash >7 days old at the end.
#   * Refuses to touch any /opt/AIWH/* path unless --i-mean-it is passed.
#   * Requires operator to type "RESET CLIENT DATA" on stdin unless --dry-run.
#   * Every critical path is overridable via env var — tests run under /tmp.
#
# Usage:
#   reset-client-data.sh --dry-run
#       Preview what would happen. No stdin gate. No guards.
#
#   reset-client-data.sh --confirm --i-mean-it
#       Real run on real paths. Prompts for confirmation phrase.
#
#   printf 'RESET CLIENT DATA\n' | reset-client-data.sh \
#       --confirm --force-tty --i-mean-it
#       Non-interactive caller (prepare-for-shipping.sh, CI). --force-tty
#       lets stdin be a pipe instead of a real terminal.
#
#   CLIENT_ROOT=/tmp/x OPENCLAW_STATE_DIR=/tmp/y DASHBOARD_DIR=/tmp/z \
#     CORE=/tmp/c reset-client-data.sh --confirm --force-tty
#       Test harness — all paths under /tmp, no --i-mean-it needed.
#
# NEVER edit this script to bypass the guards. Edit the test harness instead:
#   openclaw/scripts-src/tests/reset-client-data.test.sh
##############################################################################
set -euo pipefail

# ── Env-var overrides (test harness sets these to /tmp/*) ───────────
CORE="${CORE:-/opt/AIWH/core}"
CLIENT="${CLIENT_ROOT:-/opt/AIWH/client}"
OPENCLAW="${OPENCLAW_STATE_DIR:-/opt/AIWH/.openclaw}"
DASHBOARD="${DASHBOARD_DIR:-/opt/AIWH/core/dashboard}"

# ── Flag parsing ────────────────────────────────────────────────────
DRY_RUN=false
CONFIRM=false
I_MEAN_IT=false
FORCE_TTY=false
while [[ $# -gt 0 ]]; do
    case "$1" in
        --dry-run)     DRY_RUN=true ;;
        --confirm)     CONFIRM=true ;;
        --i-mean-it)   I_MEAN_IT=true ;;
        --force-tty)   FORCE_TTY=true ;;
        -h|--help)
            sed -n '2,34p' "$0"
            exit 0
            ;;
        *) echo "Unknown flag: $1" >&2; exit 2 ;;
    esac
    shift
done

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }
err()  { echo -e "  ${RED}✗${NC} $1" >&2; }
step_num=0
step() { step_num=$((step_num + 1)); echo -e "\n${GREEN}[$step_num]${NC} $1"; }

# ── Path-refusal guard ─────────────────────────────────────────────
# Refuse to run if any critical var resolves under /opt/AIWH unless
# --i-mean-it. This is the guardrail that would have prevented the
# 2026-04-12 incident.
for v in CLIENT OPENCLAW DASHBOARD CORE; do
    val="${!v}"
    case "$val" in
        /opt/AIWH|/opt/AIWH/*)
            if ! $I_MEAN_IT; then
                err "REFUSING: $v=$val resolves under /opt/AIWH."
                err "Pass --i-mean-it if you really intend to wipe real data."
                err "For tests: export CLIENT_ROOT=/tmp/... OPENCLAW_STATE_DIR=/tmp/... DASHBOARD_DIR=/tmp/... CORE=/tmp/..."
                exit 2
            fi
            ;;
    esac
done

# ── Confirmation gate ──────────────────────────────────────────────
# --dry-run skips the prompt. Otherwise the caller must type the exact
# phrase. --force-tty allows stdin to be a pipe (for non-interactive
# shipping pipelines + the test harness).
if ! $DRY_RUN; then
    if ! $CONFIRM; then
        err "REFUSING: pass --confirm for a real run, or --dry-run to preview."
        exit 2
    fi
    if [[ ! -t 0 ]] && ! $FORCE_TTY; then
        err "REFUSING: stdin is not a TTY. Pass --force-tty if piping the confirmation phrase."
        exit 2
    fi
    echo -e "${YELLOW}This will wipe client data under:${NC}"
    echo "  CLIENT    = $CLIENT"
    echo "  OPENCLAW  = $OPENCLAW"
    echo "  DASHBOARD = $DASHBOARD"
    echo -n "Type 'RESET CLIENT DATA' to proceed: "
    read -r reply
    if [[ "$reply" != "RESET CLIENT DATA" ]]; then
        err "Confirmation phrase did not match. Aborting."
        exit 2
    fi
fi

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║           Reset Client Data — Clean for Shipping            ║"
echo "╚══════════════════════════════════════════════════════════════╝"
$DRY_RUN && echo -e "${YELLOW}DRY RUN — no changes will be made${NC}"

# ── Trash dir (move-to-trash-first for all destructive ops) ─────────
TRASH="$OPENCLAW/trash/reset-backup-$(date +%s)"
ensure_trash() {
    $DRY_RUN && return 0
    [[ -d "$TRASH" ]] || mkdir -p "$TRASH"
}

# stash_file: mv a file into $TRASH (flat). Falls back to rm -f if mv fails
# (e.g., cross-filesystem). Safe to call on nonexistent paths.
stash_file() {
    local f="$1"
    [[ -e "$f" ]] || return 0
    if $DRY_RUN; then warn "[dry] stash $f"; return 0; fi
    ensure_trash
    local dst="$TRASH/$(basename "$f").$$"
    mv "$f" "$dst" 2>/dev/null || rm -f "$f" 2>/dev/null || true
}

# stash_dir_contents: move the contents of $1 into $TRASH/<basename>/ and
# recreate the empty dir. Preserves everything the old `rm -rf dir/*` wiped.
stash_dir_contents() {
    local dir="$1"
    [[ -d "$dir" ]] || return 0
    if $DRY_RUN; then warn "[dry] stash-contents $dir"; return 0; fi
    ensure_trash
    local bn="$(basename "$dir")"
    local dst="$TRASH/$bn.$$"
    mkdir -p "$dst"
    # mv all children (including hidden) into trash; ignore empty-dir error
    (shopt -s dotglob nullglob; mv "$dir"/* "$dst"/ 2>/dev/null || true)
    # Make sure dir still exists (it should — we only moved children)
    mkdir -p "$dir"
}

# stash_db: cp the populated DB into $TRASH before schema-only wipe
stash_db_copy() {
    local db="$1"
    [[ -f "$db" ]] || return 0
    $DRY_RUN && { warn "[dry] copy $db to trash"; return 0; }
    ensure_trash
    cp "$db" "$TRASH/$(basename "$db").$$" 2>/dev/null || true
}

do_write() {
    if $DRY_RUN; then warn "[dry] write $1"; else printf '%s\n' "$2" > "$1"; fi
}

# ═══════════════════════════════════════════════════════════════════
step "client/config — reset to templates"
# ═══════════════════════════════════════════════════════════════════
stash_file "$CLIENT/config/secrets.enc"
do_write "$CLIENT/config/auth.json" '{"setupComplete": false}'
do_write "$CLIENT/config/client-profile.md" '# Client Profile

> This file is populated during onboarding. Your business identity goes here.'
do_write "$CLIENT/config/content-pillars.json" '{"pillars": []}'
do_write "$CLIENT/config/avatar-config.json" '{"looks": []}'
do_write "$CLIENT/config/voice-config.json" '{"voices": []}'
do_write "$CLIENT/config/notifications.json" '{"channels": {}}'
do_write "$CLIENT/config/mcporter-active.json" '{ "mcpServers": {} }'

# Client dashboard extensions directory (Branson creates extensions here)
if $DRY_RUN; then warn "[dry] mkdir client/dashboard/extensions"
else mkdir -p "$CLIENT/dashboard/extensions"; ok "client/dashboard/extensions/ created"; fi
stash_file "$CLIENT/config/ghl-pipeline.json"
do_write "$CLIENT/config/VISION.md" '# Vision

> Work with Branson to define your business vision. Say "let'"'"'s work on our vision" anytime.'
do_write "$CLIENT/config/ROADMAP.md" '# Roadmap

## Active Projects
_No projects yet. Tell Branson what you want to achieve and he will set one up._

## Completed
_Nothing yet._'
do_write "$CLIENT/config/client-policy.json" '{
  "version": "1.0.0",
  "budget": {"daily_api_limit_usd": 10, "monthly_api_limit_usd": 200, "alert_at_percent": 80, "pause_on_exceed": false},
  "data_protection": {"agents_can_delete_content": true, "agents_can_delete_knowledge": false, "require_confirmation_for_deletes": true},
  "agent_behavior": {"auto_approve_video_pipeline": false, "auto_publish_social": false, "auto_send_emails": false},
  "notifications": {"budget_alerts": true, "daily_summary": true, "error_alerts": true}
}'
# modules.json and subscription.json — set per license (not reset here)
ok "Config files reset"

# ═══════════════════════════════════════════════════════════════════
step "client/data — empty DBs (schema only, no rows)"
# ═══════════════════════════════════════════════════════════════════
for db in "$CLIENT"/data/*.db; do
    [[ ! -f "$db" ]] && continue
    dbname=$(basename "$db")
    stash_db_copy "$db"
    if $DRY_RUN; then
        warn "[dry] Would empty all tables in $dbname"
    else
        # Get all user tables, DELETE FROM each
        tables=$(sqlite3 "$db" "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';" 2>/dev/null)
        for t in $tables; do
            sqlite3 "$db" "DELETE FROM $t;" 2>/dev/null || true
        done
        # Reset autoincrement counters
        sqlite3 "$db" "DELETE FROM sqlite_sequence;" 2>/dev/null || true
        sqlite3 "$db" "VACUUM;" 2>/dev/null || true
    fi
    ok "$dbname → empty (schema preserved, copy in trash)"
done
# Stash stale WAL/SHM files (not deleted — recoverable from trash)
while IFS= read -r -d '' f; do stash_file "$f"; done \
    < <(find "$CLIENT/data" \( -name "*.db-wal" -o -name "*.db-shm" \) -type f -print0 2>/dev/null)

# ═══════════════════════════════════════════════════════════════════
step "client/ content dirs — stash to trash, recreate empty"
# ═══════════════════════════════════════════════════════════════════
for dir in content knowledge logs memory skills uploads; do
    if [[ -d "$CLIENT/$dir" ]]; then
        stash_dir_contents "$CLIENT/$dir"
        ok "$dir/ → empty (contents in trash)"
    fi
done

# ═══════════════════════════════════════════════════════════════════
step ".openclaw/ — reset gateway state"
# ═══════════════════════════════════════════════════════════════════

# Sessions — stash all .jsonl files (THIS is the class of file the
# 2026-04-12 incident wiped unrecoverably. Move-to-trash is the fix.)
c=0
while IFS= read -r -d '' f; do stash_file "$f"; c=$((c+1)); done \
    < <(find "$OPENCLAW/agents" -name "*.jsonl" -type f -print0 2>/dev/null)
ok "Agent sessions stashed ($c files)"

# Reset sessions.json tracking files
while IFS= read -r -d '' f; do
    stash_file "$f"
    do_write "$f" '{"sessions":[]}'
done < <(find "$OPENCLAW/agents" -name "sessions.json" -type f -print0 2>/dev/null)
ok "sessions.json files reset (originals stashed)"

# Agent memory
while IFS= read -r -d '' f; do stash_file "$f"; done \
    < <(find "$OPENCLAW/agents" -path "*/memory/*" -type f -print0 2>/dev/null)
ok "Agent runtime memory stashed"

# Cron run history
[[ -d "$OPENCLAW/cron/runs" ]] && stash_dir_contents "$OPENCLAW/cron/runs" && ok "Cron run history stashed"

# Other state dirs
for dir in credentials media memory delivery-queue logs browser canvas completions; do
    [[ -d "$OPENCLAW/$dir" ]] && stash_dir_contents "$OPENCLAW/$dir" && ok "$dir/ → empty (stashed)"
done

# .env — template with placeholders (old one stashed first)
stash_file "$OPENCLAW/.env"
do_write "$OPENCLAW/.env" '# API Keys — populated during onboarding
# ANTHROPIC_API_KEY=
# OPENAI_API_KEY=
# HEYGEN_API_KEY=
# ELEVENLABS_API_KEY=
# BUFFER_API_TOKEN='
ok ".env → template"

# Remove backup copies of openclaw.json
while IFS= read -r -d '' f; do stash_file "$f"; done \
    < <(find "$OPENCLAW" -maxdepth 1 \( -name "openclaw.json.bak*" -o -name "openclaw.json.backup" \) -print0 2>/dev/null)
ok "Config backups stashed"

# Exec approvals — factory defaults
EXEC_DEFAULTS="$CORE/config/exec-approvals-defaults.json"
if [[ -f "$EXEC_DEFAULTS" ]]; then
    stash_file "$OPENCLAW/exec-approvals.json"
    if $DRY_RUN; then warn "[dry] copy exec-approvals defaults"
    else cp "$EXEC_DEFAULTS" "$OPENCLAW/exec-approvals.json"; fi
    ok "exec-approvals.json → factory defaults"
else
    warn "exec-approvals-defaults.json not found"
fi

# backup-encryption-key — stash (regenerated on first backup)
stash_file "$OPENCLAW/backup-encryption-key"
ok "Encryption key stashed (will regenerate)"

# ═══════════════════════════════════════════════════════════════════
step "Dashboard DBs — empty (schema only)"
# ═══════════════════════════════════════════════════════════════════
for db in "$DASHBOARD/dashboard.db" "$DASHBOARD/mission-control.db"; do
    [[ ! -f "$db" ]] && continue
    dbname=$(basename "$db")
    stash_db_copy "$db"
    if $DRY_RUN; then
        warn "[dry] Would empty all tables in $dbname"
    else
        tables=$(sqlite3 "$db" "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';" 2>/dev/null)
        for t in $tables; do
            sqlite3 "$db" "DELETE FROM $t;" 2>/dev/null || true
        done
        sqlite3 "$db" "DELETE FROM sqlite_sequence;" 2>/dev/null || true
        sqlite3 "$db" "VACUUM;" 2>/dev/null || true
    fi
    ok "$dbname → empty (schema preserved, copy in trash)"
done

# ═══════════════════════════════════════════════════════════════════
step "Trash janitor — delete reset-backup dirs older than 7 days"
# ═══════════════════════════════════════════════════════════════════
if [[ -d "$OPENCLAW/trash" ]]; then
    if $DRY_RUN; then
        warn "[dry] Would purge $OPENCLAW/trash/reset-backup-* older than 7 days"
    else
        find "$OPENCLAW/trash" -maxdepth 1 -type d -name "reset-backup-*" -mtime +7 -print -exec rm -rf {} + 2>/dev/null || true
    fi
    ok "Trash janitor complete"
fi

echo -e "\n${GREEN}Done.${NC} Client data reset complete."
if [[ -d "$TRASH" ]] && ! $DRY_RUN; then
    echo "  Recovery: stashed files are in $TRASH (7-day retention)."
fi
echo "  Next: run apply-agent-templates.sh to reset agent workspaces."
