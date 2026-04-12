// ─── Activity & Logging Helpers ───────────────────────────────
const fs = require('fs');

const DASHBOARD_LOG = (process.env.CLIENT_ROOT || '/opt/AIWH/client') + '/logs/dashboard.log';

function dashLog(action, detail = '') {
  const ts = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z/, '');
  const line = `[${ts}] ${action}${detail ? ' — ' + detail : ''}\n`;
  try { fs.appendFileSync(DASHBOARD_LOG, line); } catch {}
}

function now() { return new Date().toISOString(); }
function today() { return new Date().toISOString().split('T')[0]; }

/**
 * Log activity to DB + audit_log + emit Socket.io + write to dashboard.log.
 * @param {Object} deps - { db, io }
 */
function logActivity(deps, projectId, agentId, action, detail) {
  const { db, io } = deps;
  db.prepare('INSERT INTO activity (project_id, agent_id, action, detail) VALUES (?,?,?,?)')
    .run(projectId, agentId || '', action, detail || '');
  // Also write to audit_log for unified trail (Theme AB.2)
  try {
    db.prepare('INSERT INTO audit_log (actor, action, target, detail, result) VALUES (?,?,?,?,?)')
      .run(agentId ? `agent:${agentId}` : 'dashboard:user', action, projectId ? `project:${projectId}` : '', detail || '', 'success');
  } catch {}
  io.emit('activity', { projectId, agentId, action, detail, created_at: now() });
  dashLog(`[${action}]${agentId ? ' agent=' + agentId : ''}`, detail || '');
}

module.exports = { dashLog, now, today, logActivity };
