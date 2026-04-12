// ─── Central Server Client (Theme AC.2) ───────────────────────
// Shared helper for authenticated requests to the AIWH central server.
// Extracted from routes/team.js for reuse in routes/users.js (unified invite flow).

const fs = require('fs');
const path = require('path');

const CENTRAL_URL = process.env.AIWH_CENTRAL_URL || 'https://www.aiwealthhub.app';
const REG_PATH = path.join(process.env.CLIENT_DIR || '/opt/AIWH/client', 'config', 'device-registration.json');

function loadDeviceAuth() {
  try {
    const raw = fs.readFileSync(REG_PATH, 'utf8');
    const reg = JSON.parse(raw);
    if (!reg.client_id || !reg.device_secret) return null;
    return { clientId: reg.client_id, secret: reg.device_secret };
  } catch {
    return null;
  }
}

async function centralFetch(endpoint, opts = {}) {
  const auth = loadDeviceAuth();
  if (!auth) throw new Error('Device not registered. Register from the Access page first.');
  const url = `${CENTRAL_URL}/api/team${endpoint}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'X-Device-Client-Id': auth.clientId,
      'X-Device-Secret': auth.secret,
      ...(opts.headers || {}),
    },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Central server error (${res.status})`);
  return data;
}

module.exports = { loadDeviceAuth, centralFetch, CENTRAL_URL };
