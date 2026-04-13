#!/usr/bin/env python3
"""Generate Phase 38.5 Part A — Customization docs (40-series) as branded PDF."""

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'lib'))
from pdf_brand import BrandPDF

OUT40 = '/opt/AIWH/core/docs/user-guide/40-customization'
os.makedirs(OUT40, exist_ok=True)


def doc_41_brand_setup():
    doc = BrandPDF("Brand Setup", "Making the system match your business identity")

    doc.h1("What Gets Branded")
    doc.body(
        "AIWH adapts to your brand across multiple touchpoints. Here's everything "
        "you can customise — and how."
    )
    doc.table([
        ["Element", "Where It's Used", "How to Change"],
        ["Brand Voice / Tone", "All written content (scripts, captions, emails)",
         "Tell Branson or edit Copywriter SOUL.md"],
        ["Video Avatar", "Daily video pipeline",
         "Update avatar-config.json with your HeyGen avatar ID"],
        ["Voice Clone", "Video narration",
         "Add your ElevenLabs voice ID to voice-config.json"],
        ["Content Pillars", "Topic generation (6 pillars, 3-day rotation)",
         "Tell Branson to update pillars or edit avatar-config.json"],
        ["Caption Style", "Instagram and X post captions",
         "Tell Branson your preferences"],
        ["Business Context", "All agent interactions",
         "Stored in your profile (onboarding Step 3)"],
        ["Industry Focus", "Research, knowledge, content topics",
         "Tell Branson your industry"],
    ])

    doc.h1("Setting Up Your Brand Voice")
    doc.body(
        "The Copywriter agent has 4 pre-trained voice styles (Taki Moore, Dan Kennedy, "
        "Alex Hormozi, Jon Gian). You can use one of these or train a custom voice."
    )

    doc.h2("Use a Pre-Trained Voice")
    doc.body("Tell Branson:")
    doc.bullet([
        '"Use the Hormozi voice — framework-heavy, math-driven"',
        '"Use the Dan Kennedy voice — direct response, no BS"',
        '"Use the Taki Moore voice — coaching, transformation-focused" (default)',
    ])

    doc.h2("Train a Custom Voice")
    doc.numbered([
        "Gather 5-10 examples of your writing (emails, posts, scripts)",
        'Tell Branson: "Train the Copywriter on my voice. Here are my examples:"',
        "Paste or upload the examples (via document ingestion)",
        "Branson updates the Copywriter's training files",
        "All future content matches your tone",
    ])
    doc.callout(
        "Voice training is permanent — it survives restarts and updates. "
        "Your customisation zone in SOUL.md is never overwritten by system updates.",
        "NOTE"
    )

    doc.h1("Setting Up Your Avatar")
    doc.body("Your daily videos use HeyGen talking-head avatars. Options:")

    doc.h2("Use Your Own Face")
    doc.numbered([
        "Create a custom avatar on HeyGen (heygen.com — Creator plan or above)",
        "Note your avatar ID from HeyGen's dashboard",
        'Tell Branson: "Use my HeyGen avatar [ID] for all videos"',
        "Or assign different looks per content pillar for variety",
    ])

    doc.h2("Use Stock Avatars")
    doc.body(
        "HeyGen offers stock avatars. Browse their library, pick one, "
        "and give Branson the ID."
    )

    doc.h1("Setting Up Your Voice Clone")
    doc.numbered([
        "Record a 3-5 minute voice sample (clear audio, normal speaking pace)",
        "Upload to ElevenLabs (elevenlabs.io — Creator plan for voice cloning)",
        "Copy your voice ID from ElevenLabs settings",
        'Tell Branson: "Use my ElevenLabs voice [ID]"',
    ])

    doc.h1("Setting Up Content Pillars")
    doc.body(
        "The default 6 pillars are designed for AI coaching businesses. "
        "If your business is different, replace them entirely:"
    )
    doc.bullet([
        '"Branson, replace my 6 video pillars. I\'m a real estate agent. Create pillars for: listings, buyer tips, market updates, investment, renovation, lifestyle"',
        '"Change the rotation to 2-day instead of 3-day — I want more variety"',
        '"Add a 7th pillar for testimonials"',
    ])

    doc.h1("Your Config Files")
    doc.body("All brand settings live in these files on your Mac Mini:")
    doc.table([
        ["File", "What It Controls"],
        ["/opt/AIWH/client/config/avatar-config.json",
         "6 pillars, rotation schedule, HeyGen avatar IDs per pillar"],
        ["/opt/AIWH/client/config/voice-config.json",
         "ElevenLabs voice choices (6 voices available)"],
        ["Copywriter SOUL.md (client zone)",
         "Brand voice rules, tone, writing style"],
        ["Your profile in auth.json",
         "Name, business, industry (from onboarding)"],
    ])

    doc.save(f"{OUT40}/41-brand-setup.pdf")
    print("  41-brand-setup.pdf")


def doc_42_changing_video_style():
    doc = BrandPDF("Changing Video Style", "Avatars, captions, pillars, posting schedule — all customisable")

    doc.h1("Video Customisation at a Glance")
    doc.table([
        ["What", "Default", "How to Change"],
        ["Avatar", "Branson (6 looks per pillar)", "HeyGen avatar ID in avatar-config.json"],
        ["Voice", "Mark (ElevenLabs preset)", "Your cloned voice ID in voice-config.json"],
        ["Pillars", "6 coaching pillars, 3-day rotation", "Tell Branson or edit avatar-config.json"],
        ["Script length", "130-160 words (52-64 seconds)", "Tell Branson (changes Copywriter SOUL.md)"],
        ["Caption style", "IG: hashtags + emoji. X: conversational", "Tell Branson your preferences"],
        ["Posting times", "Auto-scheduled via Buffer", "PUT /api/content/schedule-slots"],
        ["Platforms", "Instagram Reels + X", "Update Buffer channel IDs"],
        ["Video format", "9:16 vertical (Reels)", "Per-pillar in avatar-config.json"],
    ])

    doc.h1("The 6-Pillar System")
    doc.body(
        "Your video topics rotate through 6 content pillars on a 3-day cycle. "
        "Each pillar has its own avatar look and video format."
    )
    doc.body("Default pillars (coaching industry):")
    doc.table([
        ["Pillar", "Theme", "Format"],
        ["Demand Signals", "AI scrapes forums for customer pain points", "9:16 vertical"],
        ["Authority Engine", "Repurpose one video into 10 content pieces", "16:9 landscape"],
        ["Traction Machine", "AI operates all channels", "16:9 landscape"],
        ["Proof of Work", "Document the build, results, mistakes", "9:16 vertical"],
        ["Operations Live", "System reporting and orchestration", "16:9 landscape"],
        ["Compound Effect", "Audience and authority compound", "9:16 vertical"],
    ])
    doc.body("To replace with your industry pillars, tell Branson the 6 topics you want.")

    doc.h1("Changing Caption Style")
    doc.body("The Copywriter writes platform-specific captions:")
    doc.bullet([
        "**Instagram:** ≤220 characters + 5-8 niche hashtags + emoji + soft CTA",
        "**X/Twitter:** ≤280 characters, conversational, NO hashtags",
    ])
    doc.body("To change:")
    doc.bullet([
        '"Make Instagram captions longer with a story hook before the hashtags"',
        '"No emojis in captions — keep it professional"',
        '"Always include my website link in X captions"',
        '"Use only 3 hashtags per post, not 8"',
        '"Add a question at the end of every caption to boost engagement"',
    ])

    doc.h1("Changing Posting Schedule")
    doc.body("Default: 2 videos/day posted at automatic Buffer slots.")
    doc.bullet([
        '"Post at 10am, 2pm, and 6pm Brisbane time"',
        '"Only post 1 video on weekends"',
        '"Post 3 times per day on weekdays"',
        '"Schedule all posts for next week in advance"',
    ])

    doc.h1("Adding Platforms")
    doc.body("Currently supported: Instagram Reels, X/Twitter. Coming soon: TikTok, YouTube.")
    doc.bullet([
        '"Stop posting to X — Instagram only"',
        '"Add TikTok when it\'s available"',
    ])

    doc.h1("Cinematic Video Customisation")
    doc.body("For cinematic videos (Production view), you control:")
    doc.bullet([
        "**Output format:** 16:9 (YouTube), 9:16 (Reel/TikTok), 1:1 (Square)",
        "**Avatar or B-roll:** With or without a presenter",
        "**Caption position:** Top, centre, or bottom of frame",
        "**Caption style:** Clean, bold, or minimal",
        "**Voice:** Any ElevenLabs voice (6 presets + your clone)",
    ])

    doc.save(f"{OUT40}/42-changing-video-style.pdf")
    print("  42-changing-video-style.pdf")


def doc_43_adding_knowledge():
    doc = BrandPDF("Adding Knowledge", "Teaching the system your expertise — the #1 reason it gets smarter")

    doc.h1("Why Knowledge Matters")
    doc.body(
        "The knowledge base is **the #1 subscription value**. Every agent searches it "
        "before answering questions or creating content. The more knowledge you add, "
        "the smarter and more relevant your agents become."
    )
    doc.body("There are **two knowledge stores**:")
    doc.card_grid([
        ("Base Knowledge (Shared)", "Curated by AIWH. Updated nightly from HQ. "
         "780+ entries covering coaching, sales, funnels, content, AI. "
         "Every client gets these improvements automatically."),
        ("Client Knowledge (Private)", "YOUR expertise. Stays on YOUR Mac Mini. "
         "Never leaves your machine. Never shared with other clients. "
         "This is where your competitive advantage lives."),
    ])

    doc.h1("Three Ways to Add Knowledge")

    doc.h2("Method 1: Upload Documents (Easiest)")
    doc.body(
        "Upload PDFs, Word docs, PowerPoint, Markdown, or text files. "
        "The system reads, distils, and stores the key insights automatically."
    )
    doc.numbered([
        'Tell Branson: "Ingest this document" and describe what it is',
        "Or copy files directly to `/opt/AIWH/client/data/inbox/`",
        "The nightly pipeline processes them automatically",
        "Next morning, the knowledge is searchable by all your agents",
    ])
    doc.body("**Supported formats:** PDF, DOCX, PPTX, MD, TXT")
    doc.callout(
        "Documents are DISTILLED, not copy-pasted. The system rephrases concepts "
        "into clean, standalone knowledge entries. File paths, credentials, and "
        "platform-specific commands are stripped. Prompt injection patterns are blocked.",
        "SECURITY"
    )

    doc.h2("Method 2: Knowledge Tags (During Conversations)")
    doc.body(
        "When working with Branson or any agent, you can tag insights for "
        "extraction using this format:"
    )
    doc.code(
        '#knowledge-extraction [domain] type [confidence]\n'
        'Your insight here — a clear, standalone statement.'
    )
    doc.body("**Examples:**")
    doc.code(
        '#knowledge-extraction [sales] pattern [0.92]\n'
        'High-ticket objections about timeline resolve by offering a\n'
        'proof-of-concept period. "30 days zero risk" converts hesitation\n'
        'to signed agreements.\n'
        '\n'
        '#knowledge-extraction [content-strategy] insight [0.85]\n'
        'Carousel posts on Instagram get 3x more saves than single images.\n'
        'Use carousels for educational content, reels for hooks.'
    )
    doc.body("**Confidence scoring:**")
    doc.bullet([
        "**0.90-1.0** — Auto-published immediately (you're very sure)",
        "**0.50-0.89** — Flagged for review in Discord #knowledge-review",
        "**Below 0.50** — Rejected (too uncertain)",
    ])

    doc.h2("Method 3: Tell Branson (Simplest)")
    doc.body("Just tell Branson directly:")
    doc.bullet([
        '"Remember this: My best clients are coaches making $500K+ who struggle with lead gen"',
        '"Add to knowledge: Instagram carousels get 3x more saves than single images"',
        '"I learned that cold emails with subject lines under 5 words get 40% higher open rates — save that"',
    ])

    doc.divider()

    doc.h1("What Happens Behind the Scenes")
    doc.body("Every night at 11pm, the knowledge pipeline runs:")
    doc.numbered([
        "**Extract** — Scans today's agent sessions and memory for tagged knowledge + LLM extracts patterns",
        "**Embed** — Generates search vectors via OpenAI (so agents can find it by meaning, not keywords)",
        "**Review** — High-confidence (≥0.90) auto-publishes. Lower goes to Discord for human review",
        "**Publish** — Approved entries become searchable by all your agents",
        "**Sync** — Base knowledge updates from AIWH HQ are pulled to your local cache",
    ])
    doc.body("**Cost:** ~$0.65-1.90/month for the entire knowledge pipeline.")

    doc.h1("Knowledge Domains")
    doc.body("Tag your knowledge with these domains so agents can find it:")
    doc.table([
        ["Domain", "What Goes Here"],
        ["sales", "Sales patterns, objection handling, closing techniques"],
        ["content-strategy", "Content creation insights, platform tips"],
        ["coaching", "Coaching frameworks, session structures"],
        ["business", "Business models, positioning, pricing"],
        ["delegation", "Team management, delegation frameworks"],
        ["funnel", "Sales funnels, landing pages, conversion"],
        ["email", "Email marketing, sequences, subject lines"],
        ["social", "Social media strategy, platform-specific tips"],
        ["trading", "Market patterns, portfolio management"],
        ["finance", "Financial planning, budgeting, forecasting"],
    ])

    doc.h1("Searching Your Knowledge")
    doc.body(
        "Agents search automatically before every task. But you can also ask Branson:"
    )
    doc.bullet([
        '"What do we know about cold email best practices?"',
        '"Search knowledge for objection handling"',
        '"How many knowledge entries do we have about sales?"',
    ])

    doc.h1("Weekly Cleanup")
    doc.body(
        "Every Sunday at 9pm, the reconciliation process runs:"
    )
    doc.bullet([
        "**Duplicates** removed (newer version kept)",
        "**Contradictions** detected by Haiku AI and resolved (newer wins)",
        "**Stale entries** checked against current agent configs",
        "**Old short entries** flagged for review",
    ])

    doc.save(f"{OUT40}/43-adding-knowledge.pdf")
    print("  43-adding-knowledge.pdf")


def doc_44_custom_workflows():
    doc = BrandPDF("Custom Workflows", "Asking Branson to build automations for your business")

    doc.h1("What Branson Can Build")
    doc.body(
        "Branson isn't just a chatbot — he can build actual automations. "
        "He delegates to the Builder Manager (Opus model) for engineering tasks "
        "and can create scripts, crons, integrations, and pipelines."
    )

    doc.h2("Types of Custom Workflows")
    doc.table([
        ["Type", "Example", "Cost"],
        ["Script cron", "Export video stats to CSV every Friday", "Free (local script)"],
        ["Agent cron", "Weekly competitor analysis every Monday 9am", "~$0.01-0.10/run"],
        ["Data pipeline", "Sync CRM data from GHL to your dashboard", "Varies"],
        ["Report automation", "Monthly P&L report posted to Discord", "~$0.05/run"],
        ["Content workflow", "3-video burst for product launches", "~$6-10/burst"],
        ["Integration", "Connect Stripe webhook to CFO agent", "One-time build"],
    ])

    doc.h1("How to Request a Workflow")
    doc.body("Tell Branson what you want in plain language. Be specific about:")
    doc.bullet([
        "**What** should happen",
        "**When** it should run (schedule, trigger, or on-demand)",
        "**Where** the output should go (Discord, file, database)",
        "**How often** (daily, weekly, one-time)",
    ])

    doc.h2("Good Examples")
    doc.bullet([
        '"Every Friday at 5pm, generate a CSV of this week\'s video performance (views, engagement, publish times) and save to my Desktop"',
        '"When a new lead fills out the form on my website, have the Sales agent draft a personalised follow-up email and send it for my approval"',
        '"Every Monday morning, have Research compile what my top 3 competitors posted last week and summarise the trends"',
        '"Build a script that archives videos older than 60 days to Google Drive and cleans them from local storage"',
    ])

    doc.h2("Bad Examples (Too Vague)")
    doc.bullet([
        '"Make my business better" — What specifically? Content? Sales? Operations?',
        '"Automate everything" — Which tasks? What triggers?',
        '"Build me a CRM" — Use the CRM Manager agent instead, or specify what data you need',
    ])

    doc.h1("What to Expect")
    doc.numbered([
        "Branson asks clarifying questions if needed",
        "He estimates the cost before building (especially for Opus tasks)",
        "Builder Manager writes the code/script",
        "Branson tests it and confirms it works",
        "You approve, and it goes live",
        "The workflow is backed up and survives system updates",
    ])

    doc.callout(
        "Builder Manager uses Opus (~$0.05/message) — the most expensive model. "
        "Branson only activates it for real engineering tasks. Simple crons and "
        "configuration changes use Haiku (~$0.001).",
        "COST"
    )

    doc.h1("Workflow Ideas by Industry")
    doc.card_grid([
        ("Coaching / Consulting", "Weekly client progress reports, automated session prep, "
         "knowledge base of coaching frameworks, social proof collection"),
        ("Real Estate", "New listing alerts, market report automation, open home follow-ups, "
         "competitor listing monitoring"),
    ])
    doc.card_grid([
        ("E-Commerce / SaaS", "Customer feedback digests, feature request tracking, "
         "churn risk alerts, usage report automation"),
        ("Finance / Trading", "Daily market scans, portfolio alerts, news digest, "
         "risk threshold notifications"),
    ])

    doc.save(f"{OUT40}/44-custom-workflows.pdf")
    print("  44-custom-workflows.pdf")


def doc_45_module_activation():
    doc = BrandPDF("Module Activation", "Enabling and disabling Frontend, Backend, and Lifestyle")

    doc.h1("The Three Modules")
    doc.card_grid([
        ("Frontend ($2,500/mo)", "Content creation, video production, social media, sales funnels. "
         "Agents: Research, Copywriter, Video, Social, Funnel, Sales."),
        ("Backend ($2,500/mo)", "Finance, CRM, email, calendar, infrastructure. "
         "Agents: CFO, CRM Manager, Email Manager, Calendar Manager, Systems."),
    ])
    doc.card_grid([
        ("Lifestyle ($2,500/mo)", "Personal coaching, trading, travel. "
         "Agents: Coach, Trading, Travel."),
        ("System (Always On)", "Branson, Scheduler, Builder, Security, AI Council, Module Manager. "
         "Cannot be deactivated — these keep the system running."),
    ])

    doc.h1("Checking Your Active Modules")
    doc.body("Ask Branson:")
    doc.bullet([
        '"What modules are active on my system?"',
        '"Which agents are available to me?"',
    ])
    doc.body(
        "Or check the **Config** view in the Dashboard — your subscription "
        "and active modules are shown under Settings."
    )

    doc.h1("Activating a Module")
    doc.body("Contact AIWH to upgrade your subscription, then:")
    doc.bullet([
        '"Branson, activate the Backend module"',
        "Branson runs the activation script",
        "Backend agents become available immediately",
    ])

    doc.h1("Deactivating a Module")
    doc.bullet([
        '"Branson, deactivate the Lifestyle module — I don\'t need it right now"',
        "Agents in that module stop responding to tasks",
        "Crons for those agents are paused",
        "Your data and customisations are preserved (not deleted)",
        "Reactivate any time to resume where you left off",
    ])

    doc.callout(
        "When a module is inactive, any attempt to use its agents returns: "
        '"The [module] module is not active on this device. Contact AIWH to '
        'upgrade your subscription."',
        "NOTE"
    )

    doc.h1("What Happens to Data When Deactivated?")
    doc.bullet([
        "**Agent memory** — preserved on disk, available when reactivated",
        "**Customisations** — SOUL.md client zone stays intact",
        "**Crons** — paused, not deleted. Resume on reactivation",
        "**Knowledge** — remains in database, still searchable by other agents",
    ])

    doc.save(f"{OUT40}/45-module-activation.pdf")
    print("  45-module-activation.pdf")


if __name__ == '__main__':
    print("Generating 38.5a — Customization docs (PDF)...")
    doc_41_brand_setup()
    doc_42_changing_video_style()
    doc_43_adding_knowledge()
    doc_44_custom_workflows()
    doc_45_module_activation()
    print(f"Done! 5 PDFs in {OUT40}")
