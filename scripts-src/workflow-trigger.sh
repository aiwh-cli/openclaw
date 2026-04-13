#!/usr/bin/env bash
# workflow-trigger.sh — Trigger a workflow via the dashboard API.
# Called by script crons. $0 LLM cost.
# Usage: workflow-trigger.sh <template-id>

set -euo pipefail
source "$(dirname "$0")/lib/env.sh"

TEMPLATE_ID="${1:-}"
DASHBOARD_URL="http://localhost:3001"

if [[ -z "$TEMPLATE_ID" ]]; then
  echo "Usage: workflow-trigger.sh <template-id>"
  exit 1
fi

response=$(curl -s -X POST "$DASHBOARD_URL/api/workflows/$TEMPLATE_ID/trigger" \
  -H "Content-Type: application/json" \
  --connect-timeout 5 \
  --max-time 10 2>&1) || {
  aiwh_notify "Workflow trigger failed for $TEMPLATE_ID — dashboard unreachable" "systems"
  exit 1
}

# Check response
ok=$(echo "$response" | python3 -c "import json,sys; print(json.load(sys.stdin).get('ok',''))" 2>/dev/null || echo "")
if [[ "$ok" == "True" ]]; then
  name=$(echo "$response" | python3 -c "import json,sys; print(json.load(sys.stdin).get('name',''))" 2>/dev/null || echo "$TEMPLATE_ID")
  echo "Workflow triggered: $name"
else
  error=$(echo "$response" | python3 -c "import json,sys; print(json.load(sys.stdin).get('error','unknown'))" 2>/dev/null || echo "unknown")
  aiwh_notify "Workflow trigger failed for $TEMPLATE_ID: $error" "systems"
  exit 1
fi
