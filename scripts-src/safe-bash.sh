#!/bin/bash
# ── safe-bash: Trash-redirect wrapper for agent Bash tool calls ──
# Phase 70.5 — Intercepts rm/unlink/rmdir commands and redirects to trash.
#
# The OpenClaw gateway spawns bash for agent tool calls. By replacing the
# shell with this wrapper (via SHELL env var or exec tool config), all
# agent bash commands pass through here first.
#
# Usage: safe-bash -c "command string"  (how OpenClaw invokes it)
#
# What it does:
# - Detects rm, unlink, rmdir commands targeting /opt/AIWH paths
# - Rewrites them to mv → /opt/AIWH/client/trash/<timestamp>/
# - Logs every interception to security-audit.jsonl
# - Passes all other commands through unchanged

TRASH_DIR="/opt/AIWH/client/trash"
AUDIT_LOG="/opt/AIWH/client/logs/security-audit.jsonl"
OVERRIDES_FILE="/opt/AIWH/client/config/security-overrides.json"

# ── Audit logger ──────────────────────────────────────────────
log_security() {
    local outcome="$1" action="$2" target="$3" detail="$4"
    local ts
    ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    local agent="${OPENCLAW_AGENT_ID:-unknown}"
    local session="${OPENCLAW_SESSION_KEY:-unknown}"
    printf '{"timestamp":"%s","agent_id":"%s","session_key":"%s","tool":"bash","action":"%s","target_path":"%s","outcome":"%s","detail":"%s"}\n' \
        "$ts" "$agent" "$session" "$action" "$target" "$outcome" "$detail" \
        >> "$AUDIT_LOG" 2>/dev/null
}

# ── Override checker ──────────────────────────────────────────
# Returns 0 (true) if a custom rule allows remove_file on the given path.
# Uses jq (~5ms) for reliable JSON parsing. Fail-closed: if jq fails or
# JSON is malformed, returns 1 → safe-bash trashes the file (safe default).
path_allows_delete() {
    local target="$1"
    [ ! -f "$OVERRIDES_FILE" ] && return 1
    [ ! -s "$OVERRIDES_FILE" ] && return 1
    jq -e --arg t "$target" '
      .custom_rules[]? |
      select(.path as $p | ($t == $p) or ($t | startswith($p + "/"))) |
      select((.allow // [] | index("remove_file")) and ((.deny // [] | index("remove_file")) | not))
    ' "$OVERRIDES_FILE" >/dev/null 2>&1
}

# ── Trash redirect ────────────────────────────────────────────
trash_file() {
    local filepath="$1"
    # Only intercept paths under /opt/AIWH
    case "$filepath" in
        /opt/AIWH/client/trash/*) return 1 ;;  # Already in trash — allow actual delete
        /opt/AIWH/*)
            # Check if a custom override allows delete on this path
            if path_allows_delete "$filepath"; then
                log_security "allowed_by_override" "delete" "$filepath" "custom rule permits remove_file"
                return 1  # 1 = don't trash, let rm proceed
            fi
            # No override — redirect to trash
            local datedir
            datedir="$TRASH_DIR/$(date +%Y-%m-%d)"
            mkdir -p "$datedir" 2>/dev/null
            local basename
            basename=$(basename "$filepath")
            local dest="$datedir/${basename}"
            # Handle name conflicts
            if [ -e "$dest" ]; then
                dest="${datedir}/${basename}.$(date +%s)"
            fi
            if mv "$filepath" "$dest" 2>/dev/null; then
                # Save origin metadata so trash view knows where it came from
                echo "$filepath" > "${dest}.origin"
                log_security "redirected_to_trash" "delete" "$filepath" "moved to $dest"
                echo "[safe-bash] Moved to trash: $filepath → $dest" >&2
                return 0
            else
                log_security "redirect_failed" "delete" "$filepath" "mv failed"
                return 1
            fi
            ;;
        /tmp/*) return 1 ;;  # Temp files — allow actual delete
        *) return 1 ;;       # Outside /opt/AIWH — let kernel handle it
    esac
}

# ── Command interceptor ──────────────────────────────────────
intercept_command() {
    local cmd="$1"

    # ── HARD BLOCK: Audit archive is immutable (AC.4) ──
    # Refuse ALL deletion/overwrite of audit-archive — not even trashed.
    if echo "$cmd" | grep -qE '/opt/AIWH/client/data/audit-archive'; then
        if echo "$cmd" | grep -qE '\brm\b|\bunlink\b|\brmdir\b|os\.(remove|unlink|rmdir)|shutil\.rmtree|find.*-delete|truncate|>\s*/opt/AIWH/client/data/audit-archive|dd\s.*of=/opt/AIWH/client/data/audit-archive'; then
            log_security "blocked" "audit_archive_delete" "" "Blocked: audit archive is immutable"
            echo "[safe-bash] Blocked: Cannot delete or overwrite audit archive files" >&2
            exit 1
        fi
    fi

    # ── Block non-rm destructive patterns targeting /opt/AIWH (AC.5) ──
    # These bypass the rm interceptor so we block them outright.
    if echo "$cmd" | grep -qE 'python3?\s.*os\.(remove|unlink|rmdir).*(/opt/AIWH/)'; then
        log_security "blocked" "python_delete" "" "Blocked python file deletion"
        echo "[safe-bash] Blocked: Python file deletion targeting /opt/AIWH" >&2
        exit 1
    fi
    if echo "$cmd" | grep -qE 'shutil\.rmtree.*(/opt/AIWH/)'; then
        log_security "blocked" "shutil_rmtree" "" "Blocked shutil.rmtree"
        echo "[safe-bash] Blocked: shutil.rmtree targeting /opt/AIWH" >&2
        exit 1
    fi
    if echo "$cmd" | grep -qE 'find\s+/opt/AIWH[^ ]*.*-delete'; then
        log_security "blocked" "find_delete" "" "Blocked find -delete"
        echo "[safe-bash] Blocked: find -delete targeting /opt/AIWH" >&2
        exit 1
    fi
    if echo "$cmd" | grep -qE 'truncate\s.*(/opt/AIWH/)'; then
        log_security "blocked" "truncate" "" "Blocked truncate"
        echo "[safe-bash] Blocked: truncate targeting /opt/AIWH" >&2
        exit 1
    fi
    if echo "$cmd" | grep -qE '>\s*/opt/AIWH/|dd\s.*of=/opt/AIWH/'; then
        log_security "blocked" "overwrite" "" "Blocked file overwrite"
        echo "[safe-bash] Blocked: file overwrite targeting /opt/AIWH" >&2
        exit 1
    fi

    # Quick check — does the command contain rm/unlink/rmdir?
    if ! echo "$cmd" | grep -qE '\brm\b|\bunlink\b|\brmdir\b'; then
        # No destructive commands — pass through unchanged
        exec /bin/bash -c "$cmd"
    fi

    # Parse rm commands and extract target paths
    # This handles: rm file, rm -f file, rm -rf dir, rm -r dir
    # We process the command, replace rm targets with trash moves, then run the rest
    local modified_cmd="$cmd"
    local intercepted=0

    # Extract rm targets (simplistic but covers common patterns)
    # Match: rm [-rfivI]* /opt/AIWH/...
    while IFS= read -r match; do
        [ -z "$match" ] && continue
        local target
        target=$(echo "$match" | grep -oE '/opt/AIWH/[^ ;"'\''|&>]+' | head -1)
        if [ -n "$target" ] && [ -e "$target" ]; then
            # Skip if target is in trash already
            case "$target" in
                /opt/AIWH/client/trash/*) continue ;;
            esac
            if trash_file "$target"; then
                # Remove the rm command from the pipeline (replace with true)
                modified_cmd=$(echo "$modified_cmd" | sed "s|rm [^;|&]*${target}[^ ;|&]*|true /* trashed: ${target} */|g")
                intercepted=1
            fi
        fi
    done < <(echo "$cmd" | grep -oE 'rm\s+[-rfivI ]*\s*/opt/AIWH/[^ ;"'\''|&>]+')

    if [ "$intercepted" -eq 1 ]; then
        # Run the modified command (with rm replaced by true)
        exec /bin/bash -c "$modified_cmd"
    else
        # No /opt/AIWH targets found in rm commands — pass through
        exec /bin/bash -c "$cmd"
    fi
}

# ── Main ──────────────────────────────────────────────────────
# OpenClaw invokes: safe-bash -c "command string"
if [ "$1" = "-c" ] && [ -n "$2" ]; then
    intercept_command "$2"
else
    # Not a -c invocation — pass through to real bash
    exec /bin/bash "$@"
fi
