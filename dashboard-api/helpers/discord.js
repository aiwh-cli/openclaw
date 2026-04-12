// ─── Discord Webhook Helper ──────────────────────────────────
const { getSecret } = require('./secret-loader');

function sendDiscordAlert(message) {
  const DISCORD_WEBHOOK_SYSTEMS = getSecret('DISCORD_WEBHOOK_SYSTEMS_BAY');
  if (!DISCORD_WEBHOOK_SYSTEMS) return;
  const https = require('https');
  const url = new URL(DISCORD_WEBHOOK_SYSTEMS);
  const payload = JSON.stringify({ content: message });
  const req = https.request({
    hostname: url.hostname, path: url.pathname, method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
  }, () => {});
  req.on('error', () => {});
  req.end(payload);
}

module.exports = { sendDiscordAlert };
