#!/usr/bin/env python3
"""Generate Phase 38.5 Part B — Advanced docs (50-series) as branded PDF."""

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'lib'))
from pdf_brand import BrandPDF

OUT50 = '/opt/AIWH/core/docs/user-guide/50-advanced'
os.makedirs(OUT50, exist_ok=True)


def doc_51_knowledge_pipeline():
    doc = BrandPDF("Knowledge Pipeline", "Technical deep-dive: how knowledge flows through the system")

    doc.h1("The Pipeline: 5 Stages")
    doc.body("Every night at 11pm, the knowledge pipeline runs 5 stages:")
    doc.code(
        "EXTRACT (parse tags + LLM scan + cinematic patterns)\n"
        "  → EMBED (OpenAI text-embedding-3-small, 1536 dimensions)\n"
        "    → REVIEW (≥0.90 auto-publish, <0.90 Discord review)\n"
        "      → PUBLISH (status='published', searchable)\n"
        "        → SYNC (Supabase → local cache on your machine)"
    )

    doc.h1("Stage 1: Extraction")
    doc.body("Three parallel extraction methods run simultaneously:")

    doc.h2("1a. Tag-Based Extraction")
    doc.body(
        "Scans all agent session transcripts and memory files from the last 25 hours. "
        "Looks for `#knowledge-extraction [domain] type [confidence]` tags."
    )
    doc.bullet([
        "Validates domain and type against allowed lists",
        "Confidence must be 0.0-1.0",
        "Strips PII (emails → [EMAIL], phones → [PHONE], IPs → [IP])",
        "Hashes content for deduplication — duplicates are skipped",
    ])

    doc.h2("1b. LLM Extraction")
    doc.body(
        "Haiku AI scans memory files for patterns that weren't explicitly tagged. "
        "It identifies insights, generates confidence scores, and formats as structured entries."
    )

    doc.h2("1c. Cinematic Extraction")
    doc.body(
        "Extracts patterns from video/cinematic style grades and performance data."
    )

    doc.h1("Stage 2: Embedding")
    doc.body(
        "Every entry needs a search vector (embedding) so agents can find it by meaning. "
        "Uses OpenAI `text-embedding-3-small` — 1536 dimensions."
    )
    doc.bullet([
        "Runs up to 10 passes to clear the backlog",
        "Respects OpenAI rate limits with batch mode",
        "Cost: ~$0.02-0.05/day typical",
    ])

    doc.h1("Stage 3: Review")
    doc.table([
        ["Confidence", "Action", "Where"],
        ["0.90 - 1.0", "Auto-published immediately", "Silent (no notification)"],
        ["0.50 - 0.89", "Flagged for human review", "Discord #knowledge-review"],
        ["Below 0.50", "Rejected", "Logged in audit trail"],
    ])
    doc.body(
        "Discord review shows: content preview, domain, type, confidence, source agent. "
        "You approve, reject, or edit."
    )

    doc.h1("Stage 4: Client Knowledge (Local)")
    doc.body(
        "Separate pipeline for your private client_knowledge.db entries. "
        "These are embedded and auto-published (no review gate — it's your data, "
        "stays on your machine)."
    )

    doc.h1("Stage 5: Sync")
    doc.body(
        "Base knowledge from Supabase (AIWH HQ) is pulled to your local cache. "
        "Only published, non-archived entries. Paginated (1000/request). "
        "If sync fails, agents use the last cached copy."
    )
    doc.callout(
        "If your cache is over 48 hours stale after a sync attempt, "
        "you'll get an alert. This usually means internet is down.",
        "WARNING"
    )

    doc.h1("How Search Works")
    doc.body("When an agent searches knowledge:")
    doc.numbered([
        "Your query is converted to an embedding vector (same OpenAI model)",
        "Both databases are searched (base_knowledge_cache + client_knowledge)",
        "Results ranked by cosine similarity (how close the meaning matches)",
        "Filtered by target_agents (some entries are agent-specific)",
        "Deduplicated (if client knowledge overlaps base, client wins)",
        "Top 5 results returned to the agent",
    ])

    doc.h1("Database Schema")
    doc.body("Each knowledge entry has:")
    doc.table([
        ["Field", "Purpose"],
        ["content", "The actual knowledge (2-4 sentences, standalone)"],
        ["category", "Domain (sales, coaching, content-strategy, etc.)"],
        ["knowledge_type", "Type (pattern, principle, antipattern, insight, etc.)"],
        ["confidence", "0.0-1.0 score"],
        ["embedding", "1536-dimensional search vector"],
        ["target_agents", "Which agents can see it (e.g., ['sales', 'copywriter'] or ['all'])"],
        ["status", "draft / published / archived / rejected"],
        ["source", "Where it came from (agent session, document, manual)"],
        ["content_hash", "Deduplication hash"],
    ])

    doc.h1("Monthly Cost")
    doc.table([
        ["Operation", "Cost", "Frequency"],
        ["OpenAI embeddings", "$0.50-1.50", "20-50 new entries/day"],
        ["Haiku distillation", "$0.10-0.30", "Document ingestion"],
        ["Haiku reconciliation", "$0.05-0.10", "Weekly Sunday"],
        ["Supabase", "$0 (free tier)", "Until 500MB+"],
        ["**Total**", "**$0.65-1.90/month**", ""],
    ])

    doc.save(f"{OUT50}/51-knowledge-pipeline.pdf")
    print("  51-knowledge-pipeline.pdf")


def doc_52_secrets_management():
    doc = BrandPDF("Secrets Management", "How your API keys are stored, encrypted, and used")

    doc.h1("How Secrets Work")
    doc.body(
        "All your API keys are stored in an encrypted file on your Mac Mini. "
        "They're encrypted with **AES-256-GCM** using a master key stored in "
        "your macOS Keychain. Keys never leave your device."
    )
    doc.table([
        ["Component", "Details"],
        ["Encryption", "AES-256-GCM (authenticated encryption)"],
        ["Master key", "32-byte random key in macOS Keychain"],
        ["Key derivation", "HKDF-SHA256 — unique derived key per secret"],
        ["Storage", "/opt/AIWH/client/config/secrets.enc"],
        ["Permissions", "Owner read/write only (chmod 600)"],
    ])

    doc.h1("Your API Keys")
    doc.table([
        ["Service", "Key Name", "Purpose", "Required?"],
        ["Anthropic", "ANTHROPIC_API_KEY", "Powers all AI agents", "CRITICAL"],
        ["OpenAI", "OPENAI_API_KEY", "Knowledge embeddings", "Required"],
        ["ElevenLabs", "ELEVENLABS_API_KEY", "Video voice synthesis", "For video"],
        ["HeyGen", "HEYGEN_API_KEY", "Avatar video generation", "For video"],
        ["Buffer", "BUFFER_API_TOKEN", "Social media scheduling", "For posting"],
        ["Discord", "DISCORD_TOKEN", "Notifications & chat", "Recommended"],
        ["Brave", "BRAVE_API_KEY", "Web search for Research agent", "Required"],
        ["Cloudflare R2", "CF_R2_ACCESS_KEY_ID", "Video hosting", "For video"],
        ["Google Cloud", "GOOGLE_CLOUD_PROJECT", "Cinematic video generation", "For cinematic"],
    ])

    doc.h1("Adding or Updating a Key")
    doc.body("The safest way — tell Branson:")
    doc.bullet([
        '"Update my Anthropic API key — the new key is sk-ant-..."',
        '"Add my ElevenLabs key — I just signed up"',
        '"My HeyGen key expired — here\'s the new one"',
    ])
    doc.body("Branson stores it securely without the key ever appearing in chat logs.")

    doc.h2("Via Dashboard (Onboarding)")
    doc.body(
        "During onboarding, the wizard verifies each key against the service "
        "before storing it. After onboarding, use the **Config** view."
    )

    doc.h2("Via Command Line (Advanced)")
    doc.code(
        '# Store a key\n'
        'python3 /opt/AIWH/core/scripts/lib/secrets.py store ANTHROPIC_API_KEY "sk-ant-..."\n'
        '\n'
        '# List stored keys (names only, never values)\n'
        'python3 /opt/AIWH/core/scripts/lib/secrets.py list\n'
        '\n'
        '# Verify all keys against services\n'
        'python3 /opt/AIWH/core/scripts/lib/secrets.py verify'
    )

    doc.callout(
        "Never paste API keys directly into the chat. Use the Dashboard settings "
        "or command line. Keys in chat history could be exposed in logs.",
        "SECURITY"
    )

    doc.h1("What If a Key Expires?")
    doc.bullet([
        "You'll see errors in agent logs (e.g., 401 Unauthorized)",
        "Branson will notify you if he detects a key failure",
        "Update the key via any of the methods above",
        "All agents pick up the new key automatically on next task",
    ])

    doc.save(f"{OUT50}/52-secrets-management.pdf")
    print("  52-secrets-management.pdf")


def doc_53_backup_system():
    doc = BrandPDF("Backup System", "3 layers of protection — how your data is safe")

    doc.h1("Three Backup Layers")
    doc.body(
        "Your data is protected by 3 independent backup systems. Even if one fails, "
        "the others have you covered."
    )

    doc.h2("Layer 1: Local Snapshots")
    doc.table([
        ["Detail", "Value"],
        ["Location", "/opt/AIWH/core/.backups/"],
        ["Frequency", "Every 4 hours"],
        ["Retention", "12 snapshots (~2 days)"],
        ["Encryption", "No (fast access for quick recovery)"],
        ["Size", "~2.5 GB per snapshot"],
    ])

    doc.h2("Layer 2: Desktop Archives (Encrypted)")
    doc.table([
        ["Detail", "Value"],
        ["Location", "~/Desktop/AIWH-Backups/archives/"],
        ["Frequency", "Every 1 hour"],
        ["Retention", "6 rolling archives"],
        ["Encryption", "AES-256-CBC with PBKDF2 (100,000 iterations)"],
        ["Survives", "Full wipe of /opt/AIWH/ (stored outside)"],
    ])

    doc.h2("Layer 3: Google Drive (Encrypted, Off-Site)")
    doc.table([
        ["Detail", "Value"],
        ["Location", "AIWH-Backups folder on Google Drive"],
        ["Frequency", "3x daily (12:15am, 8:15am, 4:15pm Brisbane)"],
        ["Retention", "21 archives (7 days × 3/day)"],
        ["Encryption", "Same AES-256-CBC as Desktop"],
        ["Survives", "Hardware failure, theft, fire — fully remote"],
    ])

    doc.h1("What's Backed Up")
    doc.bullet([
        "All code (scripts, dashboard, modules, skills)",
        "OpenClaw config (agent definitions, cron schedules)",
        "All databases (video-jobs, mission-control, knowledge caches)",
        "Agent memory files (SQLite databases, 56MB total)",
        "Client configs (auth, secrets, avatar/voice configs)",
        "API keys (encrypted)",
        "Documentation and memory files",
    ])

    doc.h1("What's NOT Backed Up")
    doc.bullet([
        "**Video/audio files** (.mp4, .mp3, .wav) — too large (~3GB). Archived separately to AIWH-Archive on GDrive",
        "**Browser cache** — regenerated automatically",
        "**Git history** — stored in GitHub",
    ])

    doc.h1("Checking Backup Health")
    doc.body("Ask Branson:")
    doc.bullet([
        '"When was the last backup?"',
        '"Is my backup system healthy?"',
        '"How old is my newest Google Drive backup?"',
    ])
    doc.body(
        "The morning briefing (8am) always includes backup status. "
        "If backups are stale (>24h), you'll get a Discord alert."
    )

    doc.h1("Restoring from Backup")
    doc.body("If something goes wrong:")
    doc.numbered([
        "**Stop all services** — Dashboard, Gateway, crons",
        "**Decrypt the backup** (need your encryption key)",
        "**Extract to a temp location** and verify contents",
        "**Restore with rsync** (excludes media to save time)",
        "**Restart services** and verify",
    ])
    doc.body("**Estimated recovery time: under 30 minutes.**")
    doc.callout(
        "Your encryption key is at `/opt/AIWH/.openclaw/backup-encryption-key`. "
        "Keep a copy in your password manager. Without it, encrypted backups are unrecoverable.",
        "SECURITY"
    )

    doc.save(f"{OUT50}/53-backup-system.pdf")
    print("  53-backup-system.pdf")


def doc_54_system_updates():
    doc = BrandPDF("System Updates", "How updates work, what they change, and how to roll back")

    doc.h1("How Updates Work")
    doc.body(
        "AIWH pushes updates to improve agents, fix bugs, and add features. "
        "Updates are applied via a script that includes safety checks and "
        "automatic rollback."
    )

    doc.h1("The Update Process (7 Steps)")
    doc.numbered([
        "**Fetch** — Downloads latest version tags from GitHub",
        "**Snapshot** — Creates a backup before any changes",
        "**Update core** — Checks out the new version tag (stashes any local changes)",
        "**Update OpenClaw** — Pulls latest fork changes and reinstalls",
        "**Run migrations** — Executes any database or config migrations",
        "**Install dependencies** — Updates Dashboard npm packages",
        "**Restart services** — Restarts Dashboard and Gateway",
    ])

    doc.h1("What Gets Updated")
    doc.bullet([
        "**Core code** — scripts, dashboard, modules (the AIWH CORE zone in SOUL.md files)",
        "**Knowledge** — base knowledge syncs nightly anyway, but updates may include schema changes",
        "**Bug fixes** — resolved issues in agents, crons, pipelines",
        "**New features** — new agent capabilities, dashboard views, tools",
    ])

    doc.h1("What Stays Untouched")
    doc.bullet([
        "**Your customisations** — the CLIENT ZONE in SOUL.md files is preserved",
        "**Your configs** — avatar-config.json, voice-config.json, auth.json",
        "**Your knowledge** — client_knowledge.db is never modified by updates",
        "**Your data** — videos, logs, databases, memory files",
        "**Your crons** — custom crons you've added stay as-is",
    ])

    doc.h1("Rollback")
    doc.body("If an update causes problems:")
    doc.bullet([
        "The update script automatically stashes your changes before updating",
        "If the update fails mid-way, it reverts to the previous version tag",
        "If you notice issues after an update, ask Branson to roll back",
        "The pre-update snapshot in `.backups/` is your safety net",
    ])

    doc.h1("Checking for Updates")
    doc.body("A daily cron (3am) checks for new versions:")
    doc.bullet([
        "If a new version is available, you get a notification",
        "Updates are **never auto-applied** — you decide when to update",
        'Tell Branson: "Apply the latest update" when you\'re ready',
    ])

    doc.callout(
        "Updates are safe to apply any time. The system creates a backup first "
        "and can roll back automatically if anything goes wrong.",
        "TIP"
    )

    doc.save(f"{OUT50}/54-system-updates.pdf")
    print("  54-system-updates.pdf")


def doc_55_fleet_health():
    doc = BrandPDF("Fleet Health", "Monitoring your system — what to check and when")

    doc.h1("Health Endpoint")
    doc.body("Your Dashboard exposes a health check at:")
    doc.code("http://localhost:3001/health")
    doc.body("Returns:")
    doc.code('{"status": "ok", "uptime": 3600.5, "version": "2.0.0"}')

    doc.h1("Full System Diagnostics")
    doc.body("For a comprehensive check:")
    doc.code("http://localhost:3001/api/debug/doctor")
    doc.body(
        "Runs OpenClaw's built-in doctor command — checks gateway, agents, "
        "channels, credentials, and configuration. Takes ~30 seconds."
    )

    doc.h1("What to Monitor")
    doc.table([
        ["Check", "Where", "Healthy", "Action If Not"],
        ["Dashboard", "Top bar — loads at all", "Page loads", "Power-cycle Mac Mini"],
        ["Gateway", "Top bar — green dot", "Green", "Restart: openclaw gateway restart"],
        ["Agents", "Top bar — green dot", "Green", "Check Logs view for errors"],
        ["Crons", "Top bar — idle/yellow", "Idle or running", "Check Schedule view"],
        ["Cost", "Top bar — today's spend", "Below budget", "Check Costs view"],
        ["Backups", "Morning briefing", "Last <24h", "Check Desktop/AIWH-Backups/"],
    ])

    doc.h1("Ask Branson")
    doc.bullet([
        '"Run a system health check"',
        '"Is everything running normally?"',
        '"Show me any errors from the last 24 hours"',
        '"Check if all crons fired today"',
        '"What\'s the gateway status?"',
    ])

    doc.save(f"{OUT50}/55-fleet-health.pdf")
    print("  55-fleet-health.pdf")


def doc_56_emergency_procedures():
    doc = BrandPDF("Emergency Procedures", "When things go wrong — stop, recover, and get help")

    doc.h1("Emergency Stop")
    doc.body(
        "If the system is spending too much, behaving unexpectedly, or you need "
        "it to stop immediately:"
    )
    doc.h2("Via Branson")
    doc.body('"Branson, EMERGENCY STOP. Reason: [explain]"')

    doc.h2("Via File (If Branson Is Unresponsive)")
    doc.code('echo "Budget exceeded" > /opt/AIWH/core/control/emergency.flag')
    doc.body("The watchdog detects the flag within 5 seconds and stops the Gateway.")

    doc.h2("Via Power (Nuclear Option)")
    doc.body("Unplug the Mac Mini. Everything stops immediately. On reboot, services restart normally.")

    doc.divider()

    doc.h1("What Emergency Stop Does")
    doc.bullet([
        "**Gateway stops** — all agents immediately halt",
        "**Crons pause** — nothing new fires",
        "**Dashboard stays up** — you can still view data and logs",
        "**Backups continue** — launchd services are separate from the gateway",
    ])

    doc.h1("Recovery After Emergency Stop")
    doc.numbered([
        "Fix the issue that caused the emergency (e.g., update budget, fix a cron)",
        "Remove the flag: `rm /opt/AIWH/core/control/emergency.flag`",
        "The watchdog automatically restarts the Gateway within seconds",
        "Verify: check the Dashboard — Gateway dot should turn green",
        "Resume: crons catch up on anything they missed",
    ])

    doc.divider()

    doc.h1("Common Emergencies")
    doc.table([
        ["Emergency", "What to Do"],
        ["Budget exceeded ($10+ in a day)", "Emergency stop → check Costs view → "
         "find which agent/cron is spending → fix or disable → restart"],
        ["Agent looping (same task running endlessly)", "Emergency stop → check Logs → "
         "identify stuck agent → clear its session → restart"],
        ["Wrong content published", "Can't undo via AIWH — go directly to Buffer/Instagram "
         "to delete the post"],
        ["Mac Mini unresponsive", "Power-cycle (unplug, wait 10s, plug back in) → "
         "services auto-start"],
        ["Internet outage", "Agents that need APIs will fail gracefully → "
         "crons resume when internet returns"],
    ])

    doc.h1("Contacting AIWH Support")
    doc.body("If you can't resolve the issue yourself:")
    doc.bullet([
        "**Discord:** Message the AIWH support channel",
        "**Email:** support@aiwealthhub.app",
        "**Tailscale:** We can SSH into your Mac Mini remotely (with your permission) to diagnose",
    ])
    doc.callout(
        "Keep your encryption key and Tailscale credentials somewhere safe — "
        "they're needed for remote support if your Mac Mini is inaccessible locally.",
        "SECURITY"
    )

    doc.save(f"{OUT50}/56-emergency-procedures.pdf")
    print("  56-emergency-procedures.pdf")


if __name__ == '__main__':
    print("Generating 38.5b — Advanced docs (PDF)...")
    doc_51_knowledge_pipeline()
    doc_52_secrets_management()
    doc_53_backup_system()
    doc_54_system_updates()
    doc_55_fleet_health()
    doc_56_emergency_procedures()
    print(f"Done! 6 PDFs in {OUT50}")
