// ─── Notification Engine ──────────────────────────────────────
// Creates notifications from system events and polls for new ones.
// Sources: cost thresholds, cron failures, video pipeline events, agent errors.

const fs = require('fs');

const COST_LOG = (process.env.CLIENT_ROOT || '/opt/AIWH/client') + '/logs/cost-monitor.log';

/**
 * Create a notification in the DB.
 */
function createNotification(db, opts) {
  const { type, title, body, priority = 'normal', agentId = '', actionUrl = '' } = opts;
  return db.prepare(
    'INSERT INTO notifications (type, title, body, priority, agent_id, action_url) VALUES (?,?,?,?,?,?)'
  ).run(type, title, body, priority, agentId, actionUrl);
}

/**
 * Check cost thresholds and create notifications if exceeded.
 */
function checkCostThresholds(db, dailySpend, monthlySpend) {
  const dailyBudget  = parseFloat(db.prepare("SELECT value FROM settings WHERE key='daily_budget'").get()?.value || '5');
  const monthlyBudget = parseFloat(db.prepare("SELECT value FROM settings WHERE key='monthly_budget'").get()?.value || '150');

  const dailyPct   = dailySpend / dailyBudget;
  const monthlyPct = monthlySpend / monthlyBudget;

  // Check for 80% and 100% thresholds — use settings to avoid duplicate alerts today
  const todayKey = new Date().toISOString().split('T')[0];

  if (dailyPct >= 1.0) {
    const key = `cost_daily_over_${todayKey}`;
    const existing = db.prepare("SELECT 1 FROM settings WHERE key=?").get(key);
    if (!existing) {
      createNotification(db, {
        type: 'cost_alert',
        title: 'Daily budget exceeded',
        body: `Daily spend $${dailySpend.toFixed(2)} exceeds $${dailyBudget.toFixed(2)} budget.`,
        priority: 'high',
      });
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)").run(key, '1');
    }
  } else if (dailyPct >= 0.8) {
    const key = `cost_daily_warn_${todayKey}`;
    const existing = db.prepare("SELECT 1 FROM settings WHERE key=?").get(key);
    if (!existing) {
      createNotification(db, {
        type: 'cost_warning',
        title: 'Daily budget at 80%',
        body: `Daily spend $${dailySpend.toFixed(2)} of $${dailyBudget.toFixed(2)}.`,
        priority: 'normal',
      });
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)").run(key, '1');
    }
  }
}

/**
 * Check cron job health from cronJobsCache and create notifications for failures.
 */
function checkCronHealth(db, cronJobs) {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;

  for (const job of (cronJobs || [])) {
    if (!job.enabled) continue;
    const st = job.state || {};
    const lastRunAtMs = st.lastRunAtMs || 0;
    const lastStatus = st.lastRunStatus;

    // Only alert on recent failures (within 1h)
    if (lastStatus === 'error' && lastRunAtMs > oneHourAgo) {
      const key = `cron_fail_${job.id}_${lastRunAtMs}`;
      const existing = db.prepare("SELECT 1 FROM settings WHERE key=?").get(key);
      if (!existing) {
        createNotification(db, {
          type: 'cron_failure',
          title: `Cron failed: ${job.name}`,
          body: `${job.description || job.name} failed. Check logs.`,
          priority: 'high',
          actionUrl: '/view/schedule',
        });
        db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)").run(key, '1');
      }
    }
  }
}

/**
 * Get unread notifications count.
 */
function getUnreadCount(db) {
  return db.prepare("SELECT COUNT(*) as n FROM notifications WHERE read_at IS NULL").get()?.n || 0;
}

module.exports = { createNotification, checkCostThresholds, checkCronHealth, getUnreadCount };
