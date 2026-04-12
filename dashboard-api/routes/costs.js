// ─── Routes: Costs + Dashboard Overview + Settings + Subscriptions ──
const fs = require('fs');
const path = require('path');

module.exports = function(app, deps) {
  const { db, io, costSync, dashConfig, dashLog, adapter } = deps;
const { logAudit, resolveActor } = require('../helpers/audit');

// ─── ROUTES: Costs ──────────────────────────────────────────
app.get('/api/costs', (req, res) => {
  const dailyBudget = parseFloat(db.prepare("SELECT value FROM settings WHERE key='daily_budget'").get()?.value || '5');
  const monthlyBudget = parseFloat(db.prepare("SELECT value FROM settings WHERE key='monthly_budget'").get()?.value || '100');

  // Real spend from OpenClaw session files (every message counted)
  const modelSpend = costSync.getModelSpend();
  const platformSpend = costSync.getPlatformSpend();

  // OpenClaw API spend (actual per-message costs)
  const openclawDaily = Object.values(modelSpend.daily).reduce((s, v) => s + v, 0);
  const openclawMonthly = Object.values(modelSpend.monthly).reduce((s, v) => s + v, 0);

  // Platform spend (cinematic ledger: Imagen, Veo, ElevenLabs, HeyGen)
  const platformDaily = Object.values(platformSpend.daily).reduce((s, v) => s + v, 0);
  const platformMonthly = Object.values(platformSpend.monthly).reduce((s, v) => s + v, 0);

  // Total = OpenClaw + Platform (excludes Claude Code — user has Max plan)
  const dailySpend = openclawDaily + platformDaily;
  const monthlySpend = openclawMonthly + platformMonthly;

  const trend = costSync.getCostTrend();

  // Build byTier from real model data
  const byTier = Object.entries(modelSpend.daily)
    .filter(([, cost]) => cost > 0)
    .map(([model, cost]) => {
      const tier = model.includes('opus') ? 'opus' : model.includes('sonnet') ? 'sonnet' : model.includes('haiku') ? 'haiku' : 'other';
      return { tier, model, cost };
    })
    .sort((a, b) => b.cost - a.cost);

  res.json({
    daily: { spend: dailySpend, budget: dailyBudget },
    monthly: { spend: monthlySpend, budget: monthlyBudget },
    byTier,
    byAgent: [],
    byPlatform: platformSpend,
    trend,
    platformTrend: platformSpend.trend || [],
  });
});

app.post('/api/costs/sync', (req, res) => {
  try {
    const sinceDate = req.body.since || undefined;
    const result = costSync.syncCostsToDb(db, sinceDate);
    costSync.syncAgentStatus(db);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/costs/budget', (req, res) => {
  const oldDaily = db.prepare("SELECT value FROM settings WHERE key='daily_budget'").get()?.value || '5';
  const oldMonthly = db.prepare("SELECT value FROM settings WHERE key='monthly_budget'").get()?.value || '100';
  if (req.body.daily !== undefined) {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('daily_budget', ?)").run(String(req.body.daily));
  }
  if (req.body.monthly !== undefined) {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('monthly_budget', ?)").run(String(req.body.monthly));
  }
  logAudit(db, { actor: resolveActor(req), action: 'budget.update', target: 'budget', detail: { daily: { from: oldDaily, to: req.body.daily }, monthly: { from: oldMonthly, to: req.body.monthly } }, ip: req.ip });
  // Write budget config file for shell scripts
  try {
    const budgetFile = path.join(__dirname, '..', '..', 'config', 'budget.json');
    const daily = parseFloat(req.body.daily) || parseFloat(db.prepare("SELECT value FROM settings WHERE key='daily_budget'").get()?.value) || 5;
    const monthly = parseFloat(req.body.monthly) || parseFloat(db.prepare("SELECT value FROM settings WHERE key='monthly_budget'").get()?.value) || 100;
    fs.writeFileSync(budgetFile, JSON.stringify({
      daily_budget: daily,
      monthly_budget: monthly,
      warn_threshold_pct: 0.90,
      updated_at: new Date().toISOString()
    }, null, 2) + '\n');
  } catch (e) {
    console.error('Failed to write budget config:', e.message);
  }
  dashLog('budget_updated', `daily=$${req.body.daily || '?'} monthly=$${req.body.monthly || '?'}`);
  res.json({ ok: true });
});

// ─── ROUTES: Dashboard Overview ─────────────────────────────
app.get('/api/dashboard', (req, res) => {
  const activeTasks = db.prepare("SELECT COUNT(*) as n FROM tasks WHERE status='in_progress'").get();
  const blockedTasks = db.prepare("SELECT COUNT(*) as n FROM tasks WHERE status='blocked'").get();
  const backlogTasks = db.prepare("SELECT COUNT(*) as n FROM tasks WHERE status='backlog'").get();
  const doneTasks = db.prepare("SELECT COUNT(*) as n FROM tasks WHERE status='done'").get();
  const plannedTasks = db.prepare("SELECT COUNT(*) as n FROM tasks WHERE status='planned'").get();

  const runningExecs = db.prepare("SELECT COUNT(*) as n FROM runs WHERE status='running'").get();
  const recentRuns = db.prepare("SELECT * FROM runs ORDER BY started_at DESC LIMIT 5").all();
  const recentActivity = db.prepare("SELECT * FROM activity ORDER BY created_at DESC LIMIT 20").all();

  const agents = deps.agentsFullCache;
  const dbAgents = db.prepare('SELECT * FROM agents ORDER BY command_centre, id').all();
  const activeAgents = dbAgents.filter(a => a.status === 'active').length;
  const totalSubAgents = agents.reduce((n, a) => n + (a.subAgents?.length || 0), 0);

  // Cost summary — read from cost-monitor.log (authoritative source)
  const dailyBudget = parseFloat(db.prepare("SELECT value FROM settings WHERE key='daily_budget'").get()?.value || '5');
  const monthlyBudget = parseFloat(db.prepare("SELECT value FROM settings WHERE key='monthly_budget'").get()?.value || '100');
  const todayCost = { total: costSync.getDailySpend() };
  const monthCost = { total: costSync.getMonthlySpend() };

  // System health
  const gateway = adapter.getGatewayStatus();
  const disk = adapter.getDiskUsage();

  res.json({
    tasks: {
      backlog: backlogTasks.n,
      planned: plannedTasks.n,
      in_progress: activeTasks.n,
      blocked: blockedTasks.n,
      done: doneTasks.n,
    },
    agents: {
      total: agents.length,
      active: activeAgents,
      subAgentCount: totalSubAgents,
      list: dbAgents,
    },
    runs: {
      running: runningExecs.n,
      recent: recentRuns,
    },
    costs: {
      daily: { spend: todayCost.total, budget: dailyBudget },
      monthly: { spend: monthCost.total, budget: monthlyBudget },
    },
    system: {
      gateway,
      disk,
      cron: deps.cronJobsCache.length,
    },
    activity: recentActivity,
  });
});

// ─── ROUTES: Activity ───────────────────────────────────────
app.get('/api/activity', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const rows = db.prepare('SELECT * FROM activity ORDER BY created_at DESC LIMIT ?').all(limit);
  res.json(rows);
});

// ─── ROUTES: Settings ───────────────────────────────────────
app.get('/api/settings', (req, res) => {
  const rows = db.prepare('SELECT * FROM settings').all();
  const obj = {};
  for (const r of rows) obj[r.key] = r.value;
  res.json(obj);
});

app.put('/api/settings', (req, res) => {
  // Capture old values for audit trail
  const oldVals = {};
  for (const k of Object.keys(req.body)) {
    const row = db.prepare('SELECT value FROM settings WHERE key=?').get(k);
    if (row) oldVals[k] = row.value;
  }
  const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  const tx = db.transaction(() => {
    for (const [k, v] of Object.entries(req.body)) {
      upsert.run(k, String(v));
    }
  });
  tx();
  // Build from→to detail for each changed key
  const changes = {};
  for (const [k, v] of Object.entries(req.body)) { changes[k] = { from: oldVals[k] || '(unset)', to: String(v) }; }
  logAudit(db, { actor: resolveActor(req), action: 'settings.update', target: Object.keys(req.body).join(', '), detail: changes, ip: req.ip });
  dashLog('settings_updated', Object.keys(req.body).join(', '));
  res.json({ ok: true });
});

// ─── ROUTES: Subscriptions ────────────────────────────────────
app.get('/api/costs/subscriptions', (req, res) => {
  // Merge config-defined subs with DB (overrides + custom additions)
  const cfgSubs = dashConfig.subscriptions || [];
  let dbSubs = [];
  try { dbSubs = db.prepare('SELECT * FROM subscriptions WHERE active=1').all(); } catch {
    try { dbSubs = db.prepare('SELECT id, name, cost, cycle, active FROM subscriptions WHERE active=1').all(); } catch {}
  }

  // Check if any config sub is deactivated in DB
  const deactivated = new Set();
  try {
    const inactive = db.prepare('SELECT id FROM subscriptions WHERE active=0').all();
    inactive.forEach(r => deactivated.add(r.id));
  } catch {}

  // Config subs (not deactivated) with DB overrides
  const merged = cfgSubs
    .filter(s => !deactivated.has(s.id))
    .map(s => {
      const dbRow = dbSubs.find(r => r.id === s.id);
      return {
        ...s,
        cost: dbRow?.cost ?? s.cost,
        renewal_date: dbRow?.renewal_date || s.renewal_date,
        source: 'config',
      };
    });

  // DB-only subs (not in config)
  const cfgIds = new Set(cfgSubs.map(s => s.id));
  const customSubs = dbSubs
    .filter(r => !cfgIds.has(r.id))
    .map(r => ({
      id: r.id, name: r.name, cost: r.cost, cycle: r.cycle || 'monthly',
      renewal_date: r.renewal_date || null, source: 'custom',
    }));

  res.json([...merged, ...customSubs]);
});

app.put('/api/costs/subscriptions/:id', (req, res) => {
  const { cost, renewal_date, name, cycle } = req.body;
  // Find in config OR in DB (custom subscriptions won't be in config)
  const cfgSub = (dashConfig.subscriptions || []).find(s => s.id === req.params.id);
  const dbSub = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(req.params.id);
  if (!cfgSub && !dbSub) return res.status(404).json({ error: 'Subscription not found' });
  const base = cfgSub || dbSub;
  try { db.exec('ALTER TABLE subscriptions ADD COLUMN renewal_date TEXT'); } catch {}
  db.prepare(`
    INSERT INTO subscriptions (id, name, cost, cycle, renewal_date, active)
    VALUES (?,?,?,?,?,1)
    ON CONFLICT(id) DO UPDATE SET name=COALESCE(excluded.name, name), cost=COALESCE(excluded.cost, cost), cycle=COALESCE(excluded.cycle, cycle), renewal_date=COALESCE(excluded.renewal_date, renewal_date)
  `).run(req.params.id, name || base.name, parseFloat(cost ?? base.cost), cycle || base.cycle || 'monthly', renewal_date ?? base.renewal_date ?? null);
  logAudit(db, { actor: resolveActor(req), action: 'subscription.update', target: req.params.id, detail: { name: name || base.name, cost: { from: base.cost, to: cost }, cycle: cycle || base.cycle }, ip: req.ip });
  res.json({ ok: true });
});

// Add a new subscription
app.post('/api/costs/subscriptions', (req, res) => {
  const { name, cost, cycle, renewal_date } = req.body;
  if (!name || cost === undefined) return res.status(400).json({ error: 'name and cost required' });
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  try { db.exec('ALTER TABLE subscriptions ADD COLUMN renewal_date TEXT'); } catch {}
  const existing = db.prepare('SELECT id FROM subscriptions WHERE id = ?').get(id);
  if (existing) return res.status(409).json({ error: 'Subscription with this ID already exists' });
  db.prepare(`
    INSERT INTO subscriptions (id, name, cost, cycle, renewal_date, active) VALUES (?,?,?,?,?,1)
  `).run(id, name, parseFloat(cost), cycle || 'monthly', renewal_date || null);
  res.json({ ok: true, id });
});

// Delete (deactivate) a subscription
app.delete('/api/costs/subscriptions/:id', (req, res) => {
  // Don't allow deleting config-defined subs, only DB-added ones
  const cfgSub = (dashConfig.subscriptions || []).find(s => s.id === req.params.id);
  if (cfgSub) {
    // Deactivate in DB instead of deleting
    try { db.exec('ALTER TABLE subscriptions ADD COLUMN renewal_date TEXT'); } catch {}
    db.prepare(`
      INSERT INTO subscriptions (id, name, cost, cycle, active) VALUES (?,?,?,?,0)
      ON CONFLICT(id) DO UPDATE SET active=0
    `).run(req.params.id, cfgSub.name, cfgSub.cost, cfgSub.cycle);
    return res.json({ ok: true, deactivated: true });
  }
  db.prepare('DELETE FROM subscriptions WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

};
