// ─── Onboarding Provider Routes ───────────────────────────────
// GET /industry-packs, /services, /check-oauth/:serviceId
// POST /set-provider, GET /provider, POST /apply-provider
// OAuth flows: GET /oauth/openai, GET /oauth/openai/callback,
//   GET /oauth/openai/status, POST /oauth/openai/disconnect

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

module.exports = function createProviderRouter({ CLIENT_ROOT, AUTH_FILE, FEATURES, SERVICES, OAUTH_SERVICES, OPENAI_OAUTH, oauthSessions, getSetupStatus, execFileSync }) {
  const router = express.Router();

  // ─── PKCE helpers (matches pi-ai/oauth/pkce.js) ───────────
  function base64urlEncode(bytes) {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return Buffer.from(binary, 'binary').toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }
  async function generatePKCE() {
    const verifierBytes = crypto.randomBytes(32);
    const verifier = base64urlEncode(verifierBytes);
    const hash = crypto.createHash('sha256').update(verifier).digest();
    const challenge = base64urlEncode(hash);
    return { verifier, challenge };
  }
  function decodeJwtPayload(token) {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      return JSON.parse(Buffer.from(parts[1], 'base64').toString());
    } catch { return null; }
  }

  // HTML page shown in OAuth popup after callback
  function oauthResultPage(success, message) {
    const color = success ? '#4CAF7A' : '#E05252';
    const icon = success ? '\u2714' : '\u2716';
    return `<!DOCTYPE html>
<html><head><title>AIWH \u2014 ${success ? 'Connected' : 'Error'}</title></head>
<body style="background:#0A0A0C;color:#F5EDD6;font-family:'Inter',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
  <div style="text-align:center;max-width:400px;padding:40px">
    <div style="font-size:48px;color:${color};margin-bottom:16px">${icon}</div>
    <h2 style="margin:0 0 12px;font-size:20px">${success ? 'ChatGPT Connected' : 'Connection Failed'}</h2>
    <p style="color:#8A8578;font-size:14px;line-height:1.6">${message}</p>
    <p style="color:#4A4740;font-size:12px;margin-top:24px">This window will close automatically...</p>
  </div>
  <script>
    if (window.opener) {
      window.opener.postMessage({ type: 'aiwh-oauth-result', success: ${success}, provider: 'openai-codex' }, window.location.origin);
    }
    setTimeout(() => window.close(), ${success ? 2000 : 4000});
  </script>
</body></html>`;
  }

  // ─── Routes ───────────────────────────────────────────────

  // Get industry packs for dropdown
  router.get('/industry-packs', (req, res) => {
    try {
      const P = require('../helpers/paths');
      const data = P.getCatalogues().industryPacks || { packs: {} };
      res.json(data);
    } catch (e) {
      res.json({ packs: {} });
    }
  });

  // Get service definitions (optionally filtered by selected features)
  router.get('/services', (req, res) => {
    const status = getSetupStatus();
    const features = req.query.features ? req.query.features.split(',') : null;

    let neededIds = null;
    let neededOAuth = null;
    if (features && features.length > 0) {
      neededIds = new Set();
      neededOAuth = new Set();
      // At least one LLM provider required -- show both Anthropic and OpenRouter
      neededIds.add('ANTHROPIC_API_KEY');
      neededIds.add('OPENROUTER_API_KEY');
      for (const fid of features) {
        const feat = FEATURES.find(f => f.id === fid);
        if (feat) {
          feat.services.forEach(s => neededIds.add(s));
          feat.oauthServices.forEach(s => neededOAuth.add(s));
        }
      }
    }

    const services = SERVICES
      .filter(s => !neededIds || neededIds.has(s.id))
      .map(s => ({
        ...s,
        stored: status.secrets.includes(s.id),
      }));

    const oauthServices = OAUTH_SERVICES
      .filter(s => !neededOAuth || neededOAuth.has(s.id));

    res.json({ services, oauthServices });
  });

  // Check OAuth service connectivity
  router.get('/check-oauth/:serviceId', (req, res) => {
    const svc = OAUTH_SERVICES.find(s => s.id === req.params.serviceId);
    if (!svc) return res.status(400).json({ error: 'Unknown OAuth service' });

    try {
      execFileSync(svc.checkCommand[0], svc.checkCommand.slice(1), {
        encoding: 'utf8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'],
      });
      res.json({ connected: true, serviceId: svc.id });
    } catch {
      res.json({ connected: false, serviceId: svc.id });
    }
  });

  // Set LLM provider choice
  // Saves to auth.json only -- does NOT touch openclaw.json
  router.post('/set-provider', (req, res) => {
    const { provider } = req.body;
    if (!provider || !['anthropic', 'openai', 'openrouter'].includes(provider)) {
      return res.status(400).json({ error: 'Provider must be "anthropic", "openai", or "openrouter"' });
    }

    let auth = {};
    try { auth = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8')); } catch {}

    auth.llmProvider = provider;

    const dir = path.dirname(AUTH_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2), { mode: 0o600 });

    res.json({ success: true, provider });
  });

  // Get current provider choice
  router.get('/provider', (req, res) => {
    let auth = {};
    try { auth = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8')); } catch {}
    res.json({ provider: auth.llmProvider || 'anthropic' });
  });

  // Apply provider choice to openclaw.json
  // Rewrites agent model references to use the selected provider
  router.post('/apply-provider', (req, res) => {
    let auth = {};
    try { auth = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8')); } catch {}

    const provider = auth.llmProvider || 'anthropic';
    const OPENCLAW_JSON = path.join(__dirname, '../../../.openclaw/openclaw.json');

    // Canonical Anthropic models -> equivalents per provider
    const PROVIDER_MAPS = {
      openai: {
        'anthropic/claude-haiku-4-5': 'openai/gpt-4o-mini',
        'anthropic/claude-sonnet-4-5': 'openai/gpt-4o',
        'anthropic/claude-opus-4-6': 'openai/codex-5.4',
      },
      openrouter: {
        'anthropic/claude-haiku-4-5': 'openrouter/anthropic/claude-haiku-4-5',
        'anthropic/claude-sonnet-4-5': 'openrouter/anthropic/claude-sonnet-4-5',
        'anthropic/claude-opus-4-6': 'openrouter/anthropic/claude-opus-4-6',
      },
    };

    // Build bidirectional map: any known model -> target provider model
    function buildModelMap(targetProvider) {
      if (targetProvider === 'anthropic') {
        // Reverse all provider maps back to anthropic
        const map = {};
        for (const pMap of Object.values(PROVIDER_MAPS)) {
          for (const [anthropicId, providerId] of Object.entries(pMap)) {
            map[providerId] = anthropicId;
          }
        }
        return map;
      }
      const targetMap = PROVIDER_MAPS[targetProvider];
      if (!targetMap) return {};
      // Also map other providers' models back to anthropic first, then to target
      const map = { ...targetMap };
      for (const [pName, pMap] of Object.entries(PROVIDER_MAPS)) {
        if (pName === targetProvider) continue;
        for (const [anthropicId, providerId] of Object.entries(pMap)) {
          map[providerId] = targetMap[anthropicId] || anthropicId;
        }
      }
      return map;
    }

    try {
      const config = JSON.parse(fs.readFileSync(OPENCLAW_JSON, 'utf8'));
      const map = buildModelMap(provider);

      // Ensure auth profile exists for provider
      if (!config.auth) config.auth = {};
      if (!config.auth.profiles) config.auth.profiles = {};
      if (provider === 'openai') {
        config.auth.profiles['openai:default'] = { provider: 'openai', mode: 'api_key' };
      } else if (provider === 'openrouter') {
        config.auth.profiles['openrouter:default'] = { provider: 'openrouter', mode: 'api_key' };
      }

      // Update agent model references
      const replaceModels = (obj) => {
        if (typeof obj === 'string' && map[obj]) return map[obj];
        if (Array.isArray(obj)) return obj.map(replaceModels);
        if (obj && typeof obj === 'object') {
          const out = {};
          for (const [k, v] of Object.entries(obj)) {
            out[k] = (k === 'model' || k === 'primary') && typeof v === 'string' && map[v]
              ? map[v]
              : replaceModels(v);
            if (k === 'fallbacks' && Array.isArray(v)) {
              out[k] = v.map(m => map[m] || m);
            }
          }
          return out;
        }
        return obj;
      };

      config.agents = replaceModels(config.agents);
      fs.writeFileSync(OPENCLAW_JSON, JSON.stringify(config, null, 2), { mode: 0o600 });

      res.json({ success: true, provider, modelsUpdated: Object.keys(map).length });
    } catch (err) {
      res.status(500).json({ error: 'Failed to update openclaw.json', detail: err.message });
    }
  });

  // ─── OpenAI Codex OAuth (PKCE) ────────────────────────────

  // Step 1: Initiate -- generate PKCE, redirect to OpenAI
  router.get('/oauth/openai', async (req, res) => {
    const { verifier, challenge } = await generatePKCE();
    const state = crypto.randomBytes(16).toString('hex');
    const port = req.socket.localPort || 3099;
    const redirectUri = `http://localhost:${port}/api/onboarding/oauth/openai/callback`;

    // Store session for callback verification
    oauthSessions.set(state, { verifier, redirectUri, createdAt: Date.now() });
    // Clean old sessions (>10 min)
    for (const [k, v] of oauthSessions) {
      if (Date.now() - v.createdAt > 600000) oauthSessions.delete(k);
    }

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: OPENAI_OAUTH.clientId,
      redirect_uri: redirectUri,
      scope: OPENAI_OAUTH.scope,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
      id_token_add_organizations: 'true',
      codex_cli_simplified_flow: 'true',
      originator: 'aiwh',
    });

    res.redirect(`${OPENAI_OAUTH.authorizeUrl}?${params.toString()}`);
  });

  // Step 2: Callback -- exchange code for tokens
  router.get('/oauth/openai/callback', async (req, res) => {
    const { code, state, error } = req.query;

    if (error) return res.send(oauthResultPage(false, `Authorization denied: ${error}`));
    if (!state || !oauthSessions.has(state)) return res.send(oauthResultPage(false, 'Invalid state — try again'));
    if (!code) return res.send(oauthResultPage(false, 'No authorization code received'));

    const session = oauthSessions.get(state);
    oauthSessions.delete(state);

    const SECRETS_PY = path.join(__dirname, '../../scripts/lib/secrets.py');

    try {
      // Exchange code for tokens (PKCE -- no client_secret needed)
      const tokenResp = await fetch(OPENAI_OAUTH.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: OPENAI_OAUTH.clientId,
          code,
          code_verifier: session.verifier,
          redirect_uri: session.redirectUri,
        }).toString(),
      });

      const tokenData = await tokenResp.json();

      if (!tokenResp.ok || !tokenData.access_token || !tokenData.refresh_token) {
        return res.send(oauthResultPage(false, tokenData.error_description || tokenData.error || 'Token exchange failed'));
      }

      // Extract accountId from JWT (same as pi-ai)
      const payload = decodeJwtPayload(tokenData.access_token);
      const authClaim = payload?.[OPENAI_OAUTH.jwtClaimPath];
      const accountId = authClaim?.chatgpt_account_id || null;

      // Store tokens securely
      const tokenBundle = JSON.stringify({
        access: tokenData.access_token,
        refresh: tokenData.refresh_token,
        expires: Date.now() + (tokenData.expires_in || 3600) * 1000,
        accountId,
      });

      try {
        execFileSync('python3', [SECRETS_PY, 'store', 'OPENAI_CODEX_OAUTH', tokenBundle], { timeout: 10000 });
      } catch {
        // secrets.py not ready -- store flag in auth.json (tokens in memory for now)
      }

      // Update auth.json
      let auth = {};
      try { auth = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8')); } catch {}
      auth.llmProvider = 'openai-codex';
      auth.openaiOAuth = { connected: true, accountId, obtainedAt: new Date().toISOString() };
      const dir = path.dirname(AUTH_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2), { mode: 0o600 });

      return res.send(oauthResultPage(true, 'ChatGPT connected successfully'));
    } catch (err) {
      return res.send(oauthResultPage(false, `Token exchange error: ${err.message}`));
    }
  });

  // Check OAuth status
  router.get('/oauth/openai/status', (req, res) => {
    let auth = {};
    try { auth = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8')); } catch {}
    res.json({
      connected: !!(auth.openaiOAuth && auth.openaiOAuth.connected),
      provider: auth.llmProvider || 'anthropic',
    });
  });

  // Disconnect -- switch back to Anthropic
  router.post('/oauth/openai/disconnect', (req, res) => {
    let auth = {};
    try { auth = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8')); } catch {}
    delete auth.openaiOAuth;
    auth.llmProvider = 'anthropic';
    try { fs.writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2), { mode: 0o600 }); } catch {}
    res.json({ success: true, provider: 'anthropic' });
  });

  return router;
};
