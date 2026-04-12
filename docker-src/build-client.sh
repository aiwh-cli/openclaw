#!/bin/bash
# Build self-contained AIWH client image for amd64 (Windows/Intel)
# Does NOT modify any existing files or images
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
IMAGE_NAME="aiwh/openclaw"
PLATFORM="${1:-linux/arm64}"
ARCH_SHORT=$(echo "$PLATFORM" | sed 's|linux/||;s|/|-|g')
IMAGE_TAG="client-${ARCH_SHORT}"

OPENCLAW_DIST="/opt/homebrew/lib/node_modules/openclaw"
AIWH_ROOT="/opt/AIWH"

if [[ ! -f "$OPENCLAW_DIST/package.json" ]]; then
    echo "[build-client] ERROR: OpenClaw not found at $OPENCLAW_DIST"
    exit 1
fi

echo "[build-client] Preparing build context for $PLATFORM..."
BUILD_DIR=$(mktemp -d)
trap "rm -rf $BUILD_DIR" EXIT

# Dockerfile + entrypoint
cp "$SCRIPT_DIR/Dockerfile.client" "$BUILD_DIR/Dockerfile"
cp "$SCRIPT_DIR/entrypoint.sh" "$BUILD_DIR/"

# OpenClaw package.json (for npm install inside container)
cp "$OPENCLAW_DIST/package.json" "$BUILD_DIR/openclaw-package.json"

# OpenClaw dist (the compiled runtime)
echo "[build-client] Copying entire OpenClaw installation..."
rsync -a \
    --exclude='node_modules' \
    --exclude='test' \
    --exclude='test-fixtures' \
    --exclude='src' \
    --exclude='ui' \
    --exclude='git-hooks' \
    --exclude='changelog' \
    --exclude='.git' \
    "$OPENCLAW_DIST/" "$BUILD_DIR/openclaw-full/"

# AIWH core (product code)
echo "[build-client] Copying AIWH core..."
mkdir -p "$BUILD_DIR/aiwh-core"
# Copy only what's needed — skip large/unnecessary dirs
for dir in agents scripts modules docs docker memory config; do
    if [[ -d "$AIWH_ROOT/core/$dir" ]]; then
        cp -r "$AIWH_ROOT/core/$dir" "$BUILD_DIR/aiwh-core/"
    fi
done

# Build dashboard (IP protection — Theme U: per-file minification)
echo "[build-client] Building dashboard (minifying JS/CSS)..."
cd "$AIWH_ROOT/openclaw" && pnpm ui:build:aiwh

# Copy dashboard (exclude node_modules, dev artifacts)
echo "[build-client] Copying dashboard..."
rsync -a --exclude='node_modules' --exclude='wcc-app/node_modules' --exclude='mission-control.db' \
    --exclude='mission-control.db-shm' --exclude='mission-control.db-wal' \
    --exclude='dashboard.db' --exclude='dashboard.db-shm' --exclude='dashboard.db-wal' \
    --exclude='dashboard.log' \
    "$AIWH_ROOT/core/dashboard/" "$BUILD_DIR/aiwh-core/dashboard/"

# Verify JS is minified (not raw source) — minified files have 0-1 lines
APP_LINES=$(wc -l < "$BUILD_DIR/aiwh-core/dashboard/public/app.js" 2>/dev/null || echo "0")
if [ "$APP_LINES" -eq 0 ] || [ "$APP_LINES" -le 10 ]; then
    echo "[build-client] IP protection verified — JS is minified ($APP_LINES lines)"
else
    echo "[build-client] WARNING: app.js appears unminified ($APP_LINES lines) — IP leak risk!"
    exit 1
fi
if [ -d "$BUILD_DIR/aiwh-core/dashboard/src" ]; then
    echo "[build-client] WARNING: src/ directory found in build — IP leak risk!"
    exit 1
fi

# Sanitize dashboard.config.json for client (strip gateway token + AIWH-specific config)
python3 -c "
import json
with open('$BUILD_DIR/aiwh-core/dashboard/dashboard.config.json', 'r') as f:
    cfg = json.load(f)
cfg['mode'] = 'client'
cfg['clientId'] = ''
cfg['branding']['subtitle'] = ''
cfg['gateway']['token'] = ''
cfg['subscriptions'] = []
with open('$BUILD_DIR/aiwh-core/dashboard/dashboard.config.json', 'w') as f:
    json.dump(cfg, f, indent=2)
print('[build-client] Dashboard config sanitized')
"
# Copy root-level core files
for f in SOUL.md CORE.md IDENTITY.md BOOTSTRAP.md HARD-LIMITS.md \
         AGENTS.md TOOLS.md HEARTBEAT.md USER.md CONTEXT.md MEMORY.md \
         AGENTS-MANIFEST.md DEPENDENCIES.md agents-config.json models.json; do
    if [[ -f "$AIWH_ROOT/core/$f" ]]; then
        cp "$AIWH_ROOT/core/$f" "$BUILD_DIR/aiwh-core/"
    fi
done

# OpenClaw state/config (sanitized — no secrets)
echo "[build-client] Sanitizing OpenClaw config (stripping all secrets)..."
mkdir -p "$BUILD_DIR/openclaw-state"
if [[ -f "$AIWH_ROOT/.openclaw/openclaw.json" ]]; then
    # Copy then strip ALL secrets, tokens, and user-specific IDs
    python3 -c "
import json, sys

with open('$AIWH_ROOT/.openclaw/openclaw.json', 'r') as f:
    cfg = json.load(f)

# Strip ALL channels and plugins (client configures via onboarding)
cfg['channels'] = {}
cfg['plugins'] = {}

# Gateway: bind to LAN (Docker needs this), strip auth token, allow any origin
gw = cfg.get('gateway', {})
gw['bind'] = 'lan'
if 'auth' in gw:
    gw['auth']['token'] = ''
gw.setdefault('controlUi', {})['allowedOrigins'] = ['*']
cfg['gateway'] = gw

# Ollama: set baseUrl to reach host from inside container
auth = cfg.get('authProfiles', cfg.get('auth', {}))
if isinstance(auth, dict):
    for key, profile in auth.items():
        if isinstance(profile, dict) and profile.get('provider') == 'ollama':
            profile['baseUrl'] = 'http://host.docker.internal:11434/v1'
    if 'authProfiles' in cfg:
        cfg['authProfiles'] = auth
    elif 'auth' in cfg:
        cfg['auth'] = auth

with open('$BUILD_DIR/openclaw-state/openclaw.json', 'w') as f:
    json.dump(cfg, f, indent=2)
print('[build-client] Config sanitized — all secrets stripped')
"
fi

# Client directory (templates only — no real client data)
echo "[build-client] Copying client templates..."
mkdir -p "$BUILD_DIR/aiwh-client/config" "$BUILD_DIR/aiwh-client/data" "$BUILD_DIR/aiwh-client/content"
# Copy config templates (these get reset by prepare-for-shipping but we want structure)
for f in client-profile.md content-pillars.json avatar-config.json voice-config.json \
         notifications.json modules.json subscription.json; do
    [[ -f "$AIWH_ROOT/client/config/$f" ]] && cp "$AIWH_ROOT/client/config/$f" "$BUILD_DIR/aiwh-client/config/"
done
# Auth.json — force setupComplete: false for fresh client
echo '{"setupComplete": false}' > "$BUILD_DIR/aiwh-client/config/auth.json"
# Create empty dirs for client data
mkdir -p "$BUILD_DIR/aiwh-client/logs" "$BUILD_DIR/aiwh-client/memory" \
         "$BUILD_DIR/aiwh-client/knowledge" "$BUILD_DIR/aiwh-client/uploads"

echo "[build-client] Build context: $(du -sh "$BUILD_DIR" | cut -f1)"
echo "[build-client] Building image $IMAGE_NAME:$IMAGE_TAG ($PLATFORM)..."
echo "[build-client] This may take a few minutes (cross-compiling + npm install)..."

docker build --platform "$PLATFORM" -t "$IMAGE_NAME:$IMAGE_TAG" "$BUILD_DIR"

echo "[build-client] Image built: $IMAGE_NAME:$IMAGE_TAG"
docker images "$IMAGE_NAME:$IMAGE_TAG" --format "  Size: {{.Size}}  Created: {{.CreatedAt}}"
echo ""
echo "[build-client] To export for transfer:"
echo "  docker save $IMAGE_NAME:$IMAGE_TAG | gzip > aiwh-client.tar.gz"
echo ""
echo "[build-client] Done."
