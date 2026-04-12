// ─── TOOLS.md Auto-Updater (Theme AB.4 → AB.5) ──────────────
// When a connector is connected/disconnected, updates ALL assigned
// agents' TOOLS.md files with MCP tool documentation. Supports
// many-to-many: one connector can serve multiple agents.
//
// Marker format:
//   <!-- CONNECTOR:stripe -->
//   ## Stripe (MCP Connector)
//   ...
//   <!-- /CONNECTOR:stripe -->

const fs = require('fs');
const path = require('path');
const P = require('./paths');

// ─── Workspace resolution ───────────────────────────────────

/**
 * Read openclaw.json agent list and return a map of agentId → workspace path.
 */
function getAgentWorkspaces() {
  try {
    const config = JSON.parse(fs.readFileSync(P.OPENCLAW_CONFIG, 'utf8'));
    const agents = (config.agents || {}).list || [];
    const map = {};
    for (const a of agents) {
      if (a.id && a.workspace) map[a.id] = a.workspace;
    }
    return map;
  } catch {
    return {};
  }
}

/**
 * Resolve agent IDs from a catalogue entry.
 * Supports both new `agents` (array) and legacy `agent` (string) fields.
 * @param {object} entry — Catalogue entry
 * @returns {string[]} Array of agent IDs
 */
function resolveAgents(entry) {
  if (Array.isArray(entry.agents) && entry.agents.length > 0) {
    return entry.agents.filter(a => typeof a === 'string' && a.length > 0);
  }
  if (typeof entry.agent === 'string' && entry.agent.length > 0) {
    return [entry.agent];
  }
  return [];
}

// ─── Section generation ─────────────────────────────────────

/**
 * Generate a TOOLS.md documentation section for a connected MCP connector.
 *
 * @param {string} id — Connector ID (e.g. "stripe")
 * @param {object} entry — Catalogue entry from mcporter-catalogue.json
 * @returns {string} Markdown section with connector markers
 */
function generateConnectorSection(id, entry) {
  const name = sanitizeField(entry.name || id.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '));
  const desc = sanitizeField(entry.description || '');

  const lines = [
    `<!-- CONNECTOR:${id} -->`,
    `### ${name} — ${desc}`,
    `MCP server \`aiwh-${id}\`. Tools available via gateway — auto-managed, removed on disconnect.`,
    `<!-- /CONNECTOR:${id} -->`,
  ];

  return lines.join('\n');
}

// ─── TOOLS.md read/write ────────────────────────────────────

const START_MARKER = (id) => `<!-- CONNECTOR:${id} -->`;
const END_MARKER = (id) => `<!-- /CONNECTOR:${id} -->`;

/**
 * Remove a connector section from TOOLS.md content.
 * Returns the cleaned content string.
 */
function removeConnectorSection(content, connectorId) {
  const start = START_MARKER(connectorId);
  const end = END_MARKER(connectorId);
  const startIdx = content.indexOf(start);
  if (startIdx === -1) return content;

  const endIdx = content.indexOf(end, startIdx);
  if (endIdx === -1) return content;

  const before = content.substring(0, startIdx).replace(/\n+$/, '\n');
  const after = content.substring(endIdx + end.length).replace(/^\n+/, '\n');

  return (before + after).replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/**
 * Add a connector section to TOOLS.md content.
 * Removes any existing section for this connector first, then appends.
 */
function addConnectorSection(content, connectorId, section) {
  // Remove existing section if present (idempotent)
  let cleaned = removeConnectorSection(content, connectorId);

  // Append new section at the end
  if (!cleaned.endsWith('\n')) cleaned += '\n';
  cleaned += '\n' + section + '\n';

  return cleaned;
}

// ─── Security helpers ───────────────────────────────────────

const AIWH_ROOT = process.env.AIWH_CORE_ROOT
  ? path.resolve(process.env.AIWH_CORE_ROOT, '..')
  : '/opt/AIWH';

/** Validate that a resolved path falls within /opt/AIWH/ */
function isPathSafe(filePath) {
  const resolved = path.resolve(filePath);
  return resolved.startsWith(AIWH_ROOT + path.sep) || resolved === AIWH_ROOT;
}

/** Strip HTML comment markers from a string to prevent marker spoofing */
function sanitizeField(str) {
  return (str || '').replace(/<!-{2,}/g, '').replace(/-{2,}>/g, '');
}

// ─── Internal helpers ───────────────────────────────────────

/**
 * Write a connector section to a single agent's TOOLS.md.
 * @returns {{ ok: boolean, error?: string }}
 */
function _writeSection(agentId, connectorId, section, workspaces) {
  const workspace = workspaces[agentId];
  if (!workspace) return { ok: false, error: `Agent ${agentId} workspace not found` };

  const toolsPath = path.join(workspace, 'TOOLS.md');
  if (!isPathSafe(toolsPath)) return { ok: false, error: `Path outside allowed scope: ${workspace}` };

  let content = '';
  try { content = fs.readFileSync(toolsPath, 'utf8'); } catch { /* file may not exist */ }

  const updated = addConnectorSection(content, connectorId, section);
  fs.writeFileSync(toolsPath, updated);
  return { ok: true };
}

/**
 * Remove a connector section from a single agent's TOOLS.md.
 * @returns {{ ok: boolean, error?: string }}
 */
function _removeSection(agentId, connectorId, workspaces) {
  const workspace = workspaces[agentId];
  if (!workspace) return { ok: false, error: `Agent ${agentId} workspace not found` };

  const toolsPath = path.join(workspace, 'TOOLS.md');
  if (!isPathSafe(toolsPath)) return { ok: false, error: `Path outside allowed scope: ${workspace}` };

  let content = '';
  try { content = fs.readFileSync(toolsPath, 'utf8'); } catch { return { ok: true }; }

  if (!content.includes(START_MARKER(connectorId))) return { ok: true };

  const updated = removeConnectorSection(content, connectorId);
  fs.writeFileSync(toolsPath, updated);
  return { ok: true };
}

// ─── Public API ─────────────────────────────────────────────

/**
 * Update TOOLS.md for ALL agents assigned to a connector after connection.
 *
 * @param {string} connectorId — e.g. "stripe"
 * @param {object} catalogueEntry — Full catalogue entry for this connector
 * @returns {{ ok: boolean, agents?: string[], errors?: string[] }}
 */
function onConnectorConnected(connectorId, catalogueEntry) {
  try {
    const agentIds = resolveAgents(catalogueEntry);
    if (agentIds.length === 0) {
      return { ok: false, errors: [`No agent mapping for connector ${connectorId}`] };
    }

    const workspaces = getAgentWorkspaces();
    const section = generateConnectorSection(connectorId, catalogueEntry);
    const updated = [];
    const errors = [];

    for (const agentId of agentIds) {
      const result = _writeSection(agentId, connectorId, section, workspaces);
      if (result.ok) {
        updated.push(agentId);
      } else {
        errors.push(`${agentId}: ${result.error}`);
      }
    }

    if (updated.length > 0) {
      console.log(`[tools-updater] Added ${connectorId} section to ${updated.length} agents: ${updated.join(', ')}`);
    }
    if (errors.length > 0) {
      console.warn(`[tools-updater] Errors adding ${connectorId}:`, errors.join('; '));
    }

    return { ok: updated.length > 0, agents: updated, errors: errors.length > 0 ? errors : undefined };
  } catch (e) {
    console.error(`[tools-updater] Failed to update on connect ${connectorId}:`, e.message);
    return { ok: false, errors: [e.message] };
  }
}

/**
 * Remove connector documentation from ALL assigned agents' TOOLS.md after disconnection.
 *
 * @param {string} connectorId — e.g. "stripe"
 * @param {object} catalogueEntry — Full catalogue entry (needed for agent mapping)
 * @returns {{ ok: boolean, agents?: string[], errors?: string[] }}
 */
function onConnectorDisconnected(connectorId, catalogueEntry) {
  try {
    const agentIds = resolveAgents(catalogueEntry || {});
    if (agentIds.length === 0) {
      return { ok: false, errors: [`No agent mapping for connector ${connectorId}`] };
    }

    const workspaces = getAgentWorkspaces();
    const removed = [];
    const errors = [];

    for (const agentId of agentIds) {
      const result = _removeSection(agentId, connectorId, workspaces);
      if (result.ok) {
        removed.push(agentId);
      } else {
        errors.push(`${agentId}: ${result.error}`);
      }
    }

    if (removed.length > 0) {
      console.log(`[tools-updater] Removed ${connectorId} section from ${removed.length} agents: ${removed.join(', ')}`);
    }

    return { ok: removed.length > 0, agents: removed, errors: errors.length > 0 ? errors : undefined };
  } catch (e) {
    console.error(`[tools-updater] Failed to update on disconnect ${connectorId}:`, e.message);
    return { ok: false, errors: [e.message] };
  }
}

/**
 * Sync all connector sections in agent TOOLS.md files.
 * Called on dashboard startup to ensure TOOLS.md reflects actual connector state.
 *
 * - Adds sections for connected connectors missing from TOOLS.md
 * - Removes sections for disconnected connectors still in TOOLS.md
 *
 * @returns {{ ok: boolean, added: string[], removed: string[] }}
 */
function syncAllToolsSections() {
  const added = [];
  const removed = [];

  try {
    const catalogue = P.getCatalogues().mcporterCatalogue || {};
    const servers = catalogue.mcpServers || {};

    // Load active connectors
    let active = {};
    try {
      const raw = JSON.parse(fs.readFileSync(P.MCPORTER_ACTIVE, 'utf8'));
      active = raw.mcpServers || {};
    } catch { /* no active file */ }

    const workspaces = getAgentWorkspaces();

    // Group connectors by agent (many-to-many)
    const byAgent = {};
    for (const [id, entry] of Object.entries(servers)) {
      const agentIds = resolveAgents(entry);
      for (const agentId of agentIds) {
        if (!byAgent[agentId]) byAgent[agentId] = [];
        byAgent[agentId].push({ id, entry });
      }
    }

    // Process each agent
    for (const [agentId, connectors] of Object.entries(byAgent)) {
      const workspace = workspaces[agentId];
      if (!workspace) continue;

      const toolsPath = path.join(workspace, 'TOOLS.md');
      if (!isPathSafe(toolsPath)) continue;
      let content = '';
      try { content = fs.readFileSync(toolsPath, 'utf8'); } catch { continue; }

      let changed = false;

      for (const { id, entry } of connectors) {
        const isConnected = !!active[id]?.enabled;
        const hasSection = content.includes(START_MARKER(id));

        if (isConnected && !hasSection) {
          // Add missing section
          const section = generateConnectorSection(id, entry);
          content = addConnectorSection(content, id, section);
          added.push(`${id} → ${agentId}`);
          changed = true;
        } else if (!isConnected && hasSection) {
          // Remove stale section
          content = removeConnectorSection(content, id);
          removed.push(`${id} → ${agentId}`);
          changed = true;
        }
      }

      if (changed) {
        fs.writeFileSync(toolsPath, content);
      }
    }

    if (added.length || removed.length) {
      console.log(`[tools-updater] Sync: added ${added.length}, removed ${removed.length}`);
    }

    return { ok: true, added, removed };
  } catch (e) {
    console.error('[tools-updater] Sync failed:', e.message);
    return { ok: false, added, removed };
  }
}

module.exports = {
  onConnectorConnected,
  onConnectorDisconnected,
  syncAllToolsSections,
  // Exported for testing
  generateConnectorSection,
  removeConnectorSection,
  addConnectorSection,
  resolveAgents,
};
