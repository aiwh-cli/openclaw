// ─── Team Management Routes ───────────────────────────────────
// Proxies team invite/revoke requests to the AIWH central server (Vercel).
// Local cache in team_invites table for instant UI rendering.
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const { loadDeviceAuth, centralFetch } = require('../helpers/central-server');

const teamReadLimiter = rateLimit({ windowMs: 60_000, max: 20, message: { error: 'Too many requests. Try again in a minute.' } });
const teamWriteLimiter = rateLimit({ windowMs: 60_000, max: 5, message: { error: 'Too many requests. Try again in a minute.' } });
const registerLimiter = rateLimit({ windowMs: 60_000, max: 1, message: { error: 'Registration rate limited. Try again in a minute.' } });

// CSRF defense: reject POST/DELETE without JSON Content-Type (browsers can't send JSON from forms)
function requireJson(req, res, next) {
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    const ct = req.headers['content-type'] || '';
    if (!ct.includes('application/json')) {
      return res.status(415).json({ error: 'Content-Type must be application/json' });
    }
  }
  next();
}

const REG_PATH = require('path').join(process.env.CLIENT_DIR || '/opt/AIWH/client', 'config', 'device-registration.json');

module.exports = (app, deps) => {
  const { db, dashLog } = deps;

  // Apply JSON Content-Type requirement to all state-changing team routes
  app.use('/api/team', requireJson);

  // ── List team members ─────────────────────────────────────
  app.get('/api/team/members', teamReadLimiter, async (req, res) => {
    try {
      // Try central server first for live data
      const data = await centralFetch('/members');
      // Sync to local cache
      if (data.members) {
        for (const m of data.members) {
          db.prepare(`
            INSERT INTO team_invites (email, status, tailscale_invite_id, invited_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(email) DO UPDATE SET status=?, tailscale_invite_id=?
          `).run(m.email, m.status, m.id, m.createdAt, m.status, m.id);
        }
      }
      res.json(data);
    } catch (err) {
      // Fallback to local cache if central unreachable
      dashLog('team', `Central fetch failed, using cache: ${err.message}`);
      const rows = db.prepare('SELECT * FROM team_invites WHERE status != ? ORDER BY invited_at DESC').all('revoked');
      res.json({ members: rows.map(r => ({ id: r.tailscale_invite_id, email: r.email, status: r.status, createdAt: r.invited_at })), cached: true });
    }
  });

  // ── Invite team member ────────────────────────────────────
  app.post('/api/team/invite', teamWriteLimiter, async (req, res) => {
    try {
      const email = String(req.body?.email || '').trim().toLowerCase();
      if (!email || !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) {
        return res.status(400).json({ error: 'Valid email address required' });
      }
      const data = await centralFetch('/invite', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      // Cache locally
      db.prepare(`
        INSERT INTO team_invites (email, status, tailscale_invite_id) VALUES (?, 'pending', ?)
        ON CONFLICT(email) DO UPDATE SET status='pending', tailscale_invite_id=?, revoked_at=NULL
      `).run(email, data.invite?.id || '', data.invite?.id || '');
      deps.logActivity(null, null, 'team_invite', `Invited ${email} to dashboard`);
      res.json({ success: true, email });
    } catch (err) {
      dashLog('team', `Invite error: ${err.message}`);
      res.status(500).json({ error: 'Failed to send invite. Please try again.' });
    }
  });

  // ── Revoke team member ────────────────────────────────────
  app.delete('/api/team/invite/:email', teamWriteLimiter, async (req, res) => {
    try {
      const email = decodeURIComponent(req.params.email).toLowerCase();
      await centralFetch(`/revoke?email=${encodeURIComponent(email)}`, { method: 'DELETE' });
      db.prepare("UPDATE team_invites SET status='revoked', revoked_at=datetime('now') WHERE email=?").run(email);
      deps.logActivity(null, null, 'team_revoke', `Revoked access for ${email}`);
      res.json({ success: true, email });
    } catch (err) {
      dashLog('team', `Revoke error: ${err.message}`);
      res.status(500).json({ error: 'Failed to revoke access. Please try again.' });
    }
  });

  // ── Resend invite ─────────────────────────────────────────
  app.post('/api/team/resend/:email', teamWriteLimiter, async (req, res) => {
    try {
      const email = decodeURIComponent(req.params.email).toLowerCase();
      // Revoke old invite then create new one
      try { await centralFetch(`/revoke?email=${encodeURIComponent(email)}`, { method: 'DELETE' }); } catch { /* may not exist */ }
      const data = await centralFetch('/invite', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      db.prepare("UPDATE team_invites SET status='pending', tailscale_invite_id=?, revoked_at=NULL WHERE email=?")
        .run(data.invite?.id || '', email);
      res.json({ success: true, email });
    } catch (err) {
      dashLog('team', `Resend error: ${err.message}`);
      res.status(500).json({ error: 'Failed to resend invite. Please try again.' });
    }
  });

  // ── Device registration status ────────────────────────────
  app.get('/api/team/device-status', teamReadLimiter, (req, res) => {
    const auth = loadDeviceAuth();
    let clientName = null;
    try {
      const { getConfigWithFallback, LICENSE_CONFIG } = require('../helpers/paths');
      clientName = getConfigWithFallback(LICENSE_CONFIG, 'license').client_name || null;
    } catch { /* ignore */ }
    res.json({ registered: !!auth, clientId: auth?.clientId || null, clientName });
  });

  // ── Register device (trigger from dashboard) ──────────────
  app.post('/api/team/register-device', registerLimiter, async (req, res) => {
    try {
      if (fs.existsSync(REG_PATH)) {
        return res.json({ success: true, message: 'Device already registered' });
      }
      const { execFileSync } = require('child_process');
      const script = '/opt/AIWH/core/scripts/device-register.sh';
      execFileSync(script, [], {
        timeout: 30000,
        env: { ...process.env, PATH: `/opt/homebrew/bin:/opt/homebrew/sbin:${process.env.PATH || '/usr/bin:/bin'}` },
      });
      res.json({ success: true });
    } catch (err) {
      dashLog('team', `Device registration error: ${err.message}`);
      res.status(500).json({ error: 'Device registration failed. Please try again.' });
    }
  });
};
