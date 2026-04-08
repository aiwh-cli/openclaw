import { LitElement, html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';

type CostData = {
  daily: { spend: number; budget: number };
  monthly: { spend: number; budget: number };
  byPlatform?: { daily?: Record<string, number>; monthly?: Record<string, number>; allTime?: Record<string, number> };
  byTier?: Array<{ tier: string; model?: string; cost: number }>;
  trend?: Array<{ date: string; total: number }>;
  platformTrend?: Array<Record<string, any>>;
};

const api = (window as any).api as (url: string, opts?: any) => Promise<any>;
const showToast = (window as any).showToast as (msg: string, type?: string) => void;
const showModal = (window as any).showModal as (html: string, cls?: string) => void;
const closeModal = (window as any).closeModal as () => void;
const dashConfirm = (window as any).dashConfirm as (msg: string) => Promise<boolean>;
const escHtml = (window as any).escHtml as (s: string) => string;

const PLAT_COLORS: Record<string, string> = { google: '#4285F4', anthropic: '#d4a574', elevenlabs: '#6366f1', heygen: '#f59e0b', runway: '#ef4444', openai: '#10a37f' };
const PLAT_LABELS: Record<string, string> = { google: 'Google (Imagen/Veo)', anthropic: 'Anthropic', elevenlabs: 'ElevenLabs', heygen: 'HeyGen', runway: 'Runway', openai: 'OpenAI' };
const TIER_COLORS: Record<string, string> = { opus: '#a855f7', sonnet: '#3b82f6', haiku: '#22c55e', other: 'var(--text-dim)' };

@customElement('costs-view')
export class CostsView extends LitElement {
  createRenderRoot() { return this; }

  @state() private costs: CostData | null = null;
  @state() private subs: any[] = [];
  @state() private filter = 'all';
  private _chart: any = null;

  connectedCallback() { super.connectedCallback(); this.load(); }
  disconnectedCallback() { super.disconnectedCallback(); if (this._chart) { this._chart.destroy(); this._chart = null; } }

  async load() {
    try {
      const [costs, , subs] = await Promise.all([api('/costs'), api('/agents'), api('/costs/subscriptions')]);
      this.costs = costs;
      this.subs = subs || [];
      this.updateComplete.then(() => this._renderChart());
    } catch (e) { console.error('Costs load failed:', e); }
  }

  private _barCls(pct: number) {
    return 'metric-bar-fill' + (pct >= 100 ? ' danger' : pct >= 80 ? ' warn' : '');
  }

  render() {
    if (!this.costs) { return html`<div style="padding:40px;text-align:center;color:var(--text-dim)">Loading...</div>`; }
    const dp = this.costs.daily;
    const mp = this.costs.monthly;
    const dailyPct = Math.min((dp.spend / dp.budget) * 100, 100);
    const monthlyPct = Math.min((mp.spend / mp.budget) * 100, 100);

    return html`
      <header class="view-header">
        <div class="view-header-left"><span class="view-eyebrow">Finance</span><h1>Costs</h1></div>
        <button class="btn btn-ghost" @click=${() => this.load()}>↻ Refresh</button>
      </header>
      <div class="metrics-row">
        <div class="metric-card glass">
          <div class="metric-label">Daily API Spend</div>
          <div class="metric-value mono">$${dp.spend.toFixed(2)}</div>
          <div class="metric-bar"><div class="${this._barCls(dailyPct)}" style="width:${dailyPct}%"></div></div>
          <div class="metric-sub">of $${dp.budget.toFixed(2)} budget</div>
        </div>
        <div class="metric-card glass">
          <div class="metric-label">Monthly API Spend</div>
          <div class="metric-value mono">$${mp.spend.toFixed(2)}</div>
          <div class="metric-bar"><div class="${this._barCls(monthlyPct)} cyan" style="width:${monthlyPct}%"></div></div>
          <div class="metric-sub">of $${mp.budget.toFixed(2)} budget</div>
        </div>
      </div>
      <div class="costs-grid">
        <div class="panel glass"><div class="panel-header"><h3>Platform Spend</h3></div>${this._renderPlatform()}</div>
        <div class="panel glass"><div class="panel-header"><h3>By Model Tier</h3></div>${this._renderTier()}</div>
        <div class="panel glass"><div class="panel-header"><h3>Subscriptions</h3></div>${this._renderSubs()}</div>
        <div class="panel glass panel-chart span-2">
          <div class="panel-header">
            <h3>30-Day Spend Trend</h3>
            <select class="select-sm" .value=${this.filter} @change=${(e: Event) => { this.filter = (e.target as HTMLSelectElement).value; this._renderChart(); }}>
              <option value="all">All Spend</option>
              <option value="openclaw">OpenClaw API</option>
              <option value="google">Google (Imagen/Veo)</option>
              <option value="elevenlabs">ElevenLabs</option>
              <option value="heygen">HeyGen</option>
              <option value="anthropic">Anthropic (Cinematic)</option>
              <option value="platform">All Platforms</option>
            </select>
          </div>
          <canvas id="costs-chart"></canvas>
        </div>
      </div>
      <div style="margin-top:24px">
        <h2 style="font-size:16px;margin-bottom:12px;color:var(--text-primary)">Session Usage</h2>
        <usage-panel></usage-panel>
      </div>
    `;
  }

  private _renderPlatform() {
    const p = this.costs?.byPlatform;
    if (!p) { return html`<div class="empty-msg">No platform data</div>`; }
    const daily = p.daily || {};
    const monthly = p.monthly || {};
    const services = new Set([...Object.keys(daily), ...Object.keys(monthly)]);
    if (!services.size) { return html`<div class="empty-msg">No platform spend recorded</div>`; }
    const maxM = Math.max(...Object.values(monthly), 0.01);
    const sorted = [...services].toSorted((a, b) => (monthly[b] || 0) - (monthly[a] || 0));
    const totalD = Object.values(daily).reduce((s, v) => s + v, 0);
    const totalM = Object.values(monthly).reduce((s, v) => s + v, 0);
    return html`
      <div style="display:flex;justify-content:space-between;margin-bottom:10px;font-size:11px;">
        <span>Today: <strong style="color:var(--accent)">$${totalD.toFixed(2)}</strong></span>
        <span>This month: <strong style="color:var(--accent)">$${totalM.toFixed(2)}</strong></span>
      </div>
      ${sorted.map(svc => {
        const color = PLAT_COLORS[svc] || 'var(--text-muted)';
        const pct = ((monthly[svc] || 0) / maxM) * 100;
        return html`<div class="tier-row">
          <span class="tier-name" style="color:${color}">${PLAT_LABELS[svc] || svc}</span>
          <div class="tier-bar-wrap"><div class="tier-bar" style="width:${pct.toFixed(1)}%;background:${color}"></div></div>
          <span class="tier-val" title="Today: $${(daily[svc] || 0).toFixed(2)}">$${(monthly[svc] || 0).toFixed(2)}</span>
        </div>`;
      })}
      <div class="text-muted" style="margin-top:8px;font-size:10px;">Monthly totals from cinematic production ledger. Hover for daily.</div>
    `;
  }

  private _renderTier() {
    const tierData = this.costs?.byTier || [];
    if (!tierData.length) { return html`<div class="empty-msg">No OpenClaw API spend recorded today.</div>`; }
    const maxCost = Math.max(...tierData.map(t => t.cost), 0.01);
    return tierData.map(t => {
      const pct = (t.cost / maxCost) * 100;
      const color = TIER_COLORS[t.tier] || 'var(--text-muted)';
      return html`<div class="tier-row">
        <span class="tier-name" style="color:${color}">${t.model || t.tier}</span>
        <div class="tier-bar-wrap"><div class="tier-bar" style="width:${pct.toFixed(1)}%;background:${color}"></div></div>
        <span class="tier-val">$${t.cost.toFixed(4)}</span>
      </div>`;
    });
  }

  private _renderSubs() {
    const total = this.subs.reduce((s: number, sub: any) => s + (sub.cost || 0), 0);
    return html`
      <div class="sub-total" style="display:flex;justify-content:space-between;align-items:center;">
        <span>Monthly: <strong>$${total.toFixed(0)}/mo</strong></span>
        <button class="btn-ghost" style="font-size:10px;padding:2px 8px;" @click=${() => this._showAddSub()}>+ Add</button>
      </div>
      ${!this.subs.length ? html`<div class="empty-msg">No subscriptions configured</div>` : nothing}
      <div class="sub-list">
        ${this.subs.map(sub => {
          const renewal = sub.renewal_date;
          let urgent = false;
          let daysUntil = 0;
          if (renewal) {
            daysUntil = Math.ceil((new Date(renewal + 'T00:00:00').getTime() - Date.now()) / 86400000);
            if (daysUntil <= 7) { urgent = true; }
          }
          return html`<div class="sub-row${urgent ? ' sub-urgent' : ''}" @click=${() => this._editSub(sub.id)} style="cursor:pointer" title="Click to edit">
            <span class="sub-name">${sub.name}</span>
            ${urgent && daysUntil <= 0 ? html`<span class="sub-renewal sub-overdue">overdue</span>`
              : urgent ? html`<span class="sub-renewal sub-soon">${daysUntil}d</span>`
              : renewal ? html`<span class="sub-renewal">${daysUntil}d</span>`
              : html`<span class="sub-renewal" style="opacity:0.3">no date</span>`}
            <span class="sub-cost">$${(sub.cost || 0).toFixed(0)}/mo</span>
          </div>`;
        })}
      </div>
    `;
  }

  private async _editSub(id: string) {
    const subs = await api('/costs/subscriptions');
    const sub = (subs || []).find((s: any) => s.id === id);
    if (!sub) { return; }
    const self = this;
    const content = `
      <h3 style="margin:0 0 12px;font-size:14px;">Edit Subscription</h3>
      <div style="display:flex;flex-direction:column;gap:12px;">
        <div><label style="font-size:10px;color:var(--text-muted);display:block;margin-bottom:4px;">Name</label>
          <input id="sub-edit-name" class="job-edit-textarea" style="height:auto;resize:none;padding:6px 8px;" value="${escHtml(sub.name)}"></div>
        <div style="display:flex;gap:12px;">
          <div style="flex:1"><label style="font-size:10px;color:var(--text-muted);display:block;margin-bottom:4px;">Cost ($/mo)</label>
            <input id="sub-edit-cost" type="number" step="0.01" class="job-edit-textarea" style="height:auto;resize:none;padding:6px 8px;" value="${sub.cost || 0}"></div>
          <div style="flex:1"><label style="font-size:10px;color:var(--text-muted);display:block;margin-bottom:4px;">Cycle</label>
            <select id="sub-edit-cycle" class="select-sm" style="width:100%;padding:6px 8px;">
              <option value="monthly" ${sub.cycle === 'monthly' ? 'selected' : ''}>Monthly</option>
              <option value="annual" ${sub.cycle === 'annual' ? 'selected' : ''}>Annual</option>
            </select></div>
        </div>
        <div><label style="font-size:10px;color:var(--text-muted);display:block;margin-bottom:4px;">Next Renewal Date</label>
          <input id="sub-edit-renewal" type="date" class="job-edit-textarea" style="height:auto;resize:none;padding:6px 8px;" value="${sub.renewal_date || ''}"></div>
        <div style="display:flex;gap:8px;justify-content:space-between;margin-top:4px;">
          <button class="btn-ghost" style="color:var(--critical);font-size:10px;" onclick="document.querySelector('costs-view')._deleteSub('${escHtml(id)}')">Delete</button>
          <div style="display:flex;gap:8px;">
            <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
            <button class="btn btn-success" onclick="document.querySelector('costs-view')._saveSub('${escHtml(id)}')">Save</button>
          </div>
        </div>
      </div>`;
    showModal(content, 'modal-sm');
  }

  async _saveSub(id: string) {
    const name = (document.getElementById('sub-edit-name') as HTMLInputElement)?.value;
    const cost = parseFloat((document.getElementById('sub-edit-cost') as HTMLInputElement)?.value);
    const cycle = (document.getElementById('sub-edit-cycle') as HTMLSelectElement)?.value;
    const renewal_date = (document.getElementById('sub-edit-renewal') as HTMLInputElement)?.value || null;
    await fetch(`/api/costs/subscriptions/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, cost, cycle, renewal_date }) });
    closeModal(); this.load();
  }

  async _deleteSub(id: string) {
    const ok = await dashConfirm('Delete this subscription?');
    if (!ok) { return; }
    await fetch(`/api/costs/subscriptions/${id}`, { method: 'DELETE' });
    closeModal(); this.load();
  }

  private _showAddSub() {
    const content = `
      <h3 style="margin:0 0 12px;font-size:14px;">Add Subscription</h3>
      <div style="display:flex;flex-direction:column;gap:12px;">
        <div><label style="font-size:10px;color:var(--text-muted);display:block;margin-bottom:4px;">Name</label>
          <input id="sub-add-name" class="job-edit-textarea" style="height:auto;resize:none;padding:6px 8px;" placeholder="e.g. Notion"></div>
        <div style="display:flex;gap:12px;">
          <div style="flex:1"><label style="font-size:10px;color:var(--text-muted);display:block;margin-bottom:4px;">Cost ($/mo)</label>
            <input id="sub-add-cost" type="number" step="0.01" class="job-edit-textarea" style="height:auto;resize:none;padding:6px 8px;" placeholder="10.00"></div>
          <div style="flex:1"><label style="font-size:10px;color:var(--text-muted);display:block;margin-bottom:4px;">Cycle</label>
            <select id="sub-add-cycle" class="select-sm" style="width:100%;padding:6px 8px;">
              <option value="monthly">Monthly</option>
              <option value="annual">Annual</option>
            </select></div>
        </div>
        <div><label style="font-size:10px;color:var(--text-muted);display:block;margin-bottom:4px;">Next Renewal Date</label>
          <input id="sub-add-renewal" type="date" class="job-edit-textarea" style="height:auto;resize:none;padding:6px 8px;"></div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:4px;">
          <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
          <button class="btn btn-success" onclick="document.querySelector('costs-view')._addSub()">Add</button>
        </div>
      </div>`;
    showModal(content, 'modal-sm');
  }

  async _addSub() {
    const name = (document.getElementById('sub-add-name') as HTMLInputElement)?.value?.trim();
    const cost = parseFloat((document.getElementById('sub-add-cost') as HTMLInputElement)?.value);
    const cycle = (document.getElementById('sub-add-cycle') as HTMLSelectElement)?.value;
    const renewal_date = (document.getElementById('sub-add-renewal') as HTMLInputElement)?.value || null;
    if (!name) { return alert('Name is required'); }
    if (isNaN(cost)) { return alert('Cost is required'); }
    const res = await fetch('/api/costs/subscriptions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, cost, cycle, renewal_date }) });
    const data = await res.json();
    if (data.error) { return alert(data.error); }
    closeModal(); this.load();
  }

  private _renderChart() {
    const ctx = this.querySelector('#costs-chart') as HTMLCanvasElement | null;
    if (!ctx || !this.costs) { return; }
    if (this._chart) { this._chart.destroy(); this._chart = null; }
    const Chart = (window as any).Chart;
    if (!Chart) { return; }

    const apiTrend = this.costs.trend || [];
    const platformTrend = this.costs.platformTrend || [];
    const filter = this.filter;

    const byDate: Record<string, Record<string, number>> = {};
    for (const t of apiTrend) {
      if (!t?.date) { continue; }
      if (!byDate[t.date]) { byDate[t.date] = { openclaw: 0, google: 0, elevenlabs: 0, heygen: 0, anthropic: 0, runway: 0 }; }
      byDate[t.date].openclaw = t.total || 0;
    }
    for (const t of platformTrend) {
      if (!t?.date) { continue; }
      if (!byDate[t.date]) { byDate[t.date] = { openclaw: 0, google: 0, elevenlabs: 0, heygen: 0, anthropic: 0, runway: 0 }; }
      byDate[t.date].google = t.google || 0;
      byDate[t.date].elevenlabs = t.elevenlabs || 0;
      byDate[t.date].heygen = t.heygen || 0;
      byDate[t.date].anthropic = t.anthropic || 0;
      byDate[t.date].runway = t.runway || 0;
    }

    const dates = Object.keys(byDate).toSorted();
    if (!dates.length) { return; }

    const C: Record<string, { bg: string; border: string; point: string }> = {
      openclaw: { bg: 'rgba(0,240,255,0.08)', border: 'rgba(0,240,255,0.55)', point: 'rgba(0,240,255,0.65)' },
      google: { bg: 'rgba(66,133,244,0.08)', border: 'rgba(66,133,244,0.7)', point: 'rgba(66,133,244,0.8)' },
      elevenlabs: { bg: 'rgba(99,102,241,0.08)', border: 'rgba(99,102,241,0.7)', point: 'rgba(99,102,241,0.8)' },
      heygen: { bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.7)', point: 'rgba(245,158,11,0.8)' },
      anthropic: { bg: 'rgba(212,165,116,0.08)', border: 'rgba(212,165,116,0.7)', point: 'rgba(212,165,116,0.8)' },
    };
    const makeDS = (label: string, key: string, colors: any) => ({
      label, data: dates.map(d => byDate[d][key] || 0),
      backgroundColor: colors.bg, borderColor: colors.border, borderWidth: 2, fill: true, tension: 0.3, pointRadius: 3, pointBackgroundColor: colors.point,
    });

    const datasets: any[] = [];
    if (filter === 'all') {
      datasets.push({ label: 'Total Spend', data: dates.map(d => { const v = byDate[d]; return (v.openclaw||0)+(v.google||0)+(v.elevenlabs||0)+(v.heygen||0)+(v.anthropic||0)+(v.runway||0); }), ...C.openclaw, borderWidth: 2, fill: true, tension: 0.3, pointRadius: 3, pointBackgroundColor: C.openclaw.point });
    } else if (filter === 'openclaw') { datasets.push(makeDS('OpenClaw API', 'openclaw', C.openclaw)); }
    else if (filter === 'platform') { datasets.push(makeDS('Google','google',C.google), makeDS('ElevenLabs','elevenlabs',C.elevenlabs), makeDS('HeyGen','heygen',C.heygen), makeDS('Anthropic','anthropic',C.anthropic)); }
    else { datasets.push(makeDS(filter, filter, C[filter] || C.openclaw)); }

    const allVals = datasets.flatMap((ds: any) => ds.data);
    const maxV = Math.max(...allVals, 1);

    this._chart = new Chart(ctx, {
      type: 'line',
      data: { labels: dates.map(d => d.slice(5)), datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: datasets.length > 1, labels: { color: '#6a6a8a', font: { size: 10 } } } },
        scales: {
          x: { ticks: { color: '#6a6a8a', font: { size: 10, family: "'JetBrains Mono', monospace" } }, grid: { color: 'rgba(0,240,255,0.04)' } },
          y: { min: 0, max: Math.ceil(maxV * 1.3), ticks: { color: '#6a6a8a', font: { size: 10, family: "'JetBrains Mono', monospace" }, callback: (v: number) => '$' + v.toFixed(0) }, grid: { color: 'rgba(0,240,255,0.04)' } },
        },
      },
    });
  }
}

declare global { interface HTMLElementTagNameMap { 'costs-view': CostsView; } }
