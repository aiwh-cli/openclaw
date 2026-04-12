#!/bin/bash
# ============================================================================
# AIWH OpenClaw Container Manager
# ============================================================================
# Manages the OpenClaw gateway running inside a Docker container.
# Secrets are decrypted on macOS (Keychain) and injected as env vars.
#
# Usage:
#   openclaw-container.sh start   — Start the container
#   openclaw-container.sh stop    — Stop the container
#   openclaw-container.sh restart — Restart the container
#   openclaw-container.sh status  — Check if running
#   openclaw-container.sh logs    — Tail container logs
# ============================================================================
set -euo pipefail

source /opt/AIWH/core/scripts/lib/env.sh

CONTAINER_NAME="aiwh-openclaw"
IMAGE_NAME="aiwh/openclaw:latest"
GATEWAY_PORT="${OPENCLAW_GATEWAY_PORT:-18789}"
AIWH_ROOT="/opt/AIWH"

# ── Helpers ──────────────────────────────────────────────────────────────────

ensure_colima() {
    if ! colima status 2>/dev/null | grep -q "Running"; then
        echo "[container] Starting Colima..."
        colima start --cpu 2 --memory 3 --disk 30 --runtime docker 2>&1 | tail -3
    fi
}

ensure_image() {
    if ! docker image inspect "$IMAGE_NAME" &>/dev/null; then
        echo "[container] Image not found. Building..."
        /opt/AIWH/core/docker/build.sh
    fi
}

load_secrets_as_env() {
    # Decrypt secrets on macOS, output as docker -e flags
    local env_flags=""

    # Primary: encrypted secrets store
    if [[ -f "$AIWH_SECRETS_FILE" ]] && [[ -f "$AIWH_SECRETS_PY" ]]; then
        local secrets_output
        secrets_output="$(python3 "$AIWH_SECRETS_PY" load --all 2>/dev/null)" || true
        if [[ -n "$secrets_output" ]]; then
            while IFS= read -r line; do
                # Lines are: export KEY='value'
                local key val
                key=$(echo "$line" | sed "s/^export //; s/=.*//")
                val=$(echo "$line" | sed "s/^export [^=]*=//; s/^'//; s/'$//")
                if [[ -n "$key" && -n "$val" ]]; then
                    env_flags="$env_flags -e $key=$val"
                fi
            done <<< "$secrets_output"
            echo "$env_flags"
            return 0
        fi
    fi

    # Fallback: read .env file directly (dev machine)
    if [[ -f "$AIWH_ENV_FILE" ]]; then
        while IFS= read -r line; do
            # Skip comments and empty lines
            [[ "$line" =~ ^#.*$ || -z "$line" ]] && continue
            local key
            key=$(echo "$line" | cut -d= -f1)
            if [[ -n "$key" && ! "$key" =~ [[:space:]] ]]; then
                env_flags="$env_flags -e $line"
            fi
        done < "$AIWH_ENV_FILE"
        echo "$env_flags"
    fi
}

# ── Commands ─────────────────────────────────────────────────────────────────

cmd_start() {
    ensure_colima
    ensure_image

    # Stop existing container if running
    if docker ps -q -f "name=$CONTAINER_NAME" 2>/dev/null | grep -q .; then
        echo "[container] Stopping existing container..."
        docker stop "$CONTAINER_NAME" >/dev/null 2>&1 || true
        docker rm "$CONTAINER_NAME" >/dev/null 2>&1 || true
    fi
    docker rm "$CONTAINER_NAME" >/dev/null 2>&1 || true

    echo "[container] Loading secrets..."
    local env_flags
    env_flags=$(load_secrets_as_env)

    echo "[container] Starting OpenClaw gateway in container..."
    # shellcheck disable=SC2086
    docker run -d \
        --name "$CONTAINER_NAME" \
        --restart unless-stopped \
        --memory=4g \
        --cpus=2 \
        --pids-limit=256 \
        -p "${GATEWAY_PORT}:${GATEWAY_PORT}" \
        # ── core/ granular mounts (Docker-enforced security) ──────────
        # Agents CAN write: their own workspaces, memory, logs, content, knowledge
        -v "${AIWH_ROOT}/core/modules:/opt/AIWH/core/modules:rw" \
        -v "${AIWH_ROOT}/core/memory:/opt/AIWH/core/memory:rw" \
        -v "${AIWH_ROOT}/core/logs:/opt/AIWH/core/logs:rw" \
        -v "${AIWH_ROOT}/core/content:/opt/AIWH/core/content:rw" \
        -v "${AIWH_ROOT}/core/knowledge:/opt/AIWH/core/knowledge:rw" \
        -v "${AIWH_ROOT}/core/outputs:/opt/AIWH/core/outputs:rw" \
        -v "${AIWH_ROOT}/core/data:/opt/AIWH/core/data:rw" \
        -v "${AIWH_ROOT}/core/tasks:/opt/AIWH/core/tasks:rw" \
        # Agents CAN read + write: docs (generate reports)
        -v "${AIWH_ROOT}/core/docs:/opt/AIWH/core/docs:rw" \
        # Agents CAN read only: scripts, config (includes product skills), assets, templates
        -v "${AIWH_ROOT}/core/scripts:/opt/AIWH/core/scripts:ro" \
        -v "${AIWH_ROOT}/core/config:/opt/AIWH/core/config:ro" \
        -v "${AIWH_ROOT}/core/assets:/opt/AIWH/core/assets:ro" \
        -v "${AIWH_ROOT}/core/task-templates:/opt/AIWH/core/task-templates:ro" \
        # Agents CANNOT touch: dashboard, docker, onboarding, migrations (infrastructure)
        -v "${AIWH_ROOT}/core/dashboard:/opt/AIWH/core/dashboard:ro" \
        -v "${AIWH_ROOT}/core/docker:/opt/AIWH/core/docker:ro" \
        -v "${AIWH_ROOT}/core/onboarding:/opt/AIWH/core/onboarding:ro" \
        -v "${AIWH_ROOT}/core/migrations:/opt/AIWH/core/migrations:ro" \
        # Client data — full read/write
        -v "${AIWH_ROOT}/client:/opt/AIWH/client:rw" \
        # OpenClaw state — sessions, crons, agent config
        -v "${AIWH_ROOT}/.openclaw:/opt/AIWH/.openclaw:rw" \
        -v "/opt/homebrew/lib/node_modules/openclaw/dist:/opt/openclaw/dist:ro" \
        -v "/opt/homebrew/lib/node_modules/openclaw/docs:/opt/openclaw/docs:ro" \
        -v "/opt/homebrew/lib/node_modules/openclaw/extensions:/opt/openclaw/extensions:ro" \
        -v "/opt/homebrew/lib/node_modules/openclaw/skills:/opt/openclaw/skills:ro" \
        -v "/opt/homebrew/lib/node_modules/openclaw/packages:/opt/openclaw/packages:ro" \
        -e "OPENCLAW_STATE_DIR=/opt/AIWH/.openclaw" \
        -e "OPENCLAW_GATEWAY_PORT=${GATEWAY_PORT}" \
        -e "CLIENT_ROOT=/opt/AIWH/client" \
        -e "NODE_ENV=production" \
        $env_flags \
        "$IMAGE_NAME" \
        gateway \
        2>&1

    # Wait for volume mounts + gateway to be ready
    echo "[container] Waiting for volumes and gateway..."
    local attempts=0
    while [[ $attempts -lt 30 ]]; do
        # First verify critical volume mounts are available
        if docker exec "$CONTAINER_NAME" test -f /opt/openclaw/docs/reference/templates/AGENTS.md 2>/dev/null \
           && docker exec "$CONTAINER_NAME" test -f /opt/AIWH/.openclaw/openclaw.json 2>/dev/null; then
            if docker logs "$CONTAINER_NAME" 2>&1 | grep -q "Gateway is ready\|listening on"; then
                echo "[container] OpenClaw gateway running on port ${GATEWAY_PORT}"
                return 0
            fi
        fi
        sleep 2
        attempts=$((attempts + 1))
    done

    echo "[container] Gateway may still be starting. Check: docker logs $CONTAINER_NAME"
}

cmd_stop() {
    echo "[container] Stopping OpenClaw container..."
    docker stop "$CONTAINER_NAME" 2>/dev/null || echo "[container] Not running"
    docker rm "$CONTAINER_NAME" 2>/dev/null || true
    echo "[container] Stopped."
}

cmd_restart() {
    cmd_stop
    cmd_start
}

cmd_status() {
    if docker ps -f "name=$CONTAINER_NAME" --format "{{.Status}}" 2>/dev/null | grep -q "Up"; then
        local status
        status=$(docker ps -f "name=$CONTAINER_NAME" --format "{{.Status}}")
        echo "[container] Running — $status"
        docker stats --no-stream --format "  CPU: {{.CPUPerc}}  MEM: {{.MemUsage}}" "$CONTAINER_NAME" 2>/dev/null
        return 0
    else
        echo "[container] Not running"
        return 1
    fi
}

cmd_logs() {
    docker logs -f --tail 50 "$CONTAINER_NAME" 2>&1
}

# ── Main ─────────────────────────────────────────────────────────────────────

case "${1:-help}" in
    start)   cmd_start ;;
    stop)    cmd_stop ;;
    restart) cmd_restart ;;
    status)  cmd_status ;;
    logs)    cmd_logs ;;
    *)
        echo "Usage: $0 {start|stop|restart|status|logs}"
        exit 1
        ;;
esac
