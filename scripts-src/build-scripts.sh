#!/usr/bin/env bash
##############################################################################
# build-scripts.sh — Compile bash (shc) and Python (py_compile) scripts
#
# Source: openclaw/scripts-src/
# Output: core/scripts/ (compiled binaries + thin launchers)
#
# Bash:   shc → Mach-O ARM64 binary (source lib/env.sh still works at runtime)
# Python: py_compile → .pyc bytecode + thin .py launcher via runpy
# Cython: attempted first for Python, py_compile fallback
#
# Files that MUST stay readable (sourced by bash via `source`):
#   lib/env.sh, lib/update-helpers.sh, lib/healthcheck.sh,
#   lib/check-platform.sh, lib/format-resolver.sh, lib/gdrive.sh,
#   factory-install.sh (runs before shc is installed)
#
# lib/*.py compiled to .pyc + thin launcher (same as top-level Python).
# lib/*.sh stays readable (source-able by bash binaries, Landlock read-only).
# Non-compilable dirs copied as-is: remotion/, slide-video/, sql/
##############################################################################
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUTPUT_DIR="/opt/AIWH/core/scripts"
CYTHON_BIN="${CYTHON_BIN:-$(command -v cython 2>/dev/null || echo /Users/roboai/Library/Python/3.9/bin/cython)}"

# Colors
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'

echo -e "${CYAN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║  AIWH Script Build (shc + py_compile)            ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════╝${NC}"
echo ""

# ── Bash scripts that MUST stay readable (sourced via `source`/`.`) ──
SKIP_SH=(
  "factory-install.sh"
  "update-aiwh.sh"
  "prepare-for-shipping.sh"
  "reset-client-data.sh"
  "apply-agent-templates.sh"
  "qa-test.sh"
)
SKIP_LIB_SH=(
  "lib/env.sh"
  "lib/update-helpers.sh"
  "lib/healthcheck.sh"
  "lib/check-platform.sh"
  "lib/format-resolver.sh"
  "lib/gdrive.sh"
)

is_skip_sh() {
  local f="$1"
  for s in "${SKIP_SH[@]}"; do [[ "$f" == "$s" ]] && return 0; done
  for s in "${SKIP_LIB_SH[@]}"; do [[ "$f" == "$s" ]] && return 0; done
  return 1
}

# ── Counters ──
sh_compiled=0; sh_skipped=0; sh_failed=0
py_compiled=0; py_skipped=0; py_failed=0

# ── [1/4] Compile bash scripts with shc ──────────────────────────────
echo -e "${CYAN}[1/4]${NC} Compiling bash scripts (shc)..."
for src in "$SCRIPT_DIR"/*.sh; do
  [[ ! -f "$src" ]] && continue
  name=$(basename "$src")

  # Skip build script itself
  [[ "$name" == "build-scripts.sh" ]] && continue

  # Skip source-able files
  if is_skip_sh "$name"; then
    cp "$src" "$OUTPUT_DIR/$name"
    echo -e "  ${YELLOW}SKIP${NC} $name (source-able, copied as text)"
    sh_skipped=$((sh_skipped + 1))
    continue
  fi

  # Create temp copy with #!/bin/bash shebang (shc requires absolute path)
  # Sanitize name for safe tmp path (defense-in-depth — source is our repo)
  safe_name="${name//[^a-zA-Z0-9._-]/_}"
  tmp="/tmp/shc_build_$$_${safe_name}"
  sed '1s|#!/usr/bin/env bash|#!/bin/bash|' "$src" > "$tmp"

  if shc -r -f "$tmp" -o "$OUTPUT_DIR/$name" 2>/dev/null; then
    # Clean up shc artifacts
    rm -f "${tmp}.x.c" "$tmp" 2>/dev/null
    chmod +x "$OUTPUT_DIR/$name"
    echo -e "  ${GREEN}✓${NC} $name → Mach-O"
    sh_compiled=$((sh_compiled + 1))
  else
    # Fallback: copy as readable (Landlock protects)
    cp "$src" "$OUTPUT_DIR/$name"
    chmod +x "$OUTPUT_DIR/$name"
    echo -e "  ${RED}✗${NC} $name → shc failed, copied as text"
    sh_failed=$((sh_failed + 1))
    rm -f "$tmp" 2>/dev/null
  fi
done

# ── [2/4] Compile Python scripts ────────────────────────────────────
echo ""
echo -e "${CYAN}[2/4]${NC} Compiling Python scripts (py_compile)..."
for src in "$SCRIPT_DIR"/*.py; do
  [[ ! -f "$src" ]] && continue
  name=$(basename "$src")
  base="${name%.py}"
  pyc_name="${base}.pyc"

  # Compile to .pyc bytecode
  if python3 -c "import py_compile; py_compile.compile('$src', '$OUTPUT_DIR/$pyc_name', doraise=True)" 2>/dev/null; then
    # Create thin launcher .py that runs the .pyc via runpy (falls back to source)
    cat > "$OUTPUT_DIR/$name" << 'LAUNCHER_EOF'
#!/usr/bin/env python3
"""Compiled — source at openclaw/scripts-src/"""
import runpy, os
_d = os.path.dirname(os.path.abspath(__file__))
_b = os.path.splitext(os.path.basename(__file__))[0]
_pyc = os.path.join(_d, _b + '.pyc')
_src = os.path.join(os.path.dirname(_d), 'openclaw', 'scripts-src', os.path.basename(__file__))
runpy.run_path(_pyc if os.path.exists(_pyc) else _src, run_name='__main__')
LAUNCHER_EOF
    chmod +x "$OUTPUT_DIR/$name"
    echo -e "  ${GREEN}✓${NC} $name → .pyc + launcher"
    py_compiled=$((py_compiled + 1))
  else
    # Fallback: copy as readable
    cp "$src" "$OUTPUT_DIR/$name"
    chmod +x "$OUTPUT_DIR/$name"
    echo -e "  ${RED}✗${NC} $name → py_compile failed, copied as text"
    py_failed=$((py_failed + 1))
  fi
done

# ── [3/4] Compile lib/ Python + copy lib/ shell ─────────────────────
echo ""
echo -e "${CYAN}[3/4]${NC} Compiling lib/ Python files + copying shell files..."

# Recreate output lib/ directory structure
mkdir -p "$OUTPUT_DIR/lib"
find "$SCRIPT_DIR/lib" -type d | while read -r srcdir; do
  reldir="${srcdir#$SCRIPT_DIR/}"
  mkdir -p "$OUTPUT_DIR/$reldir"
done

# Counters for lib
lib_sh_count=0; lib_py_compiled=0; lib_py_failed=0

# Copy .sh files as-is (must stay readable for `source`)
while IFS= read -r -d '' shfile; do
  relpath="${shfile#$SCRIPT_DIR/}"
  cp "$shfile" "$OUTPUT_DIR/$relpath"
  lib_sh_count=$((lib_sh_count + 1))
done < <(find "$SCRIPT_DIR/lib" -name "*.sh" -type f -print0)
echo -e "  ${GREEN}✓${NC} ${lib_sh_count} .sh files copied (readable, Landlock read-only protected)"

# Compile .py files to .pyc + thin launcher stubs
while IFS= read -r -d '' pyfile; do
  relpath="${pyfile#$SCRIPT_DIR/}"
  base="${relpath%.py}"
  pyc_out="$OUTPUT_DIR/${base}.pyc"

  if python3 -c "import py_compile; py_compile.compile('$pyfile', '$pyc_out', doraise=True)" 2>/dev/null; then
    # Determine if this is an __init__.py (package marker)
    fname=$(basename "$pyfile")
    if [[ "$fname" == "__init__.py" ]]; then
      # Package __init__ — needs submodule_search_locations for sub-imports
      cat > "$OUTPUT_DIR/$relpath" << 'INITLAUNCHER_EOF'
"""Compiled — source at openclaw/scripts-src/"""
import importlib.util, os, sys
_f = os.path.splitext(os.path.basename(__file__))[0]
_d = os.path.dirname(os.path.abspath(__file__))
_pyc = os.path.join(_d, _f + '.pyc')
if os.path.exists(_pyc):
    _s = importlib.util.spec_from_file_location(
        __name__, _pyc, submodule_search_locations=[_d])
    _m = importlib.util.module_from_spec(_s)
    _s.loader.exec_module(_m)
    _m.__path__ = [_d]
    sys.modules[__name__] = _m
INITLAUNCHER_EOF
    else
      # Regular module — thin launcher that loads compiled bytecode
      cat > "$OUTPUT_DIR/$relpath" << 'LIBLAUNCHER_EOF'
"""Compiled — source at openclaw/scripts-src/"""
import importlib.util, os, sys
_f = os.path.splitext(os.path.basename(__file__))[0]
_d = os.path.dirname(os.path.abspath(__file__))
_pyc = os.path.join(_d, _f + '.pyc')
if os.path.exists(_pyc):
    _s = importlib.util.spec_from_file_location(__name__, _pyc)
    _m = importlib.util.module_from_spec(_s)
    _s.loader.exec_module(_m)
    sys.modules[__name__] = _m
LIBLAUNCHER_EOF
    fi
    chmod +x "$OUTPUT_DIR/$relpath"
    echo -e "  ${GREEN}✓${NC} $relpath → .pyc + launcher"
    lib_py_compiled=$((lib_py_compiled + 1))
  else
    # Fallback: copy as readable (Landlock protects)
    cp "$pyfile" "$OUTPUT_DIR/$relpath"
    echo -e "  ${RED}✗${NC} $relpath → py_compile failed, copied as text"
    lib_py_failed=$((lib_py_failed + 1))
  fi
done < <(find "$SCRIPT_DIR/lib" -name "*.py" -type f -print0)

echo -e "  ${CYAN}Summary:${NC} ${lib_sh_count} .sh copied, ${GREEN}${lib_py_compiled}${NC} .py compiled, ${RED}${lib_py_failed}${NC} .py failed"

# ── [4/4] Copy non-compilable directories ────────────────────────────
echo ""
echo -e "${CYAN}[4/4]${NC} Copying non-compilable directories..."

# Copy JS/SQL/config dirs as-is
for subdir in remotion slide-video sql; do
  if [[ -d "$SCRIPT_DIR/$subdir" ]]; then
    mkdir -p "$OUTPUT_DIR/$subdir"
    rsync -a --exclude='node_modules' --exclude='__pycache__' "$SCRIPT_DIR/$subdir/" "$OUTPUT_DIR/$subdir/"
    echo -e "  ${GREEN}✓${NC} $subdir/ copied"
  fi
done

# Copy standalone JS files
for js in "$SCRIPT_DIR"/*.js; do
  [[ -f "$js" ]] && cp "$js" "$OUTPUT_DIR/$(basename "$js")" && echo -e "  ${GREEN}✓${NC} $(basename "$js") copied"
done

# ── Summary ──────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
echo -e "  Bash:   ${GREEN}${sh_compiled}${NC} compiled, ${YELLOW}${sh_skipped}${NC} skipped (source-able), ${RED}${sh_failed}${NC} failed"
echo -e "  Python: ${GREEN}${py_compiled}${NC} compiled, ${YELLOW}${py_skipped}${NC} skipped, ${RED}${py_failed}${NC} failed"
echo -e "  lib/:   ${lib_sh_count} .sh (readable) + ${GREEN}${lib_py_compiled}${NC} .py compiled, ${RED}${lib_py_failed}${NC} .py failed"
echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"

total_failed=$((sh_failed + py_failed + lib_py_failed))
if [[ $total_failed -gt 0 ]]; then
  echo -e "\n${YELLOW}⚠ Some files could not be compiled — copied as readable text.${NC}"
  echo -e "${YELLOW}  Landlock read-only on core/scripts/ protects them regardless.${NC}"
fi
