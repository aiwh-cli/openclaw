# update-helpers.sh — Shared functions for update-aiwh.sh
# Source from update-aiwh.sh. Not standalone.

AIWH_ROOT="/opt/AIWH"
OPENCLAW_DIR="$AIWH_ROOT/openclaw"
SCRIPTS_DIR="$AIWH_ROOT/core/scripts"
CLIENT_ROOT="${CLIENT_ROOT:-/opt/AIWH/client}"
LOG_FILE="$CLIENT_ROOT/logs/update-aiwh.log"
MIGRATION_DB="$CLIENT_ROOT/data/mission-control.db"
UPDATE_RECORD="$CLIENT_ROOT/logs/update-history.json"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
log() { echo -e "$1" | tee -a "$LOG_FILE"; }

current_tag() { cd "$AIWH_ROOT" && git describe --tags --exact-match 2>/dev/null || git rev-parse --short HEAD; }

run_migrations() {
  local migrations_dir="$AIWH_ROOT/core/migrations"
  sqlite3 "$MIGRATION_DB" "CREATE TABLE IF NOT EXISTS migration_history (name TEXT PRIMARY KEY, applied_at TEXT);" 2>/dev/null || true
  if [[ -d "$migrations_dir" ]] && ls "$migrations_dir"/*.{sh,sql,py} 1>/dev/null 2>&1; then
    for migration in $(ls "$migrations_dir"/*.{sh,sql,py} 2>/dev/null | sort); do
      local mname=$(basename "$migration")
      local applied=$(sqlite3 "$MIGRATION_DB" "SELECT 1 FROM migration_history WHERE name='$mname';" 2>/dev/null)
      [[ -n "$applied" ]] && { log "  ⏭  $mname (already applied)"; continue; }
      case "$migration" in
        *.sh)  bash "$migration" 2>&1 | tee -a "$LOG_FILE" ;;
        *.sql) sqlite3 "$MIGRATION_DB" < "$migration" 2>&1 | tee -a "$LOG_FILE" ;;
        *.py)  python3 "$migration" 2>&1 | tee -a "$LOG_FILE" ;;
      esac
      sqlite3 "$MIGRATION_DB" "INSERT OR IGNORE INTO migration_history (name, applied_at) VALUES ('$mname', datetime('now'));" 2>/dev/null || true
      log "  ${GREEN}✓${NC} $mname"
    done
  else
    log "  No pending migrations"
  fi
}

restart_services() {
  launchctl kickstart -k "gui/$(id -u)/com.aiwh.dashboard" 2>/dev/null && log "  ${GREEN}✓${NC} Dashboard restarted" || {
    log "  ${YELLOW}⚠${NC} launchctl failed — manual restart"
    pkill -f "node.*server.js" 2>/dev/null || true
    sleep 2
    cd "$AIWH_ROOT/core/dashboard" && nohup node server.js >> /tmp/dashboard.log 2>&1 &
    log "  ${GREEN}✓${NC} Dashboard started manually"
  }
  openclaw gateway restart 2>/dev/null && log "  ${GREEN}✓${NC} Gateway restarted" || log "  ${YELLOW}⚠${NC} Gateway restart failed"
}

rollback_update() {
  local previous_tag="$1"
  log "${RED}Rolling back to $previous_tag...${NC}"
  cd "$AIWH_ROOT"
  git checkout "$previous_tag" 2>/dev/null || true
  git stash pop 2>/dev/null || true
  # CORE.md + BOOTSTRAP.md restored by git checkout. Client files (SOUL.md etc.) untouched.
  # Reinstall CLI from rolled-back openclaw (sparse checkout — compiled runtime)
  if [[ -d "$OPENCLAW_DIR" ]] && [[ -f "$OPENCLAW_DIR/package.json" ]]; then
    cd "$OPENCLAW_DIR" && npm install -g . 2>&1 | tail -1 || log "  ${YELLOW}⚠${NC} CLI reinstall failed"
    log "  ${GREEN}✓${NC} CLI reinstalled from $previous_tag"
  fi
  restart_services
  sleep 8
  log "Rollback complete — running post-check..."
  "$SCRIPTS_DIR/update-healthcheck.sh" post 2>&1 | tee -a "$LOG_FILE"
}

generate_changelog() {
  local from_tag="$1" to_tag="$2"
  local changes
  changes=$(cd "$AIWH_ROOT" && git log --oneline "$from_tag..$to_tag" 2>/dev/null)
  if [[ -z "$changes" ]]; then
    echo "No commits between $from_tag and $to_tag"
    return
  fi
  local feats=$(echo "$changes" | grep -c "^[a-f0-9]* feat" || true)
  local fixes=$(echo "$changes" | grep -c "^[a-f0-9]* fix" || true)
  local total=$(echo "$changes" | wc -l | tr -d ' ')
  echo "$total commits: $feats features, $fixes fixes"
}

record_update() {
  local from_tag="$1" to_tag="$2"
  mkdir -p "$(dirname "$UPDATE_RECORD")"
  python3 -c "
import json, os, datetime
f = '$UPDATE_RECORD'
history = json.load(open(f)) if os.path.exists(f) else []
history.append({
    'from': '$from_tag', 'to': '$to_tag',
    'openclaw': '$(openclaw --version 2>/dev/null || echo unknown)',
    'timestamp': datetime.datetime.utcnow().isoformat() + 'Z'
})
json.dump(history, open(f, 'w'), indent=2)
" 2>/dev/null || true
}
