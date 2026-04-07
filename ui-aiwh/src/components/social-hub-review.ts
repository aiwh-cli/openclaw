import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

interface ReviewItem {
  job_id: string; topic: string; pillar: string; status: string;
  content_type: string; captions: Record<string, string> | string | null;
  image_path: string | null; retry_count: number;
  grade: number | null; grade_notes: string | null;
  failure_reason: string | null;
  source: 'social' | 'cinematic'; created_at: string;
}

@customElement('social-hub-review')
export class SocialHubReview extends LitElement {
  @state() private items: ReviewItem[] = [];
  @state() private loading = true;
  @state() private selectedId: string | null = null;
  @state() private grade = 4;
  @state() private feedback = '';
  @state() private publishing: Record<string, boolean> = {};
  @state() private publishMsg: Record<string, string> = {};
  @property({ type: String }) focusJobId = '';
  @state() private cinematicView: { cjobId: string; type: 'analysis' | 'ref' | 'keyframe' | 'clip' | 'final' } | null = null;
  @state() private generating: Record<string, boolean> = {};
  @state() private captionEdits: Record<string, Record<string, string>> = {};
  @state() private platforms: string[] = ['instagram', 'x'];
  private _pollTimer: ReturnType<typeof setInterval> | null = null;

  connectedCallback() { super.connectedCallback(); this._load(); }
  disconnectedCallback() { super.disconnectedCallback(); this._clearPoll(); }

  private async _load() {
    this.loading = true;
    try { this.items = (await this._api('/api/social-hub/review-queue')).items || []; }
    catch (e) { console.error('[review]', e); }
    if (this.focusJobId && this.items.find(i => i.job_id === this.focusJobId)) {
      this.selectedId = this.focusJobId;
    }
    this.loading = false;
  }

  private _clearPoll() { if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; } }

  updated(changed: Map<string, any>) {
    super.updated(changed);
    if (changed.has('selectedId')) {
      this._clearPoll();
      const sel = this._selected;
      if (sel && this._isPending(sel)) {
        let n = 0;
        this._pollTimer = setInterval(async () => {
          n++; await this._load();
          const item = this.items.find(i => i.job_id === this.selectedId);
          if (!item || !this._isPending(item) || n >= 18) {this._clearPoll();}
        }, 10000);
      }
    }
  }

  private async _api(url: string, opts?: RequestInit) {
    const res = await fetch(url, { credentials: 'same-origin', ...opts });
    if (!res.ok) {return {};}
    const ct = res.headers.get('content-type') || '';
    return ct.includes('json') ? res.json() : {};
  }

  private _getCaptions(item: ReviewItem): Record<string, string> {
    if (!item.captions) {return {};}
    if (typeof item.captions === 'object') {return item.captions;}
    const str = String(item.captions).trim();
    if (!str) {return {};}
    try { const p = JSON.parse(str); if (typeof p === 'object' && p) {return p;} } catch { /* truncated JSON */ }
    const m = str.match(/"(\w+)":\s*"([\s\S]+)/);
    if (m) { const val = m[2].replace(/"\s*,?\s*"?\w*"?:?\s*"?[^"]*$/, '').replace(/\\n/g, '\n'); return { [m[1]]: val }; }
    if (str.includes('---X---')) { const p = str.split('---X---'); return { instagram: p[0]?.trim() || '', x: p[1]?.trim() || '' }; }
    return { caption: str };
  }

  private _hasVideo(item: ReviewItem) { return item.source === 'cinematic' && ['final_review', 'approved', 'published'].includes(item.status); }
  private _canReject(item: ReviewItem) { return item.source === 'social' || item.status.endsWith('_review'); }
  private get _selected(): ReviewItem | undefined { return this.items.find(i => i.job_id === this.selectedId); }

  private async _approve(item: ReviewItem) {
    if (item.source === 'social') {
      await this._api(`/api/social/review/${item.job_id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve', grade: this.grade, feedback: this.feedback }) });
    } else {
      await this._api(`/api/cinematic/jobs/${item.job_id}/approve-phase`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grade: this.grade, notes: this.feedback }) });
    }
    this.feedback = ''; this.selectedId = null; this._load();
  }

  private async _reject(item: ReviewItem) {
    if (item.source === 'social') {
      await this._api(`/api/social/review/${item.job_id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject', grade: this.grade, feedback: this.feedback }) });
    } else {
      await this._api(`/api/cinematic/jobs/${item.job_id}/reject`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: this.feedback }) });
    }
    this.feedback = ''; this.selectedId = null; this._load();
  }

  private async _regenCaptions(item: ReviewItem) {
    this.generating = { ...this.generating, [item.job_id]: true };
    if (item.source === 'social') {
      await this._api(`/api/social/review/${item.job_id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'regen_captions', feedback: this.feedback }) });
    } else {
      await this._api(`/api/cinematic/jobs/${item.job_id}/generate-caption`, { method: 'POST' });
    }
    this._clearPoll(); let n = 0;
    this._pollTimer = setInterval(async () => {
      n++; await this._load();
      const updated = this.items.find(i => i.job_id === item.job_id);
      const caps = updated?.captions;
      const hasCaps = caps && (typeof caps === 'object' ? Object.values(caps).some((c: any) => String(c).trim()) : String(caps).trim().length > 5);
      if (hasCaps || n >= 12) { this.generating = { ...this.generating, [item.job_id]: false }; this._clearPoll(); }
    }, 5000);
  }

  private async _genCinematicCaptions(item: ReviewItem) {
    this.generating = { ...this.generating, [item.job_id]: true };
    await this._api(`/api/social-hub/cinematic-captions/${item.job_id}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platforms: this.platforms }) });
    this._regenCaptions(item); // reuse the same poll logic
  }

  private async _complete(item: ReviewItem) {
    await this._api(`/api/cinematic/jobs/${item.job_id}/complete`, { method: 'POST' });
    this.selectedId = null; this._load();
  }

  private async _delete(item: ReviewItem) {
    const ok = typeof (window as any).dashConfirm === 'function'
      ? await (window as any).dashConfirm(`Delete "${item.topic || item.job_id}"?`)
      : confirm(`Delete "${item.topic || item.job_id}"?`);
    if (!ok) {return;}
    const url = item.source === 'cinematic' ? `/api/cinematic/jobs/${item.job_id}` : `/api/content/jobs/${item.job_id}`;
    await this._api(url, { method: 'DELETE' });
    this.selectedId = null; this._load();
  }

  private async _publish(item: ReviewItem) {
    if (this.publishing[item.job_id]) {return;} // prevent double-click
    const captions = this.captionEdits[item.job_id] || this._getCaptions(item);
    this.publishing = { ...this.publishing, [item.job_id]: true };
    const hasMedia = item.source === 'cinematic' || (item.content_type === 'image_post' && item.image_path);
    this.publishMsg = { ...this.publishMsg, [item.job_id]: hasMedia ? 'Uploading media — this may take up to a minute for large files...' : 'Scheduling post...' };
    try {
      const res = await this._api(`/api/social-hub/publish/${item.job_id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: item.source, platforms: this.platforms, captions }) });
      if ((res).ok) {
        this.publishMsg = { ...this.publishMsg, [item.job_id]: 'Published! The social agent is scheduling your post on Buffer.' };
        setTimeout(() => this._load(), 5000);
        // Keep publishing=true so button stays disabled
        return;
      }
      this.publishMsg = { ...this.publishMsg, [item.job_id]: `Error: ${(res).error || 'Unknown'}` };
    } catch (e: any) { this.publishMsg = { ...this.publishMsg, [item.job_id]: `Error: ${e.message}` }; }
    this.publishing = { ...this.publishing, [item.job_id]: false };
  }

  private _updateCaption(jobId: string, plat: string, val: string) {
    this.captionEdits = { ...this.captionEdits, [jobId]: { ...this.captionEdits[jobId], [plat]: val } };
  }

  private _fmtTime(iso: string) {
    if (!iso) {return '';}
    const d = new Date(iso.includes('Z') || iso.includes('+') ? iso : iso + 'Z');
    const diff = Date.now() - d.getTime();
    if (diff < 3600000) {return `${Math.floor(diff / 60000)}m ago`;}
    if (diff < 86400000) {return `${Math.floor(diff / 3600000)}h ago`;}
    return d.toLocaleDateString('en-AU', { month: 'short', day: 'numeric' });
  }

  static styles = css`
    :host { display: block; color: var(--text-primary); font-family: 'Inter', -apple-system, sans-serif; }
    .empty { text-align: center; padding: 40px; color: var(--text-muted); font-size: 13px; }

    /* Summary bar */
    .summary { display: flex; gap: 10px; margin-bottom: 14px; font-size: 12px; color: var(--text-muted); }
    .summary-item { display: flex; align-items: center; gap: 4px; }
    .summary-dot { width: 8px; height: 8px; border-radius: 2px; }

    /* Card grid */
    .card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; margin-bottom: 16px; }
    .card { padding: 12px; background: var(--surface); border: 1px solid var(--border-dim); border-radius: 10px;
      cursor: pointer; transition: all 150ms; }
    .card:hover { border-color: var(--border-hover); }
    .card.selected { border-color: var(--magenta); box-shadow: 0 0 0 1px var(--magenta); }
    .card-type { font-size: 9px; font-weight: 600; text-transform: uppercase; margin-bottom: 6px; }
    .card-type.cinematic { color: #F97316; }
    .card-type.text_post { color: #0EA5E9; }
    .card-type.image_post { color: #10B981; }
    .card-type.video_reel { color: #8B5CF6; }
    .card-topic { font-size: 12px; font-weight: 500; margin-bottom: 6px;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .card-meta { font-size: 10px; color: var(--text-dim); display: flex; gap: 6px; }
    .card-thumb { width: 100%; height: 80px; object-fit: cover; border-radius: 6px; margin-bottom: 6px; background: var(--surface-hi); }

    /* Detail panel */
    .detail { background: var(--surface); border: 1px solid var(--border-dim); border-radius: 12px;
      padding: 20px; margin-bottom: 16px; }
    .detail-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
    .detail-title { font-size: 16px; font-weight: 600; flex: 1; }
    .detail-close { background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 18px; padding: 4px 8px; }
    .detail-badges { display: flex; gap: 6px; margin-bottom: 12px; }
    .type-badge { font-size: 10px; padding: 2px 8px; border-radius: 6px; font-weight: 600; text-transform: uppercase; }
    .type-badge.cinematic { background: rgba(249,115,22,0.15); color: #F97316; }
    .type-badge.text_post { background: rgba(14,165,233,0.15); color: #0EA5E9; }
    .type-badge.image_post { background: rgba(16,185,129,0.15); color: #10B981; }
    .type-badge.video_reel { background: rgba(139,92,246,0.15); color: #8B5CF6; }
    .status-tag { font-size: 10px; padding: 2px 8px; border-radius: 6px; background: var(--surface-hi); color: var(--text-muted); }

    .preview { margin: 12px 0; border-radius: 8px; overflow: hidden; }
    .preview video, .preview img { width: 100%; max-height: 360px; object-fit: contain; background: #000; }
    .no-media { padding: 16px; text-align: center; background: var(--surface-hi); border-radius: 8px;
      color: var(--text-dim); font-size: 12px; margin: 12px 0; }
    .caption-block { margin: 10px 0; }
    .caption-label { font-size: 11px; font-weight: 600; color: var(--text-muted); margin-bottom: 4px; text-transform: uppercase; }
    .caption-text { font-size: 12px; line-height: 1.5; white-space: pre-wrap; background: var(--surface-hi);
      padding: 10px; border-radius: 6px; border: 1px solid var(--border-faint); max-height: 400px; overflow-y: auto; }
    .generating-msg { padding: 12px 16px; background: rgba(var(--magenta-rgb, 201,168,76), 0.08);
      border: 1px solid rgba(var(--magenta-rgb, 201,168,76), 0.2); border-radius: 8px; color: var(--magenta);
      font-size: 12px; margin: 10px 0; animation: pulse 2s infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
    textarea { background: var(--surface-hi); color: var(--text-primary); border: 1px solid var(--border-dim);
      border-radius: 8px; padding: 8px; font-size: 12px; width: 100%; resize: vertical; min-height: 60px;
      font-family: inherit; box-sizing: border-box; }

    .actions { display: flex; gap: 8px; align-items: center; margin-top: 14px; flex-wrap: wrap; }
    .btn { padding: 6px 14px; border-radius: 6px; font-size: 12px; font-weight: 500; cursor: pointer; border: none; }
    .btn-approve { background: rgba(76,175,122,0.15); color: var(--success, #4CAF7A); }
    .btn-reject { background: rgba(224,82,82,0.15); color: var(--critical, #EF4444); }
    .btn-ghost { background: var(--surface-hi); color: var(--text-muted); border: 1px solid var(--border-dim); }
    .btn-publish { background: var(--magenta); color: var(--void); }
    .btn:disabled { opacity: 0.5; cursor: default; }
    select { background: var(--surface-hi); color: var(--text-primary); border: 1px solid var(--border-dim);
      border-radius: 6px; padding: 4px 8px; font-size: 12px; }
    .msg { font-size: 11px; margin-top: 6px; padding: 4px 8px; border-radius: 4px; }
    .msg.ok { color: var(--success); background: rgba(76,175,122,0.1); }
    .msg.err { color: var(--critical); background: rgba(224,82,82,0.1); }
    .platform-checks { display: flex; gap: 10px; margin: 10px 0; font-size: 12px; }
    .platform-checks label { display: flex; align-items: center; gap: 4px; cursor: pointer; color: var(--text-muted); }
    .feedback-row { display: flex; gap: 8px; align-items: center; margin-top: 10px; }
    .feedback-row input { flex: 1; background: var(--surface-hi); color: var(--text-primary);
      border: 1px solid var(--border-dim); border-radius: 6px; padding: 5px 10px; font-size: 12px; }
  `;

  render() {
    if (this.cinematicView) {
      const cv = this.cinematicView;
      const onClose = () => { this.cinematicView = null; this._load(); };
      const onRefresh = () => { this.cinematicView = null; this._load(); };
      if (cv.type === 'analysis') {return html`<review-analysis .cjobId=${cv.cjobId} @close=${onClose} @refresh=${onRefresh}></review-analysis>`;}
      if (cv.type === 'final') {return html`<review-final .cjobId=${cv.cjobId} @close=${onClose} @refresh=${onRefresh}></review-final>`;}
      return html`<review-assets .cjobId=${cv.cjobId} .reviewType=${cv.type} @close=${onClose} @refresh=${onRefresh}></review-assets>`;
    }
    if (this.loading && !this.items.length) {return html`<div class="empty">Loading review queue...</div>`;}
    if (!this.items.length) {return html`<div class="empty">No items pending review</div>`;}

    const byType: Record<string, number> = {};
    for (const i of this.items) {byType[i.content_type] = (byType[i.content_type] || 0) + 1;}
    const typeColors: Record<string, string> = { cinematic: '#F97316', text_post: '#0EA5E9', image_post: '#10B981', video_reel: '#8B5CF6' };
    const selected = this._selected;

    return html`
      <div class="summary">
        ${Object.entries(byType).map(([type, count]) => html`
          <div class="summary-item">
            <div class="summary-dot" style="background:${typeColors[type] || 'var(--text-dim)'}"></div>
            ${count} ${type.replace('_', ' ')}${count > 1 ? 's' : ''}
          </div>`)}
      </div>

      <div class="card-grid">
        ${this.items.map(item => this._renderCard(item))}
      </div>

      ${selected ? this._renderDetail(selected) : nothing}
    `;
  }

  private _renderCard(item: ReviewItem) {
    const isSelected = this.selectedId === item.job_id;
    const hasThumb = item.content_type === 'image_post' && item.image_path;
    return html`
      <div class="card ${isSelected ? 'selected' : ''}" @click=${() => this.selectedId = isSelected ? null : item.job_id}>
        ${hasThumb ? html`<img class="card-thumb" src="/api/social/image/${item.job_id}" alt="">` : nothing}
        <div class="card-type ${item.content_type}">${item.content_type.replace('_', ' ')}</div>
        <div class="card-topic">${item.topic || item.job_id}</div>
        <div class="card-meta">
          <span>${item.source}</span>
          <span>${item.status.replace('_', ' ')}</span>
          <span>${this._fmtTime(item.created_at)}</span>
        </div>
      </div>`;
  }

  private _isPending(item: ReviewItem): boolean {
    const c = item.captions;
    if (!c) {return false;}
    if (typeof c === 'object' && (c as any)._pending) {return true;}
    if (typeof c === 'string') { try { const p = JSON.parse(c); if (p?._pending) {return true;} } catch {} }
    return false;
  }

  private _renderDetail(item: ReviewItem) {
    const pending = this._isPending(item);
    const captions = pending ? {} : this._getCaptions(item);
    const hasCaptions = !pending && Object.values(captions).some(c => c.trim().length > 0);
    const isCinematic = item.source === 'cinematic';
    const isApproved = item.status === 'approved' || (isCinematic && item.status === 'published');
    const hasVideo = this._hasVideo(item);
    const canReject = this._canReject(item);
    const pubMsg = this.publishMsg[item.job_id];

    return html`
      <div class="detail">
        <div class="detail-header">
          <span class="detail-title">${item.topic || item.job_id}</span>
          <button class="detail-close" @click=${() => this.selectedId = null}>\u2715</button>
        </div>
        <div class="detail-badges">
          <span class="type-badge ${item.content_type}">${item.content_type.replace('_', ' ')}</span>
          <span class="status-tag">${item.source} \u00B7 ${item.status.replace('_', ' ')}</span>
          ${item.grade ? html`<span class="status-tag">${'\u2605'.repeat(item.grade)} ${item.grade}/5</span>` : nothing}
        </div>

        ${isCinematic ? html`
          ${hasVideo
            ? html`<div class="preview"><video src="/cinematic-final/${item.job_id}" controls preload="metadata"></video></div>`
            : html`<div class="no-media">No final video — assembly not completed</div>`}
          <div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap">
            ${this._cinematicReviewBtns(item)}
          </div>` : nothing}
        ${item.content_type === 'image_post' && item.image_path
          ? html`<div class="preview"><img src="/api/social/image/${item.job_id}" alt="Preview"></div>` : nothing}

        ${item.failure_reason ? html`<div class="msg err" style="margin-bottom:10px">${item.failure_reason}</div>` : nothing}
        ${pending ? html`<div class="generating-msg">
          ${item.content_type === 'image_post' && !item.image_path ? 'Image generating...' : 'Captions generating...'} this may take up to 60 seconds
        </div>` : nothing}
        ${this.generating[item.job_id] ? html`<div class="generating-msg">Regenerating captions...</div>` : nothing}
        ${!isCinematic ? html`
          ${hasCaptions ? Object.entries(captions).filter(([, c]) => c.trim()).map(([plat, cap]) => html`
            <div class="caption-block">
              <div class="caption-label">${plat}</div>
              ${isApproved
                ? html`<textarea .value=${this.captionEdits[item.job_id]?.[plat] ?? cap}
                    @input=${(e: Event) => this._updateCaption(item.job_id, plat, (e.target as HTMLTextAreaElement).value)}></textarea>`
                : html`<div class="caption-text">${cap}</div>`}
            </div>`) : (!pending && !this.generating[item.job_id]) ? html`<div class="no-media">No captions — use "Redo Captions" to generate</div>` : nothing}
        ` : nothing}
        ${isCinematic && isApproved ? html`
          <div style="margin:10px 0;font-size:12px;font-weight:600;color:var(--text-muted)">Social Captions (for Buffer)</div>
          ${hasCaptions ? Object.entries(captions).filter(([, c]) => c.trim()).map(([plat, cap]) => html`
            <div class="caption-block">
              <div class="caption-label">${{ instagram: 'Instagram', x: 'X', linkedin: 'LinkedIn', tiktok: 'TikTok' }[plat] || plat}</div>
              <textarea .value=${this.captionEdits[item.job_id]?.[plat] ?? cap}
                @input=${(e: Event) => this._updateCaption(item.job_id, plat, (e.target as HTMLTextAreaElement).value)}></textarea>
            </div>`) : html`
            ${this.generating[item.job_id] ? html`<div class="generating-msg">Generating captions from narration...</div>` : html`
              <button class="btn btn-primary" @click=${() => this._genCinematicCaptions(item)}>Generate Captions from Narration</button>`}`}
        ` : nothing}

        ${isApproved ? html`
          <div class="platform-checks">
            ${['instagram', 'x'].map(p => html`
              <label><input type="checkbox" .checked=${this.platforms.includes(p)}
                @change=${(e: Event) => {
                  const cb = e.target as HTMLInputElement;
                  this.platforms = cb.checked ? [...this.platforms, p] : this.platforms.filter(x => x !== p);
                }}> ${{ instagram: 'Instagram', x: 'X', linkedin: 'LinkedIn', tiktok: 'TikTok', facebook: 'Facebook' }[p] || p}</label>`)}
          </div>` : nothing}

        <div class="feedback-row">
          <select .value=${String(this.grade)} @change=${(e: Event) => this.grade = parseInt((e.target as HTMLSelectElement).value)}>
            ${[1, 2, 3, 4, 5].map(g => html`<option value=${g}>${'\u2605'.repeat(g)}${'\u2606'.repeat(5 - g)}</option>`)}
          </select>
          <input type="text" placeholder="Feedback (optional)" .value=${this.feedback}
            @input=${(e: Event) => this.feedback = (e.target as HTMLInputElement).value}>
        </div>

        <div class="actions">
          ${!isApproved ? html`<button class="btn btn-approve" @click=${() => this._approve(item)}>Approve</button>` : nothing}
          ${canReject ? html`<button class="btn btn-reject" @click=${() => this._reject(item)}>Reject</button>` : nothing}
          ${!isCinematic ? html`<button class="btn btn-ghost" @click=${() => this._regenCaptions(item)}>Redo Captions</button>` : nothing}
          ${isApproved ? html`
            ${hasVideo || !isCinematic ? html`
              <button class="btn btn-publish" ?disabled=${this.publishing[item.job_id]}
                @click=${() => this._publish(item)}>
                ${this.publishing[item.job_id] ? 'Publishing...' : 'Publish'}
              </button>` : nothing}
            ${isCinematic && !hasVideo ? html`<button class="btn btn-approve" @click=${() => this._complete(item)}>Complete</button>` : nothing}
            <button class="btn btn-reject" @click=${() => this._delete(item)}>Delete</button>
          ` : nothing}
        </div>
        ${pubMsg ? html`<div class="msg ${pubMsg.startsWith('Error') ? 'err' : 'ok'}">${pubMsg}</div>` : nothing}
      </div>`;
  }

  private _cinematicReviewBtns(item: ReviewItem) {
    const p = item.status;
    const open = (t: 'analysis' | 'ref' | 'keyframe' | 'clip' | 'final') => { this.cinematicView = { cjobId: item.job_id, type: t }; };
    const CTA: Record<string, [string, 'analysis'|'ref'|'keyframe'|'clip'|'final']> = {
      analysis_review: ['Review Style & Script', 'analysis'], ref_review: ['Review Reference Images', 'ref'],
      keyframe_review: ['Review Keyframes', 'keyframe'], clip_review: ['Review Video Clips', 'clip'], final_review: ['Review Final Video', 'final'] };
    const GEN: Record<string, string> = { brief: 'Preparing brief...', analyzing: 'Analyzing brief...', ref_images: 'Generating reference images...',
      keyframes: 'Creating keyframes...', video_clips: 'Generating video clips...', narration: 'Recording narration...', assembly: 'Assembling video...', qa: 'Quality checks...' };
    const cta = CTA[p]; const gen = GEN[p];
    return html`
      ${cta ? html`<button style="display:block;width:100%;padding:14px;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;border:none;margin-bottom:8px;text-align:center;background:var(--magenta);color:var(--void)" @click=${() => open(cta[1])}>${cta[0]}</button>` : nothing}
      ${gen ? html`<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:13px">${gen}</div>` : nothing}
      ${p === 'approved' ? html`<div style="text-align:center;padding:12px;color:var(--success);font-size:13px;font-weight:600">Approved — ready to publish</div>` : nothing}
      <div style="display:flex;gap:6px"><button style="padding:5px 12px;border-radius:6px;font-size:11px;font-weight:500;cursor:pointer;border:1px solid var(--border-dim);background:var(--surface-hi);color:var(--text-primary)" @click=${() => open('analysis')}>Style Bible</button></div>`;
  }
}
