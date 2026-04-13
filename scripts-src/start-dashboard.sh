#!/bin/bash
# Start the AI Wealth Hub Dashboard
source /opt/AIWH/core/scripts/lib/env.sh

set -e

DASHBOARD_DIR="/opt/AIWH/core/dashboard"
PORT="${DASHBOARD_PORT:-7001}"
WORKSPACE_DIR="${WORKSPACE_DIR:-/opt/AIWH/core}"

echo "🚀 Starting AI Wealth Hub Dashboard..."
echo "   Port: $PORT"
echo "   Workspace: $WORKSPACE_DIR"
echo "   URL: http://localhost:$PORT"

cd "$DASHBOARD_DIR"
export DASHBOARD_PORT=$PORT
export WORKSPACE_DIR=$WORKSPACE_DIR
export OPENCLAW_WORKSPACE=$WORKSPACE_DIR

node server.js
