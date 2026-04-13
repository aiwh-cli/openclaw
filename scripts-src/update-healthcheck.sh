#!/usr/bin/env bash
##############################################################################
# update-healthcheck.sh — Health checks for AIWH update safety
#
# Usage:
#   update-healthcheck.sh pre        # Pre-update checks (safe to proceed?)
#   update-healthcheck.sh post       # Post-update checks (did it work?)
#   update-healthcheck.sh full       # Run both pre + post
#   update-healthcheck.sh save-state # Save state before update (cron count)
#   update-healthcheck.sh --json pre # Output JSON (for scripts/dashboard)
#
# Exit codes: 0 = all pass, 1 = failures detected
# Modeled after `openclaw doctor` but AIWH-specific.
##############################################################################

set -uo pipefail
source /opt/AIWH/core/scripts/lib/env.sh

# Parse --json flag (can appear in any position)
JSON_OUTPUT=false
ARGS=()
for arg in "$@"; do
  [[ "$arg" == "--json" ]] && JSON_OUTPUT=true || ARGS+=("$arg")
done
MODE="${ARGS[0]:-full}"

# Load shared check functions
source /opt/AIWH/core/scripts/lib/healthcheck.sh

case "$MODE" in
  pre)       run_pre_checks ;;
  post)      run_post_checks ;;
  full)      run_pre_checks; run_post_checks ;;
  save-state) save_pre_state; exit 0 ;;
  *)
    echo "Usage: update-healthcheck.sh [pre|post|full|save-state] [--json]"
    exit 1
    ;;
esac

output_results
