// ─── Channel Management Routes ─────────────────────────────────
// Wraps `openclaw channels` CLI + gateway WS for dashboard channel management
const { execFileSync } = require('child_process');
const { client: gateway } = require('../gateway-ws');
const { sanitizeConfigPath } = require('../helpers/channels-config');

const OPENCLAW_BIN = '/opt/homebrew/bin/openclaw';
const OC_ENV = { ...process.env, OPENCLAW_STATE_DIR: '/opt/AIWH/.openclaw', PATH: `/opt/homebrew/bin:/opt/homebrew/sbin:${process.env.PATH || '/usr/bin:/bin'}` };

// Safe CLI wrapper — takes argument ARRAY, never shell string
function oc(argsArray, timeout = 15000) {
  const out = execFileSync(OPENCLAW_BIN, argsArray, { timeout, env: OC_ENV, encoding: 'utf8' }).trim();
  try { return JSON.parse(out); } catch { return out; }
}

const VALID_CHANNELS = ['telegram', 'whatsapp', 'discord', 'irc', 'googlechat', 'slack', 'signal', 'imessage', 'feishu', 'nostr', 'msteams', 'mattermost', 'matrix', 'bluebubbles', 'line', 'tlon'];

// Cache channel status for 30s
let _statusCache = { data: null, ts: 0 };
let _bindingsCache = { data: null, ts: 0 };

function invalidateCaches() {
  _statusCache = { data: null, ts: 0 };
  _bindingsCache = { data: null, ts: 0 };
}

// Transform raw OpenClaw channels.status into Lit component format
function _transformHealth(raw) {
  const channels = [];
  const order = raw?.channelOrder || Object.keys(raw?.channelAccounts || {});
  const labels = raw?.channelLabels || {};
  const accounts = raw?.channelAccounts || {};
  const meta = raw?.channelMeta || [];
  for (const ch of order) {
    const accts = accounts[ch];
    if (!accts || !accts.length) continue;
    const m = meta.find(x => x.id === ch);
    channels.push({
      id: ch,
      label: labels[ch] || m?.label || ch.charAt(0).toUpperCase() + ch.slice(1),
      accounts: accts.map(a => ({
        accountId: a.accountId,
        name: a.name,
        configured: a.configured,
        linked: a.linked,
        running: a.running,
        connected: a.connected,
        reconnectAttempts: a.reconnectAttempts,
        lastConnectedAt: a.lastConnectedAt,
        lastStartAt: a.lastStartAt,
        lastStopAt: a.lastStopAt,
        lastError: a.lastError,
        lastInboundAt: a.lastInboundAt,
        lastOutboundAt: a.lastOutboundAt,
        bot: a.bot,
        application: a.application,
        mode: a.mode,
        dmPolicy: a.dmPolicy,
        tokenSource: a.tokenSource,
      })),
    });
  }
  return { channels, ts: raw?.ts || Date.now() };
}

module.exports = (app, deps) => {
  const { dashLog } = deps;

  // ─── List configured channels + auth providers ──────────
  app.get('/api/channels/list', (req, res) => {
    try { res.json(oc(['channels', 'list', '--json'])); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── Channel runtime status ─────────────────────────────
  app.get('/api/channels/status', (req, res) => {
    try {
      const force = req.query.force === '1';
      if (!force && Date.now() - _statusCache.ts < 30000 && _statusCache.data) {
        return res.json(_statusCache.data);
      }
      const data = oc(['channels', 'status', '--json']);
      _statusCache = { data, ts: Date.now() };
      res.json(data);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── Agent-channel bindings ─────────────────────────────
  app.get('/api/channels/bindings', (req, res) => {
    try {
      const force = req.query.force === '1';
      if (!force && Date.now() - _bindingsCache.ts < 30000 && _bindingsCache.data) {
        return res.json(_bindingsCache.data);
      }
      const data = oc(['agents', 'bindings', '--json']);
      _bindingsCache = { data, ts: Date.now() };
      res.json(data);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── Channel health (for Lit component) ────────────────
  app.get('/api/channels/health', (req, res) => {
    try {
      const force = req.query.force === '1';
      if (!force && Date.now() - _statusCache.ts < 30000 && _statusCache.data) {
        return res.json(_transformHealth(_statusCache.data));
      }
      const data = oc(['channels', 'status', '--json']);
      _statusCache = { data, ts: Date.now() };
      res.json(_transformHealth(data));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── Channel logs ───────────────────────────────────────
  app.get('/api/channels/logs', (req, res) => {
    try {
      const channel = req.query.channel || 'all';
      const lines = Math.min(parseInt(req.query.lines) || 100, 500);
      if (!['all', ...VALID_CHANNELS].includes(channel)) {
        return res.status(400).json({ error: 'Invalid channel name' });
      }
      const data = oc(['channels', 'logs', '--channel', channel, '--lines', String(lines), '--json']);
      res.json(typeof data === 'string' ? { lines: data.split('\n') } : data);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── Add/update channel account ─────────────────────────
  // Writes directly to openclaw.json via `config set` — avoids CLI plugin
  // discovery issues where unloaded channels return "Unknown channel".
  app.post('/api/channels/add', (req, res) => {
    try {
      const { channel, account, token, options } = req.body;
      if (!channel || !VALID_CHANNELS.includes(channel)) {
        return res.status(400).json({ error: 'Invalid or missing channel' });
      }
      const acct = account ? String(account).replace(/[^a-z0-9_-]/gi, '') : 'default';

      // Token field name varies by channel
      const TOKEN_FIELDS = {
        discord: 'token', telegram: 'botToken', slack: 'botToken',
        signal: 'account', nostr: 'nsec', googlechat: 'credentialPath',
        irc: 'nick', msteams: 'token', matrix: 'accessToken',
      };
      const tokenField = TOKEN_FIELDS[channel] || 'token';

      // Step 1: Enable the plugin
      oc(['config', 'set', `plugins.entries.${channel}.enabled`, 'true', '--json'], 10000);

      // Step 2: Enable the channel
      oc(['config', 'set', `channels.${channel}.enabled`, 'true', '--json'], 10000);

      // Step 2b (Theme V.4): Default to allowlist for channels that carry
      // group traffic, unless the caller explicitly set one. Safe default:
      // Branson responds in NO groups until the admin allowlists them.
      if (['whatsapp', 'discord', 'telegram', 'slack'].includes(channel)) {
        const cfg = deps.adapter.readConfig();
        const existingPolicy = cfg?.channels?.[channel]?.groupPolicy;
        if (!existingPolicy) {
          oc(['config', 'set', `channels.${channel}.groupPolicy`, '"allowlist"', '--json'], 10000);
        }
      }

      // Step 3: Set the token/credential if provided
      if (token) {
        const tokenPath = acct === 'default'
          ? `channels.${channel}.${tokenField}`
          : `channels.${channel}.accounts.${acct}.${tokenField}`;
        // Value must be JSON-quoted string for config set
        oc(['config', 'set', tokenPath, JSON.stringify(token), '--json'], 10000);
      }

      // Step 4: Set any extra options
      if (options && typeof options === 'object') {
        // Map kebab-case keys from setup wizard to openclaw.json camelCase fields
        const KEY_MAP = {
          'bot-token': 'botToken', 'app-token': 'appToken', 'signing-secret': 'signingSecret',
          'botToken': 'botToken', 'appToken': 'appToken', 'signingSecret': 'signingSecret',
          'webhook': 'webhookUrl', 'server': 'server', 'port': 'port', 'host': 'host',
          'prefix': 'prefix', 'mode': 'mode',
        };
        for (const [key, val] of Object.entries(options)) {
          const configKey = KEY_MAP[key];
          if (!configKey || !val) continue;
          oc(['config', 'set', `channels.${channel}.${configKey}`, JSON.stringify(val), '--json'], 10000);
        }
      }

      // Step 5: Restart gateway to load the new channel plugin
      try { oc(['gateway', 'restart'], 15000); } catch { /* best effort */ }

      invalidateCaches();
      dashLog('channels', `Added channel: ${channel}/${acct}`);
      res.json({ ok: true, result: `${channel} configured and gateway restarting` });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── Remove channel account ─────────────────────────────
  // Support both DELETE and POST (some browsers/proxies strip body from DELETE)
  app.delete('/api/channels/remove', handleRemoveChannel);
  app.post('/api/channels/remove', handleRemoveChannel);
  function handleRemoveChannel(req, res) {
    try {
      const { channel, account } = req.body;
      if (!channel) return res.status(400).json({ error: 'channel is required' });
      const args = ['channels', 'remove', '--channel', channel, '--delete'];
      if (account) args.push('--account', String(account).replace(/[^a-z0-9_-]/gi, ''));
      const result = oc(args, 15000);
      // Also disable the plugin if no accounts remain
      try { oc(['config', 'set', `plugins.entries.${channel}.enabled`, 'false', '--json'], 10000); } catch { /* ignore */ }
      try { oc(['gateway', 'restart'], 15000); } catch { /* best effort */ }
      invalidateCaches();
      dashLog('channels', `Removed channel: ${channel}/${account || 'default'}`);
      res.json({ ok: true, result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  }

  // ─── Bind agent to channel ──────────────────────────────
  app.post('/api/channels/bind', (req, res) => {
    try {
      const { agentId, channel, accountId } = req.body;
      if (!agentId || !channel) return res.status(400).json({ error: 'agentId and channel required' });
      const bind = accountId ? `${channel}:${accountId}` : channel;
      const safeAgent = String(agentId).replace(/[^a-z0-9_-]/gi, '');
      const result = oc(['agents', 'bind', '--agent', safeAgent, '--bind', bind]);
      invalidateCaches();
      dashLog('channels', `Bound ${safeAgent} to ${bind}`);
      res.json({ ok: true, result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── Unbind agent from channel ─────────────────────────
  app.post('/api/channels/unbind', (req, res) => {
    try {
      const { agentId, channel, accountId } = req.body;
      if (!agentId || !channel) return res.status(400).json({ error: 'agentId and channel required' });
      const bind = accountId ? `${channel}:${accountId}` : channel;
      const safeAgent = String(agentId).replace(/[^a-z0-9_-]/gi, '');
      const result = oc(['agents', 'unbind', '--agent', safeAgent, '--bind', bind]);
      invalidateCaches();
      dashLog('channels', `Unbound ${safeAgent} from ${bind}`);
      res.json({ ok: true, result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── Set openclaw config value ──────────────────────────
  app.post('/api/channels/config-set', (req, res) => {
    try {
      const { path, value } = req.body;
      if (!path) return res.status(400).json({ error: 'path is required' });
      if (!path.startsWith('channels.') && !path.startsWith('agents.bindings')) {
        return res.status(400).json({ error: 'Only channels.* paths allowed' });
      }
      // Widened allowlist (Theme V.3): survives bracket notation for keys that
      // contain dots or @ (WhatsApp JIDs, Slack IDs). Still rejects .., null
      // bytes, whitespace, and shell metacharacters.
      const safePath = sanitizeConfigPath(String(path));
      const jsonVal = JSON.stringify(value);
      const result = oc(['config', 'set', safePath, jsonVal, '--json'], 10000);
      invalidateCaches();
      res.json({ ok: true, result });
    } catch (e) {
      const status = /disallowed|null byte|\.\.|length/.test(e.message) ? 400 : 500;
      res.status(status).json({ error: e.message });
    }
  });

  // ─── Patch channel config (multiple fields) ────────────
  app.post('/api/channels/config/patch', (req, res) => {
    try {
      const { channel, patch } = req.body;
      if (!channel || !VALID_CHANNELS.includes(channel)) return res.status(400).json({ error: 'Invalid channel' });
      if (!patch || typeof patch !== 'object') return res.status(400).json({ error: 'patch object required' });
      const ALLOWED = ['enabled', 'groupPolicy', 'dmPolicy', 'streaming', 'name'];
      for (const [key, value] of Object.entries(patch)) {
        if (!ALLOWED.includes(key)) continue;
        const safePath = `channels.${channel}.${key}`;
        oc(['config', 'set', safePath, JSON.stringify(value), '--json'], 10000);
      }
      invalidateCaches();
      dashLog('channels', `Patched config for ${channel}: ${Object.keys(patch).join(', ')}`);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── Get raw channels config ────────────────────────────
  app.get('/api/channels/config', (req, res) => {
    try {
      const config = deps.adapter.readConfig();
      res.json({ channels: config?.channels || {}, bindings: config?.agents?.bindings || {} });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── WhatsApp QR login (via gateway WS) ─────────────────
  app.post('/api/channels/whatsapp/login-start', async (req, res) => {
    try {
      await gateway.ensureConnected();
      const result = await gateway.request('web.login.start', {
        force: !!req.body.force,
        timeoutMs: 30000,
      }, 35000);
      res.json(result || {});
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/channels/whatsapp/login-wait', async (req, res) => {
    try {
      await gateway.ensureConnected();
      const result = await gateway.request('web.login.wait', {
        timeoutMs: req.body.timeoutMs || 120000,
      }, 130000);
      invalidateCaches();
      res.json(result || {});
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── WhatsApp logout (via gateway WS) ───────────────────
  app.post('/api/channels/whatsapp/logout', async (req, res) => {
    try {
      await gateway.ensureConnected();
      const result = await gateway.request('channels.logout', { channel: 'whatsapp' }, 15000);
      invalidateCaches();
      res.json({ ok: true, result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── Channel types metadata ─────────────────────────────
  app.get('/api/channels/types', (req, res) => {
    res.json({ types: [
      { id: 'discord',   name: 'Discord',   auth: 'token' },
      { id: 'telegram',  name: 'Telegram',  auth: 'token' },
      { id: 'slack',     name: 'Slack',     auth: 'tokens' },
      { id: 'whatsapp',  name: 'WhatsApp',  auth: 'qr' },
      { id: 'signal',    name: 'Signal',    auth: 'cli' },
      { id: 'matrix',    name: 'Matrix',    auth: 'login' },
      { id: 'msteams',   name: 'MS Teams',  auth: 'token' },
      { id: 'imessage',  name: 'iMessage',  auth: 'local' },
    ]});
  });
};
