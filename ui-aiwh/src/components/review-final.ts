/**
 * review-final — Final video review for cinematic pipeline.
 *
 * Migrated from production-reviews.js showFinalReview(). Full video player,
 * stats (duration/clips/cost), cost breakdown by service (color-coded bars),
 * grade + notes, approve/reject, download link.
 */
import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

interface CostEntry { service: string; label: string; cost: number; color: string; }

const SERVICE_COLORS: Record<string, { label: string; color: string }> = {
  anthropic: { label: 'Claude AI', color: '#d4a574' },
  google: { label: 'Google (Imagen/Veo)', color: '#4285f4' },
  runway: { label: 'Runway', color: '#a855f7' },
  elevenlabs: { label: 'ElevenLabs', color: '#10b981' },
  heygen: { label: 'HeyGen', color: '#f59e0b' },
};

@customElement('review-final')
export class ReviewFinal extends LitElement {
  @property({ type: String }) cjobId = '';
  @state() private job: any = null;
  @state() private costs: CostEntry[] = [];
  @state() private totalCost = 0;
  @state() private grade = 4;
  @state() private notes = '';
  @state() private loading = true;
  @state() private msg = '';

  connectedCallback() { super.connectedCallback(); this._load(); }

  private async _load() {
    this.loading = true;
    try {
      const [data, costData] = await Promise.all([
        this._api(`/api/cinematic/jobs/${this.cjobId}`),
        this._api(`/api/cinematic/jobs/${this.cjobId}/costs`),
      ]);
      const j = data.job || data;
      this.job = j;
      this.totalCost = costData.total || j.total_cost_usd || 0;
      this.costs = Object.entries(costData.costs || {}).map(([svc, d]: [string, any]) => ({
        service: svc, label: SERVICE_COLORS[svc]?.label || svc,
        cost: d.cost || d, color: SERVICE_COLORS[svc]?.color || '#888',
      })).toSorted((a, b) => b.cost - a.cost);
    } catch (e: any) { this.msg = e.message; }
    this.loading = false;
  }

  private async _api(url: string, opts?: RequestInit) {
    const r = await fetch(url, { credentials: 'same-origin', ...opts });
    return r.ok ? r.json() : {};
  }

  static styles = css`
    :host { display: block; max-width: 640px; }
    .back { font-size: 12px; color: var(--magenta); cursor: pointer; margin-bottom: 8px; }
    h3 { margin: 0 0 12px; font-size: 15px; }
    video { width: 100%; border-radius: 10px; margin-bottom: 14px; max-height: 360px; background: #000; }
    .stats { display: flex; gap: 16px; margin-bottom: 14px; font-size: 12px; color: var(--text-muted); }
    .stats strong { color: var(--text-primary); }
    details { margin-bottom: 14px; border: 1px solid var(--border-dim); border-radius: 8px; }
    summary { padding: 8px 12px; cursor: pointer; font-size: 13px; font-weight: 600; }
    .cost-bars { padding: 0 12px 12px; }
    .cost-bar { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; font-size: 12px; }
    .cost-bar-fill { height: 18px; border-radius: 4px; min-width: 4px; transition: width 300ms; }
    .cost-label { min-width: 130px; }
    .cost-value { font-weight: 600; min-width: 50px; text-align: right; }
    .grade-row { display: flex; gap: 4px; margin-bottom: 8px; }
    .star { font-size: 22px; cursor: pointer; }
    .star.filled { color: var(--magenta); }
    .star.empty { color: var(--border-dim); }
    .field { margin-bottom: 12px; }
    .field label { display: block; font-size: 11px; font-weight: 600; color: var(--text-muted);
      text-transform: uppercase; margin-bottom: 3px; }
    textarea { width: 100%; padding: 8px 10px; background: var(--surface-hi);
      color: var(--text-primary); border: 1px solid var(--border-dim); border-radius: 8px;
      font-size: 12px; box-sizing: border-box; font-family: inherit; min-height: 60px; resize: vertical; }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 14px; }
    .btn { padding: 8px 16px; border-radius: 8px; font-weight: 600; font-size: 12px; cursor: pointer; border: none; }
    .btn-success { background: rgba(16,185,129,0.12); color: #10B981; }
    .btn-danger { background: rgba(var(--critical-rgb),0.1); color: var(--critical); }
    .btn-secondary { background: transparent; border: 1px solid var(--border-dim); color: var(--text-primary); }
    a.btn { text-decoration: none; display: inline-flex; align-items: center; }
    .msg { font-size: 11px; margin-top: 8px; }
    .msg.ok { color: var(--success); }
    .msg.err { color: var(--critical); }
  `;

  render() {
    if (this.loading) {return html`<div style="padding:20px;color:var(--text-muted)">Loading final review...</div>`;}
    if (!this.job) {return html`<div style="color:var(--critical)">Job not found</div>`;}
    const j = this.job;

    return html`
      <div class="back" @click=${this._close}>\u2190 Back</div>
      <h3>Final Review: ${j.title || j.cjob_id}</h3>

      <video controls src="/cinematic-final/${this.cjobId}"></video>

      <div class="stats">
        <span>Duration: <strong>${j.target_duration_sec || '?'}s</strong></span>
        <span>Clips: <strong>${j.clip_count || '?'}</strong></span>
        <span>Cost: <strong>$${this.totalCost.toFixed(2)}</strong></span>
        <span>Format: <strong>${j.output_format || '16:9'}</strong></span>
      </div>

      ${this.costs.length ? html`
        <details>
          <summary>Cost Breakdown ($${this.totalCost.toFixed(2)})</summary>
          <div class="cost-bars">
            ${this.costs.map(c => {
              const pct = this.totalCost > 0 ? (c.cost / this.totalCost) * 100 : 0;
              return html`
                <div class="cost-bar">
                  <span class="cost-label">${c.label}</span>
                  <div class="cost-bar-fill" style="width:${Math.max(pct, 2)}%;background:${c.color}"></div>
                  <span class="cost-value">$${c.cost.toFixed(2)}</span>
                </div>`;
            })}
          </div>
        </details>` : nothing}

      <div class="field"><label>Grade</label>
        <div class="grade-row">
          ${[1,2,3,4,5].map(n => html`
            <span class="star ${n <= this.grade ? 'filled' : 'empty'}" @click=${() => this.grade = n}>\u2605</span>`)}
        </div></div>

      <div class="field"><label>Notes</label>
        <textarea .value=${this.notes} placeholder="Review notes..."
          @input=${(e: Event) => this.notes = (e.target as HTMLTextAreaElement).value}></textarea></div>

      <div class="actions">
        <button class="btn btn-success" @click=${this._approve}>Approve</button>
        <button class="btn btn-danger" @click=${this._reject}>Reject</button>
        <a class="btn btn-secondary" href="/cinematic-final/${this.cjobId}" download>Download</a>
        <button class="btn btn-danger" style="margin-left:auto" @click=${this._deleteJob}>Delete Job</button>
      </div>
      ${this.msg ? html`<div class="msg ${this.msg.startsWith('Error') ? 'err' : 'ok'}">${this.msg}</div>` : nothing}
    `;
  }

  private async _approve() {
    await this._api(`/api/cinematic/jobs/${this.cjobId}/approve-phase`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grade: this.grade, notes: this.notes }) });
    this.msg = 'Approved!'; this._emit('refresh');
  }

  private async _reject() {
    const reason = this.notes || prompt('Rejection reason:') || 'Rejected';
    await this._api(`/api/cinematic/jobs/${this.cjobId}/reject`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: reason }) });
    this.msg = 'Rejected.'; this._emit('refresh');
  }

  private async _deleteJob() {
    if (!confirm(`Delete job ${this.cjobId}?`)) {return;}
    await this._api(`/api/cinematic/jobs/${this.cjobId}`, { method: 'DELETE' });
    this._close(); this._emit('refresh');
  }

  private _close() { this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true })); }
  private _emit(name: string) { this.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true })); }
}
