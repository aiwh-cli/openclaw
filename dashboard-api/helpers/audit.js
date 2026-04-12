// ─── Audit Trail — Full Dashboard Transparency (Theme AB.2) ──────────
// Logs every mutating action to audit_log table in mission-control.db.
// Foundation for RBAC (AB.10-12) — actor field supports future multi-user.

const SECRET_PATTERNS = [
  /api[_-]?key/i, /secret/i, /password/i, /token/i, /credential/i,
  /auth[_-]?key/i, /private[_-]?key/i, /bearer/i, /session[_-]?id/i
];

const MASK = '***masked***';

/** Recursively sanitize an object — mask any key matching secret patterns */
function sanitize(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitize);
  const clean = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SECRET_PATTERNS.some(p => p.test(k))) {
      clean[k] = MASK;
    } else if (typeof v === 'object' && v !== null) {
      clean[k] = sanitize(v);
    } else {
      clean[k] = v;
    }
  }
  return clean;
}

/** Derive actor string from request context */
function resolveActor(req) {
  // Explicit actor header (set by cron-provisioner, workflow-engine)
  if (req.headers['x-audit-actor']) return req.headers['x-audit-actor'];
  // Multi-user: use email from req.user (injected by auth middleware)
  if (req.user?.email) return `user:${req.user.email}`;
  if (req.user?.userId) return `user:${req.user.userId}`;
  // System/internal
  return 'system';
}

/** Resolve user ID from request context */
function resolveUserId(req) {
  return req.user?.userId || 'system';
}

/** Derive action string from route */
function resolveAction(req) {
  // Explicit action header (high-value actions set this)
  if (req.headers['x-audit-action']) return req.headers['x-audit-action'];
  // Auto-derive from method + path: POST /api/connectors/stripe/connect → connector.connect
  const parts = req.path.replace(/^\/api\//, '').split('/').filter(Boolean);
  const method = req.method.toLowerCase();
  if (parts.length >= 2) return `${parts[0]}.${method}`;
  if (parts.length === 1) return `${parts[0]}.${method}`;
  return `unknown.${method}`;
}

/**
 * Log an audit entry directly (for explicit high-value actions).
 * @param {object} db - better-sqlite3 database instance
 * @param {object} opts - { actor, action, target, detail, result, ip }
 */
function logAudit(db, { actor, action, target = '', detail = {}, result = 'success', ip = '', userId = '' }) {
  try {
    const sanitized = typeof detail === 'string' ? detail : JSON.stringify(sanitize(detail));
    db.prepare(`
      INSERT INTO audit_log (actor, action, target, detail, result, ip_address, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(actor, action, target, sanitized, result, ip, userId);
  } catch (err) {
    console.error('[audit] Failed to write audit log:', err.message);
  }
}

/**
 * Express middleware — auto-logs all POST/PUT/PATCH/DELETE requests.
 * Attach to server.js for global coverage.
 * @param {Function} getDb - function that returns the db instance
 */
function auditMiddleware(getDb) {
  return (req, res, next) => {
    // Only log mutating methods
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();

    // Capture the original end to log after response
    const originalEnd = res.end;
    res.end = function (...args) {
      const result = res.statusCode < 400 ? 'success' : res.statusCode < 500 ? 'denied' : 'error';
      try {
        const db = getDb();
        logAudit(db, {
          actor: resolveActor(req),
          action: resolveAction(req),
          target: req.params?.id || req.params?.name || req.path,
          detail: {
            method: req.method,
            path: req.path,
            params: req.params,
            body: sanitize(req.body),
            statusCode: res.statusCode,
          },
          result,
          ip: req.ip || req.connection?.remoteAddress || '',
          userId: resolveUserId(req),
        });
      } catch (err) {
        console.error('[audit] Middleware error:', err.message);
      }
      originalEnd.apply(res, args);
    };
    next();
  };
}

/**
 * Archive old audit entries to JSONL files, then delete from DB (AC.4).
 * Archives: client/data/audit-archive/YYYY-MM.jsonl (audit_log)
 *           client/data/audit-archive/rbac-YYYY-MM.jsonl (rbac_audit)
 * @param {object} db - better-sqlite3 database instance
 * @param {number} retentionDays - days to keep in active table (default 90)
 */
function archiveAndCleanup(db, retentionDays = 90) {
  const fs = require('fs');
  const path = require('path');
  const ARCHIVE_DIR = path.join(process.env.CLIENT_ROOT || '/opt/AIWH/client', 'data', 'audit-archive');

  try {
    // Ensure archive directory exists
    if (!fs.existsSync(ARCHIVE_DIR)) fs.mkdirSync(ARCHIVE_DIR, { recursive: true, mode: 0o700 });

    const cutoff = `-${retentionDays} days`;

    // Archive audit_log entries
    const oldEntries = db.prepare(`
      SELECT id, timestamp, actor, action, target, detail, result, ip_address, user_id
      FROM audit_log WHERE timestamp < datetime('now', ?)
      ORDER BY timestamp ASC
    `).all(cutoff);

    if (oldEntries.length > 0) {
      // Group by YYYY-MM
      const byMonth = {};
      for (const e of oldEntries) {
        const month = (e.timestamp || '').slice(0, 7) || 'unknown';
        (byMonth[month] = byMonth[month] || []).push(e);
      }
      // Append to JSONL files
      for (const [month, entries] of Object.entries(byMonth)) {
        const filePath = path.join(ARCHIVE_DIR, `${month}.jsonl`);
        const lines = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
        fs.appendFileSync(filePath, lines, { mode: 0o600 });
      }
      // Delete archived entries from DB
      const ids = oldEntries.map(e => e.id);
      const placeholders = ids.map(() => '?').join(',');
      db.prepare(`DELETE FROM audit_log WHERE id IN (${placeholders})`).run(...ids);
      console.log(`[audit] Archived ${oldEntries.length} audit entries to ${Object.keys(byMonth).length} month(s)`);
    }

    // Archive rbac_audit entries
    const oldRbac = db.prepare(`
      SELECT id, timestamp, user_id, email, event, detail, ip_address, success
      FROM rbac_audit WHERE timestamp < datetime('now', ?)
      ORDER BY timestamp ASC
    `).all(cutoff);

    if (oldRbac.length > 0) {
      const byMonth = {};
      for (const e of oldRbac) {
        const month = (e.timestamp || '').slice(0, 7) || 'unknown';
        (byMonth[month] = byMonth[month] || []).push(e);
      }
      for (const [month, entries] of Object.entries(byMonth)) {
        const filePath = path.join(ARCHIVE_DIR, `rbac-${month}.jsonl`);
        const lines = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
        fs.appendFileSync(filePath, lines, { mode: 0o600 });
      }
      const ids = oldRbac.map(e => e.id);
      const placeholders = ids.map(() => '?').join(',');
      db.prepare(`DELETE FROM rbac_audit WHERE id IN (${placeholders})`).run(...ids);
      console.log(`[audit] Archived ${oldRbac.length} RBAC audit entries`);
    }
  } catch (err) {
    console.error('[audit] Archive error:', err.message);
  }
}

// Backwards-compat alias
const cleanupAuditLog = archiveAndCleanup;

module.exports = { logAudit, auditMiddleware, archiveAndCleanup, cleanupAuditLog, sanitize, resolveActor };
