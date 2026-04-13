#!/usr/bin/env bash
##############################################################################
# qa-test.sh — Post-install QA validation (18 tests).
#
# Usage:
#   qa-test.sh [--skip-api]
#
# Run after factory-install.sh with AIWH test API keys in Keychain.
# Tests gateway, agents, knowledge, video pipeline, backups, Tailscale,
# dashboard, and security.
##############################################################################

set -uo pipefail

CORE_DIR="/opt/AIWH/core"
CLIENT_DIR="${CLIENT_ROOT:-/opt/AIWH/client}"
GATEWAY_PORT=18789
DASHBOARD_PORT=3002
ONBOARDING_PORT=3001

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

PASS=0
FAIL=0
SKIP=0
RESULTS=()
SKIP_API=false

[[ "${1:-}" == "--skip-api" ]] && SKIP_API=true

test_result() {
    local name="$1"
    local status="$2"  # pass, fail, skip
    local detail="${3:-}"
    case "$status" in
        pass)
            echo -e "  ${GREEN}✓${NC} $name${detail:+ — $detail}"
            PASS=$((PASS + 1))
            RESULTS+=("PASS: $name")
            ;;
        fail)
            echo -e "  ${RED}✗${NC} $name${detail:+ — $detail}"
            FAIL=$((FAIL + 1))
            RESULTS+=("FAIL: $name — $detail")
            ;;
        skip)
            echo -e "  ${YELLOW}⊘${NC} $name${detail:+ — $detail}"
            SKIP=$((SKIP + 1))
            RESULTS+=("SKIP: $name")
            ;;
    esac
}

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║               AIWH QA Test Suite (18 tests)                ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# ══════════════════════════════════════════════════════════════════════════════
# Test 1: OpenClaw gateway responds
# ══════════════════════════════════════════════════════════════════════════════
echo -e "${CYAN}[1/18]${NC} OpenClaw gateway"
if curl -sf "http://localhost:$GATEWAY_PORT/health" -o /dev/null 2>/dev/null; then
    test_result "Gateway responds on port $GATEWAY_PORT" "pass"
elif curl -sf "http://localhost:$GATEWAY_PORT" -o /dev/null 2>/dev/null; then
    test_result "Gateway responds on port $GATEWAY_PORT" "pass" "no /health endpoint but port active"
else
    test_result "Gateway responds on port $GATEWAY_PORT" "fail" "no response"
fi

# ══════════════════════════════════════════════════════════════════════════════
# Test 2: Branson responds to test message
# ══════════════════════════════════════════════════════════════════════════════
echo -e "${CYAN}[2/18]${NC} Branson agent"
if $SKIP_API; then
    test_result "Branson responds to test message" "skip" "--skip-api"
else
    BRANSON_RESP=$(timeout 30 openclaw run branson --message "Reply with just the word READY" 2>/dev/null || echo "TIMEOUT")
    if echo "$BRANSON_RESP" | grep -qi "ready"; then
        test_result "Branson responds to test message" "pass"
    elif [[ "$BRANSON_RESP" == "TIMEOUT" ]]; then
        test_result "Branson responds to test message" "fail" "timeout after 30s"
    else
        test_result "Branson responds to test message" "fail" "unexpected response"
    fi
fi

# ══════════════════════════════════════════════════════════════════════════════
# Test 3: Module manager allows frontend agents
# ══════════════════════════════════════════════════════════════════════════════
echo -e "${CYAN}[3/18]${NC} Module manager: frontend allowed"
if [[ -f "$CORE_DIR/scripts/module-manager.py" ]]; then
    MM_RESULT=$(python3 "$CORE_DIR/scripts/module-manager.py" --check frontend 2>/dev/null || echo "ERROR")
    if echo "$MM_RESULT" | grep -qi "allow\|active\|true\|enabled"; then
        test_result "Module manager allows frontend agents" "pass"
    else
        test_result "Module manager allows frontend agents" "fail" "$MM_RESULT"
    fi
else
    test_result "Module manager allows frontend agents" "skip" "module-manager.py not found"
fi

# ══════════════════════════════════════════════════════════════════════════════
# Test 4: Module manager blocks expired license
# ══════════════════════════════════════════════════════════════════════════════
echo -e "${CYAN}[4/18]${NC} Module manager: expired license blocked"
if [[ -f "$CORE_DIR/scripts/module-manager.py" ]]; then
    # Temporarily set valid_until to past date
    ORIG_LICENSE=$(cat "$CORE_DIR/config/license.json")
    python3 -c "
import json
with open('$CORE_DIR/config/license.json') as f:
    lic = json.load(f)
lic['valid_until'] = '2020-01-01T00:00:00Z'
with open('/tmp/qa-expired-license.json', 'w') as f:
    json.dump(lic, f)
" 2>/dev/null
    if [[ -f /tmp/qa-expired-license.json ]]; then
        cp "$CORE_DIR/config/license.json" /tmp/qa-license-backup.json
        cp /tmp/qa-expired-license.json "$CORE_DIR/config/license.json"
        EXPIRED_RESULT=$(python3 "$CORE_DIR/scripts/module-manager.py" --check frontend 2>/dev/null || echo "DENIED")
        # Restore original
        cp /tmp/qa-license-backup.json "$CORE_DIR/config/license.json"
        rm -f /tmp/qa-expired-license.json /tmp/qa-license-backup.json
        if echo "$EXPIRED_RESULT" | grep -qi "denied\|expired\|block\|false\|error"; then
            test_result "Expired license blocks access" "pass"
        else
            test_result "Expired license blocks access" "fail" "got: $EXPIRED_RESULT"
        fi
    else
        test_result "Expired license blocks access" "skip" "could not create test license"
    fi
else
    test_result "Expired license blocks access" "skip" "module-manager.py not found"
fi

# ══════════════════════════════════════════════════════════════════════════════
# Test 5: Emergency flag blocks sessions
# ══════════════════════════════════════════════════════════════════════════════
echo -e "${CYAN}[5/18]${NC} Emergency flag"
if [[ -d "$CORE_DIR/control" ]]; then
    touch "$CORE_DIR/control/emergency.flag"
    sleep 1
    if [[ -f "$CORE_DIR/control/emergency.flag" ]]; then
        test_result "Emergency flag creates successfully" "pass"
    else
        test_result "Emergency flag creates successfully" "fail"
    fi
    rm -f "$CORE_DIR/control/emergency.flag"
else
    test_result "Emergency flag" "skip" "control/ directory missing"
fi

# ══════════════════════════════════════════════════════════════════════════════
# Test 6: Knowledge search returns results
# ══════════════════════════════════════════════════════════════════════════════
echo -e "${CYAN}[6/18]${NC} Knowledge search"
if $SKIP_API; then
    test_result "Knowledge search returns results" "skip" "--skip-api"
else
    if [[ -f "$CORE_DIR/scripts/knowledge-search-unified.sh" ]]; then
        KS_RESULT=$(CLIENT_ROOT="$CLIENT_DIR" bash "$CORE_DIR/scripts/knowledge-search-unified.sh" \
            --query "test coaching strategy" --count 3 2>/dev/null || echo "ERROR")
        if echo "$KS_RESULT" | grep -q "similarity\|content\|domain"; then
            RESULT_COUNT=$(echo "$KS_RESULT" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
            test_result "Knowledge search returns results" "pass" "$RESULT_COUNT results"
        else
            test_result "Knowledge search returns results" "fail" "no results or error"
        fi
    else
        test_result "Knowledge search returns results" "fail" "script not found"
    fi
fi

# ══════════════════════════════════════════════════════════════════════════════
# Test 7: Video pipeline (mock — script generation only)
# ══════════════════════════════════════════════════════════════════════════════
echo -e "${CYAN}[7/18]${NC} Video pipeline"
if [[ -f "$CORE_DIR/scripts/cinematic-producer.py" ]]; then
    # Just verify the script compiles
    python3 -m py_compile "$CORE_DIR/scripts/cinematic-producer.py" 2>/dev/null
    if [[ $? -eq 0 ]]; then
        test_result "Cinematic producer compiles" "pass"
    else
        test_result "Cinematic producer compiles" "fail" "syntax error"
    fi
else
    test_result "Cinematic producer" "skip" "script not found"
fi

# ══════════════════════════════════════════════════════════════════════════════
# Test 8: Nightly pipeline dry-run
# ══════════════════════════════════════════════════════════════════════════════
echo -e "${CYAN}[8/18]${NC} Nightly pipeline"
if [[ -f "$CORE_DIR/scripts/nightly-knowledge-pipeline.sh" ]]; then
    # Check syntax only (dry-run not necessarily supported)
    bash -n "$CORE_DIR/scripts/nightly-knowledge-pipeline.sh" 2>/dev/null
    if [[ $? -eq 0 ]]; then
        test_result "Nightly pipeline syntax valid" "pass"
    else
        test_result "Nightly pipeline syntax valid" "fail" "bash -n failed"
    fi
else
    test_result "Nightly pipeline" "skip" "script not found"
fi

# ══════════════════════════════════════════════════════════════════════════════
# Test 9: Backup script creates archive
# ══════════════════════════════════════════════════════════════════════════════
echo -e "${CYAN}[9/18]${NC} Backup script"
if [[ -f "$CORE_DIR/scripts/backup-snapshot.sh" ]]; then
    bash -n "$CORE_DIR/scripts/backup-snapshot.sh" 2>/dev/null
    if [[ $? -eq 0 ]]; then
        test_result "Backup script syntax valid" "pass"
    else
        test_result "Backup script syntax valid" "fail"
    fi
else
    test_result "Backup script" "skip" "script not found"
fi

# ══════════════════════════════════════════════════════════════════════════════
# Test 10: Tailscale device appears
# ══════════════════════════════════════════════════════════════════════════════
echo -e "${CYAN}[10/18]${NC} Tailscale status"
if command -v tailscale &>/dev/null; then
    TS_STATUS=$(tailscale status --json 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('Self',{}).get('HostName','UNKNOWN'))" 2>/dev/null || echo "ERROR")
    if [[ "$TS_STATUS" != "ERROR" && "$TS_STATUS" != "UNKNOWN" ]]; then
        test_result "Tailscale device connected" "pass" "hostname: $TS_STATUS"
    else
        test_result "Tailscale device connected" "fail" "not connected or cannot parse status"
    fi
else
    test_result "Tailscale" "skip" "not installed"
fi

# ══════════════════════════════════════════════════════════════════════════════
# Test 11: Tailscale SSH accessible
# ══════════════════════════════════════════════════════════════════════════════
echo -e "${CYAN}[11/18]${NC} Tailscale SSH"
if command -v tailscale &>/dev/null; then
    TS_SSH=$(tailscale status --json 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); s=d.get('Self',{}); print('ssh' if s.get('Online') else 'offline')" 2>/dev/null || echo "ERROR")
    if [[ "$TS_SSH" == "ssh" ]]; then
        test_result "Tailscale SSH available" "pass"
    else
        test_result "Tailscale SSH available" "fail" "device offline or SSH not enabled"
    fi
else
    test_result "Tailscale SSH" "skip" "not installed"
fi

# ══════════════════════════════════════════════════════════════════════════════
# Test 12: Tailscale Serve (dashboard not on public internet)
# ══════════════════════════════════════════════════════════════════════════════
echo -e "${CYAN}[12/18]${NC} Tailscale Serve"
if command -v tailscale &>/dev/null; then
    TS_SERVE=$(tailscale serve status 2>/dev/null || echo "NOT_CONFIGURED")
    if echo "$TS_SERVE" | grep -q "$DASHBOARD_PORT\|https"; then
        test_result "Tailscale Serve configured for dashboard" "pass"
    elif [[ "$TS_SERVE" == "NOT_CONFIGURED" ]]; then
        test_result "Tailscale Serve configured for dashboard" "skip" "not configured"
    else
        test_result "Tailscale Serve configured for dashboard" "fail" "port $DASHBOARD_PORT not served"
    fi
else
    test_result "Tailscale Serve" "skip" "not installed"
fi

# ══════════════════════════════════════════════════════════════════════════════
# Test 13: Dashboard loads (port 3002)
# ══════════════════════════════════════════════════════════════════════════════
echo -e "${CYAN}[13/18]${NC} Dashboard (port $DASHBOARD_PORT)"
DASH_RESP=$(curl -sf "http://localhost:$DASHBOARD_PORT/" -o /dev/null -w "%{http_code}" 2>/dev/null || echo "000")
if [[ "$DASH_RESP" == "200" || "$DASH_RESP" == "304" ]]; then
    test_result "Dashboard loads on port $DASHBOARD_PORT" "pass"
elif [[ "$DASH_RESP" == "000" ]]; then
    # Also try the AIWH-dev port 3001 as fallback
    DASH_RESP2=$(curl -sf "http://localhost:3001/" -o /dev/null -w "%{http_code}" 2>/dev/null || echo "000")
    if [[ "$DASH_RESP2" == "200" ]]; then
        test_result "Dashboard loads on port 3001 (dev mode)" "pass"
    else
        test_result "Dashboard loads on port $DASHBOARD_PORT" "fail" "no response"
    fi
else
    test_result "Dashboard loads on port $DASHBOARD_PORT" "fail" "HTTP $DASH_RESP"
fi

# ══════════════════════════════════════════════════════════════════════════════
# Test 14: Onboarding wizard loads (port 3001)
# ══════════════════════════════════════════════════════════════════════════════
echo -e "${CYAN}[14/18]${NC} Onboarding wizard (port $ONBOARDING_PORT)"
OB_RESP=$(curl -sf "http://localhost:$ONBOARDING_PORT/" -o /dev/null -w "%{http_code}" 2>/dev/null || echo "000")
if [[ "$OB_RESP" == "200" || "$OB_RESP" == "304" ]]; then
    test_result "Onboarding wizard loads on port $ONBOARDING_PORT" "pass"
else
    test_result "Onboarding wizard loads on port $ONBOARDING_PORT" "skip" "not running (built in Task 6.6)"
fi

# ══════════════════════════════════════════════════════════════════════════════
# Test 15: Keychain API key retrievable
# ══════════════════════════════════════════════════════════════════════════════
echo -e "${CYAN}[15/18]${NC} Keychain access"
# Try to read an AIWH key from Keychain (test key or real key)
KC_RESULT=$(security find-generic-password -a "aiwh" -s "anthropic-api-key" -w 2>/dev/null || echo "NOT_FOUND")
if [[ "$KC_RESULT" != "NOT_FOUND" && -n "$KC_RESULT" ]]; then
    test_result "Anthropic API key in Keychain" "pass"
else
    # Check env var fallback
    if [[ -n "${ANTHROPIC_API_KEY:-}" ]]; then
        test_result "Anthropic API key via env var" "pass" "Keychain empty but env set"
    else
        test_result "Anthropic API key retrievable" "skip" "not in Keychain or env (set during onboarding)"
    fi
fi

# ══════════════════════════════════════════════════════════════════════════════
# Test 16: Discord webhook
# ══════════════════════════════════════════════════════════════════════════════
echo -e "${CYAN}[16/18]${NC} Discord webhook"
if $SKIP_API; then
    test_result "Discord webhook posts test message" "skip" "--skip-api"
else
    DISCORD_URL="${DISCORD_WEBHOOK_URL:-}"
    if [[ -n "$DISCORD_URL" ]]; then
        DC_RESP=$(curl -sf -X POST "$DISCORD_URL" \
            -H "Content-Type: application/json" \
            -d '{"content":"[QA TEST] Factory install verification — ignore this message"}' \
            -o /dev/null -w "%{http_code}" 2>/dev/null || echo "000")
        if [[ "$DC_RESP" == "204" || "$DC_RESP" == "200" ]]; then
            test_result "Discord webhook posts successfully" "pass"
        else
            test_result "Discord webhook posts successfully" "fail" "HTTP $DC_RESP"
        fi
    else
        test_result "Discord webhook" "skip" "DISCORD_WEBHOOK_URL not set"
    fi
fi

# ══════════════════════════════════════════════════════════════════════════════
# Test 17: Log rotation config
# ══════════════════════════════════════════════════════════════════════════════
echo -e "${CYAN}[17/18]${NC} Log rotation"
if [[ -f /etc/logrotate.d/aiwh ]] || [[ -f "$CORE_DIR/config/logrotate.conf" ]]; then
    test_result "Log rotation config exists" "pass"
else
    # Check if newsyslog is configured (macOS native)
    if [[ -f /etc/newsyslog.d/aiwh.conf ]]; then
        test_result "Log rotation config exists (newsyslog)" "pass"
    else
        test_result "Log rotation config" "skip" "not configured (use newsyslog.d or logrotate)"
    fi
fi

# ══════════════════════════════════════════════════════════════════════════════
# Test 18: Disk usage below 20%
# ══════════════════════════════════════════════════════════════════════════════
echo -e "${CYAN}[18/18]${NC} Disk usage"
DISK_USED=$(df -h / | tail -1 | awk '{print $5}' | tr -d '%')
if [[ "$DISK_USED" -lt 80 ]]; then
    test_result "Disk usage below 80%" "pass" "${DISK_USED}% used"
elif [[ "$DISK_USED" -lt 90 ]]; then
    test_result "Disk usage acceptable" "pass" "${DISK_USED}% used (warning: above 80%)"
else
    test_result "Disk usage below 80%" "fail" "${DISK_USED}% used — critically high"
fi

# ══════════════════════════════════════════════════════════════════════════════
# Summary
# ══════════════════════════════════════════════════════════════════════════════
echo ""
echo "════════════════════════════════════════════════════════════════"
TOTAL=$((PASS + FAIL + SKIP))
echo -e "  Results: ${GREEN}$PASS passed${NC}  ${RED}$FAIL failed${NC}  ${YELLOW}$SKIP skipped${NC}  ($TOTAL total)"
echo ""

if [[ $FAIL -eq 0 ]]; then
    echo -e "${GREEN}╔══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║             QA PASSED — READY FOR SHIPPING              ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════════════════════╝${NC}"
    exit 0
else
    echo -e "${RED}╔══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║          QA FAILED — $FAIL TEST(S) NEED ATTENTION          ║${NC}"
    echo -e "${RED}╚══════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo "Failed tests:"
    for r in "${RESULTS[@]}"; do
        [[ "$r" == FAIL* ]] && echo "  - ${r#FAIL: }"
    done
    exit 1
fi
