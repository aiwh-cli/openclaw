// ─── Dashboard Authentication (Theme AB.10) ─────────────────
// Multi-user email+password auth. SQLite-backed sessions (survive restarts).
// Session carries userId, email, role, departments, commandCentres.
// Falls back to single-password legacy mode if no users table populated.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');

const CLIENT_ROOT = process.env.CLIENT_ROOT || '/opt/AIWH/client';
const AUTH_FILE = path.join(CLIENT_ROOT, 'config', 'auth.json');
const SESSION_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours
const MAX_SESSIONS = 100;

// ─── SQLite-backed sessions (survives dashboard restarts) ───
function ensureSessionsTable() {
  if (!_getDb) return;
  try {
    _getDb().exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        data TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
    `);
  } catch {}
}

function sessionSet(id, data) {
  if (!_getDb) return;
  try {
    const now = Date.now();
    _getDb().prepare(`
      INSERT OR REPLACE INTO sessions (id, user_id, data, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, data.userId || '', JSON.stringify(data), data.created || now, now + SESSION_MAX_AGE);
    // Enforce cap
    const count = _getDb().prepare('SELECT COUNT(*) as n FROM sessions').get().n;
    if (count > MAX_SESSIONS) {
      _getDb().prepare('DELETE FROM sessions WHERE id IN (SELECT id FROM sessions ORDER BY created_at ASC LIMIT ?)').run(count - MAX_SESSIONS);
    }
  } catch {}
}

function sessionGet(id) {
  if (!_getDb) return null;
  try {
    const row = _getDb().prepare('SELECT data, expires_at FROM sessions WHERE id = ?').get(id);
    if (!row) return null;
    if (Date.now() > row.expires_at) { sessionDelete(id); return null; }
    return JSON.parse(row.data);
  } catch { return null; }
}

function sessionDelete(id) {
  if (!_getDb) return;
  try { _getDb().prepare('DELETE FROM sessions WHERE id = ?').run(id); } catch {}
}

function sessionDeleteForUser(userId) {
  if (!_getDb) return;
  try { _getDb().prepare('DELETE FROM sessions WHERE user_id = ?').run(userId); } catch {}
}

function sessionCleanup() {
  if (!_getDb) return;
  try { _getDb().prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()); } catch {}
}

// Periodic cleanup every 5 min
setInterval(() => sessionCleanup(), 5 * 60 * 1000);

// Rate limiter for login endpoint
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.body?.email || req.ip,
  message: { error: 'Too many login attempts. Please wait 15 minutes before trying again.' },
});

// DB reference — set during registerAuthRoutes
let _getDb = null;

function buildSessionCookie(sessionId, req, maxAge) {
  const secure = (req.secure || req.headers['x-forwarded-proto'] === 'https') ? ' Secure;' : '';
  return `aiwh_session=${sessionId}; HttpOnly;${secure} SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}
function isLocalhost(req) {
  const ip = req.ip || req.connection?.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}
function loadAuth() { try { return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8')); } catch { return null; } }
function generateSessionId() { return crypto.randomBytes(32).toString('hex'); }
function hashPassword(password, salt) { return crypto.scryptSync(password, salt, 64).toString('hex'); }

function verifyPassword(password, hash, salt) {
  if (!hash || !salt) return false;
  const computed = hashPassword(password, salt);
  return crypto.timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(hash, 'hex'));
}

function findUserByEmail(email) {
  if (!_getDb) return null;
  try { return _getDb().prepare('SELECT * FROM users WHERE email = ? AND status != ?').get(email, 'suspended'); }
  catch { return null; }
}
function findUserById(id) {
  if (!_getDb) return null;
  try { return _getDb().prepare('SELECT * FROM users WHERE id = ?').get(id); }
  catch { return null; }
}
function isMultiUserMode() {
  if (!_getDb) return false;
  try { return _getDb().prepare('SELECT COUNT(*) as n FROM users').get().n > 0; }
  catch { return false; }
}

/** Build session data from a user record */
function buildSessionData(user) {
  let departments = [];
  let commandCentres = [];
  try { departments = JSON.parse(user.departments || '[]'); } catch {}
  try { commandCentres = JSON.parse(user.command_centres || '[]'); } catch {}
  return {
    userId: user.id,
    email: user.email,
    displayName: user.display_name,
    role: user.role,
    departments,
    commandCentres,
    personalCcAccess: !!user.personal_cc_access,
    mustChangePassword: !!user.must_change_password,
    created: Date.now(),
  };
}

/** Log an RBAC audit event */
function logRbacEvent(event, { userId = '', email = '', detail = {}, ip = '', success = true } = {}) {
  if (!_getDb) return;
  try {
    const db = _getDb();
    db.prepare(`
      INSERT INTO rbac_audit (user_id, email, event, detail, ip_address, success)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(userId, email, event, JSON.stringify(detail), ip, success ? 1 : 0);
  } catch {}
}

// ─── Middleware ──────────────────────────────────────────────

function authMiddleware(req, res, next) {
  // Always allow static files
  if (req.path.match(/\.(css|js|ico|svg|png|jpg|woff2?|ttf|map)$/)) return next();

  const auth = loadAuth();

  // Strip audit spoofing headers — only internal callers should set these
  if (req.headers.origin || req.headers.referer) {
    delete req.headers['x-audit-actor'];
    delete req.headers['x-audit-action'];
  }

  // Onboarding status always open
  if (req.path === '/api/onboarding/status') return next();
  // Onboarding routes blocked after setup
  if (req.path.startsWith('/api/onboarding')) {
    if (auth?.setupComplete) {
      return res.status(403).json({ error: 'Your system is already set up.' });
    }
    return next();
  }

  // Localhost API bypass for internal agents/scripts — still inject req.user if cookie present
  const isBrowserPageReq = !req.path.startsWith('/api/') && (req.path === '/' || req.path.endsWith('.html'));
  if (isLocalhost(req) && !req.headers.origin && !req.headers.referer && !isBrowserPageReq) {
    const sessionId = parseCookie(req.headers.cookie, 'aiwh_session');
    const session = sessionId ? sessionGet(sessionId) : null;
    if (session) {
      req.user = {
        userId: session.userId, email: session.email, displayName: session.displayName,
        role: session.role, departments: session.departments || [], commandCentres: session.commandCentres || [],
        personalCcAccess: session.personalCcAccess || false,
      };
    }
    return next();
  }
  if (req.path === '/onboarding.html' || req.path === '/onboarding.css') {
    if (!auth || !auth.setupComplete) return next();
  }

  // Always allow login + health routes
  if (req.path === '/api/auth/login') return next();
  if (req.path === '/api/auth/status') return next();
  if (req.path === '/api/health') return next();
  if (req.path === '/login.html') return next();

  // No auth setup yet → redirect to onboarding
  if (!auth || (!auth.passwordHash && !auth.setupComplete)) {
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'System needs setup.', redirect: '/onboarding.html' });
    return res.redirect('/onboarding.html');
  }
  if (!auth.passwordHash) {
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'System needs setup.', redirect: '/onboarding.html' });
    return res.redirect('/onboarding.html');
  }

  // Check session cookie (SQLite-backed — survives restarts)
  const sessionId = parseCookie(req.headers.cookie, 'aiwh_session');
  const session = sessionId ? sessionGet(sessionId) : null;
  if (session) {
    req.user = {
      userId: session.userId,
      email: session.email,
      displayName: session.displayName,
      role: session.role,
      departments: session.departments || [],
      commandCentres: session.commandCentres || [],
      personalCcAccess: session.personalCcAccess || false,
      mustChangePassword: session.mustChangePassword || false,
    };
    if (req.user.mustChangePassword && !req.path.startsWith('/api/auth/')) {
      if (req.path.startsWith('/api/')) return res.status(403).json({ error: 'Password change required', mustChangePassword: true });
    }
    return next();
  }

  // No valid session
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Session expired. Please log in.', redirect: '/login.html' });
  return res.redirect('/login.html');
}

// ─── Auth Routes ────────────────────────────────────────────

function registerAuthRoutes(app, getDb) {
  _getDb = getDb || (() => require('../db').getDb());
  ensureSessionsTable();

  app.post('/api/auth/login', loginLimiter, (req, res) => {
    const { email, password } = req.body;

    // Multi-user mode: require email + password
    if (isMultiUserMode()) {
      if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

      const user = findUserByEmail(email);
      if (!user) {
        logRbacEvent('login_failed', { email, ip: req.ip, success: false, detail: { reason: 'user_not_found' } });
        return res.status(401).json({ error: 'Invalid email or password.' });
      }
      if (user.status === 'suspended') {
        logRbacEvent('login_failed', { userId: user.id, email, ip: req.ip, success: false, detail: { reason: 'suspended' } });
        return res.status(401).json({ error: 'Your account has been suspended. Contact the system owner.' });
      }

      if (!verifyPassword(password, user.password_hash, user.password_salt)) {
        logRbacEvent('login_failed', { userId: user.id, email, ip: req.ip, success: false, detail: { reason: 'wrong_password' } });
        return res.status(401).json({ error: 'Invalid email or password.' });
      }

      // Rotate session
      const oldSession = parseCookie(req.headers.cookie, 'aiwh_session');
      if (oldSession) sessionDelete(oldSession);

      const sessionId = generateSessionId();
      sessionSet(sessionId, buildSessionData(user));

      logRbacEvent('login', { userId: user.id, email, ip: req.ip });

      res.setHeader('Set-Cookie', buildSessionCookie(sessionId, req, SESSION_MAX_AGE / 1000));
      return res.json({
        success: true,
        redirect: user.must_change_password ? '/login.html#change-password' : '/',
        user: { displayName: user.display_name, role: user.role, mustChangePassword: !!user.must_change_password },
      });
    }

    // Legacy single-password mode (backward compat during migration)
    if (!password && !email) return res.status(400).json({ error: 'Password required' });
    const pw = password || email; // support old login.html sending just "password"
    const auth = loadAuth();
    if (!auth || !verifyPassword(pw, auth.passwordHash, auth.passwordSalt)) {
      return res.status(401).json({ error: 'Incorrect password.' });
    }

    const oldSession = parseCookie(req.headers.cookie, 'aiwh_session');
    if (oldSession) sessionDelete(oldSession);
    const sessionId = generateSessionId();
    sessionSet(sessionId, { userId: 'legacy', email: '', displayName: 'Owner', role: 'owner', departments: [], commandCentres: ['business', 'wealth', 'life'], created: Date.now() });

    res.setHeader('Set-Cookie', buildSessionCookie(sessionId, req, SESSION_MAX_AGE / 1000));
    res.json({ success: true, redirect: '/' });
  });

  app.post('/api/auth/change-password', (req, res) => {
    // Auth routes are registered before authMiddleware, so req.user isn't set automatically.
    // Look up session from cookie manually.
    if (!req.user) {
      const sid = parseCookie(req.headers.cookie, 'aiwh_session');
      const sess = sid ? sessionGet(sid) : null;
      if (!sess) return res.status(401).json({ error: 'Not authenticated' });
      req.user = { userId: sess.userId, email: sess.email, role: sess.role, mustChangePassword: sess.mustChangePassword };
    }

    const { currentPassword, newPassword } = req.body;
    if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });

    const user = findUserById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // If must_change_password, don't require currentPassword (they're setting it for the first time)
    if (!user.must_change_password) {
      if (!currentPassword) return res.status(400).json({ error: 'Current password required' });
      if (!verifyPassword(currentPassword, user.password_hash, user.password_salt)) {
        return res.status(401).json({ error: 'Current password is incorrect.' });
      }
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const hash = hashPassword(newPassword, salt);

    const db = _getDb();
    db.prepare(`UPDATE users SET password_hash = ?, password_salt = ?, must_change_password = 0, status = 'active', updated_at = datetime('now') WHERE id = ?`).run(hash, salt, user.id);

    // Also update auth.json if this is the owner (keeps single-password mode in sync)
    if (user.role === 'owner') {
      try {
        const auth = loadAuth();
        if (auth) {
          auth.passwordHash = hash;
          auth.passwordSalt = salt;
          auth.passwordChangedAt = new Date().toISOString();
          fs.writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2), { mode: 0o600 });
        }
      } catch {}
    }

    logRbacEvent('password_changed', { userId: user.id, email: user.email, ip: req.ip });

    // Invalidate all sessions for this user, force re-login
    sessionDeleteForUser(user.id);
    res.setHeader('Set-Cookie', buildSessionCookie('', req, 0));
    res.json({ success: true, message: 'Password changed. Please log in again.' });
  });

  app.post('/api/auth/logout', (req, res) => {
    const sessionId = parseCookie(req.headers.cookie, 'aiwh_session');
    if (sessionId) sessionDelete(sessionId);
    logRbacEvent('logout', { userId: req.user?.userId || '', email: req.user?.email || '', ip: req.ip });
    res.setHeader('Set-Cookie', buildSessionCookie('', req, 0));
    res.json({ success: true });
  });

  app.get('/api/auth/status', (req, res) => {
    const auth = loadAuth();
    const sessionId = parseCookie(req.headers.cookie, 'aiwh_session');
    const session = sessionId ? sessionGet(sessionId) : null;
    const loggedIn = !!session;

    const resp = {
      hasPassword: !!(auth?.passwordHash),
      loggedIn: !!loggedIn,
      multiUser: isMultiUserMode(),
    };
    if (loggedIn && session) {
      const role = session.role;
      resp.user = {
        userId: session.userId,
        email: session.email,
        displayName: session.displayName,
        role,
        departments: session.departments,
        commandCentres: session.commandCentres,
        personalCcAccess: session.personalCcAccess || false,
        mustChangePassword: session.mustChangePassword || false,
      };
      // View + action permissions from RBAC policy (configurable by owner)
      const { getPermissionsForRole, loadPolicy } = require('./rbac');
      resp.permissions = getPermissionsForRole(role);
      // Include view permissions for sidebar filtering
      if (role === 'owner') {
        resp.views = null; // null = all views (no filter)
      } else {
        const policy = loadPolicy();
        resp.views = policy.roles?.[role]?.views || {};
      }
    }
    res.json(resp);
  });

  // PIN lock routes (Wealth/Life CC)
  const { registerPinRoutes } = require('./pin-lock');
  registerPinRoutes(app, { getDb: _getDb, sessionGet, sessionSet, parseCookie, logRbacEvent });
}

// ─── Cookie Parser ──────────────────────────────────────────

function parseCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  const match = cookieHeader.split(';').find(c => c.trim().startsWith(`${name}=`));
  return match ? match.split('=')[1]?.trim() : null;
}

function isValidSession(cookieHeader) {
  const sessionId = parseCookie(cookieHeader, 'aiwh_session');
  if (!sessionId) return false;
  return !!sessionGet(sessionId);
}

/** Get session data from cookie (used by socket.io, audit middleware) */
function getSessionFromCookie(cookieHeader) {
  const sessionId = parseCookie(cookieHeader, 'aiwh_session');
  if (!sessionId) return null;
  return sessionGet(sessionId);
}

module.exports = { authMiddleware, registerAuthRoutes, isValidSession, isLocalhost, getSessionFromCookie, logRbacEvent };
