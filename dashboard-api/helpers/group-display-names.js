// ─── group-display-names.js ─────────────────────────────────
// Dashboard-only cosmetic display-name overrides for channel groups.
// NOT stored in openclaw.json — the upstream WhatsApp schema is strict and
// rejects unknown keys, and this data has zero meaning to the gateway.
// Users rename groups here purely so the dashboard UI shows something
// friendlier than "120363405911768679@g.us".

const fs = require('fs');
const path = require('path');

const STATE_DIR = process.env.OPENCLAW_STATE_DIR || '/opt/AIWH/.openclaw';
const FILE = path.join(STATE_DIR, 'dashboard-group-display-names.json');

const NAME_MAX = 120;

// Defense-in-depth: route handlers already call requireChannel/
// requireAccountId/requireGroupId before we see these segments, but
// we enforce again here so any future caller that forgets can't
// smuggle a `::` separator into a key and collide scopes.
const SEG_RE = /^[A-Za-z0-9._\-:\[\]@=]+$/;
function _validateSegment(kind, value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) {
    throw new Error(`${kind} must be non-empty string ≤256 chars`);
  }
  if (value.includes('::')) throw new Error(`${kind} contains reserved separator ::`);
  if (!SEG_RE.test(value)) throw new Error(`${kind} contains disallowed characters`);
  return value;
}

function _read() {
  let raw;
  try {
    raw = fs.readFileSync(FILE, 'utf8');
  } catch {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  } catch (e) {
    // Parse failure = someone hand-edited or the file is corrupted.
    // Return empty so the dashboard keeps functioning, but surface a
    // visible error so operators notice instead of silently wiping.
    try {
      process.stderr.write(
        `[group-display-names] ${new Date().toISOString()} parse failed: ${e.message} — returning empty\n`
      );
    } catch { /* ignore */ }
    return {};
  }
}

function _write(data) {
  const tmp = `${FILE}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, FILE);
}

function _key(channel, accountId, groupId) {
  _validateSegment('channel', channel);
  _validateSegment('accountId', accountId || 'default');
  _validateSegment('groupId', groupId);
  return `${channel}::${accountId || 'default'}::${groupId}`;
}

function validateDisplayName(value) {
  if (typeof value !== 'string') throw new Error('displayName must be a string');
  const trimmed = value.trim();
  if (trimmed.length === 0) return '';
  if (trimmed.length > NAME_MAX) throw new Error('displayName too long');
  if (trimmed.includes('\x00')) throw new Error('displayName contains null byte');
  return trimmed;
}

function getDisplayNamesForScope(channel, accountId) {
  _validateSegment('channel', channel);
  _validateSegment('accountId', accountId || 'default');
  const data = _read();
  const prefix = `${channel}::${accountId || 'default'}::`;
  const out = {};
  for (const k of Object.keys(data)) {
    if (k.startsWith(prefix)) {
      out[k.slice(prefix.length)] = data[k];
    }
  }
  return out;
}

function setDisplayName(channel, accountId, groupId, value) {
  const name = validateDisplayName(value);
  const data = _read();
  const key = _key(channel, accountId, groupId);
  if (name === '') {
    delete data[key];
  } else {
    data[key] = name;
  }
  _write(data);
  return name;
}

function deleteDisplayName(channel, accountId, groupId) {
  const data = _read();
  const key = _key(channel, accountId, groupId);
  if (data[key] !== undefined) {
    delete data[key];
    _write(data);
  }
}

module.exports = {
  validateDisplayName,
  getDisplayNamesForScope,
  setDisplayName,
  deleteDisplayName,
  NAME_MAX,
};
