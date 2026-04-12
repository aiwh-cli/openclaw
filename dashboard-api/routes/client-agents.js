// ─── Client Agent Creation & Management (Theme AB.2.10) ────────────
// Allows clients to create custom agents via the dashboard.
// Agents live in client/agents/{id}/ with runtime files from _shared template.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { logAudit, resolveActor } = require('../helpers/audit');
const P = require('../helpers/paths');
const gen = require('../helpers/agent-generator');
const { syncAgents } = require('../helpers/agent-sync');


const VALID_AGENT_ID = /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/;
const TEMPLATES_DIR = path.join(P.CONFIG_DIR, 'agent-templates', '_shared');

let _restartTimer = null;
function scheduleGatewayRestart() {
  if (_restartTimer) clearTimeout(_restartTimer);
  _restartTimer = setTimeout(() => {
    _restartTimer = null;
    try {
      execFileSync('/opt/homebrew/bin/docker', ['restart', 'aiwh-openclaw'],
        { timeout: 15000, env: P.SUBPROCESS_ENV });
    } catch {
      try { execFileSync('/opt/homebrew/bin/openclaw', ['gateway', 'restart'],
        { timeout: 15000, env: P.SUBPROCESS_ENV }); } catch { /* */ }
    }
  }, 3000);
}

// Reserved IDs — cannot be used for client agents
// Static fallback + dynamic read from openclaw.json product agents
const STATIC_RESERVED = new Set([
  'main', 'research', 'copywriter', 'video', 'social', 'seo', 'funnel',
  'sales', 'crm-manager', 'calendar-manager', 'email-manager', 'cfo',
  'coach', 'travel', 'health-tracker', 'wcc-agent',
  'builder-manager', 'security-manager', 'module-manager', 'scheduler',
  'ai-council', 'systems',
]);

function getReservedIds() {
  try {
    const cfg = JSON.parse(fs.readFileSync(P.OPENCLAW_CONFIG, 'utf8'));
    const productIds = (cfg.agents?.list || [])
      .filter(a => !a.workspace?.includes('/client/agents/'))
      .map(a => a.id);
    return new Set([...STATIC_RESERVED, ...productIds]);
  } catch { return STATIC_RESERVED; }
}

module.exports = function (app, deps) {
  const { db, adapter, setOrgChartCache, logActivity, setCronJobsCache } = deps;

  // GET /api/agents/:id/dependencies — what's connected to this agent
  app.get('/api/agents/:id/dependencies', (req, res) => {
    const { id } = req.params;
    if (!VALID_AGENT_ID.test(id)) return res.status(400).json({ error: 'Invalid agent ID' });

    // Tasks assigned to this agent (not done/cancelled)
    const tasks = db.prepare(
      "SELECT id, title, status FROM tasks WHERE assigned_agent=? AND status NOT IN ('done','cancelled') ORDER BY status, title"
    ).all(id);

    // Crons assigned to this agent
    let crons = [];
    try {
      const allCrons = adapter.getCronJobs ? adapter.getCronJobs() : [];
      crons = allCrons.filter(c => c.agentId === id).map(c => ({
        id: c.id, name: c.name || c.id, schedule: c.schedule, enabled: c.enabled,
      }));
    } catch { /* */ }

    res.json({ tasks, crons });
  });

  // POST /api/agents/create — scaffold a new client agent workspace
  app.post('/api/agents/create', (req, res) => {
    const { id, name, description, command_centre } = req.body;

    if (!id || !VALID_AGENT_ID.test(id)) {
      return res.status(400).json({ error: 'Invalid agent ID. Use lowercase letters, numbers, and hyphens (3-32 chars)' });
    }
    if (getReservedIds().has(id)) {
      return res.status(400).json({ error: 'That name is reserved for a system agent' });
    }
    if (!name || typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 60) {
      return res.status(400).json({ error: 'Agent name must be 2-60 characters' });
    }
    const desc = typeof description === 'string' ? description.trim().substring(0, 500) : '';

    const agentDir = path.join(P.CLIENT_AGENTS_DIR, id);

    if (fs.existsSync(agentDir)) {
      return res.status(409).json({ error: 'An agent with that ID already exists' });
    }

    try {
      // Create workspace directory
      fs.mkdirSync(agentDir, { recursive: true });

      // Copy BOOTSTRAP.md from _shared template (product-locked)
      const bootstrapSrc = path.join(TEMPLATES_DIR, 'BOOTSTRAP.md');
      if (fs.existsSync(bootstrapSrc)) {
        fs.copyFileSync(bootstrapSrc, path.join(agentDir, 'BOOTSTRAP.md'));
      }

      // Generate contextual runtime files (Theme AB.8)
      const genCtx = { name: name.trim(), description: desc };

      fs.writeFileSync(path.join(agentDir, 'SOUL.md'), gen.generateSoulMd(genCtx));
      fs.writeFileSync(path.join(agentDir, 'CORE.md'), gen.generateCoreMd(genCtx));
      fs.writeFileSync(path.join(agentDir, 'TOOLS.md'), gen.generateToolsMd(genCtx));
      fs.writeFileSync(path.join(agentDir, 'AGENTS.md'), gen.generateAgentsMd(genCtx));
      fs.writeFileSync(path.join(agentDir, 'IDENTITY.md'), gen.generateIdentityMd(genCtx));

      // Copy shared templates (product-locked: USER, HEARTBEAT, MEMORY)
      for (const tmpl of ['USER.md', 'HEARTBEAT.md', 'MEMORY.md']) {
        const src = path.join(TEMPLATES_DIR, tmpl);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, path.join(agentDir, tmpl));
        }
      }

      // Register in openclaw.json
      _registerInConfig(id, name.trim(), agentDir, command_centre);


      // Invalidate org chart cache so the new agent appears in Team view
      if (typeof setOrgChartCache === 'function') setOrgChartCache(null);
      try { syncAgents(db, adapter); } catch { /* */ }

      // Restart gateway so the new agent is available for chat
      scheduleGatewayRestart();

      logAudit(db, {
        actor: resolveActor(req),
        action: 'agent.create',
        target: id,
        detail: { name: name.trim(), command_centre: command_centre || 'business' },
        ip: req.ip,
      });
      logActivity(null, 'dashboard', 'agent_created', `Custom agent "${name.trim()}" created`);

      res.json({ ok: true, id, name: name.trim() });
    } catch (e) {
      // Clean up on failure
      try { if (fs.existsSync(agentDir)) fs.rmSync(agentDir, { recursive: true }); } catch { /* */ }
      logAudit(db, {
        actor: resolveActor(req),
        action: 'agent.create',
        target: id,
        detail: { error: e.message },
        result: 'error',
        ip: req.ip,
      });
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/agents/:id/deactivate — mark a client agent as inactive
  app.post('/api/agents/:id/deactivate', (req, res) => {
    const { id } = req.params;
    if (!VALID_AGENT_ID.test(id)) return res.status(400).json({ error: 'Invalid agent ID' });
    const agentDir = path.join(P.CLIENT_AGENTS_DIR, id);

    if (!fs.existsSync(agentDir)) {
      return res.status(404).json({ error: 'Client agent not found' });
    }

    try {
      // Write a .deactivated marker file — adapter skips these
      fs.writeFileSync(path.join(agentDir, '.deactivated'), new Date().toISOString());

      // Remove from openclaw.json agents list
      _unregisterFromConfig(id);
      if (typeof setOrgChartCache === 'function') setOrgChartCache(null);
      try { syncAgents(db, adapter); } catch { /* */ }
      scheduleGatewayRestart();

      logAudit(db, {
        actor: resolveActor(req),
        action: 'agent.deactivate',
        target: id,
        detail: {},
        ip: req.ip,
      });

      logActivity(null, 'dashboard', 'agent_deactivated', `Custom agent "${id}" deactivated`);
      res.json({ ok: true, message: 'Agent deactivated' });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/agents/:id/trash — move client agent to trash (48h before permanent delete)
  app.post('/api/agents/:id/trash', (req, res) => {
    const { id } = req.params;
    if (!VALID_AGENT_ID.test(id)) return res.status(400).json({ error: 'Invalid agent ID' });
    const agentDir = path.join(P.CLIENT_AGENTS_DIR, id);

    if (!fs.existsSync(agentDir)) {
      return res.status(404).json({ error: 'Client agent not found' });
    }
    if (fs.existsSync(path.join(agentDir, '.trashed'))) {
      return res.status(400).json({ error: 'Agent is already trashed' });
    }

    try {
      fs.writeFileSync(path.join(agentDir, '.trashed'), new Date().toISOString());
      // Remove .deactivated if present (trash supersedes deactivate)
      try { fs.unlinkSync(path.join(agentDir, '.deactivated')); } catch { /* */ }
      // Remove from openclaw.json so agent is fully inactive (no chat, no crons, no tasks)
      _unregisterFromConfig(id);
      if (typeof setOrgChartCache === 'function') setOrgChartCache(null);
      try { syncAgents(db, adapter); } catch { /* */ }
      scheduleGatewayRestart();

      logAudit(db, {
        actor: resolveActor(req),
        action: 'agent.trash',
        target: id,
        detail: {},
        ip: req.ip,
      });

      logActivity(null, 'dashboard', 'agent_trashed', `Custom agent "${id}" moved to trash`);
      res.json({ ok: true, message: 'Agent moved to trash. You can delete permanently after 48 hours.' });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/agents/:id/restore — restore a trashed agent
  app.post('/api/agents/:id/restore', (req, res) => {
    const { id } = req.params;
    if (!VALID_AGENT_ID.test(id)) return res.status(400).json({ error: 'Invalid agent ID' });
    const agentDir = path.join(P.CLIENT_AGENTS_DIR, id);
    const marker = path.join(agentDir, '.trashed');

    if (!fs.existsSync(agentDir)) {
      return res.status(404).json({ error: 'Client agent not found' });
    }
    if (!fs.existsSync(marker)) {
      return res.status(400).json({ error: 'Agent is not trashed' });
    }

    try {
      fs.unlinkSync(marker);
      // Re-register in openclaw.json so agent is active again
      const soulPath = path.join(agentDir, 'SOUL.md');
      let name = id;
      try {
        const first = fs.readFileSync(soulPath, 'utf8').split('\n')[0] || '';
        name = first.replace(/^#\s*/, '').trim() || id;
      } catch { /* use id */ }
      _registerInConfig(id, name, agentDir);
      if (typeof setOrgChartCache === 'function') setOrgChartCache(null);
      try { syncAgents(db, adapter); } catch { /* */ }
      scheduleGatewayRestart();

      logAudit(db, {
        actor: resolveActor(req),
        action: 'agent.restore',
        target: id,
        detail: {},
        ip: req.ip,
      });

      logActivity(null, 'dashboard', 'agent_restored', `Custom agent "${id}" restored from trash`);
      res.json({ ok: true, message: 'Agent restored — your AI system is restarting (~10s)' });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // DELETE /api/agents/:id — permanently delete a trashed agent (48h minimum)
  app.delete('/api/agents/:id', (req, res) => {
    const { id } = req.params;
    if (!VALID_AGENT_ID.test(id)) return res.status(400).json({ error: 'Invalid agent ID' });
    const agentDir = path.join(P.CLIENT_AGENTS_DIR, id);
    const marker = path.join(agentDir, '.trashed');

    if (!fs.existsSync(agentDir)) {
      return res.status(404).json({ error: 'Client agent not found' });
    }
    if (!fs.existsSync(marker)) {
      return res.status(400).json({ error: 'Agent must be trashed before it can be deleted' });
    }

    // Check 48h cooldown
    const trashedAt = new Date(fs.readFileSync(marker, 'utf8').trim());
    const hoursElapsed = (Date.now() - trashedAt.getTime()) / (1000 * 60 * 60);
    if (hoursElapsed < 48) {
      const remaining = Math.ceil(48 - hoursElapsed);
      return res.status(400).json({ error: `Cannot delete yet. ${remaining} hours remaining.` });
    }

    try {
      // Delete crons assigned to this agent
      let deletedCrons = 0;
      try {
        const allCrons = adapter.getCronJobs ? adapter.getCronJobs() : [];
        const agentCrons = allCrons.filter(c => c.agentId === id);
        for (const cron of agentCrons) {
          try {
            execFileSync('/opt/homebrew/bin/openclaw', ['cron', 'remove', cron.id],
              { timeout: 10000, env: P.SUBPROCESS_ENV });
            deletedCrons++;
            logActivity(null, 'dashboard', 'cron_deleted', `Cron "${cron.name || cron.id}" removed (agent "${id}" deleted)`);
          } catch { /* best effort */ }
        }
      } catch { /* */ }

      // Refresh cron cache after deletions
      if (deletedCrons > 0) {
        try { const fresh = adapter.getCronJobs(); setCronJobsCache(fresh.length > 0 ? fresh : []); } catch { /* */ }
      }

      // Unassign tasks (set assigned_agent to empty, keep tasks intact)
      const unassigned = db.prepare(
        "UPDATE tasks SET assigned_agent='', updated_at=datetime('now') WHERE assigned_agent=? AND status NOT IN ('done','cancelled')"
      ).run(id);

      // Remove from openclaw.json (may already be removed from trash step)
      _unregisterFromConfig(id);
      // Delete workspace directory
      fs.rmSync(agentDir, { recursive: true, force: true });
      if (typeof setOrgChartCache === 'function') setOrgChartCache(null);
      try { syncAgents(db, adapter); } catch { /* */ }
      scheduleGatewayRestart();

      logAudit(db, {
        actor: resolveActor(req),
        action: 'agent.delete',
        target: id,
        detail: { deletedCrons, unassignedTasks: unassigned.changes },
        ip: req.ip,
      });

      logActivity(null, 'dashboard', 'agent_deleted', `Custom agent "${id}" permanently deleted (${deletedCrons} crons removed, ${unassigned.changes} tasks unassigned)`);
      res.json({ ok: true, message: 'Agent permanently deleted' });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/agents/:id/reactivate — reactivate a deactivated client agent
  app.post('/api/agents/:id/reactivate', (req, res) => {
    const { id } = req.params;
    if (!VALID_AGENT_ID.test(id)) return res.status(400).json({ error: 'Invalid agent ID' });
    const agentDir = path.join(P.CLIENT_AGENTS_DIR, id);
    const marker = path.join(agentDir, '.deactivated');

    if (!fs.existsSync(agentDir)) {
      return res.status(404).json({ error: 'Client agent not found' });
    }
    if (!fs.existsSync(marker)) {
      return res.status(400).json({ error: 'Agent is already active' });
    }

    try {
      fs.unlinkSync(marker);

      const soulPath = path.join(agentDir, 'SOUL.md');
      let name = id;
      if (fs.existsSync(soulPath)) {
        const first = fs.readFileSync(soulPath, 'utf8').split('\n')[0] || '';
        name = first.replace(/^#\s*/, '').trim() || id;
      }
      _registerInConfig(id, name, agentDir);
      if (typeof setOrgChartCache === 'function') setOrgChartCache(null);
      try { syncAgents(db, adapter); } catch { /* */ }
      scheduleGatewayRestart();

      logAudit(db, {
        actor: resolveActor(req),
        action: 'agent.reactivate',
        target: id,
        detail: {},
        ip: req.ip,
      });

      logActivity(null, 'dashboard', 'agent_reactivated', `Custom agent "${id}" reactivated`);
      res.json({ ok: true, message: 'Agent reactivated' });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
};

// ─── OpenClaw Config Registration ──────────────────────────────────

function _registerInConfig(id, name, workspace, commandCentre) {
  try {
    const cfg = JSON.parse(fs.readFileSync(P.OPENCLAW_CONFIG, 'utf8'));
    if (!cfg.agents) cfg.agents = {};
    if (!cfg.agents.list) cfg.agents.list = [];

    // Don't duplicate
    const existing = cfg.agents.list.findIndex(a => a.id === id);
    if (existing >= 0) return;

    cfg.agents.list.push({
      id,
      name: id,
      workspace,
      model: cfg.agents?.defaults?.model || { primary: 'anthropic/claude-haiku-4-5-20251001' },
      tools: { profile: 'full' },
    });

    fs.writeFileSync(P.OPENCLAW_CONFIG, JSON.stringify(cfg, null, 2));
  } catch (e) {
    console.error('[client-agents] Failed to register in openclaw.json:', e.message);
  }
}

function _unregisterFromConfig(id) {
  try {
    const cfg = JSON.parse(fs.readFileSync(P.OPENCLAW_CONFIG, 'utf8'));
    if (!cfg.agents?.list) return;
    cfg.agents.list = cfg.agents.list.filter(a => a.id !== id);
    fs.writeFileSync(P.OPENCLAW_CONFIG, JSON.stringify(cfg, null, 2));
  } catch (e) {
    console.error('[client-agents] Failed to unregister from openclaw.json:', e.message);
  }
}
