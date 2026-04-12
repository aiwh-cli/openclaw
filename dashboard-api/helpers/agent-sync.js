// ─── Agent Discovery & Sync ─────────────────────────────────
const fs = require('fs');
const path = require('path');

// In-memory full agent data (includes sub-agents, workspace files)
let agentsFullCache = [];

function getAgentsCache() { return agentsFullCache; }

/**
 * Build agent alias map text block for injection into agent context.
 */
function buildAgentAliasMap(db) {
  const rows = db.prepare('SELECT id, display_name FROM agents WHERE display_name IS NOT NULL').all();
  const aliases = rows.filter(r => {
    const autoName = r.id.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return r.display_name && r.display_name !== autoName && r.display_name !== r.id;
  });
  if (!aliases.length) return '';
  const lines = aliases.map(r => `- "${r.display_name}" = ${r.id}`).join('\n');
  return `## Agent Aliases\nThe following agents have been given custom names. Use the agent ID (right side) when spawning or delegating.\n${lines}\n`;
}

function getAgentSessionStatus(agentId) {
  const sessDir = `/opt/AIWH/.openclaw/agents/${agentId}/sessions`;
  const sessFile = path.join(sessDir, 'sessions.json');
  try {
    if (!fs.existsSync(sessFile)) return { status: 'offline', lastActive: null };
    const sessions = JSON.parse(fs.readFileSync(sessFile, 'utf8'));
    let latest = 0;
    for (const v of Object.values(sessions)) {
      const ts = v.updatedAt || 0;
      if (ts > latest) latest = ts;
    }
    if (!latest) return { status: 'offline', lastActive: null };
    const lastActive = new Date(latest).toISOString();
    const ageMs = Date.now() - latest;
    const status = ageMs < 120000 ? 'active' : ageMs < 600000 ? 'recent' : 'idle';
    return { status, lastActive };
  } catch { return { status: 'idle', lastActive: null }; }
}

function syncAgents(db, adapter) {
  const agents = adapter.discoverAgents();
  agentsFullCache = agents;
  const upsert = db.prepare(`
    INSERT INTO agents (id, display_name, model, model_tier, workspace, command_centre, source, status, last_active_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      model=excluded.model,
      model_tier=excluded.model_tier, workspace=excluded.workspace,
      command_centre=excluded.command_centre, source=excluded.source, status=excluded.status,
      last_active_at=COALESCE(excluded.last_active_at, agents.last_active_at),
      updated_at=datetime('now')
  `);
  const tx = db.transaction(() => {
    for (const a of agents) {
      const sess = getAgentSessionStatus(a.id);
      upsert.run(a.id, a.displayName, a.model, a.modelTier, a.workspace, a.commandCentre || '', a.source || 'product', sess.status, sess.lastActive);
    }
    // Remove DB rows for agents no longer discovered (trashed/deactivated/deleted)
    const discoveredIds = new Set(agents.map(a => a.id));
    const dbAgents = db.prepare('SELECT id FROM agents').all();
    const del = db.prepare('DELETE FROM agents WHERE id=?');
    for (const row of dbAgents) {
      if (!discoveredIds.has(row.id)) del.run(row.id);
    }
  });
  tx();
  return agents;
}

module.exports = { getAgentsCache, buildAgentAliasMap, getAgentSessionStatus, syncAgents };
