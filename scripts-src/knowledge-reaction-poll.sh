#!/bin/bash
#
# Knowledge Review — Discord Reaction Poller
#
# Checks #knowledge-review messages for ✅/❌ reactions.
# Each message contains one entry — reaction on that message controls that entry.
# ✅ = approve (publish), ❌ = reject
#
# Usage:
#   knowledge-reaction-poll.sh          # Poll once
#   knowledge-reaction-poll.sh --watch  # Poll every 60s
#
# Updated: 2026-03-01 — Handles individual entry messages, updates posted state

set -euo pipefail
source /opt/AIWH/core/scripts/lib/env.sh

ENV_FILE="/opt/AIWH/.openclaw/.env"
# Load secrets (encrypted store preferred, .env fallback)
aiwh_load_secrets SUPABASE_URL SUPABASE_SERVICE_KEY DISCORD_TOKEN

SUPABASE_API="${SUPABASE_URL}/rest/v1/base_knowledge"
AUTH_HEADERS=(-H "apikey: ${SUPABASE_SERVICE_KEY}" -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}")
DISCORD_CHANNEL="1477162701682905132"
REACTION_STATE="/opt/AIWH/core/.knowledge-reaction-state.json"
POSTED_STATE="/opt/AIWH/core/.knowledge-review-posted.json"

poll_once() {
    local messages
    # Use Discord REST API directly — works regardless of OpenClaw gateway state
    messages=$(curl -s \
        -H "Authorization: Bot ${DISCORD_TOKEN}" \
        -H "Content-Type: application/json" \
        "https://discord.com/api/v10/channels/${DISCORD_CHANNEL}/messages?limit=30") || {
        echo "⚠️ Failed to reach Discord REST API"
        return 1
    }
    # Verify response is a JSON array (errors return an object with "message" field)
    if ! echo "$messages" | python3 -c "import sys,json; d=json.load(sys.stdin); assert isinstance(d,list)" 2>/dev/null; then
        err=$(echo "$messages" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('message','unknown error'))" 2>/dev/null || echo "invalid response")
        echo "⚠️ Discord API error: $err"
        return 1
    fi

    echo "$messages" | python3 -c "
import json, sys, re, urllib.request, os

try:
    messages = json.load(sys.stdin)
except:
    print('No messages to process')
    sys.exit(0)

if not isinstance(messages, list):
    messages = messages.get('messages', [])

# Load reaction state (processed message IDs)
reaction_state = '${REACTION_STATE}'
processed = set()
if os.path.exists(reaction_state):
    try:
        with open(reaction_state) as f:
            processed = set(json.load(f).get('processed', []))
    except: pass

supabase_url = os.environ.get('SUPABASE_URL', '')
service_key = os.environ.get('SUPABASE_SERVICE_KEY', '')
headers = {
    'apikey': service_key,
    'Authorization': f'Bearer {service_key}',
    'Content-Type': 'application/json'
}

new_processed = list(processed)
actions_taken = 0

for msg in messages:
    msg_id = msg.get('id', '')
    content = msg.get('content', '') or msg.get('text', '') or ''
    reactions = msg.get('reactions', [])

    if not reactions or msg_id in processed:
        continue

    # Extract draft ID — look for [xxxxxxxx] pattern (8-char hex)
    id_match = re.search(r'\[([0-9a-f]{8})\]', content)
    if not id_match:
        continue

    short_id = id_match.group(1)

    # Check reactions
    has_approve = False
    has_reject = False
    for r in reactions:
        emoji = r.get('emoji', {})
        name = emoji if isinstance(emoji, str) else emoji.get('name', '')
        count = r.get('count', 0)
        if name in ('✅', '☑️', 'white_check_mark') and count > 0:
            has_approve = True
        if name in ('❌', '✖️', 'x') and count > 0:
            has_reject = True

    if not has_approve and not has_reject:
        continue

    # Find full UUID from Supabase
    try:
        req = urllib.request.Request(
            f'{supabase_url}/rest/v1/base_knowledge?select=id&status=eq.draft',
            headers=headers
        )
        resp = urllib.request.urlopen(req)
        drafts = json.loads(resp.read())
        full_id = None
        for d in drafts:
            if d['id'].startswith(short_id):
                full_id = d['id']
                break

        if not full_id:
            # Already processed or not a draft anymore
            new_processed.append(msg_id)
            continue

        # Apply action (approve wins if both present)
        new_status = 'published' if has_approve else 'rejected'
        patch_data = json.dumps({'status': new_status}).encode()
        patch_req = urllib.request.Request(
            f'{supabase_url}/rest/v1/base_knowledge?id=eq.{full_id}',
            data=patch_data,
            headers={**headers, 'Prefer': 'return=minimal'},
            method='PATCH'
        )
        urllib.request.urlopen(patch_req)

        emoji = '✅' if has_approve else '❌'
        print(f'  {emoji} [{short_id}] → {new_status}')
        actions_taken += 1
        new_processed.append(msg_id)

    except Exception as e:
        print(f'  ⚠️ Error processing [{short_id}]: {e}')

# Save reaction state
with open(reaction_state, 'w') as f:
    json.dump({'processed': list(set(new_processed))[-200:]}, f)

if actions_taken == 0:
    print('No new reactions to process.')
else:
    print(f'Processed {actions_taken} reactions.')
" 2>&1
}

case "${1:-}" in
    --watch)
        echo "Watching #knowledge-review for reactions (Ctrl+C to stop)..."
        while true; do
            poll_once
            sleep 60
        done
        ;;
    *)
        poll_once
        ;;
esac
