#!/bin/bash
# Start whisper.cpp HTTP server for local speech-to-text
# Model: large-v3-turbo (1.5GB, best accuracy on Apple Silicon)
# Port: 8178 (avoids conflicts with gateway 18789, dashboard 3001)
exec /opt/homebrew/bin/whisper-server \
  --model /opt/AIWH/core/models/ggml-large-v3-turbo.bin \
  --host 127.0.0.1 \
  --port 8178 \
  --threads 4 \
  --convert \
  --tmp-dir /tmp
