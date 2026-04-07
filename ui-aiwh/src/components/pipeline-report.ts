/**
 * pipeline-report — Production pipeline report.
 *
 * Migrated from content.js openPipelineReport(). Shows: per-agent stats
 * (exists, last run, success/fail counts, recent logs), recent jobs table,
 * overall success rate.
 */
import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';

interface AgentStat {
  agent: string; label: string; icon: string;
  exists: boolean; lastRun: string; successes: number;
  failures: number; logs: string[];
}

@customElement('pipeline-report')
export class PipelineReport extends LitElement {
  @state() private report: any = null;
  @state() private loading = true;
  @state() private recentJobs: any[] = [];

  connectedCallback() { super.connectedCallback(); this._load(); }

  private async _load() {
    this.loading = true;
    try {
      const r = await this._api('/api/content/pipeline-report');
      this.report = r;
      this.recentJobs = r?.recent_jobs || [];
    } catch (e: any) { console.error('[pipeline-report]', e); }
    this.loading = false;
  }

  private async _api(url: string) {
    const r = await fetch(url, { credentials: 'same-origin' });
    return r.ok ? r.json() : {};
  }

  static styles = css`
    :host { display: block; }
    .close { float: right; cursor: pointer; font-size: 18px; color: var(--text-muted); }
    .close:hover { color: var(--text-primary); }
    h3 { margin: 0 0 14px; font-size: 15px; }
    .summary { display: flex; gap: 16px; margin-bottom: 16px; }
    .summary-stat { text-align: center; }
    .summary-stat .value { font-size: 24px; font-weight: 700; }
    .summary-stat .label { font-size: 11px; color: var(--text-muted); }
    .summary-stat.danger .value { color: var(--critical); }
    .summary-stat.success .value { color: var(--success); }
    .agents { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px; margin-bottom: 16px; }
    .agent-card { padding: 10px; border: 1px solid var(--border-dim); border-radius: 8px; font-size: 12px; }
    .agent-header { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
    .agent-name { font-weight: 600; }
    .dot { width: 8px; height: 8px; border-radius: 50%; }
    .dot.ok { background: var(--success); }
    .dot.missing { background: var(--text-dim); }
    .agent-stats { font-size: 11px; color: var(--text-muted); }
    .agent-logs { max-height: 80px; overflow-y: auto; font-size: 10px; font-family: monospace;
      background: var(--void); padding: 4px 6px; border-radius: 4px; margin-top: 4px; color: var(--text-dim); }
    .log-line.error { color: var(--critical); }
    .log-line.success { color: var(--success); }
    .recent { margin-top: 12px; }
    .recent h4 { font-size: 13px; margin: 0 0 8px; }
    .recent-table { width: 100%; border-collapse: collapse; font-size: 11px; }
    .recent-table th { text-align: left; padding: 4px 8px; color: var(--text-muted); font-weight: 600;
      border-bottom: 1px solid var(--border-dim); }
    .recent-table td { padding: 4px 8px; border-bottom: 1px solid var(--border-faint); }
    .recent-table tr:hover { background: var(--surface-hi); cursor: pointer; }
    .empty { text-align: center; padding: 30px; color: var(--text-muted); font-size: 13px; }
  `;

  render() {
    if (this.loading) {return html`<div class="empty">Loading report...</div>`;}
    if (!this.report) {return html`<div class="empty">No report data</div>`;}

    const r = this.report;
    const agents: AgentStat[] = r.agents || [];
    const total = r.total_runs || 0;
    const successes = r.successes || 0;
    const failures = r.failures || 0;
    const rate = total > 0 ? Math.round((successes / total) * 100) : 0;

    return html`
      <span class="close" @click=${this._close}>\u2715</span>
      <h3>Production Report</h3>

      <div class="summary">
        <div class="summary-stat"><div class="value">${total}</div><div class="label">Total Runs</div></div>
        <div class="summary-stat success"><div class="value">${successes}</div><div class="label">Successes</div></div>
        <div class="summary-stat ${failures > 0 ? 'danger' : ''}">
          <div class="value">${failures}</div><div class="label">Failures</div></div>
        <div class="summary-stat ${rate >= 80 ? 'success' : rate >= 50 ? '' : 'danger'}">
          <div class="value">${rate}%</div><div class="label">Success Rate</div></div>
      </div>

      ${agents.length ? html`
        <div class="agents">
          ${agents.map(a => html`
            <div class="agent-card">
              <div class="agent-header">
                <span class="dot ${a.exists ? 'ok' : 'missing'}"></span>
                <span class="agent-name">${a.icon} ${a.label}</span>
              </div>
              <div class="agent-stats">
                ${a.lastRun ? `Last: ${this._fmtTime(a.lastRun)}` : 'Never run'}
                \u00B7 ${a.successes}/${a.successes + a.failures}
              </div>
              ${a.logs?.length ? html`
                <div class="agent-logs">
                  ${a.logs.slice(-10).map(l => html`
                    <div class="log-line ${l.includes('ERROR') ? 'error' : l.includes('SUCCESS') ? 'success' : ''}">${l}</div>`)}
                </div>` : nothing}
            </div>`)}
        </div>` : nothing}

      ${this.recentJobs.length ? html`
        <div class="recent">
          <h4>Recent Jobs</h4>
          <table class="recent-table">
            <thead><tr><th>Topic</th><th>Status</th><th>Updated</th><th>Issue</th></tr></thead>
            <tbody>
              ${this.recentJobs.slice(0, 15).map(j => html`
                <tr @click=${() => this._openJob(j.job_id)}>
                  <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${j.topic || j.job_id}</td>
                  <td>${j.status}</td>
                  <td>${this._fmtTime(j.updated_at)}</td>
                  <td style="color:var(--critical);max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                    ${j.failure_reason || ''} ${j.retry_count ? `(retry ${j.retry_count})` : ''}</td>
                </tr>`)}
            </tbody>
          </table>
        </div>` : nothing}
    `;
  }

  private _close() { this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true })); }
  private _openJob(jobId: string) {
    this.dispatchEvent(new CustomEvent('open-job', { bubbles: true, composed: true, detail: { jobId } }));
  }
  private _fmtTime(iso: string) {
    if (!iso) {return '';}
    const d = new Date(iso.includes('Z') || iso.includes('+') ? iso : iso + 'Z');
    const diff = Date.now() - d.getTime();
    if (diff < 3600000) {return `${Math.floor(diff / 60000)}m ago`;}
    if (diff < 86400000) {return `${Math.floor(diff / 3600000)}h ago`;}
    return d.toLocaleDateString('en-AU', { month: 'short', day: 'numeric' });
  }
}
