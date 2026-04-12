#!/bin/bash
# Build the AIWH OpenClaw container image
# dist/ is mounted at runtime — this image provides Linux-native node_modules
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
IMAGE_NAME="aiwh/openclaw"
IMAGE_TAG="latest"

OPENCLAW_DIST="/opt/homebrew/lib/node_modules/openclaw"
if [[ ! -f "$OPENCLAW_DIST/package.json" ]]; then
    echo "[build] ERROR: OpenClaw not found at $OPENCLAW_DIST"
    exit 1
fi

echo "[build] Preparing build context..."
BUILD_DIR=$(mktemp -d)
trap "rm -rf $BUILD_DIR" EXIT

cp "$SCRIPT_DIR/Dockerfile" "$BUILD_DIR/"
cp "$SCRIPT_DIR/entrypoint.sh" "$BUILD_DIR/"
cp "$SCRIPT_DIR/landlock-guard.c" "$BUILD_DIR/"
cp "$OPENCLAW_DIST/package.json" "$BUILD_DIR/openclaw-package.json"

echo "[build] Build context: $(du -sh "$BUILD_DIR" | cut -f1)"
echo "[build] Building image (npm install inside container — Linux ARM64 native)..."

export DOCKER_HOST="${DOCKER_HOST:-unix:///Users/roboai/.colima/docker.sock}"
docker build --platform linux/arm64 -t "$IMAGE_NAME:$IMAGE_TAG" "$BUILD_DIR"

echo "[build] Image built: $IMAGE_NAME:$IMAGE_TAG"
docker images "$IMAGE_NAME" --format "  Size: {{.Size}}  Created: {{.CreatedAt}}"
echo "[build] Done."
