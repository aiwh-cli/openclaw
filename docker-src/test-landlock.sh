#!/bin/bash
# test-landlock.sh — Phase 70.8 end-to-end security test suite
# Run inside Docker: docker exec aiwh-openclaw /opt/AIWH/core/docker/test-landlock.sh
# Run on host: Landlock tests skipped, safe-bash + override tests work.
set -euo pipefail

PASS=0; FAIL=0; SKIP=0
A="/opt/AIWH"; SB="$A/core/scripts/safe-bash.sh"
OV="$A/client/config/security-overrides.json"; OV_BAK=""
TR="$A/client/trash"; TODAY=$(date +%Y-%m-%d)
GREEN='\033[0;32m'; RED='\033[0;31m'; YEL='\033[0;33m'; NC='\033[0m'

ok()   { ((PASS++)); echo -e "  ${GREEN}PASS${NC}  $1"; }
fail() { ((FAIL++)); echo -e "  ${RED}FAIL${NC}  $1"; }
skip() { ((SKIP++)); echo -e "  ${YEL}SKIP${NC}  $1"; }

cleanup() {
    [ -n "$OV_BAK" ] && [ -f "$OV_BAK" ] && cp "$OV_BAK" "$OV" && rm "$OV_BAK"
    rm -f "$A/client/data/test-ll.tmp" "$A/client/content/test-ll.tmp" 2>/dev/null
    rm -f "$A/core/modules/frontend/copywriter/test-ll.tmp" 2>/dev/null
    rm -f "$A/core/outputs/test-ll.tmp" "$A/client/logs/test-ll.log" 2>/dev/null
    rm -rf "$A/client/content/test-override" 2>/dev/null
}
trap cleanup EXIT

HAS_LL=false
[ -f "$A/bin/landlock-guard" ] && uname -s 2>/dev/null | grep -q Linux && HAS_LL=true

echo "=== Phase 70.8 Security Test Suite ==="
echo "Landlock: $($HAS_LL && echo active || echo 'n/a (host or no binary)')"
echo ""

# ── Kernel Layer (Landlock) ──
echo "── Kernel Layer ──"
echo "test" > "$A/client/data/test-ll.tmp" 2>/dev/null && ok "T01: Write client/data" || fail "T01: Write client/data"

if $HAS_LL; then
    rm "$A/client/data/test-ll.tmp" 2>/dev/null && fail "T02: Delete client/data (should block)" || ok "T02: Delete client/data blocked"
    echo "x" > "$A/core/dashboard/test-ll.tmp" 2>/dev/null && { rm -f "$A/core/dashboard/test-ll.tmp"; fail "T03: Dashboard writable"; } || ok "T03: Dashboard read-only"
else
    skip "T02: Delete client/data (no Landlock)"; skip "T03: Dashboard read-only (no Landlock)"
fi

if $HAS_LL; then
    echo "tamper" >> "$A/core/config/license.json" 2>/dev/null && fail "T04: license.json writable" || ok "T04: license.json locked"
    echo "tamper" >> "$A/core/modules/frontend/copywriter/CORE.md" 2>/dev/null && fail "T06: CORE.md writable" || ok "T06: CORE.md locked"
else
    skip "T04: license.json lock (root:444 only in Docker)"; skip "T06: CORE.md lock (root:444 only in Docker)"
fi
cat "$A/core/config/license.json" >/dev/null 2>&1 && ok "T05: Read license.json" || fail "T05: Read license.json"
echo ""

# ── Application Layer (safe-bash) ──
echo "── Application Layer ──"
echo "vid" > "$A/client/content/test-ll.tmp"
bash "$SB" -c "rm $A/client/content/test-ll.tmp" 2>/dev/null
[ -f "$TR/$TODAY/test-ll.tmp" ] && { ok "T07: rm content → trashed"; rm -f "$TR/$TODAY/test-ll.tmp" "$TR/$TODAY/test-ll.tmp.origin" 2>/dev/null; } || fail "T07: rm content → trashed"

echo "old" > "$A/client/trash/test-ll-tr.tmp"
bash "$SB" -c "rm $A/client/trash/test-ll-tr.tmp" 2>/dev/null
[ ! -f "$A/client/trash/test-ll-tr.tmp" ] && ok "T08: rm inside trash → deleted" || fail "T08: rm inside trash → deleted"

echo "old" > "$A/client/logs/test-ll.log"
rm "$A/client/logs/test-ll.log" 2>/dev/null && ok "T09: Delete client/logs (rotation)" || fail "T09: Delete client/logs"

echo "n" > "$A/core/modules/frontend/copywriter/test-ll.tmp" 2>/dev/null && ok "T10: Write agent workspace" || fail "T10: Write agent workspace"
rm -f "$A/core/modules/frontend/copywriter/test-ll.tmp" 2>/dev/null
echo ""

# ── New Landlock Rules ──
echo "── New Rules ──"
echo "out" > "$A/core/outputs/test-ll.tmp" 2>/dev/null && ok "T11: Write core/outputs" || fail "T11: Write core/outputs"
rm -f "$A/core/outputs/test-ll.tmp" 2>/dev/null
ls "$A/core/data/" >/dev/null 2>&1 && ok "T12: Read core/data" || fail "T12: Read core/data"
echo ""

# ── Override Tests ──
echo "── Overrides ──"
OV_BAK=$(mktemp); cp "$OV" "$OV_BAK" 2>/dev/null || echo '{"custom_rules":[]}' > "$OV_BAK"

# T13: Override allows remove_file → rm passes through (not trashed)
echo '{"custom_rules":[{"path":"/opt/AIWH/client/content/test-override","allow":["read","write","create","remove_file"],"deny":[]}]}' > "$OV"
mkdir -p "$A/client/content/test-override" 2>/dev/null
echo "del" > "$A/client/content/test-override/f.tmp"
bash "$SB" -c "rm $A/client/content/test-override/f.tmp" 2>/dev/null
if [ ! -f "$A/client/content/test-override/f.tmp" ] && [ ! -f "$TR/$TODAY/f.tmp" ]; then
    ok "T13: Override allows rm → not trashed"
else
    fail "T13: Override allows rm → not trashed"
    rm -f "$TR/$TODAY/f.tmp" "$TR/$TODAY/f.tmp.origin" 2>/dev/null
fi

# T14: No override → rm trashes again
echo '{"custom_rules":[]}' > "$OV"
echo "prot" > "$A/client/content/test-ll.tmp"
bash "$SB" -c "rm $A/client/content/test-ll.tmp" 2>/dev/null
[ -f "$TR/$TODAY/test-ll.tmp" ] && { ok "T14: No override → trashed"; rm -f "$TR/$TODAY/test-ll.tmp" "$TR/$TODAY/test-ll.tmp.origin" 2>/dev/null; } || fail "T14: No override → trashed"
echo ""

# ── Cron Access Patterns ──
echo "── Cron Patterns ──"
ls "$A/.openclaw/agents/" >/dev/null 2>&1 && ok "T15: Read .openclaw/agents" || fail "T15: Read .openclaw/agents"
echo "c" >> "$A/client/logs/test-ll.log" 2>/dev/null && ok "T16: Write client/logs" || fail "T16: Write client/logs"
rm -f "$A/client/logs/test-ll.log" 2>/dev/null
ls "$A/core/memory/" >/dev/null 2>&1 && ok "T17: Read core/memory" || fail "T17: Read core/memory"
echo "old" > "$A/client/logs/test-ll.log"; rm "$A/client/logs/test-ll.log" 2>/dev/null && ok "T18: Delete logs (rotation)" || fail "T18: Delete logs"
echo ""

# ── Theme AB.2: New Protected Paths ──
echo "── AB.2 Protection ──"
if $HAS_LL; then
    echo "tamper" >> "$A/core/modules/frontend/copywriter/BOOTSTRAP.md" 2>/dev/null && fail "T19: BOOTSTRAP.md writable" || ok "T19: BOOTSTRAP.md locked"
    echo "tamper" > "$A/core/config/agent-templates/test-ll.tmp" 2>/dev/null && { rm -f "$A/core/config/agent-templates/test-ll.tmp"; fail "T20: agent-templates writable"; } || ok "T20: agent-templates locked"
    echo "tamper" > "$A/core/docs/test-ll.tmp" 2>/dev/null && { rm -f "$A/core/docs/test-ll.tmp"; fail "T21: core/docs writable"; } || ok "T21: core/docs read-only"
else
    skip "T19: BOOTSTRAP.md lock (no Landlock)"; skip "T20: agent-templates lock (no Landlock)"; skip "T21: core/docs lock (no Landlock)"
fi

# Client extension + agent dirs should be writable
mkdir -p "$A/client/dashboard/extensions" "$A/client/agents" 2>/dev/null
echo "ext" > "$A/client/dashboard/extensions/test-ll.tmp" 2>/dev/null && { ok "T22: client/dashboard/extensions writable"; rm -f "$A/client/dashboard/extensions/test-ll.tmp"; } || fail "T22: client/dashboard/extensions writable"
echo "agt" > "$A/client/agents/test-ll.tmp" 2>/dev/null && { ok "T23: client/agents writable"; rm -f "$A/client/agents/test-ll.tmp"; } || fail "T23: client/agents writable"
echo ""

echo "════════════════════════════════════════"
echo -e "  ${GREEN}PASS: $PASS${NC}  ${RED}FAIL: $FAIL${NC}  ${YEL}SKIP: $SKIP${NC}"
echo "════════════════════════════════════════"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
