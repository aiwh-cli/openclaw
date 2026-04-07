/**
 * review-assets — Asset & keyframe review for cinematic pipeline.
 *
 * Migrated from production-reviews.js showAssetReview() + showKeyframeReview().
 * Per-asset grading (1-5), approve/reject/regen with feedback, keyframe 2-up
 * layout (first+last per clip), prompt editing, retry/advance.
 */
import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

interface Asset {
  asset_id: string; cjob_id: string; asset_type: string; clip_index: number;
  prompt: string; file_path: string; file_url: string; status: string;
  grade: number | null; grade_notes: string | null;
}

type ReviewType = 'ref' | 'keyframe' | 'clip';

@customElement('review-assets')
export class ReviewAssets extends LitElement {
  @property({ type: String }) cjobId = '';
  @property({ type: String }) reviewType: ReviewType = 'ref';
  @state() private assets: Asset[] = [];
  @state() private clips: any[] = [];
  @state() private loading = true;
  @state() private msg = '';
  @state() private grades: Record<string, number> = {};
  @state() private feedback: Record<string, string> = {};

  connectedCallback() { super.connectedCallback(); this._load(); }

  private async _load() {
    this.loading = true;
    try {
      const data = await this._api(`/api/cinematic/jobs/${this.cjobId}`);
      const j = data.job || data;
      const plan = j.production_plan ? JSON.parse(j.production_plan) : {};
      this.clips = plan.clips || [];
      // Load all assets for this job
      const all = data.assets || j.assets || [];
      if (this.reviewType === 'ref') {this.assets = all.filter((a: Asset) => a.asset_type === 'ref_image');}
      else if (this.reviewType === 'keyframe') {this.assets = all.filter((a: Asset) => ['keyframe_first', 'keyframe_last'].includes(a.asset_type));}
      else {this.assets = all.filter((a: Asset) => a.asset_type === 'video_clip');}
    } catch (e: any) { this.msg = e.message; }
    this.loading = false;
  }

  private async _api(url: string, opts?: RequestInit) {
    const r = await fetch(url, { credentials: 'same-origin', ...opts });
    return r.ok ? r.json() : {};
  }

  static styles = css`
    :host { display: block; max-width: 700px; }
    .back { font-size: 12px; color: var(--magenta); cursor: pointer; margin-bottom: 8px; }
    h3 { margin: 0 0 12px; font-size: 15px; }
    .stats { display: flex; gap: 14px; font-size: 12px; margin-bottom: 14px; }
    .stat { color: var(--text-muted); }
    .stat strong { color: var(--text-primary); }
    .asset-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 10px; margin-bottom: 14px; }
    .asset-card { border: 1px solid var(--border-dim); border-radius: 8px; overflow: hidden; }
    .asset-card.approved { border-color: var(--success); }
    .asset-card.rejected { border-color: var(--critical); }
    .asset-media { width: 100%; aspect-ratio: 1; object-fit: cover; display: block; }
    .asset-media video { width: 100%; aspect-ratio: 16/9; object-fit: cover; }
    .asset-info { padding: 8px; }
    .asset-status { font-size: 10px; font-weight: 600; text-transform: uppercase; }
    .asset-status.approved { color: var(--success); }
    .asset-status.rejected { color: var(--critical); }
    .asset-status.generated { color: var(--magenta); }
    .grade-row { display: flex; gap: 2px; margin: 4px 0; }
    .star { font-size: 14px; cursor: pointer; }
    .star.filled { color: var(--magenta); }
    .star.empty { color: var(--border-dim); }
    .asset-actions { display: flex; gap: 4px; }
    .act-btn { padding: 3px 8px; border-radius: 4px; font-size: 10px; cursor: pointer; border: none; font-weight: 600; }
    .act-approve { background: rgba(16,185,129,0.12); color: #10B981; }
    .act-reject { background: rgba(var(--critical-rgb),0.1); color: var(--critical); }
    .act-regen { background: rgba(var(--magenta-rgb),0.1); color: var(--magenta); }
    /* Keyframe 2-up */
    .kf-clip { border: 1px solid var(--border-dim); border-radius: 10px; padding: 12px; margin-bottom: 12px; }
    .kf-header { font-weight: 600; font-size: 13px; margin-bottom: 8px; }
    .kf-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .kf-label { font-size: 10px; font-weight: 600; color: var(--text-muted); margin-bottom: 4px; }
    .prompt-edit { margin-top: 8px; }
    .prompt-edit textarea { width: 100%; padding: 6px 8px; background: var(--surface-hi);
      color: var(--text-primary); border: 1px solid var(--border-dim); border-radius: 6px;
      font-size: 11px; box-sizing: border-box; min-height: 40px; resize: vertical; font-family: inherit; }
    .prompt-edit label { font-size: 10px; font-weight: 600; color: var(--text-muted); }
    .actions { display: flex; gap: 8px; margin-top: 14px; }
    .btn { padding: 8px 16px; border-radius: 8px; font-weight: 600; font-size: 12px; cursor: pointer; border: none; }
    .btn-primary { background: var(--magenta); color: var(--void); }
    .btn-primary:disabled { opacity: 0.5; }
    .btn-danger { background: rgba(var(--critical-rgb),0.1); color: var(--critical); }
    .btn-success { background: rgba(16,185,129,0.12); color: #10B981; }
    .msg { font-size: 11px; margin-top: 8px; color: var(--success); }
    .msg.err { color: var(--critical); }
    :host-context([data-theme="light"]) .btn-primary { color: #fff; }
  `;

  render() {
    if (this.loading) {return html`<div style="padding:20px;color:var(--text-muted)">Loading assets...</div>`;}

    const pending = this.assets.filter(a => a.status === 'generated').length;
    const approved = this.assets.filter(a => a.status === 'approved').length;
    const failed = this.assets.filter(a => ['failed', 'rejected'].includes(a.status)).length;
    const title = this.reviewType === 'ref' ? 'Reference Images' : this.reviewType === 'keyframe' ? 'Keyframes' : 'Video Clips';

    return html`
      <div class="back" @click=${this._close}>\u2190 Back</div>
      <h3>${title} Review</h3>

      <div class="stats">
        <span class="stat">Total: <strong>${this.assets.length}</strong></span>
        <span class="stat">Pending: <strong>${pending}</strong></span>
        <span class="stat">Approved: <strong>${approved}</strong></span>
        ${failed ? html`<span class="stat" style="color:var(--critical)">Failed: <strong>${failed}</strong></span>` : nothing}
      </div>

      ${this.reviewType === 'keyframe' ? this._renderKeyframes() : this._renderAssetGrid()}

      <div class="actions">
        ${pending > 0 ? html`
          <button class="btn btn-primary" @click=${this._massApprove}>Approve All (${pending})</button>` : nothing}
        ${pending === 0 && approved > 0 ? html`
          <button class="btn btn-success" @click=${this._advancePhase}>Continue to Next Phase</button>` : nothing}
        ${failed > 0 ? html`
          <button class="btn btn-primary" @click=${this._retryFailed}>Retry Failed/Rejected</button>` : nothing}
        <button class="btn btn-danger" style="margin-left:auto" @click=${this._deleteJob}>Delete Job</button>
      </div>
      ${this.msg ? html`<div class="msg ${this.msg.startsWith('Error') ? 'err' : ''}">${this.msg}</div>` : nothing}
    `;
  }

  private _renderAssetGrid() {
    const reviewable = this.assets.filter(a => ['generated', 'approved', 'pending'].includes(a.status));
    return html`<div class="asset-grid">
      ${reviewable.map(a => html`
        <div class="asset-card ${a.status}">
          ${a.asset_type === 'video_clip'
            ? html`<video class="asset-media" controls preload="metadata" src=${a.file_url || `/cinematic-asset/${a.asset_id}`}></video>`
            : html`<img class="asset-media" src=${a.file_url || `/cinematic-asset/${a.asset_id}`} />`}
          <div class="asset-info">
            <span class="asset-status ${a.status}">${a.status}</span>
            ${a.status === 'generated' || a.status === 'approved' ? html`
              <div class="grade-row">
                ${[1,2,3,4,5].map(n => html`
                  <span class="star ${n <= (this.grades[a.asset_id] || a.grade || 0) ? 'filled' : 'empty'}"
                    @click=${() => { this.grades = { ...this.grades, [a.asset_id]: n }; }}>\u2605</span>`)}
              </div>
              <div class="asset-actions">
                <button class="act-btn act-approve" @click=${() => this._review(a, 'approve')}>Approve</button>
                <button class="act-btn act-reject" @click=${() => this._review(a, 'reject')}>Reject</button>
                <button class="act-btn act-regen" @click=${() => this._review(a, 'regen')}>Regen</button>
              </div>` : nothing}
          </div>
        </div>`)}
    </div>`;
  }

  private _renderKeyframes() {
    const byClip: Record<number, { first?: Asset; last?: Asset }> = {};
    for (const a of this.assets) {
      if (!byClip[a.clip_index]) {byClip[a.clip_index] = {};}
      if (a.asset_type === 'keyframe_first') {byClip[a.clip_index].first = a;}
      else if (a.asset_type === 'keyframe_last') {byClip[a.clip_index].last = a;}
    }

    return html`${Object.entries(byClip).toSorted(([a], [b]) => Number(a) - Number(b)).map(([idx, kf]) => {
      const clip = this.clips[Number(idx)] || {};
      return html`
        <div class="kf-clip">
          <div class="kf-header">Clip ${Number(idx) + 1} <span style="font-weight:400;font-size:11px;color:var(--text-muted)">${clip.duration_sec || 6}s \u00B7 ${clip.type || 'cinematic'}</span></div>
          <div class="kf-pair">
            ${this._renderKfSide('First Frame', kf.first)}
            ${this._renderKfSide('Last Frame', kf.last)}
          </div>
          <div class="prompt-edit">
            <label>Description</label>
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">${clip.description || ''}</div>
          </div>
        </div>`;
    })}`;
  }

  private _renderKfSide(label: string, asset?: Asset) {
    if (!asset) {return html`<div><div class="kf-label">${label}</div><div style="color:var(--text-dim);font-size:11px">Not generated</div></div>`;}
    return html`<div>
      <div class="kf-label">${label}</div>
      <img class="asset-media" src=${asset.file_url || `/cinematic-asset/${asset.asset_id}`}
        style="border-radius:6px;aspect-ratio:auto" />
      <span class="asset-status ${asset.status}" style="display:block;margin:4px 0">${asset.status}</span>
      ${asset.status === 'generated' ? html`
        <div class="grade-row">
          ${[1,2,3,4,5].map(n => html`
            <span class="star ${n <= (this.grades[asset.asset_id] || 0) ? 'filled' : 'empty'}"
              @click=${() => { this.grades = { ...this.grades, [asset.asset_id]: n }; }}>\u2605</span>`)}
        </div>
        <div class="asset-actions">
          <button class="act-btn act-approve" @click=${() => this._review(asset, 'approve')}>Approve</button>
          <button class="act-btn act-reject" @click=${() => this._review(asset, 'reject')}>Reject</button>
          <button class="act-btn act-regen" @click=${() => this._review(asset, 'regen')}>Regen</button>
        </div>` : nothing}
    </div>`;
  }

  private async _review(asset: Asset, action: 'approve' | 'reject' | 'regen') {
    const grade = this.grades[asset.asset_id] || (action === 'approve' ? 4 : 2);
    let notes = this.feedback[asset.asset_id] || '';
    if ((action === 'reject' || action === 'regen') && !notes) {
      notes = prompt('Feedback for regeneration:') || 'Needs improvement';
    }
    await this._api(`/api/cinematic/assets/${asset.asset_id}/review`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cjob_id: this.cjobId, grade, action, notes }) });
    // Update in-place (no scroll reset)
    this.assets = this.assets.map(a =>
      a.asset_id === asset.asset_id ? { ...a, status: action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'regenerating', grade } : a);
    this.msg = `${action === 'approve' ? 'Approved' : action === 'reject' ? 'Rejected' : 'Regenerating'}`;
  }

  private async _massApprove() {
    const reviewable = this.assets.filter(a => a.status === 'generated');
    const ungraded = reviewable.filter(a => !this.grades[a.asset_id]);
    if (ungraded.length) { this.msg = `Rate all assets first (${ungraded.length} unrated)`; return; }
    this.msg = `Approving ${reviewable.length} assets...`;
    for (const a of reviewable) {
      await this._api(`/api/cinematic/assets/${a.asset_id}/review`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cjob_id: this.cjobId, grade: this.grades[a.asset_id] || 4, action: 'approve', notes: '' }) });
    }
    this.assets = this.assets.map(a => reviewable.find(r => r.asset_id === a.asset_id) ? { ...a, status: 'approved' } : a);
    this.msg = `${reviewable.length} assets approved!`;
  }

  private async _advancePhase() {
    await this._api(`/api/cinematic/jobs/${this.cjobId}/advance`, { method: 'POST' });
    this.msg = 'Advancing to next phase!'; this._emit('refresh');
  }

  private async _retryFailed() {
    await this._api(`/api/cinematic/jobs/${this.cjobId}/retry-failed`, { method: 'POST' });
    this.msg = 'Retrying failed assets...'; setTimeout(() => this._load(), 3000);
  }

  private async _deleteJob() {
    if (!confirm(`Delete job ${this.cjobId}?`)) {return;}
    await this._api(`/api/cinematic/jobs/${this.cjobId}`, { method: 'DELETE' });
    this._close(); this._emit('refresh');
  }

  private _close() { this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true })); }
  private _emit(name: string) { this.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true })); }
}
