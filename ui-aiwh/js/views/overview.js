// ─── Overview View ────────────────────────────────────────────
// Sprint metrics, agent status grid, activity feed, cost sparkline,
// content pipeline widget, cron health.

let _overviewCostChart = null;

async function initOverview() {
  await refreshOverview();
}

async function refreshOverview() {
  const [dash, costs, sched, content, pipeline] = await Promise.all([
    api('/dashboard'),
    api('/costs'),
    api('/schedules'),
    api('/content/summary'),
    api('/pipeline/status'),
  ]);
  if (!dash) {return;}

  renderOverviewMetrics(dash, costs);
  renderAgentCards(dash.agents?.list || []);
  renderActivityFeed(dash.activity || []);
  renderCronHealth(sched?.openclaw || []);
  renderContentWidget(content, pipeline);
  if (costs?.trend?.length) {renderCostSparkline(costs.trend);}

  // Unread notifications badge
  const n = await api('/notifications/unread-count');
  updateNotifBadge(n?.count || 0);
}

function renderOverviewMetrics(dash, costs) {
  const dp = dash.costs.daily;
  const mp = dash.costs.monthly;

  // Daily spend
  setMetric('ov-daily-spend', '$' + dp.spend.toFixed(2));
  setMetric('ov-daily-sub', `/ $${dp.budget.toFixed(2)} budget`);
  setBar('ov-daily-bar', dp.spend / dp.budget);

  // Monthly spend
  setMetric('ov-monthly-spend', '$' + mp.spend.toFixed(2));
  setMetric('ov-monthly-sub', `/ $${mp.budget.toFixed(2)} budget`);
  setBar('ov-monthly-bar', mp.spend / mp.budget);

  // Tasks
  const t = dash.tasks;
  setMetric('ov-tasks', t.in_progress);
  setMetric('ov-tasks-sub', `${t.blocked} blocked · ${t.backlog + t.planned} pending · ${t.done} done`);

  // Agents
  setMetric('ov-agents', `${dash.agents.active}/${dash.agents.total}`);
  const subCount = dash.agents.subAgentCount || 0;
  setMetric('ov-agents-sub', `active · ${subCount} sub-agents`);
  // O3: Add tooltip to explain what "active" and sub-agents mean
  const agentEl = document.getElementById('ov-agents');
  if (agentEl) {agentEl.title = `${dash.agents.active} agents currently processing tasks out of ${dash.agents.total} configured.\nSub-agents are specialized workers (voice, avatar, caption, QA, publisher) that run inside the video pipeline.`;}

  // Gateway
  const gw = dash.system?.gateway;
  setMetric('ov-gateway', gw?.status === 'online' ? 'Online' : 'Offline');
  const gwEl = document.getElementById('ov-gateway');
  if (gwEl) {gwEl.style.color = gw?.status === 'online' ? 'var(--green)' : 'var(--red)';}
  setMetric('ov-disk', `${dash.system?.disk?.used || '?'} · ${dash.system?.disk?.available || '?'} free`);
}

function setMetric(id, val) {
  const el = document.getElementById(id);
  if (el) {el.textContent = val;}
}

function setBar(id, pct) {
  const el = document.getElementById(id);
  if (!el) {return;}
  const p = Math.min(Math.max(pct * 100, 0), 100);
  el.style.width = p + '%';
  el.className = 'metric-bar-fill' + (p >= 100 ? ' danger' : p >= 80 ? ' warn' : '');
}

// Video sub-agent IDs to exclude from overview
const _OV_SUB_AGENTS = new Set(['voice-agent','avatar-agent','caption-agent','qa-agent','publisher-agent']);

const _OV_MODULE_LABELS = { core:'CEO', system:'System', frontend:'Frontend', backend:'Backend', lifestyle:'Lifestyle' };

// All modules unlocked
const _OV_LOCKED_MODULES = new Set();

// Layout: Row 1 = CEO + System, Row 2 = Frontend, Row 3 = Backend, Row 4 = Lifestyle
const _OV_ROWS = [
  ['core', 'system'],
  ['frontend'],
  ['backend'],
  ['lifestyle'],
];

function renderAgentCards(agents) {
  const el = document.getElementById('ov-agent-grid');
  if (!el) {return;}
  if (!agents.length) { el.innerHTML = '<div class="empty-msg">No agents loaded</div>'; return; }

  const filtered = agents.filter(a => !_OV_SUB_AGENTS.has(a.id));
  const ceo = filtered.find(a => a.id === 'main');
  const rest = filtered.filter(a => a.id !== 'main');

  const groups = { core: ceo ? [ceo] : [] };
  for (const a of rest) {
    const mod = (a.module || 'system').toLowerCase();
    if (!groups[mod]) {groups[mod] = [];}
    groups[mod].push(a);
  }

  let html = '';
  for (const row of _OV_ROWS) {
    html += `<div class="ov-row">`;
    for (const mod of row) {
      const agents = groups[mod];
      if (!agents?.length) {continue;}
      const locked = _OV_LOCKED_MODULES.has(mod);
      const label = _OV_MODULE_LABELS[mod] || mod;
      html += `<div class="ov-section ${locked ? 'ov-section-locked' : ''}">`;
      html += `<div class="ov-section-label">${label}${locked ? '<span class="ov-section-lock" onclick="event.stopPropagation();window.open(\'https://aiwh.io/upgrade\',\'_blank\')">Upgrade</span>' : ''}</div>`;
      html += `<div class="ov-section-cards">`;
      for (const a of agents) {html += renderOvCard(a);}
      html += `</div></div>`;
    }
    html += `</div>`;
  }

  el.innerHTML = html;
}

function renderOvCard(a) {
  const status = a.status || 'idle';
  const mti = modelTierInfo(a.modelTier || a.model_tier || 'haiku');
  const tier = mti.tier;
  const tierClass = mti.cls;
  const name = a.displayName || a.display_name || a.id;
  const avatarUrl = a.avatar_url || '';
  const avatarHtml = avatarUrl
    ? `<img src="${escHtml(avatarUrl)}" alt="" class="ov-agent-avatar-img">`
    : `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="6" r="3" stroke="currentColor" stroke-width="1.2" opacity="0.4"/><path d="M2.5 14c0-3 2.5-5.5 5.5-5.5s5.5 2.5 5.5 5.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity="0.4"/></svg>`;

  return `<div class="ov-agent-card glass" onclick="switchView('team')" title="${escHtml(name)} — ${tier}">
    <span class="ov-agent-status status-dot status-${status}"></span>
    <div class="ov-agent-avatar">${avatarHtml}</div>
    <div class="ov-agent-name">${escHtml(name)}</div>
    <div class="ov-agent-tier">${escHtml(tier)}</div>
  </div>`;
}

function renderActivityFeed(items) {
  const el = document.getElementById('ov-activity');
  if (!el) {return;}
  if (!items.length) {
    el.innerHTML = '<div class="empty-msg">No recent activity</div>';
    return;
  }
  el.innerHTML = items.slice(0, 15).map(a => {
    const actor = a.agent_id || 'you';
    const actionLabel = (a.action || '').replace(/_/g, ' ');
    return `<div class="feed-item">
      <span class="feed-time">${shortTime(a.created_at)}</span>
      <span class="feed-agent">${escHtml(actor)}</span>
      <span class="feed-text">${escHtml(actionLabel)}: ${escHtml(a.detail || '')}</span>
    </div>`;
  }).join('');
}

function renderCronHealth(jobs) {
  const el = document.getElementById('ov-cron');
  if (!el) {return;}
  if (!jobs.length) {
    el.innerHTML = '<div class="empty-msg">No cron jobs loaded</div>';
    return;
  }
  el.innerHTML = jobs.slice(0, 10).map(j => {
    const st = j.state || {};
    const hasRun = !!st.lastRunAtMs;
    const ok = hasRun && (st.lastRunStatus === 'ok' || st.consecutiveErrors === 0);
    const hasError = hasRun && st.consecutiveErrors > 0;
    const statusClass = !hasRun ? 'offline' : hasError ? 'error' : 'idle';
    const statusTitle = !hasRun ? 'Never run' : hasError ? 'Error' : 'OK';
    const lastStr = hasRun ? timeAgo(new Date(st.lastRunAtMs).toISOString()) : 'never';
    return `<div class="feed-item">
      <span class="status-dot status-${statusClass}" style="width:5px;height:5px;" title="${statusTitle}"></span>
      <span class="cron-name">${escHtml(j.name || j.id)}</span>
      <span class="feed-time">${lastStr}</span>
    </div>`;
  }).join('');
}

function renderContentWidget(content, pipeline) {
  const el = document.getElementById('ov-content');
  if (!el) {return;}
  if (!content?.available) {
    el.innerHTML = '<div class="empty-msg">Video DB not available</div>';
    return;
  }
  const todayJob = content.todayJob;
  const cin = pipeline?.cinematic || {};
  const cinHtml = cin.total ? `
    <div class="content-divider"></div>
    <div class="content-section-label">Cinematic</div>
    <div class="content-stats">
      <div class="cs-item"><span class="cs-val">${cin.active || 0}</span><span class="cs-lab">active</span></div>
      <div class="cs-item"><span class="cs-val ${cin.awaiting_review ? 'cs-review' : ''}">${cin.awaiting_review || 0}</span><span class="cs-lab">awaiting review</span></div>
      <div class="cs-item"><span class="cs-val">${cin.total || 0}</span><span class="cs-lab">total</span></div>
    </div>
  ` : '';
  el.innerHTML = `
    <div class="content-section-label">Standard Pipeline</div>
    <div class="content-stats">
      <div class="cs-item"><span class="cs-val">${content.queued}</span><span class="cs-lab">queued</span></div>
      <div class="cs-item"><span class="cs-val">${content.inProgress}</span><span class="cs-lab">in progress</span></div>
      <div class="cs-item"><span class="cs-val">${content.done}</span><span class="cs-lab">done</span></div>
      <div class="cs-item"><span class="cs-val">${content.topicsRemaining}</span><span class="cs-lab">topics left</span></div>
    </div>
    ${todayJob ? `<div class="today-job">Today: <strong>${escHtml(todayJob.topic || '')}</strong> — <span class="job-status">${escHtml(todayJob.status)}</span></div>` : ''}
    ${cinHtml}
  `;
}

function renderCostSparkline(trend) {
  const ctx = document.getElementById('ov-cost-chart');
  if (!ctx) {return;}
  if (_overviewCostChart) { _overviewCostChart.destroy(); _overviewCostChart = null; }

  const clean = trend.filter(t => t && typeof t.total === 'number' && isFinite(t.total) && t.total >= 0);
  if (!clean.length) {return;}

  const vals = clean.map(t => t.total);
  const maxV = Math.max(...vals, 1);

  _overviewCostChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: clean.map(t => t.date.slice(5)),
      datasets: [{
        label: 'Daily $',
        data: vals,
        backgroundColor: 'rgba(0, 240, 255, 0.15)',
        borderColor: 'rgba(0, 240, 255, 0.50)',
        borderWidth: 1,
        borderRadius: 2,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#6a6a8a', font: { size: 9, family: "'JetBrains Mono', monospace" } }, grid: { display: false } },
        y: {
          min: 0, max: Math.ceil(maxV * 1.2),
          ticks: { color: '#6a6a8a', font: { size: 9, family: "'JetBrains Mono', monospace" }, callback: v => '$' + v },
          grid: { color: 'rgba(0, 240, 255, 0.04)' },
        },
      },
    },
  });
}
