// ─── Onboarding API Routes (Orchestrator) ────────────────────
// Assembles 3 sub-route files and exports the combined router.
// All routes under /api/onboarding/* are exempt from auth middleware.
//
// Split into:
//   onboarding-setup.js    — wizard steps (status, features, schedule, content, profile, complete)
//   onboarding-provider.js — LLM provider, services, OAuth flows
//   onboarding-auth.js     — key verification, secrets, password, login/logout, credential bridge

const fs = require('fs');
const path = require('path');
const express = require('express');
const { execFileSync } = require('child_process');

const router = express.Router();

// ─── Shared Constants ───────────────────────────────────────

const CLIENT_ROOT = process.env.CLIENT_ROOT || '/opt/AIWH/client';
const SECRETS_ENC = path.join(CLIENT_ROOT, 'config', 'secrets.enc');
const AUTH_FILE = path.join(CLIENT_ROOT, 'config', 'auth.json');
const SECRETS_PY = path.join(__dirname, '../../scripts/lib/secrets.py');

// OpenAI Codex OAuth Config
const OPENAI_OAUTH = {
  clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
  authorizeUrl: 'https://auth.openai.com/oauth/authorize',
  tokenUrl: 'https://auth.openai.com/oauth/token',
  scope: 'openid profile email offline_access',
  jwtClaimPath: 'https://api.openai.com/auth',
};

// Active OAuth sessions (state -> { verifier, createdAt })
const oauthSessions = new Map();

// ─── Shared Helpers ─────────────────────────────────────────

function isFirstRun() {
  return !fs.existsSync(SECRETS_ENC) || !fs.existsSync(AUTH_FILE);
}

function getStoredSecretNames() {
  try {
    const out = execFileSync('python3', [SECRETS_PY, 'list'], { encoding: 'utf8', timeout: 5000 });
    return out.trim().split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.includes(' ') && l === l.toUpperCase());
  } catch {
    return [];
  }
}

function getSetupStatus() {
  let auth = null;
  try { auth = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8')); } catch {}

  return {
    firstRun: isFirstRun(),
    hasPassword: !!(auth && auth.passwordHash),
    hasProfile: !!(auth && auth.profile && auth.profile.name),
    hasFeatures: !!(auth && auth.selectedFeatures && auth.selectedFeatures.length > 0),
    selectedFeatures: (auth && auth.selectedFeatures) || [],
    hasContent: !!(auth && auth.contentConfig && auth.contentConfig.pillars),
    hasSchedule: !!(auth && auth.schedule && auth.schedule.timezone),
    hasIntegrations: !!(auth && auth.selectedIntegrations && auth.selectedIntegrations.length > 0),
    selectedIntegrations: (auth && auth.selectedIntegrations) || [],
    secrets: getStoredSecretNames(),
    complete: !!(auth && auth.setupComplete),
  };
}

// ─── Data Definitions ───────────────────────────────────────

const FEATURES = [
  {
    id: 'video_sprint',
    name: 'Daily Video Automation',
    description: 'Post professional AI presenter videos to social media every day — fully automated',
    category: 'content',
    icon: 'sprint',
    services: ['ANTHROPIC_API_KEY', 'ELEVENLABS_API_KEY', 'HEYGEN_API_KEY', 'BUFFER_API_TOKEN'],
    oauthServices: ['GOOGLE_WORKSPACE'],
  },
  {
    id: 'cinematic',
    name: 'Cinematic Video Production',
    description: 'Studio-quality cinematic content with AI-generated visuals and professional voiceover',
    category: 'content',
    icon: 'cinematic',
    services: ['ANTHROPIC_API_KEY', 'ELEVENLABS_API_KEY'],
    oauthServices: ['GOOGLE_CLOUD', 'GOOGLE_WORKSPACE'],
  },
  {
    id: 'ugc',
    name: 'UGC Content at Scale',
    description: 'Create product demos and testimonials 20x cheaper than hiring creators',
    category: 'content',
    icon: 'ugc',
    services: ['ANTHROPIC_API_KEY', 'ELEVENLABS_API_KEY', 'HEYGEN_API_KEY'],
    oauthServices: ['GOOGLE_CLOUD'],
  },
  {
    id: 'cold_outreach',
    name: 'Cold Outreach & Lead Gen',
    description: 'Find buying signals, enrich leads, and send personalized emails automatically',
    category: 'growth',
    icon: 'outreach',
    services: ['ANTHROPIC_API_KEY'],
    oauthServices: ['GOOGLE_WORKSPACE'],
  },
  {
    id: 'seo',
    name: 'SEO Content Automation',
    description: 'Generate and publish optimised articles that rank on Google',
    category: 'growth',
    icon: 'seo',
    services: ['ANTHROPIC_API_KEY'],
    oauthServices: [],
  },
  {
    id: 'knowledge',
    name: 'Knowledge & Research',
    description: 'AI-powered research with semantic search across your documents',
    category: 'tools',
    icon: 'knowledge',
    services: ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY'],
    oauthServices: ['GOOGLE_WORKSPACE'],
  },
  {
    id: 'social_growth',
    name: 'Social Media Growth',
    description: 'Automated posting schedule, engagement monitoring, hashtag research, and performance tracking across Instagram, TikTok, X, and LinkedIn',
    category: 'growth',
    icon: 'social',
    services: ['ANTHROPIC_API_KEY', 'BUFFER_API_TOKEN'],
    oauthServices: [],
  },
  {
    id: 'notifications',
    name: 'Notifications & Alerts',
    description: 'Get real-time alerts on pipeline events and completions via Discord, Telegram, or Slack',
    category: 'tools',
    icon: 'notifications',
    services: [],
    oauthServices: [],
  },
];

const SERVICES = [
  {
    id: 'ANTHROPIC_API_KEY',
    name: 'Anthropic',
    description: 'Powers your AI team\'s intelligence',
    required: true,
    logo: 'A',
    color: '#D4A574',
    authType: 'apikey',
    helpUrl: 'https://console.anthropic.com/settings/keys',
    signupUrl: 'https://console.anthropic.com/',
    validateEndpoint: 'https://api.anthropic.com/v1/messages',
    validateHeader: 'x-api-key',
    billing: {
      model: 'Pay-per-use',
      note: 'You pay only for what your AI team uses. No subscription required. Add a credit card, generate an API key, and paste it here.',
      cost: '~$30\u2013100/mo depending on usage',
      plan: 'No minimum plan \u2014 pay as you go',
    },
    alternative: {
      id: 'CHATGPT_OAUTH',
      name: 'ChatGPT (Codex)',
      description: 'Use your existing ChatGPT Pro subscription instead',
      note: 'If you already have ChatGPT Pro, you can use Codex 5.4 via OAuth instead of an Anthropic API key. This removes the biggest API cost.',
      authType: 'oauth',
      signupUrl: 'https://chat.openai.com/',
    },
  },
  {
    id: 'ELEVENLABS_API_KEY',
    name: 'ElevenLabs',
    description: 'Clones your voice for AI-generated narration',
    required: false,
    logo: 'XI',
    color: '#5E5ADB',
    authType: 'apikey',
    helpUrl: 'https://elevenlabs.io/app/settings/api-keys',
    signupUrl: 'https://elevenlabs.io/',
    validateEndpoint: 'https://api.elevenlabs.io/v1/user',
    validateHeader: 'xi-api-key',
    billing: {
      model: 'Subscription (credits included)',
      note: 'Your subscription gives you monthly credits \u2014 API calls use those same credits. No extra charges. You need the Creator plan or above to clone your voice.',
      cost: '~$22/mo (Creator plan)',
      plan: 'Creator plan minimum (for voice cloning + API access)',
    },
    permissions: 'When creating the API key, select ALL permissions (full access). The system needs: Text-to-Speech, Voice Cloning, Models, and User info.',
  },
  {
    id: 'HEYGEN_API_KEY',
    name: 'HeyGen',
    description: 'Creates your AI video presenter avatar',
    required: false,
    logo: 'HG',
    color: '#7C3AED',
    authType: 'apikey',
    helpUrl: 'https://app.heygen.com/settings?nav=API',
    signupUrl: 'https://app.heygen.com/',
    validateEndpoint: 'https://api.heygen.com/v2/user/remaining_quota',
    validateHeader: 'X-Api-Key',
    billing: {
      model: 'Subscription + separate API credits',
      note: 'You need a subscription to clone your avatar, but the subscription credits DO NOT cover API usage. You must add separate API credits in your HeyGen dashboard under Settings \u2192 API \u2192 Add Credits.',
      cost: '$29\u201389/mo subscription + API credits on top',
      plan: 'Creator plan ($29/mo) for avatar cloning. API credits charged separately per video minute.',
      warning: 'Subscription credits and API credits are separate. Make sure to load API credits after subscribing.',
    },
  },
  {
    id: 'BUFFER_API_TOKEN',
    name: 'Buffer',
    description: 'Schedules and posts to your social media',
    required: false,
    logo: 'B',
    color: '#2D4EA2',
    authType: 'apikey',
    helpUrl: 'https://publish.buffer.com/settings/api',
    signupUrl: 'https://publish.buffer.com/settings/beta',
    validateEndpoint: 'https://api.buffer.com/graphql',
    validateBearer: true,
    billing: {
      model: 'Free tier available',
      note: 'The free plan gives you 10 scheduled posts per channel. Paid plans unlock more channels and analytics.',
      cost: 'Free \u2014 or $6/mo per channel for Essentials',
      plan: 'Free plan works to start. Upgrade when you need more channels.',
    },
    setup: 'Step 1: Go to Settings \u2192 Beta Features and enable "API Access". Step 2: Hard refresh your browser (Ctrl+Shift+R). Step 3: Go to Settings \u2192 API and copy your access token. The page also shows your Organization ID \u2014 copy that too.',
  },
  {
    id: 'OPENAI_API_KEY',
    name: 'OpenAI',
    description: 'Powers text embeddings for knowledge search',
    required: false,
    logo: 'OA',
    color: '#10A37F',
    authType: 'apikey',
    helpUrl: 'https://platform.openai.com/api-keys',
    signupUrl: 'https://platform.openai.com/',
    validateEndpoint: 'https://api.openai.com/v1/models',
    validateBearer: true,
    billing: {
      model: 'Pay-per-use',
      note: 'Used only for text embeddings (semantic search), not for chat. Very low cost \u2014 typically under $5/month. Add a credit card and generate an API key.',
      cost: 'Under $5/mo typical',
      plan: 'No minimum plan \u2014 pay as you go',
    },
  },
  {
    id: 'OPENROUTER_API_KEY',
    name: 'OpenRouter',
    description: 'One API key for hundreds of AI models (Claude, GPT, Gemini, Llama, and more)',
    required: false,
    logo: 'OR',
    color: '#6466F1',
    authType: 'apikey',
    helpUrl: 'https://openrouter.ai/settings/keys',
    signupUrl: 'https://openrouter.ai/',
    validateEndpoint: 'https://openrouter.ai/api/v1/models',
    validateBearer: true,
    billing: {
      model: 'Pay-per-use',
      note: 'Create your account at openrouter.ai \u2014 one API key gives you access to hundreds of models (Claude, GPT, Gemini, Llama, etc.). You pay OpenRouter directly for what you use.',
      cost: 'Varies by model \u2014 typically $0.10\u201315 per million tokens',
      plan: 'No minimum \u2014 add credits and go',
    },
    alternative: {
      for: 'ANTHROPIC_API_KEY',
      note: 'You can use OpenRouter instead of (or alongside) a direct Anthropic key. OpenRouter gives you access to Claude plus hundreds of other models through one account.',
    },
  },
];

const OAUTH_SERVICES = [
  {
    id: 'GOOGLE_CLOUD',
    name: 'Google Cloud',
    description: 'AI image & video generation (Vertex AI)',
    logo: 'GC',
    color: '#4285F4',
    checkCommand: ['gcloud', 'auth', 'print-access-token'],
  },
  {
    id: 'GOOGLE_WORKSPACE',
    name: 'Google Workspace',
    description: 'Drive, Sheets, Gmail, Calendar',
    logo: 'GW',
    color: '#34A853',
    checkCommand: ['gws', 'drive', 'about', 'get', '--params', '{"fields":"user"}'],
  },
];

// ─── Shared deps for sub-routers ────────────────────────────

const sharedDeps = {
  CLIENT_ROOT,
  AUTH_FILE,
  FEATURES,
  SERVICES,
  OAUTH_SERVICES,
  OPENAI_OAUTH,
  oauthSessions,
  getSetupStatus,
  getStoredSecretNames,
  isFirstRun,
  execFileSync,
};

// ─── Mount Sub-Routers ──────────────────────────────────────

const setupRouter = require('./onboarding-setup')(sharedDeps);
const providerRouter = require('./onboarding-provider')(sharedDeps);
const authRouter = require('./onboarding-auth')(sharedDeps);

router.use(setupRouter);
router.use(providerRouter);
router.use(authRouter);

// ─── Exports ────────────────────────────────────────────────

module.exports = router;
module.exports.isFirstRun = isFirstRun;
module.exports.SERVICES = SERVICES;
module.exports.FEATURES = FEATURES;
module.exports.OAUTH_SERVICES = OAUTH_SERVICES;
