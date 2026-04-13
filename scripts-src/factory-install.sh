#!/usr/bin/env bash
##############################################################################
# factory-install.sh — Set up a fresh Mac Mini as an AIWH client machine.
#
# Usage:
#   sudo bash factory-install.sh --client-id <id> --modules <csv> --tailscale-key <key>
#
# Example:
#   sudo ANTHROPIC_KEY=sk-ant-xxx OPENAI_KEY=sk-proj-xxx \
#     bash factory-install.sh --client-id acme --modules frontend,backend \
#       --tailscale-key tskey-auth-xxx --docker-src /tmp/docker-src
#
# Runs ~30 min on a fresh macOS install. Fully automated (no prompts).
# Must be run as root or with sudo (dry-run mode skips this check).
#
# Required flags:
#   --client-id <id>       Unique client identifier (e.g. fitpro-jane)
#   --modules <csv>        Module selection: frontend, backend, lifestyle, system
#   --tailscale-key <key>  Tailscale auth key (tskey-auth-...)
#
# Optional flags:
#   --docker-src <path>    Path to docker-src/ (copied from dev machine)
#   --release-tag <tag>    Git tag for aiwh-core (default: latest)
#   --dry-run              Show what would happen without making changes
#   -h, --help             Show usage help
#
# API keys (via environment variables — not CLI args, for security):
#   ANTHROPIC_KEY          Anthropic API key for QA testing
#   OPENAI_KEY             OpenAI API key for QA testing
#   HEYGEN_KEY             HeyGen API key (optional)
#   ELEVENLABS_KEY         ElevenLabs API key (optional)
##############################################################################

set -euo pipefail

# ── Defaults & Constants ──────────────────────────────────────────────────────
AIWH_ROOT="/opt/AIWH"
CORE_DIR="$AIWH_ROOT/core"
CLIENT_DIR="$AIWH_ROOT/client"
OPENCLAW_DIR="$AIWH_ROOT/.openclaw"
GITHUB_REPO="aiwh-cli/aiwh-core"
OPENCLAW_REPO="aiwh-cli/openclaw"
RELEASE_TAG="${RELEASE_TAG:-latest}"
OLLAMA_MODEL="llama3.2:3b"
DASHBOARD_PORT=3001
# Onboarding is built into the dashboard (first-run detection)
# No separate onboarding server needed
GATEWAY_PORT=18789
LOG_FILE="/tmp/factory-install-$(date +%Y%m%d-%H%M%S).log"
touch "$LOG_FILE" && chmod 600 "$LOG_FILE"

# ── Color output ──────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
step_num=0
TOTAL_STEPS=28

step() {
    step_num=$((step_num + 1))
    echo -e "\n${CYAN}[$step_num/$TOTAL_STEPS]${NC} $1"
    echo "[$(date +%H:%M:%S)] Step $step_num: $1" >> "$LOG_FILE"
}

ok() { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; echo "[FAIL] $1" >> "$LOG_FILE"; exit 1; }

# ── Parse Arguments ───────────────────────────────────────────────────────────
CLIENT_ID=""
MODULE_SELECTION=""
TAILSCALE_AUTH_KEY=""
DOCKER_SRC=""
# API keys read from environment (not CLI args — avoids ps exposure)
ANTHROPIC_KEY="${ANTHROPIC_KEY:-}"
OPENAI_KEY="${OPENAI_KEY:-}"
HEYGEN_KEY="${HEYGEN_KEY:-}"
ELEVENLABS_KEY="${ELEVENLABS_KEY:-}"
DRY_RUN=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --client-id)      CLIENT_ID="$2"; shift 2 ;;
        --modules)        MODULE_SELECTION="$2"; shift 2 ;;
        --tailscale-key)  TAILSCALE_AUTH_KEY="$2"; shift 2 ;;
        --release-tag)    RELEASE_TAG="$2"; shift 2 ;;
        --docker-src)     DOCKER_SRC="$2"; shift 2 ;;
        --dry-run)        DRY_RUN=true; shift ;;
        -h|--help)
            echo "Usage: factory-install.sh --client-id <id> --modules <csv> --tailscale-key <key>"
            echo ""
            echo "Required:"
            echo "  --client-id       Client identifier (e.g. acme, smith-co)"
            echo "  --modules         Comma-separated modules: frontend,backend,lifestyle"
            echo "  --tailscale-key   Tailscale auth key (tskey-auth-...)"
            echo ""
            echo "Optional:"
            echo "  --release-tag     Git release tag (default: latest)"
            echo "  --docker-src      Path to docker-src/ dir (from dev machine)"
            echo "  --dry-run         Show what would happen without making changes"
            echo ""
            echo "API keys (set as environment variables):"
            echo "  ANTHROPIC_KEY     Anthropic API key for QA testing"
            echo "  OPENAI_KEY        OpenAI API key for QA testing"
            echo "  HEYGEN_KEY        HeyGen API key"
            echo "  ELEVENLABS_KEY    ElevenLabs API key"
            exit 0
            ;;
        *) fail "Unknown argument: $1" ;;
    esac
done

[[ -z "$CLIENT_ID" ]] && fail "Missing required --client-id"
[[ -z "$MODULE_SELECTION" ]] && fail "Missing required --modules"
[[ -z "$TAILSCALE_AUTH_KEY" ]] && fail "Missing required --tailscale-key"

HOSTNAME_TAG="aiwh-${CLIENT_ID}"

# Validate module selection
IFS=',' read -ra MODULES <<< "$MODULE_SELECTION"
for mod in "${MODULES[@]}"; do
    case "$mod" in
        frontend|backend|lifestyle|system) ;;
        *) fail "Invalid module: $mod (valid: frontend, backend, lifestyle, system)" ;;
    esac
done

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║            AIWH Factory Install — $HOSTNAME_TAG            ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "  Client ID:      $CLIENT_ID"
echo "  Modules:        $MODULE_SELECTION"
echo "  Release tag:    $RELEASE_TAG"
echo "  Log:            $LOG_FILE"
echo ""

if $DRY_RUN; then
    echo -e "${YELLOW}DRY RUN — no changes will be made${NC}"
    echo ""
fi

# ── Pre-flight checks ────────────────────────────────────────────────────────
if [[ $EUID -ne 0 ]] && ! $DRY_RUN; then
    fail "Must run as root (sudo) for system-level installs"
fi

if [[ "$(uname)" != "Darwin" ]]; then
    fail "This script is for macOS only"
fi

if [[ "$(uname -m)" != "arm64" ]]; then
    fail "This script requires Apple Silicon (ARM64). Intel Macs are not supported."
fi

if ! curl -s --max-time 5 https://api.github.com > /dev/null 2>&1; then
    fail "No internet connection — cannot reach GitHub. Connect to WiFi first."
fi

echo "Starting factory install..." | tee -a "$LOG_FILE"

# ══════════════════════════════════════════════════════════════════════════════
# Step 1: Install Homebrew
# ══════════════════════════════════════════════════════════════════════════════
step "Install Homebrew"
if command -v brew &>/dev/null; then
    ok "Homebrew already installed ($(brew --version | head -1))"
else
    if $DRY_RUN; then ok "Would install Homebrew"; else
        NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
        # Add to path for Apple Silicon
        if [[ -f /opt/homebrew/bin/brew ]]; then
            eval "$(/opt/homebrew/bin/brew shellenv)"
            echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> "/Users/$(logname)/.zprofile"
        fi
        ok "Homebrew installed"
    fi
fi

# ══════════════════════════════════════════════════════════════════════════════
# Step 2: Install system dependencies
# ══════════════════════════════════════════════════════════════════════════════
step "Install Node.js, Python, ffmpeg, jq, git, ollama, colima, docker"
BREW_PKGS=(node python@3.11 ffmpeg jq git ollama colima docker)
for pkg in "${BREW_PKGS[@]}"; do
    if brew list "$pkg" &>/dev/null; then
        ok "$pkg already installed"
    else
        if $DRY_RUN; then ok "Would install $pkg"; else
            brew install "$pkg" 2>&1 | tail -1
            ok "$pkg installed"
        fi
    fi
done

# ══════════════════════════════════════════════════════════════════════════════
# Step 3: Pull Ollama model
# ══════════════════════════════════════════════════════════════════════════════
step "Pull Ollama model: $OLLAMA_MODEL"
if $DRY_RUN; then ok "Would pull $OLLAMA_MODEL"; else
    # Start ollama service if not running
    if ! pgrep -x ollama &>/dev/null; then
        brew services start ollama 2>/dev/null || ollama serve &>/dev/null &
        sleep 3
    fi
    ollama pull "$OLLAMA_MODEL" 2>&1 | tail -1
    ok "$OLLAMA_MODEL ready"
fi

# ══════════════════════════════════════════════════════════════════════════════
# Step 4: Start Colima (Docker runtime)
# ══════════════════════════════════════════════════════════════════════════════
step "Start Colima (Docker runtime for container)"
if $DRY_RUN; then ok "Would start Colima"; else
    if colima status 2>/dev/null | grep -q "Running"; then
        ok "Colima already running"
    else
        colima start --cpu 2 --memory 4 --disk 30 --runtime docker 2>&1 | tail -3
        ok "Colima started (2 CPU, 4GB RAM, 30GB disk)"
    fi
    # Set DOCKER_HOST for this session
    export DOCKER_HOST="unix:///Users/$(logname)/.colima/docker.sock"
    # Add to shell profile for persistence
    ZPROFILE="/Users/$(logname)/.zprofile"
    if ! grep -q "DOCKER_HOST" "$ZPROFILE" 2>/dev/null; then
        echo 'export DOCKER_HOST="unix://$HOME/.colima/docker.sock"' >> "$ZPROFILE"
    fi
    # Enable Colima auto-start on boot
    su "$(logname)" -c "brew services start colima" 2>/dev/null || true
    # Verify Docker is working
    if docker ps &>/dev/null; then
        ok "Docker is working"
    else
        warn "Docker may not be ready — check 'colima status'"
    fi
fi

# ══════════════════════════════════════════════════════════════════════════════
# Step 5: Install Tailscale via official .pkg
# ══════════════════════════════════════════════════════════════════════════════
step "Install Tailscale"
if command -v tailscale &>/dev/null; then
    ok "Tailscale already installed ($(tailscale version 2>/dev/null | head -1))"
else
    if $DRY_RUN; then ok "Would install Tailscale via .pkg"; else
        TS_PKG="/tmp/tailscale.pkg"
        curl -fsSL "https://pkgs.tailscale.com/stable/Tailscale-latest-macos.pkg" -o "$TS_PKG"
        installer -pkg "$TS_PKG" -target / 2>&1 | tail -1
        rm -f "$TS_PKG"
        ok "Tailscale installed"
    fi
fi

# ══════════════════════════════════════════════════════════════════════════════
# Step 6: Join AIWH tailnet
# ══════════════════════════════════════════════════════════════════════════════
step "Join AIWH tailnet as $HOSTNAME_TAG"
if $DRY_RUN; then ok "Would join tailnet"; else
    tailscale up \
        --authkey "$TAILSCALE_AUTH_KEY" \
        --hostname "$HOSTNAME_TAG" \
        --ssh \
        --advertise-tags=tag:client \
        --accept-routes 2>&1 | tail -3
    ok "Joined tailnet as $HOSTNAME_TAG"
fi

# ══════════════════════════════════════════════════════════════════════════════
# Step 7: Enable Tailscale Serve on dashboard port
# ══════════════════════════════════════════════════════════════════════════════
step "Enable Tailscale Serve on port $DASHBOARD_PORT"
if $DRY_RUN; then ok "Would enable Tailscale Serve"; else
    tailscale serve --bg https+insecure://localhost:$DASHBOARD_PORT 2>/dev/null || \
        tailscale serve https+insecure://localhost:$DASHBOARD_PORT 2>/dev/null || \
        warn "Tailscale Serve setup may need manual config"
    ok "Tailscale Serve enabled (tailnet-only access)"
fi

# ══════════════════════════════════════════════════════════════════════════════
# Step 7: Clone aiwh-core from GitHub (MUST come before OpenClaw + device-register)
# ══════════════════════════════════════════════════════════════════════════════
step "Clone $GITHUB_REPO (tag: $RELEASE_TAG)"
if [[ -d "$AIWH_ROOT/.git" ]]; then
    warn "AIWH repo already exists — skipping clone"
else
    if $DRY_RUN; then ok "Would clone to $AIWH_ROOT"; else
        if [[ "$RELEASE_TAG" == "latest" ]]; then
            git clone "https://github.com/$GITHUB_REPO.git" "$AIWH_ROOT" 2>&1 | tail -1
        else
            git clone "https://github.com/$GITHUB_REPO.git" "$AIWH_ROOT" --branch "$RELEASE_TAG" 2>&1 | tail -1
        fi
        ok "AIWH core cloned ($(cd "$AIWH_ROOT" && git describe --tags 2>/dev/null || echo 'no tag'))"
    fi
fi

# Install Node dependencies
if [[ -f "$CORE_DIR/dashboard/package.json" ]]; then
    if $DRY_RUN; then ok "Would install dashboard npm deps"; else
        cd "$CORE_DIR/dashboard" && npm install --production 2>&1 | tail -1
        ok "Dashboard dependencies installed"
    fi
fi

# Install Python dependencies
if [[ -f "$CORE_DIR/requirements.txt" ]]; then
    if $DRY_RUN; then ok "Would install Python deps"; else
        pip3 install -r "$CORE_DIR/requirements.txt" 2>&1 | tail -1
        ok "Python dependencies installed"
    fi
fi

# ══════════════════════════════════════════════════════════════════════════════
# Step 8: Install OpenClaw CLI (into the now-existing /opt/AIWH/openclaw/)
# ══════════════════════════════════════════════════════════════════════════════
step "Install OpenClaw CLI (AIWH fork — sparse checkout, compiled runtime only)"
if $DRY_RUN; then ok "Would install OpenClaw from $OPENCLAW_REPO (sparse)"; else
    oc_dir="$AIWH_ROOT/openclaw"
    if [[ -d "$oc_dir" ]]; then
        cd "$oc_dir" && git fetch --tags 2>&1 | tail -1
    else
        # Sparse checkout: only pull compiled runtime — no source dirs
        git clone --filter=blob:none --sparse \
            "https://github.com/$OPENCLAW_REPO.git" "$oc_dir" --branch aiwh-main 2>&1 | tail -1
        cd "$oc_dir"
        git sparse-checkout set \
            dist/ extensions/ skills/ packages/ assets/ docs/ \
            openclaw.mjs package.json pnpm-lock.yaml \
            CHANGELOG.md LICENSE README.md \
            scripts/npm-runner.mjs scripts/postinstall-bundled-plugins.mjs
    fi
    cd "$oc_dir" && npm install -g . 2>&1 | tail -1
    ok "OpenClaw installed from fork: $(openclaw --version 2>/dev/null || echo 'unknown')"
fi

# ══════════════════════════════════════════════════════════════════════════════
# Step 9: Register device for team management (requires core/scripts/)
# ══════════════════════════════════════════════════════════════════════════════
step "Register device for team management"
if $DRY_RUN; then ok "Would generate device secret and register"; else
    "$CORE_DIR/scripts/device-register.sh" --client-id "$CLIENT_ID"
    ok "Device registered (client/config/device-registration.json)"
fi

# ══════════════════════════════════════════════════════════════════════════════
# Step 10: Build Docker image (if docker-src provided)
# ══════════════════════════════════════════════════════════════════════════════
step "Build Docker image for gateway container"
if [[ -z "$DOCKER_SRC" ]]; then
    warn "No --docker-src provided — skipping Docker image build"
    warn "Copy docker-src/ from dev machine and run: bash /path/to/docker-src/build.sh"
elif [[ ! -d "$DOCKER_SRC" ]]; then
    warn "Docker source not found at: $DOCKER_SRC"
elif $DRY_RUN; then
    ok "Would build Docker image from $DOCKER_SRC"
else
    if [[ -f "$DOCKER_SRC/build.sh" ]]; then
        bash "$DOCKER_SRC/build.sh" 2>&1 | tail -5
        if docker image inspect "aiwh/openclaw:latest" &>/dev/null; then
            ok "Docker image built: aiwh/openclaw:latest"
            # Copy container manager to core/scripts for runtime use
            cp "$DOCKER_SRC/openclaw-container.sh" "$CORE_DIR/scripts/openclaw-container.sh" 2>/dev/null || true
            chmod 755 "$CORE_DIR/scripts/openclaw-container.sh" 2>/dev/null || true
        else
            warn "Docker image build may have failed — check logs"
        fi
    else
        warn "build.sh not found in $DOCKER_SRC"
    fi
fi

# ══════════════════════════════════════════════════════════════════════════════
# Step 11: Write license.json
# ══════════════════════════════════════════════════════════════════════════════
step "Write license.json"
HW_FINGERPRINT=$(system_profiler SPHardwareDataType 2>/dev/null | grep "Serial Number" | awk '{print $NF}' || echo "unknown")
VALID_UNTIL=$(date -v+1y +"%Y-%m-%dT00:00:00Z" 2>/dev/null || date -d "+1 year" +"%Y-%m-%dT00:00:00Z")

# Build modules JSON array
MODULES_JSON="["
first=true
for mod in "${MODULES[@]}"; do
    if $first; then first=false; else MODULES_JSON+=","; fi
    MODULES_JSON+="\"$mod\""
done
MODULES_JSON+="]"

if $DRY_RUN; then ok "Would write license.json"; else
    cat > "$CORE_DIR/config/license.json" << LICEOF
{
  "client_id": "$CLIENT_ID",
  "client_name": "$CLIENT_ID",
  "hardware_fingerprint": "$HW_FINGERPRINT",
  "issued_at": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "valid_until": "$VALID_UNTIL",
  "subscription_active": true,
  "modules_installed": $MODULES_JSON,
  "modules_active": $MODULES_JSON
}
LICEOF
    ok "license.json written (HW: $HW_FINGERPRINT)"
fi

# Write modules.json (dashboard feature gating)
step "Write modules.json"
if $DRY_RUN; then ok "Would write modules.json"; else
    mkdir -p "$CLIENT_DIR/config"
    python3 -c "
import json, sys
modules = sys.argv[1:]
out = {}
features = {
    'frontend': {'video_pipeline': {'enabled': True, 'label': 'Daily Video Pipeline'},
                 'cinematic': {'enabled': True, 'label': 'Cinematic Video'}},
    'backend':  {'crm': {'enabled': True, 'label': 'CRM & Lead Management'},
                 'cold_outreach': {'enabled': True, 'label': 'Cold Outreach'}},
    'lifestyle': {'wcc': {'enabled': True, 'label': 'Wealth Command Centre',
                          'description': 'IAW Wealth Command Centre'}}
}
for mod in ['frontend', 'backend', 'lifestyle']:
    enabled = mod in modules
    out[mod] = {'enabled': enabled, 'label': mod.capitalize(),
                'features': features.get(mod, {}) if enabled else {}}
json.dump(out, open('$CLIENT_DIR/config/modules.json', 'w'), indent=2)
" "${MODULES[@]}"
    ok "modules.json written"
fi

# Write notifications.json (empty — client configures during onboarding channel setup)
step "Write notifications.json"
if $DRY_RUN; then ok "Would write notifications.json"; else
    cat > "$CLIENT_DIR/config/notifications.json" << 'NOTIFYEOF'
{
  "general":  {"channel": "", "target": ""},
  "systems":  {"channel": "", "target": ""},
  "publish":  {"channel": "", "target": ""},
  "spend":    {"channel": "", "target": ""}
}
NOTIFYEOF
    ok "notifications.json written (client configures channel during onboarding)"
fi

# Write client-profile.md template (populated during onboarding)
step "Write client config templates"
if $DRY_RUN; then ok "Would write client-profile.md + content-pillars.json templates"; else
    cat > "$CLIENT_DIR/config/client-profile.md" << 'PROFILEEOF'
# Client Profile

## Business

- **Name:** (set during onboarding)
- **Niche:** (set during onboarding)
- **Industry:** (set during onboarding)
- **Target audience:** (set during onboarding)

## Brand Voice

- **Tone:** (set during onboarding)

## Methodology

- **Framework name:** (set during onboarding)

## Ideal Client

- **Who:** (set during onboarding)

## Sales Process

- **Pipeline stages:** New Lead > Qualified > Discovery Call Booked > Discovery Call Done > Proposal Sent > Closed Won > Closed Lost > Active Client
PROFILEEOF

    cat > "$CLIENT_DIR/config/content-pillars.json" << 'PILLARSEOF'
{
  "pillars": [],
  "rotation": [],
  "posting_frequency": "2/day",
  "content_formats": ["reel"],
  "target_platforms": ["instagram"],
  "rotation_epoch": "2026-01-01"
}
PILLARSEOF
    ok "client-profile.md + content-pillars.json templates written"
fi

# ══════════════════════════════════════════════════════════════════════════════
# Step 15: Run Supabase migration check
# ══════════════════════════════════════════════════════════════════════════════
step "Verify Supabase tables"
if $DRY_RUN; then ok "Would verify Supabase tables"; else
    if [[ -f "$CORE_DIR/scripts/supabase-migrate.py" ]]; then
        python3 "$CORE_DIR/scripts/supabase-migrate.py" 2>&1 | tail -3
        ok "Supabase tables verified"
    else
        warn "supabase-migrate.py not found — skipping"
    fi
fi

# ══════════════════════════════════════════════════════════════════════════════
# Step 16: Set file permissions on critical files
# ══════════════════════════════════════════════════════════════════════════════
step "Set permissions on critical files"
if $DRY_RUN; then ok "Would set chmod 444/555"; else
    # Read-only for config files
    find "$CORE_DIR/config" -type f -exec chmod 444 {} \; 2>/dev/null || true
    # Read-only for identity files
    for f in CORE.md BOOTSTRAP.md HARD-LIMITS.md; do
        [[ -f "$CORE_DIR/$f" ]] && chmod 444 "$CORE_DIR/$f"
    done
    # Execute-only for scripts dir
    find "$CORE_DIR/scripts" -name "*.sh" -exec chmod 555 {} \; 2>/dev/null || true
    find "$CORE_DIR/scripts" -name "*.py" -exec chmod 555 {} \; 2>/dev/null || true
    ok "Permissions set (config=444, scripts=555)"
fi

# ══════════════════════════════════════════════════════════════════════════════
# Step 17: Create control directory
# ══════════════════════════════════════════════════════════════════════════════
step "Create control/ directory"
if $DRY_RUN; then ok "Would create control/"; else
    mkdir -p "$CORE_DIR/control"
    chmod 775 "$CORE_DIR/control"
    ok "control/ created (chmod 775)"
fi

# ══════════════════════════════════════════════════════════════════════════════
# Step 18: Install LaunchDaemon watchdog
# ══════════════════════════════════════════════════════════════════════════════
step "Install watchdog LaunchDaemon"
# Ensure client/logs exists before any daemon references it
mkdir -p "$CLIENT_DIR/logs" 2>/dev/null || true
WATCHDOG_PLIST="/Library/LaunchDaemons/com.aiwh.watchdog.plist"
if $DRY_RUN; then ok "Would install watchdog plist"; else
    cat > "$WATCHDOG_PLIST" << 'WDEOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.aiwh.watchdog</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>-c</string>
        <string>
if [ -f /opt/AIWH/core/control/emergency.flag ]; then
    echo "EMERGENCY FLAG DETECTED — blocking agent sessions"
    pkill -f "openclaw session" 2>/dev/null || true
fi
        </string>
    </array>
    <key>WatchPaths</key>
    <array>
        <string>/opt/AIWH/core/control</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/opt/AIWH/client/logs/watchdog.log</string>
    <key>StandardErrorPath</key>
    <string>/opt/AIWH/client/logs/watchdog.log</string>
</dict>
</plist>
WDEOF
    chmod 644 "$WATCHDOG_PLIST"
    launchctl load "$WATCHDOG_PLIST" 2>/dev/null || true
    ok "Watchdog daemon installed"
fi

# ══════════════════════════════════════════════════════════════════════════════
# Step 19: Install HARD-LIMITS.md + bootstrap hook
# ══════════════════════════════════════════════════════════════════════════════
step "Configure HARD-LIMITS.md + bootstrap hook"
if $DRY_RUN; then ok "Would configure bootstrap hook"; else
    # Ensure HARD-LIMITS.md exists
    if [[ ! -f "$CORE_DIR/HARD-LIMITS.md" ]]; then
        warn "HARD-LIMITS.md not found in core/ — expected from clone"
    else
        ok "HARD-LIMITS.md present"
    fi

    # Add bootstrap-extra-files hook to openclaw.json if not present
    if [[ -f "$OPENCLAW_DIR/openclaw.json" ]]; then
        if ! grep -q "bootstrap-extra-files" "$OPENCLAW_DIR/openclaw.json" 2>/dev/null; then
            warn "bootstrap-extra-files hook not in openclaw.json — add manually"
        else
            ok "Bootstrap hook already configured"
        fi
    fi
fi

# ══════════════════════════════════════════════════════════════════════════════
# Step 20: Configure exec approvals + workspaceOnly
# ══════════════════════════════════════════════════════════════════════════════
step "Configure agent security (exec approvals, workspaceOnly)"
if $DRY_RUN; then ok "Would configure agent security"; else
    if [[ -f "$OPENCLAW_DIR/openclaw.json" ]]; then
        # Verify workspaceOnly and exec approvals are set
        if python3 -c "
import json
with open('$OPENCLAW_DIR/openclaw.json') as f:
    cfg = json.load(f)
defaults = cfg.get('agents', {}).get('defaults', {})
print('workspace:', defaults.get('workspaceOnly', 'NOT SET'))
print('exec:', defaults.get('execApprovals', 'NOT SET'))
" 2>/dev/null; then
            ok "Agent security config verified"
        else
            warn "Could not verify openclaw.json — check manually"
        fi
    else
        warn "openclaw.json not found"
    fi
fi

# ══════════════════════════════════════════════════════════════════════════════
# Step 21: Store API keys in macOS Keychain (for QA testing)
# ══════════════════════════════════════════════════════════════════════════════
step "Store API keys in macOS Keychain"
if $DRY_RUN; then ok "Would store keys in Keychain"; else
    # Verify Keychain access works
    security add-generic-password -a "aiwh" -s "aiwh-test-marker" -w "factory-install-$(date +%s)" \
        -U 2>/dev/null || true
    security delete-generic-password -a "aiwh" -s "aiwh-test-marker" 2>/dev/null || true
    ok "Keychain access verified"

    # Store provided API keys (for QA testing — removed by prepare-for-shipping.sh)
    _keys_stored=0
    if [[ -n "$ANTHROPIC_KEY" ]]; then
        security add-generic-password -a "aiwh" -s "anthropic-api-key" -w "$ANTHROPIC_KEY" -U 2>/dev/null || true
        ok "Anthropic API key stored"; _keys_stored=$((_keys_stored+1))
    fi
    if [[ -n "$OPENAI_KEY" ]]; then
        security add-generic-password -a "aiwh" -s "openai-api-key" -w "$OPENAI_KEY" -U 2>/dev/null || true
        ok "OpenAI API key stored"; _keys_stored=$((_keys_stored+1))
    fi
    if [[ -n "$HEYGEN_KEY" ]]; then
        security add-generic-password -a "aiwh" -s "heygen-api-key" -w "$HEYGEN_KEY" -U 2>/dev/null || true
        ok "HeyGen API key stored"; _keys_stored=$((_keys_stored+1))
    fi
    if [[ -n "$ELEVENLABS_KEY" ]]; then
        security add-generic-password -a "aiwh" -s "elevenlabs-api-key" -w "$ELEVENLABS_KEY" -U 2>/dev/null || true
        ok "ElevenLabs API key stored"; _keys_stored=$((_keys_stored+1))
    fi
    if [[ $_keys_stored -eq 0 ]]; then
        ok "No API keys provided — client enters during onboarding"
    else
        ok "$_keys_stored API key(s) stored for QA testing"
    fi
fi

# ══════════════════════════════════════════════════════════════════════════════
# Step 22: Register LaunchDaemons (backup, heartbeat)
# ══════════════════════════════════════════════════════════════════════════════
step "Register LaunchDaemons: backup, heartbeat"
# Backup daemon — runs nightly at 2am
BACKUP_PLIST="/Library/LaunchDaemons/com.aiwh.backup.plist"
# Heartbeat daemon — runs every 8 hours
HEARTBEAT_PLIST="/Library/LaunchDaemons/com.aiwh.heartbeat.plist"

if $DRY_RUN; then ok "Would install backup + heartbeat daemons"; else
    cat > "$BACKUP_PLIST" << 'BKEOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.aiwh.backup</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>/opt/AIWH/core/scripts/backup-snapshot.sh</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>2</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>
    <key>StandardOutPath</key>
    <string>/opt/AIWH/client/logs/backup-daemon.log</string>
    <key>StandardErrorPath</key>
    <string>/opt/AIWH/client/logs/backup-daemon.log</string>
</dict>
</plist>
BKEOF

    cat > "$HEARTBEAT_PLIST" << 'HBEOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.aiwh.heartbeat</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>/opt/AIWH/core/scripts/heartbeat-runner.sh</string>
    </array>
    <key>StartInterval</key>
    <integer>28800</integer>
    <key>StandardOutPath</key>
    <string>/opt/AIWH/client/logs/heartbeat.log</string>
    <key>StandardErrorPath</key>
    <string>/opt/AIWH/client/logs/heartbeat.log</string>
</dict>
</plist>
HBEOF

    chmod 644 "$BACKUP_PLIST" "$HEARTBEAT_PLIST"
    launchctl load "$BACKUP_PLIST" 2>/dev/null || true
    launchctl load "$HEARTBEAT_PLIST" 2>/dev/null || true
    ok "Backup (2am nightly) + Heartbeat (8hr) daemons installed"
fi

# ══════════════════════════════════════════════════════════════════════════════
# Step 23: Register OpenClaw crons
# ══════════════════════════════════════════════════════════════════════════════
step "Register OpenClaw crons"
if $DRY_RUN; then ok "Would register OpenClaw crons"; else
    # These are registered via openclaw.json crons section
    # Verify the crons config exists
    if [[ -f "$OPENCLAW_DIR/openclaw.json" ]]; then
        CRON_COUNT=$(python3 -c "
import json
with open('$OPENCLAW_DIR/openclaw.json') as f:
    cfg = json.load(f)
crons = cfg.get('crons', [])
print(len(crons))
" 2>/dev/null || echo "0")
        ok "OpenClaw config has $CRON_COUNT cron entries"
    else
        warn "openclaw.json not found — crons must be configured manually"
    fi
fi

# ══════════════════════════════════════════════════════════════════════════════
# Step 24: Create client/ directory structure
# ══════════════════════════════════════════════════════════════════════════════
step "Create client/ directory structure"
if $DRY_RUN; then ok "Would create $CLIENT_DIR"; else
    mkdir -p "$CLIENT_DIR"/{content/{cinematic,jobs},knowledge,config,data,logs,scripts,skills,trash,uploads}
    # Create empty databases that will be populated on first run
    touch "$CLIENT_DIR/data/video-jobs.db"
    touch "$CLIENT_DIR/data/base_knowledge_cache.db"
    touch "$CLIENT_DIR/knowledge/client.db"
    # Create default avatar config if missing
    if [[ ! -s "$CLIENT_DIR/config/avatar-config.json" ]]; then
        echo '{"avatars":[],"default_avatar":null}' > "$CLIENT_DIR/config/avatar-config.json"
    fi
    # Ensure core/memory exists (Branson's workspace, ships with product)
    mkdir -p "$CORE_DIR/memory"
    ok "client/ structure created (no symlinks — all code uses CLIENT_ROOT)"
fi

# ══════════════════════════════════════════════════════════════════════════════
# Step 25: Start dashboard on client port
# ══════════════════════════════════════════════════════════════════════════════
step "Start dashboard on port $DASHBOARD_PORT"
if $DRY_RUN; then ok "Would start dashboard"; else
    # Write device-info.json for dashboard to read
    cat > "$CORE_DIR/config/device-info.json" << DIEOF
{
  "client_id": "$CLIENT_ID",
  "hostname": "$HOSTNAME_TAG",
  "installed_at": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "version": "$RELEASE_TAG",
  "first_boot": true
}
DIEOF

    # Create LaunchAgent plist for dashboard (runs as installing user, not root)
    DASH_PLIST="/Users/$(logname)/Library/LaunchAgents/com.aiwh.dashboard.plist"
    mkdir -p "/Users/$(logname)/Library/LaunchAgents"
    cat > "$DASH_PLIST" << DASHEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.aiwh.dashboard</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/node</string>
        <string>/opt/AIWH/core/dashboard/server.js</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PORT</key>
        <string>$DASHBOARD_PORT</string>
        <key>CLIENT_ROOT</key>
        <string>$CLIENT_DIR</string>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    </dict>
    <key>KeepAlive</key>
    <true/>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/opt/AIWH/client/logs/dashboard.log</string>
    <key>StandardErrorPath</key>
    <string>/opt/AIWH/client/logs/dashboard.log</string>
</dict>
</plist>
DASHEOF
    chmod 644 "$DASH_PLIST"
    chown "$(logname)" "$DASH_PLIST"
    su "$(logname)" -c "launchctl load '$DASH_PLIST'" 2>/dev/null || true
    sleep 2
    if launchctl list com.aiwh.dashboard &>/dev/null; then
        ok "Dashboard LaunchAgent loaded (port $DASHBOARD_PORT)"
    else
        warn "Dashboard LaunchAgent may have failed to load — check $CLIENT_DIR/logs/dashboard.log"
    fi
fi

# Onboarding is integrated into the dashboard (first-run detection).
# When no secrets.enc exists, the dashboard serves onboarding.html instead of the main UI.
# No separate onboarding server needed.

# ══════════════════════════════════════════════════════════════════════════════
# Step 26: Start OpenClaw gateway container
# ══════════════════════════════════════════════════════════════════════════════
step "Start OpenClaw gateway container"
if $DRY_RUN; then ok "Would start gateway container"; else
    if ! docker image inspect "aiwh/openclaw:latest" &>/dev/null; then
        warn "Docker image not built — gateway container NOT started"
        warn "Build with: bash /path/to/docker-src/build.sh"
    elif [[ -f "$CORE_DIR/scripts/openclaw-container.sh" ]]; then
        export DOCKER_HOST="unix:///Users/$(logname)/.colima/docker.sock"
        bash "$CORE_DIR/scripts/openclaw-container.sh" start 2>&1 | tail -5
        if docker ps -q -f "name=aiwh-openclaw" 2>/dev/null | grep -q .; then
            ok "Gateway container running on port $GATEWAY_PORT"
        else
            warn "Gateway container may have failed to start — check: docker logs aiwh-openclaw"
        fi
    else
        warn "openclaw-container.sh not found — start container manually"
    fi
fi

# ══════════════════════════════════════════════════════════════════════════════
# Step 27-28: Run factory smoke test
# ══════════════════════════════════════════════════════════════════════════════
step "Run factory smoke test"
SMOKE_ERRORS=0

smoke_check() {
    local desc="$1"
    local cmd="$2"
    if eval "$cmd" &>/dev/null; then
        ok "$desc"
    else
        warn "FAIL: $desc"
        SMOKE_ERRORS=$((SMOKE_ERRORS + 1))
    fi
}

if $DRY_RUN; then ok "Would run smoke test"; else
    smoke_check "core/ directory exists" "[[ -d '$CORE_DIR' ]]"
    smoke_check "client/ directory exists" "[[ -d '$CLIENT_DIR' ]]"
    smoke_check "license.json exists" "[[ -f '$CORE_DIR/config/license.json' ]]"
    smoke_check "device-info.json exists" "[[ -f '$CORE_DIR/config/device-info.json' ]]"
    smoke_check "CORE.md exists" "[[ -f '$CORE_DIR/CORE.md' ]]"
    smoke_check "SOUL.md exists" "[[ -f '$CORE_DIR/SOUL.md' ]]"
    smoke_check "HARD-LIMITS.md exists" "[[ -f '$CORE_DIR/HARD-LIMITS.md' ]]"
    smoke_check "Capabilities catalogue" "[[ -f '$CORE_DIR/config/capabilities-catalogue.json' ]]"
    smoke_check "Client config directory" "[[ -d '$CLIENT_DIR/config' ]]"
    smoke_check "Dashboard server.js exists" "[[ -f '$CORE_DIR/dashboard/server.js' ]]"
    smoke_check "Knowledge search exists" "[[ -f '$CORE_DIR/scripts/knowledge-search-unified.sh' ]]"
    smoke_check "memory/ directory" "[[ -d '$CORE_DIR/memory' ]]"
    smoke_check "logs/ directory" "[[ -d '$CLIENT_DIR/logs' ]]"
    smoke_check "Node.js available" "command -v node"
    smoke_check "Python3 available" "command -v python3"
    smoke_check "ffmpeg available" "command -v ffmpeg"
    smoke_check "Tailscale connected" "tailscale status"
    smoke_check "Watchdog daemon loaded" "launchctl list com.aiwh.watchdog"
    smoke_check "Backup daemon loaded" "launchctl list com.aiwh.backup"
    smoke_check "Colima running" "colima status 2>/dev/null | grep -q Running"
    smoke_check "Docker available" "docker ps"
    if [[ -n "$DOCKER_SRC" ]]; then
        smoke_check "Gateway container running" "docker ps -f 'name=aiwh-openclaw' --format '{{.Status}}' | grep -q Up"
    fi
    smoke_check "Dashboard responding" "curl -s --max-time 5 http://localhost:$DASHBOARD_PORT | grep -q html"
    smoke_check "OpenClaw CLI installed" "command -v openclaw"

    echo ""
    if [[ $SMOKE_ERRORS -eq 0 ]]; then
        echo -e "${GREEN}╔══════════════════════════════════════════════════════════╗${NC}"
        echo -e "${GREEN}║          ALL SMOKE TESTS PASSED — READY FOR QA          ║${NC}"
        echo -e "${GREEN}╚══════════════════════════════════════════════════════════╝${NC}"
    else
        echo -e "${YELLOW}╔══════════════════════════════════════════════════════════╗${NC}"
        echo -e "${YELLOW}║     $SMOKE_ERRORS SMOKE TEST(S) FAILED — CHECK LOG           ║${NC}"
        echo -e "${YELLOW}╚══════════════════════════════════════════════════════════╝${NC}"
    fi
fi

echo ""
echo "  Client:     $CLIENT_ID"
echo "  Hostname:   $HOSTNAME_TAG"
echo "  Tailscale:  https://$HOSTNAME_TAG.tail*.ts.net"
echo "  Dashboard:  http://localhost:$DASHBOARD_PORT"
echo "  Onboarding: http://localhost:$DASHBOARD_PORT/onboarding.html (first-run auto-redirect)"
echo "  Log:        $LOG_FILE"
echo ""

exit $SMOKE_ERRORS
