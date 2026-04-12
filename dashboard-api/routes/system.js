// ─── Routes: System (Cron, Script Crons, Trash, Debug, Logs, Notifications, Health) ──
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const OPENCLAW_BIN = '/opt/homebrew/bin/openclaw';
const OC_ENV = { ...process.env, OPENCLAW_STATE_DIR: '/opt/AIWH/.openclaw', PATH: `/opt/homebrew/bin:/opt/homebrew/sbin:${process.env.PATH || '/usr/bin:/bin'}` };

module.exports = function(app, deps) {
  const { db, io, adapter, scriptScheduler, logStreamer, notifEngine, dashLog, logActivity } = deps;
const { logAudit, resolveActor } = require('../helpers/audit');

// ─── ROUTES: Health ─────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), version: '2.0.0' });
});

// ─── ROUTES: Cron Templates ─────────────────────────────────
app.get('/api/cron/templates', (req, res) => {
  try {
    const P = require('../helpers/paths');
    const data = P.getCatalogues().cronTemplates;
    // Read client timezone if available
    let clientTz = 'Australia/Brisbane';
    try {
      const prefs = path.join(process.env.CLIENT_ROOT || '/opt/AIWH/client', 'config', 'client-preferences.json');
      if (fs.existsSync(prefs)) {
        const p = JSON.parse(fs.readFileSync(prefs, 'utf8'));
        if (p.timezone) clientTz = p.timezone;
      }
    } catch {}
    // Detect client's default provider from openclaw.json
    let defaultProvider = 'anthropic';
    try {
      const ocPath = path.join(process.env.OPENCLAW_STATE_DIR || '/opt/AIWH/.openclaw', 'openclaw.json');
      const oc = JSON.parse(fs.readFileSync(ocPath, 'utf8'));
      const primary = oc?.agents?.defaults?.model?.primary || '';
      if (primary.startsWith('openai-codex/')) defaultProvider = 'openai-codex';
      else if (primary.startsWith('openrouter/')) defaultProvider = 'openrouter';
      else if (primary.startsWith('ollama/')) defaultProvider = 'ollama';
    } catch {}
    // Resolve tier → model for each template using client's provider
    const tierMap = data.tierMap || {};
    const templates = (data.templates || []).map(t => {
      if (t.tier && tierMap[t.tier]) {
        const resolved = tierMap[t.tier][defaultProvider] || tierMap[t.tier].anthropic || t.model;
        return { ...t, resolvedModel: resolved };
      }
      return t;
    });
    res.json({ templates, tierMap, clientTimezone: clientTz, defaultProvider });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load templates: ' + e.message });
  }
});

// ─── ROUTES: Provider Health ──────────────────────────────────
app.get('/api/providers/health', async (req, res) => {
  const providers = [];
  try {
    const ocPath = path.join(process.env.OPENCLAW_STATE_DIR || '/opt/AIWH/.openclaw', 'openclaw.json');
    const oc = JSON.parse(fs.readFileSync(ocPath, 'utf8'));
    const profiles = oc?.auth?.profiles || {};

    // Check each configured auth profile
    for (const [key, profile] of Object.entries(profiles)) {
      const providerId = key.split(':')[0].toLowerCase();
      if (providers.some(p => p.id === providerId)) continue; // dedupe

      const entry = { id: providerId, status: 'unknown', models: [] };

      // Gather models for this provider
      const allModels = oc?.agents?.defaults?.models || {};
      for (const [mid] of Object.entries(allModels)) {
        if (mid.startsWith(providerId + '/')) entry.models.push(mid);
      }

      // Check secrets.enc for API keys (provider check reads encrypted store)
      let hasApiKey = false;
      try {
        const secretsMap = { anthropic: 'ANTHROPIC_API_KEY', openrouter: 'OPENROUTER_API_KEY', 'openai-codex': 'OPENAI_API_KEY', openai: 'OPENAI_API_KEY' };
        const secretKey = secretsMap[providerId];
        if (secretKey) {
          const out = execFileSync('python3', [path.join(__dirname, '../../scripts/lib/secrets.py'), 'load', secretKey], { env: OC_ENV, timeout: 5000 }).toString().trim();
          hasApiKey = out.includes(secretKey + '=') || out.includes("export " + secretKey);
        }
      } catch {}

      if (providerId === 'ollama') {
        // Check local Ollama
        try {
          const http = require('http');
          await new Promise((resolve, reject) => {
            const req = http.get('http://127.0.0.1:11434/api/tags', { timeout: 3000 }, (r) => {
              let body = '';
              r.on('data', c => body += c);
              r.on('end', () => {
                entry.status = r.statusCode === 200 ? 'ok' : 'down';
                try { entry.models = JSON.parse(body).models?.map(m => `ollama/${m.name}`) || []; } catch {}
                resolve();
              });
            });
            req.on('error', () => { entry.status = 'down'; entry.reason = 'Ollama not running'; resolve(); });
            req.on('timeout', () => { req.destroy(); entry.status = 'down'; entry.reason = 'Timeout'; resolve(); });
          });
        } catch { entry.status = 'down'; }
      } else if (providerId === 'openai-codex' || providerId === 'openai') {
        // Check OAuth token expiry
        try {
          const credsPath = path.join(process.env.OPENCLAW_STATE_DIR || '/opt/AIWH/.openclaw', 'credentials', 'oauth.json');
          if (fs.existsSync(credsPath)) {
            const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
            const openaiCreds = creds?.['openai-codex'] || creds?.openai || {};
            if (openaiCreds.expires) {
              const expiresAt = new Date(openaiCreds.expires);
              entry.status = expiresAt > new Date() ? 'ok' : 'degraded';
              if (entry.status === 'degraded') entry.reason = 'OAuth token expired — reconnect in Settings > AI Providers';
            } else if (openaiCreds.access) {
              entry.status = 'ok';
            } else {
              entry.status = hasApiKey ? 'ok' : 'degraded';
              if (entry.status === 'degraded') entry.reason = 'No OAuth token found';
            }
          } else {
            entry.status = hasApiKey ? 'ok' : 'down';
            if (entry.status === 'down') entry.reason = 'No credentials configured';
          }
        } catch { entry.status = 'unknown'; }
        if (!entry.models.length) entry.models = ['openai-codex/gpt-5.4'];
      } else if (providerId === 'anthropic') {
        entry.status = hasApiKey ? 'ok' : 'down';
        if (!hasApiKey) entry.reason = 'No API key configured';
        if (!entry.models.length) entry.models = ['anthropic/claude-haiku-4-5', 'anthropic/claude-sonnet-4-5', 'anthropic/claude-opus-4-6'];
      } else if (providerId === 'openrouter') {
        entry.status = hasApiKey ? 'ok' : 'down';
        if (!hasApiKey) entry.reason = 'No API key configured';
      }

      providers.push(entry);
    }
  } catch (e) {
    return res.status(500).json({ error: 'Failed to check providers: ' + e.message });
  }
  res.json({ providers });
});

// ─── ROUTES: Scheduler / Cron ───────────────────────────────
app.get('/api/schedules', (req, res) => {
  const local = db.prepare('SELECT * FROM schedules ORDER BY name').all();
  const scripts = scriptScheduler.list();
  res.json({ local, openclaw: deps.cronJobsCache, scripts });
});

app.get('/api/cron/sync', (req, res) => {
  const jobs = adapter.getCronJobs();
  deps.setCronJobsCache(jobs);
  res.json({ jobs: jobs.length });
});

// ─── Cron ID Validation ──────────────────────────────────────
const CRON_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
function validateCronId(req, res) {
  if (!CRON_ID_RE.test(req.params.id)) {
    res.status(400).json({ error: 'Invalid cron ID format' });
    return false;
  }
  return true;
}

// ─── Cron Toggle / Trigger ───────────────────────────────────
app.post('/api/cron/:id/toggle', (req, res) => {
  if (!validateCronId(req, res)) return;
  const { enabled } = req.body;
  try {
    const action = enabled ? 'enable' : 'disable';
    execFileSync(OPENCLAW_BIN, ['cron', action, req.params.id], { timeout: 10000, env: OC_ENV });
    deps.setCronJobsCache(adapter.getCronJobs());
    logAudit(db, { actor: resolveActor(req), action: `cron.${action}`, target: req.params.id, detail: { cronId: req.params.id, enabled }, ip: req.ip });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Auto-provision crons from templates based on client preferences
app.post('/api/cron/provision', (req, res) => {
  try {
    const cronProvisioner = require('../helpers/cron-provisioner');
    const prefsPath = path.join(process.env.CLIENT_ROOT || '/opt/AIWH/client', 'config', 'client-preferences.json');
    const prefs = fs.existsSync(prefsPath) ? JSON.parse(fs.readFileSync(prefsPath, 'utf8')) : {};
    const result = cronProvisioner.provisionCronsForClient(prefs, {
      scriptScheduler: deps.scriptScheduler || scriptScheduler,
      adapter: deps.adapter || adapter,
    });
    deps.setCronJobsCache(adapter.getCronJobs());
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Repair delivery channel on all com.aiwh.* crons from notifications.json
app.post('/api/cron/repair-delivery', (req, res) => {
  try {
    const cronProvisioner = require('../helpers/cron-provisioner');
    const result = cronProvisioner.repairCronDelivery({
      adapter: deps.adapter || adapter,
    });
    deps.setCronJobsCache(adapter.getCronJobs());
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/cron/add', (req, res) => {
  const { name, agent, cron, tz, message, description, isolated, model, channel, to } = req.body;
  if (!name || !cron || !message) return res.status(400).json({ error: 'name, cron, and message required' });
  try {
    const args = ['cron', 'add', '--name', name, '--cron', cron, '--message', message];
    if (agent) args.push('--agent', agent);
    if (tz) args.push('--tz', tz);
    if (description) args.push('--description', description);
    if (isolated) args.push('--session', 'isolated');
    if (model) args.push('--model', model);
    if (channel) args.push('--channel', channel);
    if (to) args.push('--to', to);
    if (channel || to) args.push('--announce');
    execFileSync(OPENCLAW_BIN, args, { timeout: 10000, env: OC_ENV });
    deps.setCronJobsCache(adapter.getCronJobs());
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/cron/:id/edit', (req, res) => {
  if (!validateCronId(req, res)) return;
  const { cron, tz, description, message, session, model, channel, to } = req.body;
  try {
    const args = ['cron', 'edit', req.params.id];
    if (cron) args.push('--cron', cron);
    if (tz) args.push('--tz', tz);
    if (description) args.push('--description', description);
    if (message) args.push('--message', message);
    if (session) args.push('--session', session);
    if (model) args.push('--model', model);
    if (channel) args.push('--channel', channel);
    if (to) args.push('--to', to);
    execFileSync(OPENCLAW_BIN, args, { timeout: 10000, env: OC_ENV });
    deps.setCronJobsCache(adapter.getCronJobs());
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/cron/:id', (req, res) => {
  if (!validateCronId(req, res)) return;
  try {
    execFileSync(OPENCLAW_BIN, ['cron', 'rm', req.params.id], { timeout: 10000, env: OC_ENV });
    deps.setCronJobsCache(adapter.getCronJobs());
    logActivity(null, 'system', 'cron_deleted', req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Notification Routing (client-owned, channel-agnostic) ───
const NOTIF_CONFIG_PATH = path.join(process.env.CLIENT_ROOT || '/opt/AIWH/client', 'config', 'notifications.json');

app.get('/api/notification-routing', (req, res) => {
  try {
    const config = fs.existsSync(NOTIF_CONFIG_PATH)
      ? JSON.parse(fs.readFileSync(NOTIF_CONFIG_PATH, 'utf8'))
      : {};
    res.json(config);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/notification-routing', (req, res) => {
  try {
    const config = req.body;
    if (!config || typeof config !== 'object') {
      return res.status(400).json({ error: 'Body must be a JSON object with category routing' });
    }
    // Validate structure: each key must have channel + target
    const VALID_CATEGORIES = ['general', 'systems', 'publish', 'spend', 'security', 'failover'];
    const CHANNEL_RE = /^[a-z][a-z0-9-]{0,30}$/;
    for (const [cat, routing] of Object.entries(config)) {
      if (!VALID_CATEGORIES.includes(cat)) {
        return res.status(400).json({ error: `Unknown category: ${cat}` });
      }
      if (!routing || typeof routing !== 'object') {
        return res.status(400).json({ error: `Invalid routing for category: ${cat}` });
      }
      if (!routing.channel || !routing.target) {
        return res.status(400).json({ error: `${cat} must have channel and target` });
      }
      if (!CHANNEL_RE.test(routing.channel)) {
        return res.status(400).json({ error: `Invalid channel name: ${routing.channel}` });
      }
      if (typeof routing.target !== 'string' || routing.target.length > 100) {
        return res.status(400).json({ error: `Invalid target for ${cat}` });
      }
    }
    fs.writeFileSync(NOTIF_CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
    // Propagate to all agent crons
    const cronProvisioner = require('../helpers/cron-provisioner');
    const repairResult = cronProvisioner.repairCronDelivery({
      adapter: deps.adapter || adapter,
    });
    deps.setCronJobsCache(adapter.getCronJobs());
    logActivity(null, 'system', 'notification_routing_updated', JSON.stringify(Object.keys(config)));
    res.json({ ok: true, repaired: repairResult.repaired.length, errors: repairResult.errors });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Test notification delivery for a category
app.post('/api/notification-routing/test', (req, res) => {
  try {
    const { category } = req.body || {};
    if (!category || typeof category !== 'string') {
      return res.status(400).json({ error: 'category is required' });
    }
    const config = fs.existsSync(NOTIF_CONFIG_PATH)
      ? JSON.parse(fs.readFileSync(NOTIF_CONFIG_PATH, 'utf8'))
      : {};
    // For failover, read the failover key directly — don't fall back to general
    const routing = config[category];
    if (!routing || !routing.channel || !routing.target) {
      return res.status(400).json({ error: `No routing configured for "${category}". Set a channel and target first, then save.` });
    }
    const { execFileSync } = require('child_process');
    const ocEnv = {
      ...process.env,
      OPENCLAW_STATE_DIR: '/opt/AIWH/.openclaw',
      PATH: `/opt/homebrew/bin:/opt/homebrew/sbin:${process.env.PATH || '/usr/bin:/bin'}`,
    };
    const label = category === 'failover' ? 'failover backup' : category;
    const msg = `Test notification from AIWH — ${label}`;
    execFileSync('/opt/homebrew/bin/openclaw', [
      'message', 'send', '--channel', routing.channel, '-t', routing.target, '-m', msg,
    ], { timeout: 10000, env: ocEnv });
    res.json({ ok: true, channel: routing.channel, target: routing.target });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Delivery queue health status
app.get('/api/delivery-queue/status', (req, res) => {
  try {
    const queueDir = path.join(process.env.OPENCLAW_STATE_DIR || '/opt/AIWH/.openclaw', 'delivery-queue');
    const failedDir = path.join(queueDir, 'failed');
    let pending = 0;
    let failed = 0;
    // Count pending messages in queue root (non-directory .json files)
    if (fs.existsSync(queueDir)) {
      const entries = fs.readdirSync(queueDir).filter(f => f.endsWith('.json'));
      pending = entries.length;
    }
    // Count failed messages
    if (fs.existsSync(failedDir)) {
      failed = fs.readdirSync(failedDir).filter(f => f.endsWith('.json')).length;
    }
    res.json({ pending, failed });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/cron/:id/runs', (req, res) => {
  if (!validateCronId(req, res)) return;
  const limit = parseInt(req.query.limit) || 10;
  const data = adapter.getCronRuns(req.params.id, limit);
  res.json(data);
});

app.post('/api/cron/:id/trigger', (req, res) => {
  if (!validateCronId(req, res)) return;
  try {
    const { spawn } = require('child_process');
    const proc = spawn('/opt/homebrew/bin/openclaw', ['cron', 'run', req.params.id], {
      env: { ...process.env, OPENCLAW_STATE_DIR: '/opt/AIWH/.openclaw', PATH: `/opt/homebrew/bin:/opt/homebrew/sbin:${process.env.PATH || '/usr/bin:/bin'}` },
      stdio: 'ignore',
      detached: true,
    });
    proc.unref();
    logActivity(null, 'system', 'cron_triggered', req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Script Crons (dashboard-managed, zero LLM cost) ────────
app.get('/api/script-crons', (req, res) => {
  res.json({ jobs: scriptScheduler.list() });
});

app.post('/api/script-crons', (req, res) => {
  try {
    const job = scriptScheduler.create(req.body);
    res.json({ ok: true, job });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/script-crons/:id', (req, res) => {
  try {
    const job = scriptScheduler.update(req.params.id, req.body);
    res.json({ ok: true, job });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/script-crons/:id', (req, res) => {
  try {
    scriptScheduler.remove(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/script-crons/:id/trigger', (req, res) => {
  try {
    scriptScheduler.trigger(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/script-crons/:id/runs', (req, res) => {
  const limit = parseInt(req.query.limit) || 15;
  res.json({ runs: scriptScheduler.getRuns(req.params.id, limit) });
});

// ─── Trash Management ────────────────────────────────────────

// Ensure trash_manifest table exists
db.exec(`
  CREATE TABLE IF NOT EXISTS trash_manifest (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    original_path TEXT NOT NULL,
    trash_path TEXT NOT NULL,
    gdrive_file_id TEXT,
    gdrive_folder_id TEXT,
    gdrive_folder_path TEXT,
    file_size INTEGER NOT NULL DEFAULT 0,
    verified INTEGER NOT NULL DEFAULT 0,
    trashed_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT,
    source TEXT DEFAULT 'media-archive'
  );
  CREATE INDEX IF NOT EXISTS idx_trash_manifest_deleted ON trash_manifest(deleted_at);
`);

app.get('/api/trash/manifest', (req, res) => {
  const items = db.prepare(`
    SELECT * FROM trash_manifest WHERE deleted_at IS NULL ORDER BY trashed_at DESC
  `).all();
  res.json({ items });
});

app.get('/api/trash/stats', (req, res) => {
  const stats = db.prepare(`
    SELECT
      COUNT(*) as total_files,
      COALESCE(SUM(file_size), 0) as total_size,
      SUM(CASE WHEN verified = 1 THEN 1 ELSE 0 END) as verified,
      SUM(CASE WHEN verified = 1 AND deleted_at IS NULL
        AND datetime(trashed_at, '+48 hours') <= datetime('now') THEN 1 ELSE 0 END) as deletable
    FROM trash_manifest WHERE deleted_at IS NULL
  `).get();
  res.json(stats);
});

app.delete('/api/trash/:id', (req, res) => {
  const item = db.prepare('SELECT * FROM trash_manifest WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!item) return res.json({ ok: false, error: 'Not found' });
  if (!item.verified) return res.json({ ok: false, error: 'File not verified on GDrive — cannot delete' });

  const trashedAt = new Date(item.trashed_at);
  const hoursAgo = (Date.now() - trashedAt.getTime()) / 3600000;
  if (hoursAgo < 48) return res.json({ ok: false, error: `48-hour cooldown not met (${Math.ceil(48 - hoursAgo)}h remaining)` });

  try {
    if (fs.existsSync(item.trash_path)) {
      fs.unlinkSync(item.trash_path);  // Individual file delete, NEVER rm -rf
    }
    db.prepare('UPDATE trash_manifest SET deleted_at = datetime(?) WHERE id = ?').run(new Date().toISOString(), item.id);
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.post('/api/trash/delete-ready', (req, res) => {
  const ready = db.prepare(`
    SELECT * FROM trash_manifest
    WHERE deleted_at IS NULL AND verified = 1
    AND datetime(trashed_at, '+48 hours') <= datetime('now')
  `).all();

  let deleted = 0, errors = 0;
  for (const item of ready) {
    try {
      if (fs.existsSync(item.trash_path)) {
        fs.unlinkSync(item.trash_path);  // One file at a time
      }
      db.prepare('UPDATE trash_manifest SET deleted_at = datetime(?) WHERE id = ?').run(new Date().toISOString(), item.id);
      deleted++;
    } catch {
      errors++;
    }
  }
  res.json({ ok: true, deleted, errors, total: ready.length });
});

let _archiverJob = { status: 'idle', progress: '', error: null };

app.post('/api/trash/run-archiver', (req, res) => {
  if (_archiverJob.status === 'running') return res.json({ ok: false, error: 'Archiver already running' });

  const { spawn } = require('child_process');
  _archiverJob = { status: 'running', progress: 'Starting archiver...', error: null };

  const child = spawn('/opt/homebrew/bin/bash', ['/opt/AIWH/core/scripts/media-archive-daily.sh'], {
    env: { ...process.env, CLIENT_ROOT: process.env.CLIENT_ROOT || '/opt/AIWH/client', PATH: `/opt/homebrew/bin:/opt/homebrew/sbin:${process.env.PATH}` },
  });

  child.stdout.on('data', (d) => {
    const line = d.toString().trim();
    if (line) _archiverJob.progress = line;
  });
  child.stderr.on('data', (d) => {
    const line = d.toString().trim();
    if (line) _archiverJob.progress = line;
  });
  child.on('close', (code) => {
    _archiverJob.status = code === 0 ? 'done' : 'error';
    if (code !== 0) _archiverJob.error = `Exited with code ${code}`;
  });

  res.json({ ok: true, status: 'running' });
});

app.get('/api/trash/archiver-progress', (req, res) => {
  res.json(_archiverJob);
});

// ─── Debug / System ──────────────────────────────────────────
app.post('/api/debug/gateway-restart', (req, res) => {
  try {
    execFileSync(OPENCLAW_BIN, ['gateway', 'restart'], { timeout: 15000, encoding: 'utf8', env: OC_ENV });
    logAudit(db, { actor: resolveActor(req), action: 'gateway.restart', target: 'openclaw-gateway', detail: { trigger: 'manual' }, ip: req.ip });
    dashLog('gateway_restart', 'Manual restart via dashboard');
    res.json({ ok: true, message: 'Gateway restart initiated' });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.get('/api/debug/doctor', (req, res) => {
  try {
    const output = execFileSync(OPENCLAW_BIN, ['doctor'], { timeout: 30000, encoding: 'utf8', env: OC_ENV });
    res.json({ ok: true, output });
  } catch (e) {
    res.json({ ok: false, output: e.stdout || e.message });
  }
});

app.get('/api/debug/system-info', (req, res) => {
  const os = require('os');
  // On macOS, os.freemem() only shows truly free pages — not purgeable/cached.
  // Use vm_stat to get a more accurate picture of available memory.
  let availableMem = os.freemem();
  try {
    const vmstat = execFileSync('vm_stat', [], { timeout: 3000, encoding: 'utf8' });
    const pageSize = 16384; // ARM64 macOS page size
    const free = parseInt((vmstat.match(/Pages free:\s+(\d+)/) || [])[1] || '0');
    const inactive = parseInt((vmstat.match(/Pages inactive:\s+(\d+)/) || [])[1] || '0');
    const purgeable = parseInt((vmstat.match(/Pages purgeable:\s+(\d+)/) || [])[1] || '0');
    availableMem = (free + inactive + purgeable) * pageSize;
  } catch {}
  res.json({
    hostname: os.hostname(),
    platform: os.platform(),
    uptime: Math.round(os.uptime()),
    loadavg: os.loadavg(),
    totalMem: os.totalmem(),
    freeMem: availableMem,
    nodeVersion: process.version,
    dashboardUptime: Math.round(process.uptime()),
  });
});

// ─── Logs ────────────────────────────────────────────────────
app.get('/api/logs/list', (req, res) => {
  res.json(logStreamer.listLogs());
});

app.get('/api/logs/:logId', (req, res) => {
  const lines = Math.min(parseInt(req.query.lines) || 200, 2000);
  res.json(logStreamer.tailLog(req.params.logId, lines));
});

// ─── Notifications ───────────────────────────────────────────
app.get('/api/notifications', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  res.json(db.prepare('SELECT * FROM notifications ORDER BY created_at DESC LIMIT ?').all(limit));
});

app.get('/api/notifications/unread-count', (req, res) => {
  res.json({ count: notifEngine.getUnreadCount(db) });
});

app.post('/api/notifications/read-all', (req, res) => {
  db.prepare("UPDATE notifications SET read_at=datetime('now') WHERE read_at IS NULL").run();
  res.json({ ok: true });
});

app.put('/api/notifications/:id/read', (req, res) => {
  db.prepare("UPDATE notifications SET read_at=datetime('now') WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

};
