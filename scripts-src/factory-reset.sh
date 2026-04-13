#!/usr/bin/env bash
##############################################################################
# factory-reset.sh — Clear client data, keep product code intact.
#
# Usage:
#   factory-reset.sh              # Interactive confirmation
#   factory-reset.sh --confirm    # Skip confirmation (for scripted use)
#
# Use this after testing a Mac Mini before shipping to a client.
# The next browser visit will trigger the onboarding wizard.
##############################################################################

set -euo pipefail
source /opt/AIWH/core/scripts/lib/env.sh

CLIENT_DIR="${CLIENT_ROOT:-/opt/AIWH/client}"
OPENCLAW_DIR="/opt/AIWH/.openclaw"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

if [[ "${1:-}" != "--confirm" ]]; then
  echo -e "${RED}╔═══════════════════════════════════════════════╗${NC}"
  echo -e "${RED}║        FACTORY RESET — ALL DATA CLEARED       ║${NC}"
  echo -e "${RED}╚═══════════════════════════════════════════════╝${NC}"
  echo ""
  echo "This will delete:"
  echo "  - Encrypted secrets (secrets.enc)"
  echo "  - Dashboard password (auth.json)"
  echo "  - All databases (video-jobs, knowledge cache, mission-control)"
  echo "  - All generated content (videos, audio, media)"
  echo "  - All logs"
  echo "  - WhatsApp session (will need re-pairing)"
  echo ""
  echo -e "${YELLOW}Product code in /opt/AIWH/core/ is NOT touched.${NC}"
  echo ""
  read -p "Type RESET to confirm: " confirm
  if [[ "$confirm" != "RESET" ]]; then
    echo "Aborted."
    exit 1
  fi
fi

echo -e "${YELLOW}Stopping services...${NC}"
launchctl kickstart -k "gui/$(id -u)/com.aiwh.dashboard" 2>/dev/null || true
pkill -f "node.*server.js" 2>/dev/null || true
sleep 2

echo "Clearing secrets..."
rm -f "$CLIENT_DIR/config/secrets.enc"
rm -f "$CLIENT_DIR/config/auth.json"
rm -f "$CLIENT_DIR/config/preferences.json"

echo "Clearing databases..."
rm -f "$CLIENT_DIR/data/"*.db
rm -f "$CLIENT_DIR/data/"*.db-shm
rm -f "$CLIENT_DIR/data/"*.db-wal

echo "Clearing content..."
rm -rf "$CLIENT_DIR/content/jobs/"*
rm -rf "$CLIENT_DIR/content/cinematic/"*

echo "Clearing logs..."
rm -f "$CLIENT_DIR/logs/"*.log
rm -f "$CLIENT_DIR/logs/"*.json

echo "Clearing WhatsApp session..."
rm -rf "$OPENCLAW_DIR/web-auth/"
rm -rf "$OPENCLAW_DIR/web-store/"

echo "Clearing pairing store..."
rm -f "$OPENCLAW_DIR/oauth/"*-pairing.json

echo "Resetting client config to templates..."
# Reset client-profile.md to empty template
cat > "$CLIENT_DIR/config/client-profile.md" << 'PROFILEEOF'
# Client Profile

## Business

- **Name:** (set during onboarding)
- **Niche:** (set during onboarding)
- **Industry:** (set during onboarding)
- **Target audience:** (set during onboarding)

## Brand Voice

- **Tone:** (set during onboarding)

## Methodology

- **Framework name:** (set during onboarding)

## Ideal Client

- **Who:** (set during onboarding)

## Sales Process

- **Pipeline stages:** New Lead > Qualified > Discovery Call Booked > Discovery Call Done > Proposal Sent > Closed Won > Closed Lost > Active Client
PROFILEEOF

# Reset content-pillars.json to empty template
cat > "$CLIENT_DIR/config/content-pillars.json" << 'PILLARSEOF'
{
  "pillars": [],
  "rotation": [],
  "posting_frequency": "2/day",
  "content_formats": ["reel"],
  "target_platforms": ["instagram"],
  "rotation_epoch": "2026-01-01"
}
PILLARSEOF

# Remove GHL pipeline config (client creates their own)
rm -f "$CLIENT_DIR/config/ghl-pipeline.json"

echo "Preserving product code, license, and modules config..."
# license.json stays (identifies the client)
# modules.json stays (what they purchased)
# notifications.json stays (reset by onboarding)
# openclaw.json stays (agent definitions)
# core/ stays (product code)

echo -e "${GREEN}Factory reset complete.${NC}"
echo "Next browser visit to http://localhost:3001 will show the onboarding wizard."
