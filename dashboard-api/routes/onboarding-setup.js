// ─── Onboarding Setup Routes ──────────────────────────────────
// GET /status, GET /features
// POST /set-features, /set-schedule, /set-integrations, /set-content
// POST /set-profile, /complete

const express = require('express');
const fs = require('fs');
const path = require('path');

module.exports = function createSetupRouter({ CLIENT_ROOT, AUTH_FILE, FEATURES, SERVICES, getSetupStatus, getStoredSecretNames }) {
  const router = express.Router();

  // ─── Setup Constants ──────────────────────────────────────
  const VALID_INTEGRATIONS = ['discord', 'telegram', 'whatsapp', 'slack', 'gohighlevel', 'xero', 'stripe'];

  // ─── Routes ───────────────────────────────────────────────

  // Get current setup status
  router.get('/status', (req, res) => {
    res.json(getSetupStatus());
  });

  // Get feature definitions
  router.get('/features', (req, res) => {
    res.json(FEATURES);
  });

  // Save selected features
  router.post('/set-features', (req, res) => {
    const { features } = req.body;
    if (!features || !Array.isArray(features) || features.length === 0) {
      return res.status(400).json({ error: 'Select at least one feature' });
    }

    const validIds = FEATURES.map(f => f.id);
    const invalid = features.filter(f => !validIds.includes(f));
    if (invalid.length > 0) {
      return res.status(400).json({ error: `Unknown features: ${invalid.join(', ')}` });
    }

    let auth = {};
    try { auth = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8')); } catch {}

    auth.selectedFeatures = features;

    const dir = path.dirname(AUTH_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2), { mode: 0o600 });

    res.json({ success: true });
  });

  // Save timezone & schedule preferences
  router.post('/set-schedule', (req, res) => {
    const { timezone, workStartHour, videosPerDay, researchFrequency } = req.body;
    if (!timezone || typeof timezone !== 'string') {
      return res.status(400).json({ error: 'Timezone is required' });
    }

    // Validate timezone is a real IANA timezone
    try { Intl.DateTimeFormat(undefined, { timeZone: timezone }); }
    catch { return res.status(400).json({ error: 'Invalid timezone' }); }

    const startHour = parseInt(workStartHour, 10);
    if (isNaN(startHour) || startHour < 0 || startHour > 23) {
      return res.status(400).json({ error: 'Work start hour must be 0-23' });
    }

    const videos = parseInt(videosPerDay, 10);
    if (isNaN(videos) || videos < 0 || videos > 5) {
      return res.status(400).json({ error: 'Videos per day must be 0-5' });
    }

    const validFreqs = ['daily', 'weekly', 'off'];
    const freq = validFreqs.includes(researchFrequency) ? researchFrequency : 'weekly';

    let auth = {};
    try { auth = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8')); } catch {}

    auth.schedule = { timezone, workStartHour: startHour, videosPerDay: videos, researchFrequency: freq };

    const dir = path.dirname(AUTH_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2), { mode: 0o600 });

    res.json({ success: true });
  });

  // Save selected integrations (flagged for post-onboarding setup)
  router.post('/set-integrations', (req, res) => {
    const { integrations } = req.body;
    if (!Array.isArray(integrations)) {
      return res.status(400).json({ error: 'Integrations must be an array' });
    }

    const valid = integrations.filter(i => VALID_INTEGRATIONS.includes(i));

    let auth = {};
    try { auth = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8')); } catch {}

    auth.selectedIntegrations = valid;

    const dir = path.dirname(AUTH_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2), { mode: 0o600 });

    res.json({ success: true });
  });

  // Save content configuration -> Branson's SOUL.md + content-pillars.json
  router.post('/set-content', (req, res) => {
    const { voice, methodology, pillars, icp, socialPlatforms, postsPerDay } = req.body;
    if (!pillars || !Array.isArray(pillars) || pillars.length === 0) {
      return res.status(400).json({ error: 'At least one content topic is required' });
    }

    let auth = {};
    try { auth = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8')); } catch {}

    const business = auth.profile?.business || 'My Business';
    const industry = auth.profile?.industry || 'Professional Services';

    // Write Branson's SOUL.md directly -- "what's the business"
    const coreDir = process.env.OPENCLAW_STATE_DIR
      ? path.join(process.env.OPENCLAW_STATE_DIR, '..')
      : '/opt/AIWH';
    const soulPath = path.join(coreDir, 'core', 'SOUL.md');
    const soulMd = `# Your Vision — ${business}

## Business
- **Name:** ${business}
- **Niche:** ${industry}
- **Target audience:** ${icp || 'To be defined'}

## Brand Voice
${voice || 'Professional and approachable'}

## Methodology
${methodology ? `**${methodology}**` : 'To be defined by talking to Branson'}

## Ideal Client
${icp || 'To be defined'}

<!-- Branson will evolve this file as he learns your business -->
`;

    // Build content-pillars.json (crons need structured data for topic rotation)
    // Enrich with descriptions/hashtags from industry pack if pillar names match
    let packPillars = {};
    try {
      const P = require('../helpers/paths');
      const packs = (P.getCatalogues().industryPacks || {}).packs || {};
      for (const pack of Object.values(packs)) {
        if (pack.label === industry && pack.suggested_pillars) {
          pack.suggested_pillars.forEach(p => { packPillars[p.name] = p; });
          break;
        }
      }
    } catch {}

    const pillarsPath = path.join(CLIENT_ROOT, 'config', 'content-pillars.json');
    const pillarObjs = pillars.map((name) => {
      const match = packPillars[name];
      return {
        id: (match?.id) || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
        name,
        description: match?.description || name,
        hashtags: match?.hashtags || [],
      };
    });

    const rotation = [];
    for (let i = 0; i < pillarObjs.length; i += 2) {
      if (i + 1 < pillarObjs.length) {
        rotation.push([pillarObjs[i].id, pillarObjs[i + 1].id]);
      } else {
        rotation.push([pillarObjs[i].id]);
      }
    }

    // Social platform defaults
    const validPlatforms = ['instagram', 'tiktok', 'x', 'linkedin', 'facebook'];
    const platforms = (socialPlatforms && Array.isArray(socialPlatforms))
      ? socialPlatforms.filter(p => validPlatforms.includes(p))
      : ['instagram'];
    const ppd = Math.min(3, Math.max(1, parseInt(postsPerDay, 10) || 2));
    const defaultFormats = { instagram: '9:16', tiktok: '9:16', linkedin: '16:9', x: '16:9', facebook: '1:1' };
    const platformFormats = {};
    platforms.forEach(p => { platformFormats[p] = defaultFormats[p] || '16:9'; });

    const pillarsJson = {
      pillars: pillarObjs,
      rotation,
      posting_frequency: `${ppd}/day`,
      content_formats: ['reel'],
      target_platforms: platforms,
      platform_formats: platformFormats,
      rotation_epoch: new Date().toISOString().split('T')[0],
    };

    // Build client-profile.md (agents @import this for niche context)
    const profilePath = path.join(CLIENT_ROOT, 'config', 'client-profile.md');
    const pillarSummary = pillarObjs.map(p => `  - **${p.name}** — ${p.description}`).join('\n');
    const profileMd = `# Client Profile — ${business}

## Business

- **Name:** ${business}
- **Niche:** ${industry}
- **Target audience:** ${icp || 'To be defined'}

## Brand Voice

${voice || 'Professional and approachable'}

## Methodology

${methodology ? `**${methodology}**` : 'To be defined by talking to Branson'}

## Content Pillars

${pillarSummary}

## Ideal Client

${icp || 'To be defined'}

<!-- Branson will evolve this file as he learns your business -->
`;

    try {
      // Write SOUL.md
      fs.writeFileSync(soulPath, soulMd);
      console.log(`[onboarding] Wrote SOUL.md for ${business}`);

      // Write client-profile.md
      const profileDir = path.dirname(profilePath);
      if (!fs.existsSync(profileDir)) fs.mkdirSync(profileDir, { recursive: true });
      fs.writeFileSync(profilePath, profileMd);
      console.log(`[onboarding] Wrote client-profile.md for ${business}`);

      // Write content-pillars.json
      const pillarsDir = path.dirname(pillarsPath);
      if (!fs.existsSync(pillarsDir)) fs.mkdirSync(pillarsDir, { recursive: true });
      fs.writeFileSync(pillarsPath, JSON.stringify(pillarsJson, null, 2) + '\n');

      // Write social defaults to client-policy.json if platforms selected
      if (platforms.length > 0) {
        const policyPath = path.join(CLIENT_ROOT, 'config', 'client-policy.json');
        let policy = {};
        try { policy = JSON.parse(fs.readFileSync(policyPath, 'utf8')); } catch {}
        if (!policy.social) {
          policy.social = {
            auto_publish_text: false, auto_publish_images: false,
            max_posts_per_day: ppd, engagement_hours: '08:00-20:00',
            reply_tone: 'friendly, use emojis, keep it casual',
            notify_on_comments: true, autonomy_threshold: 4.0,
            content_mix: { video_reels: 50, text_posts: 30, image_posts: 20 },
            max_retries: 3,
          };
          fs.writeFileSync(policyPath, JSON.stringify(policy, null, 2) + '\n');
          console.log(`[onboarding] Wrote social policy defaults`);
        }
      }

      // Save to auth for summary display
      auth.contentConfig = { voice, methodology, pillars, icp, socialPlatforms: platforms, postsPerDay: ppd };
      fs.writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2), { mode: 0o600 });

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to save content config', detail: err.message });
    }
  });

  // Save profile info -> auth.json + Branson's USER.md
  router.post('/set-profile', (req, res) => {
    const { name, business, industry, teammate } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });

    let auth = {};
    try { auth = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8')); } catch {}

    auth.profile = { name, business: business || '', industry: industry || '' };
    if (teammate && teammate.name) {
      auth.teammate = { name: teammate.name, email: teammate.email || '', remoteAccess: 'pending' };
    } else {
      delete auth.teammate;
    }

    const dir = path.dirname(AUTH_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2), { mode: 0o600 });

    // Write Branson's USER.md -- "who am I working for"
    try {
      const coreDir = process.env.OPENCLAW_STATE_DIR
        ? path.join(process.env.OPENCLAW_STATE_DIR, '..')
        : '/opt/AIWH';
      const userMdPath = path.join(coreDir, 'core', 'USER.md');
      let userMd = `# USER.md — About You\n\n`;
      userMd += `## ${name}\n`;
      if (business) userMd += `- **Business:** ${business}\n`;
      if (industry) userMd += `- **Industry:** ${industry}\n`;
      if (teammate && teammate.name) {
        userMd += `\n## ${teammate.name}\n`;
        userMd += `- **Role:** Team member\n`;
        if (teammate.email) userMd += `- **Email:** ${teammate.email}\n`;
        userMd += `- **Remote access:** Pending Tailscale setup\n`;
      }
      fs.writeFileSync(userMdPath, userMd);
      console.log(`[onboarding] Wrote USER.md for ${name}`);
    } catch (e) {
      console.error('[onboarding] Failed to write USER.md:', e.message);
    }

    res.json({ success: true });
  });

  // Complete onboarding
  router.post('/complete', (req, res) => {
    let auth = {};
    try { auth = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8')); } catch {}

    if (!auth.passwordHash) return res.status(400).json({ error: 'Password not set' });

    auth.setupComplete = true;
    auth.setupCompletedAt = new Date().toISOString();

    fs.writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2), { mode: 0o600 });

    // API keys are stored in secrets.enc (encrypted) -- no .env write needed.
    // Agents load secrets via aiwh_load_secrets -> secrets.py at runtime.
    const isTestMode = !CLIENT_ROOT.startsWith('/opt/AIWH/');

    // Write client-preferences.json from schedule + integrations
    try {
      const prefsPath = path.join(CLIENT_ROOT, 'config', 'client-preferences.json');
      const prefs = {
        timezone: auth.schedule?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
        workStartHour: auth.schedule?.workStartHour ?? 8,
        videosPerDay: auth.schedule?.videosPerDay ?? 1,
        researchFrequency: auth.schedule?.researchFrequency || 'weekly',
        selectedIntegrations: auth.selectedIntegrations || [],
        selectedFeatures: auth.selectedFeatures || [],
        createdAt: new Date().toISOString(),
      };
      fs.writeFileSync(prefsPath, JSON.stringify(prefs, null, 2));
      console.log(`[onboarding] Wrote client-preferences.json`);
    } catch (e) {
      console.error('[onboarding] Failed to write client-preferences.json:', e.message);
    }

    // Write VISION.md — client's north star, seeded from onboarding data
    try {
      const visionPath = path.join(CLIENT_ROOT, 'config', 'VISION.md');
      const business = auth.profile?.business || 'My Business';
      const industry = auth.profile?.industry || 'Professional Services';
      const icp = auth.contentConfig?.icp || 'To be defined';
      const methodology = auth.contentConfig?.methodology || '';

      // Derive goals from selected features
      const featureGoals = {
        video_sprint: 'Build a consistent video content engine',
        cinematic: 'Produce cinematic brand videos',
        social_growth: 'Grow social media presence and engagement',
        cold_outreach: 'Automate outbound lead generation',
        seo: 'Rank for high-intent search terms',
        knowledge: 'Build a deep knowledge base that compounds over time',
        notifications: 'Stay informed with automated reporting',
        ugc: 'Generate user-style content at scale',
      };
      const selectedFeatures = auth.selectedFeatures || [];
      const goals = selectedFeatures
        .map(f => featureGoals[f])
        .filter(Boolean)
        .map(g => `- [ ] ${g}`);
      if (goals.length === 0) goals.push('- [ ] Work with Branson to define your first goals');

      const visionMd = `# Vision — ${business}

## Why We Exist
To help ${icp} achieve results through ${methodology || industry.toLowerCase()} expertise.

## Who We Serve
${icp}

## What Makes Us Different
${methodology ? `**${methodology}**` : 'Work with Branson to define your unique methodology and positioning.'}

## Where We're Going (12 Months)
${goals.join('\n')}

## Revenue Target
_Ask Branson to help you set a revenue target and work backwards from it._

<!-- Ask Branson to help refine this. Say "let's work on our vision" anytime. -->
`;
      fs.writeFileSync(visionPath, visionMd);
      console.log(`[onboarding] Wrote VISION.md for ${business}`);
    } catch (e) {
      console.error('[onboarding] Failed to write VISION.md:', e.message);
    }

    // Write ROADMAP.md — stub for Branson to populate with client
    try {
      const roadmapPath = path.join(CLIENT_ROOT, 'config', 'ROADMAP.md');
      const roadmapMd = `# Roadmap — ${auth.profile?.business || 'My Business'}

## Active Projects
_No projects yet. Tell Branson what you want to achieve and he'll set one up._

## Completed
_Nothing yet — let's get started._

<!-- Branson updates this file as he creates projects in your dashboard. -->
`;
      fs.writeFileSync(roadmapPath, roadmapMd);
      console.log(`[onboarding] Wrote ROADMAP.md`);
    } catch (e) {
      console.error('[onboarding] Failed to write ROADMAP.md:', e.message);
    }

    // Bridge credentials into OpenClaw's auth-profiles.json
    try {
      const { applyCredentialsToAuthProfiles } = require('./onboarding-auth');
      const credCount = applyCredentialsToAuthProfiles();
      console.log(`[onboarding] Bridged ${credCount} credentials to auth-profiles.json`);
    } catch (e) {
      console.error('[onboarding] Credential bridge failed:', e.message);
    }

    // Auto-create notifications.json from the first configured channel
    try {
      const notifPath = path.join(CLIENT_ROOT, 'config', 'notifications.json');
      if (!fs.existsSync(notifPath)) {
        const ocPath = path.join(process.env.OPENCLAW_STATE_DIR || '/opt/AIWH/.openclaw', 'openclaw.json');
        const ocCfg = JSON.parse(fs.readFileSync(ocPath, 'utf8'));
        const chatChannels = Object.keys(ocCfg.channels || {}).filter(ch =>
          ch !== 'defaults' && ocCfg.channels[ch]?.enabled !== false
        );
        if (chatChannels.length > 0) {
          const ch = chatChannels[0]; // Use first configured channel as default
          const defaultRouting = {};
          for (const cat of ['general', 'systems', 'publish', 'spend', 'security']) {
            defaultRouting[cat] = { channel: ch, target: '' };
          }
          fs.writeFileSync(notifPath, JSON.stringify(defaultRouting, null, 2) + '\n');
          console.log(`[onboarding] Created notifications.json with default channel: ${ch}`);
        }
      }
    } catch (e) {
      console.error('[onboarding] Notification config creation failed (non-blocking):', e.message);
    }

    // Auto-provision crons based on selected features and preferences
    try {
      const cronProvisioner = require('../helpers/cron-provisioner');
      const prefsPath = path.join(CLIENT_ROOT, 'config', 'client-preferences.json');
      const prefs = fs.existsSync(prefsPath) ? JSON.parse(fs.readFileSync(prefsPath, 'utf8')) : {};
      // Pass scriptScheduler and adapter from the app context if available
      const scriptScheduler = req.app.get('scriptScheduler');
      const adapter = req.app.get('adapter');
      const result = cronProvisioner.provisionCronsForClient(prefs, { scriptScheduler, adapter });
      console.log(`[onboarding] Cron provisioning: ${result.created.length} created, ${result.skipped.length} skipped, ${result.errors.length} errors`);
      if (result.errors.length) console.error('[onboarding] Cron errors:', result.errors);
    } catch (e) {
      console.error('[onboarding] Cron provisioning failed (non-blocking):', e.message);
    }

    res.json({ success: true, redirect: '/login.html' });
  });

  return router;
};
