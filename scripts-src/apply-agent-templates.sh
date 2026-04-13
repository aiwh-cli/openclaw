#!/usr/bin/env bash
##############################################################################
# apply-agent-templates.sh — Reset agent workspaces to shipping state.
#
# Copies niche-agnostic templates from core/config/agent-templates/ over
# client-editable files. Product files (CORE.md, BOOTSTRAP.md) ship as-is.
#
# Runtime files loaded by OpenClaw (Phase 76 — workspace.ts):
#   BOOTSTRAP.md, CORE.md, SOUL.md, IDENTITY.md, TOOLS.md,
#   AGENTS.md, USER.md, HEARTBEAT.md, MEMORY.md
#
# Product files (overwritten by updates): CORE.md, BOOTSTRAP.md
# Client files (reset from templates):    SOUL.md, IDENTITY.md, TOOLS.md,
#                                          AGENTS.md, USER.md, HEARTBEAT.md
# Agent files (reset to empty):           MEMORY.md
#
# Usage: apply-agent-templates.sh [--dry-run]
##############################################################################
set -euo pipefail

CORE="/opt/AIWH/core"
TEMPLATES="$CORE/config/agent-templates"
DRY_RUN=false
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok() { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }
err() { echo -e "  ${RED}✗${NC} $1"; }

do_copy() {
    local src="$1" dst="$2"
    if $DRY_RUN; then warn "[dry] Would copy $(basename "$src") → $dst"
    else cp "$src" "$dst"; fi
}
do_write() { if $DRY_RUN; then warn "[dry] Would write $1"; else printf '%s\n' "$2" > "$1"; fi; }
do_rm()    { if $DRY_RUN; then warn "[dry] Would delete $1"; else rm -f "$1"; fi; }

# Map module path to template directory name
agent_template_name() {
    basename "$1"
}

# Product files — NEVER deleted during reset
PRODUCT_FILES="SOUL.md CORE.md MEMORY.md USER.md IDENTITY.md BOOTSTRAP.md TOOLS.md AGENTS.md HEARTBEAT.md TRAINING.md TRAINING-PIPELINE-REF.md"

MEMORY_TEMPLATE='# MEMORY.md

No memories yet. Context will build as we work together.'

##############################################################################
reset_agent() {
    local dir="$1" rel="$2"
    local tpl_name
    tpl_name=$(agent_template_name "$dir")
    local tpl_dir="$TEMPLATES/$tpl_name"
    echo -e "\n${GREEN}Agent:${NC} $rel"

    # 1. Client files — copy from templates
    if [[ -d "$tpl_dir" ]]; then
        for f in SOUL.md IDENTITY.md TOOLS.md AGENTS.md; do
            if [[ -f "$tpl_dir/$f" ]]; then
                do_copy "$tpl_dir/$f" "$dir/$f"
                ok "$f → template"
            fi
        done
    else
        warn "No template dir: $tpl_dir (skipping client file reset)"
    fi

    # 2. Shared files — copy from _shared
    for f in USER.md HEARTBEAT.md; do
        if [[ -f "$TEMPLATES/_shared/$f" ]]; then
            do_copy "$TEMPLATES/_shared/$f" "$dir/$f"
            ok "$f → template"
        fi
    done

    # 3. MEMORY.md — empty template (agent-owned, not from templates)
    do_write "$dir/MEMORY.md" "$MEMORY_TEMPLATE"
    ok "MEMORY.md → empty"

    # 4. memory/ — delete all .md files
    if [[ -d "$dir/memory" ]]; then
        local c=0
        while IFS= read -r -d '' f; do do_rm "$f"; c=$((c+1)); done \
            < <(find "$dir/memory" -name "*.md" -type f -print0 2>/dev/null)
        ok "memory/ cleared ($c files)"
    fi

    # 5. output/ — clear contents
    [[ -d "$dir/output" ]] && { $DRY_RUN && warn "[dry] Would clear output/" || rm -rf "$dir/output"/* 2>/dev/null; ok "output/ cleared"; } || true

    # 6. Dev artifacts — working files, hidden state, build artifacts
    local c=0
    for ext in txt py sh csv xlsx pdf mp3 mp4 wav html mjs jsonl; do
        while IFS= read -r -d '' f; do do_rm "$f"; c=$((c+1)); done \
            < <(find "$dir" -maxdepth 1 -name "*.$ext" -type f -print0 2>/dev/null)
    done
    [[ $c -gt 0 ]] && ok "Deleted $c dev files"

    # Hidden state, .pi, .DS_Store, .openclaw workspace state, __pycache__
    find "$dir" -maxdepth 1 -name ".*.json" -type f -print0 2>/dev/null | while IFS= read -r -d '' f; do do_rm "$f"; done
    [[ -f "$dir/.pi" ]] && do_rm "$dir/.pi"
    [[ -f "$dir/.DS_Store" ]] && do_rm "$dir/.DS_Store"
    [[ -d "$dir/.openclaw" ]] && { $DRY_RUN && warn "[dry] Would clear .openclaw/" || rm -rf "$dir/.openclaw"/* 2>/dev/null; ok ".openclaw/ cleared"; } || true
    [[ -d "$dir/__pycache__" ]] && { $DRY_RUN && warn "[dry] Would delete __pycache__/" || rm -rf "$dir/__pycache__"; ok "__pycache__/ deleted"; } || true

    # Non-product .md files
    while IFS= read -r -d '' f; do
        local n; n=$(basename "$f")
        echo "$PRODUCT_FILES" | grep -qw "$n" || { do_rm "$f"; ok "Deleted dev .md: $n"; }
    done < <(find "$dir" -maxdepth 1 -name "*.md" -type f -print0 2>/dev/null)
}

##############################################################################
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║       Apply Agent Templates — Reset for Shipping            ║"
echo "╚══════════════════════════════════════════════════════════════╝"
$DRY_RUN && echo -e "${YELLOW}DRY RUN — no changes will be made${NC}"

# Verify templates exist
if [[ ! -d "$TEMPLATES" ]]; then
    err "Templates directory not found: $TEMPLATES"
    exit 1
fi

COUNT=0
for cat in backend frontend lifestyle system; do
    for d in "$CORE/modules/$cat"/*/; do
        [[ ! -d "$d" ]] && continue
        name=$(basename "$d")
        [[ ! -f "$d/CORE.md" && ! -f "$d/IDENTITY.md" ]] && continue
        reset_agent "${d%/}" "$cat/$name"
        COUNT=$((COUNT+1))
    done
done

# Main agent (Branson)
echo -e "\n${GREEN}═══ Main Agent (Branson) ═══${NC}"
COUNT=$((COUNT+1))

# Branson client files from templates
if [[ -d "$TEMPLATES/branson" ]]; then
    for f in SOUL.md IDENTITY.md TOOLS.md AGENTS.md; do
        [[ -f "$TEMPLATES/branson/$f" ]] && do_copy "$TEMPLATES/branson/$f" "$CORE/$f" && ok "$f → template"
    done
fi
for f in USER.md HEARTBEAT.md; do
    [[ -f "$TEMPLATES/_shared/$f" ]] && do_copy "$TEMPLATES/_shared/$f" "$CORE/$f" && ok "$f → template"
done

do_write "$CORE/MEMORY.md" "# MEMORY.md — Institutional Memory

Daily logs in memory/YYYY-MM-DD.md. Search with memory_search()."; ok "MEMORY.md → empty"
for f in LOG.md AUDIT.md TASKS.md MASTER-SPRINT-PLAN.md; do
    do_write "$CORE/$f" "# $f"; ok "$f → empty"
done

# Core memory — delete dated files only
if [[ -d "$CORE/memory" ]]; then
    c=0
    while IFS= read -r -d '' f; do
        [[ "$(basename "$f")" =~ ^20[0-9]{2}-[0-9]{2}-[0-9]{2}\.md$ ]] && { do_rm "$f"; c=$((c+1)); }
    done < <(find "$CORE/memory" -maxdepth 1 -name "*.md" -type f -print0 2>/dev/null)
    ok "core/memory/ dated files cleared ($c)"
fi

# Dev-only files at core root
for f in "$CORE"/SKOOL-*.md; do [[ -f "$f" ]] && do_rm "$f" && ok "Deleted $(basename "$f")"; done
[[ -f "$CORE/.DS_Store" ]] && do_rm "$CORE/.DS_Store"

# Auth files → reset
if $DRY_RUN; then warn "[dry] Would reset auth files"
else echo '{}' > "$CORE/auth.json"; echo '{}' > "$CORE/auth-profiles.json"; ok "auth files → reset"; fi

echo -e "\n${GREEN}Done.${NC} Processed $COUNT agent workspaces."
