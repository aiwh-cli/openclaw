#!/usr/bin/env python3
"""
AIWH Secrets Manager — AES-256-GCM encrypted secrets with macOS Keychain master key.

Usage:
    python3 secrets.py init                         # Generate master key, store in Keychain
    python3 secrets.py store KEY VALUE              # Encrypt and store a secret
    python3 secrets.py load KEY1 KEY2 ...           # Print export KEY=value lines (for eval)
    python3 secrets.py load --all                   # Load all secrets
    python3 secrets.py migrate /path/to/.env        # Import all key=value pairs from .env
    python3 secrets.py list                         # List stored key names (never values)
    python3 secrets.py delete KEY                   # Remove a secret
    python3 secrets.py verify                       # Test API keys against their services
    python3 secrets.py export /path/to/output.env   # Export all secrets as .env file (for backup)

Secrets are stored in secrets.enc (JSON + AES-256-GCM per-value encryption).
Master key lives in macOS Keychain (service: com.aiwh.secrets).
Each value is encrypted with a derived key via HKDF-SHA256 (unique per secret name).
"""

import json
import os
import subprocess
import sys
import base64

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives import hashes

KEYCHAIN_SERVICE = "com.aiwh.secrets"
KEYCHAIN_ACCOUNT = "master-key"
SECRETS_FILE = os.environ.get("AIWH_SECRETS_FILE",
    os.path.join(os.environ.get("CLIENT_ROOT", "/opt/AIWH/client"), "config", "secrets.enc"))


# ── Master key storage ──────────────────────────────────────────────────────
# macOS: Keychain. Linux/Docker: file-based fallback at $CLIENT_ROOT/config/.master-key

MASTER_KEY_FILE = os.path.join(os.path.dirname(SECRETS_FILE), ".master-key")

def _has_keychain():
    """Check if macOS Keychain CLI is available."""
    try:
        subprocess.run(["security", "help"], capture_output=True, timeout=2)
        return True
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False

def keychain_store(key_bytes: bytes):
    """Store master key (Keychain on macOS, file on Linux)."""
    encoded = base64.b64encode(key_bytes).decode()
    if _has_keychain():
        subprocess.run(
            ["security", "delete-generic-password", "-s", KEYCHAIN_SERVICE, "-a", KEYCHAIN_ACCOUNT],
            capture_output=True
        )
        result = subprocess.run(
            ["security", "add-generic-password",
             "-s", KEYCHAIN_SERVICE, "-a", KEYCHAIN_ACCOUNT,
             "-w", encoded, "-U"],
            capture_output=True, text=True
        )
        if result.returncode != 0:
            raise RuntimeError(f"Failed to store in Keychain: {result.stderr.strip()}")
    else:
        os.makedirs(os.path.dirname(MASTER_KEY_FILE), exist_ok=True)
        with open(MASTER_KEY_FILE, "w") as f:
            f.write(encoded)
        os.chmod(MASTER_KEY_FILE, 0o600)


def keychain_load() -> bytes:
    """Load master key (Keychain on macOS, file on Linux). Auto-init if missing."""
    if _has_keychain():
        result = subprocess.run(
            ["security", "find-generic-password",
             "-s", KEYCHAIN_SERVICE, "-a", KEYCHAIN_ACCOUNT, "-w"],
            capture_output=True, text=True
        )
        if result.returncode != 0:
            raise RuntimeError(
                "Master key not found in Keychain. Run: python3 secrets.py init")
        return base64.b64decode(result.stdout.strip())
    else:
        # File-based fallback — auto-generate if missing
        if not os.path.exists(MASTER_KEY_FILE):
            master = os.urandom(32)
            keychain_store(master)
            return master
        with open(MASTER_KEY_FILE, "r") as f:
            return base64.b64decode(f.read().strip())


# ── Crypto operations ────────────────────────────────────────────────────────

def derive_key(master: bytes, name: str) -> bytes:
    """Derive a per-secret key using HKDF-SHA256."""
    hkdf = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=b"aiwh-secrets-v1",
        info=name.encode("utf-8"),
    )
    return hkdf.derive(master)


def encrypt_value(master: bytes, name: str, value: str) -> dict:
    """Encrypt a value with AES-256-GCM using a derived key."""
    key = derive_key(master, name)
    nonce = os.urandom(12)
    aesgcm = AESGCM(key)
    ct = aesgcm.encrypt(nonce, value.encode("utf-8"), name.encode("utf-8"))
    return {
        "nonce": base64.b64encode(nonce).decode(),
        "ciphertext": base64.b64encode(ct).decode(),
    }


def decrypt_value(master: bytes, name: str, record: dict) -> str:
    """Decrypt a value with AES-256-GCM using a derived key."""
    key = derive_key(master, name)
    nonce = base64.b64decode(record["nonce"])
    ct = base64.b64decode(record["ciphertext"])
    aesgcm = AESGCM(key)
    return aesgcm.decrypt(nonce, ct, name.encode("utf-8")).decode("utf-8")


# ── File operations ──────────────────────────────────────────────────────────

def load_store() -> dict:
    """Load the encrypted secrets store from disk."""
    if not os.path.exists(SECRETS_FILE):
        return {"version": 1, "secrets": {}}
    with open(SECRETS_FILE, "r") as f:
        return json.load(f)


def save_store(store: dict):
    """Save the encrypted secrets store to disk."""
    os.makedirs(os.path.dirname(SECRETS_FILE), exist_ok=True)
    with open(SECRETS_FILE, "w") as f:
        json.dump(store, f, indent=2)
    os.chmod(SECRETS_FILE, 0o600)


# ── Commands ─────────────────────────────────────────────────────────────────

def cmd_init():
    """Generate a new master key and store it in Keychain."""
    # Warn if secrets already exist — new key will make them unreadable
    if os.path.exists(SECRETS_FILE):
        store = load_store()
        count = len(store.get("secrets", {}))
        if count > 0:
            print(f"WARNING: {count} secrets already exist in {SECRETS_FILE}")
            print("Generating a new master key will make them UNREADABLE.")
            resp = input("Type RESET to confirm, or anything else to cancel: ")
            if resp.strip() != "RESET":
                print("Cancelled.")
                return
    master = os.urandom(32)
    keychain_store(master)
    # Create empty store if it doesn't exist
    if not os.path.exists(SECRETS_FILE):
        save_store({"version": 1, "secrets": {}})
    print(f"Master key generated and stored in Keychain ({KEYCHAIN_SERVICE})")
    print(f"Secrets file: {SECRETS_FILE}")


def cmd_store(name: str, value: str):
    """Encrypt and store a single secret."""
    master = keychain_load()
    store = load_store()
    store["secrets"][name] = encrypt_value(master, name, value)
    save_store(store)
    print(f"Stored: {name}")


def cmd_load(keys: list):
    """Print export lines for requested keys (consumed by eval)."""
    master = keychain_load()
    store = load_store()
    secrets = store.get("secrets", {})

    if keys == ["--all"]:
        keys = list(secrets.keys())

    for name in keys:
        if name not in secrets:
            print(f"# WARNING: {name} not found in secrets store", file=sys.stderr)
            continue
        value = decrypt_value(master, name, secrets[name])
        # Shell-safe: single-quote the value, escape embedded single quotes
        safe_value = value.replace("'", "'\\''")
        print(f"export {name}='{safe_value}'")


def cmd_migrate(env_path: str):
    """Import all KEY=VALUE pairs from a .env file into the encrypted store."""
    if not os.path.exists(env_path):
        print(f"Error: {env_path} not found", file=sys.stderr)
        sys.exit(1)

    master = keychain_load()
    store = load_store()
    count = 0
    skipped = 0

    with open(env_path, "r") as f:
        for line in f:
            line = line.strip()
            # Skip comments, empty lines, section headers
            if not line or line.startswith("#") or line.startswith("[") or "=" not in line:
                continue
            # Handle export prefix
            if line.startswith("export "):
                line = line[7:]
            name, _, value = line.partition("=")
            name = name.strip()
            value = value.strip().strip('"').strip("'")
            if not name or not value:
                skipped += 1
                continue
            store["secrets"][name] = encrypt_value(master, name, value)
            count += 1

    save_store(store)
    print(f"Migrated {count} secrets from {env_path}")
    if skipped:
        print(f"Skipped {skipped} empty/invalid entries")


def cmd_list():
    """List all stored secret names (never values)."""
    store = load_store()
    secrets = store.get("secrets", {})
    if not secrets:
        print("No secrets stored")
        return
    for name in sorted(secrets.keys()):
        print(f"  {name}")
    print(f"\n{len(secrets)} secrets stored in {SECRETS_FILE}")


def cmd_delete(name: str):
    """Remove a secret from the store."""
    store = load_store()
    if name not in store.get("secrets", {}):
        print(f"Secret '{name}' not found", file=sys.stderr)
        sys.exit(1)
    del store["secrets"][name]
    save_store(store)
    print(f"Deleted: {name}")


def cmd_export(output_path: str):
    """Export all secrets to a .env file (for backup/migration)."""
    master = keychain_load()
    store = load_store()
    secrets = store.get("secrets", {})

    with open(output_path, "w") as f:
        f.write("# AIWH secrets export — generated by secrets.py\n")
        f.write(f"# {len(secrets)} keys — KEEP THIS FILE SECURE\n\n")
        for name in sorted(secrets.keys()):
            value = decrypt_value(master, name, secrets[name])
            f.write(f'{name}="{value}"\n')
    os.chmod(output_path, 0o600)
    print(f"Exported {len(secrets)} secrets to {output_path}")


def cmd_verify():
    """Test API keys against their services."""
    import urllib.request
    import urllib.error

    master = keychain_load()
    store = load_store()
    secrets = store.get("secrets", {})

    checks = {
        "ANTHROPIC_API_KEY": ("https://api.anthropic.com/v1/messages", "x-api-key", "POST"),
        "OPENAI_API_KEY": ("https://api.openai.com/v1/models", "Authorization", "GET"),
        "ELEVENLABS_API_KEY": ("https://api.elevenlabs.io/v1/user", "xi-api-key", "GET"),
        "HEYGEN_API_KEY": ("https://api.heygen.com/v1/video/list?limit=1", "X-Api-Key", "GET"),
        "SUPABASE_ANON_KEY": (None, None, None),  # needs URL
        "BUFFER_API_TOKEN": ("https://api.buffer.com/graphql", "Authorization", "POST"),
        "BRAVE_API_KEY": ("https://api.search.brave.com/res/v1/web/search?q=test&count=1", "X-Subscription-Token", "GET"),
    }

    for key_name, (url, header_name, method) in checks.items():
        if key_name not in secrets:
            print(f"  ⏭  {key_name} — not in store")
            continue
        if url is None:
            print(f"  ⏭  {key_name} — no auto-verify (check manually)")
            continue

        value = decrypt_value(master, key_name, secrets[key_name])
        try:
            req = urllib.request.Request(url, method=method)
            if header_name == "Authorization":
                req.add_header("Authorization", f"Bearer {value}")
            else:
                req.add_header(header_name, value)
            if method == "POST":
                req.add_header("Content-Type", "application/json")
                req.add_header("anthropic-version", "2023-06-01")
                req.data = b'{"model":"claude-haiku-4-5-20251001","max_tokens":1,"messages":[{"role":"user","content":"hi"}]}'

            urllib.request.urlopen(req, timeout=10)
            print(f"  ✅ {key_name} — valid")
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                print(f"  ❌ {key_name} — invalid (HTTP {e.code})")
            elif e.code == 429:
                print(f"  ✅ {key_name} — valid (rate limited)")
            else:
                print(f"  ⚠️  {key_name} — HTTP {e.code} (may be valid)")
        except Exception as e:
            print(f"  ⚠️  {key_name} — error: {e}")


# ── CLI entry point ──────────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    cmd = sys.argv[1]

    if cmd == "init":
        cmd_init()
    elif cmd == "store" and len(sys.argv) == 4:
        cmd_store(sys.argv[2], sys.argv[3])
    elif cmd == "store-stdin" and len(sys.argv) == 3:
        # Read value from stdin to avoid exposing secrets in process args
        value = sys.stdin.read().strip()
        if not value:
            print("Error: no value provided on stdin", file=sys.stderr)
            sys.exit(1)
        cmd_store(sys.argv[2], value)
    elif cmd == "load" and len(sys.argv) >= 3:
        cmd_load(sys.argv[2:])
    elif cmd == "migrate" and len(sys.argv) == 3:
        cmd_migrate(sys.argv[2])
    elif cmd == "list":
        cmd_list()
    elif cmd == "delete" and len(sys.argv) == 3:
        cmd_delete(sys.argv[2])
    elif cmd == "verify":
        cmd_verify()
    elif cmd == "export" and len(sys.argv) == 3:
        cmd_export(sys.argv[2])
    else:
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
