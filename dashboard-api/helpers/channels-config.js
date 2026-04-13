// ─── channels-config.js ─────────────────────────────────────
// Sanitizer + validator + snapshot/restore for per-group channel config (Theme V.3).
// Used by routes/channels-groups.js and (for the widened allowlist) routes/channels.js.
const fs = require('fs');
const path = require('path');
const P = require('./paths');

// Defense-in-depth sanitizer for openclaw config paths built by this codebase.
// All user input is validated per-field first; this is a final safety net
// against programming errors in path construction. It MUST survive bracket
// notation for keys that contain dots or @ (WhatsApp JIDs, Slack IDs).
// Note: openclaw's `config set` treats `foo[bar.baz]` as the single key
// `bar.baz`; quoting (`foo["bar.baz"]`) causes the quotes to become part of
// the literal key name, so we never use quotes inside brackets.
const PATH_ALLOWED_RE = /^[A-Za-z0-9._\-:\[\]@=]+$/;

function sanitizeConfigPath(input) {
  if (typeof input !== 'string') throw new Error('path must be a string');
  if (input.length === 0 || input.length > 512) throw new Error('path length out of range');
  if (input.includes('\x00')) throw new Error('path contains null byte');
  if (input.includes('..')) throw new Error('path contains ..');
  if (!PATH_ALLOWED_RE.test(input)) throw new Error('path contains disallowed characters');
  return input;
}

const VALID_CHANNELS = new Set([
  'telegram', 'whatsapp', 'discord', 'irc', 'googlechat', 'slack', 'signal',
  'imessage', 'feishu', 'nostr', 'msteams', 'mattermost', 'matrix', 'bluebubbles',
  'line', 'tlon',
]);

const LIMITS = {
  GROUP_ID_MAX: 256,
  ALLOW_FROM_ENTRY_MAX: 256,
  ALLOW_FROM_MAX_ENTRIES: 200,
  PROMPT_OVERRIDE_MAX: 8192,
  NAME_MAX: 256,
  ACCOUNT_ID_MAX: 64,
};

// Group IDs can contain dots, @ (WhatsApp JID suffix @g.us), : (Slack),
// brackets (WhatsApp legacy), = (base64 padding), plus alphanumerics and dash/underscore.
const GROUP_ID_RE = /^[A-Za-z0-9._\-:\[\]@=]+$/;
const ACCOUNT_ID_RE = /^[a-zA-Z0-9_-]+$/;

function requireChannel(channel) {
  if (typeof channel !== 'string' || !VALID_CHANNELS.has(channel)) {
    throw new Error(`invalid channel: ${channel}`);
  }
}

function requireAccountId(accountId) {
  if (accountId === undefined || accountId === null || accountId === '') return 'default';
  if (typeof accountId !== 'string') throw new Error('accountId must be a string');
  if (accountId.length > LIMITS.ACCOUNT_ID_MAX) throw new Error('accountId too long');
  if (!ACCOUNT_ID_RE.test(accountId)) throw new Error('accountId has disallowed characters');
  return accountId;
}

function requireGroupId(groupId) {
  if (typeof groupId !== 'string' || groupId.length === 0) throw new Error('groupId required');
  if (groupId.length > LIMITS.GROUP_ID_MAX) throw new Error('groupId too long');
  if (!GROUP_ID_RE.test(groupId)) throw new Error('groupId has disallowed characters');
  return groupId;
}

// Upstream WhatsApp zod schema (`zod-schema.providers-whatsapp.ts`) only allows
// {requireMention, tools, toolsBySender} inside `channels.whatsapp.groups[<jid>]`.
// Access control is channel-level only (groupPolicy + groupAllowFrom as a *sender*
// allowlist, not a group-JID allowlist). Telegram is the opposite — per-group
// groupPolicy and allowFrom are the access surface there.
function validateAllowFromArray(value, field) {
  if (!Array.isArray(value)) throw new Error(`${field} must be array`);
  if (value.length > LIMITS.ALLOW_FROM_MAX_ENTRIES) throw new Error(`${field} too large`);
  return value.map((v) => {
    if (typeof v !== 'string' || v.length === 0 || v.length > LIMITS.ALLOW_FROM_ENTRY_MAX) {
      throw new Error(`${field} entry invalid`);
    }
    return v;
  });
}

function validateGroupPolicyValue(value) {
  if (!['open', 'allowlist', 'disabled'].includes(value)) {
    throw new Error('groupPolicy must be open, allowlist, or disabled');
  }
  return value;
}

function validateGroupConfig(channel, config) {
  if (!config || typeof config !== 'object') throw new Error('config object required');
  requireChannel(channel);
  const out = {};
  if (config.requireMention !== undefined) {
    if (typeof config.requireMention !== 'boolean') throw new Error('requireMention must be boolean');
    out.requireMention = config.requireMention;
  }
  if (channel === 'telegram') {
    if (config.groupPolicy !== undefined) {
      out.groupPolicy = validateGroupPolicyValue(config.groupPolicy);
    }
    if (config.allowFrom !== undefined) {
      out.allowFrom = validateAllowFromArray(config.allowFrom, 'allowFrom');
    }
    if (config.ingest !== undefined) {
      if (typeof config.ingest !== 'boolean') throw new Error('ingest must be boolean');
      out.ingest = config.ingest;
    }
    if (config.enabled !== undefined) {
      if (typeof config.enabled !== 'boolean') throw new Error('enabled must be boolean');
      out.enabled = config.enabled;
    }
  } else if (channel === 'whatsapp') {
    for (const k of Object.keys(config)) {
      if (k !== 'requireMention') {
        throw new Error(`per-group "${k}" is not supported on whatsapp; use channel-level groupPolicy/groupAllowFrom instead`);
      }
    }
  } else {
    throw new Error(`per-group config is not yet supported for channel "${channel}"`);
  }
  return out;
}

function validateChannelGroupDefaults(defaults) {
  if (!defaults || typeof defaults !== 'object') throw new Error('defaults object required');
  const out = {};
  if (defaults.groupPolicy !== undefined) {
    out.groupPolicy = validateGroupPolicyValue(defaults.groupPolicy);
  }
  if (defaults.groupAllowFrom !== undefined) {
    if (!Array.isArray(defaults.groupAllowFrom)) throw new Error('groupAllowFrom must be array');
    if (defaults.groupAllowFrom.length > LIMITS.ALLOW_FROM_MAX_ENTRIES) {
      throw new Error('groupAllowFrom too large');
    }
    out.groupAllowFrom = defaults.groupAllowFrom.map(v => {
      if (typeof v !== 'string' || v.length === 0 || v.length > LIMITS.ALLOW_FROM_ENTRY_MAX) {
        throw new Error('groupAllowFrom entry invalid');
      }
      return v;
    });
  }
  return out;
}

// Build an openclaw config path for a per-group leaf using bracket notation,
// so group IDs containing dots (WhatsApp JIDs like 120...@g.us) don't get
// split into multiple path segments. `leaf` is a constant string from our
// own code (name, requireMention, allowFrom, etc.), never user input.
function buildGroupKeyPath(channel, accountId, groupId, leaf) {
  requireChannel(channel);
  const acct = requireAccountId(accountId);
  const gid = requireGroupId(groupId);
  const base = acct === 'default'
    ? `channels.${channel}.groups`
    : `channels.${channel}.accounts.${acct}.groups`;
  const path = leaf ? `${base}[${gid}].${leaf}` : `${base}[${gid}]`;
  return sanitizeConfigPath(path);
}

function buildDefaultsKeyPath(channel, accountId, key) {
  requireChannel(channel);
  const acct = requireAccountId(accountId);
  if (!['groupPolicy', 'groupAllowFrom'].includes(key)) {
    throw new Error(`invalid defaults key: ${key}`);
  }
  const path = acct === 'default'
    ? `channels.${channel}.${key}`
    : `channels.${channel}.accounts.${acct}.${key}`;
  return sanitizeConfigPath(path);
}

// ─── Snapshot + restore ─────────────────────────────────────
// Copy openclaw.json to a timestamped backup before a batch write, so we can
// roll back atomically on failure. The janitor keeps the most recent 10.

const SNAP_PREFIX = 'openclaw.json.bak-';
const SNAP_KEEP = 10;

function snapshotOpenclawJson() {
  const cfgPath = P.OPENCLAW_CONFIG;
  const stateDir = path.dirname(cfgPath);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const snapPath = path.join(stateDir, `${SNAP_PREFIX}${ts}`);
  fs.copyFileSync(cfgPath, snapPath);
  pruneSnapshots(stateDir);
  return snapPath;
}

function restoreOpenclawJson(snapPath) {
  if (!snapPath || !fs.existsSync(snapPath)) throw new Error('snapshot missing');
  fs.copyFileSync(snapPath, P.OPENCLAW_CONFIG);
}

function pruneSnapshots(stateDir, keep = SNAP_KEEP) {
  try {
    const snaps = fs.readdirSync(stateDir)
      .filter(f => f.startsWith(SNAP_PREFIX))
      .map(f => {
        const full = path.join(stateDir, f);
        let mtime = 0;
        try { mtime = fs.statSync(full).mtimeMs; } catch { /* ignore */ }
        return { name: f, full, mtime };
      })
      .sort((a, b) => b.mtime - a.mtime);
    for (const s of snaps.slice(keep)) {
      try { fs.unlinkSync(s.full); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

module.exports = {
  sanitizeConfigPath,
  validateGroupConfig,
  validateChannelGroupDefaults,
  buildGroupKeyPath,
  buildDefaultsKeyPath,
  snapshotOpenclawJson,
  restoreOpenclawJson,
  pruneSnapshots,
  requireChannel,
  requireAccountId,
  requireGroupId,
  VALID_CHANNELS,
  LIMITS,
};
