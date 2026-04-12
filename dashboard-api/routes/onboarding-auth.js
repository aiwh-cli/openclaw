// ─── Onboarding Auth Routes ───────────────────────────────────
// POST /verify-key, /store-secret, /set-password
// POST /login, /logout
// POST /apply-credentials
// Auth middleware + credential bridge

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CLIENT_ROOT = process.env.CLIENT_ROOT || '/opt/AIWH/client';
const SECRETS_PY = path.join(__dirname, '../../scripts/lib/secrets.py');
const AUTH_FILE = path.join(CLIENT_ROOT, 'config', 'auth.json');
const SECRETS_ENC = path.join(CLIENT_ROOT, 'config', 'secrets.enc');

// ─── Credential Bridge (AC.5 — SecretRef) ───────────────────
// Writes SecretRef entries into OpenClaw's auth-profiles.json.
// Keys are resolved at runtime from env vars — never stored as plaintext on disk.
// Env vars are injected into the gateway LaunchAgent plist (macOS) or Docker env (Linux).

const P = require('../helpers/paths');
const CANONICAL_AUTH = path.join(__dirname, '../../../.openclaw/agents/main/agent/auth-profiles.json');
const SYNC_SCRIPT = path.join(__dirname, '../../scripts/sync-auth-profiles.sh');

// Map secret IDs -> auth-profiles.json SecretRef entries.
// Only secrets stored in secrets.enc go here — the credential bridge writes keyRef (env var reference).
// Discord uses a separate auth path (openclaw.json auth.profiles) and keeps its plaintext key.
const SECRET_TO_PROFILE = {
  ANTHROPIC_API_KEY: { profileId: 'anthropic:default', provider: 'anthropic' },
  OPENROUTER_API_KEY: { profileId: 'openrouter:default', provider: 'openrouter' },
  OPENAI_API_KEY: { profileId: 'openai:default', provider: 'openai' },
  BRAVE_API_KEY: { profileId: 'brave:default', provider: 'brave' },
};

function getSecretValue(secretId) {
  const { execFileSync } = require('child_process');
  try {
    const out = execFileSync('python3', [SECRETS_PY, 'load', secretId], {
      encoding: 'utf8', timeout: 5000,
    }).trim();
    const match = out.match(/^export\s+\S+=(?:'([^']*)'|"([^"]*)"|(\S+))$/m);
    return match ? (match[1] ?? match[2] ?? match[3]) : null;
  } catch { return null; }
}

function applyCredentialsToAuthProfiles() {
  const { execFileSync } = require('child_process');

  // Load existing auth-profiles (preserve usageStats, OAuth profiles, unknown profiles)
  let store = { version: 1, profiles: {}, lastGood: {}, usageStats: {} };
  try {
    if (fs.existsSync(CANONICAL_AUTH)) {
      store = JSON.parse(fs.readFileSync(CANONICAL_AUTH, 'utf8'));
    }
  } catch {}

  let updated = 0;
  const envSecrets = {};
  for (const [secretId, { profileId, provider }] of Object.entries(SECRET_TO_PROFILE)) {
    const value = getSecretValue(secretId);
    if (!value) continue;

    // Write SecretRef — gateway resolves from env var at runtime.
    // No plaintext keys in auth-profiles.json.
    store.profiles[profileId] = {
      type: 'api_key',
      provider,
      key: null,
      keyRef: { source: 'env', provider: 'default', id: secretId },
    };
    store.lastGood[provider] = profileId;
    envSecrets[secretId] = value;
    updated++;
  }

  if (updated > 0) {
    const dir = path.dirname(CANONICAL_AUTH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CANONICAL_AUTH, JSON.stringify(store, null, 2), { mode: 0o600 });

  }

  // Inject ALL secrets as env vars into gateway LaunchAgent (macOS).
  // On Docker, openclaw-container.sh handles this via -e flags.
  // This covers auth profiles (SecretRef), MCP connectors, and cron scripts.
  try {
    const allSecretsOutput = execFileSync('python3', [SECRETS_PY, 'load', '--all'], {
      encoding: 'utf8', timeout: 10000,
    }).trim();
    if (allSecretsOutput) {
      const allSecrets = {};
      for (const line of allSecretsOutput.split('\n')) {
        const m = line.match(/^export\s+([A-Z_][A-Z0-9_]*)=(?:'([^']*)'|"([^"]*)"|(\S+))$/);
        if (m) allSecrets[m[1]] = m[2] ?? m[3] ?? m[4];
      }
      P.injectSecretsIntoGatewayPlist(allSecrets);
    }
  } catch (e) {
    console.error('[credential-bridge] Failed to inject secrets into gateway plist:', e.message);
  }

  // Ensure symlinks exist for all agents
  try {
    execFileSync('bash', [SYNC_SCRIPT], { timeout: 10000, encoding: 'utf8' });
  } catch (e) {
    console.error('[onboarding] sync-auth-profiles failed:', e.message);
  }

  return updated;
}

// ─── Router Factory ─────────────────────────────────────────

module.exports = function createAuthRouter({ SERVICES, execFileSync: _execFileSync }) {
  const router = express.Router();
  const execFileSyncFn = _execFileSync || require('child_process').execFileSync;

  // Verify an API key against its service (without storing)
  router.post('/verify-key', async (req, res) => {
    const { serviceId, key } = req.body;
    if (!serviceId || !key) return res.status(400).json({ error: 'serviceId and key required' });

    const service = SERVICES.find(s => s.id === serviceId);
    if (!service) return res.status(400).json({ error: 'Unknown service' });

    try {
      const headers = { 'Content-Type': 'application/json' };

      if (service.validateHeader) {
        headers[service.validateHeader] = key;
      } else if (service.validateBearer) {
        headers['Authorization'] = `Bearer ${key}`;
      }

      let url = service.validateEndpoint;
      if (service.validateQuery) {
        url += `?${service.validateQuery}=${encodeURIComponent(key)}`;
      }

      // Special cases for services that need POST
      const fetchOpts = { headers, method: 'GET' };
      if (serviceId === 'BUFFER_API_TOKEN') {
        fetchOpts.method = 'POST';
        fetchOpts.body = JSON.stringify({ query: '{ account { id } }' });
      }
      if (serviceId === 'ANTHROPIC_API_KEY') {
        fetchOpts.method = 'POST';
        headers['anthropic-version'] = '2023-06-01';
        fetchOpts.body = JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        });
      }

      const resp = await fetch(url, fetchOpts);
      const valid = resp.ok || resp.status === 200 || resp.status === 201;

      res.json({ valid, status: resp.status });
    } catch (err) {
      res.json({ valid: false, error: err.message });
    }
  });

  // Store a verified secret
  router.post('/store-secret', (req, res) => {
    const { serviceId, key } = req.body;
    if (!serviceId || !key) return res.status(400).json({ error: 'serviceId and key required' });

    // Validate serviceId is a known service
    const known = SERVICES.find(s => s.id === serviceId);
    if (!known) return res.status(400).json({ error: 'Unknown service' });

    try {
      execFileSyncFn('python3', [SECRETS_PY, 'store', serviceId, key], { timeout: 10000 });
      // Inject into gateway plist so SecretRef can resolve this key
      P.injectSecretsIntoGatewayPlist({ [serviceId]: key });
      res.json({ stored: true, serviceId });
    } catch (err) {
      res.status(500).json({ error: 'Failed to store secret', detail: err.message });
    }
  });

  // Set dashboard password
  router.post('/set-password', (req, res) => {
    const { password } = req.body;
    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');

    let auth = {};
    try { auth = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8')); } catch {}

    auth.passwordHash = hash;
    auth.passwordSalt = salt;
    auth.passwordSetAt = new Date().toISOString();

    const dir = path.dirname(AUTH_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2), { mode: 0o600 });

    res.json({ success: true });
  });

  // Login (for after onboarding)
  router.post('/login', (req, res) => {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Password required' });

    let auth = {};
    try { auth = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8')); } catch {
      return res.status(401).json({ error: 'No password set' });
    }

    if (!auth.passwordHash || !auth.passwordSalt) {
      return res.status(401).json({ error: 'No password set' });
    }

    const hash = crypto.scryptSync(password, auth.passwordSalt, 64).toString('hex');
    if (!crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(auth.passwordHash, 'hex'))) {
      return res.status(401).json({ error: 'Incorrect password' });
    }

    // Generate session token
    const token = crypto.randomBytes(32).toString('hex');
    auth.sessionToken = token;
    auth.sessionCreatedAt = new Date().toISOString();
    fs.writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2), { mode: 0o600 });

    res.cookie('aiwh_session', token, {
      httpOnly: true,
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000, // 24h
      path: '/',
    });

    res.json({ success: true, redirect: '/' });
  });

  // Logout
  router.post('/logout', (req, res) => {
    let auth = {};
    try { auth = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8')); } catch {}
    delete auth.sessionToken;
    try { fs.writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2), { mode: 0o600 }); } catch {}
    res.clearCookie('aiwh_session');
    res.json({ success: true });
  });

  // Apply credentials to auth-profiles.json
  router.post('/apply-credentials', (req, res) => {
    try {
      const updated = applyCredentialsToAuthProfiles();
      res.json({ success: true, profilesUpdated: updated });
    } catch (err) {
      res.status(500).json({ error: 'Failed to apply credentials', detail: err.message });
    }
  });

  return router;
};

// Export standalone functions for use by other modules
module.exports.applyCredentialsToAuthProfiles = applyCredentialsToAuthProfiles;
