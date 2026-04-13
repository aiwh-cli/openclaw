// ─── Department Management (Theme AB.7) ─────────────────────
// CRUD for client/config/departments.json — the client's department config.
// Initialized from core/config/department-templates.json on first startup.

const fs = require('fs');
const P = require('../helpers/paths');
const { logAudit, resolveActor } = require('../helpers/audit');
const { clearDepartmentsCache, loadDepartments: loadDepartmentsFiltered } = require('../helpers/rbac');

const VALID_DEPT_ID = /^[a-z][a-z0-9-]{0,30}$/;
const VALID_AGENT_ID = /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/;

function readDepartments() {
  try {
    return JSON.parse(fs.readFileSync(P.DEPARTMENTS_CONFIG, 'utf8'));
  } catch {
    return { version: 1, departments: [] };
  }
}

function writeDepartments(data) {
  fs.writeFileSync(P.DEPARTMENTS_CONFIG, JSON.stringify(data, null, 2));
  clearDepartmentsCache(); // invalidate RBAC cache immediately
}

module.exports = function (app, deps) {
  const { db } = deps;

  // GET /api/departments — list all departments (AC.1b: stale-agent filtered)
  app.get('/api/departments', (req, res) => {
    const data = loadDepartmentsFiltered();
    res.json({ departments: data.departments || [] });
  });

  // PUT /api/departments/:id/agents — add an agent to a department
  app.put('/api/departments/:id/agents', (req, res) => {
    const { id } = req.params;
    if (!VALID_DEPT_ID.test(id)) return res.status(400).json({ error: 'Invalid department ID' });
    const { agentId } = req.body;
    if (!agentId || typeof agentId !== 'string' || !VALID_AGENT_ID.test(agentId)) {
      return res.status(400).json({ error: 'Valid agentId required' });
    }

    const data = readDepartments();
    const dept = (data.departments || []).find(d => d.id === id);
    if (!dept) return res.status(404).json({ error: 'Department not found' });

    if (!dept.agents) dept.agents = [];
    if (!dept.agents.includes(agentId)) {
      dept.agents.push(agentId);
      writeDepartments(data);
      logAudit(db, {
        actor: resolveActor(req),
        action: 'department.add_agent',
        target: id,
        detail: { agentId },
        ip: req.ip,
      });
    }

    res.json({ ok: true, department: dept });
  });

  // DELETE /api/departments/:id/agents/:agentId — remove an agent from a department
  app.delete('/api/departments/:id/agents/:agentId', (req, res) => {
    const { id, agentId } = req.params;
    if (!VALID_DEPT_ID.test(id)) return res.status(400).json({ error: 'Invalid department ID' });
    if (!VALID_AGENT_ID.test(agentId)) return res.status(400).json({ error: 'Invalid agent ID' });

    const data = readDepartments();
    const dept = (data.departments || []).find(d => d.id === id);
    if (!dept) return res.status(404).json({ error: 'Department not found' });

    if (!dept.agents) dept.agents = [];
    const idx = dept.agents.indexOf(agentId);
    if (idx >= 0) {
      dept.agents.splice(idx, 1);
      writeDepartments(data);
      logAudit(db, {
        actor: resolveActor(req),
        action: 'department.remove_agent',
        target: id,
        detail: { agentId },
        ip: req.ip,
      });
    }

    res.json({ ok: true, department: dept });
  });
};
