// ─── Cost Sync ───────────────────────────────────────────────
// PRIMARY SOURCE: /opt/AIWH/core/logs/cost-monitor.log
// Parses lines like: [2026-02-27 21:17:36] Daily spend: $47.77 / $5.00
// That's the authoritative daily spend, calculated by OpenClaw.

const fs = require('fs');
const path = require('path');

const SESSIONS_ROOT = '/opt/AIWH/.openclaw/agents';
const COST_LOG = (process.env.CLIENT_ROOT || '/opt/AIWH/client') + '/logs/cost-monitor.log';
const AEST_OFFSET_MS = 10 * 60 * 60 * 1000;

function todayAEST() {
  const now = new Date();
  const aest = new Date(now.getTime() + AEST_OFFSET_MS);
  return aest.toISOString().split('T')[0];
}

/**
 * Parse cost-monitor.log and return a Map of date -> last daily spend value.
 * Each line: [YYYY-MM-DD HH:MM:SS] Daily spend: $XX.XX / $Y.YY
 */
function parseCostLog() {
  const dailyTotals = new Map();
  if (!fs.existsSync(COST_LOG)) return dailyTotals;

  const content = fs.readFileSync(COST_LOG, 'utf8');
  for (const line of content.split('\n')) {
    const match = line.match(/^\[(\d{4}-\d{2}-\d{2})\s[^\]]+\]\s*Daily spend:\s*\$([\d.]+)/);
    if (match) {
      const [, date, spend] = match;
      const val = parseFloat(spend);
      if (!isNaN(val) && val >= 0) {
        dailyTotals.set(date, val);
      }
    }
  }
  return dailyTotals;
}

/**
 * Get today's daily spend from cost-monitor.log (last entry for today)
 * plus any cinematic producer costs from the ledger.
 */
function getDailySpend() {
  const today = todayAEST();
  const totals = parseCostLog();
  let spend = totals.get(today) || 0;

  // Add cinematic costs not yet captured by cost-monitor cron
  const ledger = (process.env.CLIENT_ROOT || '/opt/AIWH/client') + '/logs/cinematic-costs.jsonl';
  if (fs.existsSync(ledger)) {
    try {
      const lines = fs.readFileSync(ledger, 'utf8').trim().split('\n');
      for (const line of lines) {
        if (!line) continue;
        try {
          const e = JSON.parse(line);
          if (e.date === today) spend += (e.cost_usd || 0);
        } catch {}
      }
    } catch {}
  }
  return spend;
}

/**
 * Get monthly spend: sum of last entry per day for current month.
 */
function getMonthlySpend() {
  const month = todayAEST().substring(0, 7); // YYYY-MM
  const totals = parseCostLog();
  let sum = 0;
  for (const [date, spend] of totals) {
    if (date.startsWith(month)) {
      sum += spend;
    }
  }
  return sum;
}

/**
 * Get 30-day cost trend: last entry per day for the last 30 days.
 * Returns array of { date, total } sorted ascending.
 */
function getCostTrend() {
  const totals = parseCostLog();
  // Get last 30 days
  const now = new Date(Date.now() + AEST_OFFSET_MS);
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  const trend = [];
  for (const [date, spend] of totals) {
    if (date >= cutoffStr) {
      trend.push({ date, total: spend });
    }
  }
  trend.sort((a, b) => a.date.localeCompare(b.date));
  return trend;
}

/**
 * Sync costs from cost-monitor.log into SQLite for historical tracking.
 */
function syncCostsToDb(db, sinceDate) {
  const totals = parseCostLog();
  if (totals.size === 0) return { synced: 0, total: 0 };

  // Clear and re-insert from log
  const since = sinceDate || '2020-01-01';
  db.prepare('DELETE FROM cost_entries WHERE date >= ?').run(since);

  const insert = db.prepare(`
    INSERT INTO cost_entries (date, agent_id, model_tier, input_tokens, output_tokens, cost)
    VALUES (?, 'aggregate', 'mixed', 0, 0, ?)
  `);

  let totalCost = 0;
  let synced = 0;
  const tx = db.transaction(() => {
    for (const [date, spend] of totals) {
      if (date >= since && spend > 0) {
        insert.run(date, spend);
        totalCost += spend;
        synced++;
      }
    }
  });
  tx();

  return { synced, total: totalCost };
}

/**
 * Get agent activity status from session data.
 */
function getAgentSessionStatus() {
  const status = new Map();
  const agentsDir = SESSIONS_ROOT;

  if (!fs.existsSync(agentsDir)) return status;

  let agentDirs;
  try {
    agentDirs = fs.readdirSync(agentsDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
  } catch { return status; }

  const fiveMinAgo = Date.now() - 5 * 60 * 1000;
  const oneHourAgo = Date.now() - 60 * 60 * 1000;

  for (const agentId of agentDirs) {
    const sessionsFile = path.join(agentsDir, agentId, 'sessions', 'sessions.json');
    if (!fs.existsSync(sessionsFile)) continue;

    try {
      const data = JSON.parse(fs.readFileSync(sessionsFile, 'utf8'));
      const sessions = data.sessions || data;

      let latestActivity = 0;
      let activeSessions = 0;
      let totalSessions = 0;
      let lastModel = '';

      const iterate = (s, updated) => {
        totalSessions++;
        if (updated > latestActivity) {
          latestActivity = updated;
          lastModel = s.model || '';
        }
        if (updated > fiveMinAgo) activeSessions++;
      };

      if (Array.isArray(sessions)) {
        for (const s of sessions) iterate(s, s.updatedAt || s.lastUpdated || 0);
      } else if (typeof sessions === 'object') {
        for (const s of Object.values(sessions)) iterate(s, s.updatedAt || s.lastUpdated || 0);
      }

      let agentStatus = 'offline';
      if (activeSessions > 0) agentStatus = 'active';
      else if (latestActivity > oneHourAgo) agentStatus = 'idle';
      else if (totalSessions > 0) agentStatus = 'idle';

      status.set(agentId, {
        status: agentStatus,
        lastActive: latestActivity > 0 ? new Date(latestActivity).toISOString() : null,
        activeSessions,
        totalSessions,
        lastModel,
      });
    } catch {}
  }

  return status;
}

function syncAgentStatus(db) {
  const statuses = getAgentSessionStatus();
  const update = db.prepare(`
    UPDATE agents SET status = ?, last_active_at = COALESCE(?, last_active_at)
    WHERE id = ?
  `);
  const tx = db.transaction(() => {
    for (const [agentId, info] of statuses) {
      update.run(info.status, info.lastActive, agentId);
    }
  });
  tx();
  return statuses;
}

/**
 * Get actual per-model cost breakdown from OpenClaw session JSONL files.
 * Reads every assistant message's usage.cost.total, grouped by model.
 * Excludes Claude Code (user has Max plan).
 */
function getModelSpend() {
  const today = todayAEST();
  const month = today.substring(0, 7);
  const dailyByModel = {};
  const monthlyByModel = {};

  const agentsDir = SESSIONS_ROOT;
  if (!fs.existsSync(agentsDir)) return { daily: dailyByModel, monthly: monthlyByModel };

  let agentDirs;
  try {
    agentDirs = fs.readdirSync(agentsDir, { withFileTypes: true })
      .filter(d => d.isDirectory()).map(d => d.name);
  } catch { return { daily: dailyByModel, monthly: monthlyByModel }; }

  for (const agentId of agentDirs) {
    const sessDir = path.join(agentsDir, agentId, 'sessions');
    if (!fs.existsSync(sessDir)) continue;

    let files;
    try { files = fs.readdirSync(sessDir).filter(f => f.endsWith('.jsonl')); } catch { continue; }

    for (const file of files) {
      const fp = path.join(sessDir, file);
      let content;
      try { content = fs.readFileSync(fp, 'utf8'); } catch { continue; }

      let currentModel = 'unknown';
      for (const line of content.split('\n')) {
        if (!line) continue;
        let e;
        try { e = JSON.parse(line); } catch { continue; }

        if (e.type === 'model_change') {
          currentModel = e.modelId || 'unknown';
          continue;
        }

        const msg = e.message;
        if (!msg || msg.role !== 'assistant' || !msg.usage) continue;

        const tsStr = e.timestamp;
        if (!tsStr) continue;
        let day;
        try {
          const ts = new Date(tsStr.replace('Z', '+00:00'));
          const aest = new Date(ts.getTime() + AEST_OFFSET_MS);
          day = aest.toISOString().split('T')[0];
        } catch { continue; }

        const cost = msg.usage?.cost?.total;
        if (typeof cost !== 'number' || cost <= 0) continue;

        if (day.startsWith(month)) {
          monthlyByModel[currentModel] = (monthlyByModel[currentModel] || 0) + cost;
        }
        if (day === today) {
          dailyByModel[currentModel] = (dailyByModel[currentModel] || 0) + cost;
        }
      }
    }
  }

  return { daily: dailyByModel, monthly: monthlyByModel };
}

/**
 * Get actual daily spend from OpenClaw sessions (not from cost-monitor.log).
 * This is the real value based on every message sent.
 */
function getActualDailySpend() {
  const { daily } = getModelSpend();
  return Object.values(daily).reduce((s, v) => s + v, 0);
}

/**
 * Get actual monthly spend from OpenClaw sessions.
 */
function getActualMonthlySpend() {
  const { monthly } = getModelSpend();
  return Object.values(monthly).reduce((s, v) => s + v, 0);
}

/**
 * Get platform spend breakdown from cinematic-costs.jsonl.
 * Returns { daily, monthly, allTime, trend (last 30 days by service by day) }
 */
function getPlatformSpend() {
  const ledger = (process.env.CLIENT_ROOT || '/opt/AIWH/client') + '/logs/cinematic-costs.jsonl';
  const today = todayAEST();
  const month = today.substring(0, 7);
  const daily = {};
  const monthly = {};
  const allTime = {};
  const byDay = {}; // { date: { service: cost } }

  if (!fs.existsSync(ledger)) return { daily, monthly, allTime, trend: [] };

  try {
    const lines = fs.readFileSync(ledger, 'utf8').trim().split('\n');
    for (const line of lines) {
      if (!line) continue;
      try {
        const e = JSON.parse(line);
        const svc = e.service || 'unknown';
        const cost = e.cost_usd || 0;
        const date = e.date || '';

        allTime[svc] = (allTime[svc] || 0) + cost;
        if (date.startsWith(month)) monthly[svc] = (monthly[svc] || 0) + cost;
        if (date === today) daily[svc] = (daily[svc] || 0) + cost;

        // Per-day tracking for trend
        if (!byDay[date]) byDay[date] = {};
        byDay[date][svc] = (byDay[date][svc] || 0) + cost;
      } catch {}
    }
  } catch {}

  // Build trend: last 30 days
  const now = new Date(Date.now() + AEST_OFFSET_MS);
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  const trend = Object.entries(byDay)
    .filter(([date]) => date >= cutoffStr)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, services]) => ({ date, ...services, total: Object.values(services).reduce((s, v) => s + v, 0) }));

  return { daily, monthly, allTime, trend };
}

module.exports = {
  parseCostLog,
  getDailySpend,
  getMonthlySpend,
  getActualDailySpend,
  getActualMonthlySpend,
  getModelSpend,
  getCostTrend,
  getPlatformSpend,
  syncCostsToDb,
  getAgentSessionStatus,
  syncAgentStatus,
  todayAEST,
};
