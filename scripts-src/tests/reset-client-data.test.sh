#!/usr/bin/env bash
##############################################################################
# reset-client-data.test.sh — Isolated test harness for reset-client-data.sh
#
# Why this exists: on 2026-04-12 a test of reset-client-data.sh hit the real
# filesystem and wiped client/ + .openclaw/. This harness is the ONLY sanctioned
# way to run the reset script in anger — it seeds fixtures under /tmp, runs
# the real script against them, verifies wipes happened ONLY in /tmp, and
# diffs /opt/AIWH before+after to catch any regression.
#
# Dev-only. Lives under openclaw/scripts-src/tests/ which is excluded from
# sparse-checkout on client Mac Minis — never ships to clients.
#
# Usage:
#   bash openclaw/scripts-src/tests/reset-client-data.test.sh
#
# Exits 0 on success, non-zero on any failed assertion. No external services.
##############################################################################
set -euo pipefail

SCRIPT="/opt/AIWH/core/scripts/reset-client-data.sh"
TEST_ID="$$-$(date +%s)"

# All isolation dirs live under /tmp — the reset script's guard will allow
# these without --i-mean-it because they do NOT resolve under /opt/AIWH.
export CLIENT_ROOT="/tmp/rcd-test-client-$TEST_ID"
export OPENCLAW_STATE_DIR="/tmp/rcd-test-openclaw-$TEST_ID"
export DASHBOARD_DIR="/tmp/rcd-test-dashboard-$TEST_ID"
export CORE="/tmp/rcd-test-core-$TEST_ID"

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'
pass() { echo -e "  ${GREEN}PASS${NC} $1"; }
fail() { echo -e "  ${RED}FAIL${NC} $1" >&2; exit 1; }
info() { echo -e "  ${YELLOW}··${NC}   $1"; }

cleanup() {
    rm -rf "/tmp/rcd-test-client-$TEST_ID" \
           "/tmp/rcd-test-openclaw-$TEST_ID" \
           "/tmp/rcd-test-dashboard-$TEST_ID" \
           "/tmp/rcd-test-core-$TEST_ID" \
           "$REAL_SNAPSHOT" "$AFTER_SNAPSHOT" 2>/dev/null || true
}
trap cleanup EXIT

# ── Snapshot the real filesystem BEFORE anything ──────────────────
# If any test mutation leaks into /opt/AIWH, the diff at the end will catch it.
REAL_SNAPSHOT=$(mktemp -t rcd-real-before.XXXXXX)
AFTER_SNAPSHOT=$(mktemp -t rcd-real-after.XXXXXX)
( cd /opt/AIWH && find client .openclaw core/dashboard -type f 2>/dev/null | sort ) > "$REAL_SNAPSHOT"

# ── Seed fixture data under /tmp ──────────────────────────────────
echo "Seeding fixture data under /tmp/rcd-test-*-$TEST_ID"
mkdir -p "$CLIENT_ROOT"/{config,data,content,knowledge,logs,memory,skills,uploads,dashboard}
mkdir -p "$OPENCLAW_STATE_DIR"/{agents/branson/sessions,agents/branson/memory,credentials,media,memory,delivery-queue,logs,browser,canvas,completions,cron/runs}
mkdir -p "$DASHBOARD_DIR"
mkdir -p "$CORE/config"

# Secrets vault — the incident deleted this. Must land in trash after.
printf 'FAKE-ENCRYPTED-SECRETS\n' > "$CLIENT_ROOT/config/secrets.enc"

# Pre-existing config files — will be overwritten with templates
printf '{"setupComplete": true, "owner": "test"}' > "$CLIENT_ROOT/config/auth.json"
printf '{"pillars":[{"id":1}]}' > "$CLIENT_ROOT/config/content-pillars.json"

# jsonl session transcripts — the irreplaceable class the incident destroyed
printf '{"type":"message","body":"alpha"}\n' > "$OPENCLAW_STATE_DIR/agents/branson/sessions/session-alpha.jsonl"
printf '{"type":"message","body":"beta"}\n'  > "$OPENCLAW_STATE_DIR/agents/branson/sessions/session-beta.jsonl"
printf '{"sessions":[{"id":"alpha"},{"id":"beta"}]}' > "$OPENCLAW_STATE_DIR/agents/branson/sessions/sessions.json"

# Credentials blob
printf '{"profiles":[{"name":"test"}]}\n' > "$OPENCLAW_STATE_DIR/credentials/profiles.json"

# Fake .env
printf 'FAKE_KEY=xyz\n' > "$OPENCLAW_STATE_DIR/.env"

# SQLite DBs with known row counts
sqlite3 "$CLIENT_ROOT/data/client_knowledge.db" \
  "CREATE TABLE knowledge (id INTEGER PRIMARY KEY, body TEXT); \
   INSERT INTO knowledge (body) VALUES ('a'),('b'),('c');"
sqlite3 "$DASHBOARD_DIR/mission-control.db" \
  "CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT); \
   INSERT INTO tasks (title) VALUES ('t1'),('t2');"

# exec-approvals defaults (reset script reads this)
echo '{"factory":"defaults"}' > "$CORE/config/exec-approvals-defaults.json"

# ── Test 1: --dry-run preserves fixtures ──────────────────────────
echo ""
info "Test 1: --dry-run should not mutate fixtures"
bash "$SCRIPT" --dry-run > /dev/null
test -f "$CLIENT_ROOT/config/secrets.enc" || fail "dry-run deleted secrets.enc"
test "$(sqlite3 "$CLIENT_ROOT/data/client_knowledge.db" 'SELECT COUNT(*) FROM knowledge')" = "3" \
  || fail "dry-run emptied the DB"
test -f "$OPENCLAW_STATE_DIR/agents/branson/sessions/session-alpha.jsonl" \
  || fail "dry-run deleted a jsonl session"
test ! -d "$OPENCLAW_STATE_DIR/trash" \
  || fail "dry-run created trash dir (should be no-op)"
pass "dry-run preserved all fixtures"

# ── Test 2: --confirm gate rejects wrong phrase ───────────────────
echo ""
info "Test 2: wrong confirmation phrase must refuse"
set +e
printf 'I AM SURE\n' | bash "$SCRIPT" --confirm --force-tty > /dev/null 2>&1
rc=$?
set -e
test "$rc" -ne 0 || fail "wrong phrase was accepted (rc=$rc)"
# Still intact after rejected run
test -f "$CLIENT_ROOT/config/secrets.enc" || fail "rejected run still mutated state"
pass "wrong phrase rejected, fixtures intact"

# ── Test 3: real run wipes fixtures and stashes to trash ──────────
echo ""
info "Test 3: real run wipes and stashes to trash"
printf 'RESET CLIENT DATA\n' | bash "$SCRIPT" --confirm --force-tty > /dev/null

# Wipes happened
test ! -f "$CLIENT_ROOT/config/secrets.enc" \
  || fail "secrets.enc not removed"
test "$(sqlite3 "$CLIENT_ROOT/data/client_knowledge.db" 'SELECT COUNT(*) FROM knowledge')" = "0" \
  || fail "knowledge table not empty"
test "$(sqlite3 "$DASHBOARD_DIR/mission-control.db" 'SELECT COUNT(*) FROM tasks')" = "0" \
  || fail "mission-control.db tasks table not empty"
# Schema preserved
test "$(sqlite3 "$CLIENT_ROOT/data/client_knowledge.db" "SELECT name FROM sqlite_master WHERE type='table' AND name='knowledge'")" = "knowledge" \
  || fail "knowledge schema lost"
# jsonl sessions wiped
jsonl_count=$(find "$OPENCLAW_STATE_DIR/agents" -name "*.jsonl" -type f 2>/dev/null | wc -l | tr -d ' ')
test "$jsonl_count" = "0" || fail "jsonl sessions remain ($jsonl_count)"
# auth.json reset
grep -q '"setupComplete": false' "$CLIENT_ROOT/config/auth.json" \
  || fail "auth.json not reset to setupComplete:false"
pass "wipes verified, schemas preserved"

# ── Test 4: trash dir contains the stashed artifacts ──────────────
echo ""
info "Test 4: trash dir contains recoverable copies"
TRASH=$(ls -1d "$OPENCLAW_STATE_DIR"/trash/reset-backup-*/ 2>/dev/null | head -1)
test -n "$TRASH" || fail "trash dir not created"
test -n "$(find "$TRASH" -name 'secrets.enc*' 2>/dev/null)" || fail "secrets.enc missing from trash"
test -n "$(find "$TRASH" -name 'session-alpha.jsonl*' 2>/dev/null)" || fail "session-alpha missing from trash"
test -n "$(find "$TRASH" -name 'session-beta.jsonl*' 2>/dev/null)" || fail "session-beta missing from trash"
test -n "$(find "$TRASH" -name 'client_knowledge.db*' 2>/dev/null)" || fail "DB copy missing from trash"
test -n "$(find "$TRASH" -name 'mission-control.db*' 2>/dev/null)" || fail "mission-control.db copy missing from trash"
# Verify the stashed DB still has the original rows (not the emptied version)
stashed_db=$(find "$TRASH" -name 'client_knowledge.db*' | head -1)
test "$(sqlite3 "$stashed_db" 'SELECT COUNT(*) FROM knowledge' 2>/dev/null)" = "3" \
  || fail "stashed DB does not contain original 3 rows"
pass "trash contains recoverable copies with original content"

# ── Test 5: real /opt/AIWH paths refused without --i-mean-it ──────
echo ""
info "Test 5: real /opt/AIWH paths must be refused without --i-mean-it"
set +e
CLIENT_ROOT=/opt/AIWH/client \
OPENCLAW_STATE_DIR=/opt/AIWH/.openclaw \
DASHBOARD_DIR=/opt/AIWH/core/dashboard \
CORE=/opt/AIWH/core \
  bash "$SCRIPT" --dry-run 2>&1 | grep -q "REFUSING"
rc=${PIPESTATUS[0]}
refused=$?
set -e
test "$refused" = "0" || fail "real paths did not emit REFUSING"
test "$rc" -ne 0      || fail "real paths did not exit non-zero"
pass "real /opt/AIWH paths refused"

# ── Test 6: /opt/AIWH filesystem unchanged ────────────────────────
echo ""
info "Test 6: /opt/AIWH filesystem must be unchanged"
( cd /opt/AIWH && find client .openclaw core/dashboard -type f 2>/dev/null | sort ) > "$AFTER_SNAPSHOT"
if ! diff -q "$REAL_SNAPSHOT" "$AFTER_SNAPSHOT" > /dev/null; then
    echo "FILESYSTEM DIFF DETECTED:" >&2
    diff "$REAL_SNAPSHOT" "$AFTER_SNAPSHOT" >&2 || true
    fail "real /opt/AIWH filesystem changed during test"
fi
pass "real /opt/AIWH filesystem untouched"

echo ""
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo -e "${GREEN}  reset-client-data.sh test harness: PASS${NC}"
echo -e "${GREEN}════════════════════════════════════════${NC}"
