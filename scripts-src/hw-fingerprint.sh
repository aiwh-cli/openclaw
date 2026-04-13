#!/bin/bash
# Hardware Fingerprint Generator — Theme AB.2.8
# Generates a stable machine ID from Mac hardware identifiers.
# Output: SHA-256 hash written to device-registration.json + stdout

CLIENT_DIR="${CLIENT_ROOT:-/opt/AIWH/client}"
REG_FILE="$CLIENT_DIR/config/device-registration.json"

SERIAL=$(/usr/sbin/ioreg -rd1 -c IOPlatformExpertDevice | awk -F'"' '/IOPlatformSerialNumber/{print $4}')
CPU_UUID=$(/usr/sbin/ioreg -rd1 -c IOPlatformExpertDevice | awk -F'"' '/IOPlatformUUID/{print $4}')
MAC_ADDR=$(/sbin/ifconfig en1 2>/dev/null | awk '/ether/{print $2}')
[ -z "$MAC_ADDR" ] && MAC_ADDR=$(/sbin/ifconfig en0 2>/dev/null | awk '/ether/{print $2}')

HW_ID=$(echo "${SERIAL}:${CPU_UUID}:${MAC_ADDR}" | shasum -a 256 | cut -d' ' -f1)

# Update device-registration.json with fingerprint
python3 -c "
import json, os
reg_file = '$REG_FILE'
reg = {}
if os.path.exists(reg_file):
    try: reg = json.load(open(reg_file))
    except: pass
reg['hardware_fingerprint'] = '$HW_ID'
with open(reg_file, 'w') as f: json.dump(reg, f, indent=2)
"

echo "$HW_ID"
