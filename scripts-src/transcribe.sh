#!/bin/bash
# Transcribe audio to text via local Whisper (whisper.cpp server on port 8178)
# Usage: transcribe.sh <audio-file> [output-file]
# Supports: ogg, webm, mp3, wav, m4a
# Falls back to whisper CLI if server is not running

set -euo pipefail
source "$(dirname "$0")/lib/env.sh" 2>/dev/null || true

AUDIO_FILE="${1:?Usage: transcribe.sh <audio-file> [output-file]}"
OUTPUT_FILE="${2:-}"
WHISPER_PORT="${WHISPER_PORT:-8178}"
WHISPER_URL="http://127.0.0.1:${WHISPER_PORT}/inference"

if [ ! -f "$AUDIO_FILE" ]; then
  echo "Error: File not found: $AUDIO_FILE" >&2
  exit 1
fi

# Try whisper.cpp HTTP server first (fastest)
if curl -sf "http://127.0.0.1:${WHISPER_PORT}/" >/dev/null 2>&1; then
  RESULT=$(curl -sf -X POST "$WHISPER_URL" \
    -F "file=@${AUDIO_FILE}" \
    -F "response_format=text" \
    -F "temperature=0.0" 2>&1)

  if [ $? -eq 0 ] && [ -n "$RESULT" ]; then
    if [ -n "$OUTPUT_FILE" ]; then
      echo "$RESULT" > "$OUTPUT_FILE"
      echo "Transcription saved to: $OUTPUT_FILE"
    else
      echo "$RESULT"
    fi
    exit 0
  fi
fi

# Fallback: whisper CLI (Python, slower but reliable)
if command -v whisper >/dev/null 2>&1; then
  TMPDIR=$(mktemp -d)
  whisper "$AUDIO_FILE" --model turbo --output_format txt --output_dir "$TMPDIR" 2>/dev/null
  TXT_FILE=$(find "$TMPDIR" -name "*.txt" | head -1)
  if [ -n "$TXT_FILE" ] && [ -f "$TXT_FILE" ]; then
    RESULT=$(cat "$TXT_FILE")
    rm -rf "$TMPDIR"
    if [ -n "$OUTPUT_FILE" ]; then
      echo "$RESULT" > "$OUTPUT_FILE"
      echo "Transcription saved to: $OUTPUT_FILE"
    else
      echo "$RESULT"
    fi
    exit 0
  fi
  rm -rf "$TMPDIR"
fi

echo "Error: No Whisper backend available. Start the server: /opt/AIWH/core/scripts/start-whisper-server.sh" >&2
exit 1
