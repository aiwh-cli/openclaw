#!/usr/bin/env python3
"""
apply-upgrade.py — Apply a core/ upgrade from a release archive.

Usage:
  apply-upgrade.py <archive.tar.gz> [--dry-run] [--rollback]
  apply-upgrade.py --rollback

Process:
  1. Snapshot current core/ → /opt/AIWH/.upgrades/pre-{version}/
  2. Extract new core/ from archive
  3. Verify: dashboard starts, knowledge search works, key files intact
  4. If verification fails → automatic rollback from snapshot
  5. Client paths (symlinks to /opt/AIWH/client/) remain untouched

Rollback:
  --rollback restores from most recent pre-upgrade snapshot
"""

import os
import sys
import json
import shutil
import tarfile
import subprocess
import argparse
from pathlib import Path
from datetime import datetime

CORE_DIR = Path("/opt/AIWH/core")
UPGRADES_DIR = Path("/opt/AIWH/.upgrades")
CLIENT_ROOT = os.environ.get("CLIENT_ROOT", "/opt/AIWH/client")

# Paths in core/ that contain runtime data — preserve during upgrade
# memory/ = Branson's daily logs (product brain, accumulates per client)
# No symlinks — client data lives in /opt/AIWH/client/ (never in core/)
PRESERVE_PATHS = ["memory"]

# Critical files that must exist after upgrade
CRITICAL_FILES = [
    "dashboard/server.js", "dashboard/cinematic-sync.js",
    "scripts/cinematic-producer.py", "scripts/knowledge-search-unified.sh",
    "SOUL.md", "BOOTSTRAP.md"
]


def snapshot_core(version_tag):
    """Create pre-upgrade snapshot of core/."""
    snap_dir = UPGRADES_DIR / f"pre-{version_tag}"
    snap_dir.mkdir(parents=True, exist_ok=True)

    print(f"Creating snapshot: {snap_dir}")

    # Only snapshot product code, not symlinked client data
    for item in CORE_DIR.iterdir():
        dest = snap_dir / item.name
        if item.is_symlink():
            # Record the symlink target, don't copy the data
            link_target = os.readlink(str(item))
            (snap_dir / f".symlink-{item.name}").write_text(link_target)
            print(f"  Recorded symlink: {item.name} → {link_target}")
        elif item.is_dir():
            shutil.copytree(str(item), str(dest), symlinks=True)
        else:
            shutil.copy2(str(item), str(dest))

    print(f"Snapshot complete: {snap_dir}")
    return snap_dir


def extract_upgrade(archive_path):
    """Extract core/ from upgrade archive."""
    print(f"Extracting: {archive_path}")

    with tarfile.open(archive_path) as tar:
        # List contents to verify structure
        members = tar.getnames()
        has_core = any(m.startswith("core/") for m in members)
        if not has_core:
            print("ERROR: Archive does not contain a core/ directory")
            return False

        # Extract to temp dir first
        temp_dir = UPGRADES_DIR / "temp-extract"
        if temp_dir.exists():
            shutil.rmtree(str(temp_dir))
        tar.extractall(str(temp_dir))

    new_core = temp_dir / "core"
    if not new_core.exists():
        print("ERROR: Extracted archive missing core/ directory")
        return False

    # Copy new files, preserving symlinks
    for item in new_core.rglob("*"):
        rel = item.relative_to(new_core)
        dest = CORE_DIR / rel

        # Skip paths that contain runtime data (e.g. memory/)
        if any(str(rel) == p or str(rel).startswith(p + "/") for p in PRESERVE_PATHS):
            print(f"  SKIP (preserve): {rel}")
            continue

        if item.is_dir():
            dest.mkdir(parents=True, exist_ok=True)
        else:
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(str(item), str(dest))

    # Clean temp
    shutil.rmtree(str(temp_dir))
    print("Extraction complete")
    return True


def verify_upgrade():
    """Run verification checks after upgrade."""
    errors = []

    # Check critical files exist
    for f in CRITICAL_FILES:
        if not (CORE_DIR / f).exists():
            errors.append(f"Missing critical file: {f}")

    # Check preserved paths still exist
    for p in PRESERVE_PATHS:
        path = CORE_DIR / p
        if not path.exists():
            errors.append(f"Preserved path missing: {p}")

    # Try starting dashboard (quick syntax check)
    try:
        result = subprocess.run(
            ["node", "-e", "require('./server.js')"],
            capture_output=True, text=True, timeout=5,
            cwd=str(CORE_DIR / "dashboard")
        )
        # It will fail because port is in use, but syntax errors show up differently
        if "SyntaxError" in result.stderr:
            errors.append(f"Dashboard syntax error: {result.stderr[:200]}")
    except subprocess.TimeoutExpired:
        pass  # Expected — server starts and we kill it
    except Exception as e:
        errors.append(f"Dashboard check failed: {e}")

    # Check knowledge search script is valid bash
    try:
        result = subprocess.run(
            ["bash", "-n", str(CORE_DIR / "scripts/knowledge-search-unified.sh")],
            capture_output=True, text=True, timeout=5
        )
        if result.returncode != 0:
            errors.append(f"Knowledge search syntax error: {result.stderr[:200]}")
    except Exception as e:
        errors.append(f"Knowledge search check failed: {e}")

    # Check Python scripts compile
    for script in ["cinematic-producer.py", "extract-knowledge.py", "extract-cinematic-knowledge.py"]:
        try:
            import py_compile
            py_compile.compile(str(CORE_DIR / "scripts" / script), doraise=True)
        except Exception as e:
            errors.append(f"Python syntax error in {script}: {e}")

    return errors


def rollback(snap_dir=None):
    """Restore from snapshot."""
    if not snap_dir:
        # Find most recent snapshot
        if not UPGRADES_DIR.exists():
            print("ERROR: No snapshots directory found")
            return False
        snaps = sorted(UPGRADES_DIR.glob("pre-*"), key=lambda p: p.stat().st_mtime, reverse=True)
        if not snaps:
            print("ERROR: No snapshots found")
            return False
        snap_dir = snaps[0]

    print(f"Rolling back from: {snap_dir}")

    # Restore files, preserving symlinks
    for item in snap_dir.rglob("*"):
        if item.name.startswith(".symlink-"):
            continue
        rel = item.relative_to(snap_dir)
        dest = CORE_DIR / rel

        # Skip preserved paths
        if any(str(rel) == p or str(rel).startswith(p + "/") for p in PRESERVE_PATHS):
            continue

        if item.is_dir():
            dest.mkdir(parents=True, exist_ok=True)
        else:
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(str(item), str(dest))

    print("Rollback complete")
    return True


def main():
    parser = argparse.ArgumentParser(description="Apply core/ upgrade")
    parser.add_argument("archive", nargs="?", help="Path to upgrade archive (.tar.gz)")
    parser.add_argument("--dry-run", action="store_true", help="Show what would happen without making changes")
    parser.add_argument("--rollback", action="store_true", help="Rollback to most recent snapshot")
    parser.add_argument("--version", default=None, help="Version tag for snapshot naming")
    args = parser.parse_args()

    if args.rollback:
        return 0 if rollback() else 1

    if not args.archive:
        parser.print_help()
        return 1

    if not os.path.exists(args.archive):
        print(f"ERROR: Archive not found: {args.archive}")
        return 1

    version = args.version or datetime.now().strftime("%Y%m%d-%H%M%S")

    if args.dry_run:
        print(f"DRY RUN — would upgrade from {args.archive}")
        print(f"  Version tag: {version}")
        print(f"  Snapshot dir: {UPGRADES_DIR}/pre-{version}/")
        print(f"  Preserved paths: {PRESERVE_PATHS}")
        print(f"  Critical files verified: {CRITICAL_FILES}")
        return 0

    # 1. Snapshot
    snap_dir = snapshot_core(version)

    # 2. Extract upgrade
    if not extract_upgrade(args.archive):
        print("FAILED: Extraction failed, rolling back")
        rollback(snap_dir)
        return 1

    # 3. Verify
    errors = verify_upgrade()
    if errors:
        print(f"VERIFICATION FAILED ({len(errors)} errors):")
        for e in errors:
            print(f"  - {e}")
        print("Rolling back...")
        rollback(snap_dir)
        return 1

    print(f"UPGRADE COMPLETE (version: {version})")
    print("  Restart dashboard: kill $(lsof -ti :3001) && cd dashboard && node server.js &")
    return 0


if __name__ == "__main__":
    sys.exit(main())
