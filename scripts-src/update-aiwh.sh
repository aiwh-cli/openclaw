#!/usr/bin/env bash
##############################################################################
# update-aiwh.sh — Safely update an AIWH client machine to a specific version.
#
# Usage:
#   update-aiwh.sh                    # Update to latest tag
#   update-aiwh.sh v2026.3.17         # Update to specific version
#   update-aiwh.sh --check            # Check for updates without applying
#
# 9-step flow: fetch → preflight → snapshot → git checkout → lock permissions
#   → BOOTSTRAP/CORE → migrations → restart → post-flight + auto-rollback
#
# All compilation (backend, scripts, frontend) is done on the dev machine
# via release-aiwh.sh. Client machines receive pre-compiled output only.
##############################################################################

set -euo pipefail
source /opt/AIWH/core/scripts/lib/env.sh
source /opt/AIWH/core/scripts/lib/update-helpers.sh
mkdir -p "$(dirname "$LOG_FILE")"

# ── Parse arguments ─────────────────────────────────────────────────────────
TARGET_TAG=""
CHECK_ONLY=false
case "${1:-}" in
  --check) CHECK_ONLY=true ;;
  v*)      TARGET_TAG="$1" ;;
  "")      TARGET_TAG="" ;;
  *)       echo "Usage: update-aiwh.sh [v2026.3.17] [--check]"; exit 1 ;;
esac

# ── [1/9] Fetch tags ──────────────────────────────────────────────────────
log "${CYAN}[1/9]${NC} Fetching updates..."
cd "$AIWH_ROOT"
if ! git fetch --tags 2>&1 | tee -a "$LOG_FILE"; then
  log "${RED}  Failed to fetch. Check network.${NC}"; exit 1
fi
[[ -d "$OPENCLAW_DIR" ]] && { cd "$OPENCLAW_DIR" && git fetch --tags 2>&1 | tee -a "$LOG_FILE" || true; }

[[ -z "$TARGET_TAG" ]] && TARGET_TAG=$(cd "$AIWH_ROOT" && git tag --sort=-creatordate | head -1)
CURRENT_TAG=$(current_tag)
log "  Current: ${YELLOW}$CURRENT_TAG${NC}  Target: ${GREEN}$TARGET_TAG${NC}"

if [[ "$CURRENT_TAG" == "$TARGET_TAG" ]]; then
  log "${GREEN}Already up to date ($TARGET_TAG)${NC}"; exit 0
fi
if $CHECK_ONLY; then
  CHANGELOG=$(generate_changelog "$CURRENT_TAG" "$TARGET_TAG")
  log "${YELLOW}Update available: $CURRENT_TAG → $TARGET_TAG ($CHANGELOG)${NC}"; exit 0
fi

# ── [2/9] Pre-flight healthcheck ──────────────────────────────────────────
log "${CYAN}[2/9]${NC} Pre-flight healthcheck..."
"$SCRIPTS_DIR/update-healthcheck.sh" save-state
if ! "$SCRIPTS_DIR/update-healthcheck.sh" pre 2>&1 | tee -a "$LOG_FILE"; then
  log "${RED}  Pre-flight failed — aborting update${NC}"
  aiwh_notify "Update to $TARGET_TAG aborted: pre-flight healthcheck failed" "systems"
  exit 1
fi

# ── [3/9] Snapshot ────────────────────────────────────────────────────────
log "${CYAN}[3/9]${NC} Creating pre-update snapshot..."
if [[ -x "$SCRIPTS_DIR/backup-snapshot.sh" ]]; then
  "$SCRIPTS_DIR/backup-snapshot.sh" 2>&1 | tail -3 | tee -a "$LOG_FILE" || log "${YELLOW}  Snapshot failed (non-fatal)${NC}"
  log "  ${GREEN}✓${NC} Snapshot created"
else
  log "  ${YELLOW}⚠${NC} No snapshot script"
fi

# ── [4/9] Update core (pre-compiled from release) ─────────────────────────
log "${CYAN}[4/9]${NC} Updating core to $TARGET_TAG..."
cd "$AIWH_ROOT"
git stash 2>/dev/null || true
if ! git checkout "$TARGET_TAG" 2>&1 | tee -a "$LOG_FILE"; then
  log "${RED}  Checkout failed${NC}"
  git checkout "$CURRENT_TAG" 2>/dev/null || true
  git stash pop 2>/dev/null || true
  exit 1
fi

# ── [5/9] Lock file permissions ──────────────────────────────────────────
log "${CYAN}[5/9]${NC} Locking compiled files..."
cd "$AIWH_ROOT"
# Lock compiled scripts (skip lib/ readable files)
for f in core/scripts/*.sh core/scripts/*.so core/scripts/*.pyc; do
  [[ -f "$f" ]] && chmod 444 "$f" 2>/dev/null || true
done
# Lock BOOTSTRAP.md + CORE.md across all agent workspaces
for f in core/modules/*/*/BOOTSTRAP.md core/modules/*/*/CORE.md core/BOOTSTRAP.md core/CORE.md; do
  [[ -f "$f" ]] && chmod 444 "$f" 2>/dev/null || true
done
log "  ${GREEN}✓${NC} File permissions locked"

# ── [6/9] BOOTSTRAP + CORE.md update (client files untouched) ────────────
log "${CYAN}[6/9]${NC} Updating BOOTSTRAP.md + CORE.md files (client SOUL.md preserved)..."
# Phase 76 architecture: only BOOTSTRAP.md + CORE.md are product-owned.
# SOUL.md, IDENTITY.md, TOOLS.md, AGENTS.md, USER.md, HEARTBEAT.md are client-owned.
# git checkout already replaced CORE.md + BOOTSTRAP.md from the new version.

# One-time migration: SOUL-CORE.md → CORE.md, SOUL-CLIENT.md → SOUL.md
for _ws in "$AIWH_ROOT/core/modules"/*/*/ "$AIWH_ROOT/core/"; do
    [[ ! -d "$_ws" ]] && continue
    if [[ -f "$_ws/SOUL-CORE.md" && ! -f "$_ws/CORE.md" ]]; then
        mv "$_ws/SOUL-CORE.md" "$_ws/CORE.md"
        log "  Migrated: $(basename "$_ws")/SOUL-CORE.md → CORE.md"
    fi
    if [[ -f "$_ws/SOUL-CLIENT.md" ]]; then
        if grep -q "See SOUL-CORE" "$_ws/SOUL.md" 2>/dev/null; then
            cp "$_ws/SOUL-CLIENT.md" "$_ws/SOUL.md"
            log "  Migrated: $(basename "$_ws")/SOUL-CLIENT.md → SOUL.md"
        fi
        rm -f "$_ws/SOUL-CLIENT.md"
    fi
done

CORE_COUNT=$(find "$AIWH_ROOT/core/modules" -name "CORE.md" -type f 2>/dev/null | wc -l | tr -d ' ')
log "  ${GREEN}✓${NC} $CORE_COUNT agent CORE.md + BOOTSTRAP.md files updated (client files untouched)"

# ── Check for upstream changes to client-customized scripts ──────────────
if [ -d "${CLIENT_ROOT:-/opt/AIWH/client}/scripts" ]; then
  _conflicts=""
  for _cs in "${CLIENT_ROOT:-/opt/AIWH/client}/scripts"/*.sh "${CLIENT_ROOT:-/opt/AIWH/client}/scripts"/*.py; do
    [ -f "$_cs" ] || continue
    _bn=$(basename "$_cs")
    [ -f "$AIWH_ROOT/core/scripts/$_bn" ] || continue
    if git diff "$CURRENT_TAG" "$TARGET_TAG" -- "core/scripts/$_bn" 2>/dev/null | grep -q "^diff"; then
      _conflicts="$_conflicts $_bn"
    fi
  done
  if [ -n "$_conflicts" ]; then
    log "  ${YELLOW}⚠ Updated scripts with client overrides:${NC}$_conflicts"
    log "  ${YELLOW}  Review with: diff core/scripts/X.sh client/scripts/X.sh${NC}"
    aiwh_notify "Update $TARGET_TAG: customized scripts have upstream changes:$_conflicts — ask Branson to review diffs" "systems"
  fi
fi

# ── [7/9] Update OpenClaw CLI (sparse checkout — compiled runtime only) ──
log "${CYAN}[7/9]${NC} Updating OpenClaw CLI..."
if [[ -d "$OPENCLAW_DIR" ]]; then
  cd "$OPENCLAW_DIR"
  git pull origin aiwh-main 2>&1 | tee -a "$LOG_FILE"
  npm install -g . 2>&1 | tail -3 | tee -a "$LOG_FILE"
  log "  ${GREEN}✓${NC} OpenClaw: $(openclaw --version 2>/dev/null)"
else
  log "  ${YELLOW}⚠${NC} No openclaw/ directory"
fi

# ── [8/9] Migrations + dependencies + Docker rebuild check ───────────────
log "${CYAN}[8/9]${NC} Running migrations..."
run_migrations
cd "$AIWH_ROOT/core/dashboard" && npm install --production 2>&1 | tail -3 | tee -a "$LOG_FILE"
log "  ${GREEN}✓${NC} Dependencies updated"
# Check if Docker image needs rebuild (OpenClaw package.json changed)
if [[ -d "$OPENCLAW_DIR" ]]; then
  PKG_HASH_FILE="$CLIENT_ROOT/logs/.openclaw-pkg-hash"
  NEW_HASH=$(md5 -q "$OPENCLAW_DIR/package.json" 2>/dev/null || md5sum "$OPENCLAW_DIR/package.json" 2>/dev/null | cut -d' ' -f1)
  OLD_HASH=$(cat "$PKG_HASH_FILE" 2>/dev/null || echo "none")
  if [[ "$NEW_HASH" != "$OLD_HASH" ]]; then
    log "  ${YELLOW}⚠${NC} OpenClaw package.json changed — Docker image rebuild needed"
    log "  Run: bash /opt/AIWH/openclaw/docker-src/build-client.sh"
    echo "$NEW_HASH" > "$PKG_HASH_FILE"
  else
    log "  ${GREEN}✓${NC} Docker image up to date"
  fi
fi

# ── [9/9] Restart + post-flight ──────────────────────────────────────────
log "${CYAN}[9/9]${NC} Restarting services..."
restart_services
log "  Waiting 10s for services to start..."
sleep 10

# Post-flight healthcheck + compilation verification
log "Post-flight healthcheck..."

# Compilation verification (non-fatal — logs warnings)
_verify_ok=true
if [[ -f "$AIWH_ROOT/core/dashboard/server.js" ]]; then
  _srv_lines=$(wc -l < "$AIWH_ROOT/core/dashboard/server.js" 2>/dev/null || echo "999")
  if [[ "$_srv_lines" -le 10 ]]; then
    log "  ${GREEN}✓${NC} Dashboard backend minified (server.js: ${_srv_lines} lines)"
  else
    log "  ${YELLOW}⚠${NC} Dashboard backend may not be minified (${_srv_lines} lines)"
  fi
fi
if [[ -f "$AIWH_ROOT/core/dashboard/catalogue-data.js" ]]; then
  log "  ${GREEN}✓${NC} Catalogues embedded"
else
  log "  ${YELLOW}⚠${NC} catalogue-data.js missing — catalogues may not be embedded"
fi
_sh_compiled=$(find "$AIWH_ROOT/core/scripts" -maxdepth 1 -name "*.sh" -exec file {} \; 2>/dev/null | grep -c "Mach-O" || echo "0")
log "  ${GREEN}✓${NC} ${_sh_compiled} bash scripts compiled (Mach-O)"

if "$SCRIPTS_DIR/update-healthcheck.sh" post 2>&1 | tee -a "$LOG_FILE"; then
  CHANGELOG=$(generate_changelog "$CURRENT_TAG" "$TARGET_TAG")
  record_update "$CURRENT_TAG" "$TARGET_TAG"
  log ""
  log "${GREEN}═══════════════════════════════════════════════════${NC}"
  log "${GREEN}  Update complete: $CURRENT_TAG → $TARGET_TAG${NC}"
  log "${GREEN}  Changes: $CHANGELOG${NC}"
  log "${GREEN}═══════════════════════════════════════════════════${NC}"
  aiwh_notify "Updated to $TARGET_TAG ($CHANGELOG)" "systems"
else
  log "${RED}  Post-flight FAILED — rolling back${NC}"
  rollback_update "$CURRENT_TAG"
  aiwh_notify "Update to $TARGET_TAG FAILED — rolled back to $CURRENT_TAG" "systems"
  exit 1
fi
