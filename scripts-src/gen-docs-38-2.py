#!/usr/bin/env python3
"""Generate Phase 38.2 — Daily Operations docs (10-series) as branded PDF."""

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'lib'))
from pdf_brand import BrandPDF

OUT = '/opt/AIWH/core/docs/user-guide/10-daily-operations'
os.makedirs(OUT, exist_ok=True)


def doc_11_morning_routine():
    doc = BrandPDF("Your Morning Routine", "What happens automatically every day — and what it costs")

    doc.h1("The Daily Cycle")
    doc.body(
        "Every day, your AIWH system runs a sequence of automated tasks — generating "
        "video topics, writing scripts, producing videos, and monitoring costs. You don't "
        "need to start any of this manually. By the time you check in, work is already done."
    )
    doc.body(
        "All times are in **Brisbane/AEST** (UTC+10). The system uses this timezone "
        "consistently across all scheduling."
    )

    doc.h1("Morning Sequence (7–9 AM)")

    doc.h2("7:00 AM — Video Topic Generation")
    doc.body(
        "The **Research** agent wakes up first. It determines today's 2 video pillars "
        "from a **3-day rotation** of your 6 content pillars. It checks the topic queue "
        "for duplicates, searches the web for trending news in your industry, and "
        "generates exactly 2 unique topics."
    )
    doc.bullet([
        "Each topic: 130-160 words max, 60-character title",
        "If breaking news scores high on the urgency scale (50+/100), a priority review is created",
        "Topics stored as drafts in `video-jobs.db`, ready for the Copywriter",
        "**Cost:** ~$0.008 per run (Haiku model)",
    ])

    doc.h2("8:00 AM — Morning Briefing")
    doc.body(
        "The **Scheduler** agent compiles a morning briefing and posts it to your "
        "Discord operations channel:"
    )
    doc.bullet([
        "**Spend status** — yesterday's total and today's budget remaining",
        "**System health** — gateway, agents, cron status",
        "**Content pipeline** — videos in progress, queued, stuck, or failed",
        "**Backup status** — last successful backup time and age",
        "**Cost:** ~$0.005 per run (Haiku model)",
    ])

    doc.h2("8:00 AM — Copywriter #1 (Morning Script)")
    doc.body(
        "The **Copywriter** agent picks the first of today's topics. Before writing, it "
        "searches your knowledge base for relevant context — industry patterns, proven "
        "frameworks, your brand voice. Then it crafts a script following a tight structure:"
    )
    doc.numbered([
        "**Hook** — Grabs attention in the first 3 seconds",
        "**Problem** — Names the pain point your audience feels",
        "**Framework** — Delivers the insight or method",
        "**Example** — Makes it concrete and relatable",
        "**CTA** — Tells them what to do next",
    ])
    doc.body(
        "The output is **130-160 words of clean spoken text** (52-64 seconds at natural "
        "pace) plus platform-specific captions — one for Instagram (with hashtags) and "
        "one for X/Twitter (conversational, no hashtags)."
    )
    doc.callout(
        "This is your most expensive daily cron at ~$0.10 per run because it uses the "
        "Sonnet model for creative quality. That's ~$3.10/month for morning scripts alone.",
        "COST"
    )

    doc.h2("9:00 AM — Video Pipeline #1 (Morning Production)")
    doc.body(
        "The **Video** agent takes the scripted topic and runs it through the full "
        "production pipeline — voice, avatar, captions, QA, and publishing. This "
        "takes 30-40 minutes but costs very little in AI tokens (~$0.006) because "
        "it's mostly orchestrating external APIs."
    )
    doc.body("See the next document (Video Pipeline) for the full breakdown.")

    doc.divider()

    doc.h1("Afternoon Sequence (1–2 PM)")

    doc.h2("1:00 PM — Copywriter #2 (Afternoon Script)")
    doc.body(
        "Same process as morning, but for the second topic. Second pillar from today's "
        "rotation. Same cost (~$0.10)."
    )

    doc.h2("2:00 PM — Video Pipeline #2 (Afternoon Production)")
    doc.body(
        "Same pipeline. By 3 PM, both of today's videos are typically scheduled for "
        "publishing via Buffer."
    )

    doc.divider()

    doc.h1("Evening & Night (10 PM – 12 AM)")

    doc.h2("10:00 PM — Nightly System Summary")
    doc.body(
        "The Scheduler compiles a comprehensive end-of-day report: total spend, system "
        "health issues, pipeline status, backup health, and specific problems (missed "
        "crons, failed backups, budget warnings, disk usage over 80%). Cost: ~$0.005."
    )

    doc.h2("11:00 PM — Knowledge Extraction")
    doc.body(
        "A background process scans the day's agent sessions and memory files, "
        "extracting reusable knowledge patterns. High-confidence patterns are "
        "staged for review. This is a local script — **zero API cost**."
    )

    doc.h2("11:30 PM — Backup Snapshot")
    doc.body(
        "A full system snapshot is created and archived locally. This runs in "
        "addition to the hourly incremental backups. **Zero API cost.**"
    )

    doc.divider()

    doc.h1("Daily Cost Summary")
    doc.table([
        ["Cron Job", "Model", "Cost Per Run", "Monthly Cost"],
        ["Topic Generator (7am)", "Haiku", "~$0.008", "~$0.24"],
        ["Morning Briefing (8am)", "Haiku", "~$0.005", "~$0.15"],
        ["Copywriter #1 (8am)", "Sonnet", "~$0.102", "~$3.10"],
        ["Video Pipeline #1 (9am)", "Haiku", "~$0.006", "~$0.17"],
        ["Copywriter #2 (1pm)", "Sonnet", "~$0.102", "~$3.10"],
        ["Video Pipeline #2 (2pm)", "Haiku", "~$0.006", "~$0.17"],
        ["Nightly Summary (10pm)", "Haiku", "~$0.005", "~$0.15"],
        ["Knowledge Extract (11pm)", "Local", "Free", "Free"],
        ["Backup Snapshot (11:30pm)", "Local", "Free", "Free"],
    ])
    doc.body(
        "**Typical daily cron cost: ~$0.24.** However, real daily spend averages "
        "$2-3/day because of script validation retries, knowledge research, "
        "Branson conversations, and ad-hoc agent tasks. Budget $75-100/month."
    )

    doc.callout(
        "Light days (weekends): $0.50-1. Normal weekdays: $1-3. Peak days "
        "(knowledge research sprints): $6-7. All well within the $10/day budget.",
        "NOTE"
    )

    doc.divider()

    doc.h1("Always Running Services")
    doc.table([
        ["Service", "What It Does", "Frequency", "Cost"],
        ["Dashboard Server", "Web interface on port 3001", "Always on", "Free (Node.js)"],
        ["Spend Watchdog", "Monitors costs, alerts at 90% budget", "Every 10 sec", "Free (shell)"],
        ["Local Backup", "Encrypted archive to Desktop", "Every hour", "Free"],
        ["GDrive Backup", "Uploads encrypted backup to Google Drive", "3x daily", "Free"],
        ["File Watchdog", "Watches for control file changes", "On file change", "Free"],
    ])

    doc.h1("Weekly Events")
    doc.table([
        ["Day", "Time", "Job", "What It Does", "Cost"],
        ["Sunday", "6:00 AM", "Cleanup Manager", "Cleans temp files, old logs", "Free"],
        ["Sunday", "10:00 AM", "Knowledge Sprint",
         "Identifies thin knowledge categories, researches 10 entries per gap", "~$0.50"],
        ["Sunday", "9:00 PM", "Knowledge Reconciliation",
         "Finds contradictions, stale entries, duplicates in knowledge base", "~$0.10"],
        ["Monday", "8:00 AM", "Weekly Video Report",
         "Summary of last week's video pipeline performance", "~$0.005"],
    ])

    doc.h1("Changing the Schedule")
    doc.body("There are two ways to change when things run:")

    doc.h2("Via the Dashboard")
    doc.body(
        "Open the **Schedule** view. Click any cron card to edit its time, "
        "frequency, or disable it. You can also add entirely new crons — "
        "both agent crons (AI-powered) and script crons (free shell scripts)."
    )

    doc.h2("Via Branson")
    doc.body("Just tell him what you want. Examples:")
    doc.bullet([
        '"Change my video schedule to 3 videos per day instead of 2"',
        '"Move the morning briefing to 9am instead of 8am"',
        '"Pause the afternoon video pipeline for this week"',
        '"Add a weekly report every Friday at 5pm summarising my content performance"',
    ])

    doc.callout(
        "Branson can create, modify, and delete crons. He'll confirm the change "
        "before applying it and tell you the cost impact.",
        "TIP"
    )

    doc.save(f"{OUT}/11-your-morning-routine.pdf")
    print("  11-your-morning-routine.pdf")


def doc_12_video_pipeline():
    doc = BrandPDF("The Video Pipeline", "How your videos get created — and how to customise them")

    doc.h1("Two Pipelines")
    doc.body(
        "AIWH runs two separate video production systems:"
    )
    doc.card_grid([
        ("Standard Pipeline", "Fully autonomous. 2 videos/day. 50-70 seconds each. "
         "~$2-4/video total (AI + APIs). Daily crons."),
        ("Cinematic Pipeline", "Semi-autonomous with review gates. 2-5 minutes each. "
         "~$10-25/video. Triggered manually."),
    ])

    doc.divider()
    doc.h1("Standard Pipeline — The 7 Stages")
    doc.body("Each video passes through 7 stages. If any stage fails, "
             "it rolls back one step only — preserving work already paid for.")

    doc.h2("Stage 1: Topic Generation (Research Agent)")
    doc.body(
        "Topics come from your **6 content pillars** on a 3-day rotation:"
    )
    doc.table([
        ["Pillar", "Theme", "Avatar Look"],
        ["Demand Signals", "AI scrapes forums for customer pain points", "n11 (9:16)"],
        ["Authority Engine", "Repurpose one video into 10 content pieces", "n9 (16:9)"],
        ["Traction Machine", "AI operates all channels: organic, paid, cold, referral", "n20 (16:9)"],
        ["Proof of Work", "Document the build, results, mistakes", "n16 (9:16)"],
        ["Operations Live", "System reporting, monitoring, orchestration", "n4 (16:9)"],
        ["Compound Effect", "Audience and authority compound automatically", "n8 (9:16)"],
    ])
    doc.body(
        "The rotation pairs 2 pillars per day: Day 1 = Demand Signals + Authority Engine, "
        "Day 2 = Traction Machine + Proof of Work, Day 3 = Operations Live + Compound Effect. "
        "Then it repeats."
    )

    doc.h2("Stage 2: Script Writing (Copywriter Agent)")
    doc.body(
        "The Copywriter searches your knowledge base first, then writes a 130-160 word "
        "script following Hook → Problem → Framework → Example → CTA. Also writes "
        "platform-specific captions:"
    )
    doc.bullet([
        "**Instagram caption:** ≤220 chars, hashtags, emoji, soft CTA",
        "**X/Twitter caption:** ≤280 chars, conversational, NO hashtags",
        "Both stored in the same field, separated by `---X---`",
    ])

    doc.h2("Stage 3: Voice (ElevenLabs API)")
    doc.body(
        "Script → MP3 audio using your configured voice. Typically 52-64 seconds. "
        "Audio backed up to Google Drive. Cost: ~$0.0015/minute."
    )

    doc.h2("Stage 4: Avatar (HeyGen API)")
    doc.body(
        "Audio → talking-head avatar video. 1080x1920 vertical for Reels. "
        "Each pillar has its own HeyGen avatar look (configured in "
        "`avatar-config.json`). Polls for 3-5 minutes until complete."
    )

    doc.h2("Stage 5: Captions (Whisper + ffmpeg, local)")
    doc.body(
        "Whisper transcribes audio locally (free), generates subtitles, then ffmpeg "
        "burns them into the video as white bold text with black outline. Final video "
        "uploaded to **Cloudflare R2** (Instagram blocks Google Drive URLs)."
    )

    doc.h2("Stage 6: Quality Assurance (automated)")
    doc.bullet([
        "**Duration:** Must be 50-70 seconds (word count was wrong → resets to scripting)",
        "**Captions:** OCR scan confirms captions are visible",
        "**Audio:** Volume levels consistent, not clipping",
        "**File:** Video plays correctly and is over 1MB",
    ])
    doc.body("If QA fails, you get a Discord notification with the exact failure reason.")

    doc.h2("Stage 7: Publishing (Buffer API)")
    doc.body(
        "Schedules the video through Buffer to Instagram Reels and/or X. Uses the "
        "right caption for each platform. Picks the next available posting slot from "
        "your content calendar."
    )

    doc.h2("Status Flow")
    doc.code(
        "draft → planned → scripted → voice_ready → avatar_ready\n"
        "  → captioned → qa_passed → scheduled → posted"
    )

    doc.divider()

    doc.h1("Customising Your Videos")
    doc.body(
        "Everything about the video pipeline is customisable. Here's how to change "
        "each aspect — most of it is just telling Branson what you want."
    )

    doc.h2("Change Your Content Pillars")
    doc.body(
        "The 6 pillars above are defaults for AI coaching. If your business is "
        "different (e.g., real estate, SaaS, fitness), tell Branson:"
    )
    doc.bullet([
        '"Branson, replace my 6 video pillars. My business is [industry]. Create 6 pillars that match: [pillar ideas]"',
        '"Change the 3-day rotation to focus more on [pillar name] — I want it twice per cycle"',
    ])
    doc.body(
        "Branson updates `avatar-config.json` with new pillar names, descriptions, "
        "and rotation schedule."
    )

    doc.h2("Change Your Brand Voice")
    doc.body(
        "The default voice is trained on Taki Moore's coaching style — direct, "
        "transformation-focused. To match your brand:"
    )
    doc.bullet([
        '"Branson, update my content voice. I want [casual/professional/authoritative]. Here\'s an example of how I write: [paste example]"',
        '"Upload these 10 emails/posts as voice training examples" (via document ingestion)',
        "Branson updates the Copywriter's training to match your tone",
    ])

    doc.h2("Change Your Avatar")
    doc.body("You can use any HeyGen avatar — your own face, a stock avatar, or different looks per pillar:")
    doc.bullet([
        '"Branson, use my custom HeyGen avatar. The avatar ID is [id]"',
        '"Use a different avatar look for each pillar"',
        "Branson updates `avatar-config.json` with the new avatar IDs",
    ])

    doc.h2("Change Your Voice")
    doc.body("Clone your voice in ElevenLabs, then:")
    doc.bullet([
        '"Branson, switch to my cloned voice. The ElevenLabs voice ID is [id]"',
        "Branson updates `voice-config.json` and the voice agent uses your voice for all future videos",
    ])

    doc.h2("Change Posting Schedule & Platforms")
    doc.bullet([
        '"Post at 10am, 2pm, and 6pm instead of the default times"',
        '"Post to Instagram and TikTok, stop posting to X"',
        '"Only post 1 video per day on weekends"',
    ])

    doc.h2("Change Caption Style")
    doc.bullet([
        '"Make my Instagram captions longer with a story hook"',
        '"No emojis in captions, keep them professional"',
        '"Always include my website link in X captions"',
    ])

    doc.callout(
        "Every customisation persists — Branson saves changes to config files that "
        "survive restarts and updates. Your system diverges from the defaults over "
        "time. That's the feature, not a bug.",
        "NOTE"
    )

    doc.divider()

    doc.h1("Cinematic Pipeline (Advanced)")
    doc.body(
        "For longer, higher-quality videos. You create a job in the **Production** "
        "view with a title, brief, and settings. The pipeline has 5 human review gates."
    )

    doc.numbered([
        "**Analysis** — Claude Sonnet creates style bible + production plan + narration script (~$0.50)",
        "**Reference Images** — Google Imagen 3 generates visual references — you review & approve (~$0.04/image)",
        "**Keyframes** — First and last frames per clip — you review & approve (~$0.04/frame)",
        "**Video Clips** — Google Veo 3.1 interpolates between keyframes — you review & approve (~$0.80/clip)",
        "**Narration** — ElevenLabs voiceover (~$0.10)",
        "**Assembly** — ffmpeg concatenates, syncs audio, burns captions (free)",
        "**Final Review** — You watch and approve or reject with notes",
    ])

    doc.body("**Typical cinematic video cost: $10-25** depending on clip count and avatar usage.")

    doc.save(f"{OUT}/12-video-pipeline.pdf")
    print("  12-video-pipeline.pdf")


def doc_13_content_calendar():
    doc = BrandPDF("The Content Calendar", "Understanding, managing, and customising your schedule")

    doc.h1("The Schedule View")
    doc.body(
        "The **Schedule** view in the Dashboard shows everything that runs "
        "automatically. There are two types:"
    )
    doc.card_grid([
        ("Agent Crons", "Jobs that run an AI agent at a set time. Uses API tokens. "
         "Example: Copywriter writing a script at 8am."),
        ("Script Crons", "Shell scripts on a schedule. Zero API cost. "
         "Example: Backups, cleanup, monitoring."),
    ])

    doc.h1("Reading the Calendar")
    doc.body(
        "Two modes: **Calendar** (visual timeline, 15-minute granularity) and "
        "**List** (sorted by next run time). Click any job card to see:"
    )
    doc.bullet([
        "**Full configuration** — schedule, agent, model, timeout",
        "**Last run** — when it last executed, success or failure",
        "**Delivery** — which Discord channel receives the output",
        "**Prompt** — the exact instructions the agent follows",
        "**Cost history** — what this cron typically costs per run",
    ])

    doc.h1("Your Default Schedule (with costs)")
    doc.table([
        ["Time", "Job", "Agent", "Model", "Cost/Run"],
        ["7:00 AM", "Video Topics", "Research", "Haiku", "~$0.008"],
        ["8:00 AM", "Morning Briefing", "Scheduler", "Haiku", "~$0.005"],
        ["8:00 AM", "Copywriter #1", "Copywriter", "Sonnet", "~$0.10"],
        ["9:00 AM", "Video Pipeline #1", "Video", "Haiku", "~$0.006"],
        ["1:00 PM", "Copywriter #2", "Copywriter", "Sonnet", "~$0.10"],
        ["2:00 PM", "Video Pipeline #2", "Video", "Haiku", "~$0.006"],
        ["10:00 PM", "Nightly Summary", "Scheduler", "Haiku", "~$0.005"],
        ["11:00 PM", "Knowledge Extract", "—", "Local", "Free"],
        ["11:30 PM", "Backup Snapshot", "—", "Local", "Free"],
        ["Hourly", "Local Backup", "—", "Local", "Free"],
        ["3x Daily", "GDrive Backup", "Scheduler", "Haiku", "~$0.004"],
    ])

    doc.h1("Changing the Schedule")

    doc.h2("Via the Dashboard")
    doc.numbered([
        "Open the **Schedule** view",
        "Click any cron card to open its detail modal",
        "Click **Edit** to change time, frequency, prompt, or delivery channel",
        "Use the **Toggle** button to temporarily enable/disable without deleting",
        "Click **Trigger** to run any cron immediately (useful for testing)",
    ])

    doc.h2("Via Branson (Recommended)")
    doc.body("Tell Branson what you want in plain language:")
    doc.bullet([
        '"Move the morning briefing to 9am"',
        '"Change to 3 videos per day — add a third at 6pm"',
        '"Pause all video crons for the next 3 days — I\'m on holiday"',
        '"Add a new cron: every Monday at 9am, have the Research agent compile a competitor analysis"',
        '"How much would it cost to add a third daily video?"',
    ])

    doc.h2("Adding a New Agent Cron")
    doc.numbered([
        "In Schedule view, click **Add Agent Cron**",
        "Select the **agent** (e.g., Research, Copywriter, CFO)",
        "Set the **schedule** — once, daily, weekly, or monthly + time",
        "Write the **prompt** — what the agent should do each run",
        "Choose a **delivery channel** — which Discord channel gets the output",
        "Click **Save** — starts at the next scheduled time",
    ])

    doc.h2("Adding a Script Cron (Free)")
    doc.numbered([
        "Click **Add Script Cron**",
        "Enter the **script path** (e.g., `/opt/AIWH/core/scripts/my-report.sh`)",
        "Set the **schedule** and timezone (defaults to Australia/Brisbane)",
        "Click **Save**",
    ])

    doc.callout(
        "Script crons run locally with zero API cost. Use them for backups, "
        "cleanup, data exports, or any shell script you want automated. "
        "Ask Branson to write the script if you need one.",
        "TIP"
    )

    doc.h1("Things to Know")
    doc.bullet([
        "**Crons don't stack** — if a cron is still running when its next scheduled time arrives, it waits",
        "**Gateway restart catches up** — if the gateway restarts, overdue crons fire immediately",
        "**Delivery channel matters** — set it to the right Discord channel or the output goes nowhere",
        "**Timeouts prevent runaway costs** — each cron has a max runtime (e.g., 300s for copywriter, 2400s for video pipeline)",
    ])

    doc.save(f"{OUT}/13-content-calendar.pdf")
    print("  13-content-calendar.pdf")


def doc_14_checking_costs():
    doc = BrandPDF("Checking Your Costs", "Understanding where your money goes — and controlling it")

    doc.h1("The Costs View")
    doc.body(
        "The **Costs** view gives you full visibility into how much your AI "
        "agents are spending. Every API call is tracked and categorised by "
        "agent, model tier, and platform."
    )

    doc.h1("What You'll See")

    doc.h2("Daily & Monthly Progress Bars")
    doc.body(
        "At the top: your current spend vs budget. The daily budget resets "
        "every midnight AEST. Monthly resets on the 1st."
    )
    doc.table([
        ["Setting", "Default", "How to Change"],
        ["Daily Budget", "$10.00", "Costs view → click budget → edit, or tell Branson"],
        ["Monthly Budget", "$200.00", "Same as above"],
        ["Warning Threshold", "90% of daily", "Config view → Settings"],
    ])

    doc.h2("Real-World Cost Expectations")
    doc.body("Based on actual observed spending (March 2026):")
    doc.table([
        ["Scenario", "Daily Cost", "Monthly Cost"],
        ["Light day (weekend, no videos)", "$0.50 – $1.00", "—"],
        ["Normal weekday (2 videos + routine)", "$1.00 – $3.00", "—"],
        ["Peak day (knowledge sprint + videos)", "$5.00 – $7.00", "—"],
        ["**Average month**", "**~$2.50/day**", "**~$75 – $100**"],
    ])

    doc.h2("Spend by Model Tier")
    doc.body("Shows which AI model tier is costing the most:")
    doc.table([
        ["Tier", "Cost per Message", "Share of Spend", "Used For"],
        ["Haiku", "~$0.001", "~20%", "Research, scheduling, monitoring, video orchestration"],
        ["Sonnet", "~$0.01", "~65%", "Script writing, sales copy, financial analysis"],
        ["Opus", "~$0.05", "~15%", "Strategy, code generation (on-demand only)"],
        ["Llama (local)", "Free", "0%", "Cron scheduling (runs on your Mac Mini)"],
    ])

    doc.h2("Platform Spend (Video Pipeline APIs)")
    doc.body("Separate from AI model costs — these are third-party APIs:")
    doc.table([
        ["Service", "What It Does", "Cost", "Monthly Estimate"],
        ["ElevenLabs", "Voice synthesis", "$0.0015/min audio", "~$2-3"],
        ["HeyGen", "Avatar video", "$0.005/call + subscription", "~$29-89 (plan)"],
        ["Google Imagen", "Cinematic images", "$0.04/image", "Only when used"],
        ["Google Veo", "Cinematic clips", "$0.80/8s clip", "Only when used"],
        ["Buffer", "Social scheduling", "Free or $6/channel/mo", "$0-12"],
    ])

    doc.h2("30-Day Trend Chart")
    doc.body(
        "A bar chart of daily costs over the past month. Spikes usually come from "
        "cinematic video production or Sunday knowledge research sprints."
    )

    doc.h2("Subscriptions Table")
    doc.body(
        "Fixed monthly costs — API subscriptions, services. You can add custom "
        "entries to track all your business tools in one place."
    )

    doc.divider()

    doc.h1("Cost Alerts")
    doc.table([
        ["Threshold", "What Happens", "Where You'll See It"],
        ["80% of daily budget", "Warning notification in Dashboard", "Bell icon (yellow)"],
        ["90% of daily budget", "Discord alert to operations channel", "Discord + Dashboard"],
        ["100% of daily budget", "Critical alert — budget exceeded", "Discord + Dashboard (red)"],
    ])
    doc.body(
        "Alerts use an **8-hour cooldown** — max 3 alerts per day for the same issue."
    )

    doc.callout(
        "Today's cost is always visible in the **top bar** next to the clock. "
        "It updates in real time.",
        "TIP"
    )

    doc.divider()

    doc.h1("Controlling Costs")
    doc.body("Things you can tell Branson:")
    doc.bullet([
        '"Set my daily budget to $5 instead of $10"',
        '"What\'s my most expensive cron job? Can we use a cheaper model?"',
        '"Pause cinematic video production — I only want standard pipeline this month"',
        '"Show me a cost breakdown for last week"',
        '"Alert me at 70% of budget instead of 90%"',
    ])

    doc.h2("Cost-Saving Tips")
    doc.bullet([
        "**Reduce to 1 video/day** — saves ~$3/month in Sonnet costs",
        "**Use Haiku for copywriting** — cheaper but lower creative quality",
        "**Disable knowledge sprints** — saves ~$2/month, but knowledge stops growing",
        "**Use script crons** for local tasks — zero cost (backups, cleanup, reports)",
    ])

    doc.save(f"{OUT}/14-checking-costs.pdf")
    print("  14-checking-costs.pdf")


def doc_15_notifications():
    doc = BrandPDF("Notifications & Where Things Live",
                   "How the system keeps you informed — and where everything is stored")

    doc.h1("How Notifications Work")
    doc.body(
        "AIWH notifies you through two channels: the **Dashboard** (bell icon) and "
        "**Discord** (real-time messages). Most alerts go to both."
    )
    doc.card_grid([
        ("Dashboard Bell", "Top bar, shows unread count. Click for all notifications "
         "with timestamps and priority. Colour-coded: normal, warning, critical."),
        ("Discord Channels", "Real-time messages to purpose-built channels. "
         "Each category routes to a different channel for easy filtering."),
    ])

    doc.h1("What Gets Notified")
    doc.table([
        ["Event", "Priority", "Discord Channel"],
        ["Video script ready", "Normal", "#content-review"],
        ["Video published", "Normal", "#publish-ledger"],
        ["Video QA failed", "High", "#video-review"],
        ["Budget 90% reached", "Warning", "#operations"],
        ["Budget exceeded", "Critical", "#operations"],
        ["Morning briefing", "Normal", "#ceo-briefing"],
        ["Nightly summary", "Normal", "#nightly-ledger"],
        ["Cron missed", "Critical", "#operations"],
        ["Backup stale (>24h)", "Warning", "#operations"],
        ["Cinematic review needed", "Normal", "#cinematic-review"],
    ])

    doc.h1("Changing Notification Routing")
    doc.body("Tell Branson:")
    doc.bullet([
        '"Route all cost alerts to my #finance channel instead of #operations"',
        '"Send video notifications to WhatsApp instead of Discord"',
        '"Mute non-critical notifications on weekends"',
        '"Add an alert when a video gets more than 1000 views"',
    ])

    doc.divider()

    doc.h1("Where Everything Lives")
    doc.body(
        "Your Mac Mini has a clear folder structure. Here's what's where and why "
        "it matters."
    )

    doc.h2("Main Folders")
    doc.table([
        ["Folder", "What's In It", "Size"],
        ["/opt/AIWH/core/", "Product code, scripts, dashboard, docs", "~33 GB"],
        ["/opt/AIWH/client/", "YOUR data — videos, configs, knowledge, logs", "~3 GB"],
        ["/opt/AIWH/.openclaw/", "Agent configs, memory, credentials, cron state", "~350 MB"],
        ["/opt/AIWH/openclaw/", "OpenClaw fork (system internals)", "~1.9 GB"],
    ])

    doc.h2("Your Content")
    doc.table([
        ["Path", "What's There"],
        ["/opt/AIWH/client/content/jobs/", "Generated video files (MP4, MP3) — organised by job ID"],
        ["/opt/AIWH/client/content/cinematic/", "Cinematic video assets (keyframes, clips, finals)"],
        ["/opt/AIWH/client/data/video-jobs.db", "Video job database (topics, scripts, status)"],
        ["/opt/AIWH/client/data/client_knowledge.db", "Your private knowledge (never leaves your machine)"],
        ["/opt/AIWH/client/data/base_knowledge_cache.db", "Shared knowledge cache (synced from AIWH HQ)"],
    ])

    doc.h2("Your Configs")
    doc.table([
        ["Path", "What It Controls"],
        ["/opt/AIWH/client/config/avatar-config.json", "6 pillars, rotation, HeyGen avatar IDs per pillar"],
        ["/opt/AIWH/client/config/voice-config.json", "ElevenLabs voice choices (Mark default)"],
        ["/opt/AIWH/client/config/notifications.json", "Notification category → Discord channel routing"],
        ["/opt/AIWH/client/config/auth.json", "Dashboard password, profile, selected features"],
        ["/opt/AIWH/client/config/secrets.enc", "Encrypted API keys (AES-256-GCM)"],
    ])

    doc.h2("Logs")
    doc.table([
        ["Path", "What's Logged"],
        ["/opt/AIWH/client/logs/", "Dashboard, cost monitor, video agents, spend status (56 files)"],
        ["/opt/AIWH/.openclaw/logs/", "OpenClaw gateway and agent runtime (~55 MB)"],
        ["~/Desktop/AIWH-Backups/logs/", "Backup execution logs"],
    ])

    doc.divider()

    doc.h1("Backup System")
    doc.body("Your data is backed up in **3 independent layers**:")

    doc.h2("Layer 1: Local Snapshots")
    doc.bullet([
        "**Where:** `/opt/AIWH/core/.backups/`",
        "**Frequency:** Every 4 hours",
        "**Retention:** 12 snapshots (~2 days)",
        "**Contents:** Everything except videos/audio, git history, and browser cache",
    ])

    doc.h2("Layer 2: Desktop Archives (Encrypted)")
    doc.bullet([
        "**Where:** `~/Desktop/AIWH-Backups/archives/`",
        "**Frequency:** Every 1 hour",
        "**Retention:** 6 rolling archives",
        "**Encryption:** AES-256-CBC with 100,000 PBKDF2 iterations",
        "**Survives** a full wipe of /opt/AIWH/ — stored outside that directory",
    ])

    doc.h2("Layer 3: Google Drive (Encrypted, Off-Site)")
    doc.bullet([
        "**Where:** AIWH-Backups folder on Google Drive",
        "**Frequency:** 3x daily (12:15am, 8:15am, 4:15pm Brisbane)",
        "**Retention:** 21 archives (7 days x 3/day)",
        "**Same encryption** as Desktop archives",
        "**Survives** hardware failure — fully remote",
    ])

    doc.callout(
        "Your encryption key is at `/opt/AIWH/.openclaw/backup-encryption-key`. "
        "Without it, encrypted backups cannot be decrypted. Keep a copy in your "
        "password manager and/or a printed copy in a safe location.",
        "SECURITY"
    )

    doc.h2("What's NOT Backed Up")
    doc.bullet([
        "**Video/audio files** (.mp4, .mp3, .wav) — too large. Archived separately to AIWH-Archive on GDrive",
        "**Browser cache** — regenerated automatically",
        "**Git history** — stored in GitHub (aiwh-cli/aiwh-core)",
    ])

    doc.h2("Recovery")
    doc.body("If something goes wrong, there's a recovery guide at "
             "`/opt/AIWH/core/docs/RECOVERY.md`. The basic steps:")
    doc.numbered([
        "Stop all services (Dashboard, Gateway, crons)",
        "Decrypt the backup (openssl with your encryption key)",
        "Extract to a temp location and verify the contents",
        "Restore with rsync (excludes media to save time)",
        "Restart services and verify everything works",
    ])
    doc.body("**Estimated recovery time: under 30 minutes.**")

    doc.divider()

    doc.h1("Talking to Branson About Your System")
    doc.body("Here are things you can ask:")
    doc.bullet([
        '"When was the last backup?"',
        '"How much disk space am I using?"',
        '"Show me my backup history for the last week"',
        '"Where is my video for [topic name] stored?"',
        '"Clean up old videos from more than 30 days ago"',
    ])

    doc.h2("Things NOT to Say to Branson")
    doc.callout(
        "Branson has full system access. Avoid casual commands that could be "
        "interpreted as destructive actions. Be specific about what you want.",
        "WARNING"
    )
    doc.bullet([
        '**Don\'t say:** "Delete everything" or "Clear all data" — be specific about WHAT to delete',
        '**Don\'t say:** "Reset the system" — say what you actually want reset',
        '**Don\'t say:** "Turn everything off" — say which specific service to stop',
        '**Don\'t share** your encryption key or API keys in chat — Branson already has secure access',
        '**Do say:** "Delete videos older than 30 days from the jobs folder" — specific and safe',
    ])

    doc.save(f"{OUT}/15-notifications.pdf")
    print("  15-notifications.pdf")


if __name__ == '__main__':
    print("Generating 38.2 — Daily Operations docs (PDF)...")
    doc_11_morning_routine()
    doc_12_video_pipeline()
    doc_13_content_calendar()
    doc_14_checking_costs()
    doc_15_notifications()
    print(f"Done! 5 PDFs + 5 HTMLs in {OUT}")
