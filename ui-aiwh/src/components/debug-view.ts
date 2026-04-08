import { LitElement, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';

type DashData = {
  system?: { gateway?: { status?: string; detail?: string }; disk?: { used?: string; available?: string }; cron?: number };
  tasks?: Record<string, number>;
  agents?: { list?: Array<{ id: string; display_name?: string; status?: string; last_active_at?: string; cost_today?: number }> };
};

type SysInfo = {
  hostname: string; uptime: number; dashboardUptime: number;
  freeMem: number; totalMem: number; loadavg: number[]; nodeVersion: string;
};

const api = (window as any).api as (url: string, opts?: any) => Promise<any>;
const showToast = (window as any).showToast as (msg: string, type?: string) => void;
const showModal = (window as any).showModal as (html: string, cls?: string) => void;
const closeModal = (window as any).closeModal as () => void;
const dashConfirm = (window as any).dashConfirm as (msg: string) => Promise<boolean>;
const escHtml = (window as any).escHtml as (s: string) => string;
const timeAgo = (window as any).timeAgo as (d: string) => string;

@customElement('debug-view')
export class DebugView extends LitElement {
  createRenderRoot() { return this; }

  @state() private dash: DashData | null = null;
  @state() private sysInfo: SysInfo | null = null;
  @state() private sysInfoError = false;
  @state() private loading = true;
  private _refreshTimer = 0;

  connectedCallback() { super.connectedCallback(); this.load(); }
  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._refreshTimer) { clearTimeout(this._refreshTimer); this._refreshTimer = 0; }
  }

  async load() {
    this.loading = true;
    try {
      const [dash] = await Promise.all([api('/dashboard')]);
      this.dash = dash;
      this._loadSysInfo();
    } catch (e) { console.error('Debug load failed:', e); }
    this.loading = false;
  }

  private async _loadSysInfo() {
    try {
      this.sysInfo = await api('/debug/system-info');
      this.sysInfoError = false;
    } catch { this.sysInfoError = true; }
  }

  private async _restartGateway() {
    const ok = await dashConfirm('Restart the AI gateway?\n\nThis will briefly interrupt any running agent tasks. Chat history is preserved.');
    if (!ok) {return;}
    showToast('Restarting gateway...');
    const r = await api('/debug/gateway-restart', { method: 'POST' });
    if (r?.ok) {
      showToast('Gateway restart initiated', 'success');
      this._refreshTimer = window.setTimeout(() => this.load(), 3000);
    } else {
      showToast('Restart failed: ' + (r?.error || 'unknown'), 'error');
    }
  }

  private async _syncCosts() {
    showToast('Syncing costs...');
    await api('/costs/sync', { method: 'POST' });
    showToast('Costs synced', 'success');
    this.load();
  }

  private async _syncCron() {
    await api('/cron/sync');
    showToast('Cron cache refreshed');
    this.load();
  }

  private async _refreshAgents() {
    const d = await api('/agents');
    showToast((d?.agents?.length || 0) + ' agents loaded', 'success');
    this.load();
  }

  private async _runDoctor() {
    showToast('Running doctor...');
    const r = await api('/debug/doctor');
    showModal(`
      <h3 style="margin:0 0 12px;font-size:14px;">OpenClaw Doctor</h3>
      <pre style="font-size:11px;white-space:pre-wrap;max-height:400px;overflow-y:auto;background:rgba(0,0,0,0.3);padding:12px;border-radius:6px;">${escHtml(r?.output || 'No output')}</pre>
      <div style="display:flex;justify-content:flex-end;margin-top:12px;">
        <button class="btn btn-ghost" onclick="closeModal()">Close</button>
      </div>
    `, 'modal-lg');
  }

  render() {
    if (this.loading) {return html`<div style="padding:40px;text-align:center;color:var(--text-dim)">Loading...</div>`;}
    const gw = this.dash?.system?.gateway || {};
    const disk = this.dash?.system?.disk || {};
    const dbAgents = this.dash?.agents?.list || [];
    const tasks = this.dash?.tasks || {};

    return html`
      <header class="view-header">
        <div class="view-header-left">
          <span class="view-eyebrow">Diagnostics</span>
          <h1>Debug</h1>
        </div>
        <button class="btn btn-ghost" @click=${() => this.load()}>↻ Refresh</button>
      </header>

      <div class="debug-grid">
        <!-- Gateway -->
        <div class="debug-card">
          <div class="debug-card-title">OpenClaw Gateway</div>
          <div class="debug-row">
            <span class="debug-label">Status</span>
            <span class="debug-val ${gw.status === 'online' ? 'text-green' : 'text-red'}">${gw.status || 'unknown'}</span>
          </div>
          <div class="debug-row">
            <span class="debug-label">URL</span>
            <code class="debug-val">http://127.0.0.1:18789</code>
          </div>
          <div class="debug-row">
            <span class="debug-label">Detail</span>
            <span class="debug-val">${gw.detail || '—'}</span>
          </div>
        </div>

        <!-- Disk -->
        <div class="debug-card">
          <div class="debug-card-title">Disk Usage</div>
          <div class="debug-row">
            <span class="debug-label">AIWH Used</span>
            <span class="debug-val">${disk.used || '?'}</span>
          </div>
          <div class="debug-row">
            <span class="debug-label">Available</span>
            <span class="debug-val">${disk.available || '?'}</span>
          </div>
        </div>

        <!-- Tasks -->
        <div class="debug-card">
          <div class="debug-card-title">Task Summary</div>
          ${Object.entries(tasks).map(([k, v]) => html`
            <div class="debug-row">
              <span class="debug-label">${k.replace('_', ' ')}</span>
              <span class="debug-val">${v}</span>
            </div>
          `)}
        </div>

        <!-- Agents -->
        <div class="debug-card">
          <div class="debug-card-title">Agent Status (${dbAgents.length})</div>
          <div class="debug-agent-list">
            ${dbAgents.map(a => html`
              <div class="debug-row">
                <span class="debug-label">
                  <span class="status-dot status-${a.status || 'idle'}"></span>
                  ${a.display_name || a.id}
                </span>
                <span class="debug-val debug-val-sm">
                  ${timeAgo(a.last_active_at || '')}
                  ${(a.cost_today || 0) > 0 ? ` · $${a.cost_today!.toFixed(4)}` : ''}
                </span>
              </div>
            `)}
          </div>
        </div>

        <!-- Cron -->
        <div class="debug-card">
          <div class="debug-card-title">Cron Jobs (${this.dash?.system?.cron || 0})</div>
          <div class="debug-row">
            <span class="debug-label">Cached jobs</span>
            <span class="debug-val">${this.dash?.system?.cron || 0}</span>
          </div>
          <button class="btn btn-ghost btn-sm"
                  @click=${() => this._syncCron()}
                  title="Re-reads scheduled jobs from the gateway.">Sync Cron Cache</button>
        </div>

        <!-- System Info -->
        <div class="debug-card">
          <div class="debug-card-title">System Info</div>
          ${this.sysInfoError ? html`<div class="debug-row"><span class="debug-label text-red">Failed</span></div>` :
            !this.sysInfo ? html`<div class="debug-row"><span class="debug-label">Loading...</span></div>` :
            this._renderSysInfo(this.sysInfo)}
        </div>

        <!-- Actions -->
        <div class="debug-card">
          <div class="debug-card-title">Actions</div>
          <div class="debug-actions">
            <button class="btn btn-ghost btn-sm" @click=${() => this._restartGateway()} title="Stops and restarts the AI gateway.">Restart Gateway</button>
            <button class="btn btn-ghost btn-sm" @click=${() => this._runDoctor()} title="Runs a diagnostic check on the gateway.">Run Doctor</button>
            <button class="btn btn-ghost btn-sm" @click=${() => this._syncCosts()} title="Re-reads cost data from the gateway.">Sync Costs</button>
            <button class="btn btn-ghost btn-sm" @click=${() => this._refreshAgents()} title="Re-reads the agent list from gateway config.">Refresh Agents</button>
            <button class="btn btn-ghost btn-sm" @click=${() => this.load()}>↻ Refresh</button>
          </div>
        </div>
      </div>
    `;
  }

  private _renderSysInfo(info: SysInfo) {
    const uptimeH = Math.floor(info.uptime / 3600);
    const uptimeM = Math.floor((info.uptime % 3600) / 60);
    const dashUpH = Math.floor(info.dashboardUptime / 3600);
    const dashUpM = Math.floor((info.dashboardUptime % 3600) / 60);
    const memPct = Math.round((1 - info.freeMem / info.totalMem) * 100);
    return html`
      <div class="debug-row"><span class="debug-label">Host</span><span class="debug-val">${info.hostname}</span></div>
      <div class="debug-row"><span class="debug-label">OS Uptime</span><span class="debug-val">${uptimeH}h ${uptimeM}m</span></div>
      <div class="debug-row"><span class="debug-label">Dashboard Uptime</span><span class="debug-val">${dashUpH}h ${dashUpM}m</span></div>
      <div class="debug-row"><span class="debug-label">Memory</span><span class="debug-val">${memPct}% used</span></div>
      <div class="debug-row"><span class="debug-label">Load</span><span class="debug-val">${info.loadavg.map(l => l.toFixed(2)).join(' / ')}</span></div>
      <div class="debug-row"><span class="debug-label">Node</span><span class="debug-val">${info.nodeVersion}</span></div>
    `;
  }
}

declare global { interface HTMLElementTagNameMap { 'debug-view': DebugView; } }
