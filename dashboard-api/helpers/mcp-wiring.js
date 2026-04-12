// ─── MCP Wiring Helper (Theme AB.3) ─────────────────────────
// Registers/unregisters MCP servers in openclaw.json when
// connectors are connected/disconnected. Resolves credentials
// from secrets.enc and triggers debounced gateway reload.

const fs = require('fs');
const { execFileSync } = require('child_process');
const P = require('./paths');

const OPENCLAW_BIN = '/opt/homebrew/bin/openclaw';
const DOCKER_BIN = '/opt/homebrew/bin/docker';

// ─── openclaw.json read/write ────────────────────────────────

function readOpenClawConfig() {
  return JSON.parse(fs.readFileSync(P.OPENCLAW_CONFIG, 'utf8'));
}

function writeOpenClawConfig(config) {
  fs.writeFileSync(P.OPENCLAW_CONFIG, JSON.stringify(config, null, 2), { mode: 0o600 });
}

// ─── Credential resolution ───────────────────────────────────

/**
 * Load a single credential value from secrets.enc by its ref key.
 * Returns the value string, or empty string on failure.
 */
function loadCredential(refKey) {
  try {
    const secretsScript = require('path').join(P.SCRIPTS_DIR, 'lib', 'secrets.py');
    const out = execFileSync('python3', [secretsScript, 'load', refKey], {
      env: P.SUBPROCESS_ENV,
      timeout: 10000,
      encoding: 'utf8',
    });
    // Output format: export KEY='value' (key may be lowercase with hyphens)
    const m = out.match(/^export\s+[A-Za-z_][A-Za-z0-9_-]*='(.*)'\s*$/m);
    return m ? m[1] : '';
  } catch {
    return '';
  }
}

/**
 * Build the env object for an MCP server entry.
 * Maps catalogue env keys → resolved credential values from secrets.enc.
 */
function buildMcpEnv(catalogueEntry, credentialRefs) {
  const env = {};
  const envKeys = Object.keys(catalogueEntry.env || {});
  for (const key of envKeys) {
    const refKey = credentialRefs[key];
    if (!refKey) continue;
    const value = loadCredential(refKey);
    if (value) env[key] = value;
  }
  return env;
}

// ─── MCP server registration ────────────────────────────────

/**
 * Build an MCP server config entry from a catalogue entry.
 * Only includes fields OpenClaw recognises (command/args/env or url/transport/headers).
 */
function buildMcpServerConfig(catalogueEntry, resolvedEnv) {
  const config = {};

  // Stdio transport (command-based)
  if (catalogueEntry.command) {
    config.command = catalogueEntry.command;
    if (Array.isArray(catalogueEntry.args)) {
      config.args = catalogueEntry.args;
    }
  }

  // HTTP transport (url-based)
  if (catalogueEntry.url) {
    config.url = catalogueEntry.url;
  }
  if (catalogueEntry.transport) {
    config.transport = catalogueEntry.transport;
  }
  if (catalogueEntry.headers) {
    config.headers = catalogueEntry.headers;
  }

  // Environment variables with resolved credential values
  if (Object.keys(resolvedEnv).length > 0) {
    config.env = resolvedEnv;
  }

  // Connection timeout (30s default in OpenClaw, but set explicitly for clarity)
  if (catalogueEntry.connectionTimeoutMs) {
    config.connectionTimeoutMs = catalogueEntry.connectionTimeoutMs;
  }

  return config;
}

/**
 * Register an MCP server in openclaw.json for a connected connector.
 * Resolves credentials from secrets.enc and writes the config entry.
 *
 * @param {string} id — Connector ID (e.g. "stripe")
 * @param {object} catalogueEntry — From mcporter-catalogue.json
 * @param {object} credentialRefs — Map of env key → secret ref key
 * @returns {{ ok: boolean, error?: string }}
 */
function registerMcpServer(id, catalogueEntry, credentialRefs) {
  try {
    const resolvedEnv = buildMcpEnv(catalogueEntry, credentialRefs);
    const envKeys = Object.keys(catalogueEntry.env || {});
    const resolvedKeys = Object.keys(resolvedEnv);

    // Verify all required credentials were resolved
    if (envKeys.length > 0 && resolvedKeys.length < envKeys.length) {
      const missing = envKeys.filter(k => !resolvedEnv[k]);
      return { ok: false, error: `Missing credentials: ${missing.join(', ')}` };
    }

    const serverConfig = buildMcpServerConfig(catalogueEntry, resolvedEnv);
    const config = readOpenClawConfig();

    // Ensure mcp.servers section exists
    if (!config.mcp) config.mcp = {};
    if (!config.mcp.servers) config.mcp.servers = {};

    // Write the MCP server entry (prefixed to avoid collisions with built-in servers)
    const mcpKey = `aiwh-${id}`;
    config.mcp.servers[mcpKey] = serverConfig;
    writeOpenClawConfig(config);

    console.log(`[mcp-wiring] Registered MCP server: ${mcpKey}`);
    return { ok: true };
  } catch (e) {
    console.error(`[mcp-wiring] Failed to register ${id}:`, e.message);
    return { ok: false, error: e.message };
  }
}

/**
 * Unregister an MCP server from openclaw.json when a connector is disconnected.
 *
 * @param {string} id — Connector ID
 * @returns {{ ok: boolean, error?: string }}
 */
function unregisterMcpServer(id) {
  try {
    const config = readOpenClawConfig();
    const mcpKey = `aiwh-${id}`;

    if (config.mcp?.servers?.[mcpKey]) {
      delete config.mcp.servers[mcpKey];

      // Clean up empty mcp.servers / mcp objects
      if (Object.keys(config.mcp.servers).length === 0) {
        delete config.mcp.servers;
      }
      if (Object.keys(config.mcp).length === 0) {
        delete config.mcp;
      }

      writeOpenClawConfig(config);
      console.log(`[mcp-wiring] Unregistered MCP server: ${mcpKey}`);
    }

    return { ok: true };
  } catch (e) {
    console.error(`[mcp-wiring] Failed to unregister ${id}:`, e.message);
    return { ok: false, error: e.message };
  }
}

// ─── MCP sync (startup) ─────────────────────────────────────

/**
 * Sync all active connectors' MCP entries in openclaw.json.
 * - Adds missing entries for connected connectors
 * - Removes stale entries for disconnected connectors
 * Call this on dashboard startup.
 */
function syncAllMcpServers() {
  try {
    const catalogue = P.getCatalogues().mcporterCatalogue || {};
    const servers = catalogue.mcpServers || {};
    const active = loadActiveConfig();
    const activeServers = active.mcpServers || {};

    const config = readOpenClawConfig();
    if (!config.mcp) config.mcp = {};
    if (!config.mcp.servers) config.mcp.servers = {};

    let changed = false;

    // Add MCP entries for connected connectors that are missing
    for (const [id, activeEntry] of Object.entries(activeServers)) {
      if (!activeEntry.enabled) continue;
      const catEntry = servers[id];
      if (!catEntry) continue;

      const mcpKey = `aiwh-${id}`;
      if (config.mcp.servers[mcpKey]) continue; // Already registered

      const resolvedEnv = buildMcpEnv(catEntry, activeEntry.credential_refs || {});
      const envKeys = Object.keys(catEntry.env || {});
      if (envKeys.length > 0 && Object.keys(resolvedEnv).length < envKeys.length) {
        console.warn(`[mcp-wiring] Skipping ${id} — missing credentials`);
        continue;
      }

      config.mcp.servers[mcpKey] = buildMcpServerConfig(catEntry, resolvedEnv);
      console.log(`[mcp-wiring] Sync: registered ${mcpKey}`);
      changed = true;
    }

    // Remove stale MCP entries for disconnected connectors
    for (const mcpKey of Object.keys(config.mcp.servers)) {
      if (!mcpKey.startsWith('aiwh-')) continue; // Don't touch non-AIWH MCP servers
      const connectorId = mcpKey.slice(5); // Strip 'aiwh-' prefix
      if (!activeServers[connectorId]?.enabled) {
        delete config.mcp.servers[mcpKey];
        console.log(`[mcp-wiring] Sync: removed stale ${mcpKey}`);
        changed = true;
      }
    }

    // Clean up empty sections
    if (Object.keys(config.mcp.servers).length === 0) delete config.mcp.servers;
    if (Object.keys(config.mcp).length === 0) delete config.mcp;

    if (changed) {
      writeOpenClawConfig(config);
      console.log('[mcp-wiring] Sync complete — config updated');
    } else {
      console.log('[mcp-wiring] Sync complete — no changes needed');
    }

    return { ok: true, changed };
  } catch (e) {
    console.error('[mcp-wiring] Sync failed:', e.message);
    return { ok: false, error: e.message };
  }
}

function loadActiveConfig() {
  try {
    return JSON.parse(fs.readFileSync(P.MCPORTER_ACTIVE, 'utf8'));
  } catch {
    return { mcpServers: {} };
  }
}

// ─── Gateway reload ──────────────────────────────────────────

let _reloadTimer = null;

/**
 * Debounced gateway restart — waits 3s after last call, then restarts.
 * Tries Docker restart first (production), falls back to CLI (dev).
 */
function scheduleGatewayReload() {
  if (_reloadTimer) clearTimeout(_reloadTimer);
  _reloadTimer = setTimeout(() => {
    _reloadTimer = null;
    try {
      execFileSync(DOCKER_BIN, ['restart', 'aiwh-openclaw'], {
        timeout: 15000,
        env: P.SUBPROCESS_ENV,
      });
      console.log('[mcp-wiring] Gateway container restarted');
    } catch {
      // Fallback for non-Docker setups (dev machine)
      try {
        execFileSync(OPENCLAW_BIN, ['gateway', 'restart'], {
          timeout: 15000,
          env: P.SUBPROCESS_ENV,
        });
        console.log('[mcp-wiring] Gateway restarted via CLI');
      } catch (e2) {
        console.error('[mcp-wiring] Gateway restart failed:', e2.message);
      }
    }
  }, 3000);
}

module.exports = {
  registerMcpServer,
  unregisterMcpServer,
  syncAllMcpServers,
  scheduleGatewayReload,
};
