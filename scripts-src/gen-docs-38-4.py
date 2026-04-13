#!/usr/bin/env python3
"""Generate Phase 38.4 — Cron Job docs (30-series) as branded PDF."""

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'lib'))
from pdf_brand import BrandPDF

OUT = '/opt/AIWH/core/docs/user-guide/30-cron-jobs'
os.makedirs(OUT, exist_ok=True)


def doc_31_cron_overview():
    doc = BrandPDF("Cron Jobs Overview", "What runs automatically — and the three types")

    doc.h1("What Are Cron Jobs?")
    doc.body(
        "Cron jobs are tasks that run automatically on a schedule — no manual trigger needed. "
        "Your AIWH system has **three types** of automated jobs, each managed differently."
    )

    doc.h1("The Three Types")
    doc.card_grid([
        ("Agent Crons", "An AI agent runs a task at a scheduled time. Uses API tokens "
         "(costs money). Example: Copywriter writing a script at 8am every day."),
        ("Script Crons", "A shell script runs on a schedule. Zero API cost — runs locally. "
         "Example: Backup snapshot at 11:30pm."),
    ])
    doc.card_grid([
        ("LaunchD Services", "macOS system services that run continuously or on intervals. "
         "Always-on daemons (Dashboard, Spend Watchdog) or periodic tasks (hourly backups). "
         "Zero API cost."),
        ("", ""),
    ])

    doc.h2("Key Differences")
    doc.table([
        ["Feature", "Agent Crons", "Script Crons", "LaunchD Services"],
        ["Managed by", "OpenClaw Gateway", "Dashboard scheduler", "macOS launchd"],
        ["Costs money", "Yes (AI tokens)", "No (local)", "No (local)"],
        ["Visible in Schedule view", "Yes", "Yes", "No (system-level)"],
        ["Can be triggered manually", "Yes", "Yes", "No"],
        ["Survives reboot", "Yes (gateway auto-starts)", "Yes (dashboard auto-starts)", "Yes (macOS manages)"],
        ["Timezone", "Brisbane/AEST", "Configurable", "UTC or Brisbane"],
    ])

    doc.h1("Where to See Them")
    doc.body("Open the **Schedule** view in the Dashboard. You'll see:")
    doc.bullet([
        "**Calendar mode** — Visual timeline with 15-minute granularity, jobs shown as cards",
        "**List mode** — All jobs sorted by next run time",
        "Click any job card for full details: schedule, agent, last run, delivery channel, prompt",
    ])
    doc.body(
        "LaunchD services are NOT shown in the Schedule view (they're macOS-level). "
        "To check them, ask Branson: \"Show me the status of all launchd services.\""
    )

    doc.h1("How Many Crons Do I Have?")
    doc.table([
        ["Type", "Count", "Total Monthly Cost"],
        ["Agent crons (daily)", "8", "~$7/month"],
        ["Agent crons (weekly)", "3", "~$2.50/month"],
        ["Script crons", "2+", "Free"],
        ["LaunchD services", "5 active", "Free"],
    ])

    doc.callout(
        "Your total cron cost is roughly $9.50/month. The rest of your AI spend "
        "comes from Branson conversations and on-demand agent tasks.",
        "COST"
    )

    doc.save(f"{OUT}/31-cron-overview.pdf")
    print("  31-cron-overview.pdf")


def doc_32_daily_crons():
    doc = BrandPDF("Daily Cron Jobs", "Every automated job that runs each day — in detail")

    doc.h1("Daily Timeline (Brisbane/AEST)")
    doc.body(
        "Here's every agent cron that runs daily, with exact details. All times "
        "are Brisbane/AEST (UTC+10)."
    )

    doc.divider()

    doc.h1("7:00 AM — Video Topic Generator")
    doc.table([
        ["Detail", "Value"],
        ["Agent", "Research"],
        ["Model", "Haiku"],
        ["Timeout", "300 seconds (5 minutes)"],
        ["Cost per run", "~$0.008"],
        ["Discord delivery", "Publish ledger channel"],
    ])
    doc.h2("What It Does")
    doc.numbered([
        "Determines today's 2 video pillars from the 3-day rotation (epoch: 2026-03-05)",
        "Checks queue size — if ≥14 drafts, tags as `source='research'`",
        "Checks existing topics to avoid duplicates",
        "Web searches 2-3 times for AI news + industry trends",
        "Generates exactly 2 unique topics (130-160 words max, 60-char title)",
        "Runs urgency scan — if breaking news scores ≥50/100, creates urgent_review + Discord alert",
        "Posts summary to Discord with queue count",
    ])
    doc.h2("What Can Go Wrong")
    doc.bullet([
        "**No new topics** — queue is full. Not an error, just means research isn't needed today.",
        "**Web search fails** — Brave Search API down. Agent uses knowledge base as fallback.",
        "**Duplicate topic** — caught by duplicate check, agent generates a replacement.",
    ])
    doc.h2("Troubleshoot")
    doc.body('Ask Branson: "Why didn\'t topics generate this morning?" or check the Research agent\'s logs in the Dashboard Logs view.')

    doc.divider()

    doc.h1("8:00 AM — Morning Briefing")
    doc.table([
        ["Detail", "Value"],
        ["Agent", "Scheduler"],
        ["Model", "Haiku"],
        ["Timeout", "120 seconds"],
        ["Cost per run", "~$0.005"],
        ["Discord delivery", "CEO briefing channel"],
    ])
    doc.h2("What It Does")
    doc.body("Reads system status files and compiles a briefing:")
    doc.bullet([
        "**Spend status** — from `spend-status.txt` (yesterday's total, today's budget)",
        "**System health** — from `cron-health.txt` (gateway, agents, missed crons)",
        "**Content pipeline** — from `video-jobs.db` (videos in progress, queued, stuck)",
        "**Backup status** — from `backup-status.txt` (last backup time and age)",
        "**Disk usage** — filesystem check",
    ])
    doc.h2("What Can Go Wrong")
    doc.bullet([
        "**Status files stale** — spend-watchdog crashed. Briefing will show old data. Check launchd.",
        "**No Discord delivery** — delivery mode is `none`. Briefing runs but doesn't post. Check delivery config.",
    ])

    doc.divider()

    doc.h1("8:00 AM — Copywriter #1 (Morning Script)")
    doc.table([
        ["Detail", "Value"],
        ["Agent", "Copywriter"],
        ["Model", "Sonnet (creative quality)"],
        ["Timeout", "300 seconds"],
        ["Cost per run", "~$0.102"],
        ["Discord delivery", "Video pipeline channel"],
    ])
    doc.h2("What It Does")
    doc.numbered([
        "Determines today's first pillar from the 3-day rotation",
        "Checks for urgent_review drafts first (breaking news gets priority)",
        "Searches knowledge base for relevant context (5 entries)",
        "Writes script: Hook → Problem → Framework → Example → CTA (**130-160 words exactly**)",
        "Writes platform captions: Instagram (≤220 chars + hashtags) and X (≤280 chars, no hashtags)",
        "Updates DB: script + caption saved, status → `scripted`",
        "Posts to Discord: topic, word count, pillar",
    ])
    doc.h2("What Can Go Wrong")
    doc.bullet([
        "**Word count wrong** — QA will reject later, job resets to `planned`. Copywriter retries next run.",
        "**No draft topics available** — topic generator didn't run or queue empty. Copywriter skips gracefully.",
        "**Knowledge search returns nothing** — writes without context (lower quality). Not a failure.",
    ])

    doc.divider()

    doc.h1("9:00 AM — Video Pipeline #1 (Morning Production)")
    doc.table([
        ["Detail", "Value"],
        ["Agent", "Video"],
        ["Model", "Haiku"],
        ["Timeout", "2400 seconds (40 minutes)"],
        ["Cost per run (AI)", "~$0.006"],
        ["Cost per run (APIs)", "~$1-3 (ElevenLabs + HeyGen)"],
        ["Discord delivery", "Video pipeline channel"],
    ])
    doc.h2("What It Does")
    doc.numbered([
        "Picks first scripted job from the database",
        "Runs **Voice Agent** → ElevenLabs TTS → MP3 audio (waits 5 min)",
        "Runs **Avatar Agent** → HeyGen video generation → MP4 (waits 10 min)",
        "Runs **Caption Agent** → Whisper transcription + ffmpeg burn-in (waits 5 min)",
        "Runs **QA Agent** → duration, audio, caption, file integrity checks (waits 2 min)",
        "If QA passes → updates to `approved` status",
        "Runs **Publisher Agent** → schedules via Buffer to Instagram/X",
    ])
    doc.h2("What Can Go Wrong")
    doc.table([
        ["Stage", "Failure", "What Happens"],
        ["Voice", "ElevenLabs API timeout/rate limit", "Stays `scripted`, retries next run"],
        ["Voice", "Word count outside 130-160", "Resets to `planned`, script cleared"],
        ["Avatar", "HeyGen polling timeout (>10 min)", "Stays `voice_ready`, retries HeyGen only"],
        ["Caption", "ffmpeg fails (missing libass)", "Falls back to Python captioning"],
        ["Caption", "Whisper fails", "Status `caption_error`, manual intervention needed"],
        ["QA", "Duration <50s or >70s", "Resets to `planned` (word count is root cause)"],
        ["Publisher", "Buffer API failure", "Status `publish_error`, check Buffer token"],
    ])
    doc.callout(
        "Each stage fails back ONE step only — preserving paid work. If HeyGen fails, "
        "the voice audio (already paid for) is kept. Only the failed stage retries.",
        "NOTE"
    )

    doc.divider()

    doc.h1("1:00 PM — Copywriter #2 / 2:00 PM — Pipeline #2")
    doc.body(
        "Identical to the morning pair but for the second topic. Same agents, same flow, "
        "same costs. By ~3pm, both daily videos are typically scheduled for publishing."
    )

    doc.divider()

    doc.h1("10:00 PM — Nightly System Summary")
    doc.table([
        ["Detail", "Value"],
        ["Agent", "Scheduler"],
        ["Model", "Haiku"],
        ["Timeout", "120 seconds"],
        ["Cost per run", "~$0.005"],
        ["Discord delivery", "Nightly ledger channel"],
    ])
    doc.body("Comprehensive end-of-day report: total spend, health issues, pipeline status, "
             "backup health, specific problems (missed crons, failed backups, budget warnings, "
             "disk >80%).")

    doc.divider()

    doc.h1("3x Daily — GDrive Backup Upload")
    doc.table([
        ["Detail", "Value"],
        ["Schedule", "12:15am, 8:15am, 4:15pm Brisbane"],
        ["Agent", "Scheduler"],
        ["Model", "Haiku"],
        ["Cost per run", "~$0.004"],
    ])
    doc.body(
        "Uploads the newest encrypted Desktop backup archive to Google Drive. "
        "Keeps 21 archives on Drive (7 days × 3/day). Encrypted with AES-256-CBC."
    )

    doc.divider()

    doc.h1("Daily Cost Summary")
    doc.table([
        ["Cron", "Runs", "AI Cost", "API Cost", "Total/Day"],
        ["Topic Generator", "1x", "$0.008", "—", "$0.008"],
        ["Morning Briefing", "1x", "$0.005", "—", "$0.005"],
        ["Copywriter #1 + #2", "2x", "$0.204", "—", "$0.204"],
        ["Pipeline #1 + #2", "2x", "$0.012", "~$2-6 (EL+HG)", "$2-6"],
        ["Nightly Summary", "1x", "$0.005", "—", "$0.005"],
        ["GDrive Backup", "3x", "$0.012", "—", "$0.012"],
        ["**Total**", "", "**~$0.25**", "**~$2-6**", "**~$2.50-6.50**"],
    ])

    doc.save(f"{OUT}/32-daily-crons.pdf")
    print("  32-daily-crons.pdf")


def doc_33_weekly_crons():
    doc = BrandPDF("Weekly Cron Jobs", "Knowledge Sprint, Video Report, Reconciliation, Cleanup")

    doc.h1("Weekly Schedule")
    doc.table([
        ["Day", "Time", "Job", "Agent", "Model", "Cost"],
        ["Sunday", "6:00 AM", "Cleanup Manager", "—", "Local script", "Free"],
        ["Sunday", "10:00 AM", "Knowledge Research Sprint", "Main (Branson)", "Haiku", "~$0.50"],
        ["Sunday", "9:00 PM", "Knowledge Reconciliation", "Scheduler", "Haiku", "~$0.10"],
        ["Monday", "8:00 AM", "Weekly Video Report", "Builder Manager", "Haiku", "~$0.005"],
    ])

    doc.divider()

    doc.h1("Sunday 6:00 AM — Cleanup Manager")
    doc.body(
        "A local script (zero cost) that cleans temp files, old logs, and expired data. "
        "Runs via launchd, not the OpenClaw gateway."
    )

    doc.divider()

    doc.h1("Sunday 10:00 AM — Knowledge Research Sprint")
    doc.table([
        ["Detail", "Value"],
        ["Agent", "Main (Branson)"],
        ["Model", "Haiku"],
        ["Timeout", "600 seconds (10 minutes)"],
        ["Cost per run", "~$0.50 (spawns sub-agents)"],
    ])
    doc.h2("What It Does")
    doc.numbered([
        "Queries Supabase knowledge database for category distribution",
        "Identifies the 5 thinnest categories (under 15 entries each)",
        "Spawns a Research sub-agent per category (model: Haiku)",
        "Each sub-agent generates 10 knowledge entries as JSONL",
        "Ingests entries via `knowledge-ingest.sh` → Supabase POST + embedding + publishing",
        "Posts summary to Discord with total knowledge entry count",
    ])
    doc.h2("Why It Matters")
    doc.body(
        "This is how your knowledge base grows automatically. Every Sunday, the system "
        "identifies gaps and fills them. Over time, your agents get smarter because they "
        "have more knowledge to draw from when answering questions and writing content."
    )

    doc.divider()

    doc.h1("Sunday 9:00 PM — Knowledge Reconciliation")
    doc.table([
        ["Detail", "Value"],
        ["Agent", "Scheduler"],
        ["Timeout", "Default"],
        ["Cost per run", "~$0.10"],
    ])
    doc.body(
        "Runs `knowledge-reconcile.py` which finds contradictions, stale entries, "
        "and near-duplicates across both knowledge databases. Uses Haiku for "
        "contradiction detection and staleness checks against current agent SOUL.md files."
    )

    doc.divider()

    doc.h1("Monday 8:00 AM — Weekly Video Report")
    doc.table([
        ["Detail", "Value"],
        ["Agent", "Builder Manager"],
        ["Model", "Haiku"],
        ["Cost per run", "~$0.005"],
        ["Discord delivery", "Video pipeline channel"],
    ])
    doc.body(
        "Runs `weekly-video-report.sh` and posts a summary of last week's video "
        "pipeline performance: videos created, published, failed, average costs."
    )

    doc.divider()

    doc.h1("Weekly Cost Total")
    doc.body("All weekly crons combined: **~$0.60/week** or ~$2.50/month.")

    doc.save(f"{OUT}/33-weekly-crons.pdf")
    print("  33-weekly-crons.pdf")


def doc_34_system_crons():
    doc = BrandPDF("System Services", "LaunchD daemons and background processes")

    doc.h1("What Are LaunchD Services?")
    doc.body(
        "These are macOS-level background processes that run independently of the "
        "AI agents. They handle infrastructure: keeping the Dashboard alive, running "
        "backups, monitoring costs, and watching for changes. All are **free** (no API cost)."
    )
    doc.body(
        "They're NOT shown in the Dashboard Schedule view because they're managed by "
        "macOS, not OpenClaw. To check their status, ask Branson or look in the "
        "system logs."
    )

    doc.h1("Active Services")

    doc.h2("Dashboard Server (Always On)")
    doc.table([
        ["Detail", "Value"],
        ["Service", "com.aiwh.dashboard"],
        ["What", "Node.js Express server on port 3001"],
        ["Starts", "At login (RunAtLoad)"],
        ["Restarts", "Automatically if crashes (KeepAlive)"],
        ["Logs", "/opt/AIWH/logs/dashboard.log, dashboard-error.log"],
    ])

    doc.h2("Spend Watchdog (Always On)")
    doc.table([
        ["Detail", "Value"],
        ["Service", "com.aiwh.spend-watchdog"],
        ["What", "Monitors AI spend every 10 seconds"],
        ["Alerts", "Warning at 90% of daily budget, Critical at 100%"],
        ["Cooldown", "8-hour buckets (max 3 alerts/day)"],
        ["Logs", "/opt/AIWH/core/logs/spend-watchdog.log"],
    ])

    doc.h2("Local Backup (Hourly)")
    doc.table([
        ["Detail", "Value"],
        ["Service", "com.aiwh.backup-local"],
        ["What", "Creates encrypted archive to ~/Desktop/AIWH-Backups/"],
        ["Frequency", "Every 1 hour"],
        ["Retention", "6 rolling archives"],
        ["Encryption", "AES-256-CBC with PBKDF2 (100,000 iterations)"],
    ])

    doc.h2("GDrive Backup (3x Daily)")
    doc.table([
        ["Detail", "Value"],
        ["Service", "com.aiwh.backup-gdrive"],
        ["What", "Uploads newest encrypted archive to Google Drive"],
        ["Schedule", "12:15am, 8:15am, 4:15pm Brisbane"],
        ["Retention", "21 archives on Drive (7 days)"],
    ])

    doc.h2("Cleanup Manager (Weekly)")
    doc.table([
        ["Detail", "Value"],
        ["Service", "com.aiwh.cleanup"],
        ["What", "Cleans temp files, old logs, expired data"],
        ["Schedule", "Sunday 6:00 AM"],
    ])

    doc.divider()

    doc.h1("Checking Service Status")
    doc.body("Ask Branson:")
    doc.bullet([
        '"Are all my system services running?"',
        '"When was the last successful backup?"',
        '"Is the spend watchdog active?"',
        '"Show me the dashboard error log"',
    ])
    doc.body("Or from the Mac Mini terminal:")
    doc.code("launchctl list | grep com.aiwh")

    doc.h1("If a Service Crashes")
    doc.body(
        "Most services have **KeepAlive** enabled — macOS restarts them automatically. "
        "If the Dashboard or Spend Watchdog are down for more than a few minutes, "
        "check the error logs or power-cycle the Mac Mini."
    )
    doc.callout(
        "Power cycling (unplug, wait 10s, plug back in) fixes most service issues. "
        "All services auto-start on boot.",
        "TIP"
    )

    doc.save(f"{OUT}/34-system-crons.pdf")
    print("  34-system-crons.pdf")


def doc_35_creating_crons():
    doc = BrandPDF("Creating Your Own Crons", "Add custom automated tasks — step by step")

    doc.h1("Two Ways to Create Crons")
    doc.card_grid([
        ("Via Branson (Easiest)", 'Tell Branson what you want: "Add a cron that runs the '
         'Research agent every Monday at 9am to compile a competitor report." He handles everything.'),
        ("Via Dashboard (Manual)", "Use the Schedule view to configure agent crons and "
         "script crons yourself. More control over every detail."),
    ])

    doc.h1("Creating an Agent Cron (Dashboard)")
    doc.numbered([
        "Open the **Schedule** view",
        "Click **Add Agent Cron**",
        "Select the **agent** (Research, Copywriter, CFO, etc.)",
        "Set the **frequency** — once, daily, weekly, or monthly",
        "Set the **time** (in your timezone)",
        "Write the **prompt** — the exact instructions the agent follows each run",
        "Choose a **delivery channel** — which Discord channel gets the output",
        "Set a **timeout** — how long the agent can run (default varies by agent)",
        "Click **Save**",
    ])
    doc.callout(
        "The prompt is the most important part. Be specific about what the agent "
        "should do, what format the output should be in, and where to deliver it. "
        "Vague prompts get vague results.",
        "TIP"
    )

    doc.h2("Example Agent Cron Prompts")
    doc.table([
        ["Goal", "Agent", "Schedule", "Prompt"],
        ["Weekly competitor scan", "Research", "Monday 9am",
         '"Search the web for [competitor names]. Report on their latest content, pricing changes, '
         'and new features. Post summary to Discord."'],
        ["Daily social engagement check", "Social", "6pm daily",
         '"Check Instagram and X analytics for today. Report: impressions, engagement rate, '
         'top-performing post. Compare to yesterday."'],
        ["Monthly financial summary", "CFO", "1st of month, 8am",
         '"Compile last month\'s total AI spend, broken down by agent and model tier. '
         'Include comparison to previous month. Post to #finance."'],
    ])

    doc.divider()

    doc.h1("Creating a Script Cron (Free)")
    doc.numbered([
        "Click **Add Script Cron** in the Schedule view",
        "Enter the **script path** (full path to a .sh or .py file)",
        "Set the **schedule** (same options: once, daily, weekly, monthly + time)",
        "Set the **timezone** (default: Australia/Brisbane)",
        "Add a **description** for the Schedule view",
        "Click **Save**",
    ])
    doc.body(
        "Script crons run locally on your Mac Mini with **zero API cost**. Use them "
        "for backups, data exports, cleanup, report generation, or any automation "
        "that doesn't need AI reasoning."
    )

    doc.h2("Need a Script Written?")
    doc.body("Tell Branson:")
    doc.bullet([
        '"Write me a script that exports my video job database to CSV every Friday"',
        '"Create a cleanup script that removes files older than 30 days from /tmp"',
        '"Build a report script that counts how many videos were published this week"',
    ])
    doc.body("Branson will create the script, test it, and set up the cron for you.")

    doc.divider()

    doc.h1("Editing and Managing Crons")
    doc.bullet([
        "**Edit** — Click any cron card → Edit → change schedule, prompt, or delivery",
        "**Toggle on/off** — Temporarily disable without deleting (great for holidays)",
        "**Trigger now** — Run immediately regardless of schedule (testing)",
        "**Delete** — Remove permanently (can't be undone)",
    ])

    doc.h1("Cost Awareness")
    doc.body("Before creating agent crons, consider the cost:")
    doc.table([
        ["Agent Model", "Typical Cost/Run", "If Daily", "If Weekly"],
        ["Haiku", "~$0.005-0.01", "~$0.15-0.30/mo", "~$0.02-0.04/mo"],
        ["Sonnet", "~$0.05-0.15", "~$1.50-4.50/mo", "~$0.20-0.60/mo"],
        ["Opus", "~$0.50-2.00", "~$15-60/mo", "~$2-8/mo"],
    ])
    doc.callout(
        "Ask Branson before creating expensive crons: \"How much would it cost to "
        "run the CFO agent daily?\" He'll give you an estimate based on the prompt.",
        "COST"
    )

    doc.save(f"{OUT}/35-creating-crons.pdf")
    print("  35-creating-crons.pdf")


def doc_36_troubleshooting_crons():
    doc = BrandPDF("Troubleshooting Crons", "When things don't run — how to diagnose and fix")

    doc.h1("Common Issues")

    doc.h2("Cron Didn't Fire")
    doc.table([
        ["Cause", "How to Check", "Fix"],
        ["Gateway was down", "Dashboard → Overview → Gateway status (red dot)",
         "Restart gateway: ask Branson or `openclaw gateway restart`"],
        ["Cron was disabled", "Schedule view → check toggle state",
         "Re-enable the toggle"],
        ["Wrong timezone", "Click cron → check timezone setting",
         "Edit cron, set to Australia/Brisbane"],
        ["Mac Mini was off", "Check uptime — was it powered on at scheduled time?",
         "Ensure Mac Mini stays powered on 24/7"],
    ])
    doc.callout(
        "When the gateway restarts, it catches up on overdue crons immediately. "
        "If a cron was supposed to fire at 8am and the gateway restarted at 8:15, "
        "the cron runs at 8:15.",
        "NOTE"
    )

    doc.h2("Cron Ran But No Output")
    doc.table([
        ["Cause", "How to Check", "Fix"],
        ["Delivery channel wrong", "Click cron → check delivery config",
         "Update to correct Discord channel ID"],
        ["Delivery mode is 'none'", "Click cron → delivery.mode",
         "Change to explicit channel delivery"],
        ["Discord bot offline", "Check Discord server — is the bot showing online?",
         "Check bot token in Channels view, reconnect if needed"],
        ["Agent errored silently", "Dashboard → Logs → select the agent",
         "Read error logs for the specific failure"],
    ])

    doc.h2("Cron Errors or Fails")
    doc.table([
        ["Error", "Common Cause", "Fix"],
        ["Timeout", "Task took longer than allowed", "Increase timeout in cron settings"],
        ["API rate limit", "Too many requests to ElevenLabs/HeyGen", "Space crons further apart"],
        ["Script not found", "Script path wrong or file deleted", "Verify path exists: ls -la /path/to/script"],
        ["Permission denied", "Script not executable", "chmod +x /path/to/script"],
        ["Knowledge search fails", "Database connection issue", "Ask Branson to run a health check"],
    ])

    doc.divider()

    doc.h1("Where to Find Logs")
    doc.table([
        ["Cron Type", "Log Location"],
        ["Agent crons (all)", "Dashboard → Logs view → select agent name"],
        ["Video pipeline agents", "/opt/AIWH/client/logs/video-*-agent.log"],
        ["Script crons", "Depends on script — usually /opt/AIWH/client/logs/ or /opt/AIWH/core/logs/"],
        ["LaunchD services", "Specific to each service (see System Services doc)"],
        ["Backup crons", "~/Desktop/AIWH-Backups/logs/"],
        ["Gateway logs", "/opt/AIWH/.openclaw/logs/"],
    ])

    doc.h1("Quick Diagnosis via Branson")
    doc.body("Instead of digging through logs yourself, ask Branson:")
    doc.bullet([
        '"Why didn\'t the morning briefing run today?"',
        '"What happened with the video pipeline at 9am?"',
        '"Show me errors from the last 24 hours"',
        '"Is the Copywriter cron healthy?"',
        '"Run the nightly summary right now — I want to test it"',
    ])

    doc.divider()

    doc.h1("Known Issues")
    doc.table([
        ["Issue", "Impact", "Workaround"],
        ["delivery.channel: 'last'", "Output goes to wrong/random Discord channel",
         "Edit cron → set explicit channel ID"],
        ["Gateway restart during cron", "Cron may run twice (catch-up + scheduled)",
         "Not harmful but may produce duplicate output"],
        ["Script cron path with spaces", "Script won't execute",
         'Wrap path in quotes or rename without spaces'],
    ])

    doc.callout(
        "If a cron consistently fails, don't just keep re-triggering it. Ask Branson "
        "to diagnose: \"The Copywriter cron has failed 3 times this week — investigate.\"",
        "TIP"
    )

    doc.save(f"{OUT}/36-troubleshooting-crons.pdf")
    print("  36-troubleshooting-crons.pdf")


if __name__ == '__main__':
    print("Generating 38.4 — Cron Job docs (PDF)...")
    doc_31_cron_overview()
    doc_32_daily_crons()
    doc_33_weekly_crons()
    doc_34_system_crons()
    doc_35_creating_crons()
    doc_36_troubleshooting_crons()
    print(f"Done! 6 PDFs + 6 HTMLs in {OUT}")
