// ─── Channel Groups Routes (Theme V.3) ──────────────────────
// Per-group allowlist/config persistence. RBAC gated via global
// `/api/channels` → `requireAction('manage_channels')` in server.js.
//
// Endpoints:
//   GET    /api/channels/groups/config?channel=X&accountId=Y
//   POST   /api/channels/groups/config   body: {channel, accountId?, groupId?, config?, defaults?}
//   DELETE /api/channels/groups/config   body: {channel, accountId?, groupId}
//
// V.1 will add GET /api/channels/groups/list (gateway RPC proxy) in this same file.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const {
  validateGroupConfig,
  validateChannelGroupDefaults,
  buildGroupKeyPath,
  buildDefaultsKeyPath,
  snapshotOpenclawJson,
  restoreOpenclawJson,
  requireChannel,
  requireAccountId,
  requireGroupId,
  VALID_CHANNELS,
} = require('../helpers/channels-config');
const {
  getDisplayNamesForScope,
  setDisplayName,
  deleteDisplayName,
  validateDisplayName,
} = require('../helpers/group-display-names');

// V.1.5: discovered-groups.json is written by the WhatsApp + Telegram
// inbound monitors whenever a group message arrives, BEFORE the allowlist
// gate drops it. Lets the dashboard surface unconfigured groups without
// depending on `openclaw directory groups list` (which for WA/TG only reads
// pre-configured entries from openclaw.json).
const DISCOVERED_GROUPS_FILE = path.join(
  process.env.OPENCLAW_STATE_DIR || '/opt/AIWH/.openclaw',
  'discovered-groups.json',
);

function readDiscoveredGroups(channel, accountId) {
  try {
    const data = JSON.parse(fs.readFileSync(DISCOVERED_GROUPS_FILE, 'utf8'));
    const out = [];
    for (const key of Object.keys(data)) {
      const entry = data[key];
      if (!entry || entry.channel !== channel) continue;
      if ((entry.accountId || 'default') !== accountId) continue;
      out.push(entry);
    }
    return out;
  } catch { return []; }
}

const OPENCLAW_BIN = '/opt/homebrew/bin/openclaw';
const OC_ENV = {
  ...process.env,
  OPENCLAW_STATE_DIR: '/opt/AIWH/.openclaw',
  PATH: `/opt/homebrew/bin:/opt/homebrew/sbin:${process.env.PATH || '/usr/bin:/bin'}`,
};

function oc(argsArray, timeout = 10000) {
  const out = execFileSync(OPENCLAW_BIN, argsArray, { timeout, env: OC_ENV, encoding: 'utf8' }).trim();
  try { return JSON.parse(out); } catch { return out; }
}

function ocSafe(argsArray, timeout = 10000) {
  try { return { ok: true, out: oc(argsArray, timeout) }; }
  catch (e) { return { ok: false, err: e }; }
}

// ─── Gateway restart debounce ───────────────────────────────
// Multiple sequential writes in a batch produce exactly one restart.
let _restartTimer = null;
function scheduleGatewayRestart() {
  if (_restartTimer) return;
  _restartTimer = setTimeout(() => {
    _restartTimer = null;
    ocSafe(['gateway', 'restart'], 20000);
  }, 500);
}

// ─── Simple token-bucket rate limit per actor ───────────────
// 30 writes / 60s. Prevents a malicious admin from restarting the gateway in a loop.
const _buckets = new Map();
const BUCKET_CAPACITY = 30;
const BUCKET_REFILL_MS = 2000; // 1 token every 2s ≈ 30/min

function actorKey(req) {
  return req.user?.userId || req.user?.email || req.ip || 'anon';
}

function checkWriteRate(req) {
  const key = actorKey(req);
  const now = Date.now();
  const b = _buckets.get(key) || { tokens: BUCKET_CAPACITY, last: now };
  const refill = Math.floor((now - b.last) / BUCKET_REFILL_MS);
  if (refill > 0) {
    b.tokens = Math.min(BUCKET_CAPACITY, b.tokens + refill);
    b.last = now;
  }
  if (b.tokens <= 0) {
    _buckets.set(key, b);
    return false;
  }
  b.tokens -= 1;
  _buckets.set(key, b);
  return true;
}

function setOne(path, value) {
  // Value must be JSON for `config set` to parse consistently
  oc(['config', 'set', path, JSON.stringify(value), '--json'], 10000);
}

function unsetOne(path) {
  // Idempotent: "not found" is a success
  const result = ocSafe(['config', 'unset', path], 10000);
  if (!result.ok && !/not found/i.test(String(result.err?.message || ''))) {
    throw result.err;
  }
}

// Normalize raw CLI group entries into dashboard shape, merging per-group
// config state so the UI knows which groups already have a per-group override.
// Access control is NOT represented here — it lives in channel-level groupPolicy
// (all channels) and per-group groupPolicy (telegram only). The UI reads those
// separately from /config.
function normalizeGroupList(raw, cfgGroups) {
  if (!Array.isArray(raw)) return [];
  const configured = (cfgGroups && typeof cfgGroups === 'object') ? cfgGroups : {};
  return raw.map((entry) => {
    const rawId = typeof entry?.id === 'string' ? entry.id : '';
    const id = rawId.startsWith('channel:') ? rawId.slice(8) : rawId;
    const configEntry = configured[id] || configured[rawId] || null;
    return {
      id,
      name: entry?.name || id,
      kind: entry?.kind || 'group',
      memberCount: typeof entry?.memberCount === 'number' ? entry.memberCount : null,
      configured: !!configEntry,
    };
  });
}

module.exports = (app, deps) => {
  const { dashLog } = deps;

  // ─── GET group list (discovery) ───────────────────────────
  // Shells out to `openclaw directory groups list --channel X --account Y --json`
  // which already abstracts live adapters (Slack/Discord) + config fallback
  // (WhatsApp/Telegram). Merges the response with per-group config so the
  // dashboard can render "configured / allowlisted" badges on each row.
  app.get('/api/channels/groups/list', (req, res) => {
    try {
      const channel = req.query.channel;
      requireChannel(channel);
      const accountId = requireAccountId(req.query.accountId);
      const rawLimit = parseInt(req.query.limit, 10);
      const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 500) : 100;
      const query = typeof req.query.query === 'string' ? req.query.query.slice(0, 128) : '';

      const args = [
        'directory', 'groups', 'list',
        '--channel', channel,
        '--json',
        '--limit', String(limit),
      ];
      if (accountId !== 'default') args.push('--account', accountId);
      if (query) args.push('--query', query);

      const result = ocSafe(args, 20000);
      if (!result.ok) {
        const msg = String(result.err?.message || 'directory lookup failed');
        // Missing credentials / offline adapter → empty list, not 500
        if (/not configured|missing|no account|auth|unauthori[sz]ed/i.test(msg)) {
          return res.json({ groups: [], warning: msg, source: 'directory-cli' });
        }
        throw result.err;
      }

      const cfg = deps.adapter.readConfig();
      const root = cfg?.channels?.[channel];
      const scope = accountId === 'default'
        ? root
        : (root?.accounts?.[accountId] || {});
      const configured = scope?.groups || {};

      const groups = normalizeGroupList(result.out, configured);
      const displayNames = getDisplayNamesForScope(channel, accountId);
      for (const g of groups) {
        if (displayNames[g.id]) g.displayName = displayNames[g.id];
      }

      // V.1.5: merge in discovered groups (auto-learned from inbound monitors)
      // that the CLI does not know about yet. Dedupe by id.
      const seen = new Set(groups.map((g) => g.id));
      for (const d of readDiscoveredGroups(channel, accountId)) {
        if (seen.has(d.groupId)) continue;
        const configEntry = configured[d.groupId] || null;
        groups.push({
          id: d.groupId,
          name: d.groupName || d.groupId,
          displayName: displayNames[d.groupId] || undefined,
          kind: 'group',
          memberCount: null,
          configured: !!configEntry,
          discovered: true,
          firstSeen: d.firstSeen,
          lastSeen: d.lastSeen,
        });
      }

      res.json({ groups, source: 'directory-cli+discovered' });
    } catch (e) {
      const status = /invalid|required/.test(e.message) ? 400 : 500;
      res.status(status).json({ error: e.message });
    }
  });

  // ─── GET group config ─────────────────────────────────────
  // Merges channel-level defaults + per-group map from openclaw.json.
  // No gateway round-trip — reads the on-disk config directly.
  app.get('/api/channels/groups/config', (req, res) => {
    try {
      const channel = req.query.channel;
      requireChannel(channel);
      const accountId = requireAccountId(req.query.accountId);

      const cfg = deps.adapter.readConfig();
      const channelRoot = cfg?.channels?.[channel];
      if (!channelRoot) {
        return res.json({ groupPolicy: 'open', groupAllowFrom: [], groups: {} });
      }
      const scope = accountId === 'default'
        ? channelRoot
        : (channelRoot.accounts?.[accountId] || {});

      res.json({
        groupPolicy: scope.groupPolicy || 'open',
        groupAllowFrom: Array.isArray(scope.groupAllowFrom) ? scope.groupAllowFrom : [],
        groups: (scope.groups && typeof scope.groups === 'object') ? scope.groups : {},
        displayNames: getDisplayNamesForScope(channel, accountId),
      });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // ─── POST group config ────────────────────────────────────
  // Body: {channel, accountId?, groupId?, config?, defaults?}
  //   - defaults.{groupPolicy, groupAllowFrom} → channel-level
  //   - groupId + config → per-group leaves
  // Transactional: snapshot openclaw.json, apply all writes, restore on failure.
  app.post('/api/channels/groups/config', (req, res) => {
    if (!checkWriteRate(req)) {
      return res.status(429).json({ error: 'rate limit exceeded (30 writes/min)' });
    }
    let snap = null;
    try {
      const { channel, accountId, groupId, config, defaults } = req.body || {};
      requireChannel(channel);
      const acct = requireAccountId(accountId);

      if (!defaults && !groupId) {
        return res.status(400).json({ error: 'defaults or groupId required' });
      }

      let touchedOpenclawJson = false;

      if (defaults && typeof defaults === 'object') {
        const validated = validateChannelGroupDefaults(defaults);
        if (Object.keys(validated).length > 0) {
          if (!snap) snap = snapshotOpenclawJson();
          touchedOpenclawJson = true;
          for (const [k, v] of Object.entries(validated)) {
            setOne(buildDefaultsKeyPath(channel, acct, k), v);
          }
        }
      }

      if (groupId) {
        requireGroupId(groupId);
        // displayName is a dashboard-only cosmetic label — never sent to
        // openclaw.json because the WhatsApp zod schema is strict.
        const rawConfig = config && typeof config === 'object' ? { ...config } : {};
        const displayNameProvided = Object.prototype.hasOwnProperty.call(rawConfig, 'displayName');
        const displayNameRaw = rawConfig.displayName;
        delete rawConfig.displayName;

        const validated = validateGroupConfig(channel, rawConfig);
        const hasGatewayWrites = Object.keys(validated).length > 0;
        if (!hasGatewayWrites && !displayNameProvided) {
          return res.status(400).json({ error: 'config object cannot be empty' });
        }
        if (hasGatewayWrites) {
          if (!snap) snap = snapshotOpenclawJson();
          touchedOpenclawJson = true;
          for (const [k, v] of Object.entries(validated)) {
            setOne(buildGroupKeyPath(channel, acct, groupId, k), v);
          }
        }
        if (displayNameProvided) {
          setDisplayName(channel, acct, groupId, displayNameRaw == null ? '' : displayNameRaw);
        }
      }

      if (touchedOpenclawJson) scheduleGatewayRestart();
      dashLog(
        'channels',
        `group config write ${channel}${acct !== 'default' ? '/' + acct : ''} ${groupId || '(defaults)'}`
      );
      res.json({ ok: true });
    } catch (e) {
      if (snap) {
        try {
          restoreOpenclawJson(snap);
          dashLog('channels', `group config rollback: ${e.message}`);
        } catch (rollbackErr) {
          dashLog('channels', `group config rollback FAILED: ${rollbackErr.message}`);
        }
      }
      const status = /invalid|required|too long|disallowed|must be/.test(e.message) ? 400 : 500;
      res.status(status).json({ error: e.message });
    }
  });

  // ─── DELETE group config ──────────────────────────────────
  // Removes a single group's config node. Idempotent.
  app.delete('/api/channels/groups/config', (req, res) => {
    if (!checkWriteRate(req)) {
      return res.status(429).json({ error: 'rate limit exceeded (30 writes/min)' });
    }
    let snap = null;
    try {
      const { channel, accountId, groupId } = req.body || {};
      requireChannel(channel);
      const acct = requireAccountId(accountId);
      requireGroupId(groupId);

      snap = snapshotOpenclawJson();
      unsetOne(buildGroupKeyPath(channel, acct, groupId, null));
      deleteDisplayName(channel, acct, groupId);
      scheduleGatewayRestart();
      dashLog(
        'channels',
        `group deleted ${channel}${acct !== 'default' ? '/' + acct : ''} ${groupId}`
      );
      res.json({ ok: true });
    } catch (e) {
      if (snap) {
        try { restoreOpenclawJson(snap); } catch { /* ignore */ }
      }
      const status = /invalid|required|too long|disallowed/.test(e.message) ? 400 : 500;
      res.status(status).json({ error: e.message });
    }
  });
};
