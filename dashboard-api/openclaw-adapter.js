// ─── OpenClaw Adapter ────────────────────────────────────────
// Discovers agents from openclaw.json + workspace directories
// Discovers sub-agents from agent workspace subdirectories
// Maps agents to Command Centres and Departments
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const P = require('./helpers/paths');

const OPENCLAW_CONFIG = P.OPENCLAW_CONFIG;
const OPENCLAW_BIN = '/opt/homebrew/bin/openclaw';
const MODULES_ROOT = P.MODULES_DIR;
// Filesystem categories for workspace scanning (unchanged on disk)
const MODULE_GROUPS = ['frontend', 'backend', 'lifestyle', 'system'];

// ─── Command Centre + Department Resolution ──────────────────

let _ccCache = null;
let _deptCache = null;

function loadCommandCentres() {
  if (_ccCache) return _ccCache;
  try {
    _ccCache = P.getCatalogues().commandCentres;
  } catch {
    _ccCache = { command_centres: {}, system_agents: [], orchestrator: 'main' };
  }
  return _ccCache;
}

function loadDepartments() {
  if (_deptCache) return _deptCache;
  // Client departments (editable) take precedence over product templates
  try {
    _deptCache = JSON.parse(fs.readFileSync(P.DEPARTMENTS_CONFIG, 'utf8'));
    return _deptCache;
  } catch {}
  // Fall back to product templates
  try {
    _deptCache = P.getCatalogues().departmentTemplates;
  } catch {
    _deptCache = { departments: [] };
  }
  return _deptCache;
}

/**
 * Resolve which command centre an agent belongs to.
 * Returns CC id (e.g., "business") or "system" or null for client agents.
 */
function resolveCommandCentre(agentId) {
  const cc = loadCommandCentres();
  for (const [ccId, ccDef] of Object.entries(cc.command_centres || {})) {
    if (ccDef.agents && ccDef.agents.includes(agentId)) return ccId;
  }
  if ((cc.system_agents || []).includes(agentId)) return 'system';
  if (agentId === cc.orchestrator) return 'core';
  return null; // client-created agent
}

/**
 * Resolve which departments an agent belongs to (many-to-many).
 * Returns array of { id, name, commandCentre }.
 */
function resolveDepartments(agentId) {
  const depts = loadDepartments();
  const result = [];
  for (const dept of (depts.departments || [])) {
    if (dept.agents && dept.agents.includes(agentId)) {
      result.push({ id: dept.id, name: dept.name, commandCentre: dept.command_centre });
    }
  }
  return result;
}

/** Invalidate CC/department caches (call after config edits). */
function invalidateCCCache() {
  _ccCache = null;
  _deptCache = null;
}

/**
 * Lightweight registered-agent ID set. Used by rbac.loadDepartments() to
 * filter stale agent references out of client/config/departments.json.
 * Source of truth: openclaw.json agents.list + product workspace scan + client/agents/.
 * Deactivated/trashed client agents are excluded (they cannot be delegated to).
 */
function getRegisteredAgentIds() {
  const ids = new Set();
  const cfg = readConfig();
  for (const a of (cfg?.agents?.list || [])) {
    if (a?.id) ids.add(a.id);
  }
  for (const group of MODULE_GROUPS) {
    const groupDir = path.join(MODULES_ROOT, group);
    if (!fs.existsSync(groupDir)) continue;
    try {
      for (const entry of fs.readdirSync(groupDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (fs.existsSync(path.join(groupDir, entry.name, 'SOUL.md'))) ids.add(entry.name);
      }
    } catch {}
  }
  if (fs.existsSync(P.CLIENT_AGENTS_DIR)) {
    try {
      for (const entry of fs.readdirSync(P.CLIENT_AGENTS_DIR, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const dir = path.join(P.CLIENT_AGENTS_DIR, entry.name);
        if (fs.existsSync(path.join(dir, '.deactivated'))) continue;
        if (fs.existsSync(path.join(dir, '.trashed'))) continue;
        if (fs.existsSync(path.join(dir, 'SOUL.md')) || fs.existsSync(path.join(dir, 'CORE.md'))) {
          ids.add(entry.name);
        }
      }
    } catch {}
  }
  // Include CC catalogue agents (e.g. wcc-agent, health-tracker) — these are
  // declared in command-centres.json without a workspace of their own.
  try {
    const cc = loadCommandCentres();
    for (const def of Object.values(cc.command_centres || {})) {
      for (const id of (def.agents || [])) ids.add(id);
    }
    for (const id of (cc.system_agents || [])) ids.add(id);
  } catch {}
  // department-lead is a synthetic RBAC orchestrator (see rbac.buildDeltaCardsForTeam)
  // and is never in the registry — whitelist it so depts referencing it survive filtering.
  ids.add('department-lead');
  return ids;
}

// ─── Agent Discovery (dual source) ─────────────────────────

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(OPENCLAW_CONFIG, 'utf8'));
  } catch (e) {
    console.error('Failed to read openclaw.json:', e.message);
    return null;
  }
}

/**
 * Scan a workspace directory for sub-agent dirs.
 * A sub-agent dir contains a SOUL.md or run.sh at its root.
 */
function discoverSubAgents(workspaceDir) {
  const subs = [];
  if (!workspaceDir || !fs.existsSync(workspaceDir)) return subs;
  try {
    const entries = fs.readdirSync(workspaceDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      // Skip non-agent dirs
      if (['memory', 'node_modules', '.openclaw', '.pi', '__pycache__', 'data', 'output', 'logs'].includes(entry.name)) continue;
      const subDir = path.join(workspaceDir, entry.name);
      const hasSoul = fs.existsSync(path.join(subDir, 'SOUL.md'));
      const hasRun = fs.existsSync(path.join(subDir, 'run.sh'));
      if (hasSoul || hasRun) {
        // Count files in sub-agent dir
        let fileCount = 0;
        try {
          fileCount = fs.readdirSync(subDir).filter(f => !f.startsWith('.')).length;
        } catch {}
        subs.push({
          id: entry.name,
          displayName: entry.name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
          workspace: subDir,
          hasSoul,
          hasRun,
          fileCount,
        });
      }
    }
  } catch {}
  return subs;
}

/**
 * Get workspace file listing for an agent.
 * Only exposes runtime agent files (bootstrap/config files + memory dir).
 */
// OpenClaw loading order: BOOTSTRAP → CORE → SOUL → IDENTITY → TOOLS → AGENTS → USER → HEARTBEAT → MEMORY
// HARD-LIMITS.md is client-managed (controls agent freedom level)
const AGENT_RUNTIME_FILES = new Set([
  'BOOTSTRAP.md', 'CORE.md', 'SOUL.md', 'IDENTITY.md',
  'TOOLS.md', 'AGENTS.md', 'USER.md', 'HEARTBEAT.md', 'MEMORY.md',
  'HARD-LIMITS.md',
  'memory',
]);

function getWorkspaceFiles(workspaceDir) {
  if (!workspaceDir || !fs.existsSync(workspaceDir)) return [];
  try {
    return fs.readdirSync(workspaceDir, { withFileTypes: true })
      .filter(e => AGENT_RUNTIME_FILES.has(e.name))
      .map(e => {
        const full = path.join(workspaceDir, e.name);
        let size = 0;
        try { size = fs.statSync(full).size; } catch {}
        return { name: e.name, path: full, isDir: e.isDirectory(), size };
      })
      .sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  } catch { return []; }
}

/**
 * Discover all agents combining:
 * 1. openclaw.json runtime config (model, status, settings)
 * 2. modules/ workspace tree (files, sub-agents, outputs)
 */
function discoverAgents() {
  const cfg = readConfig();
  const defaultModel = cfg?.agents?.defaults?.model?.primary || 'anthropic/claude-haiku-4-5';

  // Build map from openclaw.json
  const configAgents = new Map();
  for (const a of (cfg?.agents?.list || [])) {
    configAgents.set(a.id, a);
  }

  // Scan workspace directories for all agents (including any not in config)
  const workspaceAgents = new Map();

  // 1. Product agents in core/modules/{category}/{agent}/
  for (const group of MODULE_GROUPS) {
    const groupDir = path.join(MODULES_ROOT, group);
    if (!fs.existsSync(groupDir)) continue;
    try {
      const entries = fs.readdirSync(groupDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const agentDir = path.join(groupDir, entry.name);
        const hasSoul = fs.existsSync(path.join(agentDir, 'SOUL.md'));
        if (hasSoul) {
          workspaceAgents.set(entry.name, {
            id: entry.name,
            workspace: agentDir,
            module: group,
            source: 'product',
          });
        }
      }
    } catch {}
  }

  // 2. Client-created agents in client/agents/{agent}/
  // Skip deactivated (.deactivated) and trashed (.trashed) agents
  if (fs.existsSync(P.CLIENT_AGENTS_DIR)) {
    try {
      const entries = fs.readdirSync(P.CLIENT_AGENTS_DIR, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const agentDir = path.join(P.CLIENT_AGENTS_DIR, entry.name);
        if (fs.existsSync(path.join(agentDir, '.deactivated'))) continue;
        if (fs.existsSync(path.join(agentDir, '.trashed'))) continue;
        const hasSoul = fs.existsSync(path.join(agentDir, 'SOUL.md'));
        const hasCore = fs.existsSync(path.join(agentDir, 'CORE.md'));
        if (hasSoul || hasCore) {
          workspaceAgents.set(entry.name, {
            id: entry.name,
            workspace: agentDir,
            module: 'client',
            source: 'client',
          });
        }
      }
    } catch {}
  }

  // Merge both sources: config is authoritative for runtime, workspace for files
  const allAgentIds = new Set([...configAgents.keys(), ...workspaceAgents.keys()]);
  const agents = [];

  for (const id of allAgentIds) {
    const cfgAgent = configAgents.get(id);
    const wsAgent = workspaceAgents.get(id);

    const rawModel = cfgAgent?.model;
    const model = typeof rawModel === 'string'
      ? (rawModel === 'default' ? defaultModel : (rawModel || defaultModel))
      : typeof rawModel === 'object' && rawModel?.primary
        ? rawModel.primary
        : cfgAgent ? defaultModel : 'unknown';

    let tier = 'haiku';
    const ml = (typeof model === 'string' ? model : String(model)).toLowerCase();
    if (ml.includes('opus')) tier = 'opus';
    else if (ml.includes('sonnet')) tier = 'sonnet';
    else if (ml.includes('haiku')) tier = 'haiku';
    else if (ml.includes('codex')) tier = 'codex';
    else if (ml.includes('gpt-4o-mini')) tier = 'gpt-4o-mini';
    else if (ml.includes('gpt-4o')) tier = 'gpt-4o';
    else if (ml.includes('gemini') && ml.includes('flash')) tier = 'gemini-flash';
    else if (ml.includes('gemini')) tier = 'gemini-pro';
    else if (ml.includes('llama') || ml.includes('ollama')) tier = 'local';
    else if (ml.includes('deepseek')) tier = 'deepseek';
    else if (ml.includes('qwen')) tier = 'qwen';
    else if (ml.includes('auto')) tier = 'auto';
    else if (ml !== 'unknown') tier = ml.split('/').pop().split('-')[0] || 'unknown';

    const workspace = cfgAgent?.workspace || wsAgent?.workspace || '';
    const source = wsAgent?.source || (workspace.includes('/client/agents/') ? 'client' : 'product');

    // Resolve command centre and departments from config (not filesystem path)
    const commandCentre = resolveCommandCentre(id);
    const departments = resolveDepartments(id);

    // Legacy 'module' field for compiled frontend compat (TODO: remove in AB.2)
    let module = wsAgent?.module || 'system';
    if (workspace.includes('/frontend/')) module = 'frontend';
    else if (workspace.includes('/backend/')) module = 'backend';
    else if (workspace.includes('/lifestyle/')) module = 'lifestyle';
    else if (workspace.includes('/system/')) module = 'system';
    else if (workspace.includes('/client/agents/')) module = 'client';
    else if (id === 'main') module = 'core';

    // Read display name from SOUL.md first line for client agents, fallback to ID-based name
    let displayName = id.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    if (source === 'client' && workspace) {
      try {
        const soul = fs.readFileSync(path.join(workspace, 'SOUL.md'), 'utf8');
        const firstLine = (soul.split('\n')[0] || '').replace(/^#\s*/, '').trim();
        if (firstLine) displayName = firstLine;
      } catch { /* use default */ }
    }

    // Discover sub-agents from workspace
    const subAgents = discoverSubAgents(workspace);

    // Get workspace file summary
    const workspaceFiles = getWorkspaceFiles(workspace);

    agents.push({
      id,
      displayName,
      model,
      modelTier: tier,
      workspace,
      commandCentre,
      departments,
      source,
      module, // legacy compat — TODO: remove in AB.2
      agentDir: cfgAgent?.agentDir || workspace,
      inConfig: !!cfgAgent,
      inWorkspace: !!wsAgent,
      subAgents,
      workspaceFiles,
      allowedSubAgents: cfgAgent?.subagents?.allowAgents || [],
      heartbeat: cfgAgent?.heartbeat?.every || cfg?.agents?.defaults?.heartbeat?.every || '0',
    });
  }

  return agents;
}

// ─── Model Cost Rates (per 1M tokens) ──────────────────────

const COST_RATES = {
  opus:   { input: 15.0,  output: 75.0  },
  sonnet: { input: 3.0,   output: 15.0  },
  haiku:  { input: 0.80,  output: 4.0   },
  local:  { input: 0,     output: 0     },
  unknown: { input: 1.0,  output: 5.0   },
};

function estimateCost(tier, inputTokens, outputTokens) {
  const rates = COST_RATES[tier] || COST_RATES.haiku;
  return (inputTokens * rates.input + outputTokens * rates.output) / 1_000_000;
}

// ─── Cron Job Discovery ─────────────────────────────────────

function getCronJobs() {
  try {
    const out = execSync(`${OPENCLAW_BIN} cron list --all --json 2>/dev/null`, {
      timeout: 10000,
      env: P.SUBPROCESS_ENV,
    }).toString().trim();
    const data = JSON.parse(out);
    return data.jobs || [];
  } catch (e) {
    console.error('Failed to list cron jobs:', e.message);
    return [];
  }
}

function getCronRuns(jobId, limit = 10) {
  try {
    const args = ['cron', 'runs', '--limit', String(limit)];
    if (jobId) args.push('--id', jobId);
    const out = execSync(`${OPENCLAW_BIN} ${args.join(' ')} 2>/dev/null`, {
      timeout: 10000,
      env: P.SUBPROCESS_ENV
    }).toString().trim();
    return JSON.parse(out);
  } catch {
    return { entries: [], total: 0 };
  }
}

// ─── Task Execution ─────────────────────────────────────────

const activeProcesses = new Map();

function executeAgent(agentId, message, options = {}) {
  const { cwd, onData, onClose, timeoutSeconds = 300 } = options;

  const args = ['agent', '--agent', agentId, '--message', message];
  if (options.model) args.push('--model', options.model);
  if (options.sessionId) args.push('--session-id', options.sessionId);

  const env = P.SUBPROCESS_ENV;

  const proc = spawn(OPENCLAW_BIN, args, {
    cwd: cwd || P.CORE_ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  let killed = false;

  const timeout = setTimeout(() => {
    killed = true;
    proc.kill('SIGTERM');
  }, timeoutSeconds * 1000);

  proc.stdout.on('data', chunk => {
    const text = chunk.toString();
    output += text;
    if (onData) onData(text);
  });

  proc.stderr.on('data', chunk => {
    const text = chunk.toString();
    output += text;
    if (onData) onData(text);
  });

  return new Promise((resolve) => {
    proc.on('close', (code) => {
      clearTimeout(timeout);
      resolve({ exitCode: code, output, killed, duration: Date.now() });
      if (onClose) onClose({ exitCode: code, output, killed });
    });
    proc.on('error', (err) => {
      clearTimeout(timeout);
      const r = { exitCode: -1, output: err.message, killed: false, duration: 0 };
      resolve(r);
      if (onClose) onClose(r);
    });
  });
}

function cancelRun(runId) {
  const proc = activeProcesses.get(runId);
  if (proc) {
    proc.kill('SIGTERM');
    activeProcesses.delete(runId);
    return true;
  }
  return false;
}

// ─── System Health ──────────────────────────────────────────

// Cache gateway status for 30s — the openclaw CLI takes ~1.3s per call
let _gwCache = { status: 'offline', detail: '', ts: 0 };
function getGatewayStatus() {
  if (Date.now() - _gwCache.ts < 30000) return _gwCache;
  try {
    const out = execSync(`${OPENCLAW_BIN} gateway status 2>/dev/null`, {
      timeout: 5000,
      env: P.SUBPROCESS_ENV
    }).toString().trim();
    _gwCache = { status: 'online', detail: out, ts: Date.now() };
  } catch {
    _gwCache = { status: 'offline', detail: '', ts: Date.now() };
  }
  return _gwCache;
}

// Cache disk usage for 60s — du on large dirs is slow
let _diskCache = { used: '?', available: '?', ts: 0 };
function getDiskUsage() {
  if (Date.now() - _diskCache.ts < 60000) return _diskCache;
  try {
    const du = execSync(`du -sh ${P.CORE_ROOT} 2>/dev/null`).toString().trim().split('\t')[0];
    const df = execSync(`df -h ${P.CORE_ROOT} | tail -1 | awk '{print $4}'`).toString().trim();
    _diskCache = { used: du, available: df, ts: Date.now() };
  } catch {
    _diskCache = { used: '?', available: '?', ts: Date.now() };
  }
  return _diskCache;
}

module.exports = {
  readConfig,
  getRegisteredAgentIds,
  discoverAgents,
  discoverSubAgents,
  getWorkspaceFiles,
  loadCommandCentres,
  loadDepartments,
  resolveCommandCentre,
  resolveDepartments,
  invalidateCCCache,
  COST_RATES,
  estimateCost,
  getCronJobs,
  getCronRuns,
  executeAgent,
  cancelRun,
  activeProcesses,
  getGatewayStatus,
  getDiskUsage,
  OPENCLAW_CONFIG,
  MODULES_ROOT,
};
