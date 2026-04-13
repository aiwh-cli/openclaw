# healthcheck.sh — Shared functions for AIWH update health checks
# Source from update-healthcheck.sh. Not standalone.

AIWH_ROOT="/opt/AIWH"
CLIENT_ROOT="${CLIENT_ROOT:-/opt/AIWH/client}"
OC_STATE="${OPENCLAW_STATE_DIR:-/opt/AIWH/.openclaw}"
DASHBOARD_URL="http://127.0.0.1:3001"
BACKUP_DIR="$AIWH_ROOT/core/.backups"
CHECKS=(); ERRORS=(); PASS_COUNT=0; FAIL_COUNT=0

add_check() {
  local name="$1" status="$2" detail="${3:-}"
  if [[ "$status" == "pass" ]]; then
    ((PASS_COUNT++)); $JSON_OUTPUT || echo "  ✓ $name"
  else
    ((FAIL_COUNT++)); ERRORS+=("$name: $detail")
    $JSON_OUTPUT || echo "  ✗ $name — $detail"
  fi
  CHECKS+=("{\"name\":\"$name\",\"status\":\"$status\",\"detail\":\"$detail\"}")
}

# ── Pre-update checks ───────────────────────────────────────────────────────
run_pre_checks() {
  $JSON_OUTPUT || echo "Pre-update checks:"

  local free_gb
  free_gb=$(df -g "$AIWH_ROOT" 2>/dev/null | awk 'NR==2{print $4}')
  [[ -z "$free_gb" ]] && free_gb=$(df -h "$AIWH_ROOT" | awk 'NR==2{print $4}' | sed 's/Gi//')
  [[ "$free_gb" -ge 2 ]] 2>/dev/null && add_check "disk_space" "pass" || add_check "disk_space" "fail" "Only ${free_gb}GB free (need >2GB)"

  local active_crons=0
  if command -v openclaw &>/dev/null; then
    active_crons=$(openclaw cron ls 2>/dev/null | grep -c "running" || true)
    active_crons="${active_crons:-0}"
  fi
  [[ "$active_crons" -eq 0 ]] && add_check "no_active_cron" "pass" || add_check "no_active_cron" "fail" "$active_crons cron(s) running"

  local gw_ok=false
  command -v openclaw &>/dev/null && openclaw health --timeout 5000 &>/dev/null && gw_ok=true
  $gw_ok && add_check "gateway_healthy" "pass" || add_check "gateway_healthy" "fail" "Gateway not responding"

  local dash_status
  dash_status=$(curl -s -o /dev/null -w "%{http_code}" "$DASHBOARD_URL/api/health" 2>/dev/null)
  [[ "$dash_status" == "200" ]] && add_check "dashboard_healthy" "pass" || add_check "dashboard_healthy" "fail" "HTTP $dash_status (expected 200)"

  local latest_backup
  latest_backup=$(ls -1t "$BACKUP_DIR"/snapshot-*.tar.gz 2>/dev/null | head -1)
  if [[ -n "$latest_backup" ]]; then
    local backup_age_min=$(( ($(date +%s) - $(stat -f%m "$latest_backup" 2>/dev/null || stat -c%Y "$latest_backup" 2>/dev/null || echo 0)) / 60 ))
    [[ "$backup_age_min" -lt 240 ]] && add_check "backup_fresh" "pass" || add_check "backup_fresh" "fail" "Backup ${backup_age_min}min old (>4hr)"
  else
    add_check "backup_fresh" "fail" "No backup snapshots found"
  fi

  local git_dirty
  git_dirty=$(cd "$AIWH_ROOT" && git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
  [[ "$git_dirty" -eq 0 ]] && add_check "git_clean" "pass" || add_check "git_clean" "fail" "$git_dirty uncommitted change(s)"
}

# ── Post-update checks ──────────────────────────────────────────────────────
run_post_checks() {
  $JSON_OUTPUT || echo "Post-update checks:"

  local dash_status
  dash_status=$(curl -s -o /dev/null -w "%{http_code}" "$DASHBOARD_URL/api/health" 2>/dev/null)
  [[ "$dash_status" == "200" ]] && add_check "dashboard_up" "pass" || add_check "dashboard_up" "fail" "HTTP $dash_status"

  local gw_ok=false
  command -v openclaw &>/dev/null && openclaw health --timeout 8000 &>/dev/null && gw_ok=true
  $gw_ok && add_check "gateway_up" "pass" || add_check "gateway_up" "fail" "Gateway not responding after update"

  local expected_agents actual_agents
  expected_agents=$(python3 -c "import json; print(len(json.load(open('$OC_STATE/openclaw.json')).get('agents',{}).get('list',[])))" 2>/dev/null || echo 0)
  actual_agents=$(openclaw health --timeout 8000 2>/dev/null | grep "^Agents:" | grep -oE "[a-z][-a-z]*" | wc -l | tr -d ' ')
  actual_agents="${actual_agents:-0}"
  [[ "$expected_agents" -gt 0 && "$actual_agents" -ge "$expected_agents" ]] && add_check "agents_loaded" "pass" || add_check "agents_loaded" "fail" "Expected $expected_agents, got $actual_agents"

  local cron_count saved_count_file="/tmp/aiwh-update-cron-count"
  cron_count=$(openclaw cron ls 2>/dev/null | grep -c "│" || true); cron_count="${cron_count:-0}"
  if [[ -f "$saved_count_file" ]]; then
    local pre_count=$(cat "$saved_count_file")
    [[ "$cron_count" -eq "$pre_count" ]] && add_check "cron_count_stable" "pass" || add_check "cron_count_stable" "fail" "Was $pre_count, now $cron_count"
    rm -f "$saved_count_file"
  else
    add_check "cron_count_stable" "pass"
  fi

  local recent_errors=0 gw_log="$OC_STATE/logs/gateway.log"
  if [[ -f "$gw_log" ]]; then recent_errors=$(tail -200 "$gw_log" | grep -c "ERROR" || true); recent_errors="${recent_errors:-0}"; fi
  [[ "$recent_errors" -lt 5 ]] && add_check "no_recent_errors" "pass" || add_check "no_recent_errors" "fail" "$recent_errors ERROR(s) in gateway logs"

  local db_ok=true
  for db in "$CLIENT_ROOT/data/client_knowledge.db" "$CLIENT_ROOT/data/video-jobs.db"; do
    [[ -f "$db" ]] && sqlite3 "$db" "SELECT 1;" &>/dev/null || { db_ok=false; break; }
  done
  $db_ok && add_check "client_dbs" "pass" || add_check "client_dbs" "fail" "Client DBs not accessible"
}

# ── Save pre-update state (for cron count comparison) ─────────────────────
save_pre_state() {
  local cron_count
  cron_count=$(openclaw cron ls 2>/dev/null | grep -c "│" || true); cron_count="${cron_count:-0}"
  echo "$cron_count" > /tmp/aiwh-update-cron-count
}

# ── Output results ──────────────────────────────────────────────────────────
output_results() {
  local overall="pass"
  [[ "$FAIL_COUNT" -gt 0 ]] && overall="fail"

  if $JSON_OUTPUT; then
    local checks_json
    checks_json=$(printf '%s\n' "${CHECKS[@]}" | paste -sd',' -)
    local errors_json="[]"
    if [[ ${#ERRORS[@]} -gt 0 ]]; then
      errors_json=$(printf '"%s",' "${ERRORS[@]}" | sed 's/,$//')
      errors_json="[$errors_json]"
    fi
    echo "{\"status\":\"$overall\",\"passed\":$PASS_COUNT,\"failed\":$FAIL_COUNT,\"checks\":[$checks_json],\"errors\":$errors_json}"
  else
    echo ""
    if [[ "$overall" == "pass" ]]; then
      echo "Result: ALL CHECKS PASSED ($PASS_COUNT/$((PASS_COUNT + FAIL_COUNT)))"
    else
      echo "Result: $FAIL_COUNT FAILED ($PASS_COUNT passed)"
      for err in "${ERRORS[@]}"; do echo "  → $err"; done
    fi
  fi

  [[ "$overall" == "pass" ]]
}
