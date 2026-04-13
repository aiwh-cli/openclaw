#!/usr/bin/env bash
# check-update.sh — Check for new AIWH versions and notify if available
# Called daily at 3am by script-cron. Does NOT auto-apply.

source /opt/AIWH/core/scripts/lib/env.sh

AIWH_ROOT="/opt/AIWH"
cd "$AIWH_ROOT" || exit 1

# Fetch latest tags
git fetch --tags --quiet 2>/dev/null || { echo "Failed to fetch tags"; exit 1; }

# Current version
CURRENT=$(git describe --tags --exact-match 2>/dev/null || git rev-parse --short HEAD)

# Latest tag
LATEST=$(git tag --sort=-creatordate | head -1)

if [[ -z "$LATEST" ]]; then
  echo "No tags found"
  exit 0
fi

if [[ "$CURRENT" == "$LATEST" ]]; then
  echo "Up to date: $CURRENT"
  exit 0
fi

# New version available — notify
COMMIT_COUNT=$(git log --oneline "$CURRENT..$LATEST" 2>/dev/null | wc -l | tr -d ' ')
aiwh_notify "Update available: $CURRENT → $LATEST ($COMMIT_COUNT commits). Run update-aiwh.sh to apply." "systems"
echo "Update available: $CURRENT → $LATEST ($COMMIT_COUNT commits)"
