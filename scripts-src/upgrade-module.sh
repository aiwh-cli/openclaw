#!/usr/bin/env bash
##############################################################################
# upgrade-module.sh — Activate or deactivate a module on a live AIWH machine.
#
# Usage:
#   upgrade-module.sh --activate backend
#   upgrade-module.sh --deactivate lifestyle
#   upgrade-module.sh --list
#
# Updates license.json, modules.json, and restarts dashboard.
##############################################################################

set -euo pipefail
source /opt/AIWH/core/scripts/lib/env.sh

AIWH_ROOT="/opt/AIWH"
LICENSE_FILE="$AIWH_ROOT/core/config/license.json"
MODULES_FILE="${CLIENT_ROOT:-/opt/AIWH/client}/config/modules.json"
VALID_MODULES=("frontend" "backend" "lifestyle")

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

usage() {
  echo "Usage: upgrade-module.sh --activate <module> | --deactivate <module> | --list"
  echo "Valid modules: ${VALID_MODULES[*]}"
  exit 1
}

validate_module() {
  local mod="$1"
  for valid in "${VALID_MODULES[@]}"; do
    [[ "$mod" == "$valid" ]] && return 0
  done
  echo -e "${RED}Invalid module: $mod${NC}" >&2
  echo "Valid modules: ${VALID_MODULES[*]}" >&2
  exit 1
}

cmd_list() {
  if [[ ! -f "$LICENSE_FILE" ]]; then
    echo "No license.json found"
    exit 1
  fi
  local active
  active=$(python3 -c "import json; lic=json.load(open('$LICENSE_FILE')); print(' '.join(lic.get('modules_active',[])))")
  local installed
  installed=$(python3 -c "import json; lic=json.load(open('$LICENSE_FILE')); print(' '.join(lic.get('modules_installed',[])))")

  echo "Installed: $installed"
  echo "Active:    $active"
  for mod in "${VALID_MODULES[@]}"; do
    if echo "$active" | grep -qw "$mod"; then
      echo -e "  ${GREEN}●${NC} $mod — active"
    elif echo "$installed" | grep -qw "$mod"; then
      echo -e "  ${YELLOW}○${NC} $mod — installed but inactive"
    else
      echo -e "  ${RED}✗${NC} $mod — not installed"
    fi
  done
}

cmd_activate() {
  local mod="$1"
  validate_module "$mod"

  echo -e "Activating module: ${GREEN}$mod${NC}"

  # Update license.json
  python3 -c "
import json
lic = json.load(open('$LICENSE_FILE'))
active = set(lic.get('modules_active', []))
installed = set(lic.get('modules_installed', []))
active.add('$mod')
installed.add('$mod')
lic['modules_active'] = sorted(active)
lic['modules_installed'] = sorted(installed)
json.dump(lic, open('$LICENSE_FILE', 'w'), indent=2)
print(f'  license.json: modules_active = {sorted(active)}')
"

  # Update modules.json
  python3 -c "
import json, os
f = '$MODULES_FILE'
mods = json.load(open(f)) if os.path.exists(f) else {}
if '$mod' not in mods:
    mods['$mod'] = {'enabled': True, 'label': '$mod'.capitalize(), 'features': {}}
else:
    mods['$mod']['enabled'] = True
json.dump(mods, open(f, 'w'), indent=2)
print(f'  modules.json: $mod enabled')
"

  # Restart dashboard to pick up changes
  echo "  Restarting dashboard..."
  launchctl kickstart -k "gui/$(id -u)/com.aiwh.dashboard" 2>/dev/null || {
    pkill -f "node.*server.js" 2>/dev/null || true
    sleep 2
    cd "$AIWH_ROOT/core/dashboard" && nohup node server.js >> /tmp/dashboard.log 2>&1 &
  }

  echo -e "${GREEN}Module '$mod' activated.${NC}"
}

cmd_deactivate() {
  local mod="$1"
  validate_module "$mod"

  echo -e "Deactivating module: ${YELLOW}$mod${NC}"

  # Update license.json (keep in modules_installed, remove from modules_active)
  python3 -c "
import json
lic = json.load(open('$LICENSE_FILE'))
active = set(lic.get('modules_active', []))
active.discard('$mod')
lic['modules_active'] = sorted(active)
json.dump(lic, open('$LICENSE_FILE', 'w'), indent=2)
print(f'  license.json: modules_active = {sorted(active)}')
"

  # Update modules.json
  python3 -c "
import json, os
f = '$MODULES_FILE'
mods = json.load(open(f)) if os.path.exists(f) else {}
if '$mod' in mods:
    mods['$mod']['enabled'] = False
json.dump(mods, open(f, 'w'), indent=2)
print(f'  modules.json: $mod disabled')
"

  # Restart dashboard
  echo "  Restarting dashboard..."
  launchctl kickstart -k "gui/$(id -u)/com.aiwh.dashboard" 2>/dev/null || {
    pkill -f "node.*server.js" 2>/dev/null || true
    sleep 2
    cd "$AIWH_ROOT/core/dashboard" && nohup node server.js >> /tmp/dashboard.log 2>&1 &
  }

  echo -e "${YELLOW}Module '$mod' deactivated. Agents will be blocked by module-manager.${NC}"
}

# Parse args
case "${1:-}" in
  --activate)   [[ -n "${2:-}" ]] || usage; cmd_activate "$2" ;;
  --deactivate) [[ -n "${2:-}" ]] || usage; cmd_deactivate "$2" ;;
  --list)       cmd_list ;;
  *)            usage ;;
esac
