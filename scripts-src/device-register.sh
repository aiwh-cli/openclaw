#!/usr/bin/env bash
# device-register.sh — Generate device secret and register with central server.
#
# Usage:
#   device-register.sh                    # Uses client_id from license.json
#   device-register.sh --client-id acme   # Override client_id
#
# Creates client/config/device-registration.json with a 256-bit device secret.
# Registers the device with the AIWH central server for team management API auth.
# Safe to re-run: skips if device-registration.json already exists (use --force to regenerate).

set -euo pipefail
source "$(dirname "$0")/lib/env.sh"

AIWH_ROOT="${AIWH_ROOT:-/opt/AIWH}"
CLIENT_DIR="${CLIENT_DIR:-$AIWH_ROOT/client}"
REG_FILE="$CLIENT_DIR/config/device-registration.json"
CENTRAL_URL="${AIWH_CENTRAL_URL:-https://www.aiwealthhub.app/api/team/register}"
REG_TOKEN="${DEVICE_REGISTRATION_TOKEN:-}"
FORCE=false
CLIENT_ID=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --client-id) CLIENT_ID="$2"; shift 2 ;;
        --force)     FORCE=true; shift ;;
        -h|--help)
            echo "Usage: device-register.sh [--client-id <id>] [--force]"
            exit 0 ;;
        *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
done

# Get client_id from license if not provided
if [[ -z "$CLIENT_ID" ]]; then
    LICENSE="$AIWH_ROOT/core/config/license.json"
    if [[ -f "$LICENSE" ]]; then
        CLIENT_ID="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('client_id',''))" "$LICENSE" 2>/dev/null || true)"
    fi
    if [[ -z "$CLIENT_ID" ]]; then
        echo "Error: No client_id found. Use --client-id or ensure license.json has client_id." >&2
        exit 1
    fi
fi

# Validate client_id — alphanumeric, hyphens, underscores only (prevents injection)
if [[ ! "$CLIENT_ID" =~ ^[a-zA-Z0-9_-]{1,64}$ ]]; then
    echo "Error: Invalid client_id '$CLIENT_ID'. Must be 1-64 alphanumeric/hyphen/underscore characters." >&2
    exit 1
fi

# Check if already registered
if [[ -f "$REG_FILE" ]] && ! $FORCE; then
    echo "Device already registered: $REG_FILE"
    echo "Use --force to regenerate."
    exit 0
fi

# Generate device secret (256-bit hex)
DEVICE_SECRET="$(openssl rand -hex 32)"
# Use client_id as hostname if it already starts with aiwh-, otherwise prefix it
if [[ "$CLIENT_ID" == aiwh-* ]]; then
    HOSTNAME="$CLIENT_ID"
else
    HOSTNAME="aiwh-${CLIENT_ID}"
fi
REGISTERED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Write registration file (chmod 600 — only owner can read)
mkdir -p "$CLIENT_DIR/config"
python3 -c "
import json, sys
json.dump({
    'client_id': sys.argv[1],
    'device_secret': sys.argv[2],
    'hostname': sys.argv[3],
    'registered_at': sys.argv[4]
}, open(sys.argv[5], 'w'), indent=2)
" "$CLIENT_ID" "$DEVICE_SECRET" "$HOSTNAME" "$REGISTERED_AT" "$REG_FILE"
chmod 600 "$REG_FILE"
echo "Device registration file created: $REG_FILE"

# Build JSON payload safely via python3 (includes registration token)
PAYLOAD="$(python3 -c "
import json, sys
print(json.dumps({'client_id': sys.argv[1], 'device_secret': sys.argv[2], 'hostname': sys.argv[3], 'registration_token': sys.argv[4]}))
" "$CLIENT_ID" "$DEVICE_SECRET" "$HOSTNAME" "$REG_TOKEN")"

# Register with central server
echo "Registering with central server..."
HTTP_CODE="$(curl -s -o /dev/null -w '%{http_code}' \
    -X POST "$CENTRAL_URL" \
    -H 'Content-Type: application/json' \
    -d "$PAYLOAD" \
    --connect-timeout 10 --max-time 30 2>/dev/null || echo "000")"

if [[ "$HTTP_CODE" == "200" || "$HTTP_CODE" == "201" ]]; then
    echo "Device registered successfully with central server."
elif [[ "$HTTP_CODE" == "000" ]]; then
    echo "Warning: Could not reach central server ($CENTRAL_URL)."
    echo "Device registration file saved locally. Registration will be retried from the dashboard."
else
    echo "Warning: Central server returned HTTP $HTTP_CODE."
    echo "Device registration file saved locally. Registration will be retried from the dashboard."
fi
