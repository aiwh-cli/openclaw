// ─── Workflow Routes ──────────────────────────────────────────
// Theme AA — API for workflow catalogue, activation, monitoring, and management.
// All routes require auth (applied by server.js middleware).

const path = require('path');

module.exports = function registerWorkflowRoutes(app, deps) {
  const { logActivity } = deps;
  function db() { return deps.db; }

  function engine() { return require('../helpers/workflow-engine'); }

  // ─── Templates ─────────────────────────────────────────────

  // List available workflow templates
  app.get('/api/workflows/templates', (req, res) => {
    try {
      const { loadWorkflowTemplates } = engine();
      const data = loadWorkflowTemplates();
      // Enrich with active status from DB
      const activeIds = new Set(
        db().prepare("SELECT template_id FROM workflows WHERE status NOT IN ('succeeded','failed','cancelled')").all()
          .map(r => r.template_id)
      );
      const templates = data.workflows.map(wf => ({
        ...wf,
        active: activeIds.has(wf.id),
      }));
      res.json({ workflows: templates });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Active Workflows ──────────────────────────────────────

  // List active workflows
  app.get('/api/workflows', (req, res) => {
    try {
      const { listWorkflows } = engine();
      const status = req.query.status || null;
      const limit = parseInt(req.query.limit) || 50;
      const workflows = listWorkflows(db(), { status, limit });
      res.json({ workflows });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Get workflow detail with steps
  app.get('/api/workflows/:id', (req, res) => {
    try {
      const { getWorkflow } = engine();
      const wf = getWorkflow(db(), req.params.id);
      if (!wf) return res.status(404).json({ error: 'Workflow not found' });
      res.json(wf);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Activation & Triggering ───────────────────────────────

  // Activate a workflow template (creates workflow + optional trigger cron)
  app.post('/api/workflows/activate', (req, res) => {
    try {
      const { templateId } = req.body || {};
      if (!templateId || typeof templateId !== 'string') {
        return res.status(400).json({ error: 'templateId is required' });
      }
      const { createWorkflow } = engine();
      const result = createWorkflow(db(), templateId);
      logActivity(null, 'system', 'workflow_activated', templateId);
      res.json({ ok: true, workflowId: result.workflowId, name: result.template.name });
    } catch (e) {
      res.status(e.message.includes('not found') ? 404 : 500).json({ error: e.message });
    }
  });

  // Trigger a workflow by template ID (used by crons and manual "Run Now")
  app.post('/api/workflows/:templateId/trigger', (req, res) => {
    try {
      const { triggerWorkflow } = engine();
      const result = triggerWorkflow(db(), req.params.templateId);
      logActivity(null, 'system', 'workflow_triggered', req.params.templateId);
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Manually trigger an already-active workflow (re-run)
  app.post('/api/workflows/:id/run', (req, res) => {
    try {
      const { getWorkflow, triggerWorkflow } = engine();
      const wf = getWorkflow(db(), req.params.id);
      if (!wf) return res.status(404).json({ error: 'Workflow not found' });
      const result = triggerWorkflow(db(), wf.template_id);
      logActivity(null, 'system', 'workflow_manual_run', wf.template_id);
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Management ────────────────────────────────────────────

  // Cancel a workflow
  app.post('/api/workflows/:id/cancel', (req, res) => {
    try {
      const { cancelWorkflow } = engine();
      const wf = cancelWorkflow(db(), req.params.id);
      logActivity(null, 'system', 'workflow_cancelled', req.params.id);
      res.json({ ok: true, workflow: wf });
    } catch (e) {
      res.status(e.message.includes('not found') ? 404 : 400).json({ error: e.message });
    }
  });

  // Retry a blocked workflow
  app.post('/api/workflows/:id/retry', (req, res) => {
    try {
      const { retryWorkflow } = engine();
      const wf = retryWorkflow(db(), req.params.id);
      logActivity(null, 'system', 'workflow_retried', req.params.id);
      res.json({ ok: true, workflow: wf });
    } catch (e) {
      res.status(e.message.includes('not found') ? 404 : 400).json({ error: e.message });
    }
  });

  // Edit a step (client customization)
  app.put('/api/workflows/:id/steps/:stepId', (req, res) => {
    try {
      const { editStep } = engine();
      const updates = req.body || {};
      const allowed = {};
      if (typeof updates.message === 'string') allowed.message = updates.message;
      if (typeof updates.agent === 'string') allowed.agent = updates.agent;
      if (typeof updates.tier === 'string') allowed.tier = updates.tier;
      const step = editStep(db(), req.params.id, req.params.stepId, allowed);
      if (!step) return res.status(404).json({ error: 'Step not found or no changes' });
      logActivity(null, 'system', 'workflow_step_edited', `${req.params.id}/${req.params.stepId}`);
      res.json({ ok: true, step });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Provisioning ──────────────────────────────────────────

  // Auto-provision workflows based on client preferences
  app.post('/api/workflows/provision', (req, res) => {
    try {
      const { provisionWorkflowsForClient } = require('../helpers/workflow-provisioner');
      const prefsPath = path.join(process.env.CLIENT_ROOT || '/opt/AIWH/client', 'config', 'client-preferences.json');
      let prefs = {};
      try { prefs = JSON.parse(require('fs').readFileSync(prefsPath, 'utf8')); } catch {}
      const result = provisionWorkflowsForClient(db(), prefs);
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── History ───────────────────────────────────────────────

  // Get workflow run history
  app.get('/api/workflows/:id/runs', (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 20;
      const runs = db().prepare('SELECT * FROM workflow_runs WHERE workflow_id = ? ORDER BY started_at DESC LIMIT ?')
        .all(req.params.id, limit);
      res.json({ runs });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
};
