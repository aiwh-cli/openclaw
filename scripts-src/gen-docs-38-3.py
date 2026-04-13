#!/usr/bin/env python3
"""Generate Phase 38.3 — Agent docs (20-series) as branded PDF."""

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'lib'))
from pdf_brand import BrandPDF

OUT = '/opt/AIWH/core/docs/user-guide/20-agents'
os.makedirs(OUT, exist_ok=True)


def doc_21_agent_overview():
    doc = BrandPDF("Agent Overview", "Your complete AI team — who they are and what they do")

    doc.h1("How Your AI Team Works")
    doc.body(
        "Your AIWH system has **19 specialised agents** organised into 4 modules. "
        "Each agent has its own training, personality, tools, and guardrails. "
        "**Branson** (the CEO agent) coordinates them all — you rarely need to talk "
        "to individual agents directly."
    )
    doc.body(
        "Agents fall into two categories: **active** (fully trained, running daily) "
        "and **planned** (identity defined, awaiting activation when you need them). "
        "Planned agents can be activated any time by telling Branson."
    )

    doc.h1("Full Agent Roster")
    doc.table([
        ["Agent", "Module", "Role", "Model", "Cost/Msg", "Status"],
        ["Branson (main)", "System", "CEO — orchestrates all agents", "Haiku", "~$0.001", "Active"],
        ["Research", "Frontend", "Web research, trend scanning", "Haiku", "~$0.001", "Active"],
        ["Copywriter", "Frontend", "Scripts, copy, captions (130-160 words)", "Sonnet", "~$0.01", "Active"],
        ["Video", "Frontend", "Video pipeline orchestration (5 sub-agents)", "Haiku", "~$0.001", "Active"],
        ["Social", "Frontend", "Social media strategy & scheduling", "Haiku", "~$0.001", "Partial"],
        ["Funnel", "Frontend", "Sales funnel design & landing pages", "Haiku", "~$0.001", "Planned"],
        ["Sales", "Frontend", "Outreach, proposals, lead qualification", "Sonnet", "~$0.01", "Planned"],
        ["CFO", "Backend", "Financial tracking, budgets, forecasting", "Sonnet", "~$0.01", "Planned"],
        ["CRM Manager", "Backend", "Client relationships, lead tracking", "Sonnet", "~$0.01", "Planned"],
        ["Systems", "Backend", "Infrastructure, backups, health monitoring", "Haiku", "~$0.001", "Active"],
        ["Calendar Manager", "Backend", "Google Calendar operations", "Haiku", "~$0.001", "Planned"],
        ["Email Manager", "Backend", "Gmail operations, outreach sequences", "Haiku", "~$0.001", "Active"],
        ["Coach", "Lifestyle", "Personal coaching, wealth guidance", "Sonnet", "~$0.01", "Planned"],
        ["Trading", "Lifestyle", "Portfolio analysis, market signals", "Sonnet", "~$0.01", "Planned"],
        ["Travel", "Lifestyle", "Trip planning, itineraries", "Haiku", "~$0.001", "Planned"],
        ["Builder Manager", "System", "Writes code, builds features", "Opus", "~$0.05", "Active"],
        ["Security Manager", "System", "Security audits, compliance", "Haiku", "~$0.001", "Active"],
        ["AI Council", "System", "Strategic decisions, competitive analysis", "Opus", "~$0.05", "Active"],
        ["Module Manager", "System", "Agent lifecycle management", "Haiku", "~$0.001", "Active"],
        ["Scheduler", "System", "Cron job execution", "Llama (local)", "Free", "Active"],
    ])

    doc.h1("Model Tiers — Why Different Agents Use Different Models")
    doc.body(
        "Not every task needs the most expensive AI. AIWH uses 4 tiers strategically:"
    )
    doc.table([
        ["Tier", "When Used", "Cost", "% of Spend"],
        ["Haiku", "Routine tasks, research, orchestration, scheduling", "~$0.001/msg", "~20%"],
        ["Sonnet", "Creative writing, analysis, financial reasoning", "~$0.01/msg", "~65%"],
        ["Opus", "Deep strategy, complex code (Builder + Council only)", "~$0.05/msg", "~15%"],
        ["Llama", "Cron scheduling (runs locally on your Mac Mini)", "Free", "0%"],
    ])
    doc.body(
        "**85%+ of tasks use Haiku** (cheapest). Branson is trained to avoid expensive "
        "models unless the task genuinely needs them."
    )

    doc.h1("Activating Planned Agents")
    doc.body("To activate a planned agent, tell Branson:")
    doc.bullet([
        '"Activate the CFO agent — I want weekly financial reports"',
        '"Turn on the Coach module — I need accountability tracking"',
        '"I want to start using the Trading agent for market analysis"',
    ])
    doc.body(
        "Branson will configure the agent with your business context, set up any "
        "needed API connections, and confirm it's ready."
    )

    doc.callout(
        "Planned agents cost nothing until activated. Once active, they only cost "
        "money when they actually work — no idle charges.",
        "COST"
    )

    doc.save(f"{OUT}/21-agent-overview.pdf")
    print("  21-agent-overview.pdf")


def doc_22_frontend_agents():
    doc = BrandPDF("Frontend Agents", "Research, Copywriter, Video, Social, Funnel, Sales")

    doc.h1("Frontend Module")
    doc.body(
        "These agents handle everything client-facing: content creation, video production, "
        "social media, sales funnels, and outreach. Three are fully operational; three "
        "are planned for activation."
    )

    doc.divider()

    doc.h1("Research Agent")
    doc.body(
        "The intelligence arm. Finds, analyses, and synthesises information — "
        "turning questions into actionable insights with sources."
    )
    doc.table([
        ["Detail", "Value"],
        ["Model", "Haiku (~$0.001/msg)"],
        ["Status", "Active — runs daily 7am topic generation + on demand"],
        ["Trained on", "700+ knowledge entries, Brave Search, industry analysis"],
    ])
    doc.h2("What It Can Do")
    doc.bullet([
        "Web search (Brave Search API, max 5 searches per task)",
        "Knowledge base search (700+ entries across all domains)",
        "Market research and competitive analysis",
        "Trend identification and urgency scoring",
        "Content extraction from web pages",
    ])
    doc.h2("What It Can't Do")
    doc.bullet([
        "Send emails or post to social media (needs approval)",
        "Fabricate data — reports honestly when research is inconclusive",
        "Retry more than 3 times (escalates to Branson)",
    ])
    doc.h2("Customise It")
    doc.bullet([
        '"Branson, focus Research on [my industry] trends instead of coaching"',
        '"Research should always check [specific competitor] in weekly scans"',
        '"Add [website/source] to the research rotation"',
    ])

    doc.divider()

    doc.h1("Copywriter Agent")
    doc.body(
        "The voice of your brand. Writes video scripts, social captions, sales pages, "
        "and any copy that represents your business."
    )
    doc.table([
        ["Detail", "Value"],
        ["Model", "Sonnet (~$0.01/msg) — creative quality matters here"],
        ["Status", "Active — runs 8am + 1pm daily crons + on demand"],
        ["Trained on", "4 voice styles: Taki Moore, Dan Kennedy, Alex Hormozi, Jon Gian"],
    ])
    doc.h2("What It Can Do")
    doc.bullet([
        "Video scripts (130-160 words, Hook → Problem → Framework → Example → CTA)",
        "Platform-specific captions (Instagram with hashtags, X without)",
        "Sales page copy and email sequences",
        "Cinematic video briefs (200-400 words with narrative arc)",
        "Voice matching to your brand tone",
    ])
    doc.h2("What It Can't Do")
    doc.bullet([
        "Publish content (hands off to Video/Social agents)",
        "Conduct research (uses what Research provides)",
        "Change its own voice training (Branson manages this)",
    ])
    doc.h2("Customise It")
    doc.bullet([
        '"Change my brand voice to [casual/professional/authoritative]"',
        '"Here are 10 examples of how I write — train the Copywriter on these"',
        '"Scripts should focus on [topic/industry] not coaching"',
        '"Make captions shorter / longer / more emoji / no emoji"',
        '"Always end scripts with [specific CTA]"',
    ])

    doc.callout(
        "The Copywriter is your most expensive daily cron (~$0.10/run, ~$6/month) "
        "because it uses Sonnet for creative quality. Worth it for brand consistency.",
        "COST"
    )

    doc.divider()

    doc.h1("Video Agent")
    doc.body(
        "Orchestrates the entire video pipeline — 5 sub-agents working in sequence "
        "to turn scripts into published videos."
    )
    doc.table([
        ["Detail", "Value"],
        ["Model", "Haiku (~$0.001/msg) — orchestration, not creativity"],
        ["Status", "Active — runs 9am + 2pm daily"],
        ["Sub-agents", "Voice, Avatar, Caption, QA, Publisher"],
    ])
    doc.h2("The 5 Sub-Agents")
    doc.table([
        ["Sub-Agent", "API", "What It Does", "Cost"],
        ["Voice", "ElevenLabs", "Script → MP3 audio (52-64 seconds)", "~$0.0015/min"],
        ["Avatar", "HeyGen", "Audio → talking-head video (1080x1920)", "~$0.005/call"],
        ["Caption", "Whisper + ffmpeg", "Transcribe + burn captions into video", "Free (local)"],
        ["QA", "ffprobe + tesseract", "Duration, audio, caption, file checks", "Free (local)"],
        ["Publisher", "Buffer", "Schedule to Instagram Reels + X", "Free"],
    ])
    doc.h2("Customise It")
    doc.bullet([
        '"Switch to my custom HeyGen avatar — ID is [avatar_id]"',
        '"Use my cloned ElevenLabs voice — ID is [voice_id]"',
        '"Change pillar rotation to focus on [topics]"',
        '"Post to TikTok/YouTube instead of Instagram"',
        '"Change caption style to [bold/minimal/coloured]"',
    ])

    doc.divider()

    doc.h1("Social Agent")
    doc.table([
        ["Detail", "Value"],
        ["Model", "Haiku"],
        ["Status", "Partially active — infrastructure ready, identity being defined"],
    ])
    doc.body(
        "Manages social media presence — scheduling, optimisation, performance tracking "
        "across Instagram and X. Currently handles the tail end of the video pipeline. "
        "Full activation will add analytics, hashtag strategy, and engagement tracking."
    )

    doc.divider()

    doc.h1("Funnel Agent")
    doc.table([
        ["Detail", "Value"],
        ["Model", "Haiku"],
        ["Status", "Planned — activate when you need landing pages or sales funnels"],
    ])
    doc.body(
        "Designs and builds conversion funnels: landing pages, opt-in flows, sales pages. "
        "Will integrate with your website platform when activated."
    )

    doc.divider()

    doc.h1("Sales Agent")
    doc.table([
        ["Detail", "Value"],
        ["Model", "Sonnet (persuasion requires nuance)"],
        ["Status", "Planned — activate when you're ready for automated outreach"],
    ])
    doc.body(
        "Manages your sales pipeline: outreach sequences, follow-ups, proposal creation, "
        "lead qualification. Will integrate with CRM when both are activated."
    )

    doc.save(f"{OUT}/22-frontend-agents.pdf")
    print("  22-frontend-agents.pdf")


def doc_23_backend_agents():
    doc = BrandPDF("Backend Agents", "CFO, CRM Manager, Systems, Calendar, Email")

    doc.h1("Backend Module")
    doc.body(
        "These agents handle business operations: finance, CRM, email, calendar, "
        "and infrastructure. Systems and Email Manager are active; others are "
        "planned for activation."
    )

    doc.divider()

    doc.h1("Systems Agent")
    doc.body(
        'The infrastructure backbone — "keeps the lights on." Manages crons, '
        "backups, logs, and system health. The most mature backend agent."
    )
    doc.table([
        ["Detail", "Value"],
        ["Model", "Haiku"],
        ["Status", "Active — monitors everything continuously"],
        ["Signature", '"If I\'m doing my job well, you don\'t notice." ⚙️'],
    ])
    doc.h2("What It Manages")
    doc.bullet([
        "**Cron health** — monitors all scheduled jobs, flags missed runs",
        "**Backup verification** — ensures hourly/daily/GDrive backups run",
        "**Log monitoring** — scans for errors, disk usage, anomalies",
        "**Knowledge pipeline** — nightly extraction and embedding",
        "**Infrastructure fixes** — diagnoses and resolves system issues",
    ])
    doc.h2("Tools It Uses")
    doc.bullet([
        "`openclaw cron list/run/enable/disable` — cron management",
        "`openclaw gateway status/restart` — gateway health",
        "`sqlite3` — database inspection and maintenance",
        "`brew` — package management",
        "All backup scripts (snapshot, GDrive, local)",
    ])

    doc.divider()

    doc.h1("Email Manager")
    doc.body(
        "Handles all email operations via Gmail — sending, managing, and tracking. "
        "Never sends without Branson-approved content."
    )
    doc.table([
        ["Detail", "Value"],
        ["Model", "Haiku"],
        ["Status", "Active"],
        ["Signature", '"Sent means sent. Get it right the first time." 📧'],
    ])
    doc.h2("Key Rule")
    doc.callout(
        "Email Manager never drafts AND sends in one step. Every outbound email "
        "uses Branson-approved copy. This is a hard guardrail — can't be overridden.",
        "SECURITY"
    )

    doc.divider()

    doc.h1("CFO Agent")
    doc.table([
        ["Detail", "Value"],
        ["Model", "Sonnet (financial analysis needs reasoning)"],
        ["Status", "Planned — activate for financial reporting"],
    ])
    doc.body(
        "Financial tracking, budgeting, revenue forecasting. Reports only — "
        "never executes payments or financial transfers. Will read cost-monitor.log "
        "and mission-control.db for analysis."
    )
    doc.h2("Activate It")
    doc.bullet([
        '"Branson, activate the CFO. I want weekly P&L reports and monthly forecasts."',
        '"Turn on CFO and have it alert me when any single day exceeds $5 in AI spend."',
    ])

    doc.divider()

    doc.h1("CRM Manager")
    doc.table([
        ["Detail", "Value"],
        ["Model", "Sonnet"],
        ["Status", "Planned — activate for client relationship tracking"],
    ])
    doc.body(
        "Client relationships, lead tracking, pipeline management. Never contacts "
        "clients directly without Branson's approval."
    )

    doc.divider()

    doc.h1("Calendar Manager")
    doc.table([
        ["Detail", "Value"],
        ["Model", "Haiku"],
        ["Status", "Planned — activate for Google Calendar management"],
        ["Signature", '"Your time, organised." 📅'],
    ])
    doc.body(
        "Schedule management, availability checks, conflict detection via Google "
        "Calendar. Always verifies for conflicts before creating events."
    )

    doc.save(f"{OUT}/23-backend-agents.pdf")
    print("  23-backend-agents.pdf")


def doc_24_lifestyle_agents():
    doc = BrandPDF("Lifestyle Agents", "Coach, Trading, Travel")

    doc.h1("Lifestyle Module")
    doc.body(
        "Personal agents for wealth building, markets, and travel. All three are "
        "planned — activate when you want them. They cost nothing until active."
    )

    doc.divider()

    doc.h1("Coach Agent")
    doc.table([
        ["Detail", "Value"],
        ["Model", "Sonnet (coaching needs empathy and nuance)"],
        ["Status", "Planned"],
    ])
    doc.body(
        "Personal development and wealth coaching using the IAW (International Academy "
        "of Wealth) framework. Supportive but direct — an experienced mentor, not a "
        "cheerleader."
    )
    doc.h2("Capabilities (When Activated)")
    doc.bullet([
        "Financial clarity and goal-setting (IAW Sovereignty Path)",
        "Wealth Pyramid framework — guiding you through 6 tiers",
        "Financial Fortress assessment and action planning",
        "Accountability, habit building, and mindset coaching",
        "Translating complex financial concepts into actionable steps",
    ])
    doc.h2("Activate It")
    doc.bullet([
        '"Branson, activate Coach. I want weekly accountability check-ins."',
        '"Turn on the coaching module and set up a wealth assessment."',
    ])

    doc.divider()

    doc.h1("Trading Agent")
    doc.table([
        ["Detail", "Value"],
        ["Model", "Sonnet (financial analysis needs depth)"],
        ["Status", "Planned"],
    ])
    doc.body(
        "Market analysis, portfolio monitoring, and trading signal generation. "
        "Covers crypto, Polymarket, FX, and traditional markets."
    )
    doc.callout(
        "Trading agent analyses and recommends — it NEVER executes trades "
        "autonomously. Every recommendation includes risk context. No guaranteed "
        "returns language, ever.",
        "SECURITY"
    )
    doc.h2("Activate It")
    doc.bullet([
        '"Branson, activate Trading. I want daily market scans on crypto and FX."',
        '"Set up portfolio monitoring — here are my holdings: [list]"',
    ])

    doc.divider()

    doc.h1("Travel Agent")
    doc.table([
        ["Detail", "Value"],
        ["Model", "Haiku (structured lookup work)"],
        ["Status", "Planned"],
    ])
    doc.body(
        "Trip planning, itinerary creation, booking assistance. Researches and "
        "recommends — confirms with you before any booking."
    )
    doc.h2("Activate It")
    doc.body('"Branson, activate Travel. Plan a trip to Bali for next month, budget $3,000."')

    doc.save(f"{OUT}/24-lifestyle-agents.pdf")
    print("  24-lifestyle-agents.pdf")


def doc_25_system_agents():
    doc = BrandPDF("System Agents", "Branson, Scheduler, Builder, Security, AI Council, Module Manager")

    doc.h1("System Module")
    doc.body(
        "The infrastructure and strategy layer. These agents keep the system running, "
        "secure, and evolving. All are active — you don't need to activate them."
    )

    doc.divider()

    doc.h1("Branson (Main Agent / CEO)")
    doc.body(
        "Your AI CEO. The single point of contact who orchestrates everything. "
        "When you talk to the Dashboard chat or Discord, you're talking to Branson."
    )
    doc.table([
        ["Detail", "Value"],
        ["Model", "Haiku (85% of work) — escalates to Sonnet/Opus when needed"],
        ["Status", "Active — always available"],
        ["Signature", '"I don\'t do the work. I make sure the work gets done right." 🎯'],
    ])
    doc.h2("How Branson Works")
    doc.numbered([
        "**Memory first** — Reads last 2 days of memory before any planning",
        "**Knowledge search** — Searches the knowledge base before answering substantive questions",
        "**Decompose** — Breaks your request into tasks",
        "**Delegate** — Assigns each task to the right specialist agent",
        "**Monitor** — Watches progress, intervenes if stuck",
        "**Validate** — Checks quality before delivering results",
        "**Remember** — Ensures memory is written after every task",
    ])
    doc.h2("Decision Rules")
    doc.bullet([
        "**Reversible decisions** — makes them independently (e.g., scheduling a cron)",
        "**Irreversible decisions** — asks you first (e.g., deleting data, publishing content)",
        "**Cost discipline** — uses Haiku for 85%+ of work, justifies any Sonnet/Opus usage",
        "**Honest failures** — tells you immediately when something breaks, never hides problems",
    ])
    doc.h2("Budget Guardrails")
    doc.table([
        ["Limit", "Value", "What Happens"],
        ["Daily budget", "$5-10/day", "Hard stop — agents pause, you're notified"],
        ["Monthly budget", "$100-200/mo", "Warning at 90%, hard stop at 100%"],
        ["Per-task estimate", "Required for expensive work", "Branson shows cost before proceeding"],
    ])

    doc.divider()

    doc.h1("Scheduler")
    doc.table([
        ["Detail", "Value"],
        ["Model", "Llama (runs locally on your Mac Mini — free)"],
        ["Status", "Active — always running"],
        ["Signature", '"On time, every time." ⏰'],
    ])
    doc.body(
        "Manages all cron jobs and scheduled task execution. Maintains both agent "
        "crons (AI-powered, costs tokens) and script crons (local scripts, free). "
        "Reports failures immediately."
    )

    doc.divider()

    doc.h1("Builder Manager")
    doc.table([
        ["Detail", "Value"],
        ["Model", "Opus (~$0.05/msg — the only role that justifies Opus)"],
        ["Status", "Active — on demand only"],
        ["Signature", '"Working code beats perfect plans." 🔨'],
    ])
    doc.body(
        "Your system engineer. Writes code in Python, Shell, and Node.js. Builds "
        "pipelines, scripts, integrations, and fixes bugs. Always tests before "
        "marking complete. Commits incrementally."
    )
    doc.callout(
        "Builder Manager is expensive (Opus). It's only activated for actual "
        "engineering tasks — never for routine queries. Branson manages this.",
        "COST"
    )

    doc.divider()

    doc.h1("Security Manager")
    doc.table([
        ["Detail", "Value"],
        ["Model", "Haiku"],
        ["Status", "Active"],
        ["Signature", '"Trust nothing. Verify everything." 🔒'],
    ])
    doc.body(
        "Audits infrastructure, data, and credentials. Enforces security policies. "
        "Investigates events in read-only mode. Escalates immediately — never waits."
    )
    doc.bullet([
        "Credential auditing — ensures API keys are never exposed",
        "Access monitoring — reviews who accessed what",
        "Policy enforcement — verifies agents comply with guardrails",
        "Incident response — documents security events with audit trail",
    ])

    doc.divider()

    doc.h1("AI Council")
    doc.table([
        ["Detail", "Value"],
        ["Model", "Opus (deep strategy needs deep reasoning)"],
        ["Status", "Active — consulted for high-stakes decisions only"],
        ["Signature", '"Think twice. Recommend once." 🧠'],
    ])
    doc.body(
        "Strategic advisor. Consulted for hard-to-reverse decisions, competitive "
        "threats, architecture choices. Gives clear recommendations with reasoning — "
        "not wishy-washy alternatives."
    )

    doc.divider()

    doc.h1("Module Manager")
    doc.table([
        ["Detail", "Value"],
        ["Model", "Haiku"],
        ["Status", "Active"],
        ["Signature", '"Every agent, properly built." 🔧'],
    ])
    doc.body(
        "Manages agent lifecycle: creation, configuration, updates, decommissioning. "
        "Ensures every agent follows the standard template. Performs health checks."
    )

    doc.save(f"{OUT}/25-system-agents.pdf")
    print("  25-system-agents.pdf")


def doc_26_customizing_agents():
    doc = BrandPDF("Customising Your Agents", "How to make the system yours")

    doc.h1("The Two Ways to Customise")
    doc.body("You have two approaches, depending on how technical you want to get:")
    doc.card_grid([
        ("Via Branson (Easy)", "Just tell Branson what you want in plain language. "
         "He updates the agent's configuration and confirms the change. Best for most users."),
        ("Via SOUL.md (Advanced)", "Edit an agent's SOUL.md file directly through the "
         "Dashboard's Team view. Gives you full control over the agent's instructions."),
    ])

    doc.h1("Customising via Branson")
    doc.body("Branson can change almost anything about an agent. Examples:")

    doc.h2("Change Brand Voice")
    doc.bullet([
        '"Make the Copywriter more casual and less salesy"',
        '"Train the Copywriter on my brand voice — here are 5 examples of how I write"',
        '"Switch from coaching tone to SaaS founder tone"',
    ])

    doc.h2("Change What Agents Focus On")
    doc.bullet([
        '"Research should focus on real estate trends, not coaching"',
        '"CFO should track revenue by client, not just total spend"',
        '"Video topics should be about [my industry], not AI coaching"',
    ])

    doc.h2("Change Schedules & Frequency")
    doc.bullet([
        '"Run the Copywriter 3 times daily instead of 2"',
        '"Move morning briefing to 9am"',
        '"Pause all video crons for the holidays"',
    ])

    doc.h2("Activate / Deactivate Agents")
    doc.bullet([
        '"Activate the CFO agent for weekly financial reports"',
        '"Deactivate the Trading agent — I don\'t need it anymore"',
    ])

    doc.divider()

    doc.h1("Customising via SOUL.md (Advanced)")
    doc.body(
        "Each agent has a SOUL.md file — its core instructions. You can view and "
        "edit this in the **Team** view of the Dashboard."
    )

    doc.h2("How to Edit")
    doc.numbered([
        "Open the **Team** view in the Dashboard",
        "Click on the agent you want to customise",
        "Click the **SOUL.md** file to open it",
        "Make your changes in the editor",
        "Save — changes take effect on the agent's next task",
    ])

    doc.h2("SOUL.md Structure")
    doc.body("Every SOUL.md has two zones:")
    doc.code(
        "## ═══ YOUR CUSTOMISATIONS — EDIT FREELY ABOVE THIS LINE ═══\n"
        "\n"
        "(Your changes go here — voice, rules, preferences)\n"
        "(This section is YOURS — updates never overwrite it)\n"
        "\n"
        "## ═══ AIWH CORE — DO NOT EDIT BELOW THIS LINE ═══\n"
        "\n"
        "(AIWH system instructions — updated automatically)\n"
        "(Editing below this line may break the agent)"
    )

    doc.h2("The Client Zone (Top — Edit Freely)")
    doc.body("This is where your customisations live. Add things like:")
    doc.bullet([
        "**Brand voice rules** — \"Always write in first person, casual tone\"",
        "**Industry context** — \"My clients are real estate agents in Sydney\"",
        "**Specific instructions** — \"Never use the word 'synergy'\"",
        "**Preferred frameworks** — \"Use the StoryBrand framework for all sales copy\"",
        "**CTA preferences** — \"Always end with a link to my booking page\"",
    ])
    doc.body(
        "When AIWH pushes updates to your system, the core zone gets updated but "
        "your customisation zone is preserved exactly as you left it."
    )

    doc.h2("The Core Zone (Bottom — Don't Edit)")
    doc.body(
        "This contains AIWH's system instructions — guardrails, safety rules, "
        "tool configurations, memory requirements. Editing it may cause the agent "
        "to malfunction or ignore safety rules."
    )
    doc.callout(
        "If you accidentally edit the core zone and something breaks, tell Branson: "
        '"Reset [agent name] to factory defaults." He\'ll restore the core zone '
        "from the template while keeping your customisations.",
        "TIP"
    )

    doc.divider()

    doc.h1("What You Can Customise Per Agent")
    doc.table([
        ["Agent", "Common Customisations"],
        ["Copywriter", "Brand voice, tone, script structure, word count, CTA style, "
         "hashtag strategy, industry focus"],
        ["Research", "Industry focus, competitor list, source preferences, "
         "research depth defaults"],
        ["Video", "Avatar ID, voice ID, pillar names & rotation, caption style, "
         "posting platforms, schedule"],
        ["CFO", "Reporting format, KPIs to track, alert thresholds, "
         "budget categories"],
        ["Coach", "Coaching framework, session structure, goal categories, "
         "accountability cadence"],
        ["Sales", "Outreach templates, qualification criteria, follow-up cadence, "
         "proposal format"],
    ])

    doc.h1("Changes That Persist")
    doc.body("All customisations are stored on your Mac Mini and included in backups:")
    doc.bullet([
        "**SOUL.md changes** — saved in the agent's workspace directory",
        "**Config changes** — saved in `/opt/AIWH/client/config/`",
        "**Knowledge** — stored in your local `client_knowledge.db`",
        "**Memory** — stored in agent memory SQLite databases",
        "**Cron schedules** — saved in OpenClaw's `jobs.json`",
    ])
    doc.body(
        "When AIWH pushes system updates, only the core zones of SOUL.md files "
        "are overwritten. Everything else stays exactly as you configured it."
    )

    doc.callout(
        "Your system diverges from the factory defaults over time as you customise "
        "it. That's the design — each client's AIWH becomes uniquely theirs.",
        "NOTE"
    )

    doc.save(f"{OUT}/26-customizing-agents.pdf")
    print("  26-customizing-agents.pdf")


if __name__ == '__main__':
    print("Generating 38.3 — Agent docs (PDF)...")
    doc_21_agent_overview()
    doc_22_frontend_agents()
    doc_23_backend_agents()
    doc_24_lifestyle_agents()
    doc_25_system_agents()
    doc_26_customizing_agents()
    print(f"Done! 6 PDFs + 6 HTMLs in {OUT}")
