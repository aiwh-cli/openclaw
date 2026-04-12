// ─── License Validation + Status ────────────────────────────
// Theme AB.2.8 — License expiry check, heartbeat status, grace period

const fs = require('fs');
const path = require('path');
const { LICENSE_CONFIG, CLIENT_CONFIG_DIR, getConfigWithFallback } = require('../helpers/paths');

const DEVICE_REG_PATH = path.join(CLIENT_CONFIG_DIR, 'device-registration.json');
const GRACE_DAYS = 30;

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function getLicenseStatus() {
  const license = getConfigWithFallback(LICENSE_CONFIG, 'license');
  if (!license || !license.client_id) return { status: 'unknown', error: 'license.json not found' };

  const now = new Date();
  const validUntil = new Date(license.valid_until);
  const daysRemaining = Math.ceil((validUntil - now) / (1000 * 60 * 60 * 24));

  let status = 'active';
  if (daysRemaining <= 0) status = 'expired';
  else if (daysRemaining <= 30) status = 'expiring';

  // Check heartbeat grace period
  const deviceReg = readJson(DEVICE_REG_PATH) || {};
  const consecutiveFailures = deviceReg.consecutive_failures || 0;
  const degradedMode = consecutiveFailures >= GRACE_DAYS;
  if (degradedMode && status === 'active') status = 'grace';

  return {
    client_id: license.client_id,
    client_name: license.client_name,
    status,
    subscription_active: license.subscription_active,
    command_centres_active: license.command_centres_active || [],
    valid_until: license.valid_until,
    days_remaining: daysRemaining,
    last_heartbeat: deviceReg.last_heartbeat || null,
    consecutive_failures: consecutiveFailures,
    degraded_mode: degradedMode,
  };
}

function register(app) {
  app.get('/api/license/status', (_req, res) => {
    res.json(getLicenseStatus());
  });
}

module.exports = { register, getLicenseStatus };
