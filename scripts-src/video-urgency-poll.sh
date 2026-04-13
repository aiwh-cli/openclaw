#!/bin/bash
set -euo pipefail
source /opt/AIWH/core/scripts/lib/env.sh

# Video Urgency Poll — Checks #video-review for ✅/❌ reactions on urgent video proposals
# Pattern: Same as knowledge-reaction-poll.sh (verified working)
# Cron: Piggybacks on buffer-status-check at 11am daily

CLIENT_ROOT="${CLIENT_ROOT:-/opt/AIWH/client}"
DB="$CLIENT_ROOT/data/video-jobs.db"
ENV_FILE="/opt/AIWH/.openclaw/.env"
LOG_FILE="$CLIENT_ROOT/logs/urgency-poll.log"
STATE_FILE="$CLIENT_ROOT/data/.video-urgency-poll-state.json"
DISCORD_CHANNEL="1477588772131442931"  # #video-review

mkdir -p "$(dirname "$LOG_FILE")"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Load secrets (encrypted store preferred, .env fallback)
aiwh_load_secrets DISCORD_TOKEN

log "=== Urgency Poll Started ==="

# Fetch recent messages from #video-review
messages=$(curl -s \
  -H "Authorization: Bot ${DISCORD_TOKEN}" \
  -H "Content-Type: application/json" \
  "https://discord.com/api/v10/channels/${DISCORD_CHANNEL}/messages?limit=30" 2>/dev/null || echo "[]")

# Process with Python
echo "$messages" | python3 -c "
import json, sys, re, os, sqlite3

DB_PATH = '$DB'
STATE_FILE = '$STATE_FILE'
LOG_FILE = '$LOG_FILE'

try:
    messages = json.load(sys.stdin)
except:
    print('No messages to process')
    sys.exit(0)

if not isinstance(messages, list):
    print(f'Discord API error: {messages}')
    sys.exit(1)

# Load processed state
processed = set()
if os.path.exists(STATE_FILE):
    try:
        with open(STATE_FILE) as f:
            processed = set(json.load(f).get('processed', []))
    except:
        pass

db = sqlite3.connect(DB_PATH)
new_processed = list(processed)
actions = 0

for msg in messages:
    msg_id = msg.get('id', '')
    content = msg.get('content', '') or ''
    reactions = msg.get('reactions', [])

    if msg_id in processed or not reactions:
        continue

    # Look for [URGENT_VIDEO_ID=job_XXXXXXXX_XXXX]
    match = re.search(r'\[URGENT_VIDEO_ID=(job_\d{8}_\d{4})\]', content)
    if not match:
        continue

    job_id = match.group(1)

    has_approve = False
    has_reject = False
    for r in reactions:
        emoji = r.get('emoji', {})
        name = emoji if isinstance(emoji, str) else emoji.get('name', '')
        count = r.get('count', 0)
        if name in ('✅', 'white_check_mark') and count > 0:
            has_approve = True
        if name in ('❌', 'x') and count > 0:
            has_reject = True

    if not has_approve and not has_reject:
        continue

    # Check job exists and is in urgent_review
    row = db.execute('SELECT status FROM video_jobs WHERE job_id = ?', (job_id,)).fetchone()
    if not row:
        new_processed.append(msg_id)
        continue

    if row[0] != 'urgent_review':
        new_processed.append(msg_id)
        continue

    import datetime
    now = datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')

    if has_approve:
        db.execute('UPDATE video_jobs SET status = ?, updated_at = ? WHERE job_id = ?', ('draft', now, job_id))
        print(f'  ✅ {job_id} → approved (back to draft for pipeline)')
        actions += 1
    elif has_reject:
        db.execute('UPDATE video_jobs SET status = ?, updated_at = ? WHERE job_id = ?', ('rejected', now, job_id))
        print(f'  ❌ {job_id} → rejected')
        actions += 1

    new_processed.append(msg_id)

db.commit()
db.close()

# Save state
with open(STATE_FILE, 'w') as f:
    json.dump({'processed': list(set(new_processed))[-200:]}, f)

print(f'Actions taken: {actions}')
"

log "=== Urgency Poll Complete ==="
