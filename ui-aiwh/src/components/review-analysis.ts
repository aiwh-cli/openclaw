/**
 * review-analysis — Cinematic analysis review (style bible + clip editor).
 *
 * Migrated from production-reviews.js showAnalysisReview(). Editable style
 * bible (palette, mood, lighting, theme, refs, texture, negatives), clip
 * editor (add/remove/edit per-clip prompts), narration editor with polish
 * via copywriter agent, reference image grid, grade + approve/reject.
 */
import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

@customElement('review-analysis')
export class ReviewAnalysis extends LitElement {
  @property({ type: String }) cjobId = '';
  @state() private job: any = null;
  @state() private style: any = {};
  @state() private clips: any[] = [];
  @state() private narration = '';
  @state() private grade = 4;
  @state() private notes = '';
  @state() private loading = true;
  @state() private saving = false;
  @state() private polishing = false;
  @state() private msg = '';
  @state() private refImages: any[] = [];
  private _pollTimer: ReturnType<typeof setInterval> | null = null;

  connectedCallback() { super.connectedCallback(); this._load(); }
  disconnectedCallback() { super.disconnectedCallback(); if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; } }

  private async _load() {
    this.loading = true;
    try {
      const data = await this._api(`/api/cinematic/jobs/${this.cjobId}`);
      const j = data.job || data;
      this.job = j;
      try { this.style = j.style_bible ? JSON.parse(j.style_bible) : {}; } catch { this.style = {}; }
      let plan: any = {};
      try { plan = j.production_plan ? JSON.parse(j.production_plan) : {}; } catch { /* malformed */ }
      this.clips = plan.clips || [];
      this.narration = j.narration_script || '';
      // Load ref images
      const refs = await this._api(`/api/cinematic/jobs/${this.cjobId}/ref-analysis`);
      this.refImages = refs?.images || refs || [];
    } catch (e: any) { this.msg = e.message; }
    this.loading = false;
  }

  private async _api(url: string, opts?: RequestInit) {
    const r = await fetch(url, { credentials: 'same-origin', ...opts });
    return r.ok ? r.json() : {};
  }

  static styles = css`
    :host { display: block; max-width: 700px; }
    .back { font-size: 12px; color: var(--magenta); cursor: pointer; margin-bottom: 8px; display: inline-block; }
    h3 { margin: 0 0 12px; font-size: 15px; }
    details { margin-bottom: 12px; border: 1px solid var(--border-dim); border-radius: 8px; }
    summary { padding: 8px 12px; cursor: pointer; font-size: 13px; font-weight: 600; }
    .detail-body { padding: 0 12px 12px; }
    .field { margin-bottom: 10px; }
    .field label { display: block; font-size: 11px; font-weight: 600; color: var(--text-muted);
      text-transform: uppercase; margin-bottom: 3px; }
    input, textarea { width: 100%; padding: 6px 10px; background: var(--surface-hi);
      color: var(--text-primary); border: 1px solid var(--border-dim); border-radius: 6px;
      font-size: 12px; box-sizing: border-box; font-family: inherit; }
    textarea { min-height: 50px; resize: vertical; }
    .clip-card { border: 1px solid var(--border-dim); border-radius: 8px; padding: 10px; margin-bottom: 8px; }
    .clip-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
    .clip-num { font-weight: 600; font-size: 13px; }
    .clip-type { font-size: 11px; }
    .remove-clip { color: var(--critical); cursor: pointer; font-size: 11px; }
    .ref-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; margin-bottom: 12px; }
    .ref-img { border-radius: 8px; width: 100%; aspect-ratio: 1; object-fit: cover; border: 1px solid var(--border-dim); }
    .grade-row { display: flex; gap: 4px; margin-bottom: 8px; }
    .star { font-size: 20px; cursor: pointer; }
    .star.filled { color: var(--magenta); }
    .star.empty { color: var(--border-dim); }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 14px; }
    .btn { padding: 8px 16px; border-radius: 8px; font-weight: 600; font-size: 12px; cursor: pointer; border: none; }
    .btn-primary { background: var(--magenta); color: var(--void); }
    .btn-primary:disabled { opacity: 0.5; }
    .btn-secondary { background: transparent; border: 1px solid var(--border-dim); color: var(--text-primary); }
    .btn-danger { background: rgba(var(--critical-rgb),0.1); color: var(--critical); }
    .btn-success { background: rgba(16,185,129,0.12); color: #10B981; }
    .msg { font-size: 11px; margin-top: 8px; }
    .msg.ok { color: var(--success); }
    .msg.err { color: var(--critical); }
    :host-context([data-theme="light"]) .btn-primary { color: #fff; }
  `;

  render() {
    if (this.loading) {return html`<div style="padding:20px;color:var(--text-muted)">Loading analysis...</div>`;}
    const j = this.job;
    if (!j) {return html`<div style="color:var(--critical)">Job not found</div>`;}

    return html`
      <div class="back" @click=${this._close}>\u2190 Back to Review</div>
      <h3>Analysis Review: ${j.title || j.cjob_id}</h3>

      ${this.refImages.length ? html`
        <details open><summary>Reference Images (${this.refImages.length})</summary>
          <div class="detail-body">
            <div class="ref-grid">
              ${this.refImages.map((img: any) => html`
                <img class="ref-img" src=${img.url || `/api/cinematic/jobs/${this.cjobId}/input-refs/${img.filename}`}
                  alt=${img.filename || ''} />
              `)}
            </div>
          </div>
        </details>` : nothing}

      <details open><summary>Style Bible</summary>
        <div class="detail-body">
          ${this._styleField('Color Palette', 'color_palette', (this.style.color_palette || []).join('\n'), true)}
          ${this._styleField('Mood', 'mood')}
          ${this._styleField('Lighting', 'lighting')}
          ${this._styleField('Visual Theme', 'visual_theme')}
          ${this._styleField('Visual References', 'visual_references')}
          ${this._styleField('Texture & Grade', 'texture_and_grade')}
          ${this._styleField('Negative Keywords', 'negative_keywords', undefined, true)}
        </div>
      </details>

      <details open><summary>Clips (${this.clips.length})</summary>
        <div class="detail-body">
          ${this.clips.map((c, i) => this._renderClip(c, i))}
          <button class="btn btn-secondary" style="margin-top:8px" @click=${this._addClip}>+ Add Clip</button>
        </div>
      </details>

      <details open><summary>Narration Script</summary>
        <div class="detail-body">
          <textarea rows="5" .value=${this.narration}
            @input=${(e: Event) => this.narration = (e.target as HTMLTextAreaElement).value}></textarea>
          <button class="btn btn-secondary" style="margin-top:6px" ?disabled=${this.polishing}
            @click=${this._polishNarration}>${this.polishing ? 'Polishing...' : '\u270D\uFE0F Polish Narration'}</button>
        </div>
      </details>

      <div class="field"><label>Grade</label>
        <div class="grade-row">
          ${[1,2,3,4,5].map(n => html`
            <span class="star ${n <= this.grade ? 'filled' : 'empty'}" @click=${() => this.grade = n}>\u2605</span>`)}
        </div>
        <textarea rows="2" placeholder="Review notes..." .value=${this.notes}
          @input=${(e: Event) => this.notes = (e.target as HTMLTextAreaElement).value}></textarea>
      </div>

      <div class="actions">
        <button class="btn btn-primary" ?disabled=${this.saving} @click=${this._saveEdits}>Save Edits</button>
        <button class="btn btn-success" ?disabled=${this.saving} @click=${this._approve}>Save & Approve</button>
        <button class="btn btn-danger" @click=${this._reject}>Reject & Regenerate</button>
        <button class="btn btn-danger" style="margin-left:auto" @click=${this._deleteJob}>Delete Job</button>
      </div>
      ${this.msg ? html`<div class="msg ${this.msg.startsWith('Error') ? 'err' : 'ok'}">${this.msg}</div>` : nothing}
    `;
  }

  private _styleField(label: string, key: string, value?: string, textarea = false) {
    const val = value ?? (this.style[key] || '');
    const update = (v: string) => {
      if (key === 'color_palette') {this.style = { ...this.style, [key]: v.split('\n').filter(Boolean) };}
      else {this.style = { ...this.style, [key]: v };}
    };
    return html`<div class="field"><label>${label}</label>
      ${textarea
        ? html`<textarea .value=${val} @input=${(e: Event) => update((e.target as HTMLTextAreaElement).value)}></textarea>`
        : html`<input type="text" .value=${val} @input=${(e: Event) => update((e.target as HTMLInputElement).value)} />`}
    </div>`;
  }

  private _renderClip(clip: any, i: number) {
    const update = (key: string, val: string) => {
      this.clips = this.clips.map((c, j) => j === i ? { ...c, [key]: val } : c);
    };
    return html`
      <div class="clip-card">
        <div class="clip-header">
          <span class="clip-num">Clip ${(clip.index ?? i) + 1}</span>
          <select class="clip-type" .value=${clip.type || 'cinematic'}
            @change=${(e: Event) => update('type', (e.target as HTMLSelectElement).value)}>
            <option value="cinematic">Cinematic</option><option value="presenter">Presenter</option>
          </select>
          <span>${clip.duration_sec || 6}s</span>
          <span class="remove-clip" @click=${() => { this.clips = this.clips.filter((_, j) => j !== i); }}>\u2715</span>
        </div>
        ${this._clipField('Description', clip.description, v => update('description', v))}
        ${this._clipField('First Frame', clip.first_frame_prompt, v => update('first_frame_prompt', v))}
        ${this._clipField('Last Frame', clip.last_frame_prompt, v => update('last_frame_prompt', v))}
        ${this._clipField('Action', clip.action_prompt, v => update('action_prompt', v))}
        ${this._clipField('Narration', clip.narration_line, v => update('narration_line', v))}
      </div>`;
  }

  private _clipField(label: string, value: string, onChange: (v: string) => void) {
    return html`<div class="field"><label>${label}</label>
      <textarea rows="2" .value=${value || ''} @input=${(e: Event) => onChange((e.target as HTMLTextAreaElement).value)}></textarea>
    </div>`;
  }

  private _addClip() {
    const idx = this.clips.length;
    this.clips = [...this.clips, { index: idx, type: 'cinematic', duration_sec: 6,
      description: '', first_frame_prompt: '', last_frame_prompt: '', action_prompt: '', narration_line: '' }];
  }

  private async _saveEdits() {
    this.saving = true; this.msg = '';
    const body = {
      style_bible: JSON.stringify(this.style),
      production_plan: JSON.stringify({ clips: this.clips }),
      narration_script: this.narration,
    };
    await this._api(`/api/cinematic/jobs/${this.cjobId}/analysis`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    this.msg = 'Saved!'; this.saving = false;
  }

  private async _approve() {
    this.saving = true; this.msg = '';
    await this._saveEdits();
    await this._api(`/api/cinematic/jobs/${this.cjobId}/approve-phase`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grade: this.grade, notes: this.notes }) });
    this.msg = 'Approved! Advancing to next phase.'; this.saving = false;
    this._emit('refresh');
  }

  private async _reject() {
    await this._api(`/api/cinematic/jobs/${this.cjobId}/reject`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: this.notes || 'Rejected' }) });
    this.msg = 'Rejected. Will regenerate.'; this._emit('refresh');
  }

  private async _polishNarration() {
    this.polishing = true;
    await this._api(`/api/cinematic/jobs/${this.cjobId}/polish-narration`, { method: 'POST' });
    // Poll for updated narration (up to 2 min)
    let polls = 0;
    if (this._pollTimer) {clearInterval(this._pollTimer);}
    this._pollTimer = setInterval(async () => {
      polls++;
      if (!this.isConnected) { clearInterval(this._pollTimer!); this._pollTimer = null; this.polishing = false; return; }
      const j = await this._api(`/api/cinematic/jobs/${this.cjobId}`);
      if (j.narration_script && j.narration_script !== this.narration) {
        this.narration = j.narration_script;
        this.msg = 'Narration updated by copywriter!';
        clearInterval(this._pollTimer!); this._pollTimer = null; this.polishing = false;
      } else if (polls >= 24) {
        this.msg = 'Polish timed out. Check later.';
        clearInterval(this._pollTimer!); this._pollTimer = null; this.polishing = false;
      }
    }, 5000);
  }

  private async _deleteJob() {
    if (!confirm(`Delete job ${this.cjobId}?`)) {return;}
    await this._api(`/api/cinematic/jobs/${this.cjobId}`, { method: 'DELETE' });
    this._close(); this._emit('refresh');
  }

  private _close() { this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true })); }
  private _emit(name: string) { this.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true })); }
}
