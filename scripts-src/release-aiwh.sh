#!/usr/bin/env bash
##############################################################################
# release-aiwh.sh — Dev-only release workflow (NEVER ships to clients)
#
# Builds everything, verifies compilation, commits to aiwh-core, tags release.
# Brendon runs this ONE command when ready to push a release.
#
# Usage:
#   bash openclaw/scripts-src/release-aiwh.sh v2026.4.15
#   bash openclaw/scripts-src/release-aiwh.sh v2026.4.15 --dry-run
#
# What it does:
#   1. Build dashboard backend (Terser + config embedding + catalogue embedding)
#   2. Build dashboard frontend (Vite + Terser + LightningCSS)
#   3. Compile scripts (shc -> Mach-O, py_compile -> .pyc for ALL Python)
#   4. Verify compilation (all checks must pass)
#   5. Commit compiled output to aiwh-core git
#   6. Tag the release
#   7. Push to GitHub (aiwh-core main + openclaw aiwh-main)
##############################################################################
set -euo pipefail

AIWH_ROOT="/opt/AIWH"
CORE_DIR="$AIWH_ROOT/core"
OC_DIR="$AIWH_ROOT/openclaw"
SCRIPTS_SRC="$OC_DIR/scripts-src"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'

# ── Parse arguments ──────────────────────────────────────────
VERSION="${1:-}"
DRY_RUN=false
[[ "${2:-}" == "--dry-run" ]] && DRY_RUN=true

if [[ -z "$VERSION" ]]; then
  echo "Usage: release-aiwh.sh <version-tag> [--dry-run]"
  echo "Example: release-aiwh.sh v2026.4.15"
  exit 1
fi

if [[ ! "$VERSION" =~ ^v[0-9]{4}\.[0-9]+\.[0-9]+ ]]; then
  echo -e "${RED}Version must follow vYYYY.M.D format (e.g. v2026.4.15)${NC}"
  exit 1
fi

echo -e "${CYAN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║  AIWH Release Build — $VERSION                  ${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════╝${NC}"
echo ""

if $DRY_RUN; then
  echo -e "${YELLOW}DRY RUN — no commits, tags, or pushes${NC}"
  echo ""
fi

# ── Step 1: Build dashboard backend ──────────────────────────
echo -e "${CYAN}[1/7]${NC} Building dashboard backend (Terser + config embedding)..."
node "$OC_DIR/dashboard-api/build-backend.mjs"
echo ""

# ── Step 2: Build dashboard frontend ───────────────────���────
echo -e "${CYAN}[2/7]${NC} Building dashboard frontend (Vite + Terser + LightningCSS)..."
cd "$OC_DIR"
pnpm ui:build:aiwh
cd "$AIWH_ROOT"
echo ""

# ── Step 3: Compile scripts ─────────────────────────────────
echo -e "${CYAN}[3/7]${NC} Compiling scripts (shc + py_compile)..."
bash "$SCRIPTS_SRC/build-scripts.sh"
echo ""

# ── Step 4: Verify compilation ───────────────────────────────
echo -e "${CYAN}[4/7]${NC} Verifying compilation..."
errors=0

# 4a. server.js is minified (<=10 lines)
server_lines=$(wc -l < "$CORE_DIR/dashboard/server.js" | tr -d ' ')
if [[ "$server_lines" -le 10 ]]; then
  echo -e "  ${GREEN}✓${NC} server.js is minified ($server_lines lines)"
else
  echo -e "  ${RED}✗${NC} server.js is NOT minified ($server_lines lines)"
  errors=$((errors + 1))
fi

# 4b. catalogue-data.js exists and contains embedded configs
if [[ -f "$CORE_DIR/dashboard/catalogue-data.js" ]]; then
  for key in license landlockPolicy execApprovals orgChart; do
    if node -e "const c=require('$CORE_DIR/dashboard/catalogue-data.js'); if(!c.$key) process.exit(1)" 2>/dev/null; then
      echo -e "  ${GREEN}✓${NC} catalogue-data.js contains $key"
    else
      echo -e "  ${RED}✗${NC} catalogue-data.js MISSING $key"
      errors=$((errors + 1))
    fi
  done
else
  echo -e "  ${RED}✗${NC} catalogue-data.js not found"
  errors=$((errors + 1))
fi

# 4c. Bash scripts are Mach-O binaries (skip the skip-list)
skip_sh="factory-install.sh update-aiwh.sh prepare-for-shipping.sh reset-client-data.sh apply-agent-templates.sh qa-test.sh build-scripts.sh"
for sh in "$CORE_DIR"/scripts/*.sh; do
  [[ ! -f "$sh" ]] && continue
  name=$(basename "$sh")
  # Skip source-able scripts
  if echo "$skip_sh" | grep -qw "$name"; then continue; fi
  # Skip lib/ (different path)
  if file "$sh" | grep -q "Mach-O"; then
    : # OK
  else
    echo -e "  ${RED}✗${NC} $name is NOT compiled (Mach-O expected)"
    errors=$((errors + 1))
  fi
done
compiled_sh=$(find "$CORE_DIR/scripts" -maxdepth 1 -name "*.sh" -exec file {} \; | grep -c "Mach-O" || true)
echo -e "  ${GREEN}✓${NC} $compiled_sh bash scripts are Mach-O binaries"

# 4d. Python lib files have .pyc alongside thin launchers
lib_py_total=0; lib_pyc_found=0
while IFS= read -r -d '' pyfile; do
  lib_py_total=$((lib_py_total + 1))
  pyc="${pyfile%.py}.pyc"
  if [[ -f "$pyc" ]]; then
    lib_pyc_found=$((lib_pyc_found + 1))
  else
    echo -e "  ${RED}✗${NC} Missing .pyc for: ${pyfile#$CORE_DIR/scripts/}"
    errors=$((errors + 1))
  fi
done < <(find "$CORE_DIR/scripts/lib" -name "*.py" -type f -print0)
echo -e "  ${GREEN}✓${NC} $lib_pyc_found/$lib_py_total lib Python files have .pyc"

# 4e. No source dirs leaked into core/
for srcdir in ui-aiwh dashboard-api scripts-src docker-src src; do
  if [[ -d "$CORE_DIR/$srcdir" ]]; then
    echo -e "  ${RED}✗${NC} Source dir leaked: core/$srcdir/"
    errors=$((errors + 1))
  fi
done
echo -e "  ${GREEN}✓${NC} No source dirs in core/"

# 4f. Docker source moved (core/docker/ should only have landlock-guard binary)
docker_file_count=$(find "$CORE_DIR/docker" -type f | wc -l | tr -d ' ')
if [[ "$docker_file_count" -le 1 ]]; then
  echo -e "  ${GREEN}✓${NC} core/docker/ contains only compiled binary ($docker_file_count file)"
else
  echo -e "  ${YELLOW}⚠${NC} core/docker/ has $docker_file_count files (expected 1: landlock-guard)"
fi

if [[ $errors -gt 0 ]]; then
  echo -e "\n${RED}VERIFICATION FAILED — $errors error(s). Fix before releasing.${NC}"
  exit 1
fi
echo -e "\n  ${GREEN}All verification checks passed.${NC}"
echo ""

# ── Step 5: Commit to aiwh-core ─────────────────────────────
echo -e "${CYAN}[5/7]${NC} Committing compiled output to aiwh-core..."
cd "$AIWH_ROOT"
if $DRY_RUN; then
  echo "  Would commit all changes in core/ with tag $VERSION"
else
  git add core/
  git add .openclaw/openclaw.json 2>/dev/null || true
  # Check if there are changes to commit
  if git diff --cached --quiet; then
    echo -e "  ${YELLOW}No changes to commit in aiwh-core${NC}"
  else
    git commit -m "$(cat <<EOF
Release $VERSION — compiled build output

- Dashboard: backend minified (Terser), frontend compiled (Vite/Terser/LightningCSS)
- Scripts: bash compiled (shc/Mach-O), Python compiled (py_compile/.pyc)
- Lib: all Python libraries compiled to .pyc with thin launchers
- Configs: license, landlock, exec-approvals, org-chart embedded in catalogue-data.js
- Docker: source moved to fork, only compiled landlock-guard binary in core/docker/
EOF
)"
    echo -e "  ${GREEN}✓${NC} aiwh-core commit created"
  fi
fi
echo ""

# ── Step 6: Tag the release ──────────────────────────────────
echo -e "${CYAN}[6/7]${NC} Tagging release $VERSION..."
if $DRY_RUN; then
  echo "  Would create tag: $VERSION"
else
  git tag -a "$VERSION" -m "Release $VERSION"
  echo -e "  ${GREEN}✓${NC} Tag $VERSION created"
fi
echo ""

# ── Step 7: Push to GitHub ───────────────────────────────────
echo -e "${CYAN}[7/7]${NC} Pushing to GitHub..."
if $DRY_RUN; then
  echo "  Would push: aiwh-core main + tag $VERSION"
  echo "  Would push: openclaw aiwh-main"
else
  # Push aiwh-core (main + tags)
  cd "$AIWH_ROOT"
  git push origin main --tags
  echo -e "  ${GREEN}✓${NC} aiwh-core pushed (main + $VERSION)"

  # Push openclaw fork
  cd "$OC_DIR"
  git push origin aiwh-main
  echo -e "  ${GREEN}✓${NC} openclaw pushed (aiwh-main)"
fi

echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
echo -e "${GREEN}Release $VERSION complete.${NC}"
echo -e "Clients update via: git checkout $VERSION (aiwh-core)"
echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
