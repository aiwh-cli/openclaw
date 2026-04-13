#!/usr/bin/env bash
##############################################################################
# push-update.sh — Push core/ update to all client Mac Minis via Tailscale.
#
# Usage:
#   push-update.sh --version <tag> [--client <hostname>] [--dry-run]
#   push-update.sh --version v1.1.0                  # all clients
#   push-update.sh --version v1.1.0 --client aiwh-acme  # single client
#
# Process per client:
#   1. Snapshot current core/ on client (rollback point)
#   2. scp updated modules to client
#   3. Run apply-upgrade.py on client (verify + auto-rollback on failure)
#   4. Restart gateway + dashboard
#   5. Health check
##############################################################################

set -uo pipefail

CORE_DIR="/opt/AIWH/core"
REGISTRY="${CORE_DIR}/config/client-registry.json"
SSH_USER="roboai"
SSH_OPTS="-o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

# ── Parse Arguments ───────────────────────────────────────────────────────────
VERSION=""
SINGLE_CLIENT=""
DRY_RUN=false
ARCHIVE_PATH=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --version)  VERSION="$2"; shift 2 ;;
        --client)   SINGLE_CLIENT="$2"; shift 2 ;;
        --archive)  ARCHIVE_PATH="$2"; shift 2 ;;
        --dry-run)  DRY_RUN=true; shift ;;
        -h|--help)
            echo "Usage: push-update.sh --version <tag> [--client <hostname>] [--dry-run]"
            echo ""
            echo "Options:"
            echo "  --version    Version tag for this update (required)"
            echo "  --client     Target single client hostname (default: all)"
            echo "  --archive    Path to release archive .tar.gz (default: build from current core/)"
            echo "  --dry-run    Show what would happen"
            exit 0
            ;;
        *) echo "Unknown argument: $1"; exit 1 ;;
    esac
done

[[ -z "$VERSION" ]] && { echo "Missing required --version"; exit 1; }

# ── Build archive if not provided ─────────────────────────────────────────────
if [[ -z "$ARCHIVE_PATH" ]]; then
    ARCHIVE_PATH="/tmp/aiwh-update-${VERSION}.tar.gz"
    echo -e "${CYAN}Building release archive...${NC}"
    if $DRY_RUN; then
        echo "  Would create: $ARCHIVE_PATH"
    else
        tar -czf "$ARCHIVE_PATH" \
            --exclude='node_modules' \
            --exclude='.git' \
            --exclude='*.mp4' \
            --exclude='*.wav' \
            --exclude='*.mp3' \
            --exclude='memory' \
            --exclude='logs' \
            --exclude='content/cinematic' \
            -C /opt/AIWH core/ 2>/dev/null
        ARCHIVE_SIZE=$(du -sh "$ARCHIVE_PATH" | awk '{print $1}')
        echo -e "  ${GREEN}✓${NC} Archive: $ARCHIVE_PATH ($ARCHIVE_SIZE)"
    fi
fi

# ── Load client registry ──────────────────────────────────────────────────────
if [[ ! -f "$REGISTRY" ]]; then
    # Create a template if missing
    if [[ -z "$SINGLE_CLIENT" ]]; then
        echo -e "${RED}Client registry not found: $REGISTRY${NC}"
        echo "Create it with format:"
        echo '  [{"client_id":"acme","tailscale_hostname":"aiwh-acme","active":true}]'
        exit 1
    fi
    # Single client mode without registry
    HOSTNAMES=("$SINGLE_CLIENT")
else
    if [[ -n "$SINGLE_CLIENT" ]]; then
        HOSTNAMES=("$SINGLE_CLIENT")
    else
        mapfile -t HOSTNAMES < <(python3 -c "
import json
with open('$REGISTRY') as f:
    clients = json.load(f)
for c in clients:
    if c.get('active', True):
        print(c['tailscale_hostname'])
" 2>/dev/null)
    fi
fi

if [[ ${#HOSTNAMES[@]} -eq 0 ]]; then
    echo "No active clients found in registry"
    exit 1
fi

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║          AIWH Push Update — $VERSION                       ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "  Version:  $VERSION"
echo "  Clients:  ${#HOSTNAMES[@]}"
echo "  Archive:  ${ARCHIVE_PATH:-built from current core/}"
echo ""

if $DRY_RUN; then
    echo -e "${YELLOW}DRY RUN — no changes will be made${NC}"
    echo ""
fi

# ── Push to each client ───────────────────────────────────────────────────────
FAILED_CLIENTS=()
SUCCESS_CLIENTS=()

for HOSTNAME in "${HOSTNAMES[@]}"; do
    echo -e "\n${CYAN}═══ $HOSTNAME ═══${NC}"

    # Step 1: Check connectivity
    echo "  [1/5] Checking connectivity..."
    if $DRY_RUN; then
        echo -e "  ${GREEN}✓${NC} Would check SSH to $HOSTNAME"
    else
        if ! ssh $SSH_OPTS "$SSH_USER@$HOSTNAME" "echo ok" &>/dev/null; then
            echo -e "  ${RED}✗${NC} Cannot reach $HOSTNAME via SSH — skipping"
            FAILED_CLIENTS+=("$HOSTNAME:unreachable")
            continue
        fi
        echo -e "  ${GREEN}✓${NC} SSH connected"
    fi

    # Step 2: Create snapshot on client
    echo "  [2/5] Creating pre-update snapshot..."
    if $DRY_RUN; then
        echo -e "  ${GREEN}✓${NC} Would snapshot core/ on $HOSTNAME"
    else
        SNAP_RESULT=$(ssh $SSH_OPTS "$SSH_USER@$HOSTNAME" \
            "mkdir -p /opt/AIWH/.backups && tar -czf /opt/AIWH/.backups/pre-update-${VERSION}-\$(date +%Y%m%d%H%M).tar.gz --exclude='node_modules' --exclude='.git' -C /opt/AIWH core/ 2>/dev/null && echo SNAP_OK" \
            2>/dev/null || echo "SNAP_FAIL")
        if echo "$SNAP_RESULT" | grep -q "SNAP_OK"; then
            echo -e "  ${GREEN}✓${NC} Snapshot created"
        else
            echo -e "  ${RED}✗${NC} Snapshot failed — skipping $HOSTNAME"
            FAILED_CLIENTS+=("$HOSTNAME:snapshot_failed")
            continue
        fi
    fi

    # Step 3: Upload archive
    echo "  [3/5] Uploading archive..."
    if $DRY_RUN; then
        echo -e "  ${GREEN}✓${NC} Would upload $ARCHIVE_PATH to $HOSTNAME"
    else
        REMOTE_ARCHIVE="/tmp/aiwh-update-${VERSION}.tar.gz"
        if scp $SSH_OPTS "$ARCHIVE_PATH" "$SSH_USER@$HOSTNAME:$REMOTE_ARCHIVE" 2>/dev/null; then
            echo -e "  ${GREEN}✓${NC} Archive uploaded"
        else
            echo -e "  ${RED}✗${NC} Upload failed — skipping $HOSTNAME"
            FAILED_CLIENTS+=("$HOSTNAME:upload_failed")
            continue
        fi
    fi

    # Step 4: Run apply-upgrade.py on client
    echo "  [4/5] Applying upgrade..."
    if $DRY_RUN; then
        echo -e "  ${GREEN}✓${NC} Would run apply-upgrade.py on $HOSTNAME"
    else
        UPGRADE_RESULT=$(ssh $SSH_OPTS "$SSH_USER@$HOSTNAME" \
            "cd /opt/AIWH/core && python3 scripts/apply-upgrade.py '$REMOTE_ARCHIVE' --version '$VERSION' 2>&1" \
            2>/dev/null || echo "UPGRADE_FAIL")
        if echo "$UPGRADE_RESULT" | grep -q "UPGRADE COMPLETE"; then
            echo -e "  ${GREEN}✓${NC} Upgrade applied successfully"
        elif echo "$UPGRADE_RESULT" | grep -q "VERIFICATION FAILED\|FAILED"; then
            echo -e "  ${RED}✗${NC} Upgrade verification failed — auto-rolled back"
            echo "    $UPGRADE_RESULT" | tail -5
            FAILED_CLIENTS+=("$HOSTNAME:verification_failed")
            continue
        else
            echo -e "  ${RED}✗${NC} Upgrade failed"
            echo "    $UPGRADE_RESULT" | tail -3
            # Manual rollback
            ssh $SSH_OPTS "$SSH_USER@$HOSTNAME" \
                "cd /opt/AIWH/core && python3 scripts/apply-upgrade.py --rollback 2>/dev/null" || true
            FAILED_CLIENTS+=("$HOSTNAME:upgrade_failed")
            continue
        fi
    fi

    # Step 5: Restart and health check
    echo "  [5/5] Restarting services + health check..."
    if $DRY_RUN; then
        echo -e "  ${GREEN}✓${NC} Would restart gateway + dashboard on $HOSTNAME"
    else
        # Restart gateway
        ssh $SSH_OPTS "$SSH_USER@$HOSTNAME" \
            "openclaw gateway restart 2>/dev/null; sleep 3" 2>/dev/null || true

        # Restart dashboard
        ssh $SSH_OPTS "$SSH_USER@$HOSTNAME" \
            "kill \$(lsof -ti :3002) 2>/dev/null; sleep 1; cd /opt/AIWH/core/dashboard && CLIENT_ROOT=/opt/AIWH/client PORT=3002 nohup node server.js > /opt/AIWH/client/logs/dashboard.log 2>&1 &" \
            2>/dev/null || true

        sleep 3

        # Health check
        HEALTH=$(ssh $SSH_OPTS "$SSH_USER@$HOSTNAME" \
            "curl -sf http://localhost:3002/api/health 2>/dev/null || curl -sf http://localhost:3002/ -o /dev/null -w '%{http_code}' 2>/dev/null || echo FAIL" \
            2>/dev/null || echo "SSH_FAIL")

        if [[ "$HEALTH" == "FAIL" || "$HEALTH" == "SSH_FAIL" ]]; then
            echo -e "  ${YELLOW}⚠${NC} Dashboard health check failed — may need manual restart"
            FAILED_CLIENTS+=("$HOSTNAME:health_check_failed")
        else
            echo -e "  ${GREEN}✓${NC} Services healthy"
            SUCCESS_CLIENTS+=("$HOSTNAME")
        fi

        # Clean up remote archive
        ssh $SSH_OPTS "$SSH_USER@$HOSTNAME" "rm -f '$REMOTE_ARCHIVE'" 2>/dev/null || true
    fi
done

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════════════════"
echo "  Version: $VERSION"
echo -e "  Success: ${GREEN}${#SUCCESS_CLIENTS[@]}${NC}"
echo -e "  Failed:  ${RED}${#FAILED_CLIENTS[@]}${NC}"
echo ""

if [[ ${#FAILED_CLIENTS[@]} -gt 0 ]]; then
    echo -e "${RED}Failed clients:${NC}"
    for fc in "${FAILED_CLIENTS[@]}"; do
        HOST="${fc%%:*}"
        REASON="${fc##*:}"
        echo "  - $HOST ($REASON)"
    done
    echo ""
    echo -e "${YELLOW}To retry a single client:${NC}"
    echo "  push-update.sh --version $VERSION --client <hostname>"
    echo ""
    echo -e "${YELLOW}To manually rollback a client:${NC}"
    echo "  ssh roboai@<hostname> 'cd /opt/AIWH/core && python3 scripts/apply-upgrade.py --rollback'"
    exit 1
else
    if $DRY_RUN; then
        echo -e "${YELLOW}DRY RUN COMPLETE — ${#HOSTNAMES[@]} client(s) would be updated${NC}"
    else
        echo -e "${GREEN}ALL CLIENTS UPDATED TO $VERSION${NC}"
    fi
    exit 0
fi
