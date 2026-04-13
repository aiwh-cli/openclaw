#!/usr/bin/env python3
"""Generate Phase 38.5 Part C — Reference docs (60-series) as branded PDF."""

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'lib'))
from pdf_brand import BrandPDF

OUT60 = '/opt/AIWH/core/docs/user-guide/60-reference'
os.makedirs(OUT60, exist_ok=True)


def doc_61_glossary():
    doc = BrandPDF("Glossary", "Every term explained — from Agent to Workspace")

    doc.h1("A–C")
    doc.table([
        ["Term", "Definition"],
        ["Agent", "A specialised AI worker with its own training, personality, and tools. You have 19 agents organised into 4 modules."],
        ["Agent Cron", "A scheduled task that runs an AI agent at a set time. Costs API tokens."],
        ["Avatar", "A HeyGen-generated video of a talking person. Each pillar can have a different avatar look."],
        ["Base Knowledge", "Shared knowledge curated by AIWH. Synced to all clients nightly. The subscription moat."],
        ["Bootstrap (BOOTSTRAP.md)", "Hard guardrails for an agent — things it can NEVER do, regardless of instructions."],
        ["Branson", "Your AI CEO. The main agent that orchestrates all others. Named after the team's AI partner."],
        ["Buffer", "Social media scheduling platform. Used to post videos to Instagram Reels and X."],
        ["Caption Agent", "Sub-agent of Video. Burns subtitles into videos using Whisper + ffmpeg."],
        ["Cinematic Pipeline", "Semi-autonomous video production for longer, higher-quality content with human review gates."],
        ["Client Knowledge", "YOUR private knowledge stored locally. Never leaves your Mac Mini. Never shared."],
        ["Client Zone", "The editable section at the top of SOUL.md — your customisations. Preserved during updates."],
        ["Confidence Score", "0.0-1.0 rating on knowledge entries. ≥0.90 auto-publishes, <0.90 needs review."],
        ["Core Zone", "The locked section at the bottom of SOUL.md — AIWH system instructions. Updated automatically."],
        ["Cron", "An automated task that runs on a schedule (from the Unix utility 'cron')."],
    ])

    doc.h1("D–H")
    doc.table([
        ["Term", "Definition"],
        ["Dashboard", "The web interface at localhost:3001. Your command centre for the entire system."],
        ["Delivery Channel", "Which Discord channel receives a cron's output."],
        ["Discord", "Messaging platform used for notifications, approvals, and agent communication."],
        ["Distillation", "The process of rephrasing document content into clean, standalone knowledge entries."],
        ["ElevenLabs", "Voice synthesis API. Generates MP3 audio from text scripts."],
        ["Embedding", "A numerical representation of text meaning (1536-dimensional vector). Used for semantic search."],
        ["Emergency Flag", "A file that triggers immediate system shutdown. Located at /opt/AIWH/core/control/emergency.flag."],
        ["ffmpeg", "Video processing tool. Burns captions, concatenates clips, adjusts speed."],
        ["Gateway", "The OpenClaw Gateway — manages agent sessions, cron execution, and channel connections."],
        ["Haiku", "Anthropic's fastest, cheapest AI model (~$0.001/message). Used for 85%+ of tasks."],
        ["HeyGen", "Avatar video generation API. Creates talking-head videos from audio."],
        ["Hook", "The opening 3 seconds of a video script. Designed to grab attention immediately."],
    ])

    doc.h1("I–O")
    doc.table([
        ["Term", "Definition"],
        ["Knowledge Base", "The combined base + client knowledge databases. Agents search this before every task."],
        ["Knowledge Sprint", "Weekly Sunday event where Research fills gaps in the thinnest knowledge categories."],
        ["LaunchD", "macOS's service management system. Runs background processes like backups and the Dashboard."],
        ["Llama", "Meta's local AI model. Runs on your Mac Mini for free (no API cost). Used by Scheduler."],
        ["MagicDNS", "Tailscale feature that gives your Mac Mini a human-readable hostname."],
        ["Module", "A group of related agents. Three modules: Frontend, Backend, Lifestyle. Plus System (always on)."],
        ["Nightly Pipeline", "The 11pm automated process that extracts, embeds, reviews, and syncs knowledge."],
        ["Onboarding", "The 7-step setup wizard you complete when first accessing the Dashboard."],
        ["OpenClaw", "The AI agent orchestration platform that AIWH runs on. Manages agents, crons, and channels."],
        ["Opus", "Anthropic's most powerful (and expensive) AI model (~$0.05/message). Used for strategy and code only."],
    ])

    doc.h1("P–S")
    doc.table([
        ["Term", "Definition"],
        ["Pillar", "One of 6 content themes in the video pipeline. Topics rotate through pillars on a 3-day cycle."],
        ["Pipeline", "A multi-stage automated process. The video pipeline has 7 stages from topic to publish."],
        ["Publisher Agent", "Sub-agent of Video. Schedules videos to social media via Buffer."],
        ["QA Agent", "Sub-agent of Video. Checks duration, audio, captions, and file integrity before publishing."],
        ["Reconciliation", "Weekly Sunday process that cleans contradictions, duplicates, and stale knowledge entries."],
        ["Script Cron", "A scheduled shell script that runs locally (no AI, no cost)."],
        ["Secrets", "Your API keys, stored encrypted (AES-256-GCM) in secrets.enc."],
        ["Sonnet", "Anthropic's mid-tier AI model (~$0.01/message). Used for creative writing and analysis."],
        ["SOUL.md", "An agent's core instructions file. Defines what it does, how it behaves, and its guardrails."],
        ["Standard Pipeline", "Fully autonomous daily video production. 2 videos/day, 50-70 seconds each."],
        ["Supabase", "Cloud database (PostgreSQL + pgvector) that stores shared base knowledge."],
    ])

    doc.h1("T–Z")
    doc.table([
        ["Term", "Definition"],
        ["Tailscale", "Free encrypted network for remote access. Connects your devices to the Mac Mini securely."],
        ["Target Agents", "Which agents can see a knowledge entry. Some entries are agent-specific (e.g., sales-only)."],
        ["Voice Agent", "Sub-agent of Video. Converts scripts to MP3 audio via ElevenLabs."],
        ["Watchdog", "macOS service that monitors the emergency flag and system health. Kills Gateway on emergency."],
        ["Whisper", "OpenAI's speech-to-text model. Runs locally (free) to transcribe audio for captions."],
        ["Workspace", "An agent's private directory containing its SOUL.md, TOOLS.md, IDENTITY.md, and memory."],
    ])

    doc.save(f"{OUT60}/61-glossary.pdf")
    print("  61-glossary.pdf")


def doc_62_faq():
    doc = BrandPDF("Frequently Asked Questions", "Answers to the most common questions")

    doc.h1("Getting Started")

    doc.h2("How do I access my Dashboard?")
    doc.body(
        "Locally: `http://localhost:3001` on the Mac Mini. Remotely: via Tailscale IP "
        "or MagicDNS hostname. See the Remote Access guide for setup."
    )

    doc.h2("What if I forget my password?")
    doc.body(
        "There's no self-service reset. Contact AIWH support — we can reset it "
        "via SSH (requires your Tailscale to be connected)."
    )

    doc.h2("Can my team member access the Dashboard?")
    doc.body(
        "Yes — they install Tailscale (free) on their device, join your network, "
        "and use the same Dashboard URL. They'll need the same password."
    )

    doc.divider()
    doc.h1("Costs & Billing")

    doc.h2("How much does it cost per month?")
    doc.body(
        "AI API usage averages $75-100/month. Plus third-party services "
        "(ElevenLabs $22, HeyGen $29-89, Buffer $0-12). Your AIWH subscription "
        "is separate."
    )

    doc.h2("Can I reduce costs?")
    doc.body("Yes — reduce to 1 video/day, disable knowledge sprints, use Haiku "
             "for copywriting instead of Sonnet. Ask Branson for a cost optimization plan.")

    doc.h2("What happens if I exceed the daily budget?")
    doc.body(
        "You get alerts at 80%, 90%, and 100%. At 100%, agents pause until "
        "the next day (midnight AEST). You can increase the budget at any time."
    )

    doc.h2("Do planned/inactive agents cost anything?")
    doc.body("No. Agents only cost money when they run a task. Inactive agents are free.")

    doc.divider()
    doc.h1("Videos & Content")

    doc.h2("How do I change what my videos are about?")
    doc.body(
        "Tell Branson to update your content pillars. The 6 pillars and 3-day "
        "rotation are fully customisable."
    )

    doc.h2("Can I use my own face/voice in videos?")
    doc.body(
        "Yes — create a custom avatar on HeyGen and clone your voice on ElevenLabs. "
        "Give Branson the IDs and he'll configure the pipeline."
    )

    doc.h2("What if a video fails QA?")
    doc.body(
        "You get a Discord notification with the failure reason. The system "
        "automatically retries or resets to scripting (depending on the failure type)."
    )

    doc.h2("Can I review videos before they publish?")
    doc.body(
        "Standard pipeline: auto-publishes after QA. For review control, tell "
        "Branson to add an approval step. Cinematic pipeline: always has human "
        "review gates."
    )

    doc.divider()
    doc.h1("Knowledge & Learning")

    doc.h2("How does the system get smarter?")
    doc.body(
        "Three ways: (1) nightly knowledge extraction from agent work, "
        "(2) base knowledge updates from AIWH HQ, (3) documents you upload. "
        "Weekly reconciliation keeps knowledge clean."
    )

    doc.h2("Is my knowledge shared with other clients?")
    doc.body(
        "**Never.** Your client_knowledge.db stays on your Mac Mini. Base knowledge "
        "flows TO you, never FROM you."
    )

    doc.h2("How do I upload training documents?")
    doc.body(
        "Copy PDFs/DOCX/PPTX to `/opt/AIWH/client/data/inbox/` or tell Branson. "
        "The nightly pipeline distils them into knowledge entries."
    )

    doc.divider()
    doc.h1("System & Security")

    doc.h2("What if the Mac Mini loses internet?")
    doc.body(
        "Agents that need APIs fail gracefully. Local services (backups, monitoring) "
        "continue. Crons resume when internet returns. Knowledge uses cached copy."
    )

    doc.h2("What if the Mac Mini loses power?")
    doc.body(
        "All services auto-restart on boot. No data loss — databases use WAL mode. "
        "Crons catch up on missed jobs. Backups on Desktop survive."
    )

    doc.h2("How often is my data backed up?")
    doc.body(
        "Hourly (Desktop encrypted), every 4 hours (local snapshots), "
        "3x daily (Google Drive encrypted). Three independent layers."
    )

    doc.h2("Can AIWH access my system remotely?")
    doc.body(
        "Only with Tailscale connected AND your permission. We can SSH in "
        "for support. We cannot access your system without Tailscale being active."
    )

    doc.h2("What if I want to cancel?")
    doc.body(
        "The Mac Mini and all your data belong to you. Deactivating the subscription "
        "stops base knowledge updates and support — but the hardware, your data, "
        "and client knowledge stay yours permanently."
    )

    doc.save(f"{OUT60}/62-faq.pdf")
    print("  62-faq.pdf")


def doc_63_troubleshooting():
    doc = BrandPDF("Master Troubleshooting Guide", "Everything that can go wrong — and how to fix it")

    doc.h1("Quick Diagnostics")
    doc.body("Start here. Ask Branson:")
    doc.bullet([
        '"Run a system health check"',
        '"Show me errors from the last 24 hours"',
        '"What\'s broken right now?"',
    ])
    doc.body("Or check the Dashboard top bar — red dots indicate problems.")

    doc.divider()

    doc.h1("Dashboard Issues")
    doc.table([
        ["Problem", "Cause", "Fix"],
        ["Page won't load", "Dashboard server crashed", "Power-cycle Mac Mini or `launchctl kickstart com.aiwh.dashboard`"],
        ["Slow loading", "Database lock or heavy queries", "Wait 30s. If persistent, restart Dashboard"],
        ["Session expired", "24-hour timeout", "Normal — just log in again"],
        ["Wrong password", "Caps lock or typo", "Type carefully. No reset — contact support"],
        ["Blank screen after login", "JavaScript error", "Hard refresh (Cmd+Shift+R). Clear browser cache if persists"],
    ])

    doc.h1("Agent Issues")
    doc.table([
        ["Problem", "Cause", "Fix"],
        ["Agent not responding", "Gateway down", "Check Gateway dot (top bar). Restart if red"],
        ["Agent gives wrong answers", "Stale knowledge or missing context", "Update knowledge base or provide more context"],
        ["Agent ignores instructions", "SOUL.md core zone was edited", 'Tell Branson: "Reset [agent] to factory defaults"'],
        ["Agent costs too much", "Using wrong model tier", "Ask Branson to check model assignment"],
    ])

    doc.h1("Video Pipeline Issues")
    doc.table([
        ["Problem", "Cause", "Fix"],
        ["No videos produced", "Topic generator or copywriter failed", "Check Schedule view — were crons triggered? Check Logs"],
        ["Video QA fails", "Word count wrong (too short/long)", "System auto-resets to scripting. Check copywriter output"],
        ["Avatar generation fails", "HeyGen API down or key expired", "Check HeyGen status page. Update key if expired"],
        ["Voice generation fails", "ElevenLabs rate limit or key expired", "Wait 10 min (rate limit) or update key"],
        ["Captions missing", "Whisper or ffmpeg error", "Check caption agent log. May need ffmpeg-full reinstall"],
        ["Video won't publish", "Buffer token expired or R2 upload failed", "Update Buffer token. Check R2 credentials"],
    ])

    doc.h1("Cost Issues")
    doc.table([
        ["Problem", "Cause", "Fix"],
        ["Spending more than expected", "Expensive model being used or agent looping", "Check Costs view for breakdown. Disable offending cron"],
        ["Budget alert won't stop", "Alert cooldown is 8 hours", "Wait for cooldown or increase budget"],
        ["No cost data showing", "cost-sync not running", "Trigger manually: POST /api/costs/sync"],
    ])

    doc.h1("Backup Issues")
    doc.table([
        ["Problem", "Cause", "Fix"],
        ["Backup stale alert", "LaunchD service stopped", "`launchctl load ~/Library/LaunchAgents/com.aiwh.backup-local.plist`"],
        ["GDrive backup failing", "Google auth expired", "`gws auth login` to re-authenticate"],
        ["No Desktop backups", "AIWH-Backups folder deleted", "Create ~/Desktop/AIWH-Backups/archives/ and ~/Desktop/AIWH-Backups/logs/"],
    ])

    doc.h1("Network & Access Issues")
    doc.table([
        ["Problem", "Cause", "Fix"],
        ["Can't access remotely via Tailscale", "Tailscale not running on your device", "Open Tailscale app, toggle on"],
        ["Tailscale shows Mac Mini offline", "Mac Mini lost internet or is off", "Check power and internet physically"],
        ["Discord notifications stopped", "Bot token expired or bot offline", "Check Channels view, reconnect bot"],
    ])

    doc.divider()

    doc.h1("The Nuclear Options")
    doc.body("When nothing else works, in order of escalation:")
    doc.numbered([
        "**Restart Gateway:** `openclaw gateway restart` (fixes most agent issues)",
        "**Restart Dashboard:** `launchctl kickstart com.aiwh.dashboard`",
        "**Power-cycle Mac Mini:** Unplug, wait 10 seconds, plug back in",
        "**Restore from backup:** See Backup System doc for full procedure",
        "**Contact support:** support@aiwealthhub.app or Discord",
    ])

    doc.callout(
        "Before contacting support, note: (1) What you were doing, (2) What happened, "
        "(3) Any error messages you saw. This helps us diagnose faster via Tailscale SSH.",
        "TIP"
    )

    doc.save(f"{OUT60}/63-troubleshooting.pdf")
    print("  63-troubleshooting.pdf")


if __name__ == '__main__':
    print("Generating 38.5c — Reference docs (PDF)...")
    doc_61_glossary()
    doc_62_faq()
    doc_63_troubleshooting()
    print(f"Done! 3 PDFs in {OUT60}")
