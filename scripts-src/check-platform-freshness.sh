#!/bin/bash
# ─── Platform Changelog Freshness Monitor ────────────────────
# Checks 6 platform documentation/changelog URLs for content changes.
# Compares SHA-256 hashes against stored state. Notifies on changes.
# Runs weekly via dashboard script_cron (Monday 10AM).
#
# State file: $CLIENT_ROOT/data/platform-hashes.json
# Notification: aiwh_notify (Discord/Telegram/Slack)
# ──────────────────────────────────────────────────────────────

set -euo pipefail
source /opt/AIWH/core/scripts/lib/env.sh

CLIENT_ROOT="${CLIENT_ROOT:-/opt/AIWH/client}"
STATE_FILE="${CLIENT_ROOT}/data/platform-hashes.json"
LOG_FILE="${CLIENT_ROOT}/logs/platform-freshness.log"
CURL_TIMEOUT=30
CHANGED=()
ERRORS=()

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"; }

# Platform URLs — changelog or release notes pages
PLATFORM_NAMES=( gohighlevel makecom meta-ads n8n stripe xero )
PLATFORM_URLS=(
  "https://developers.gohighlevel.com/changelog"
  "https://www.make.com/en/release-notes"
  "https://developers.facebook.com/docs/graph-api/changelog"
  "https://docs.n8n.io/reference/release-notes/"
  "https://stripe.com/docs/changelog"
  "https://developer.xero.com/documentation/api-update"
)

# Initialize state file if missing
if [[ ! -f "$STATE_FILE" ]]; then
  echo '{}' > "$STATE_FILE"
  log "Created empty state file: $STATE_FILE"
fi

# Read existing state
STATE=$(cat "$STATE_FILE")

log "Starting platform freshness check (${#PLATFORM_NAMES[@]} platforms)"

for i in "${!PLATFORM_NAMES[@]}"; do
  platform="${PLATFORM_NAMES[$i]}"
  url="${PLATFORM_URLS[$i]}"
  log "  Checking $platform: $url"

  # Fetch page content, compute hash
  BODY=$(curl -sL --max-time "$CURL_TIMEOUT" -A "AIWH-FreshnessMonitor/1.0" "$url" 2>/dev/null) || {
    log "  ⚠ Failed to fetch $platform (curl error)"
    ERRORS+=("$platform")
    continue
  }

  if [[ -z "$BODY" ]]; then
    log "  ⚠ Empty response from $platform"
    ERRORS+=("$platform")
    continue
  fi

  # Hash the body (strip whitespace-only changes)
  NEW_HASH=$(echo "$BODY" | sed 's/[[:space:]]*//g' | shasum -a 256 | cut -d' ' -f1)
  OLD_HASH=$(echo "$STATE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('$platform',{}).get('hash',''))" 2>/dev/null)

  if [[ "$NEW_HASH" == "$OLD_HASH" ]]; then
    log "  ✓ $platform unchanged"
  else
    if [[ -z "$OLD_HASH" ]]; then
      log "  ◉ $platform baseline recorded (first check)"
    else
      log "  ⚡ $platform CHANGED — docs may need updating"
      CHANGED+=("$platform")
    fi
  fi

  # Update state
  TODAY=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
  STATE=$(echo "$STATE" | python3 -c "
import json, sys
d = json.load(sys.stdin)
d['$platform'] = {
    'url': '$url',
    'hash': '$NEW_HASH',
    'last_checked': '$TODAY',
    'last_changed': '$TODAY' if '$NEW_HASH' != '$OLD_HASH' and '$OLD_HASH' != '' else d.get('$platform', {}).get('last_changed', '$TODAY')
}
json.dump(d, sys.stdout, indent=2)
")
done

# Write updated state
echo "$STATE" > "$STATE_FILE"

# Summary
log "Done: ${#CHANGED[@]} changed, ${#ERRORS[@]} errors"

# Notify if changes detected
if [[ ${#CHANGED[@]} -gt 0 ]]; then
  MSG="🔄 Platform docs changed: ${CHANGED[*]}. Training docs may need updating. Check /opt/AIWH/core/modules/training/platforms/ for affected platforms."
  aiwh_notify "$MSG" "knowledge" || log "⚠ Notification failed"
  log "Notification sent for: ${CHANGED[*]}"
fi

if [[ ${#ERRORS[@]} -gt 0 ]]; then
  log "Failed platforms: ${ERRORS[*]}"
fi

exit 0
