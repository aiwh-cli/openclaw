/**
 * pipeline-job-detail — Full job detail modal/panel for the Pipeline tab.
 *
 * Migrated from content.js openJobDetail(). Shows: metadata, script/caption
 * editors (editable by status), media players, grade+notes, publish schedule,
 * failure details+agent logs, all action buttons.
 */
import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

const EDITABLE = new Set(['draft','scripted','voice_ready','avatar_ready','captioned','qa_passed','urgent_review']);
const PROCESSABLE = new Set(['planned','scripted','voice_ready','avatar_ready','captioned','approved']);
const PLATFORM_LOCK_AFTER = new Set(['approved','scheduled','posted']);

@customElement('pipeline-job-detail')
export class PipelineJobDetail extends LitElement {
  @property({ type: String }) jobId = '';
  @state() private job: any = null;
  @state() private loading = true;
  @state() private saving = false;
  @state() private msg = '';
  @state() private grade = 0;
  @state() private gradeNotes = '';
  @state() private hook = '';
  @state() private script = '';
  @state() private caption = '';
  @state() private platforms: Record<string, boolean> = {};
  @state() private schedDate = '';
  @state() private schedTime = '10:00';
  @state() private showLogs = false;
  @state() private logs: string[] = [];

  connectedCallback() { super.connectedCallback(); if (this.jobId) {this._load();} }

  updated(changed: Map<string, unknown>) {
    if (changed.has('jobId') && this.jobId) {this._load();}
  }

  private async _load() {
    this.loading = true; this.msg = '';
    try {
      const j = await this._api(`/api/content/jobs/${this.jobId}`);
      if (!j || j.error) { this.msg = 'Job not found'; this.loading = false; return; }
      this.job = j;
      this.hook = j.hook || '';
      this.script = j.script || '';
      // For social content, captions are in the JSON 'captions' field, not 'caption'
      if (j.captions && typeof j.captions === 'string') {
        try { const parsed = JSON.parse(j.captions); this.caption = Object.entries(parsed).map(([p, c]) => `${p.toUpperCase()}:\n${c}`).join('\n\n---\n\n'); } catch { this.caption = j.captions; }
      } else if (j.captions && typeof j.captions === 'object') {
        this.caption = Object.entries(j.captions).map(([p, c]) => `${p.toUpperCase()}:\n${c}`).join('\n\n---\n\n');
      } else {
        this.caption = j.caption || '';
      }
      this.grade = j.grade || 0;
      this.gradeNotes = j.grade_notes || '';
      const pt = (() => { try { const p = JSON.parse(j.platform_targets || '[]'); return Array.isArray(p) ? p : []; } catch { return []; } })();
      this.platforms = { instagram: pt.includes('instagram'), x: pt.includes('x') };
    } catch (e: any) { this.msg = e.message; }
    this.loading = false;
  }

  private async _api(url: string, opts?: RequestInit) {
    const r = await fetch(url, { credentials: 'same-origin', ...opts });
    return r.ok ? r.json() : { error: 'Request failed' };
  }

  static styles = css`
    :host { display: block; background: var(--surface); border: 1px solid var(--border-dim);
      border-radius: 12px; padding: 20px; max-width: 640px; }
    .close { float: right; cursor: pointer; font-size: 18px; color: var(--text-muted); padding: 4px; }
    .close:hover { color: var(--text-primary); }
    h3 { margin: 0 0 4px; font-size: 15px; }
    .status { display: inline-block; font-size: 10px; padding: 2px 8px; border-radius: 4px;
      font-weight: 600; text-transform: uppercase; background: rgba(var(--magenta-rgb),0.1); color: var(--magenta); }
    .status.failed { background: rgba(var(--critical-rgb),0.1); color: var(--critical); }
    .status.urgent { background: rgba(var(--critical-rgb),0.1); color: var(--critical); }
    .meta { font-size: 11px; color: var(--text-muted); margin: 8px 0 14px; }
    .field { margin-bottom: 12px; }
    .field label { display: block; font-size: 11px; font-weight: 600; color: var(--text-muted);
      text-transform: uppercase; margin-bottom: 3px; }
    textarea, input, select { width: 100%; padding: 8px 10px; background: var(--surface-hi);
      color: var(--text-primary); border: 1px solid var(--border-dim); border-radius: 8px;
      font-size: 12px; box-sizing: border-box; font-family: inherit; }
    textarea { min-height: 60px; resize: vertical; }
    textarea:disabled, input:disabled { opacity: 0.6; }
    .hint { font-size: 10px; color: var(--text-dim); margin-top: 2px; }
    .platforms { display: flex; gap: 12px; font-size: 12px; }
    .platforms label { display: flex; align-items: center; gap: 4px; }
    .grade-row { display: flex; gap: 4px; margin-bottom: 8px; }
    .star { font-size: 20px; cursor: pointer; }
    .star.filled { color: var(--magenta); }
    .star.empty { color: var(--border-dim); }
    .media { margin-bottom: 10px; }
    .media audio, .media video { max-width: 100%; border-radius: 8px; }
    .failure { background: rgba(var(--critical-rgb),0.06); border: 1px solid rgba(var(--critical-rgb),0.2);
      border-radius: 8px; padding: 10px; margin-bottom: 12px; font-size: 12px; }
    .failure-title { font-weight: 600; color: var(--critical); margin-bottom: 4px; }
    .logs-toggle { font-size: 11px; color: var(--magenta); cursor: pointer; margin-top: 6px; }
    .logs { max-height: 150px; overflow-y: auto; font-size: 10px; font-family: monospace;
      background: var(--void); padding: 8px; border-radius: 6px; margin-top: 6px; color: var(--text-muted); }
    .schedule { display: flex; gap: 8px; align-items: end; }
    .schedule input { width: auto; }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 16px; }
    .btn { padding: 8px 16px; border-radius: 8px; font-weight: 600; font-size: 12px;
      cursor: pointer; border: none; }
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
    if (this.loading) {return html`<div style="text-align:center;padding:20px;color:var(--text-muted)">Loading...</div>`;}
    if (!this.job) {return html`<div style="color:var(--critical)">${this.msg || 'Job not found'}</div>`;}
    const j = this.job;
    const editable = EDITABLE.has(j.status);
    const canProcess = PROCESSABLE.has(j.status);
    const isFailed = j.failure_reason || j.status?.includes('failed');
    const canGrade = ['qa_passed','urgent_review','posted'].includes(j.status);
    const canSchedule = j.status === 'approved';

    return html`
      <span class="close" @click=${this._close}>\u2715</span>
      <h3>${j.topic || j.job_id}</h3>
      <span class="status ${isFailed ? 'failed' : ''} ${j.priority === 'urgent' ? 'urgent' : ''}">${j.status}</span>
      ${j.priority === 'urgent' ? html`<span class="status urgent" style="margin-left:4px">URGENT</span>` : nothing}
      <div class="meta">${j.pillar || ''} \u00B7 Created ${this._fmtDate(j.created_at)} \u00B7 Updated ${this._fmtDate(j.updated_at)}</div>

      ${j.content_type === 'image_post' && j.image_path ? html`
        <div class="field"><label>Image</label>
          <img src="/api/social/image/${j.job_id}" style="max-width:100%;max-height:200px;border-radius:8px;display:block" /></div>` : nothing}

      ${j.content_type === 'video_reel' ? html`
        ${this._renderField('Hook', 'hook', this.hook, editable)}
        ${this._renderField('Script', 'script', this.script, editable)}` : nothing}

      ${this._renderField(
        j.content_type === 'video_reel' ? 'Caption' : 'Captions (per platform)',
        'caption', this.caption, editable,
        j.content_type === 'video_reel' ? 'IG: max 220 chars \u00B7 X: max 280 chars. Use ---X--- to split.' : undefined)}

      <div class="field"><label>Platforms</label>
        <div class="platforms">
          ${Object.entries(this.platforms).map(([p, v]) => html`
            <label><input type="checkbox" .checked=${v} ?disabled=${PLATFORM_LOCK_AFTER.has(j.status)}
              @change=${(e: Event) => { this.platforms = { ...this.platforms, [p]: (e.target as HTMLInputElement).checked }; }} /> ${p}</label>`)}
        </div>
        ${PLATFORM_LOCK_AFTER.has(j.status) ? html`<div class="hint">Locked after approval</div>` : nothing}
      </div>

      ${j.voice_audio_path ? html`<div class="media"><label style="font-size:11px;font-weight:600;color:var(--text-muted)">Audio</label>
        <audio controls src="/api/content/media/${j.job_id}/audio"></audio></div>` : nothing}
      ${j.captioned_video_path || j.avatar_video_path ? html`<div class="media"><label style="font-size:11px;font-weight:600;color:var(--text-muted)">Video</label>
        <video controls src="/api/content/media/${j.job_id}/video" style="max-height:280px"></video></div>` : nothing}

      ${isFailed ? this._renderFailure(j) : nothing}

      ${canGrade ? html`
        <div class="field"><label>Grade</label>
          <div class="grade-row">
            ${[1,2,3,4,5].map(n => html`
              <span class="star ${n <= this.grade ? 'filled' : 'empty'}"
                @click=${() => this.grade = n}>\u2605</span>`)}
          </div>
          <textarea placeholder="Grade notes..." rows="2" .value=${this.gradeNotes}
            @input=${(e: Event) => this.gradeNotes = (e.target as HTMLTextAreaElement).value}></textarea>
        </div>` : nothing}

      ${canSchedule ? html`
        <div class="field"><label>Schedule</label>
          <div class="schedule">
            <input type="date" .value=${this.schedDate} @input=${(e: Event) => this.schedDate = (e.target as HTMLInputElement).value} />
            <input type="time" .value=${this.schedTime} @input=${(e: Event) => this.schedTime = (e.target as HTMLInputElement).value} />
            <button class="btn btn-secondary" @click=${this._saveSchedule}>Save Schedule</button>
          </div>
          <div class="hint">Times in AEST</div>
        </div>` : nothing}

      <div class="actions">
        ${j.status === 'draft' ? html`<button class="btn btn-primary" @click=${() => this._patch({ status: 'planned' })}>Move to Planned</button>` : nothing}
        ${canProcess ? html`<button class="btn btn-primary" @click=${this._processNow}>Process Now</button>` : nothing}
        ${canGrade ? html`<button class="btn btn-success" @click=${this._approveProcess}>Approve & Process</button>` : nothing}
        ${isFailed ? html`<button class="btn btn-secondary" @click=${this._retryProcess}>Retry & Process</button>` : nothing}
        ${['approved','scheduled'].includes(j.status) ? html`<button class="btn btn-secondary" @click=${() => this._patch({ status: 'draft' })}>Reset to Draft</button>` : nothing}
        ${editable ? html`<button class="btn btn-secondary" @click=${this._save}>Save Changes</button>` : nothing}
        <button class="btn btn-secondary" @click=${() => this._toggleUrgent(j)}>
          ${j.priority === 'urgent' ? 'Remove Urgent' : 'Mark Urgent'}</button>
        ${j.status !== 'posted' ? html`<button class="btn btn-danger" @click=${this._delete}>Delete</button>` : nothing}
      </div>

      ${this.msg ? html`<div class="msg ${this.msg.startsWith('Error') ? 'err' : 'ok'}">${this.msg}</div>` : nothing}
    `;
  }

  private _renderField(label: string, key: string, value: string, editable: boolean, hint?: string) {
    return html`<div class="field"><label>${label}</label>
      <textarea .value=${value} ?disabled=${!editable}
        @input=${(e: Event) => { (this as any)[key] = (e.target as HTMLTextAreaElement).value; }}></textarea>
      ${hint ? html`<div class="hint">${hint}</div>` : nothing}
    </div>`;
  }

  private _renderFailure(j: any) {
    return html`<div class="failure">
      <div class="failure-title">Failure Details</div>
      <div>Status: ${j.status} ${j.last_failed_stage ? `(stage: ${j.last_failed_stage})` : ''}</div>
      ${j.failure_reason ? html`<div>Reason: ${j.failure_reason}</div>` : nothing}
      ${j.retry_count ? html`<div>Retries: ${j.retry_count}</div>` : nothing}
      <div class="logs-toggle" @click=${this._toggleLogs}>${this.showLogs ? 'Hide logs' : 'Show agent logs'}</div>
      ${this.showLogs && this.logs.length ? html`<div class="logs">${this.logs.map(l => html`<div>${l}</div>`)}</div>` : nothing}
    </div>`;
  }

  private async _save() {
    this.saving = true;
    const plats = Object.entries(this.platforms).filter(([,v]) => v).map(([k]) => k);
    await this._patch({ hook: this.hook, script: this.script, caption: this.caption,
      platform_targets: JSON.stringify(plats), grade: this.grade || undefined, grade_notes: this.gradeNotes || undefined });
    this.saving = false;
  }

  private async _patch(data: Record<string, any>) {
    this.msg = '';
    const r = await this._api(`/api/content/jobs/${this.jobId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    this.msg = r.error ? `Error: ${r.error}` : 'Saved!';
    this._load(); this._emit('refresh');
  }

  private async _processNow() {
    await this._api(`/api/content/jobs/${this.jobId}/process`, { method: 'POST' });
    this.msg = 'Processing...'; this._emit('refresh');
  }

  private async _approveProcess() {
    await this._patch({ status: 'approved', grade: this.grade || 4, grade_notes: this.gradeNotes });
    await this._api(`/api/content/jobs/${this.jobId}/process`, { method: 'POST' });
    this.msg = 'Approved! Processing...'; this._emit('refresh');
  }

  private async _retryProcess() {
    // Clear stale artifacts + reset status for a clean retry
    await this._patch({
      status: 'planned', failure_reason: null, last_failed_stage: null,
      voice_audio_path: null, avatar_video_path: null, captioned_video_path: null,
      video_r2_url: null, video_gdrive_url: null, heygen_video_id: null, platform_targets: null,
    });
    await this._api(`/api/content/jobs/${this.jobId}/process`, { method: 'POST' });
    this.msg = 'Retrying (fresh pipeline)...'; this._emit('refresh');
  }

  private async _saveSchedule() {
    if (!this.schedDate) {return;}
    // Use browser timezone for conversion
    const local = new Date(`${this.schedDate}T${this.schedTime}:00`);
    await this._patch({ scheduled_time: local.toISOString(), status: 'scheduled' });
  }

  private async _toggleUrgent(j: any) {
    const newPriority = j.priority === 'urgent' ? 'normal' : 'urgent';
    const updates: Record<string, any> = { priority: newPriority };
    if (newPriority === 'urgent' && j.status === 'draft') {updates.status = 'planned';}
    await this._patch(updates);
  }

  private async _delete() {
    if (!confirm(`Delete "${this.job?.topic || this.jobId}"?`)) {return;}
    await this._api(`/api/content/jobs/${this.jobId}`, { method: 'DELETE' });
    this._close(); this._emit('refresh');
  }

  private async _toggleLogs() {
    if (!this.showLogs && !this.logs.length) {
      try {
        const r = await this._api(`/api/content/jobs/${this.jobId}/logs`);
        this.logs = r.logs || [];
      } catch (e: any) { this.msg = 'Failed to load logs'; }
    }
    this.showLogs = !this.showLogs;
  }

  private _close() { this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true })); }
  private _emit(name: string) { this.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true })); }
  private _fmtDate(iso: string) {
    if (!iso) {return '';}
    return new Date(iso.includes('Z') || iso.includes('+') ? iso : iso + 'Z').toLocaleDateString('en-AU', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
}
