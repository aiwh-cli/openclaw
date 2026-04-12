// ─── Connector Management Routes (Theme AB.2.9) ────────────────────
// CRUD for connector activation. Merges embedded catalogue with client
// mcporter-active.json. Stores credentials in secrets.enc via secrets.py.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { logAudit, resolveActor } = require('../helpers/audit');
const P = require('../helpers/paths');
const { registerMcpServer, unregisterMcpServer, syncAllMcpServers, scheduleGatewayReload } = require('../helpers/mcp-wiring');
const { onConnectorConnected, onConnectorDisconnected, syncAllToolsSections, resolveAgents } = require('../helpers/tools-updater');

// Connector ID validation — alphanumeric + hyphens, max 64 chars
const VALID_ID = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/;

function loadActive() {
  try {
    return JSON.parse(fs.readFileSync(P.MCPORTER_ACTIVE, 'utf8'));
  } catch {
    return { mcpServers: {} };
  }
}

function saveActive(data) {
  fs.writeFileSync(P.MCPORTER_ACTIVE, JSON.stringify(data, null, 2));
}

function secretsCmd(action, ...args) {
  const secretsScript = path.join(P.SCRIPTS_DIR, 'lib', 'secrets.py');
  // For 'store' command, pass value via stdin to avoid ps aux exposure
  if (action === 'store' && args.length === 2) {
    const [key, value] = args;
    return execFileSync('python3', [secretsScript, 'store-stdin', key], {
      input: value,
      env: P.SUBPROCESS_ENV,
      timeout: 10000,
      encoding: 'utf8',
    }).trim();
  }
  return execFileSync('python3', [secretsScript, action, ...args], {
    env: P.SUBPROCESS_ENV,
    timeout: 10000,
    encoding: 'utf8',
  }).trim();
}

// Auto-detect existing secrets that match catalogue entries on first load
function autoDetectExisting() {
  try {
    const catalogue = P.getCatalogues().mcporterCatalogue || {};
    const servers = catalogue.mcpServers || {};
    const active = loadActive();
    let changed = false;

    // List all stored secret names
    let storedKeys = [];
    try {
      const out = execFileSync('python3', [
        path.join(P.SCRIPTS_DIR, 'lib', 'secrets.py'), 'list',
      ], { env: P.SUBPROCESS_ENV, timeout: 10000, encoding: 'utf8' });
      storedKeys = out.split('\n').map(l => l.trim()).filter(Boolean);
    } catch { return; }

    for (const [id, entry] of Object.entries(servers)) {
      if (active.mcpServers[id]?.enabled) continue; // Already connected
      const envKeys = Object.keys(entry.env || {});
      if (envKeys.length === 0) continue;
      // Check if ALL required env keys exist in secrets store
      const allPresent = envKeys.every(k => storedKeys.includes(k));
      if (!allPresent) continue;
      // Auto-connect: map each env key directly (no prefix since they're already stored)
      const credRefs = {};
      for (const k of envKeys) { credRefs[k] = k; }
      active.mcpServers[id] = { enabled: true, credential_refs: credRefs };
      changed = true;
    }

    if (changed) saveActive(active);
  } catch (e) {
    console.warn('[connectors] Auto-detect failed:', e.message);
  }
}

module.exports = function (app, deps) {
  const { db } = deps;

  // Run auto-detection once on first route registration
  autoDetectExisting();

  // Sync MCP server entries in openclaw.json for all active connectors
  const syncResult = syncAllMcpServers();
  if (syncResult.changed) scheduleGatewayReload();

  // Sync TOOLS.md connector sections to match active connector state
  syncAllToolsSections();

  // GET /api/connectors — merged catalogue + active state
  app.get('/api/connectors', (req, res) => {
    try {
      const catalogue = P.getCatalogues().mcporterCatalogue || {};
      const servers = catalogue.mcpServers || {};
      const active = loadActive();
      const activeServers = active.mcpServers || {};

      const merged = Object.entries(servers).map(([id, entry]) => {
        const act = activeServers[id] || {};
        const envKeys = Object.keys(entry.env || {});
        const agents = resolveAgents(entry);
        return {
          id,
          name: entry.name || id.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
          description: entry.description || '',
          agents,
          module: entry.module || '',
          category: entry.category || 'other',
          priority: entry.priority || 'P2',
          authType: entry.authType || 'apikey',
          verified: entry.verified || false,
          docs_url: entry.docs_url || '',
          notes: entry.notes || '',
          credentials_required: envKeys,
          credential_hints: entry.credential_hints || {},
          connected: !!act.enabled,
          has_credentials: envKeys.length === 0 || envKeys.every(k =>
            act.credential_refs && act.credential_refs[k]
          ),
        };
      });

      res.json({ connectors: merged });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/connectors/:id/connect — store credentials + activate
  app.post('/api/connectors/:id/connect', (req, res) => {
    const { id } = req.params;
    if (!VALID_ID.test(id)) return res.status(400).json({ error: 'Invalid connector ID' });

    try {
      const catalogue = P.getCatalogues().mcporterCatalogue || {};
      const entry = (catalogue.mcpServers || {})[id];
      if (!entry) return res.status(404).json({ error: 'Connector not found in catalogue' });

      const { credentials } = req.body;
      if (!credentials || typeof credentials !== 'object') {
        return res.status(400).json({ error: 'Missing credentials object' });
      }

      const envKeys = Object.keys(entry.env || {});
      // Validate credential values
      for (const [k, v] of Object.entries(credentials)) {
        if (typeof v !== 'string' || v.length > 4096) {
          return res.status(400).json({ error: `Credential value for ${k} is too long (max 4096 chars)` });
        }
      }
      const missing = envKeys.filter(k => !credentials[k] || !credentials[k].trim());
      if (missing.length > 0) {
        return res.status(400).json({ error: `Missing credentials: ${missing.join(', ')}` });
      }

      // Store each credential in secrets.enc under its original env key name.
      // No connector-ID prefix — env keys are already unique by convention
      // and direct storage matches auto-detect format (see autoDetectExisting).
      const credRefs = {};
      for (const [key, value] of Object.entries(credentials)) {
        if (!envKeys.includes(key)) continue; // Only accept known keys
        secretsCmd('store', key, value.trim());
        // Inject into gateway plist so env var is available for SecretRef resolution
        P.injectSecretsIntoGatewayPlist({ [key]: value.trim() });
        credRefs[key] = key;
      }

      // Update mcporter-active.json
      const active = loadActive();
      active.mcpServers[id] = { enabled: true, credential_refs: credRefs };
      saveActive(active);

      // Register MCP server in openclaw.json + schedule gateway reload
      const mcpResult = registerMcpServer(id, entry, credRefs);
      if (mcpResult.ok) {
        scheduleGatewayReload();
      }

      // Update ALL assigned agents' TOOLS.md with connector documentation
      const toolsResult = onConnectorConnected(id, entry);

      logAudit(db, {
        actor: resolveActor(req),
        action: 'connector.connect',
        target: id,
        detail: { credentials_stored: Object.keys(credRefs), mcp_registered: mcpResult.ok, tools_updated: toolsResult.ok, tools_agents: toolsResult.agents || [] },
        ip: req.ip,
      });

      res.json({ ok: true, message: `Connected successfully`, mcp: mcpResult.ok });
    } catch (e) {
      logAudit(db, {
        actor: resolveActor(req),
        action: 'connector.connect',
        target: id,
        detail: { error: e.message },
        result: 'error',
        ip: req.ip,
      });
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/connectors/:id/disconnect — remove credentials + deactivate
  app.post('/api/connectors/:id/disconnect', (req, res) => {
    const { id } = req.params;
    if (!VALID_ID.test(id)) return res.status(400).json({ error: 'Invalid connector ID' });

    try {
      const active = loadActive();
      const entry = (active.mcpServers || {})[id];
      if (!entry) return res.status(404).json({ error: 'Connector not active' });

      // Delete credentials from secrets.enc
      if (entry.credential_refs) {
        for (const refKey of Object.values(entry.credential_refs)) {
          try { secretsCmd('delete', refKey); } catch { /* key may not exist */ }
        }
      }

      // Remove from mcporter-active.json
      delete active.mcpServers[id];
      saveActive(active);

      // Unregister MCP server from openclaw.json + schedule gateway reload
      const mcpResult = unregisterMcpServer(id);
      if (mcpResult.ok) {
        scheduleGatewayReload();
      }

      // Remove connector documentation from ALL assigned agents' TOOLS.md
      const catalogue = P.getCatalogues().mcporterCatalogue || {};
      const catEntry = (catalogue.mcpServers || {})[id];
      const toolsResult = onConnectorDisconnected(id, catEntry);

      logAudit(db, {
        actor: resolveActor(req),
        action: 'connector.disconnect',
        target: id,
        detail: { mcp_unregistered: mcpResult.ok, tools_updated: toolsResult.ok, tools_agents: toolsResult.agents || [] },
        ip: req.ip,
      });

      res.json({ ok: true, message: `Disconnected successfully` });
    } catch (e) {
      logAudit(db, {
        actor: resolveActor(req),
        action: 'connector.disconnect',
        target: id,
        detail: { error: e.message },
        result: 'error',
        ip: req.ip,
      });
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/connectors/:id/test — test MCP connection
  app.get('/api/connectors/:id/test', (req, res) => {
    const { id } = req.params;
    if (!VALID_ID.test(id)) return res.status(400).json({ error: 'Invalid connector ID' });

    try {
      const active = loadActive();
      const entry = (active.mcpServers || {})[id];
      if (!entry || !entry.enabled) {
        return res.json({ ok: false, message: 'Connector not connected' });
      }

      // Load credentials from secrets.enc
      const catalogue = P.getCatalogues().mcporterCatalogue || {};
      const catEntry = (catalogue.mcpServers || {})[id];
      if (!catEntry) return res.json({ ok: false, message: 'Connector not in catalogue' });

      const envKeys = Object.keys(catEntry.env || {});
      let allPresent = true;
      for (const key of envKeys) {
        const refKey = entry.credential_refs?.[key];
        if (!refKey) { allPresent = false; break; }
        try {
          const out = secretsCmd('load', refKey);
          if (!out || out.includes('not found')) { allPresent = false; break; }
        } catch { allPresent = false; break; }
      }

      if (!allPresent) {
        return res.json({ ok: false, message: 'Missing or invalid credentials' });
      }

      // Credentials exist and are readable — basic health check passed
      res.json({ ok: true, message: 'Credentials verified' });
    } catch (e) {
      res.json({ ok: false, message: e.message });
    }
  });
};
