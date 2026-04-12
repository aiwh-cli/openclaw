// ─── Routes: Exec Approvals (proxy to gateway RPC) ──────────
const fs = require('fs');
const path = require('path');

const CLIENT_ROOT = process.env.CLIENT_ROOT || '/opt/AIWH/client';
const AUDIT_LOG = path.join(CLIENT_ROOT, 'logs', 'security-audit.jsonl');

function auditLog(action, detail) {
  try {
    const entry = JSON.stringify({
      timestamp: new Date().toISOString(),
      agent_id: 'dashboard', tool: 'dashboard',
      action, target_path: 'exec-approvals.json',
      outcome: 'policy_changed', detail,
    });
    fs.appendFileSync(AUDIT_LOG, entry + '\n');
  } catch { /* non-fatal */ }
}

module.exports = function(app) {

  // Fetch current exec-approvals snapshot from gateway
  app.get('/api/security/exec-approvals', async (req, res) => {
    try {
      const { client: gateway } = require('../gateway-ws');
      const result = await gateway.request('exec.approvals.get', {}, 8000);
      res.json(result);
    } catch (e) {
      if (e.message?.includes('not connected') || e.message?.includes('timeout')) {
        return res.status(502).json({ error: 'Gateway not connected' });
      }
      res.status(500).json({ error: e.message });
    }
  });

  // Update full exec-approvals config via gateway
  app.put('/api/security/exec-approvals', async (req, res) => {
    const { file, baseHash, _audit_detail } = req.body;
    if (!file || !baseHash) return res.status(400).json({ error: 'file and baseHash required' });
    try {
      const { client: gateway } = require('../gateway-ws');
      const result = await gateway.request('exec.approvals.set', { file, baseHash }, 15000);
      auditLog('exec_approvals_update', _audit_detail || 'Exec approvals config updated');
      res.json(result);
    } catch (e) {
      if (e.message?.includes('changed') || e.message?.includes('hash')) {
        return res.status(409).json({ error: 'Config changed since last load. Please refresh.' });
      }
      res.status(500).json({ error: e.message });
    }
  });

  // Convenience: add a single pattern to an agent's allowlist
  app.post('/api/security/exec-approvals/pattern', async (req, res) => {
    const { agentId, pattern, baseHash } = req.body;
    if (!agentId || !pattern || !baseHash) {
      return res.status(400).json({ error: 'agentId, pattern, and baseHash required' });
    }
    try {
      const { client: gateway } = require('../gateway-ws');
      const snap = await gateway.request('exec.approvals.get', {}, 8000);
      if (snap.hash && snap.hash !== baseHash) {
        return res.status(409).json({ error: 'Config changed since last load. Please refresh.' });
      }
      const file = snap.file || { version: 1 };
      if (!file.agents) file.agents = {};
      if (!file.agents[agentId]) file.agents[agentId] = { allowlist: [] };
      if (!file.agents[agentId].allowlist) file.agents[agentId].allowlist = [];
      const { randomUUID } = require('crypto');
      file.agents[agentId].allowlist.push({ id: randomUUID(), pattern });
      const result = await gateway.request('exec.approvals.set', { file, baseHash: snap.hash }, 15000);
      auditLog('exec_approvals_pattern_add', `Added pattern "${pattern}" for agent "${agentId}"`);
      res.json(result);
    } catch (e) {
      if (e.message?.includes('changed') || e.message?.includes('hash')) {
        return res.status(409).json({ error: 'Config changed. Please refresh.' });
      }
      res.status(500).json({ error: e.message });
    }
  });

  // Convenience: remove a pattern by ID from an agent's allowlist
  app.delete('/api/security/exec-approvals/pattern', async (req, res) => {
    const { agentId, patternId, baseHash } = req.body;
    if (!agentId || !patternId || !baseHash) {
      return res.status(400).json({ error: 'agentId, patternId, and baseHash required' });
    }
    try {
      const { client: gateway } = require('../gateway-ws');
      const snap = await gateway.request('exec.approvals.get', {}, 8000);
      if (snap.hash && snap.hash !== baseHash) {
        return res.status(409).json({ error: 'Config changed since last load. Please refresh.' });
      }
      const file = snap.file || { version: 1 };
      const agent = file.agents?.[agentId];
      if (!agent?.allowlist) return res.status(404).json({ error: 'Agent or allowlist not found' });
      const removed = agent.allowlist.find(e => e.id === patternId);
      agent.allowlist = agent.allowlist.filter(e => e.id !== patternId);
      const result = await gateway.request('exec.approvals.set', { file, baseHash: snap.hash }, 15000);
      auditLog('exec_approvals_pattern_remove', `Removed pattern "${removed?.pattern || patternId}" from agent "${agentId}"`);
      res.json(result);
    } catch (e) {
      if (e.message?.includes('changed') || e.message?.includes('hash')) {
        return res.status(409).json({ error: 'Config changed. Please refresh.' });
      }
      res.status(500).json({ error: e.message });
    }
  });

}; // end module.exports
