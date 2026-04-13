#!/usr/bin/env node
// ─── AIWH Mission Control v3 ────────────────────────────────
// Operational Command Centre on top of OpenClaw
// Port 3001 · Node + Express + Socket.io + SQLite
//
// Routes split into /routes/*.js, helpers in /helpers/*.js

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const { getDb } = require('./db');
const adapter = require('./openclaw-adapter');
const cinematicSync = require('./cinematic-sync');

// Initialize client databases on startup (ensures schemas exist for fresh installs)
try { require('child_process').execSync('node ' + path.join(__dirname, '..', 'scripts', 'db-init.js'), { stdio: 'inherit', timeout: 10000 }); }
catch (e) { console.warn('db-init.js warning:', e.message); }

const PORT = process.env.MC_PORT || 3001;

// ─── Core Modules ───────────────────────────────────────────
const costSync = require('./cost-sync');
const chatProxy = require('./chat-proxy');
const contentSync = require('./content-sync');
const notifEngine = require('./notification-engine');
const scriptScheduler = require('./script-scheduler');
const logStreamer = require('./log-streamer');

// ─── Helpers ────────────────────────────────────────────────
const { dashLog, now, logActivity } = require('./helpers/activity');
const { sendDiscordAlert } = require('./helpers/discord');
const { syncAgents, buildAgentAliasMap, getAgentsCache } = require('./helpers/agent-sync');
const { authMiddleware, registerAuthRoutes, isValidSession, getSessionFromCookie, isLocalhost } = require('./helpers/auth');
const rateLimit = require('express-rate-limit');

// ─── Express + Socket.io ────────────────────────────────────
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: ['http://localhost:3001', 'http://127.0.0.1:3001'] } });

app.use(express.json({ limit: '25mb' }));

// Sanitize error responses — strip internal filesystem paths (Phase 53.13)
const { errorSanitizer } = require('./helpers/errors');
app.use(errorSanitizer);

// Security headers (Phase 53.6)
const helmet = require('helmet');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-hashes'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      mediaSrc: ["'self'", "blob:"],
      connectSrc: ["'self'", "ws:", "wss:"],
      frameSrc: ["'self'"],
      frameAncestors: ["'self'"],
    }
  },
  crossOriginEmbedderPolicy: false,
}));

// CSRF protection: reject mutating requests from foreign origins
// Allow: no origin (curl/agents), localhost origins (dashboard browser)
// Block: any non-localhost origin (cross-site attack from browser)
app.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin || '';
  const referer = req.headers.referer || '';
  // No origin/referer = non-browser client (curl, agents) — allow (server is localhost-bound)
  if (!origin && !referer) return next();
  // Check origin first, then referer
  const checkVal = origin || referer;
  const allowed = ['http://localhost:', 'http://127.0.0.1:', 'https://localhost:', 'https://127.0.0.1:'];
  if (allowed.some(a => checkVal.startsWith(a))) return next();
  // Allow same-origin: browser Origin host must exactly match the Host header (LAN/Tailscale access)
  const host = req.headers.host || '';
  if (host) {
    try {
      const originHost = new URL(checkVal).host;
      if (originHost === host) return next();
    } catch { /* malformed origin — fall through to block */ }
  }
  console.log(`[CSRF] Blocked ${req.method} ${req.path} from origin: ${origin || referer}`);
  return res.status(403).json({ error: 'Forbidden: cross-origin request blocked' });
});

// ─── Rate Limiting (AC.5) ───────────────────────────────────
// Throttle remote API requests. Localhost (agents/scripts) is exempt.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => isLocalhost(req),
  message: { error: 'Too many requests. Please wait a moment.' },
});
app.use('/api/', apiLimiter);

// ─── Authentication ──────────────────────────────────────────
registerAuthRoutes(app, () => getDb());

app.use(authMiddleware);

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    // Prevent browser from caching HTML — ensures auth redirect works after restart
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));

// Serve WCC React app as static files under /wcc/
app.use('/wcc', express.static(path.join(__dirname, 'wcc-app/dist/public')));
// SPA fallback — serve index.html for all WCC sub-routes
app.get('/wcc/*', (req, res) => {
  res.sendFile(path.join(__dirname, 'wcc-app/dist/public/index.html'));
});

// ─── Database & Config ──────────────────────────────────────
const db = getDb();

// Ensure workflow tables exist (Theme AA)
try { require('./helpers/workflow-engine').ensureSchema(db); } catch (e) { console.warn('  ⚠️  Workflow schema:', e.message); }

// Initialize client departments.json from templates if missing (Theme AB.7)
try {
  if (!fs.existsSync(P.DEPARTMENTS_CONFIG)) {
    const templates = P.getCatalogues().departmentTemplates;
    if (templates?.departments) {
      fs.mkdirSync(path.dirname(P.DEPARTMENTS_CONFIG), { recursive: true });
      fs.writeFileSync(P.DEPARTMENTS_CONFIG, JSON.stringify({
        version: 1,
        description: 'Client department configuration. Editable via dashboard.',
        departments: templates.departments,
      }, null, 2));
      console.log('  ✅  Initialized client/config/departments.json from templates');
    }
  }
} catch (e) { console.warn('  ⚠️  Department init:', e.message); }

let dashConfig = {};
try {
  dashConfig = JSON.parse(fs.readFileSync(path.join(__dirname, 'dashboard.config.json'), 'utf8'));
} catch (e) {
  console.error('  ⚠️  Could not load dashboard.config.json:', e.message);
}

// ─── Org Chart Cache ────────────────────────────────────────
let orgChartCache = null;
function loadOrgChart() {
  if (orgChartCache) return orgChartCache;
  try {
    orgChartCache = JSON.parse(fs.readFileSync(path.join(__dirname, 'org-chart.json'), 'utf8'));
  } catch { orgChartCache = { hierarchy: null }; }

  // Merge client-created agents as a "Custom Agents" section
  try {
    const clientAgentsDir = path.join(process.env.CLIENT_ROOT || '/opt/AIWH/client', 'agents');
    if (fs.existsSync(clientAgentsDir)) {
      // Read default model from openclaw.json (same source as agent registration)
      let defaultModel = 'haiku';
      try {
        const oc = JSON.parse(fs.readFileSync(require('./helpers/paths').OPENCLAW_CONFIG, 'utf8'));
        const dm = oc.agents?.defaults?.model;
        if (typeof dm === 'string') defaultModel = dm;
        else if (dm?.primary) defaultModel = dm.primary;
      } catch { /* use defaults */ }

      const dirs = fs.readdirSync(clientAgentsDir, { withFileTypes: true })
        .filter(d => d.isDirectory() && !d.name.startsWith('.'));
      const customAgents = [];
      for (const d of dirs) {
        const deactivated = fs.existsSync(path.join(clientAgentsDir, d.name, '.deactivated'));
        if (deactivated) continue;
        const trashedPath = path.join(clientAgentsDir, d.name, '.trashed');
        const isTrashed = fs.existsSync(trashedPath);
        let trashedAt = null;
        if (isTrashed) {
          try { trashedAt = fs.readFileSync(trashedPath, 'utf8').trim(); } catch { /* */ }
        }
        // Read name from SOUL.md first line
        let name = d.name;
        try {
          const soul = fs.readFileSync(path.join(clientAgentsDir, d.name, 'SOUL.md'), 'utf8');
          const firstLine = soul.split('\n')[0] || '';
          name = firstLine.replace(/^#\s*/, '').trim() || d.name;
        } catch { /* use dir name */ }
        const agent = { id: d.name, displayName: name, title: 'Custom Agent', description: '', model: defaultModel };
        if (isTrashed) { agent.trashed = true; agent.trashedAt = trashedAt; }
        customAgents.push(agent);
      }
      if (customAgents.length > 0 && orgChartCache?.hierarchy?.commandCentres) {
        // Remove existing custom section if stale
        orgChartCache.hierarchy.commandCentres = orgChartCache.hierarchy.commandCentres.filter(cc => cc.id !== 'custom');
        orgChartCache.hierarchy.commandCentres.push({
          id: 'custom', name: 'Your Agents', icon: '',
          departments: [{ id: 'custom', name: 'Custom', agents: customAgents }],
        });
      }
    }
  } catch { /* ignore client agent scan errors */ }

  return orgChartCache;
}

// ─── Cron Cache ─────────────────────────────────────────────
let cronJobsCache = [];

// ─── Shared Dependencies Object ─────────────────────────────
// Passed to all route modules so they can access shared state
const deps = {
  db, io, adapter, chatProxy, costSync, contentSync, cinematicSync,
  notifEngine, scriptScheduler, logStreamer, dashConfig,
  dashLog, sendDiscordAlert, now,
  logActivity: (projectId, agentId, action, detail) => logActivity({ db, io }, projectId, agentId, action, detail),
  get agentsFullCache() { return getAgentsCache(); },
  buildAgentAliasMap: () => buildAgentAliasMap(db),
  loadOrgChart,
  setOrgChartCache: (v) => { orgChartCache = v; },
  get cronJobsCache() { return cronJobsCache; },
  setCronJobsCache: (v) => { if (Array.isArray(v)) cronJobsCache = v; },
  // Sub-object expected by routes/agents.js
  agentSync: {
    agentsFullCache: () => getAgentsCache(),
    loadOrgChart,
    logActivity: (projectId, agentId, action, detail) => logActivity({ db, io }, projectId, agentId, action, detail),
    setOrgChartCache: (v) => { orgChartCache = v; },
  },
};

// ─── Command Centre Gating ─────────────────────────────────
const P = require('./helpers/paths');
const CLIENT_ROOT = P.CLIENT_ROOT;

// SECURITY (AC.5): Harden file permissions on sensitive config files at startup
(function hardenFilePermissions() {
  const sensitive = [
    path.join(CLIENT_ROOT, 'config', 'rbac-policy.json'),
    path.join(CLIENT_ROOT, 'config', 'security-overrides.json'),
    path.join(CLIENT_ROOT, 'config', 'departments.json'),
    path.join(CLIENT_ROOT, 'config', 'device-registration.json'),
    path.join(process.env.AIWH_CORE_ROOT || '/opt/AIWH/core', 'config', 'license.json'),
  ];
  let hardened = 0;
  for (const f of sensitive) {
    try { if (fs.existsSync(f)) { fs.chmodSync(f, 0o600); hardened++; } } catch {}
  }
  if (hardened > 0) console.log(`  🔒 Hardened ${hardened} config file(s) to 0600`);
})();

// License info (command_centres_active for dashboard gating)
const LICENSE_PATH = P.LICENSE_CONFIG;
let _licenseCache = null;
let _licenseCacheMtime = 0;

function getLicense() {
  try {
    const stat = fs.statSync(LICENSE_PATH);
    if (_licenseCache && stat.mtimeMs === _licenseCacheMtime) return _licenseCache;
    _licenseCache = JSON.parse(fs.readFileSync(LICENSE_PATH, 'utf8'));
    _licenseCacheMtime = stat.mtimeMs;
    return _licenseCache;
  } catch {
    return { command_centres_active: ['business', 'wealth', 'life'] }; // default: all active
  }
}

// Command centres config (product-owned)
function getCommandCentres() {
  try {
    return P.getCatalogues().commandCentres;
  } catch {
    return { command_centres: {}, system_agents: [], orchestrator: 'main' };
  }
}

app.get('/api/command-centres', (req, res) => {
  const cc = getCommandCentres();
  const lic = getLicense();
  const active = lic.command_centres_active || [];
  const result = {};
  for (const [id, def] of Object.entries(cc.command_centres || {})) {
    result[id] = { ...def, active: active.includes(id) };
  }
  res.json({ command_centres: result, system_agents: cc.system_agents, orchestrator: cc.orchestrator });
});

// ─── Legacy Module Endpoints (compat for compiled frontend) ──
// The compiled dashboard frontend still reads /api/modules and modules_active.
// These shims translate CC state to the old module format until AB.2 rebuilds the frontend.
// TODO(AB.2): Remove these once frontend is rebuilt with CC-native code.

const MODULES_PATH = path.join(CLIENT_ROOT, 'config', 'modules.json');

function ccToModulesActive() {
  const lic = getLicense();
  const active = lic.command_centres_active || [];
  // Map CCs → old module names so the compiled frontend unlocks correctly
  const modules = [];
  if (active.includes('business')) { modules.push('frontend', 'backend'); }
  if (active.includes('life') || active.includes('wealth')) { modules.push('lifestyle'); }
  return modules;
}

app.get('/api/modules', (req, res) => {
  // Try client modules.json first (may have per-agent toggles)
  try {
    const data = JSON.parse(fs.readFileSync(MODULES_PATH, 'utf8'));
    res.json(data);
    return;
  } catch {}
  // Fallback: derive from CC state — mark all modules as enabled
  const active = ccToModulesActive();
  res.json({
    frontend: { enabled: active.includes('frontend'), features: {} },
    backend:  { enabled: active.includes('backend'),  features: {} },
    lifestyle: { enabled: active.includes('lifestyle'), features: { wcc: { enabled: true } } },
    system:   { enabled: true, features: {} },
  });
});

// Health endpoint — returns latest heartbeat data (no auth needed for monitoring)
app.get('/api/health', (req, res) => {
  const healthFile = path.join(CLIENT_ROOT, 'logs', 'health.json');
  try {
    if (fs.existsSync(healthFile)) {
      const health = JSON.parse(fs.readFileSync(healthFile, 'utf8'));
      res.json(health);
    } else {
      res.json({ status: 'no-heartbeat', message: 'Heartbeat has not run yet' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Gateway connection info — for browser-side GatewayBrowserClient
// SECURITY (AC.5): Always require a valid session — this endpoint returns the gateway auth token.
// Overrides localhost bypass. Browser always has session cookie.
// Scripts that need the token read openclaw.json or dashboard.config.json directly.
app.get('/api/gateway-info', (req, res) => {
  try {
    const session = getSessionFromCookie(req.headers.cookie);
    if (!session) {
      return res.status(401).json({ error: 'Authentication required for gateway access.' });
    }
    const cfgPath = path.join(__dirname, 'dashboard.config.json');
    const cfg = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, 'utf8')) : {};
    // Use the requesting host's hostname so browser can reach gateway from LAN/Tailscale
    const reqHost = (req.headers.host || '127.0.0.1:3001').split(':')[0];
    const gwUrl = `ws://${reqHost}:18789`;
    // Token: prefer dashboard.config.json, fallback to openclaw.json
    let token = cfg.gateway?.token || '';
    if (!token) {
      try {
        const stateDir = process.env.OPENCLAW_STATE_DIR || '/opt/AIWH/.openclaw';
        const ocCfg = JSON.parse(fs.readFileSync(path.join(stateDir, 'openclaw.json'), 'utf8'));
        token = ocCfg.gateway?.auth?.token || '';
      } catch {}
    }
    res.json({ url: gwUrl, token });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/license', (req, res) => {
  const lic = getLicense();
  res.json({
    client_id: lic.client_id,
    command_centres_active: lic.command_centres_active || [],
    // Legacy compat for compiled frontend (TODO: remove in AB.2)
    modules_active: ccToModulesActive(),
    modules_installed: ccToModulesActive(),
    valid_until: lic.valid_until,
    subscription_active: lic.subscription_active,
  });
});

// ─── Wealth Data Persistence (per-user isolated — AB.12.6) ──
app.get('/api/wealth/data', (req, res) => {
  try {
    const userId = req.user?.userId || 'default';
    const row = db.prepare("SELECT data, updated_at FROM wealth_data WHERE user_id = ?").get(userId);
    if (row) {
      res.json({ data: JSON.parse(row.data), updated_at: row.updated_at });
    } else {
      res.json({ data: null });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/wealth/data', (req, res) => {
  try {
    const userId = req.user?.userId || 'default';
    const { data } = req.body;
    if (!data) return res.status(400).json({ error: 'Missing data' });
    const json = typeof data === 'string' ? data : JSON.stringify(data);
    db.prepare(`
      INSERT INTO wealth_data (id, data, user_id, updated_at) VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = datetime('now')
    `).run(userId, json, userId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Audit Trail Middleware (Theme AB.2) ────────────────────
const { auditMiddleware, archiveAndCleanup } = require('./helpers/audit');
app.use(auditMiddleware(() => deps.db));
archiveAndCleanup(deps.db); // archive + cleanup on startup
// Fix legacy: users who changed password but status stuck on 'pending'
try { deps.db.prepare("UPDATE users SET status='active' WHERE must_change_password=0 AND status='pending'").run(); } catch {}
setInterval(() => archiveAndCleanup(deps.db), 24 * 60 * 60 * 1000); // daily

// ─── RBAC Route Guards (Theme AB.11 + AB.12.5) ──────────────
// Owner-only routes are hardcoded (not configurable — security baseline).
// Other routes use requireAction() which reads from client/config/rbac-policy.json.
const { requireRole, requireAction } = require('./helpers/rbac');

// Owner-only (hardcoded — never configurable by client)
app.use('/api/security', requireRole('owner'));
app.use('/api/approvals', requireRole('owner'));
app.use('/api/license', requireRole('owner'));

// Policy-driven routes (owner can toggle for admin/team via dashboard)
app.use('/api/users', requireAction('manage_users'));
app.use('/api/team', requireAction('manage_users'));
app.use('/api/connectors', requireAction('manage_connectors'));
app.use('/api/channels', requireAction('manage_channels'));
app.use('/api/providers', requireAction('manage_providers'));
app.use('/api/workflows', requireAction('manage_workflows'));
app.use('/api/knowledge', requireAction('manage_knowledge'));
app.use('/api/audit-log', requireAction('view_audit'));
app.use('/api/system', requireAction('manage_system'));

// ─── Register Routes ────────────────────────────────────────
// Expose deps to routes that use req.app.get() (e.g., cron-provisioner)
app.set('scriptScheduler', scriptScheduler);
app.set('adapter', adapter);
app.use('/api/onboarding', require('./routes/onboarding'));
require('./routes/projects')(app, deps);
const tasksRoutes = require('./routes/tasks')(app, deps);
require('./routes/agents')(app, deps);
require('./routes/providers')(app);
require('./routes/chat')(app, deps);
require('./routes/chat-voice')(app);
require('./routes/costs')(app, deps);
require('./routes/content')(app, deps);
require('./routes/cinematic')(app, deps);
require('./routes/channels')(app, deps);
require('./routes/channels-groups')(app, deps);
require('./routes/system')(app, deps);
require('./routes/knowledge')(app, deps);
require('./routes/security')(app);
require('./routes/exec-approvals')(app);
require('./routes/team')(app, deps);
require('./routes/social')(app, deps);
require('./routes/social-hub')(app, deps);
require('./routes/platform-formats')(app);
require('./routes/studio')(app, deps);
require('./routes/workflows')(app, deps);
require('./routes/media-serve')(app);
require('./routes/connectors')(app, deps);
require('./routes/departments')(app, deps);
// SECURITY (AC.5): RBAC guards on client agent management
app.post('/api/agents/create', requireAction('create_agents'));
app.post('/api/agents/:id/deactivate', requireAction('create_agents'));
app.post('/api/agents/:id/trash', requireAction('create_agents'));
app.post('/api/agents/:id/restore', requireAction('create_agents'));
app.delete('/api/agents/:id', requireRole('owner'));
require('./routes/client-agents')(app, deps);
require('./routes/users')(app, deps);
app.use('/api/audit-log', require('./routes/audit')(deps));

// ─── RBAC Policy API (Theme AB.12.5) ────────────────────────
const { loadPolicy, clearPolicyCache } = require('./helpers/rbac');
const POLICY_PATH = path.join(process.env.CLIENT_ROOT || '/opt/AIWH/client', 'config', 'rbac-policy.json');

app.get('/api/rbac-policy', (req, res) => {
  if (!req.user || req.user.role !== 'owner') return res.status(403).json({ error: 'Owner only' });
  res.json(loadPolicy());
});

app.put('/api/rbac-policy', (req, res) => {
  if (!req.user || req.user.role !== 'owner') return res.status(403).json({ error: 'Owner only' });
  const policy = req.body;
  if (!policy?.roles) return res.status(400).json({ error: 'Invalid policy format' });
  // Validate structure: roles must only contain admin and team
  const allowed = ['admin', 'team'];
  for (const role of Object.keys(policy.roles)) {
    if (!allowed.includes(role)) return res.status(400).json({ error: `Invalid role: ${role}. Only admin and team are configurable.` });
  }
  try {
    fs.writeFileSync(POLICY_PATH, JSON.stringify(policy, null, 2), { mode: 0o600 });
    clearPolicyCache();
    const { logAudit } = require('./helpers/audit');
    logAudit(deps.db, { actor: `user:${req.user.email}`, action: 'rbac_policy.update', target: 'rbac-policy.json', detail: { roles: Object.keys(policy.roles) }, userId: req.user.userId, ip: req.ip });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── License Validation (Theme AB.2) ────────────────────────
const licenseRoute = require('./routes/license');
licenseRoute.register(app);
const _licStatus = licenseRoute.getLicenseStatus();
if (_licStatus.status === 'expired') console.warn(`⚠ LICENSE EXPIRED — valid_until: ${_licStatus.valid_until}`);
else if (_licStatus.status === 'expiring') console.warn(`⚠ License expiring in ${_licStatus.days_remaining} days`);
else if (_licStatus.status === 'grace') console.warn(`⚠ License in grace period — heartbeat failing`);

// ─── Client Extensions (Theme AB.2) ────────────────────────
const extensions = require('./routes/extensions');
extensions.discoverExtensions();
extensions.register(app);

// ─── Socket.io ──────────────────────────────────────────────
// Authenticate WebSocket connections via session cookie
io.use((socket, next) => {
  const cookie = socket.handshake.headers.cookie;
  if (isValidSession(cookie)) return next();
  // Allow localhost connections without auth (internal agents, scripts)
  const addr = socket.handshake.address;
  if (addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1') return next();
  next(new Error('Authentication required'));
});

io.on('connection', (socket) => {
  console.log('  ↳ Client connected');
  socket.on('disconnect', () => console.log('  ↳ Client disconnected'));
});

// ─── Periodic Sync ──────────────────────────────────────────
// Sync agents every 60s
setInterval(() => {
  try { syncAgents(db, adapter); } catch (e) { console.error('Agent sync error:', e.message); }
}, 60000);

// Sync cron jobs every 2 min
setInterval(() => {
  try {
    const jobs = adapter.getCronJobs();
    if (jobs.length > 0) cronJobsCache = jobs;
  } catch (e) { console.error('Cron sync error:', e.message); }
}, 120000);

// Sync costs every 2 min
setInterval(() => {
  try {
    costSync.syncCostsToDb(db);
    costSync.syncAgentStatus(db);
  } catch (e) { console.error('Cost sync error:', e.message); }
}, 120000);

// Push dashboard refresh every 30s
setInterval(() => {
  io.emit('refresh', { timestamp: now() });
}, 30000);

// Process task queue every 10s
if (tasksRoutes && tasksRoutes.processTaskQueue) {
  setInterval(tasksRoutes.processTaskQueue, 10000);
}

// Check notifications every 2 min
setInterval(() => {
  try {
    notifEngine.checkCostThresholds(db, costSync.getDailySpend(), costSync.getMonthlySpend());
    notifEngine.checkCronHealth(db, cronJobsCache);
    const unread = notifEngine.getUnreadCount(db);
    if (unread > 0) io.emit('notifications', { unread });
  } catch (e) { console.error('Notification check error:', e.message); }
}, 120000);

// ─── Startup ────────────────────────────────────────────────
// Wire alias map builder into chat proxy
chatProxy.setBuildAliasMap(() => buildAgentAliasMap(db));

try {
  const agents = syncAgents(db, adapter);
  console.log(`  ✅ ${agents.length} agents discovered from openclaw.json`);
} catch (e) {
  console.error('  ⚠️  Agent discovery failed:', e.message);
}

try {
  cronJobsCache = adapter.getCronJobs();
  console.log(`  ✅ ${cronJobsCache.length} cron jobs loaded`);
} catch (e) {
  console.error('  ⚠️  Cron sync failed:', e.message);
}

try {
  scriptScheduler.init(db);
} catch (e) {
  console.error('  ⚠️  Script scheduler failed:', e.message);
}

// Initial cost sync
try {
  const result = costSync.syncCostsToDb(db);
  console.log(`  ✅ Cost sync from log: ${result.synced} entries, $${result.total.toFixed(2)} total`);
  console.log(`  ✅ Today's spend: $${costSync.getDailySpend().toFixed(2)}`);

  const statuses = costSync.syncAgentStatus(db);
  const activeCount = Array.from(statuses.values()).filter(s => s.status === 'active').length;
  console.log(`  ✅ Agent status: ${activeCount} active, ${statuses.size} tracked`);
} catch (e) {
  console.error('  ⚠️  Cost sync failed:', e.message);
}

// Recover orphaned runs
try {
  const orphanedRuns = db.prepare("SELECT id, task_id, agent_id FROM runs WHERE status='running'").all();
  if (orphanedRuns.length > 0) {
    for (const run of orphanedRuns) {
      db.prepare("UPDATE runs SET status='failed', finished_at=datetime('now') WHERE id=?").run(run.id);
      if (run.task_id) {
        db.prepare("UPDATE tasks SET status='blocked', dispatch_run_id=NULL, updated_at=datetime('now') WHERE id=?").run(run.task_id);
      }
      if (run.agent_id) {
        db.prepare("UPDATE agents SET status='idle' WHERE id=?").run(run.agent_id);
      }
      notifEngine.createNotification(db, {
        type: 'task_failed',
        title: `Orphaned run recovered: #${run.id}`,
        body: `Server restarted while run was active. Task moved to blocked.`,
        priority: 'high',
        agentId: run.agent_id,
      });
    }
    console.log(`  ⚠️  Recovered ${orphanedRuns.length} orphaned run(s)`);
  }
  db.prepare("UPDATE task_queue SET status='queued' WHERE status='dispatching'").run();
} catch (e) {
  console.error('  ⚠️  Orphan recovery failed:', e.message);
}

// Start log watcher
try {
  logStreamer.startLogWatcher(io);
  console.log('  ✅ Log watcher started');
} catch (e) {
  console.error('  ⚠️  Log watcher failed:', e.message);
}

// ─── Listen ─────────────────────────────────────────────────
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`  ❌ Port ${PORT} already in use. Kill the existing process or change MC_PORT.`);
    process.exit(1);
  }
  throw e;
});

// SECURITY: Default to localhost-only. Tailscale serve proxies remote access.
// Override with MC_BIND=0.0.0.0 if LAN access needed without Tailscale.
const BIND_HOST = process.env.MC_BIND || '127.0.0.1';
server.listen(PORT, BIND_HOST, () => {
  console.log(`\n  🎛️  Mission Control v3 → http://${BIND_HOST}:${PORT}\n`);
});

// ─── Log Rotation (startup + daily) ─────────────────────────
function rotateLogs() {
  const logDir = '/tmp/openclaw';
  const maxAgeDays = 3;
  const maxSizeBytes = 20 * 1024 * 1024; // 20MB
  try {
    if (!fs.existsSync(logDir)) return;
    const cutoff = Date.now() - maxAgeDays * 86400000;
    for (const f of fs.readdirSync(logDir)) {
      if (!f.endsWith('.log')) continue;
      const fp = path.join(logDir, f);
      const stat = fs.statSync(fp);
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(fp);
        dashLog('log_rotation', `Deleted old log: ${f} (${(stat.size / 1024 / 1024).toFixed(1)}MB)`);
      } else if (stat.size > maxSizeBytes) {
        // Truncate to last 5MB
        const buf = Buffer.alloc(5 * 1024 * 1024);
        const fd = fs.openSync(fp, 'r');
        fs.readSync(fd, buf, 0, buf.length, stat.size - buf.length);
        fs.closeSync(fd);
        fs.writeFileSync(fp, buf);
        dashLog('log_rotation', `Truncated ${f}: ${(stat.size / 1024 / 1024).toFixed(1)}MB → 5MB`);
      }
    }
  } catch (e) { console.log('[log-rotation] Error:', e.message); }
}
rotateLogs();
setInterval(rotateLogs, 86400000); // daily
