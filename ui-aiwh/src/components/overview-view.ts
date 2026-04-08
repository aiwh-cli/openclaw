import { LitElement, html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';

type Agent = {
  id: string; displayName?: string; display_name?: string; status?: string;
  module?: string; modelTier?: string; model_tier?: string; avatar_url?: string;
};
type CostData = { daily: { spend: number; budget: number }; monthly: { spend: number; budget: number } };
type DashData = {
  costs: CostData;
  tasks: Record<string, number>;
  agents: { active: number; total: number; subAgentCount?: number; list: Agent[] };
  system?: { gateway?: { status?: string }; disk?: { used?: string; available?: string }; cron?: number };
  activity?: Array<{ agent_id?: string; action?: string; detail?: string; created_at?: string }>;
};

const api = (window as any).api as (url: string, opts?: any) => Promise<any>;
const escHtml = (window as any).escHtml as (s: string) => string;
const timeAgo = (window as any).timeAgo as (d: string) => string;
const shortTime = (window as any).shortTime as (d: string) => string;
const modelTierInfo = (window as any).modelTierInfo as (m: string) => { tier: string; cls: string };
const switchView = (window as any).switchView as (v: string) => void;
const updateNotifBadge = (window as any).updateNotifBadge as (n: number) => void;

const SUB_AGENTS = new Set(['voice-agent','avatar-agent','caption-agent','qa-agent','publisher-agent']);
const MODULE_LABELS: Record<string, string> = { core:'CEO', system:'System', frontend:'Frontend', backend:'Backend', lifestyle:'Lifestyle' };
const MODULE_ROWS = [['core','system'],['frontend'],['backend'],['lifestyle']];

@customElement('overview-view')
export class OverviewView extends LitElement {
  createRenderRoot() { return this; }

  @state() private dash: DashData | null = null;
  @state() private costTrend: Array<{ date: string; total: number }> = [];
  @state() private cronJobs: any[] = [];
  @state() private content: any = null;
  @state() private pipeline: any = null;
  private _chart: any = null;

  connectedCallback() { super.connectedCallback(); this.load(); }
  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._chart) { this._chart.destroy(); this._chart = null; }
  }

  async load() {
    try {
    const [dash, costs, sched, content, pipeline] = await Promise.all([
      api('/dashboard'), api('/costs'), api('/schedules'),
      api('/content/summary'), api('/pipeline/status'),
    ]);
    if (!dash) { return; }
    this.dash = dash;
    this.costTrend = costs?.trend || [];
    this.cronJobs = sched?.openclaw || [];
    this.content = content;
    this.pipeline = pipeline;
    const n = await api('/notifications/unread-count');
    updateNotifBadge(n?.count || 0);
    this.updateComplete.then(() => this._renderChart());
    } catch (e) { console.error('Overview load failed:', e); }
  }

  private _barPct(val: number, max: number) {
    const p = Math.min(Math.max((val / max) * 100, 0), 100);
    return { width: p + '%', cls: p >= 100 ? 'ostat-bar-fill danger' : p >= 80 ? 'ostat-bar-fill warn' : 'ostat-bar-fill' };
  }

  render() {
    if (!this.dash) { return html`<div style="padding:40px;text-align:center;color:var(--text-dim)">Loading...</div>`; }
    const d = this.dash;
    const dp = d.costs.daily;
    const mp = d.costs.monthly;
    const t = d.tasks;
    const gw = d.system?.gateway;
    const dailyBar = this._barPct(dp.spend, dp.budget);
    const monthlyBar = this._barPct(mp.spend, mp.budget);

    return html`
      <div id="ov-agent-grid" class="ov-agent-grid">${this._renderAgentGrid(d.agents.list)}</div>

      <div class="orbital-stats-bar">
        <div class="ostat-card glass" id="ostat-spend">
          <div class="ostat-label">Daily Spend</div>
          <div class="ostat-value mono">$${dp.spend.toFixed(2)}</div>
          <div class="ostat-bar"><div class="${dailyBar.cls}" style="width:${dailyBar.width}"></div></div>
          <div class="ostat-sub">/ $${dp.budget.toFixed(2)} budget</div>
        </div>
        <div class="ostat-card glass" id="ostat-monthly">
          <div class="ostat-label">Monthly</div>
          <div class="ostat-value mono">$${mp.spend.toFixed(2)}</div>
          <div class="ostat-bar"><div class="${monthlyBar.cls} cyan" style="width:${monthlyBar.width}"></div></div>
          <div class="ostat-sub">/ $${mp.budget.toFixed(2)} budget</div>
        </div>
        <div class="ostat-card glass" id="ostat-tasks">
          <div class="ostat-label">Active Tasks</div>
          <div class="ostat-value mono">${t.in_progress}</div>
          <div class="ostat-sub">${t.blocked} blocked · ${t.backlog + t.planned} pending · ${t.done} done</div>
        </div>
        <div class="ostat-card glass" id="ostat-agents">
          <div class="ostat-label">Team</div>
          <div class="ostat-value mono">${d.agents.total}</div>
          <div class="ostat-sub">${d.agents.active} working · ${d.agents.subAgentCount || 0} sub-agents</div>
        </div>
        <div class="ostat-card glass" id="ostat-gateway">
          <div class="ostat-label">Gateway</div>
          <div class="ostat-value mono" style="color:${gw?.status === 'online' ? 'var(--green)' : 'var(--red)'}">${gw?.status === 'online' ? 'Online' : 'Offline'}</div>
          <div class="ostat-sub">${d.system?.disk?.used || '?'} · ${d.system?.disk?.available || '?'} free</div>
        </div>
      </div>

      <div class="overview-panels">
        <div class="panel glass panel-activity">
          <div class="panel-header"><h3>Activity Feed</h3><span class="panel-live-dot"></span></div>
          <div class="activity-feed">${this._renderActivity(d.activity || [])}</div>
        </div>
        <div class="panel glass panel-cron">
          <div class="panel-header"><h3>Cron Health</h3></div>
          <div class="activity-feed">${this._renderCronHealth()}</div>
        </div>
        <div class="panel glass panel-chart panel-cost-chart">
          <div class="panel-header"><h3>Cost Trend</h3><span class="panel-header-sub">30 days</span></div>
          <canvas id="ov-cost-chart"></canvas>
        </div>
        <div class="panel glass panel-content-mini">
          <div class="panel-header">
            <h3>Content Pipeline</h3>
            <button class="btn btn-ghost btn-xs" @click=${() => switchView('content')}>All →</button>
          </div>
          <div>${this._renderContent()}</div>
        </div>
        <div class="panel glass panel-channels-health">
          <div class="panel-header">
            <h3>Channel Health</h3>
            <button class="btn btn-ghost btn-xs" @click=${() => switchView('channels')}>All →</button>
          </div>
          <channel-health></channel-health>
        </div>
      </div>
    `;
  }

  private _renderAgentGrid(agents: Agent[]) {
    if (!agents.length) { return html`<div class="empty-msg">No agents loaded</div>`; }
    const filtered = agents.filter(a => !SUB_AGENTS.has(a.id));
    const ceo = filtered.find(a => a.id === 'main');
    const rest = filtered.filter(a => a.id !== 'main');
    const groups: Record<string, Agent[]> = { core: ceo ? [ceo] : [] };
    for (const a of rest) {
      const mod = (a.module || 'system').toLowerCase();
      if (!groups[mod]) { groups[mod] = []; }
      groups[mod].push(a);
    }
    return MODULE_ROWS.map(row => html`
      <div class="ov-row">
        ${row.map(mod => {
          const list = groups[mod];
          if (!list?.length) { return nothing; }
          const label = MODULE_LABELS[mod] || mod;
          return html`
            <div class="ov-section">
              <div class="ov-section-label">${label}</div>
              <div class="ov-section-cards">${list.map(a => this._renderCard(a))}</div>
            </div>`;
        })}
      </div>
    `);
  }

  private _renderCard(a: Agent) {
    const status = a.status || 'idle';
    const mti = modelTierInfo(a.modelTier || a.model_tier || 'haiku');
    const name = a.displayName || a.display_name || a.id;
    const avatarUrl = a.avatar_url || '';
    return html`
      <div class="ov-agent-card glass" @click=${() => switchView('team')} title="${name} — ${mti.tier}">
        <span class="ov-agent-status status-dot status-${status}"></span>
        <div class="ov-agent-avatar">
          ${avatarUrl
            ? html`<img src="${avatarUrl}" alt="" class="ov-agent-avatar-img">`
            : html`<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="6" r="3" stroke="currentColor" stroke-width="1.2" opacity="0.4"/><path d="M2.5 14c0-3 2.5-5.5 5.5-5.5s5.5 2.5 5.5 5.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity="0.4"/></svg>`}
        </div>
        <div class="ov-agent-name">${name}</div>
        <div class="ov-agent-tier">${mti.tier}</div>
      </div>`;
  }

  private _renderActivity(items: any[]) {
    if (!items.length) { return html`<div class="empty-msg">No recent activity</div>`; }
    return items.slice(0, 15).map(a => html`
      <div class="feed-item">
        <span class="feed-time">${shortTime(a.created_at)}</span>
        <span class="feed-agent">${a.agent_id || 'you'}</span>
        <span class="feed-text">${(a.action || '').replace(/_/g, ' ')}: ${a.detail || ''}</span>
      </div>`);
  }

  private _renderCronHealth() {
    if (!this.cronJobs.length) { return html`<div class="empty-msg">No cron jobs loaded</div>`; }
    return this.cronJobs.slice(0, 10).map((j: any) => {
      const st = j.state || {};
      const hasRun = !!st.lastRunAtMs;
      const hasError = hasRun && st.consecutiveErrors > 0;
      const statusClass = !hasRun ? 'offline' : hasError ? 'error' : 'online';
      const statusTitle = !hasRun ? 'Never run' : hasError ? 'Error' : 'OK';
      const lastStr = hasRun ? timeAgo(new Date(st.lastRunAtMs).toISOString()) : 'never';
      return html`
        <div class="feed-item">
          <span class="status-dot status-${statusClass}" style="width:5px;height:5px;" title="${statusTitle}"></span>
          <span class="cron-name">${j.name || j.id}</span>
          <span class="feed-time">${lastStr}</span>
        </div>`;
    });
  }

  private _renderContent() {
    const c = this.content;
    if (!c?.available) { return html`<div class="empty-msg">Video DB not available</div>`; }
    const cin = this.pipeline?.cinematic || {};
    return html`
      <div class="content-section-label">Standard Pipeline</div>
      <div class="content-stats">
        <div class="cs-item"><span class="cs-val">${c.queued}</span><span class="cs-lab">queued</span></div>
        <div class="cs-item"><span class="cs-val">${c.inProgress}</span><span class="cs-lab">in progress</span></div>
        <div class="cs-item"><span class="cs-val">${c.done}</span><span class="cs-lab">done</span></div>
        <div class="cs-item"><span class="cs-val">${c.topicsRemaining}</span><span class="cs-lab">topics left</span></div>
      </div>
      ${c.todayJob ? html`<div class="today-job">Today: <strong>${c.todayJob.topic || ''}</strong> — <span class="job-status">${c.todayJob.status}</span></div>` : nothing}
      ${cin.total ? html`
        <div class="content-divider"></div>
        <div class="content-section-label">Cinematic</div>
        <div class="content-stats">
          <div class="cs-item"><span class="cs-val">${cin.active || 0}</span><span class="cs-lab">active</span></div>
          <div class="cs-item"><span class="cs-val ${cin.awaiting_review ? 'cs-review' : ''}">${cin.awaiting_review || 0}</span><span class="cs-lab">awaiting review</span></div>
          <div class="cs-item"><span class="cs-val">${cin.total || 0}</span><span class="cs-lab">total</span></div>
        </div>
      ` : nothing}
    `;
  }

  private _renderChart() {
    const ctx = this.querySelector('#ov-cost-chart') as HTMLCanvasElement | null;
    if (!ctx) { return; }
    if (this._chart) { this._chart.destroy(); this._chart = null; }
    const clean = this.costTrend.filter(t => t && typeof t.total === 'number' && isFinite(t.total) && t.total >= 0);
    if (!clean.length) { return; }
    const vals = clean.map(t => t.total);
    const maxV = Math.max(...vals, 1);
    const Chart = (window as any).Chart;
    if (!Chart) { return; }
    this._chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: clean.map(t => t.date.slice(5)),
        datasets: [{ label: 'Daily $', data: vals, backgroundColor: 'rgba(0, 240, 255, 0.15)', borderColor: 'rgba(0, 240, 255, 0.50)', borderWidth: 1, borderRadius: 2 }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#6a6a8a', font: { size: 9, family: "'JetBrains Mono', monospace" } }, grid: { display: false } },
          y: { min: 0, max: Math.ceil(maxV * 1.2), ticks: { color: '#6a6a8a', font: { size: 9, family: "'JetBrains Mono', monospace" }, callback: (v: number) => '$' + v }, grid: { color: 'rgba(0, 240, 255, 0.04)' } },
        },
      },
    });
  }
}

declare global { interface HTMLElementTagNameMap { 'overview-view': OverviewView; } }
