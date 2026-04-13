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

function _read() {
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch {
    return {};
  }
}

function _write(data) {
  const tmp = `${FILE}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, FILE);
}

function _key(channel, accountId, groupId) {
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
