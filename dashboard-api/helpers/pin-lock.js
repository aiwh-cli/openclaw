// ─── PIN Lock for Wealth/Life CC (Theme AB.12) ──────────────
// Per-user PIN: each user with Wealth/Life CC access sets their own PIN independently.
const crypto = require('crypto');

function hashPin(pin, salt) { return crypto.scryptSync(pin, salt, 64).toString('hex'); }

function registerPinRoutes(app, { getDb, sessionGet, sessionSet, parseCookie, logRbacEvent }) {
  const pinLimiter = require('express-rate-limit')({
    windowMs: 15 * 60 * 1000, max: 5,
    keyGenerator: (req) => req.user?.userId || req.ip,
    message: { error: 'Too many PIN attempts. Please wait 15 minutes.' },
  });

  // PIN routes are registered before authMiddleware, so req.user isn't set. Parse session manually.
  function ensureUser(req) {
    if (req.user) return;
    const sid = parseCookie(req.headers.cookie, 'aiwh_session');
    const sess = sid ? sessionGet(sid) : null;
    if (sess) req.user = { userId: sess.userId, email: sess.email, role: sess.role, departments: sess.departments || [], commandCentres: sess.commandCentres || [] };
  }

  function canManagePin(user) {
    if (!user) return false;
    if (user.role === 'owner') return true;
    const ccs = user.commandCentres || [];
    return user.role === 'admin' && (ccs.includes('wealth') || ccs.includes('life'));
  }

  app.post('/api/auth/pin/set', (req, res) => {
    ensureUser(req);
    if (!canManagePin(req.user)) return res.status(403).json({ error: 'Requires owner or admin with Wealth/Life access' });
    const { pin } = req.body;
    if (!pin || !/^\d{4,6}$/.test(pin)) return res.status(400).json({ error: 'PIN must be 4-6 digits' });
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = hashPin(pin, salt);
    const db = getDb();
    db.prepare("UPDATE users SET life_cc_pin = ?, updated_at = datetime('now') WHERE id = ?").run(`${salt}:${hash}`, req.user.userId);
    logRbacEvent('pin_set', { userId: req.user.userId, email: req.user.email, ip: req.ip });
    res.json({ ok: true });
  });

  app.post('/api/auth/pin/verify', pinLimiter, (req, res) => {
    ensureUser(req);
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    const db = getDb();
    const row = db.prepare("SELECT life_cc_pin FROM users WHERE id = ?").get(req.user.userId);
    if (!row?.life_cc_pin) return res.json({ ok: true, verified: true });
    const parts = row.life_cc_pin.split(':');
    if (parts.length !== 2) return res.status(500).json({ error: 'PIN data corrupted' });
    const [salt, storedHash] = parts;
    const { pin } = req.body;
    if (!pin) return res.status(400).json({ error: 'PIN required' });
    const computedHash = hashPin(pin, salt);
    const match = crypto.timingSafeEqual(Buffer.from(computedHash, 'hex'), Buffer.from(storedHash, 'hex'));
    if (!match) {
      logRbacEvent('pin_failed', { userId: req.user.userId, email: req.user.email, ip: req.ip, success: false });
      return res.status(401).json({ error: 'Incorrect PIN' });
    }
    const sessionId = parseCookie(req.headers.cookie, 'aiwh_session');
    if (sessionId) {
      const session = sessionGet(sessionId);
      if (session) { session.pinVerified = true; sessionSet(sessionId, session); }
    }
    logRbacEvent('pin_verified', { userId: req.user.userId, email: req.user.email, ip: req.ip });
    res.json({ ok: true, verified: true });
  });

  app.get('/api/auth/pin/status', (req, res) => {
    ensureUser(req);
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    const db = getDb();
    const row = db.prepare("SELECT life_cc_pin FROM users WHERE id = ?").get(req.user.userId);
    const hasPin = !!row?.life_cc_pin;
    const sessionId = parseCookie(req.headers.cookie, 'aiwh_session');
    const session = sessionId ? sessionGet(sessionId) : null;
    res.json({ hasPin, verified: !hasPin || !!session?.pinVerified });
  });

  app.post('/api/auth/pin/remove', (req, res) => {
    ensureUser(req);
    if (!canManagePin(req.user)) return res.status(403).json({ error: 'Requires owner or admin with Wealth/Life access' });
    const db = getDb();
    db.prepare("UPDATE users SET life_cc_pin = NULL, updated_at = datetime('now') WHERE id = ?").run(req.user.userId);
    logRbacEvent('pin_removed', { userId: req.user.userId, email: req.user.email, ip: req.ip });
    res.json({ ok: true });
  });
}

module.exports = { registerPinRoutes };
