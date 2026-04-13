#!/usr/bin/env bash
##############################################################################
# prepare-for-shipping.sh — Clean and lock down a Mac Mini for client delivery.
#
# Usage:
#   prepare-for-shipping.sh --client-id <id> --version <tag>
#   prepare-for-shipping.sh --client-id acme --version v1.0.0 --dry-run
#
# Run AFTER qa-test.sh passes. Wipes test data, sets first_boot, creates
# shipping snapshot. Non-reversible — run only when ready to ship.
#
# Delegates to:
#   - reset-client-data.sh   (client/, .openclaw/, dashboard DBs)
#   - apply-agent-templates.sh (agent workspaces: client files from templates)
##############################################################################
set -euo pipefail
source /opt/AIWH/core/scripts/lib/env.sh

CORE="/opt/AIWH/core"
CLIENT="${CLIENT_ROOT:-/opt/AIWH/client}"
OPENCLAW="/opt/AIWH/.openclaw"
BACKUPS="/opt/AIWH/.backups"
SCRIPTS="$CORE/scripts"
TOTAL_STEPS=13

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
STEP=0; ERRORS=0
step()  { STEP=$((STEP+1)); echo -e "\n${CYAN}[$STEP/$TOTAL_STEPS]${NC} $1"; }
ok()    { echo -e "  ${GREEN}✓${NC} $1"; }
warn()  { echo -e "  ${YELLOW}⚠${NC} $1"; ERRORS=$((ERRORS+1)); }
fail()  { echo -e "  ${RED}✗${NC} $1"; exit 1; }

# ── Parse args ────────────────────────────────────────────────────
CLIENT_ID=""; VERSION_TAG=""; DRY_RUN=false
while [[ $# -gt 0 ]]; do
    case "$1" in
        --client-id) CLIENT_ID="$2"; shift 2 ;;
        --version)   VERSION_TAG="$2"; shift 2 ;;
        --dry-run)   DRY_RUN=true; shift ;;
        -h|--help)   echo "Usage: prepare-for-shipping.sh --client-id <id> --version <tag> [--dry-run]"; exit 0 ;;
        *) fail "Unknown argument: $1" ;;
    esac
done
[[ -z "$CLIENT_ID" ]] && fail "Missing --client-id"
[[ -z "$VERSION_TAG" ]] && fail "Missing --version"
HOSTNAME_TAG="aiwh-${CLIENT_ID}"
DRY_FLAG=""; $DRY_RUN && DRY_FLAG="--dry-run"

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║         AIWH Prepare for Shipping — $HOSTNAME_TAG          ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo "  Client: $CLIENT_ID | Version: $VERSION_TAG"
$DRY_RUN && echo -e "  ${YELLOW}DRY RUN — no changes will be made${NC}"
echo ""

step "Security scan — find real API keys in text files"
KEY_PATTERNS='sk-ant-[a-zA-Z0-9]|sk-proj-[a-zA-Z0-9]|sk-[a-zA-Z0-9]{20}|hg-[a-zA-Z0-9]|tskey-auth-|tskey-api-|xoxb-[0-9]|xoxp-[0-9]|ghp_[a-zA-Z0-9]|gho_[a-zA-Z0-9]|AKIA[A-Z0-9]|AIza[a-zA-Z0-9]'

KEY_FILES=$(grep -r -l -E "$KEY_PATTERNS" \
    --include="*.env" --include="*.json" --include="*.sh" --include="*.py" \
    --include="*.md" --include="*.yaml" --include="*.yml" --include="*.js" \
    --include="*.txt" --include="*.jsonl" --include="*.conf" \
    "$CORE" "$CLIENT" "$OPENCLAW" 2>/dev/null \
    | grep -v node_modules | grep -v .git | grep -v package-lock.json || true)

if [[ -n "$KEY_FILES" ]]; then
    echo "$KEY_FILES" | while read -r f; do echo -e "  ${RED}KEY FOUND:${NC} $f"; done
    if ! $DRY_RUN; then fail "API keys found — remove before shipping"; fi
    warn "API keys found (dry-run, continuing)"
else
    ok "No API keys found"
fi

step "Remove API keys from Keychain"
for svc in anthropic-api-key openai-api-key heygen-api-key elevenlabs-api-key supabase-db-password buffer-api-token ghl-api-key; do
    if $DRY_RUN; then ok "Would delete: $svc"
    elif security delete-generic-password -a "aiwh" -s "$svc" 2>/dev/null; then ok "Deleted: $svc"
    else ok "Not present: $svc"; fi
done

step "Reset client data (client/, .openclaw/, dashboard DBs)"
# Pipe confirmation non-interactively. --i-mean-it is required because
# shipping legitimately targets real /opt/AIWH/* paths. --force-tty allows
# stdin to be a pipe instead of a real terminal.
if $DRY_RUN; then
    bash "$SCRIPTS/reset-client-data.sh" --dry-run --i-mean-it
else
    printf 'RESET CLIENT DATA\n' | bash "$SCRIPTS/reset-client-data.sh" --confirm --force-tty --i-mean-it
fi
ok "Client data reset complete"

step "Clear client script customizations"
if $DRY_RUN; then
    ok "Would clear client/scripts/"
else
    rm -f "$CLIENT/scripts"/*.sh "$CLIENT/scripts"/*.py 2>/dev/null || true
    ok "client/scripts/ cleared"
fi

step "Clear client-installed skills"
if $DRY_RUN; then
    ok "Would clear client/skills/"
else
    rm -rf "$CLIENT/skills"/* 2>/dev/null || true
    mkdir -p "$CLIENT/skills"
    ok "client/skills/ cleared"
fi

step "Reset agent workspaces (client files from templates + clear dev artifacts)"
bash "$SCRIPTS/apply-agent-templates.sh" $DRY_FLAG
ok "Agent workspaces reset complete"

step "Reset openclaw.json from shipping template"
if $DRY_RUN; then
    ok "Would copy openclaw.json.template → openclaw.json"
else
    if [[ -f "$OPENCLAW/openclaw.json.template" ]]; then
        cp "$OPENCLAW/openclaw.json.template" "$OPENCLAW/openclaw.json"
        ok "openclaw.json reset from template"
    else
        warn "openclaw.json.template not found — keeping existing openclaw.json"
    fi
fi

step "Sanitize openclaw.json (strip channels, tokens, plugins)"
if $DRY_RUN; then
    ok "Would sanitize openclaw.json"
else
    python3 -c "
import json
with open('$OPENCLAW/openclaw.json') as f:
    cfg = json.load(f)
# Strip all channel credentials and configs
cfg['channels'] = {}
cfg['plugins'] = {}
# Set gateway to LAN bind for Docker/Tailscale access
gw = cfg.get('gateway', {})
gw['bind'] = 'lan'
cfg['gateway'] = gw
# Remove allowFrom lists that contain our user IDs
for key in list(cfg.keys()):
    if 'allowFrom' in str(cfg[key]):
        if isinstance(cfg[key], dict):
            cfg[key].pop('allowFrom', None)
            cfg[key].pop('groupAllowFrom', None)
# Write sanitized config
with open('$OPENCLAW/openclaw.json', 'w') as f:
    json.dump(cfg, f, indent=2)
"
    ok "openclaw.json sanitized (channels={}, plugins={}, gateway.bind=lan)"
fi

step "Set device-info.json + license.json"
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
if $DRY_RUN; then
    ok "Would write device-info.json + update license.json"
else
    cat > "$CORE/config/device-info.json" << EOF
{
  "client_id": "$CLIENT_ID",
  "hostname": "$HOSTNAME_TAG",
  "version": "$VERSION_TAG",
  "installed_at": "$NOW",
  "prepared_at": "$NOW",
  "first_boot": true
}
EOF
    ok "device-info.json written"
    if [[ -f "$CORE/config/license.json" ]]; then
        python3 -c "
import json
with open('$CORE/config/license.json') as f: lic = json.load(f)
lic['deployed_version'] = '$VERSION_TAG'
lic['deployed_at'] = '$NOW'
with open('$CORE/config/license.json', 'w') as f: json.dump(lic, f, indent=2)
"
        ok "license.json updated (version: $VERSION_TAG)"
    else warn "license.json not found"; fi
fi

step "Set machine hostname"
if $DRY_RUN; then ok "Would set hostname to $HOSTNAME_TAG"
else
    scutil --set ComputerName "$HOSTNAME_TAG" 2>/dev/null || true
    scutil --set HostName "$HOSTNAME_TAG" 2>/dev/null || true
    scutil --set LocalHostName "$HOSTNAME_TAG" 2>/dev/null || true
    ok "Hostname set to $HOSTNAME_TAG"
fi

step "Build dashboard (IP protection — per-file minification)"
if $DRY_RUN; then ok "Would build dashboard bundles"
else
    cd /opt/AIWH/openclaw && pnpm ui:build:aiwh > /dev/null 2>&1
    [ -f "$CORE/dashboard/public/lit/components.js" ] && ok "Lit component bundle" || warn "Lit component bundle missing"
    # Verify JS/CSS are minified (minified files have 0-1 lines, readable source has 100+)
    APP_LINES=$(wc -l < "$CORE/dashboard/public/app.js" 2>/dev/null || echo "999")
    if [ "$APP_LINES" -le 10 ]; then
        ok "Dashboard JS minified (app.js: $APP_LINES lines)"
    else
        warn "app.js appears unminified ($APP_LINES lines) — IP leak risk!"
    fi
    STYLE_LINES=$(wc -l < "$CORE/dashboard/public/style.css" 2>/dev/null || echo "999")
    if [ "$STYLE_LINES" -le 10 ]; then
        ok "Dashboard CSS minified (style.css: $STYLE_LINES lines)"
    else
        warn "style.css appears unminified ($STYLE_LINES lines) — IP leak risk!"
    fi
    [ ! -d "$CORE/dashboard/src" ] && ok "No TypeScript source in dashboard" || warn "src/ directory found — source leak!"
fi

step "Verify script compilation (IP protection)"
if $DRY_RUN; then ok "Would verify script compilation"
else
    # Bash scripts must be Mach-O binaries (except skip list)
    SKIP_VERIFY="factory-install.sh update-aiwh.sh prepare-for-shipping.sh reset-client-data.sh apply-agent-templates.sh qa-test.sh"
    SH_COMPILED=0; SH_TEXT=0; SH_WARN=0
    for f in "$CORE/scripts"/*.sh; do
        [[ ! -f "$f" ]] && continue
        bn=$(basename "$f")
        # Skip source-able files
        echo "$SKIP_VERIFY" | grep -qw "$bn" && { SH_TEXT=$((SH_TEXT+1)); continue; }
        if file "$f" | grep -q "Mach-O"; then
            SH_COMPILED=$((SH_COMPILED+1))
        else
            warn "Script not compiled: $bn (readable source — IP leak risk)"
            SH_WARN=$((SH_WARN+1))
        fi
    done
    ok "Bash: $SH_COMPILED compiled (Mach-O), $SH_TEXT readable (skip list)"
    [[ $SH_WARN -gt 0 ]] && warn "$SH_WARN bash scripts not compiled!"

    # Python scripts must have .pyc bytecode (not raw source)
    PY_OK=0; PY_WARN=0
    for f in "$CORE/scripts"/*.py; do
        [[ ! -f "$f" ]] && continue
        bn=$(basename "$f")
        pyc="${f}c"
        if [[ -f "$pyc" ]] && head -1 "$f" | grep -q "Compiled"; then
            PY_OK=$((PY_OK+1))
        else
            warn "Python not compiled: $bn (readable source — IP leak risk)"
            PY_WARN=$((PY_WARN+1))
        fi
    done
    ok "Python: $PY_OK compiled (.pyc + launcher), $PY_WARN uncompiled"

    # Python lib files must have .pyc alongside thin launchers
    LIB_PY_OK=0; LIB_PY_WARN=0
    while IFS= read -r -d '' f; do
      pyc="${f%.py}.pyc"
      if [[ -f "$pyc" ]] && head -1 "$f" | grep -q "Compiled"; then
        LIB_PY_OK=$((LIB_PY_OK+1))
      else
        warn "Lib Python not compiled: ${f#$CORE/scripts/}"
        LIB_PY_WARN=$((LIB_PY_WARN+1))
      fi
    done < <(find "$CORE/scripts/lib" -name "*.py" -type f -print0)
    ok "Python lib: $LIB_PY_OK compiled, $LIB_PY_WARN uncompiled"

    # Dashboard backend must be minified
    SERVER_LINES=$(wc -l < "$CORE/dashboard/server.js" 2>/dev/null || echo "999")
    [[ "$SERVER_LINES" -le 10 ]] && ok "Dashboard backend minified (server.js: $SERVER_LINES lines)" || warn "Dashboard backend not minified!"

    # Critical configs embedded in catalogue-data.js
    if [[ -f "$CORE/dashboard/catalogue-data.js" ]]; then
      ok "Catalogues embedded"
      for key in license landlockPolicy execApprovals orgChart; do
        if node -e "const c=require('$CORE/dashboard/catalogue-data.js'); if(!c.$key) process.exit(1)" 2>/dev/null; then
          ok "Config embedded: $key"
        else
          warn "Config NOT embedded: $key"
        fi
      done
    else
      warn "catalogue-data.js missing!"
    fi

    # Docker source should NOT be in core/docker/ (only compiled landlock-guard)
    DOCKER_FILES=$(find "$CORE/docker" -type f -not -name "landlock-guard" 2>/dev/null | wc -l | tr -d ' ')
    [[ "$DOCKER_FILES" -eq 0 ]] && ok "core/docker/ clean (only compiled binary)" || warn "core/docker/ has $DOCKER_FILES extra files (source leak!)"

    # OpenClaw sparse checkout should NOT have source dirs
    OC_DIR="/opt/AIWH/openclaw"
    if [[ -d "$OC_DIR" ]]; then
      for srcdir in ui-aiwh dashboard-api scripts-src docker-src src; do
        [[ -d "$OC_DIR/$srcdir" ]] && warn "OpenClaw has source dir: $srcdir/ (sparse checkout misconfigured)"
      done
      [[ ! -d "$OC_DIR/ui-aiwh" ]] && ok "OpenClaw: no source dirs (sparse checkout correct)"
    fi
fi

step "Create shipping snapshot"
SNAP="$BACKUPS/shipping-${CLIENT_ID}-${VERSION_TAG}-$(date +%Y%m%d).tar.gz"
if $DRY_RUN; then ok "Would create: $SNAP"
else
    mkdir -p "$BACKUPS"
    tar -czf "$SNAP" --exclude='node_modules' --exclude='.git' \
        --exclude='*.mp4' --exclude='*.wav' --exclude='*.mp3' \
        -C /opt/AIWH core/ client/ 2>/dev/null
    ok "Snapshot: $SNAP ($(du -sh "$SNAP" | awk '{print $1}'))"
fi

step "Smoke test"
check() { [[ -e "$1" ]] && ok "$2" || warn "MISSING: $2 ($1)"; }

check "$CORE/CORE.md" "Branson CORE.md"
check "$CORE/SOUL.md" "Branson SOUL.md"
check "$CORE/BOOTSTRAP.md" "BOOTSTRAP.md"
check "$CORE/HARD-LIMITS.md" "HARD-LIMITS.md"
check "$CORE/config/capabilities-catalogue.json" "Capabilities catalogue"
check "$CORE/dashboard/server.js" "Dashboard server"
check "$CORE/dashboard/public/app.js" "Dashboard app.js (minified)"
check "$CORE/dashboard/public/style.css" "Dashboard style.css (minified)"
check "$CORE/dashboard/public/lit/components.js" "Lit component bundle"
check "$CORE/scripts/knowledge-search-unified.sh" "Knowledge search"
check "$CORE/scripts/cinematic-producer.py" "Cinematic producer"
check "$CORE/config/license.json" "License"
check "$CORE/config/device-info.json" "Device info"
check "$CLIENT/config/client-profile.md" "Client profile"
check "$CLIENT/config/content-pillars.json" "Content pillars"
check "$CLIENT/config/auth.json" "Auth config"

# Verify client data is clean
grep -q "AI Wealth Hub" "$CLIENT/config/client-profile.md" 2>/dev/null && warn "client-profile.md contains dev data"
grep -q '"setupComplete": false' "$CLIENT/config/auth.json" 2>/dev/null && ok "Onboarding will trigger" || warn "auth.json not reset"

# Verify agent CORE.md files exist
CORE_COUNT=$(find "$CORE/modules" -name "CORE.md" -type f 2>/dev/null | wc -l | tr -d ' ')
[[ "$CORE_COUNT" -ge 19 ]] && ok "All $CORE_COUNT agent CORE.md files present" || warn "Only $CORE_COUNT CORE.md files (expected 19+)"

step "Shipping checklist"
TS_IP=$(tailscale ip -4 2>/dev/null || echo "unknown")
echo ""
echo "  Client:    $CLIENT_ID"
echo "  Version:   $VERSION_TAG"
echo "  Hostname:  $HOSTNAME_TAG"
echo "  Tailscale: $TS_IP"
echo "  Snapshot:  ${SNAP:-'(dry run)'}"
echo ""

if [[ $ERRORS -eq 0 ]]; then
    echo -e "${GREEN}╔══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║                    READY TO SHIP                        ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════════════════════╝${NC}"
    exit 0
else
    echo -e "${YELLOW}╔══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${YELLOW}║     $ERRORS ISSUE(S) FOUND — REVIEW BEFORE SHIPPING     ║${NC}"
    echo -e "${YELLOW}╚══════════════════════════════════════════════════════════╝${NC}"
    exit 1
fi
