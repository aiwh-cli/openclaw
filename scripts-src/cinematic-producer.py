#!/usr/bin/env python3
"""
Cinematic Video Producer -- orchestrates the multi-phase cinematic pipeline.

Usage:
  cinematic-producer.py create <title> --brief <text> [--duration 120] [--clips 10] [--bgm <path>]
  cinematic-producer.py run <cjob_id>           # Advance job to next phase
  cinematic-producer.py run-pending             # Advance all non-review jobs
  cinematic-producer.py review <cjob_id> <asset_id> --grade <1-5> [--action approve|reject|regen] [--notes "..."]
  cinematic-producer.py approve-phase <cjob_id> [--grade <1-5>] [--notes "..."]
  cinematic-producer.py retry-failed <cjob_id>   # Re-generate only failed assets
  cinematic-producer.py status <cjob_id>
  cinematic-producer.py list [--phase <phase>]

Provider-agnostic pipeline supporting pluggable providers for:
  video (Veo), image (Imagen), avatar (HeyGen), tts (ElevenLabs),
  storage (GDrive), notify (Discord).

Configure providers via $CLIENT_ROOT/config/cinematic-providers.json.
"""

import os
import sys

# ── Path setup ───────────────────────────────────────────────────
# Add lib/ to sys.path so 'cinematic' and 'llm_provider' are importable
_lib_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib')
if _lib_dir not in sys.path:
    sys.path.insert(0, _lib_dir)

# ── Import CLI handlers ─────────────────────────────────────────
from cinematic.cli import (  # noqa: E402
    cmd_create, cmd_run, cmd_run_pending, cmd_review,
    cmd_approve_phase, cmd_retry_failed, cmd_status, cmd_list,
)

# ── Command dispatch ─────────────────────────────────────────────

COMMANDS = {
    'create': cmd_create,
    'run': cmd_run,
    'run-pending': cmd_run_pending,
    'review': cmd_review,
    'approve-phase': cmd_approve_phase,
    'retry-failed': cmd_retry_failed,
    'status': cmd_status,
    'list': cmd_list,
}


def main():
    if len(sys.argv) < 2 or sys.argv[1] in ('--help', '-h', 'help'):
        print(__doc__)
        sys.exit(0 if sys.argv[1:] and sys.argv[1] in ('--help', '-h', 'help') else 1)

    cmd = sys.argv[1]
    args = sys.argv[2:]

    if cmd in COMMANDS:
        print(f"=== [Cinematic Producer] {cmd} {' '.join(args)} ===")
        COMMANDS[cmd](args)
    else:
        print(f"Unknown command: {cmd}")
        print(__doc__)
        sys.exit(1)


if __name__ == '__main__':
    main()
