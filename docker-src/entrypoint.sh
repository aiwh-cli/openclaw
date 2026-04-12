#!/bin/bash
# Entrypoint for AIWH client container
# Starts dashboard (port 3001) + OpenClaw gateway (port 18789)
# Watches for onboarding completion → restarts gateway with new API keys

STATE_DIR="${OPENCLAW_STATE_DIR:-/opt/AIWH/.openclaw}"
AUTH_FILE="${CLIENT_ROOT:-/opt/AIWH/client}/config/auth.json"
SECRETS_ENC="${CLIENT_ROOT:-/opt/AIWH/client}/config/secrets.enc"
GUARD="/opt/AIWH/bin/landlock-guard"

# Load API keys from encrypted store
load_secrets() {
    if [ -f "/opt/AIWH/core/scripts/lib/env.sh" ]; then
        source /opt/AIWH/core/scripts/lib/env.sh
        eval "$(aiwh_load_secrets --all 2>/dev/null)" && echo "[entrypoint] Loaded secrets from encrypted store"
    fi
}

load_secrets

# Start dashboard in background
echo "[entrypoint] Starting dashboard on port 3001..."
cd /opt/AIWH/core/dashboard && node server.js &
DASHBOARD_PID=$!

# Watch for onboarding completion — restart gateway when .env appears/changes
watch_onboarding() {
    local last_hash=""
    while true; do
        sleep 10
        # Check if onboarding just completed (auth.json has setupComplete: true)
        if [ -f "$AUTH_FILE" ] && grep -q '"setupComplete": true' "$AUTH_FILE" 2>/dev/null; then
            # Check if secrets.enc changed (new keys stored during onboarding)
            if [ -f "$SECRETS_ENC" ]; then
                local cur_hash
                cur_hash=$(md5sum "$SECRETS_ENC" 2>/dev/null | cut -d' ' -f1 || echo "none")
                if [ "$cur_hash" != "$last_hash" ] && [ -n "$last_hash" ]; then
                    echo "[entrypoint] Onboarding complete — restarting gateway with new API keys..."
                    load_secrets
                    kill "$GW_PID" 2>/dev/null
                    sleep 2
                    if [ -x "$GUARD" ]; then
                        "$GUARD" node /opt/openclaw/dist/index.js gateway &
                    else
                        node /opt/openclaw/dist/index.js gateway &
                    fi
                    GW_PID=$!
                    echo "[entrypoint] Gateway restarted (PID $GW_PID)"
                fi
                last_hash="$cur_hash"
            fi
        fi
    done
}

# Start onboarding watcher in background
watch_onboarding &

# Set safe-bash as the shell for agent tool calls (OpenClaw reads $SHELL)
export SHELL="/opt/AIWH/core/scripts/safe-bash.sh"

# Start gateway with kernel-level sandbox (Landlock)
GUARD="/opt/AIWH/bin/landlock-guard"
if [ -x "$GUARD" ]; then
    echo "[entrypoint] Starting OpenClaw gateway with Landlock kernel sandbox..."
    "$GUARD" node /opt/openclaw/dist/index.js "$@" &
    GW_PID=$!
else
    echo "[entrypoint] ⚠️  landlock-guard not found — starting gateway WITHOUT kernel sandbox"
    node /opt/openclaw/dist/index.js "$@" &
    GW_PID=$!
fi

# Wait for gateway to exit (keeps container alive)
wait $GW_PID
