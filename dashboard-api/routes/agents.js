// ─── Routes: Agents + Org Chart + Files ─────────────────────
const express = require('express');
const fs = require('fs');
const path = require('path');
const P = require('../helpers/paths');
const { filterAgentsForUser, filterOrgChartForUser, canAccessAgent } = require('../helpers/rbac');

const CORE = '/opt/AIWH/core';

module.exports = function(app, deps) {
  const { db, io, adapter, chatProxy, agentSync } = deps;
  const { agentsFullCache, loadOrgChart, logActivity, setOrgChartCache } = agentSync;
  const { logAudit, resolveActor } = require('../helpers/audit');

// ─── ROUTES: Agents ─────────────────────────────────────────
app.get('/api/agents', (req, res) => {
  // Merge DB-stored display names, avatars, and status into cache
  const dbAgents = db.prepare('SELECT id, display_name, avatar_url, model, model_tier, status, last_active_at FROM agents').all();
  const dbMap = {};
  for (const r of dbAgents) dbMap[r.id] = r;

  const enriched = agentsFullCache().map(a => {
    const dbRow = dbMap[a.id];
    return {
      ...a,
      display_name: dbRow?.display_name || a.displayName,
      avatar_url: dbRow?.avatar_url || '',
      model: dbRow?.model || a.model,
      modelTier: dbRow?.model_tier || a.modelTier,
      status: dbRow?.status || 'idle',
      last_active_at: dbRow?.last_active_at || null,
    };
  });

  // RBAC: filter agents by user access
  const filtered = filterAgentsForUser(req.user, enriched);

  // Group by command centre for dashboard rendering
  const grouped = {};
  for (const a of filtered) {
    const cc = a.commandCentre || 'other';
    if (!grouped[cc]) grouped[cc] = [];
    grouped[cc].push(a);
  }
  res.json({ agents: filtered, grouped });
});

app.get('/api/agents/:id', (req, res) => {
  if (!canAccessAgent(req.user, req.params.id)) return res.status(403).json({ error: 'Access denied' });
  const agent = agentsFullCache().find(a => a.id === req.params.id);
  if (!agent) return res.status(404).json({ error: 'Not found' });
  // Get recent runs from DB (task dispatches)
  const runs = db.prepare('SELECT * FROM runs WHERE agent_id=? ORDER BY started_at DESC LIMIT 20').all(req.params.id);
  // Get DB status fields
  const dbRow = db.prepare('SELECT status, last_task, last_active_at FROM agents WHERE id=?').get(req.params.id);
  // Also check latest gateway session for more accurate last_active
  let gatewayLastActive = null;
  try {
    const sessFile = `/opt/AIWH/.openclaw/agents/${req.params.id}/sessions/sessions.json`;
    if (require('fs').existsSync(sessFile)) {
      const sessions = JSON.parse(require('fs').readFileSync(sessFile, 'utf8'));
      let maxTs = 0;
      for (const [, s] of Object.entries(sessions)) {
        const ts = s.updatedAt || 0;
        if (ts > maxTs) maxTs = ts;
      }
      if (maxTs > 0) gatewayLastActive = new Date(maxTs).toISOString();
    }
  } catch {}
  // Use whichever is more recent
  const effectiveLastActive = gatewayLastActive && (!dbRow?.last_active_at || new Date(gatewayLastActive) > new Date(dbRow.last_active_at))
    ? gatewayLastActive : dbRow?.last_active_at;
  res.json({ ...agent, ...dbRow, last_active_at: effectiveLastActive, runs });
});

// Rename agent (updates display_name in DB + org-chart.json)
app.patch('/api/agents/:id/rename', (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });
  const agentId = req.params.id;
  const trimmed = name.trim();

  // Uniqueness check — no two agents can share a display name
  const existing = db.prepare('SELECT id FROM agents WHERE display_name=? AND id!=?').get(trimmed, agentId);
  if (existing) return res.status(409).json({ error: `Name "${trimmed}" is already used by agent "${existing.id}"` });

  // Update DB
  db.prepare('UPDATE agents SET display_name=?, updated_at=datetime(\'now\') WHERE id=?').run(trimmed, agentId);

  // Update in-memory cache
  const cached = agentsFullCache().find(a => a.id === agentId);
  if (cached) cached.displayName = trimmed;

  // Update SOUL.md first line for client agents (source of truth for name on restore)
  const agentRow = db.prepare('SELECT workspace, source FROM agents WHERE id=?').get(agentId);
  if (agentRow?.source === 'client' && agentRow.workspace) {
    try {
      const soulPath = path.join(agentRow.workspace, 'SOUL.md');
      if (fs.existsSync(soulPath)) {
        const content = fs.readFileSync(soulPath, 'utf8');
        const updated = content.replace(/^#\s*.+/, `# ${trimmed}`);
        fs.writeFileSync(soulPath, updated);
      }
    } catch { /* best effort */ }
  }

  // Update org-chart.json (for product agents stored in static JSON)
  try {
    const orgPath = path.join(__dirname, '..', 'org-chart.json');
    const orgData = JSON.parse(fs.readFileSync(orgPath, 'utf8'));
    let found = false;
    function updateNode(node) {
      if (node.id === agentId) { node.displayName = trimmed; return true; }
      for (const c of (node.reports || [])) { if (updateNode(c)) return true; }
      // Walk CC → Department → Agent structure
      for (const cc of (node.commandCentres || [])) {
        for (const dept of (cc.departments || [])) {
          for (const a of (dept.agents || [])) {
            if (a.id === agentId) { a.displayName = trimmed; return true; }
            for (const sub of (a.reports || [])) { if (updateNode(sub)) return true; }
          }
        }
      }
      return false;
    }
    if (orgData.hierarchy) {
      found = updateNode(orgData.hierarchy);
      if (found) fs.writeFileSync(orgPath, JSON.stringify(orgData, null, 2));
    }
    // Always invalidate cache — client agents are added dynamically and need a fresh scan
    agentSync.setOrgChartCache(null);
  } catch (e) {
    console.error('[rename] org-chart update failed:', e.message);
  }

  logActivity(null, agentId, 'agent_renamed', `Renamed to "${trimmed}"`);
  res.json({ ok: true, display_name: trimmed });
});

// Upload agent avatar (base64 PNG from client-side canvas resize)
app.post('/api/agents/:id/avatar', express.json({ limit: '2mb' }), (req, res) => {
  const { image } = req.body; // base64 data URL
  const agentId = req.params.id;
  if (!image?.startsWith('data:image/')) return res.status(400).json({ error: 'Invalid image data' });
  // Validate agent ID format (prevent path traversal in filename)
  if (!/^[a-z0-9_-]+$/i.test(agentId)) return res.status(400).json({ error: 'Invalid agent ID format' });

  const avatarsDir = path.join(__dirname, '..', 'public', 'avatars');
  if (!fs.existsSync(avatarsDir)) fs.mkdirSync(avatarsDir, { recursive: true });

  // Strip data URL prefix, write as PNG
  const base64 = image.replace(/^data:image\/\w+;base64,/, '');
  const filePath = path.join(avatarsDir, `${agentId}.png`);
  fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));

  const avatarUrl = `/avatars/${agentId}.png?v=${Date.now()}`;
  db.prepare('UPDATE agents SET avatar_url=?, updated_at=datetime(\'now\') WHERE id=?').run(avatarUrl, agentId);
  const cached = agentsFullCache().find(a => a.id === agentId);
  if (cached) cached.avatar_url = avatarUrl;

  logActivity(null, agentId, 'avatar_updated', 'Avatar uploaded');
  res.json({ ok: true, avatar_url: avatarUrl });
});

// Sub-agent detail
app.get('/api/agents/:id/subagents/:subId', (req, res) => {
  const agent = agentsFullCache().find(a => a.id === req.params.id);
  if (!agent) return res.status(404).json({ error: 'Parent agent not found' });
  const sub = (agent.subAgents || []).find(s => s.id === req.params.subId);
  if (!sub) return res.status(404).json({ error: 'Sub-agent not found' });
  // Return sub-agent with its workspace files
  const files = adapter.getWorkspaceFiles(sub.workspace);
  res.json({ ...sub, parentAgent: agent.id, files });
});

// ─── ROUTES: Org Chart ───────────────────────────────────────
app.get('/api/org-chart', (req, res) => {
  const chart = loadOrgChart();
  res.json(filterOrgChartForUser(req.user, chart));
});

// ─── ROUTES: Files Browser ──────────────────────────────────
app.get('/api/files', (req, res) => {
  const dir = path.resolve(req.query.path || CORE);
  // Security: must be within /opt/AIWH (canonicalized to prevent traversal)
  if (!dir.startsWith('/opt/AIWH/')) return res.status(403).json({ error: 'Path outside allowed scope' });

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const items = entries
      .filter(e => !e.name.startsWith('.') || e.name === '.openclaw')
      .map(e => {
        const full = path.join(dir, e.name);
        let size = 0;
        try { size = fs.statSync(full).size; } catch {}
        return {
          name: e.name,
          path: full,
          isDir: e.isDirectory(),
          size,
        };
      })
      .sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    res.json({ path: dir, items });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/files/read', (req, res) => {
  const filePath = path.resolve(req.query.path || '');
  if (!filePath.startsWith('/opt/AIWH/')) return res.status(403).json({ error: 'Forbidden' });
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > 500000) return res.status(400).json({ error: 'File too large (>500KB)' });
    const content = fs.readFileSync(filePath, 'utf8');
    res.json({ path: filePath, content, size: stat.size });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/files/save', (req, res) => {
  const { path: filePath, content } = req.body;
  if (!filePath || typeof content !== 'string') return res.status(400).json({ error: 'Missing path or content' });
  // Security: only allow saving agent runtime files under /opt/AIWH (canonicalized)
  const resolvedSavePath = path.resolve(filePath);
  if (!resolvedSavePath.startsWith('/opt/AIWH/')) return res.status(403).json({ error: 'Forbidden' });

  // Product file guard — these are managed by the update system, not editable via dashboard
  const LOCKED_DIRS = ['/opt/AIWH/core/scripts/', '/opt/AIWH/core/dashboard/', '/opt/AIWH/core/docker/',
    '/opt/AIWH/core/onboarding/', '/opt/AIWH/core/config/', '/opt/AIWH/core/docs/'];
  const LOCKED_BASENAMES = new Set(['BOOTSTRAP.md', 'license.json', 'landlock-policy.json', 'org-chart.json']);
  const saveBasename = path.basename(resolvedSavePath);
  const isClientAgent = resolvedSavePath.startsWith(P.CLIENT_AGENTS_DIR + '/');
  // CORE.md is locked for product agents (core/modules/) but editable for client agents (client/agents/)
  if (saveBasename === 'CORE.md' && !isClientAgent) {
    logAudit(db, { actor: resolveActor(req), action: 'file.save', target: resolvedSavePath,
      detail: { file: saveBasename, blocked: true }, result: 'denied', ip: req.ip });
    return res.status(403).json({ error: 'This file is protected by the product update system' });
  }
  if (LOCKED_BASENAMES.has(saveBasename) || LOCKED_DIRS.some(d => resolvedSavePath.startsWith(d))) {
    logAudit(db, { actor: resolveActor(req), action: 'file.save', target: resolvedSavePath,
      detail: { file: saveBasename, blocked: true }, result: 'denied', ip: req.ip });
    return res.status(403).json({ error: 'This file is protected by the product update system' });
  }

  const ALLOWED = new Set([
    'SOUL.md', 'MEMORY.md', 'IDENTITY.md', 'USER.md',
    'TOOLS.md', 'AGENTS.md', 'HEARTBEAT.md', 'HARD-LIMITS.md',
    'CORE.md', // editable for client agents (product agents blocked above)
  ]);
  if (!ALLOWED.has(saveBasename)) return res.status(403).json({ error: 'Cannot edit this file type' });
  if (content.length > 100000) return res.status(400).json({ error: 'Content too large (>100KB)' });
  try {
    fs.writeFileSync(resolvedSavePath, content, 'utf8');
    logAudit(db, { actor: resolveActor(req), action: 'file.save', target: resolvedSavePath, detail: { file: saveBasename, size: content.length }, ip: req.ip });
    logActivity(null, null, 'file_saved', `${saveBasename} (${resolvedSavePath})`);
    res.json({ ok: true, size: content.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Gateway Restart (debounced) ─────────────────────────────
let _gatewayRestartTimer = null;
function scheduleGatewayRestart() {
  if (_gatewayRestartTimer) clearTimeout(_gatewayRestartTimer);
  _gatewayRestartTimer = setTimeout(() => {
    _gatewayRestartTimer = null;
    const spawnEnv = { ...process.env, PATH: `/opt/homebrew/bin:/opt/homebrew/sbin:${process.env.PATH || '/usr/bin:/bin'}` };
    try {
      execFileSync('/opt/homebrew/bin/docker', ['restart', 'aiwh-openclaw'], { timeout: 15000, env: spawnEnv });
      console.log('[model] Gateway container restarted to pick up model changes');
    } catch (e) {
      console.error('[model] Gateway restart failed:', e.message);
      // Fallback for non-Docker setups
      try {
        execFileSync('/opt/homebrew/bin/openclaw', ['gateway', 'restart'], { timeout: 15000, env: spawnEnv });
      } catch {}
    }
  }, 3000); // 3s debounce
}

// ─── Agent Model Management ─────────────────────────────────

const OPENCLAW_JSON = path.join(__dirname, '../../../.openclaw/openclaw.json');
const CANONICAL_AUTH = path.join(__dirname, '../../../.openclaw/agents/main/agent/auth-profiles.json');
const SECRETS_PY_PATH = path.join(__dirname, '../../scripts/lib/secrets.py');
const https = require('https');
const { execFileSync } = require('child_process');

// Read a secret value via secrets.py load (outputs "export KEY='value'")
function getSecretValue(secretId) {
  try {
    const out = execFileSync('python3', [SECRETS_PY_PATH, 'load', secretId], {
      encoding: 'utf8', timeout: 5000,
    }).trim();
    // Parse "export KEY='value'" or "export KEY=value"
    const match = out.match(/^export\s+\S+=(?:'([^']*)'|"([^"]*)"|(\S+))$/m);
    return match ? (match[1] ?? match[2] ?? match[3]) : null;
  } catch { return null; }
}

// Hardcoded model catalogs for direct providers
const ANTHROPIC_MODELS = [
  { id: 'anthropic/claude-haiku-4-5', name: 'Claude Haiku 4.5', provider: 'anthropic', tier: 'fast', inputCost: 0.80, outputCost: 4.00 },
  { id: 'anthropic/claude-sonnet-4-5', name: 'Claude Sonnet 4.5', provider: 'anthropic', tier: 'balanced', inputCost: 3.00, outputCost: 15.00 },
  { id: 'anthropic/claude-opus-4-6', name: 'Claude Opus 4.6', provider: 'anthropic', tier: 'powerful', inputCost: 15.00, outputCost: 75.00 },
];
const OPENAI_MODELS = [
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai', tier: 'fast', inputCost: 0.15, outputCost: 0.60 },
  { id: 'openai/gpt-4o', name: 'GPT-4o', provider: 'openai', tier: 'balanced', inputCost: 2.50, outputCost: 10.00 },
];
const CODEX_MODELS = [
  { id: 'openai-codex/gpt-5.4', name: 'GPT-5.4 Codex (ChatGPT OAuth)', provider: 'openai-codex', tier: 'powerful', inputCost: 0, outputCost: 0 },
  { id: 'openai-codex/gpt-5.3-codex', name: 'GPT-5.3 Codex (ChatGPT OAuth)', provider: 'openai-codex', tier: 'powerful', inputCost: 0, outputCost: 0 },
  { id: 'openai-codex/gpt-5.3-codex-spark', name: 'GPT-5.3 Codex Spark — reasoning (ChatGPT OAuth)', provider: 'openai-codex', tier: 'powerful', inputCost: 0, outputCost: 0 },
  { id: 'openai-codex/gpt-5.2', name: 'GPT-5.2 (ChatGPT OAuth)', provider: 'openai-codex', tier: 'balanced', inputCost: 0, outputCost: 0 },
];

// Cache OpenRouter models (1 hour TTL)
let _orCache = { models: [], fetchedAt: 0 };
const OR_CACHE_TTL = 3600000;

function fetchOpenRouterModels(apiKey) {
  return new Promise((resolve) => {
    if (Date.now() - _orCache.fetchedAt < OR_CACHE_TTL && _orCache.models.length) {
      return resolve(_orCache.models);
    }
    const req = https.get('https://openrouter.ai/api/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    }, (resp) => {
      let data = '';
      resp.on('data', c => { data += c; });
      resp.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          // Flagship model patterns — only the latest/best from major providers
          // Sorted by created date, the top 20 become "featured" (newest = leaderboard proxy)
          const flagshipPatterns = [
            /^anthropic\/claude-(opus|sonnet|haiku)-4/,
            /^openai\/gpt-5/,
            /^openai\/gpt-4o/,
            /^google\/gemini-(3|2\.5|2\.0)/,
            /^meta-llama\/llama-4/,
            /^meta-llama\/llama-3\.[23]/,
            /^deepseek\/deepseek-(r2|v3|chat)/,
            /^qwen\/qwen3/,
            /^mistralai\/mistral-(large|medium|small)/,
            /^x-ai\/grok-[34]/,
          ];
          const models = (parsed.data || [])
            .filter(m => m.id && m.name)
            .map(m => {
              const isFlagship = flagshipPatterns.some(p => p.test(m.id));
              return {
                id: `openrouter/${m.id}`,
                name: m.name,
                provider: 'openrouter',
                tier: m.id.includes('flash') || m.id.includes('mini') || m.id.includes('haiku') || m.id.includes('nano') ? 'fast'
                  : m.id.includes('opus') || m.id.includes('pro') || m.id.includes('405b') ? 'powerful'
                  : 'balanced',
                inputCost: (m.pricing?.prompt ? parseFloat(m.pricing.prompt) * 1000000 : 0),
                outputCost: (m.pricing?.completion ? parseFloat(m.pricing.completion) * 1000000 : 0),
                context: m.context_length || 0,
                created: m.created || 0,
                featured: isFlagship,
              };
            })
            // Sort: featured newest first, then rest alphabetical
            .sort((a, b) => {
              if (a.featured !== b.featured) return a.featured ? -1 : 1;
              if (a.featured && b.featured) return (b.created || 0) - (a.created || 0);
              return a.name.localeCompare(b.name);
            });
          _orCache = { models, fetchedAt: Date.now() };
          resolve(models);
        } catch { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.setTimeout(10000, () => { req.destroy(); resolve([]); });
  });
}

// Get available models from all configured providers
app.get('/api/agents/models/available', async (req, res) => {
  const models = [];
  const providers = [];

  // Check which providers have credentials
  let storedKeys = [];
  try {
    const out = execFileSync('python3', [SECRETS_PY_PATH, 'list'], {
      encoding: 'utf8', timeout: 5000,
    });
    storedKeys = out.trim().split('\n').map(l => l.trim()).filter(Boolean);
  } catch {}

  if (storedKeys.includes('ANTHROPIC_API_KEY')) {
    models.push(...ANTHROPIC_MODELS);
    providers.push('anthropic');
  }

  if (storedKeys.includes('OPENAI_API_KEY')) {
    models.push(...OPENAI_MODELS);
    providers.push('openai');
  }

  // Check Codex OAuth (stored in auth-profiles, not secrets.enc)
  try {
    const store = JSON.parse(fs.readFileSync(CANONICAL_AUTH, 'utf8'));
    if (store.profiles?.['openai-codex:default']?.type === 'oauth') {
      models.push(...CODEX_MODELS);
      providers.push('openai-codex');
    }
  } catch {}

  if (storedKeys.includes('OPENROUTER_API_KEY')) {
    providers.push('openrouter');
    const orKey = getSecretValue('OPENROUTER_API_KEY');
    if (orKey) {
      const orModels = await fetchOpenRouterModels(orKey);
      models.push(...orModels);
    }
  }

  // If no providers configured, still show Anthropic as reference
  if (models.length === 0) {
    models.push(...ANTHROPIC_MODELS);
    providers.push('anthropic');
  }

  res.json({ models, providers });
});

// Set model for a specific agent — writes to openclaw.json + updates DB + cache
app.post('/api/agents/:id/model', (req, res) => {
  const agentId = req.params.id;
  const { model } = req.body;
  if (!model) return res.status(400).json({ error: 'model required' });

  try {
    const oc = JSON.parse(fs.readFileSync(OPENCLAW_JSON, 'utf8'));
    const agentList = oc.agents?.list || [];
    const agent = agentList.find(a => a.id === agentId);
    if (!agent) return res.status(404).json({ error: `Agent ${agentId} not found` });

    const oldModel = agent.model;
    // Resolve "default" to the actual default model — never write literal "default"
    const defaultModel = typeof oc.agents?.defaults?.model === 'string'
      ? oc.agents.defaults.model
      : oc.agents?.defaults?.model?.primary || 'anthropic/claude-haiku-4-5';
    const resolvedModel = model === 'default' ? defaultModel : model;
    // Preserve fallbacks if model was previously an object with fallbacks
    if (typeof oldModel === 'object' && oldModel?.fallbacks?.length) {
      agent.model = { primary: resolvedModel, fallbacks: oldModel.fallbacks };
    } else {
      agent.model = resolvedModel;
    }
    fs.writeFileSync(OPENCLAW_JSON, JSON.stringify(oc, null, 2));

    // Derive tier from resolved model for DB + org-chart
    const ml = resolvedModel.toLowerCase();
    let tier = 'haiku';
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
    else if (ml.includes('auto')) tier = 'auto';
    else tier = ml.split('/').pop().split('-')[0] || 'unknown';

    // Update dashboard DB
    try {
      db.prepare('UPDATE agents SET model=?, model_tier=?, updated_at=datetime(\'now\') WHERE id=?')
        .run(model, tier, agentId);
    } catch {}

    // Update in-memory agent cache
    const cache = agentsFullCache();
    const cached = cache.find(a => a.id === agentId);
    if (cached) { cached.model = model; cached.modelTier = tier; }

    // Update org-chart.json model field
    try {
      const orgPath = path.join(__dirname, '..', 'org-chart.json');
      const orgData = JSON.parse(fs.readFileSync(orgPath, 'utf8'));
      function updateNode(n) {
        if (n.id === agentId) { n.model = model; delete n.modelLabel; return true; }
        for (const c of (n.reports || [])) { if (updateNode(c)) return true; }
        return false;
      }
      if (orgData.hierarchy) {
        updateNode(orgData.hierarchy);
        fs.writeFileSync(orgPath, JSON.stringify(orgData, null, 2));
        // Invalidate server-side cache so /api/org-chart returns fresh data
        setOrgChartCache(orgData);
      }
    } catch {}

    logActivity(null, null, 'model_change', `${agentId}: ${oldModel} → ${model}`);

    // Debounced gateway restart — waits 3s after last model change, then restarts once
    scheduleGatewayRestart();

    res.json({ ok: true, agentId, model: resolvedModel, tier, previous: oldModel, gatewayRestart: 'scheduled' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to set model', detail: err.message });
  }
});

// Set default model for all agents (agents.defaults.model.primary)
app.post('/api/agents/models/default', (req, res) => {
  const { model } = req.body;
  if (!model) return res.status(400).json({ error: 'model required' });

  try {
    const oc = JSON.parse(fs.readFileSync(OPENCLAW_JSON, 'utf8'));
    if (!oc.agents) oc.agents = {};
    if (!oc.agents.defaults) oc.agents.defaults = {};
    if (!oc.agents.defaults.model) oc.agents.defaults.model = {};

    const old = oc.agents.defaults.model.primary;
    oc.agents.defaults.model.primary = model;
    fs.writeFileSync(OPENCLAW_JSON, JSON.stringify(oc, null, 2));

    logActivity(null, null, 'default_model_change', `${old} → ${model}`);
    res.json({ ok: true, model, previous: old });
  } catch (err) {
    res.status(500).json({ error: 'Failed to set default model', detail: err.message });
  }
});

// Provider credential routes → routes/providers.js

};
