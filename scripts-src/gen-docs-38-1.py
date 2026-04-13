#!/usr/bin/env python3
"""Generate Phase 38.1 — Getting Started docs (00-series) as branded PDF.
Rewritten with full depth: Tailscale, onboarding details, costs, Branson tips."""

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'lib'))
from pdf_brand import BrandPDF

OUT = '/opt/AIWH/core/docs/user-guide/00-getting-started'
os.makedirs(OUT, exist_ok=True)


def doc_01_what_is_aiwh():
    doc = BrandPDF("What Is AI Wealth Hub?", "Your AI-powered business operating system")

    doc.h1("The Big Picture")
    doc.body(
        "AI Wealth Hub (AIWH) is a self-evolving AI agent system that runs on a dedicated "
        "Mac Mini in your office or home. It's not a single chatbot — it's an entire team of "
        "19 specialised AI agents that handle your content creation, business operations, "
        "finances, and lifestyle management."
    )
    doc.body(
        "Think of it as hiring a full digital team: a researcher, copywriter, video producer, "
        "CFO, CRM manager, sales agent, personal coach, and more — all coordinated by "
        "**Branson**, your AI CEO."
    )

    doc.h1("How It Works")
    doc.body(
        "You talk to Branson through the **Dashboard** (a web interface on your Mac Mini) or "
        "through **Discord/WhatsApp**. Branson understands your request, breaks it into tasks, "
        "and delegates to the right specialist agent. Each agent has its own training, tools, "
        "and knowledge — they're not generic chatbots."
    )
    doc.body(
        "You can also access your Dashboard remotely from anywhere using **Tailscale** — "
        "a free, encrypted network that connects your devices securely without exposing "
        "your Mac Mini to the public internet."
    )

    doc.h2("The Four Modules")
    doc.card_grid([
        ("Frontend", "Content, video, social media, sales funnels — Research, Copywriter, "
         "Video, Social, Funnel, Sales"),
        ("Backend", "Finance, CRM, email, calendar, infrastructure — CFO, CRM Manager, "
         "Email Manager, Calendar Manager, Systems"),
        ("Lifestyle", "Personal coaching, trading, travel — Coach, Trading, Travel"),
        ("System", "Building, security, strategy, scheduling — Builder Manager, "
         "Security Manager, AI Council, Scheduler"),
    ])

    doc.h1("Self-Evolving Intelligence")
    doc.body(
        "Every interaction makes the system smarter. When agents complete tasks, they extract "
        "knowledge — patterns, preferences, what works for your business. This knowledge is "
        "stored locally on your machine and never leaves it."
    )
    doc.body(
        "Additionally, you receive **base knowledge updates** from AIWH headquarters — "
        "curated strategies, frameworks, and best practices. Your private data stays private. "
        "Shared improvements benefit everyone."
    )

    doc.h2("What Makes AIWH Different")
    doc.bullet([
        "**Dedicated hardware** — Your Mac Mini, your data, your agents. Not a cloud service that can go down.",
        "**Learns YOUR business** — Adapts to your voice, brand, industry, and preferences over time.",
        "**Agents, not tools** — Each specialist has its own personality, training, and decision-making.",
        "**You're always in control** — Branson asks before making irreversible decisions.",
        "**Knowledge is the product** — Monthly subscription includes continuous knowledge updates and platform training.",
        "**Accessible from anywhere** — Tailscale gives you secure remote access from any device.",
    ])

    doc.h1("What You'll Need")
    doc.table([
        ["Requirement", "Details", "Cost"],
        ["Mac Mini", "Provided by AIWH (Apple Silicon, pre-configured)", "Included"],
        ["Internet", "Stable connection — agents use cloud AI APIs", "Your existing"],
        ["Anthropic API Key", "REQUIRED — powers all AI reasoning",
         "Pay-per-use, ~$30-100/mo"],
        ["ElevenLabs", "Voice synthesis for videos (optional)",
         "$22/mo Creator plan"],
        ["HeyGen", "Avatar video generation (optional)",
         "$29-89/mo + API credits"],
        ["Buffer", "Social media scheduling (optional)",
         "Free or $6/mo per channel"],
        ["Discord Bot", "Notifications and alerts (optional)", "Free"],
        ["OpenAI Key", "Knowledge embeddings only (optional)", "~$5/mo"],
        ["Browser", "Any modern browser for the Dashboard", "Free"],
        ["Tailscale", "Remote access from your phone/laptop (optional)", "Free"],
    ])

    doc.callout(
        "Only the Anthropic API key is required. Everything else is optional and "
        "can be added later. The onboarding wizard walks you through each service "
        "with pricing details and setup links.",
        "NOTE"
    )

    doc.h1("What It Costs")
    doc.body("Your total monthly cost depends on which features you enable:")
    doc.table([
        ["Component", "Monthly Cost", "Notes"],
        ["AIWH Subscription", "$2,500-5,000", "Per module (Frontend/Backend/Lifestyle)"],
        ["AI API Usage", "~$75-100", "Depends on usage — daily budget capped"],
        ["ElevenLabs", "$22", "Only if using video voice synthesis"],
        ["HeyGen", "$29-89 + credits", "Only if using avatar videos"],
        ["Buffer", "$0-12", "Free plan works to start"],
        ["Discord", "$0", "Always free"],
        ["OpenAI", "~$5", "Only for knowledge embeddings"],
    ])

    doc.save(f"{OUT}/01-what-is-aiwh.pdf")
    print("  01-what-is-aiwh.pdf")


def doc_02_first_login():
    doc = BrandPDF("Your First Login", "Setting up your Dashboard step by step")

    doc.h1("Accessing the Dashboard")
    doc.body("There are two ways to reach your Dashboard:")

    doc.h2("From the Mac Mini Itself")
    doc.body("Open any browser (Safari, Chrome, Firefox) and go to:")
    doc.code("http://localhost:3001")

    doc.h2("From Another Device on Your Network")
    doc.body(
        "Use the Mac Mini's local IP address (shown on screen during setup):"
    )
    doc.code("http://192.168.1.x:3001")

    doc.h2("From Anywhere (via Tailscale)")
    doc.body(
        "If Tailscale is set up (see the Remote Access guide), use your "
        "Tailscale IP or MagicDNS hostname:"
    )
    doc.code("https://aiwh-your-id.tail12345.ts.net\nhttps://100.x.x.x:3001")

    doc.divider()

    doc.h1("First-Time Setup (The Onboarding Wizard)")
    doc.body(
        "The first time you access the Dashboard, you'll see a 7-step setup wizard. "
        "It takes about **5 minutes** and sets up everything your AI team needs."
    )

    doc.h2("Step 1: Welcome")
    doc.body(
        'You\'ll see "Welcome to AIWH" with a brief intro. Click **Get Started**.'
    )

    doc.h2("Step 2: Create Your Password")
    doc.body("This password protects your Dashboard. Requirements:")
    doc.bullet([
        "At least 8 characters",
        "One uppercase letter, one lowercase letter, one number",
        "A strength bar shows how strong your password is",
        "You can click **Generate** for a random 16-character password",
    ])
    doc.callout(
        "Your password is hashed using scrypt and never stored in plain text. "
        "If you forget it, there's no reset — you'll need to contact AIWH support.",
        "SECURITY"
    )

    doc.h2("Step 3: About You")
    doc.body("Enter your name, business name, and industry. This helps agents "
             "tailor their work.")
    doc.body(
        'If you have a team member who needs access, select "Yes" and enter '
        "their name and email. We'll set up Tailscale remote access for them "
        "after the wizard."
    )

    doc.h2("Step 4: Choose Your Features")
    doc.body("Select which capabilities you want active. Each feature lists "
             "the services it needs and what they cost:")
    doc.table([
        ["Feature", "What It Does", "Required Services", "Monthly Cost"],
        ["Daily Video Automation", "2 AI videos/day, auto-posted",
         "Anthropic + ElevenLabs + HeyGen + Buffer", "~$80-140"],
        ["Cinematic Video", "Studio-quality with review gates",
         "Anthropic + ElevenLabs + Google Cloud", "~$10-25/video"],
        ["UGC Content", "Product demos & testimonials",
         "Anthropic + ElevenLabs + HeyGen + Google Cloud", "~$50-100"],
        ["Cold Outreach", "Automated prospecting & emails",
         "Anthropic + Google Workspace", "~$30-50"],
        ["SEO Content", "Blog posts that rank on Google",
         "Anthropic only", "~$10-20"],
        ["Knowledge & Research", "AI research + document search",
         "Anthropic + OpenAI", "~$35-55"],
        ["Notifications", "Real-time Discord alerts",
         "Discord Bot only", "Free"],
    ])
    doc.callout(
        "Only **Anthropic** (or ChatGPT via OAuth) is required. All other "
        "services are optional. You can add them later from the Dashboard.",
        "NOTE"
    )

    doc.h2("Step 5: Connect Your Services")
    doc.body(
        "For each required service, you'll paste your API key. The wizard "
        "verifies it works before saving. Keys are encrypted with **AES-256-GCM** "
        "on your machine — they never leave your device."
    )
    doc.body("For each service, the wizard shows:")
    doc.bullet([
        "**Pricing model** — subscription or pay-per-use",
        "**Estimated monthly cost**",
        "**Links** to create an account and get your API key",
        "**Warnings** where applicable (e.g., HeyGen has separate API credits from subscription credits)",
    ])

    doc.h2("Step 6: Connect a Chat Channel (Optional)")
    doc.body(
        "Choose Discord, WhatsApp, Telegram, or Slack for mobile notifications. "
        "You can skip this and add channels later. Discord is recommended — "
        "it gives you 30+ purpose-built channels for different agent outputs."
    )

    doc.h2("Step 7: Summary & Launch")
    doc.body(
        "Review everything: password, profile, features, connected services. "
        "A security note confirms your API keys are encrypted. Click "
        '**Launch Dashboard** to finish and log in.'
    )

    doc.divider()

    doc.h1("The Dashboard at a Glance")
    doc.body("Once logged in, you'll see four main areas:")

    doc.h2("Top Bar")
    doc.bullet([
        "**AIWH-MC** logo and live clock",
        "**Today's cost** — real-time spend (updates live, resets midnight AEST)",
        "**Active tasks** — how many AI tasks are currently running",
        "**System status** — green dots for Gateway, Agents, and Cron health",
        "**Theme toggle** — dark or light mode (saved to your browser)",
        "**Notification bell** — unread count, click to see all alerts",
    ])

    doc.h2("Navigation Rail (Left Side)")
    doc.body(
        "Hex-shaped buttons on the left — your main navigation. Only one "
        "view shows at a time."
    )
    doc.table([
        ["Button", "View", "What You'll Find", "Shortcut"],
        ["Chat", "Agent Chat", "Talk to Branson and other agents", "—"],
        ["Overview", "Dashboard Home", "Stats, activity feed, cost trends", "1"],
        ["Team", "Agent Team", "All agents, status, click for details", "2"],
        ["Tasks", "Task Board", "Kanban: backlog → in progress → done", "3"],
        ["Schedule", "Cron Jobs", "Everything that runs automatically", "4"],
        ["Content", "Video Pipeline", "Video production status", "5"],
        ["Costs", "Cost Breakdown", "Where your money is going", "6"],
        ["Production", "Cinematic Studio", "Long-form video jobs", "—"],
        ["Wealth", "Lifestyle Centre", "Coaching, trading, travel", "—"],
        ["Channels", "Channel Setup", "Discord, WhatsApp, bindings", "—"],
        ["Config", "Settings", "Password, subscriptions, security", "—"],
    ])

    doc.h2("Main Content Area")
    doc.body("The centre shows whichever view you've selected.")

    doc.h2("Bottom Ticker")
    doc.body(
        "A scrolling feed of real-time agent activity — what's running, "
        "completed, or failed. Shows the last 30 events."
    )

    doc.callout(
        "Press **Esc** to close any open panel or modal. Press **1-6** to "
        "quickly jump between views.",
        "TIP"
    )

    doc.divider()

    doc.h1("Common Login Issues")
    doc.table([
        ["Problem", "What You'll See", "Solution"],
        ["Wrong password", '"Incorrect password" + screen shake',
         "Type carefully. No password reset — contact AIWH support."],
        ["Session expired", '"Session expired" redirect',
         "Normal after 24 hours. Just log in again."],
        ["Dashboard not loading", "Browser can't connect",
         "Check Mac Mini is powered on. Try http://localhost:3001 from the Mini itself."],
        ["Tailscale not connecting", "Timeout on remote access",
         "Check Tailscale is running on both devices. See Remote Access guide."],
    ])

    doc.save(f"{OUT}/02-your-first-login.pdf")
    print("  02-your-first-login.pdf")


def doc_03_talking_to_branson():
    doc = BrandPDF("Talking to Branson", "How to get the most from your AI CEO")

    doc.h1("Who Is Branson?")
    doc.body(
        "Branson is your AI CEO — the central intelligence that coordinates all other agents. "
        "When you need something done, you talk to Branson. He figures out who should handle "
        "it, briefs them, monitors the work, and ensures quality."
    )
    doc.body(
        "He's not a generic chatbot. He has deep knowledge of your business, remembers "
        "past conversations, and learns your preferences. He's designed to be a "
        "partner — he'll push back if he disagrees with an approach."
    )

    doc.h1("Where to Chat")
    doc.card_grid([
        ("Dashboard Chat", "Click **Chat** in the nav rail. Type and press Enter. "
         "Real-time streaming responses. Best for complex requests."),
        ("Discord", "Message in your designated channels. Mention the bot to get "
         "his attention. Best for quick check-ins and approvals."),
        ("WhatsApp", "Direct message to the linked number. Great for mobile — "
         "ask quick questions while on the go."),
        ("Any Channel", "Telegram, Slack work the same once configured."),
    ])

    doc.h1("What to Ask — With Examples")
    doc.body(
        "Here's what Branson can do, organised by category, with the exact "
        "phrases that work well:"
    )

    doc.h2("Content & Marketing")
    doc.bullet([
        '"Write me a video script about cold outreach for [my industry]"',
        '"What videos are scheduled for this week?"',
        '"Change my video posting schedule to 3 times per day"',
        '"Research the top 5 lead gen strategies for real estate agents"',
        '"Update my content pillars — I want to focus more on [topic]"',
        '"Change my brand voice to be more casual and conversational"',
        '"My copywriter scripts sound too salesy — make them more educational"',
    ])

    doc.h2("Business Operations")
    doc.bullet([
        '"What did I spend on AI this month?"',
        '"Show me a cost breakdown by agent for last week"',
        '"Draft a follow-up email for the lead from yesterday"',
        '"Set my daily budget to $5 instead of $10"',
        '"What\'s my most expensive cron job?"',
    ])

    doc.h2("System & Configuration")
    doc.bullet([
        '"What agents are currently active?"',
        '"Add a new cron job to post on Tuesdays and Thursdays at 6pm"',
        '"Run a system health check"',
        '"When was the last backup?"',
        '"Pause the video pipeline for the next 3 days"',
        '"Switch my avatar to [new HeyGen avatar ID]"',
        '"Clone my voice — here is my ElevenLabs voice ID: [id]"',
    ])

    doc.h2("Lifestyle (if enabled)")
    doc.bullet([
        '"What should I focus on this week for personal growth?"',
        '"Analyse my trading portfolio performance"',
        '"Plan a trip to Bali for next month — budget $3,000"',
    ])

    doc.h2("Getting Information")
    doc.bullet([
        '"Explain how the video pipeline works"',
        '"Where are my videos stored on the Mac Mini?"',
        '"What\'s the difference between Haiku and Sonnet models?"',
        '"How much does each cron job cost per run?"',
    ])

    doc.divider()

    doc.h1("What Branson Can't Do")
    doc.bullet([
        "**Make payments** — He can analyse and recommend, but you execute",
        "**Access external websites directly** — The Research agent handles web lookups",
        "**Override your decisions** — He'll voice his opinion but defers to you",
        "**Access other clients' data** — Your system is completely isolated",
        "**Undo published content** — Once a video posts via Buffer, it's live",
    ])

    doc.h1("Things NOT to Say")
    doc.callout(
        "Branson has full system access. Be careful with vague destructive commands.",
        "WARNING"
    )
    doc.table([
        ["Don't Say", "Say Instead", "Why"],
        ['"Delete everything"', '"Delete videos older than 30 days from the jobs folder"',
         "Be specific — Branson takes instructions literally"],
        ['"Reset the system"', '"Restart the dashboard" or "Reset my video pipeline queue"',
         '"Reset" is ambiguous — could mean wipe all data'],
        ['"Turn everything off"', '"Stop the video pipeline crons" or "Pause the nightly summary"',
         "Specify WHAT to stop"],
        ['"Here\'s my API key: sk-..."', "Don't paste keys in chat",
         "Use the Dashboard settings to update keys securely"],
        ['"Make it perfect"', '"Make the hook more aggressive" or "Shorten to 140 words"',
         "Specific feedback gets specific results"],
    ])

    doc.h1("Tips for Better Results")
    doc.numbered([
        '**Be specific** — "Write a 150-word script about cold email for real estate agents" '
        'beats "write something about email"',
        '**Give context** — "I have a webinar next Friday, prepare social posts leading up to it"',
        '**Ask for opinions** — "What do you think about launching a podcast?" — '
        'Branson has strategic reasoning',
        '**Iterate** — "That script was good but make the hook more aggressive" — refinement is normal',
        '**Ask about costs first** — "How much would it cost to run 3 videos per day?" — '
        'Branson gives you estimates before spending',
    ])

    doc.callout(
        "Branson always searches the knowledge base before answering substantive questions. "
        "If he doesn't have relevant knowledge, he'll research it or tell you honestly. "
        "He doesn't make things up.",
        "NOTE"
    )

    doc.save(f"{OUT}/03-talking-to-branson.pdf")
    print("  03-talking-to-branson.pdf")


def doc_04_understanding_agents():
    doc = BrandPDF("Understanding Your Agents", "Meet the team — what they do, what they cost")

    doc.h1("What Are Agents?")
    doc.body(
        "Agents are specialised AI workers, each trained for a specific job. Unlike a single "
        "chatbot, AIWH has dedicated agents with their own personality, training data, tools, "
        "and decision-making rules."
    )
    doc.body(
        "When you ask Branson to do something, he delegates to the right specialist — "
        "just like a real CEO. You never need to talk to individual agents directly "
        "(though you can in the Chat view)."
    )

    doc.h1("Your Agent Roster")

    doc.h2("Frontend Module — Content & Client-Facing")
    doc.table([
        ["Agent", "What It Does", "Model", "Cost/Message", "Runs"],
        ["Research", "Web research, analysis, trend scanning", "Haiku",
         "~$0.001", "On demand + daily 7am cron"],
        ["Copywriter", "Video scripts (130-160 words), social copy, sales pages",
         "Sonnet", "~$0.01", "Daily 8am + 1pm crons + on demand"],
        ["Video", "Orchestrates full video pipeline (5 sub-agents)",
         "Haiku", "~$0.001", "Daily 9am + 2pm crons"],
        ["Social", "Social media strategy and scheduling", "Haiku",
         "~$0.001", "On demand"],
        ["Funnel", "Sales funnel design and landing pages", "Haiku",
         "~$0.001", "On demand"],
        ["Sales", "Outreach, proposals, lead qualification", "Sonnet",
         "~$0.01", "On demand"],
    ])

    doc.h2("Backend Module — Business Operations")
    doc.table([
        ["Agent", "What It Does", "Model", "Cost/Message", "Runs"],
        ["CFO", "Financial tracking, budgets, forecasting", "Sonnet",
         "~$0.01", "On demand"],
        ["CRM Manager", "Client relationships, lead tracking via GHL", "Sonnet",
         "~$0.01", "On demand"],
        ["Systems", "Infrastructure, deployment, health monitoring", "Haiku",
         "~$0.001", "On demand"],
        ["Calendar Manager", "Google Calendar operations", "Haiku",
         "~$0.001", "On demand"],
        ["Email Manager", "Gmail operations, outreach sequences", "Haiku",
         "~$0.001", "On demand"],
    ])

    doc.h2("Lifestyle Module — Personal")
    doc.table([
        ["Agent", "What It Does", "Model", "Cost/Message", "Runs"],
        ["Coach", "Personal coaching, wellness, growth guidance", "Sonnet",
         "~$0.01", "On demand"],
        ["Trading", "Portfolio analysis, market signals, crypto/FX", "Sonnet",
         "~$0.01", "On demand"],
        ["Travel", "Trip planning, itineraries, bookings", "Haiku",
         "~$0.001", "On demand"],
    ])

    doc.h2("System Module — Infrastructure & Strategy")
    doc.table([
        ["Agent", "What It Does", "Model", "Cost/Message", "Runs"],
        ["Builder Manager", "Builds features, writes code, creates pipelines",
         "Opus", "~$0.05", "On demand (expensive — used sparingly)"],
        ["Security Manager", "Security audits, compliance checks", "Haiku",
         "~$0.001", "On demand"],
        ["AI Council", "Strategic decisions, competitive analysis",
         "Opus", "~$0.05", "On demand (strategy only)"],
        ["Module Manager", "Agent lifecycle management", "Haiku",
         "~$0.001", "On demand"],
        ["Scheduler", "Cron job execution", "Llama (local)",
         "Free", "Always running on your Mac Mini"],
    ])

    doc.divider()

    doc.h1("AI Model Tiers — What They Mean for Your Wallet")
    doc.table([
        ["Model", "What It's Good At", "Cost", "% of Your Spend"],
        ["Haiku", "Fast, efficient — routine tasks, research, orchestration",
         "~$0.001/msg", "~20%"],
        ["Sonnet", "Creative writing, reasoning, analysis",
         "~$0.01/msg", "~65%"],
        ["Opus", "Deep strategy, complex code generation",
         "~$0.05/msg", "~15%"],
        ["Llama", "Runs on your Mac Mini (no cloud)",
         "Free", "0%"],
    ])
    doc.body(
        "**85% of tasks use Haiku** (the cheapest). Sonnet is reserved for creative "
        "and analytical work. Opus is only used for strategy and code — Branson is "
        "trained to avoid it unless the task genuinely requires deep reasoning."
    )

    doc.h1("Automatic vs On-Demand")
    doc.card_grid([
        ("Automatic (Crons)", "Run on a schedule — you don't trigger them. "
         "Video pipeline runs twice daily. Briefings morning and night. "
         "Knowledge research weekly. See the full schedule in the Schedule view."),
        ("On-Demand", "Only run when you or Branson ask. Most agents are on-demand. "
         '"Research the best CRM for coaches" → Branson activates Research. '
         "You only pay when they work."),
    ])

    doc.h1("How Agents Remember")
    doc.body(
        "Each agent has its own memory database (SQLite files stored on your Mac Mini). "
        "When an agent learns something useful, it's stored and recalled in future sessions. "
        "Branson ensures memory is written after every task — nothing gets lost."
    )
    doc.body("Memory stays on your machine. It's included in backups but never synced to the cloud.")

    doc.h1("Viewing & Customising Agents")
    doc.body("In the Dashboard:")
    doc.bullet([
        "**Team view** — Click any agent to see their training, recent activity, and config",
        "**Chat view** — Select a specific agent to talk to them directly (bypassing Branson)",
    ])
    doc.body("To customise an agent's behaviour, tell Branson:")
    doc.bullet([
        '"Make the Copywriter more casual and less salesy"',
        '"Train the Research agent to focus on [my industry] news"',
        '"Change the CFO\'s reporting format to include profit margins"',
    ])

    doc.callout(
        "Branson updates the agent's SOUL.md (their core instructions) when you "
        "request changes. This persists across restarts and is included in backups.",
        "TIP"
    )

    doc.save(f"{OUT}/04-understanding-agents.pdf")
    print("  04-understanding-agents.pdf")


def doc_05_channels_setup():
    doc = BrandPDF("Setting Up Channels", "Connect Discord, WhatsApp, and more")

    doc.h1("Why Channels Matter")
    doc.body(
        "Channels are how your agents communicate with you outside the Dashboard. "
        "Instead of opening a browser every time, get notifications, approvals, "
        "and updates directly where you already spend time."
    )
    doc.bullet([
        "**Notifications** when tasks complete or videos publish",
        "**Approval requests** before publishing content",
        "**Daily briefings** and cost summaries",
        "**Alerts** for errors, budget warnings, and system issues",
        "**Quick chat** with Branson from your phone",
    ])

    doc.h1("Supported Channels")
    doc.table([
        ["Channel", "Best For", "Setup", "Cost"],
        ["Discord", "Full team comms, 30+ channels, approvals", "Easy (5 min)", "Free"],
        ["WhatsApp", "Quick mobile check-ins with Branson", "Easy (2 min)", "Free"],
        ["Telegram", "Bot-based messaging", "Easy", "Free"],
        ["Slack", "Enterprise teams", "Medium", "Free"],
        ["Signal", "Encrypted messaging", "Advanced", "Free"],
        ["iMessage", "Apple ecosystem (macOS only)", "Advanced", "Free"],
        ["Matrix", "Decentralised / self-hosted", "Advanced", "Free"],
        ["MS Teams", "Enterprise Microsoft", "Medium", "Varies"],
    ])

    doc.divider()

    doc.h1("Setting Up Discord (Recommended)")
    doc.body(
        "Discord is the primary channel. It gives you purpose-built channels "
        "for different agent outputs — content review, financial reports, system "
        "alerts, and more."
    )

    doc.h2("Step 1: Create a Discord Server")
    doc.body("If you don't have one, create a free Discord server for your business.")

    doc.h2("Step 2: Create a Bot")
    doc.numbered([
        "Go to `discord.com/developers/applications`",
        'Click **New Application** — name it "AIWH" or your brand name',
        "Go to **Bot** section → click **Add Bot**",
        "Copy the **Bot Token** (you'll paste this in the Dashboard)",
        "Enable **Message Content Intent** under Privileged Gateway Intents",
    ])

    doc.h2("Step 3: Invite the Bot to Your Server")
    doc.body(
        "In the Developer Portal → **OAuth2 > URL Generator**. Select `bot` scope, "
        "give permissions to read and send messages. Copy the URL, open in browser, "
        "select your server."
    )

    doc.h2("Step 4: Add the Token to AIWH")
    doc.body(
        "Dashboard → **Channels** view → **Add Channel** → Discord → paste token. "
        "The system verifies it works before saving."
    )

    doc.h2("Step 5: Set Up Channel Bindings")
    doc.body("Route specific agents to specific Discord channels:")
    doc.table([
        ["Agent", "Recommended Channel", "What Goes There"],
        ["Branson (main)", "#general", "Primary communication, commands"],
        ["Copywriter", "#content-review", "Scripts ready for review"],
        ["Video", "#video-pipeline", "Pipeline status, completions, failures"],
        ["CFO", "#finance", "Cost reports, budget alerts"],
        ["Sales", "#sales-ops", "Lead updates, outreach tracking"],
        ["Security Manager", "#security", "Security alerts, audit results"],
        ["Scheduler", "#ceo-briefing", "Morning and nightly summaries"],
    ])

    doc.callout("Discord bots are free. No subscription, no per-message cost.", "COST")

    doc.divider()

    doc.h1("Setting Up WhatsApp")
    doc.numbered([
        "Dashboard → **Channels** → **Add Channel** → WhatsApp — a QR code appears",
        "On your phone: WhatsApp → **Settings > Linked Devices > Link a Device** → scan QR",
        "Send a test message — Branson should respond within seconds",
    ])
    doc.callout(
        "WhatsApp links to your personal account. Only your number is authorised — "
        "nobody else can message your agents.",
        "SECURITY"
    )

    doc.h1("Setting Up Other Channels")
    doc.body(
        "Telegram, Slack, and others follow the same pattern: create a bot on the "
        "platform, copy the token, add via Dashboard. Each has a help link in the "
        "setup wizard."
    )

    doc.divider()

    doc.h1("Changing Channels Later")
    doc.body("Tell Branson:")
    doc.bullet([
        '"Add a new Discord channel called #weekly-reports and send the weekly video report there"',
        '"Route all cost alerts to WhatsApp instead of Discord"',
        '"Unbind the CFO from #finance and bind to #money"',
        '"Set up Telegram as a backup notification channel"',
    ])

    doc.save(f"{OUT}/05-channels-setup.pdf")
    print("  05-channels-setup.pdf")


def doc_06_remote_access():
    doc = BrandPDF("Remote Access with Tailscale",
                   "Access your Dashboard from anywhere — securely")

    doc.h1("What Is Tailscale?")
    doc.body(
        "Tailscale is a free, encrypted network that connects your devices securely. "
        "It lets you access your AIWH Dashboard from your laptop, phone, or tablet — "
        "anywhere in the world — without exposing your Mac Mini to the public internet."
    )
    doc.body(
        "Think of it as a private tunnel between your devices. No port forwarding, "
        "no firewall rules, no IT knowledge needed."
    )

    doc.h1("How It Works")
    doc.numbered([
        "Your Mac Mini is already connected to a Tailscale network (set up during installation)",
        "You install the free Tailscale app on your phone, laptop, or other devices",
        "All your devices see each other on a private network (100.x.x.x addresses)",
        "You access the Dashboard using the Tailscale IP — encrypted end-to-end",
    ])

    doc.h1("Setting Up Tailscale on Your Devices")

    doc.h2("On iPhone / iPad")
    doc.numbered([
        "Download **Tailscale** from the App Store (free)",
        "Open the app and sign in with the account provided by AIWH",
        "Toggle the VPN on — you'll see your Mac Mini in the device list",
        'Open Safari and go to your Mac Mini\'s Tailscale address (shown in the app)',
    ])

    doc.h2("On Android")
    doc.numbered([
        "Download **Tailscale** from Google Play Store (free)",
        "Sign in with the account provided by AIWH",
        "Toggle on — your Mac Mini appears in the device list",
        "Open Chrome and navigate to the Tailscale address",
    ])

    doc.h2("On Mac / Windows / Linux")
    doc.numbered([
        "Download Tailscale from **tailscale.com/download** (free)",
        "Install and sign in with the account provided by AIWH",
        "Your Mac Mini appears in the system tray / menu bar",
        "Open any browser and navigate to the Tailscale address",
    ])

    doc.divider()

    doc.h1("Accessing Your Dashboard")
    doc.body("Once Tailscale is running on your device, you have two ways to connect:")

    doc.h2("Option 1: Tailscale IP")
    doc.body("Use the IP address shown in your Tailscale app:")
    doc.code("https://100.x.x.x:3001")
    doc.body("(Replace with your actual Tailscale IP)")

    doc.h2("Option 2: MagicDNS (Easier to Remember)")
    doc.body("Tailscale gives your Mac Mini a human-readable hostname:")
    doc.code("https://aiwh-your-id.tailnet-name.ts.net")
    doc.body("This works exactly like the IP but is easier to bookmark.")

    doc.callout(
        "Bookmark your Tailscale Dashboard URL on all your devices. "
        "You'll use it every day.",
        "TIP"
    )

    doc.h1("Giving Team Members Access")
    doc.body(
        "If you have a team member or business partner who needs Dashboard access:"
    )
    doc.numbered([
        "Ask them to install the Tailscale app on their device",
        "From the Tailscale admin console, invite them to your network",
        "Once accepted, they can access the Dashboard using the same Tailscale URL",
        "They'll need the Dashboard password to log in",
    ])
    doc.callout(
        "Tailscale access is separate from Dashboard access. Tailscale gets you "
        "to the login page. The Dashboard password gets you in. Both are needed.",
        "SECURITY"
    )

    doc.h1("Troubleshooting")
    doc.table([
        ["Problem", "Cause", "Solution"],
        ["Can't reach Dashboard", "Tailscale not connected on your device",
         "Open Tailscale app, toggle on, wait 10 seconds"],
        ["Page loads slowly", "Mac Mini is on slow/unstable internet",
         "Check Mac Mini's internet connection"],
        ["Tailscale shows offline", "Mac Mini is off or lost internet",
         "Physically check the Mac Mini is powered on and connected"],
        ['"Connection refused"', "Dashboard service crashed",
         "Power-cycle the Mac Mini (unplug, wait 10s, plug back in)"],
        ["Can't sign into Tailscale", "Wrong account",
         "Use the credentials provided by AIWH during setup"],
    ])

    doc.h1("Security Notes")
    doc.bullet([
        "**All traffic is encrypted** — Tailscale uses WireGuard encryption end-to-end",
        "**No public exposure** — Your Mac Mini is NOT on the public internet",
        "**Only authorised devices** can connect — you control who's in the network",
        "**No passwords transmitted** — Tailscale uses cryptographic identity, not passwords",
        "**Free for personal use** — Tailscale's free tier supports up to 100 devices",
    ])

    doc.callout(
        "If you're uncomfortable with remote access, you don't need it. "
        "The Dashboard works perfectly on the Mac Mini's own screen or via "
        "your local WiFi network (http://192.168.x.x:3001).",
        "NOTE"
    )

    doc.save(f"{OUT}/06-remote-access.pdf")
    print("  06-remote-access.pdf")


if __name__ == '__main__':
    print("Generating 38.1 — Getting Started docs (PDF, v2 deep rewrite)...")
    doc_01_what_is_aiwh()
    doc_02_first_login()
    doc_03_talking_to_branson()
    doc_04_understanding_agents()
    doc_05_channels_setup()
    doc_06_remote_access()
    print(f"Done! 6 PDFs + 6 HTMLs in {OUT}")
