// ─── Audit Log API (Theme AB.2) ─────────────────────────────────────
// Full transparency — every dashboard action logged, searchable, exportable.

const express = require('express');
const router = express.Router();

module.exports = function auditRoutes(deps) {
  const { db } = deps;

  // GET /api/audit-log — paginated, filterable audit entries
  router.get('/', (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = Math.min(100, Math.max(10, parseInt(req.query.limit) || 50));
      const offset = (page - 1) * limit;

      let where = '1=1';
      const params = [];

      if (req.query.actor) {
        where += ' AND actor LIKE ?';
        params.push(`%${req.query.actor}%`);
      }
      if (req.query.action) {
        where += ' AND action LIKE ?';
        params.push(`%${req.query.action}%`);
      }
      if (req.query.result) {
        where += ' AND result = ?';
        params.push(req.query.result);
      }
      if (req.query.from) {
        where += ' AND timestamp >= ?';
        params.push(req.query.from);
      }
      if (req.query.to) {
        where += ' AND timestamp <= ?';
        params.push(req.query.to);
      }
      if (req.query.target) {
        where += ' AND target LIKE ?';
        params.push(`%${req.query.target}%`);
      }

      const total = db.prepare(`SELECT COUNT(*) as count FROM audit_log WHERE ${where}`).get(...params)?.count || 0;

      const entries = db.prepare(`
        SELECT id, timestamp, actor, action, target, detail, result, ip_address, user_id
        FROM audit_log WHERE ${where}
        ORDER BY timestamp DESC
        LIMIT ? OFFSET ?
      `).all(...params, limit, offset);

      res.json({
        entries,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to query audit log', detail: err.message });
    }
  });

  // GET /api/audit-log/stats — summary counts for Overview card
  router.get('/stats', (req, res) => {
    try {
      const hours = parseInt(req.query.hours) || 24;
      const since = `-${hours} hours`;

      const stats = db.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN result = 'success' THEN 1 ELSE 0 END) as success,
          SUM(CASE WHEN result = 'denied' THEN 1 ELSE 0 END) as denied,
          SUM(CASE WHEN result = 'error' THEN 1 ELSE 0 END) as errors
        FROM audit_log
        WHERE timestamp >= datetime('now', ?)
      `).get(since);

      const topActions = db.prepare(`
        SELECT action, COUNT(*) as count
        FROM audit_log
        WHERE timestamp >= datetime('now', ?)
        GROUP BY action ORDER BY count DESC LIMIT 5
      `).all(since);

      const topActors = db.prepare(`
        SELECT actor, COUNT(*) as count
        FROM audit_log
        WHERE timestamp >= datetime('now', ?)
        GROUP BY actor ORDER BY count DESC LIMIT 5
      `).all(since);

      res.json({ hours, ...stats, topActions, topActors });
    } catch (err) {
      res.status(500).json({ error: 'Failed to get audit stats', detail: err.message });
    }
  });

  // GET /api/audit-log/export — CSV download
  router.get('/export', (req, res) => {
    try {
      let where = '1=1';
      const params = [];

      if (req.query.from) { where += ' AND timestamp >= ?'; params.push(req.query.from); }
      if (req.query.to) { where += ' AND timestamp <= ?'; params.push(req.query.to); }

      const entries = db.prepare(`
        SELECT timestamp, actor, action, target, result, ip_address, detail
        FROM audit_log WHERE ${where}
        ORDER BY timestamp DESC
        LIMIT 10000
      `).all(...params);

      // CSV-safe: escape quotes and prevent formula injection (AC.5)
      const csvSafe = (val) => {
        if (!val) return '';
        let s = String(val).replace(/"/g, '""');
        if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
        return s;
      };

      const header = 'timestamp,actor,action,target,result,ip_address,detail\n';
      const rows = entries.map(e => {
        return `${e.timestamp},"${csvSafe(e.actor)}","${csvSafe(e.action)}","${csvSafe(e.target || '')}","${csvSafe(e.result)}","${csvSafe(e.ip_address || '')}","${csvSafe(e.detail || '')}"`;
      }).join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="audit-log-${new Date().toISOString().slice(0,10)}.csv"`);
      res.send(header + rows);
    } catch (err) {
      res.status(500).json({ error: 'Failed to export audit log', detail: err.message });
    }
  });

  // GET /api/audit-log/rbac — RBAC-specific auth events (login, role changes, access denied)
  router.get('/rbac', (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = Math.min(100, Math.max(10, parseInt(req.query.limit) || 50));
      const offset = (page - 1) * limit;

      let where = '1=1';
      const params = [];
      if (req.query.event) { where += ' AND event = ?'; params.push(req.query.event); }
      if (req.query.email) { where += ' AND email LIKE ?'; params.push(`%${req.query.email}%`); }
      if (req.query.success !== undefined) { where += ' AND success = ?'; params.push(req.query.success === 'true' ? 1 : 0); }
      if (req.query.from) { where += ' AND timestamp >= ?'; params.push(req.query.from); }
      if (req.query.to) { where += ' AND timestamp <= ?'; params.push(req.query.to); }

      const total = db.prepare(`SELECT COUNT(*) as count FROM rbac_audit WHERE ${where}`).get(...params)?.count || 0;
      const entries = db.prepare(`
        SELECT * FROM rbac_audit WHERE ${where}
        ORDER BY timestamp DESC LIMIT ? OFFSET ?
      `).all(...params, limit, offset);

      // Summary stats
      const stats = db.prepare(`
        SELECT event, COUNT(*) as count, SUM(CASE WHEN success=0 THEN 1 ELSE 0 END) as failures
        FROM rbac_audit WHERE timestamp >= datetime('now', '-24 hours')
        GROUP BY event ORDER BY count DESC
      `).all();

      res.json({ entries, stats, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
    } catch (err) {
      res.status(500).json({ error: 'Failed to query RBAC audit', detail: err.message });
    }
  });

  // GET /api/audit-log/archive/months — list available archive months (AC.4)
  router.get('/archive/months', (req, res) => {
    const fs = require('fs');
    const path = require('path');
    const ARCHIVE_DIR = path.join(process.env.CLIENT_ROOT || '/opt/AIWH/client', 'data', 'audit-archive');
    try {
      if (!fs.existsSync(ARCHIVE_DIR)) return res.json({ months: [] });
      const files = fs.readdirSync(ARCHIVE_DIR)
        .filter(f => /^\d{4}-\d{2}\.jsonl$/.test(f))
        .map(f => f.replace('.jsonl', ''))
        .sort().reverse();
      res.json({ months: files });
    } catch (err) {
      res.status(500).json({ error: 'Failed to list archive months', detail: err.message });
    }
  });

  // GET /api/audit-log/archive?month=YYYY-MM&page=1&limit=50 — read archived entries (AC.4)
  router.get('/archive', (req, res) => {
    const fs = require('fs');
    const path = require('path');
    const ARCHIVE_DIR = path.join(process.env.CLIENT_ROOT || '/opt/AIWH/client', 'data', 'audit-archive');
    const { month } = req.query;
    if (!month || !/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'Invalid month format (YYYY-MM)' });
    const filePath = path.join(ARCHIVE_DIR, `${month}.jsonl`);
    try {
      if (!fs.existsSync(filePath)) return res.status(404).json({ error: `No archive for ${month}` });
      const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
      const entries = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = Math.min(100, Math.max(10, parseInt(req.query.limit) || 50));
      const total = entries.length;
      const offset = (page - 1) * limit;
      const paged = entries.slice(offset, offset + limit);
      res.json({ entries: paged, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
    } catch (err) {
      res.status(500).json({ error: 'Failed to read archive', detail: err.message });
    }
  });

  return router;
};
