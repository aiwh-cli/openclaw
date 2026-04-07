import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';

interface VideoJob {
  job_id: string; topic: string; pillar: string; status: string;
  content_type: string; created_at: string; updated_at: string;
  failure_reason: string | null; last_failed_stage: string | null;
  retry_count: number; priority: string; grade: number | null;
  platform_targets: string | null;
}

interface PipelineStats {
  available: boolean;
  counts: Record<string, number>;
}

const KANBAN_COLS = [
  { status: 'draft', label: 'Draft', icon: '\u{1F4DD}' },
  { status: 'planned', label: 'Planned', icon: '\u{1F4CB}' },
  { status: 'scripted', label: 'Scripted', icon: '\u270D\uFE0F' },
  { status: 'voice_ready', label: 'Voice', icon: '\u{1F399}\uFE0F' },
  { status: 'avatar_ready', label: 'Avatar', icon: '\u{1F3AC}' },
  { status: 'captioned', label: 'Captioned', icon: '\u{1F4DD}' },
];

@customElement('social-hub-pipeline')
export class SocialHubPipeline extends LitElement {
  @state() private jobs: VideoJob[] = [];
  @state() private stats: PipelineStats | null = null;
  @state() private loading = true;
  @state() private reviewJobs: VideoJob[] = [];
  @state() private failedJobs: VideoJob[] = [];
  @state() private doneJobs: VideoJob[] = [];
  @state() private cinematicJobs: any[] = [];
  @state() private _cinematicPhase: string | null = null;
  @state() private detailJobId: string | null = null;
  @state() private showReport = false;
  private _poll: ReturnType<typeof setInterval> | null = null;

  connectedCallback() { super.connectedCallback(); this._load(); this._poll = setInterval(() => this._load(), 15000); }
  disconnectedCallback() { super.disconnectedCallback(); if (this._poll) { clearInterval(this._poll); this._poll = null; } }

  private async _load() {
    try {
      const [jobsData, statsData, cinematicData] = await Promise.all([
        this._api('/api/content/jobs?limit=80'),
        this._api('/api/content/stats'),
        this._api('/api/cinematic/jobs'),
      ]);
      const all: VideoJob[] = jobsData || [];
      this.jobs = all.filter(j => j.content_type === 'video_reel');
      this.stats = statsData;
      const cJobs = Array.isArray(cinematicData) ? cinematicData : (cinematicData?.jobs || []);
      this.cinematicJobs = cJobs.filter((j: any) => !['cancelled', 'published', 'approved'].includes(j.phase));
      this.reviewJobs = all.filter(j => ['qa_passed', 'urgent_review'].includes(j.status));
      this.failedJobs = all.filter(j => ['qa_failed', 'voice_failed', 'avatar_failed', 'avatar_timeout', 'caption_failed', 'script_too_long', 'rejected', 'failed'].includes(j.status));
      this.doneJobs = all.filter(j => ['approved', 'scheduled', 'posted'].includes(j.status));
    } catch (e) { console.error('[pipeline]', e); }
    this.loading = false;
  }

  private async _api(url: string, opts?: RequestInit) {
    const res = await fetch(url, { credentials: 'same-origin', ...opts });
    if (!res.ok) {return null;}
    const ct = res.headers.get('content-type') || '';
    return ct.includes('json') ? res.json() : null;
  }

  private _openJob(jobId: string) {
    this.detailJobId = jobId;
  }

  private async _deleteJob(jobId: string, topic: string) {
    const ok = typeof (window as any).dashConfirm === 'function'
      ? await (window as any).dashConfirm(`Delete "${topic || jobId}"? This cannot be undone.`)
      : confirm(`Delete "${topic || jobId}"?`);
    if (!ok) {return;}
    await this._api(`/api/content/jobs/${jobId}`, { method: 'DELETE' });
    this._load();
  }

  private async _retryJob(jobId: string) {
    // Reset to planned and re-trigger pipeline
    await this._api(`/api/content/jobs/${jobId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'planned' }),
    });
    await this._api(`/api/content/jobs/${jobId}/process`, { method: 'POST' });
    this._load();
  }

  private async _triggerPipeline() {
    try {
      await fetch('/api/content/pipeline/trigger', { method: 'POST', credentials: 'same-origin' });
      setTimeout(() => this._load(), 2000);
    } catch (e) { console.error('[pipeline] Trigger failed:', e); }
  }

  private _fmtTime(iso: string) {
    if (!iso) {return '';}
    const d = new Date(iso.includes('Z') || iso.includes('+') ? iso : iso + 'Z');
    const diff = Date.now() - d.getTime();
    if (diff < 3600000) {return `${Math.floor(diff / 60000)}m ago`;}
    if (diff < 86400000) {return `${Math.floor(diff / 3600000)}h ago`;}
    return d.toLocaleDateString('en-AU', { month: 'short', day: 'numeric' });
  }

  @state() private expandedCols: Set<string> = new Set();
  private _byStatus(status: string): VideoJob[] {
    return this.jobs.filter(j => j.status === status).toSorted((a, b) => {
      if (a.priority === 'urgent' && b.priority !== 'urgent') {return -1;}
      if (b.priority === 'urgent' && a.priority !== 'urgent') {return 1;}
      return (b.created_at || '').localeCompare(a.created_at || '');
    });
  }

  private _processableCount(): number {
    return ['planned', 'scripted', 'voice_ready', 'avatar_ready', 'captioned', 'approved']
      .reduce((sum, s) => sum + this._byStatus(s).length, 0);
  }

  static styles = css`
    :host { display: block; color: var(--text-primary); font-family: 'Inter', -apple-system, sans-serif; }

    .stats-bar { display: flex; gap: 12px; align-items: center; margin-bottom: 14px; flex-wrap: wrap; font-size: 12px; }
    .stat { color: var(--text-muted); }
    .stat strong { color: var(--text-primary); }
    .stat.danger strong { color: var(--critical); }
    .stat.warn strong { color: var(--amber); }
    .actions { margin-left: auto; display: flex; gap: 6px; }
    .btn { padding: 5px 12px; border-radius: 6px; font-size: 11px; font-weight: 500; cursor: pointer; border: none; }
    .btn-primary { background: var(--magenta); color: var(--void); }
    .btn-primary:disabled { opacity: 0.4; cursor: default; }
    .btn-ghost { background: var(--surface-hi); color: var(--text-muted); border: 1px solid var(--border-dim); }

    .review-section { margin-bottom: 16px; }
    .section-label { font-size: 12px; font-weight: 600; margin-bottom: 8px; }
    .review-cards { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px; }
    .review-card { min-width: 200px; max-width: 260px; padding: 10px 12px; background: var(--surface);
      border: 1px solid var(--amber, #F59E0B); border-radius: 8px; cursor: pointer; flex-shrink: 0; }
    .review-card:hover { border-color: var(--magenta); }

    .kanban { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; margin-bottom: 16px; min-height: 200px; }
    .kanban-col { background: var(--surface); border: 1px solid var(--border-faint); border-radius: 10px; padding: 8px; }
    .col-header { display: flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 600;
      padding: 4px 6px; margin-bottom: 8px; color: var(--text-muted); }
    .col-count { background: var(--border-dim); border-radius: 8px; padding: 0 5px; font-size: 10px; margin-left: auto; }
    .col-cards { display: flex; flex-direction: column; gap: 6px; }
    .col-empty { text-align: center; color: var(--text-dim); font-size: 10px; padding: 12px 0; }
    .col-more { text-align: center; font-size: 10px; color: var(--magenta); cursor: pointer; padding: 6px; font-weight: 500; }
    .col-more:hover { text-decoration: underline; }

    .job-card { padding: 8px 10px; background: var(--surface-hi); border: 1px solid var(--border-dim);
      border-radius: 6px; cursor: pointer; transition: border-color 120ms; font-size: 11px; }
    .job-card:hover { border-color: var(--magenta); }
    .job-card.urgent { border-left: 2px solid var(--critical); }
    .job-topic { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 3px; }
    .job-meta { display: flex; gap: 6px; color: var(--text-dim); font-size: 10px; }
    .job-platforms { font-size: 10px; }

    .failed-section, .done-section { margin-bottom: 14px; }
    .failed-cards { display: flex; gap: 8px; flex-wrap: wrap; }
    .failed-card { padding: 8px 10px; background: var(--surface); border: 1px solid var(--critical);
      border-radius: 6px; cursor: pointer; font-size: 11px; max-width: 260px; }
    .failed-actions { display: flex; gap: 6px; margin-top: 6px; }
    .btn-danger { background: rgba(var(--critical-rgb, 224,82,82), 0.12); color: var(--critical, #EF4444); }
    .done-list { display: flex; flex-direction: column; gap: 4px; }
    .done-item { display: flex; align-items: center; gap: 8px; padding: 6px 10px; font-size: 11px;
      cursor: pointer; border-radius: 6px; }
    .done-item:hover { background: var(--surface-hi); }
    .status-pill { font-size: 9px; padding: 1px 6px; border-radius: 4px; font-weight: 600; text-transform: uppercase; }
    .status-pill.approved { background: rgba(16,185,129,0.12); color: #10B981; }
    .status-pill.scheduled { background: rgba(59,130,246,0.12); color: #3B82F6; }
    .status-pill.posted { background: rgba(76,175,122,0.12); color: var(--success); }
    .grade-badge { font-size: 10px; padding: 1px 5px; border-radius: 4px; font-weight: 600; }
    .empty { text-align: center; padding: 40px; color: var(--text-muted); font-size: 13px; }
  `;

  render() {
    if (this.detailJobId?.startsWith('cjob_')) {
      const p = this._cinematicPhase || '';
      const close = () => { this.detailJobId = null; this._cinematicPhase = null; this._load(); };
      const REVIEW_MAP: Record<string, { component: string; type: string; label: string }> = {
        analysis_review: { component: 'analysis', type: '', label: 'Style & Script' },
        ref_review: { component: 'assets', type: 'ref', label: 'Reference Images' },
        keyframe_review: { component: 'assets', type: 'keyframe', label: 'Keyframes' },
        clip_review: { component: 'assets', type: 'clip', label: 'Video Clips' },
        final_review: { component: 'final', type: '', label: 'Final Video' },
        approved: { component: 'final', type: '', label: 'Final Video' },
      };
      const STATUS_MSG: Record<string, string> = {
        brief: 'Preparing brief...', analyzing: 'AI is analyzing your brief...',
        ref_images: 'Generating reference images...', keyframes: 'Creating keyframes...',
        video_clips: 'Generating video clips...', narration: 'Recording narration...',
        assembly: 'Assembling final video...', qa: 'Running quality checks...',
      };
      const rv = REVIEW_MAP[p];
      const statusMsg = STATUS_MSG[p];
      return html`
        <div style="margin-bottom:10px">
          <button class="btn btn-ghost" @click=${close}>\u2190 Back to Pipeline</button>
          <span style="margin-left:8px;font-size:12px;color:var(--text-muted)">${p.replace(/_/g, ' ')}</span>
        </div>
        ${rv?.component === 'analysis' ? html`<review-analysis .cjobId=${this.detailJobId} @close=${close} @refresh=${close}></review-analysis>` : nothing}
        ${rv?.component === 'assets' ? html`<review-assets .cjobId=${this.detailJobId} .reviewType=${rv.type} @close=${close} @refresh=${close}></review-assets>` : nothing}
        ${rv?.component === 'final' ? html`<review-final .cjobId=${this.detailJobId} @close=${close} @refresh=${close}></review-final>` : nothing}
        ${statusMsg ? html`
          <div style="text-align:center;padding:20px;color:var(--text-muted);font-size:14px">${statusMsg}</div>
          ${this._renderLiveAssets(p)}
          <div style="text-align:center;margin-top:16px">
            <button class="btn btn-danger" @click=${() => this._cancelCinematic()}>Stop Generation</button>
            <div style="font-size:10px;color:var(--text-dim);margin-top:4px">Auto-refreshes every 15 seconds</div>
          </div>` : nothing}
        ${!rv && !statusMsg ? html`<div style="text-align:center;padding:40px;color:var(--text-muted);font-size:13px">Phase: ${p.replace(/_/g, ' ')}</div>` : nothing}
      `;
    }
    if (this.detailJobId) {return html`
      <pipeline-job-detail .jobId=${this.detailJobId}
        @close=${() => this.detailJobId = null}
        @refresh=${() => { this.detailJobId = null; this._load(); }}></pipeline-job-detail>`;}
    if (this.showReport) {return html`
      <pipeline-report @close=${() => this.showReport = false}
        @open-job=${(e: CustomEvent) => { this.showReport = false; this.detailJobId = e.detail.jobId; }}></pipeline-report>`;}
    if (this.loading) {return html`<div class="empty">Loading pipeline...</div>`;}
    const c = this.stats?.counts || {};
    const pCount = this._processableCount();

    return html`
      <div class="stats-bar">
        <span class="stat">Drafts: <strong>${c.draft || 0}</strong></span>
        <span class="stat">In progress: <strong>${(c.scripted||0)+(c.voice_ready||0)+(c.avatar_ready||0)+(c.captioned||0)}</strong></span>
        <span class="stat">Scheduled: <strong>${c.scheduled || 0}</strong></span>
        <span class="stat">Published: <strong>${c.posted || 0}</strong></span>
        ${this.failedJobs.length ? html`<span class="stat danger">Failed: <strong>${this.failedJobs.length}</strong></span>` : nothing}
        ${this.reviewJobs.length ? html`<span class="stat warn">Review: <strong>${this.reviewJobs.length}</strong></span>` : nothing}
        <div class="actions">
          <button class="btn btn-primary" ?disabled=${pCount === 0} @click=${() => this._triggerPipeline()}>
            Run Pipeline${pCount ? ` (${pCount})` : ''}</button>
          <button class="btn btn-ghost" @click=${() => this.showReport = true}>Report</button>
          <button class="btn btn-ghost" @click=${() => this._load()}>Refresh</button>
        </div>
      </div>

      ${this.reviewJobs.length ? html`
        <div class="review-section">
          <div class="section-label" style="color:var(--amber)">Needs Review (${this.reviewJobs.length})</div>
          <div class="review-cards">
            ${this.reviewJobs.map(j => html`
              <div class="review-card" @click=${() => this._openJob(j.job_id)}>
                <div class="job-topic">${j.topic || j.job_id}</div>
                <div class="job-meta"><span>${j.pillar || ''}</span><span>${this._fmtTime(j.updated_at)}</span>
                  ${j.grade ? html`<span class="grade-badge">${j.grade}/5</span>` : html`<span style="color:var(--amber)">ungraded</span>`}</div>
              </div>`)}
          </div>
        </div>` : nothing}

      ${this.cinematicJobs.length ? html`
        <div class="review-section" style="margin-bottom:14px">
          <div class="section-label" style="color:#F97316">Cinematic Videos (${this.cinematicJobs.length})</div>
          <div class="review-cards">
            ${this.cinematicJobs.map((j: any) => html`
              <div class="review-card" style="border-color:#F97316" @click=${() => { this.detailJobId = j.cjob_id; this._cinematicPhase = j.phase; }}>
                <div class="job-topic">${j.title || j.cjob_id}</div>
                <div class="job-meta">
                  <span class="status-pill" style="background:rgba(249,115,22,0.15);color:#F97316">${(j.phase || '').replace(/_/g, ' ')}</span>
                  <span>${this._fmtTime(j.updated_at || j.created_at)}</span>
                </div>
              </div>`)}
          </div>
        </div>` : nothing}

      <div class="kanban">
        ${KANBAN_COLS.map(col => {
          const items = this._byStatus(col.status);
          return html`
            <div class="kanban-col">
              <div class="col-header"><span>${col.icon}</span> ${col.label} <span class="col-count">${items.length}</span></div>
              <div class="col-cards">
                ${items.length ? html`
                  ${(this.expandedCols.has(col.status) ? items : items.slice(0, 5)).map(j => this._renderCard(j))}
                  ${items.length > 5 && !this.expandedCols.has(col.status) ? html`
                    <div class="col-more" @click=${() => { this.expandedCols = new Set([...this.expandedCols, col.status]); }}>Show ${items.length - 5} more</div>` : nothing}
                  ${items.length > 5 && this.expandedCols.has(col.status) ? html`
                    <div class="col-more" @click=${() => { const s = new Set(this.expandedCols); s.delete(col.status); this.expandedCols = s; }}>Show less</div>` : nothing}
                ` : html`<div class="col-empty">\u2014</div>`}
              </div>
            </div>`;
        })}
      </div>

      ${this.failedJobs.length ? html`
        <div class="failed-section">
          <div class="section-label" style="color:var(--critical)">Failed (${this.failedJobs.length})</div>
          <div class="failed-cards">
            ${this.failedJobs.map(j => html`
              <div class="failed-card" @click=${() => this._openJob(j.job_id)}>
                <div class="job-topic">${j.topic || j.job_id}</div>
                <div class="job-meta"><span>${j.status}</span><span>${j.failure_reason?.slice(0, 40) || ''}</span></div>
                <div class="failed-actions" @click=${(e: Event) => e.stopPropagation()}>
                  <button class="btn btn-ghost" @click=${() => this._retryJob(j.job_id)}>Retry</button>
                  <button class="btn btn-danger" @click=${() => this._deleteJob(j.job_id, j.topic)}>Delete</button>
                </div>
              </div>`)}
          </div>
        </div>` : nothing}

      ${this.doneJobs.length ? html`
        <div class="done-section">
          <div class="section-label">Approved / Scheduled / Published (${this.doneJobs.length})</div>
          <div class="done-list">
            ${this.doneJobs.slice(0, 15).map(j => html`
              <div class="done-item" @click=${() => this._openJob(j.job_id)}>
                <span class="status-pill ${j.status}">${j.status}</span>
                <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${j.topic || j.job_id}</span>
                ${j.grade ? html`<span class="grade-badge">${j.grade}/5</span>` : nothing}
                <span style="color:var(--text-dim)">${this._fmtTime(j.updated_at)}</span>
              </div>`)}
          </div>
        </div>` : nothing}
    `;
  }

  private _renderCard(j: VideoJob) {
    const platforms = this._parsePlatforms(j.platform_targets);
    return html`
      <div class="job-card ${j.priority === 'urgent' ? 'urgent' : ''}" @click=${() => this._openJob(j.job_id)}>
        <div class="job-topic">${j.topic || j.job_id}</div>
        <div class="job-meta">
          <span>${j.pillar || ''}</span>
          ${platforms.length ? html`<span class="job-platforms">${platforms.includes('instagram') ? '\u{1F4F8}' : ''}${platforms.includes('x') ? '\u{1D54F}' : ''}</span>` : nothing}
          <span>${this._fmtTime(j.updated_at)}</span>
        </div>
      </div>`;
  }

  private _parsePlatforms(pt: string | null): string[] {
    if (!pt) {return [];}
    try { const p = JSON.parse(pt); return Array.isArray(p) ? p : typeof p === 'object' ? Object.keys(p) : []; }
    catch { return []; }
  }

  @state() private _liveAssets: any[] = [];

  private _renderLiveAssets(phase: string) {
    // Map generation phase to asset type
    const typeMap: Record<string, string> = { ref_images: 'ref_image', keyframes: 'keyframe_first', video_clips: 'video_clip' };
    const assetType = typeMap[phase];
    if (!assetType || !this.detailJobId) {return nothing;}
    // Fetch assets on each poll (pipeline already polls every 15s)
    this._fetchLiveAssets(assetType);
    if (!this._liveAssets.length) {return html`<div style="font-size:12px;color:var(--text-dim);text-align:center">Waiting for first result...</div>`;}
    const total = this._liveAssets.length;
    return html`
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">${total} generated so far</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px">
        ${this._liveAssets.map(a => html`
          <div style="border-radius:8px;overflow:hidden;border:1px solid var(--border-faint)">
            ${a.asset_type === 'video_clip'
              ? html`<video style="width:100%;display:block" controls preload="metadata" src=${a.file_url || `/cinematic-asset/${a.asset_id}`}></video>`
              : html`<img style="width:100%;display:block" src=${a.file_url || `/cinematic-asset/${a.asset_id}`} />`}
          </div>`)}
      </div>`;
  }

  private async _fetchLiveAssets(assetType: string) {
    try {
      const data = await this._api(`/api/cinematic/jobs/${this.detailJobId}`);
      const assets = data?.assets || [];
      this._liveAssets = assets.filter((a: any) => a.asset_type?.startsWith(assetType.replace('_first', '')));
    } catch {}
  }

  private async _cancelCinematic() {
    if (!this.detailJobId) {return;}
    const ok = typeof (window as any).dashConfirm === 'function'
      ? await (window as any).dashConfirm('Stop generation? Completed assets will be kept.')
      : confirm('Stop generation? Completed assets will be kept.');
    if (!ok) {return;}
    await this._api(`/api/cinematic/jobs/${this.detailJobId}/cancel`, { method: 'POST' });
    this.detailJobId = null; this._cinematicPhase = null; this._load();
  }
}
