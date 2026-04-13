#!/bin/bash
#
# Knowledge Review Workflow
#
# Lists draft entries from Supabase, auto-publishes high-confidence ones,
# and posts low-confidence ones to Discord #knowledge-review for human review.
# Each entry gets its own Discord message for individual approve/reject control.
#
# Usage:
#   knowledge-review.sh                  # Review all drafts
#   knowledge-review.sh --approve <id>   # Approve a specific draft
#   knowledge-review.sh --reject <id>    # Reject (delete) a specific draft
#   knowledge-review.sh --list           # List all drafts (with filter info)
#   knowledge-review.sh --auto           # Auto-publish ≥0.90 confidence, post rest to Discord
#
# Updated: 2026-03-01 — Individual messages, test filtering, dedup tracking

set -euo pipefail
source /opt/AIWH/core/scripts/lib/env.sh

# Load secrets (encrypted store preferred, .env fallback)
aiwh_load_secrets SUPABASE_URL SUPABASE_SERVICE_KEY

API="${SUPABASE_URL}/rest/v1/base_knowledge"
AUTH_HEADERS=(-H "apikey: ${SUPABASE_SERVICE_KEY}" -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}")

DISCORD_CHANNEL="1477162701682905132"
AUTO_PUBLISH_THRESHOLD="0.90"

# State file: tracks which entry UUIDs have been posted to Discord
POSTED_STATE="/opt/AIWH/core/.knowledge-review-posted.json"

fetch_drafts() {
    curl -s "${API}?select=id,content,category,source,knowledge_type,created_at&status=eq.draft&order=created_at.desc" \
        "${AUTH_HEADERS[@]}" \
        -H "Content-Type: application/json"
}

# Filter test data. Outputs clean JSON to stdout, skip reasons to stderr.
filter_drafts() {
    python3 -c "
import json, sys, re

drafts = json.load(sys.stdin)
filtered = []

for e in drafts:
    src = (e.get('source') or '').lower()
    content = (e.get('content') or '').strip()
    cat = (e.get('category') or '').lower()

    # Filter: test sources (e2e-test, test, e2e-*)
    if src == 'test' or src.startswith('e2e-') or src == 'e2e':
        print(f'SKIP:[{e[\"id\"][:8]}] test source: {src}', file=sys.stderr)
        continue

    # Filter: content starting with 'test'
    if re.match(r'^test\b', content, re.IGNORECASE):
        print(f'SKIP:[{e[\"id\"][:8]}] test content', file=sys.stderr)
        continue

    # Filter: E2E test marker in content
    if re.search(r'\bE2E test\b', content, re.IGNORECASE):
        print(f'SKIP:[{e[\"id\"][:8]}] E2E test in content', file=sys.stderr)
        continue

    # Filter: test category
    if cat == 'test':
        print(f'SKIP:[{e[\"id\"][:8]}] test category', file=sys.stderr)
        continue

    filtered.append(e)

json.dump(filtered, sys.stdout)
"
}

list_drafts() {
    local drafts
    drafts=$(fetch_drafts)

    local total
    total=$(echo "$drafts" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")

    if [[ "$total" == "0" ]]; then
        echo "No drafts pending review."
        return 0
    fi

    echo "📋 Raw drafts: $total"
    echo ""

    # Filter — capture stderr (skip reasons) and stdout (clean JSON)
    local skip_reasons
    skip_reasons=$(echo "$drafts" | filter_drafts 2>&1 1>/tmp/kr-filtered.json)

    if [[ -n "$skip_reasons" ]]; then
        echo "🚫 Filtered out (test data):"
        echo "$skip_reasons" | sed 's/^SKIP:/  /'
        echo ""
    fi

    local clean_count
    clean_count=$(python3 -c "import json; print(len(json.load(open('/tmp/kr-filtered.json'))))" 2>/dev/null || echo "0")

    echo "✅ $clean_count entries pass filter:"
    echo ""

    python3 -c "
import json, os

entries = json.load(open('/tmp/kr-filtered.json'))

posted = set()
state_file = '${POSTED_STATE}'
if os.path.exists(state_file):
    try:
        with open(state_file) as f:
            posted = set(json.load(f).get('posted_ids', []))
    except: pass

for e in entries:
    flag = '📨' if e['id'] in posted else '🆕'
    preview = e['content'][:120].replace('\n', ' ')
    print(f'  {flag} [{e[\"id\"][:8]}] {e[\"category\"]} ({e.get(\"knowledge_type\", \"?\")}) — {preview}...')
    print(f'           Source: {e.get(\"source\", \"unknown\")} | Created: {e[\"created_at\"][:10]}')
    print()

print('Legend: 🆕 = not yet posted to Discord, 📨 = already posted')
" 2>/dev/null

    rm -f /tmp/kr-filtered.json
}

approve_draft() {
    local id="$1"

    if [[ ${#id} -lt 36 ]]; then
        local full_id
        full_id=$(curl -s "${API}?select=id&status=eq.draft" \
            "${AUTH_HEADERS[@]}" | python3 -c "
import json,sys
d=json.load(sys.stdin)
matches=[e['id'] for e in d if e['id'].startswith('${id}')]
print(matches[0] if matches else '')
" 2>/dev/null)
        if [[ -z "$full_id" ]]; then
            echo "ERROR: No draft found matching '$id'"
            return 1
        fi
        id="$full_id"
    fi

    local result
    result=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "${API}?id=eq.${id}" \
        "${AUTH_HEADERS[@]}" \
        -H "Content-Type: application/json" \
        -H "Prefer: return=minimal" \
        -d '{"status": "published"}')

    if [[ "$result" == "204" ]]; then
        echo "✅ Approved and published: ${id:0:8}..."
    else
        echo "❌ Failed to approve (HTTP $result): ${id:0:8}..."
    fi
}

reject_draft() {
    local id="$1"

    if [[ ${#id} -lt 36 ]]; then
        local full_id
        full_id=$(curl -s "${API}?select=id" \
            "${AUTH_HEADERS[@]}" | python3 -c "
import json,sys
d=json.load(sys.stdin)
matches=[e['id'] for e in d if e['id'].startswith('${id}')]
print(matches[0] if matches else '')
" 2>/dev/null)
        if [[ -z "$full_id" ]]; then
            echo "ERROR: No entry found matching '$id'"
            return 1
        fi
        id="$full_id"
    fi

    local result
    result=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "${API}?id=eq.${id}" \
        "${AUTH_HEADERS[@]}" \
        -H "Content-Type: application/json" \
        -H "Prefer: return=minimal" \
        -d '{"status": "rejected"}')

    if [[ "$result" == "204" ]]; then
        echo "❌ Rejected: ${id:0:8}..."
    else
        echo "⚠️ Failed to reject (HTTP $result): ${id:0:8}..."
    fi
}

# Add an entry ID to the posted state file
add_posted_id() {
    local entry_id="$1"
    python3 -c "
import json, os
sf = '${POSTED_STATE}'
data = {'posted_ids': []}
if os.path.exists(sf):
    try:
        with open(sf) as f: data = json.load(f)
    except: pass
ids = data.get('posted_ids', [])
if '${entry_id}' not in ids:
    ids.append('${entry_id}')
data['posted_ids'] = ids[-200:]
with open(sf, 'w') as f:
    json.dump(data, f, indent=2)
" 2>/dev/null
}

auto_review() {
    local drafts_raw
    drafts_raw=$(fetch_drafts)

    local total
    total=$(echo "$drafts_raw" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")

    if [[ "$total" == "0" ]]; then
        echo "No drafts to review."
        return 0
    fi

    echo "Found $total raw drafts."

    # Filter test data
    local skip_info
    skip_info=$(echo "$drafts_raw" | filter_drafts 2>&1 1>/tmp/kr-filtered.json)

    if [[ -n "$skip_info" ]]; then
        echo "🚫 Filtered out test data:"
        echo "$skip_info" | sed 's/^SKIP:/  /' | head -20
    fi

    local clean_count
    clean_count=$(python3 -c "import json; print(len(json.load(open('/tmp/kr-filtered.json'))))" 2>/dev/null || echo "0")

    echo "Processing $clean_count clean entries..."

    # Categorize: auto-publish / needs-review / already-posted
    python3 -c "
import json, os

entries = json.load(open('/tmp/kr-filtered.json'))
threshold = float('${AUTO_PUBLISH_THRESHOLD}')

posted_ids = set()
sf = '${POSTED_STATE}'
if os.path.exists(sf):
    try:
        with open(sf) as f:
            posted_ids = set(json.load(f).get('posted_ids', []))
    except: pass

def estimate_confidence(entry):
    \"\"\"Estimate confidence from entry metadata.
    Sources:
    - Cinematic extraction: source field encodes grade level
    - Tag extraction: knowledge_type + category heuristic
    \"\"\"
    source = (entry.get('source') or '').lower()
    ktype = (entry.get('knowledge_type') or '').lower()
    category = (entry.get('category') or '').lower()

    # Cinematic patterns from high-grade assets (4-5 stars)
    if 'style_grades' in source and ':high' in source:
        return 0.90
    # Cinematic patterns from low-grade assets (anti-patterns)
    if 'style_grades' in source and ':low' in source:
        return 0.75
    # Cinematic summary facts
    if 'style_grades:summary' in source:
        return 0.90
    # LLM-extracted entries: Haiku quality prompt + cosine dedup = reliable gate
    if source.startswith('llm-extract'):
        return 0.90
    # Tag-extracted with explicit confidence in source
    if 'confidence:' in source:
        try:
            return float(source.split('confidence:')[1].split()[0])
        except: pass
    # Heuristic by type
    if ktype == 'fact':
        return 0.85
    if ktype == 'pattern':
        return 0.70
    if ktype == 'antipattern':
        return 0.65
    if ktype == 'fix':
        return 0.80
    # Default: needs human review
    return 0.50

auto_pub, needs_review, already_posted = [], [], []

for e in entries:
    conf = estimate_confidence(e)
    e['_confidence'] = conf
    if conf >= threshold:
        auto_pub.append(e)
    elif e['id'] in posted_ids:
        already_posted.append(e)
    else:
        needs_review.append(e)

json.dump({'auto_publish': auto_pub, 'needs_review': needs_review, 'already_posted': already_posted},
          open('/tmp/kr-review-result.json', 'w'))
" 2>/dev/null

    # Auto-publish high confidence
    local auto_published=0
    while IFS= read -r id; do
        [[ -z "$id" ]] && continue
        curl -s -o /dev/null -X PATCH "${API}?id=eq.${id}" \
            "${AUTH_HEADERS[@]}" \
            -H "Content-Type: application/json" \
            -H "Prefer: return=minimal" \
            -d '{"status": "published"}'
        auto_published=$((auto_published + 1))
    done < <(python3 -c "import json; [print(e['id']) for e in json.load(open('/tmp/kr-review-result.json'))['auto_publish']]" 2>/dev/null)

    local already_count
    already_count=$(python3 -c "import json; print(len(json.load(open('/tmp/kr-review-result.json'))['already_posted']))" 2>/dev/null || echo "0")

    # Post each new entry as its own Discord message
    local posted_count=0
    while IFS= read -r entry_line; do
        [[ -z "$entry_line" ]] && continue

        local entry_id
        entry_id=$(echo "$entry_line" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])" 2>/dev/null)

        local msg
        msg=$(echo "$entry_line" | python3 -c "
import json, sys
e = json.load(sys.stdin)
conf = e.get('_confidence', '?')
conf_str = '{:.0%}'.format(conf) if isinstance(conf, (int, float)) else str(conf)
preview = e['content'][:300].replace('\n', ' ').strip()
lines = [
    '**📋 Knowledge Review**',
    '',
    '**ID:** \`[{}]\`'.format(e['id'][:8]),
    '**Category:** {} ({})'.format(e['category'], e.get('knowledge_type', '?')),
    '**Source:** {}'.format(e.get('source', '?')),
    '**Confidence:** {}'.format(conf_str),
    '',
    '> {}'.format(preview),
    '',
    'React ✅ to approve • ❌ to reject'
]
print('\n'.join(lines))
" 2>/dev/null)

        if [[ -n "$msg" ]]; then
            openclaw message send --channel discord --target "channel:${DISCORD_CHANNEL}" --message "$msg" 2>/dev/null && {
                add_posted_id "$entry_id"
                posted_count=$((posted_count + 1))
                echo "  📨 Posted [${entry_id:0:8}] to Discord"
            } || {
                echo "  ⚠️ Failed to post [${entry_id:0:8}]"
            }
            sleep 1
        fi
    done < <(python3 -c "import json; [print(json.dumps(e)) for e in json.load(open('/tmp/kr-review-result.json'))['needs_review']]" 2>/dev/null)

    echo ""
    echo "Results:"
    echo "  ✅ Auto-published (≥${AUTO_PUBLISH_THRESHOLD} confidence): $auto_published"
    echo "  📨 Posted to Discord (new): $posted_count"
    echo "  ⏭️  Already posted (skipped): $already_count"
    echo "  🚫 Filtered (test data): $((total - clean_count))"

    rm -f /tmp/kr-filtered.json /tmp/kr-review-result.json
}

expire_old_drafts() {
    local days="${1:-30}"
    local cutoff
    cutoff=$(date -u -v-${days}d '+%Y-%m-%dT%H:%M:%S' 2>/dev/null || date -u -d "${days} days ago" '+%Y-%m-%dT%H:%M:%S' 2>/dev/null)
    if [[ -z "$cutoff" ]]; then
        echo "ERROR: Could not compute date cutoff"
        return 1
    fi

    # Fetch old drafts from Supabase
    local old_drafts
    old_drafts=$(curl -s "${API}?select=id&status=eq.draft&created_at=lt.${cutoff}" \
        "${AUTH_HEADERS[@]}" -H "Content-Type: application/json")

    local count
    count=$(echo "$old_drafts" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")

    if [[ "$count" == "0" ]]; then
        echo "No drafts older than ${days} days."
        return 0
    fi

    echo "Found $count drafts older than ${days} days (before $cutoff)."

    # Reject them in batches
    local rejected=0
    while IFS= read -r id; do
        [[ -z "$id" ]] && continue
        curl -s -o /dev/null -X PATCH "${API}?id=eq.${id}" \
            "${AUTH_HEADERS[@]}" \
            -H "Content-Type: application/json" \
            -H "Prefer: return=minimal" \
            -d '{"status": "rejected"}'
        rejected=$((rejected + 1))
    done < <(echo "$old_drafts" | python3 -c "import json,sys; [print(e['id']) for e in json.load(sys.stdin)]" 2>/dev/null)

    echo "Expired: $rejected drafts older than ${days} days → rejected"
}

case "${1:-}" in
    --list)
        list_drafts
        ;;
    --expire)
        expire_old_drafts "${2:-30}"
        ;;
    --approve)
        [[ -z "${2:-}" ]] && echo "Usage: knowledge-review.sh --approve <id>" && exit 1
        approve_draft "$2"
        ;;
    --reject)
        [[ -z "${2:-}" ]] && echo "Usage: knowledge-review.sh --reject <id>" && exit 1
        reject_draft "$2"
        ;;
    --auto)
        auto_review
        ;;
    *)
        auto_review
        ;;
esac
