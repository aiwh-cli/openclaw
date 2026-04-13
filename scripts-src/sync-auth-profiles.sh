#!/usr/bin/env bash
# sync-auth-profiles.sh — Symlink all per-agent auth-profiles.json to one shared canonical file.
# Canonical source: main agent's auth-profiles.json
# All other agents get symlinks so credentials are stored once, shared everywhere.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib/env.sh"

OPENCLAW_STATE="${OPENCLAW_STATE_DIR:-/opt/AIWH/.openclaw}"
CANONICAL="$OPENCLAW_STATE/agents/main/agent/auth-profiles.json"

if [[ ! -f "$CANONICAL" ]]; then
  echo "ERROR: Canonical auth-profiles not found at $CANONICAL" >&2
  exit 1
fi

linked=0
skipped=0

for agent_dir in "$OPENCLAW_STATE"/agents/*/agent; do
  [[ -d "$agent_dir" ]] || continue

  # Skip the canonical source (main agent)
  agent_id="$(basename "$(dirname "$agent_dir")")"
  [[ "$agent_id" == "main" ]] && continue

  target="$agent_dir/auth-profiles.json"

  # Already symlinked to canonical — skip
  if [[ -L "$target" ]]; then
    link_dest="$(readlink "$target")"
    if [[ "$link_dest" == "$CANONICAL" ]]; then
      skipped=$((skipped + 1))
      continue
    fi
  fi

  # Back up existing regular file (once only)
  if [[ -f "$target" && ! -L "$target" && ! -f "$target.bak" ]]; then
    cp "$target" "$target.bak"
  fi

  # Remove existing file/symlink and create symlink to canonical
  rm -f "$target"
  ln -s "$CANONICAL" "$target"
  linked=$((linked + 1))
done

echo "sync-auth-profiles: $linked linked, $skipped already OK (canonical: $CANONICAL)"
