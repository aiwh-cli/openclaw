#!/usr/bin/env bash
##############################################################################
# reset-password.sh — Reset the dashboard password.
#
# Usage (interactive):
#   reset-password.sh
#
# Usage (scripted, e.g. via Tailscale SSH):
#   reset-password.sh --password "NewPass123"
##############################################################################

set -euo pipefail
source /opt/AIWH/core/scripts/lib/env.sh

AUTH_FILE="${CLIENT_ROOT:-/opt/AIWH/client}/config/auth.json"

if [[ ! -f "$AUTH_FILE" ]]; then
  echo "No auth.json found — no password is set."
  echo "Visit http://localhost:3001 to run onboarding."
  exit 0
fi

NEW_PW=""
if [[ "${1:-}" == "--password" && -n "${2:-}" ]]; then
  NEW_PW="$2"
else
  echo "Dashboard Password Reset"
  echo "========================"
  read -sp "Enter new password (min 8 chars): " NEW_PW
  echo ""
  if [[ ${#NEW_PW} -lt 8 ]]; then
    echo "Error: password must be at least 8 characters."
    exit 1
  fi
  read -sp "Confirm new password: " CONFIRM
  echo ""
  if [[ "$NEW_PW" != "$CONFIRM" ]]; then
    echo "Error: passwords do not match."
    exit 1
  fi
fi

if [[ ${#NEW_PW} -lt 8 ]]; then
  echo "Error: password must be at least 8 characters."
  exit 1
fi

# Use Node.js (same crypto as the dashboard) to ensure hash compatibility
node -e "
const crypto = require('crypto');
const fs = require('fs');
const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.scryptSync(process.argv[1], salt, 64).toString('hex');
let auth = {};
try { auth = JSON.parse(fs.readFileSync('$AUTH_FILE', 'utf8')); } catch {}
auth.passwordHash = hash;
auth.passwordSalt = salt;
auth.passwordChangedAt = new Date().toISOString();
fs.writeFileSync('$AUTH_FILE', JSON.stringify(auth, null, 2), { mode: 0o600 });
console.log('Password reset successfully.');
console.log('Log in at http://localhost:3001/login.html');
" "$NEW_PW"
