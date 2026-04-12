import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';

interface AuditEntry {
  id: number; timestamp: string; actor: string; action: string;
  target: string; detail: string; result: string; ip_address: string;
}

interface AuditStats {
  total: number; success: number; denied: number; errors: number;
  topActions: Array<{ action: string; count: number }>;
}

const api = (window as any).api as (url: string, opts?: any) => Promise<any>;
const escHtml = (window as any).escHtml as (s: string) => string;

@customElement('audit-trail-view')
export class AuditTrailView extends LitElement {
  createRenderRoot() { return this; }

  @state() private entries: AuditEntry[] = [];
  @state() private stats: AuditStats | null = null;
  @state() private loading = true;
  @state() private page = 1;
  @state() private totalPages = 1;
  @state() private filterActor = '';
  @state() private filterAction = '';
  @state() private filterResult = '';
  @state() private expandedId: number | null = null;
  // Archive browsing (AC.4)
  @state() private archiveMonths: string[] = [];
  @state() private archiveMonth = '';
  @state() private archiveEntries: AuditEntry[] = [];
  @state() private archivePage = 1;
  @state() private archiveTotalPages = 1;
  @state() private showArchive = false;
  @state() private archiveLoading = false;

  connectedCallback() { super.connectedCallback(); this._load(); }

  private async _load() {
    this.loading = true;
    try {
      const params = new URLSearchParams({ page: String(this.page), limit: '50' });
      if (this.filterActor) params.set('actor', this.filterActor);
      if (this.filterAction) params.set('action', this.filterAction);
      if (this.filterResult) params.set('result', this.filterResult);

      const [logRes, statsRes] = await Promise.all([
        api(`/audit-log?${params}`),
        api('/audit-log/stats'),
      ]);
      this.entries = logRes.entries || [];
      this.totalPages = logRes.pagination?.pages || 1;
      this.stats = statsRes;
    } catch { this.entries = []; }
    finally { this.loading = false; }
  }

  private _fmtTime(ts: string) {
    if (!ts) return '';
    const d = new Date(ts + 'Z');
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) +
      ' ' + d.toLocaleDateString([], { day: 'numeric', month: 'short' });
  }

  private _resultBadge(r: string) {
    const cls = r === 'success' ? 'badge-ok' : r === 'denied' ? 'badge-warn' : 'badge-err';
    return html`<span class="audit-badge ${cls}">${r}</span>`;
  }

  private _actorIcon(actor: string) {
    if (actor.startsWith('dashboard:')) return '\u{1F464}';
    if (actor.startsWith('cron:')) return '\u{23F0}';
    if (actor.startsWith('workflow:')) return '\u{2699}';
    if (actor.startsWith('agent:')) return '\u{1F916}';
    return '\u{1F4BB}';
  }

  private _toggleDetail(id: number) {
    this.expandedId = this.expandedId === id ? null : id;
  }

  private async _export() {
    try {
      const res = await fetch('/api/audit-log/export', { credentials: 'same-origin' });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click(); URL.revokeObjectURL(url);
    } catch { /* ignore */ }
  }

  private _prevPage() { if (this.page > 1) { this.page--; this._load(); } }
  private _nextPage() { if (this.page < this.totalPages) { this.page++; this._load(); } }

  // Archive browsing (AC.4)
  private async _toggleArchive() {
    this.showArchive = !this.showArchive;
    if (this.showArchive && this.archiveMonths.length === 0) {
      try {
        const res = await api('/audit-log/archive/months');
        this.archiveMonths = res.months || [];
        if (this.archiveMonths.length > 0) { this.archiveMonth = this.archiveMonths[0]; this._loadArchive(); }
      } catch { this.archiveMonths = []; }
    }
  }
  private async _loadArchive() {
    if (!this.archiveMonth) return;
    this.archiveLoading = true;
    try {
      const res = await api(`/audit-log/archive?month=${this.archiveMonth}&page=${this.archivePage}&limit=50`);
      this.archiveEntries = res.entries || [];
      this.archiveTotalPages = res.pagination?.pages || 1;
    } catch { this.archiveEntries = []; }
    this.archiveLoading = false;
  }

  render() {
    return html`
      <style>
        .audit-stats { display: flex; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
        .audit-stat {
          padding: 10px 16px; border-radius: 8px; font-size: 13px;
          background: var(--surface, rgba(14,14,18,0.5));
          border: 1px solid var(--border-faint, rgba(201,168,76,0.06));
          display: flex; flex-direction: column; gap: 2px; min-width: 80px;
        }
        .audit-stat .label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted, #8A8578); }
        .audit-stat .value { font-size: 20px; font-weight: 600; font-family: 'JetBrains Mono', monospace; }
        .audit-stat .value.ok { color: var(--green, #4CAF50); }
        .audit-stat .value.warn { color: var(--amber, #F9A825); }
        .audit-stat .value.err { color: var(--red, #E53935); }

        .audit-filters { display: flex; gap: 8px; margin-bottom: 12px; align-items: center; flex-wrap: wrap; }
        .audit-filters select, .audit-filters input {
          padding: 5px 10px; font-size: 12px; border-radius: 5px;
          background: var(--surface, rgba(14,14,18,0.5)); color: var(--text-primary, #F5EDD6);
          border: 1px solid var(--border-faint, rgba(201,168,76,0.08)); font-family: 'Inter', sans-serif;
        }
        .audit-filters select:focus, .audit-filters input:focus { outline: none; border-color: var(--magenta, #C9A84C); }
        .audit-btn {
          padding: 5px 10px; font-size: 11px; font-weight: 500; border-radius: 5px;
          cursor: pointer; border: 1px solid var(--border-faint, rgba(201,168,76,0.10)); background: none;
          color: var(--text-muted, #8A8578); font-family: 'Inter', sans-serif;
        }
        .audit-btn:hover { border-color: var(--border-hover, rgba(201,168,76,0.25)); color: var(--text-primary, #F5EDD6); }

        .audit-table { width: 100%; border-collapse: collapse; font-size: 12px; }
        .audit-table th {
          text-align: left; padding: 8px 10px; font-size: 10px; text-transform: uppercase;
          letter-spacing: 0.5px; color: var(--text-muted, #8A8578); font-weight: 600;
          border-bottom: 1px solid var(--border-faint, rgba(201,168,76,0.08));
        }
        .audit-table td {
          padding: 7px 10px; border-bottom: 1px solid var(--border-faint, rgba(201,168,76,0.04));
          color: var(--text-primary, #F5EDD6); vertical-align: top;
        }
        .audit-table tr { cursor: pointer; }
        .audit-table tr:hover { background: var(--magenta-dim, rgba(201,168,76,0.03)); }
        .audit-badge {
          padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; text-transform: uppercase;
        }
        .badge-ok { background: rgba(76,175,80,0.15); color: #4CAF50; }
        .badge-warn { background: rgba(249,168,37,0.15); color: #F9A825; }
        .badge-err { background: rgba(229,57,53,0.15); color: #E53935; }
        .audit-detail {
          font-family: 'JetBrains Mono', monospace; font-size: 11px; padding: 8px 12px;
          background: var(--surface-hi, rgba(10,10,15,0.6)); border-radius: 6px; margin: 4px 0;
          border: 1px solid var(--border-faint, rgba(201,168,76,0.06));
          white-space: pre-wrap; word-break: break-all; color: var(--text-muted, #8A8578);
          max-height: 200px; overflow: auto;
        }
        .audit-pager { display: flex; gap: 8px; align-items: center; justify-content: center; margin-top: 12px; }
        .audit-pager span { font-size: 12px; color: var(--text-muted, #8A8578); }
        .audit-empty { text-align: center; padding: 32px; color: var(--text-muted, #8A8578); font-size: 13px; }
      </style>

      ${this.stats ? html`
        <div class="audit-stats">
          <div class="audit-stat"><span class="label">Last 24h</span><span class="value">${this.stats.total}</span></div>
          <div class="audit-stat"><span class="label">Success</span><span class="value ok">${this.stats.success}</span></div>
          <div class="audit-stat"><span class="label">Denied</span><span class="value warn">${this.stats.denied}</span></div>
          <div class="audit-stat"><span class="label">Errors</span><span class="value err">${this.stats.errors}</span></div>
        </div>
      ` : nothing}

      <div class="audit-filters">
        <input placeholder="Filter actor..." .value=${this.filterActor}
          @input=${(e: Event) => { this.filterActor = (e.target as HTMLInputElement).value; }}>
        <input placeholder="Filter action..." .value=${this.filterAction}
          @input=${(e: Event) => { this.filterAction = (e.target as HTMLInputElement).value; }}>
        <select @change=${(e: Event) => { this.filterResult = (e.target as HTMLSelectElement).value; }}>
          <option value="">All results</option>
          <option value="success">Success</option>
          <option value="denied">Denied</option>
          <option value="error">Error</option>
        </select>
        <button class="audit-btn" @click=${() => { this.page = 1; this._load(); }}>Apply</button>
        <button class="audit-btn" @click=${() => { this.filterActor = ''; this.filterAction = ''; this.filterResult = ''; this.page = 1; this._load(); }}>Clear</button>
        <button class="audit-btn" @click=${this._export}>Export CSV</button>
        <button class="audit-btn" @click=${() => this._load()}>Refresh</button>
      </div>

      ${this.loading ? html`<div class="audit-empty">Loading...</div>` :
        this.entries.length === 0 ? html`<div class="audit-empty">No activity recorded yet</div>` : html`
          <table class="audit-table">
            <thead><tr>
              <th>Time</th><th>Actor</th><th>Action</th><th>Target</th><th>Result</th>
            </tr></thead>
            <tbody>
              ${this.entries.map(e => html`
                <tr @click=${() => this._toggleDetail(e.id)}>
                  <td style="white-space:nowrap; font-family:'JetBrains Mono',monospace; font-size:11px">${this._fmtTime(e.timestamp)}</td>
                  <td>${this._actorIcon(e.actor)} ${escHtml(e.actor)}</td>
                  <td><code>${escHtml(e.action)}</code></td>
                  <td>${escHtml(e.target || '—')}</td>
                  <td>${this._resultBadge(e.result)}</td>
                </tr>
                ${this.expandedId === e.id ? html`
                  <tr><td colspan="5"><div class="audit-detail">${this._prettyDetail(e.detail)}</div></td></tr>
                ` : nothing}
              `)}
            </tbody>
          </table>

          <div class="audit-pager">
            <button class="audit-btn" ?disabled=${this.page <= 1} @click=${this._prevPage}>Prev</button>
            <span>Page ${this.page} of ${this.totalPages}</span>
            <button class="audit-btn" ?disabled=${this.page >= this.totalPages} @click=${this._nextPage}>Next</button>
          </div>
        `
      }

      <div style="margin-top:16px;text-align:center">
        <button class="audit-btn" @click=${this._toggleArchive}>
          ${this.showArchive ? 'Hide Archive' : 'Browse Archive'}
        </button>
      </div>

      ${this.showArchive ? html`
        <div style="margin-top:12px; padding:14px; border:1px solid var(--border-faint, rgba(201,168,76,0.08)); border-radius:8px; background:var(--surface, rgba(14,14,18,0.5))">
          <div style="display:flex; gap:8px; align-items:center; margin-bottom:10px">
            <span style="font-size:12px; color:var(--text-muted)">Month:</span>
            <select style="padding:4px 8px; font-size:12px; border-radius:4px; background:var(--surface); color:var(--text-primary); border:1px solid var(--border-faint)"
              @change=${(e: Event) => { this.archiveMonth = (e.target as HTMLSelectElement).value; this.archivePage = 1; this._loadArchive(); }}>
              ${this.archiveMonths.map(m => html`<option value=${m} ?selected=${m === this.archiveMonth}>${m}</option>`)}
            </select>
            ${this.archiveMonths.length === 0 ? html`<span style="font-size:12px;color:var(--text-muted)">No archived months yet</span>` : nothing}
          </div>
          ${this.archiveLoading ? html`<div class="audit-empty">Loading archive...</div>` :
            this.archiveEntries.length === 0 ? html`<div class="audit-empty">No entries for ${this.archiveMonth}</div>` : html`
              <table class="audit-table">
                <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Target</th><th>Result</th></tr></thead>
                <tbody>
                  ${this.archiveEntries.map(e => html`
                    <tr @click=${() => this._toggleDetail(e.id)}>
                      <td style="white-space:nowrap;font-family:'JetBrains Mono',monospace;font-size:11px">${this._fmtTime(e.timestamp)}</td>
                      <td>${this._actorIcon(e.actor)} ${escHtml(e.actor)}</td>
                      <td><code>${escHtml(e.action)}</code></td>
                      <td>${escHtml(e.target || '—')}</td>
                      <td>${this._resultBadge(e.result)}</td>
                    </tr>
                    ${this.expandedId === e.id ? html`<tr><td colspan="5"><div class="audit-detail">${this._prettyDetail(e.detail)}</div></td></tr>` : nothing}
                  `)}
                </tbody>
              </table>
              <div class="audit-pager">
                <button class="audit-btn" ?disabled=${this.archivePage <= 1} @click=${() => { this.archivePage--; this._loadArchive(); }}>Prev</button>
                <span>Page ${this.archivePage} of ${this.archiveTotalPages}</span>
                <button class="audit-btn" ?disabled=${this.archivePage >= this.archiveTotalPages} @click=${() => { this.archivePage++; this._loadArchive(); }}>Next</button>
              </div>
            `}
        </div>
      ` : nothing}
    `;
  }

  private _prettyDetail(raw: string): string {
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch { return raw || '(no detail)'; }
  }
}

declare global {
  interface HTMLElementTagNameMap { 'audit-trail-view': AuditTrailView; }
}
