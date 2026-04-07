/**
 * social-hub-studio — Content creation workspace (Studio tab).
 *
 * 3 creation modes: Upload, AI Image, Caption Post.
 * Each mode creates a video_jobs row and dispatches to Review.
 * Toast notification with "View in Review" link on success.
 */
import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

type Mode = 'upload' | 'ai-image' | 'caption-post' | 'slide-video';

@customElement('social-hub-studio')
export class SocialHubStudio extends LitElement {
  @property({ type: Object }) context: { date?: string; pillar?: string } = {};
  @state() private mode: Mode = 'upload';
  @state() private file: File | null = null;
  @state() private topic = '';
  @state() private pillar = '';
  @state() private platforms: Record<string, boolean> = { instagram: true, x: true };
  @state() private pillars: { name: string }[] = [];
  @state() private scheduleDate = '';
  @state() private slideFile: File | null = null;
  @state() private slideFormat = '16:9';
  @state() private loading = false;
  @state() private toast: { msg: string; jobId?: string; type: 'ok' | 'err' } | null = null;
  @state() private settings: any = null;
  @state() private fromCalendar = false;

  connectedCallback() {
    super.connectedCallback();
    this._loadSettings();
    // Only pre-fill date if it's in the future (from Calendar "+" click)
    if (this.context?.date) {
      const today = new Date().toISOString().split('T')[0];
      if (this.context.date >= today) {
        this.scheduleDate = this.context.date;
        this.fromCalendar = true;
      }
    }
    if (this.context?.pillar) {this.pillar = this.context.pillar;}
  }

  private async _loadSettings() {
    try {
      const [s, p] = await Promise.all([
        this._api('/api/social/settings'),
        this._api('/api/social-hub/settings/pillars'),
      ]);
      this.settings = s;
      this.pillars = (p.pillars || []).map((pi: any) => ({ name: pi.name || pi }));
      if (s?.target_platforms?.length) {
        const tp: Record<string, boolean> = {};
        (s.target_platforms as string[]).forEach(p => tp[p] = true);
        this.platforms = tp;
      }
    } catch (e: any) { this.toast = { msg: 'Failed to load settings', type: 'err' }; console.error('[studio]', e); }
  }

  private async _api(url: string, opts?: RequestInit) {
    const r = await fetch(url, { credentials: 'same-origin', ...opts });
    if (!r.ok) {
      const text = await r.text();
      try { return JSON.parse(text); } catch { return { error: `Server error (${r.status})` }; }
    }
    const ct = r.headers.get('content-type') || '';
    if (!ct.includes('json')) {return { error: 'Unexpected response' };}
    return r.json();
  }

  static styles = css`
    :host { display: block; }
    .modes { display: flex; gap: 8px; margin-bottom: 20px; flex-wrap: wrap; }
    .mode-btn { padding: 12px 24px; border-radius: 10px; cursor: pointer; font-size: 14px;
      font-weight: 500; border: 1px solid var(--border-dim); background: var(--surface-hi);
      color: var(--text-primary); transition: all 150ms; }
    .mode-btn:hover { border-color: var(--magenta); }
    .mode-btn.active { background: var(--magenta); color: var(--void); border-color: var(--magenta); }
    .form { display: grid; grid-template-columns: 1fr 320px; gap: 24px; }
    @media (max-width: 800px) { .form { grid-template-columns: 1fr; } }
    .main-col, .side-col { display: flex; flex-direction: column; gap: 14px; }
    .field { }
    .field label { display: block; font-size: 11px; font-weight: 600; color: var(--text-muted);
      text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
    input, textarea, select { width: 100%; padding: 10px 14px; background: var(--surface-hi);
      color: var(--text-primary); border: 1px solid var(--border-dim); border-radius: 8px;
      font-size: 14px; box-sizing: border-box; font-family: inherit; }
    textarea { resize: vertical; min-height: 100px; }
    .platforms { display: flex; gap: 14px; font-size: 13px; }
    .platforms label { display: flex; align-items: center; gap: 5px; cursor: pointer; }
    .drop-zone { border: 2px dashed var(--border-dim); border-radius: 12px; padding: 40px 24px;
      text-align: center; color: var(--text-muted); font-size: 14px; transition: all 200ms; cursor: pointer; }
    .drop-zone.over { border-color: var(--magenta); background: rgba(var(--magenta-rgb),0.04); }
    .drop-zone input[type="file"] { display: none; }
    .file-info { font-size: 13px; color: var(--text-muted); margin: 8px 0; }
    .btn { padding: 12px 24px; border-radius: 8px; font-weight: 600; font-size: 14px;
      cursor: pointer; border: none; transition: all 150ms; }
    .btn-primary { background: var(--magenta); color: var(--void); }
    .btn-primary:hover { filter: brightness(1.1); }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-secondary { background: transparent; border: 1px solid var(--border-dim); color: var(--text-primary); }
    .btn-secondary:hover { border-color: var(--magenta); color: var(--magenta); }
    .actions { display: flex; gap: 10px; flex-wrap: wrap; }
    .toast { padding: 12px 18px; border-radius: 8px; font-size: 13px; margin-top: 16px;
      display: flex; align-items: center; gap: 12px; }
    .toast.ok { background: rgba(var(--success-rgb, 34,197,94), 0.1); color: var(--success); }
    .toast.err { background: rgba(var(--critical-rgb, 224,82,82), 0.1); color: var(--critical); }
    .toast a { color: inherit; font-weight: 600; text-decoration: underline; cursor: pointer; }
    .sched-banner { background: rgba(var(--magenta-rgb),0.08); padding: 10px 16px; border-radius: 8px;
      font-size: 13px; color: var(--magenta); margin-bottom: 16px; font-weight: 500;
      display: flex; align-items: center; gap: 10px; }
    .sched-banner button { background: none; border: none; color: var(--magenta); cursor: pointer;
      font-size: 12px; text-decoration: underline; }
    .content-mix { font-size: 12px; color: var(--text-muted); margin-bottom: 16px;
      padding: 8px 14px; background: var(--surface-hi); border-radius: 8px; }
    .side-label { font-size: 12px; color: var(--text-muted); font-style: italic; }
    :host-context([data-theme="light"]) .btn-primary { color: #fff; }
  `;

  render() {
    const modes: { id: Mode; label: string; desc: string }[] = [
      { id: 'upload', label: 'Upload Content', desc: 'Image or video file' },
      { id: 'ai-image', label: 'AI Image', desc: 'Generate with AI' },
      { id: 'caption-post', label: 'Caption Post', desc: 'Text + image captions' },
      { id: 'slide-video', label: 'Slide Video', desc: 'Explainer / tutorial' },
    ];

    return html`
      <div class="modes">
        ${modes.map(m => html`
          <div class="mode-btn ${this.mode === m.id ? 'active' : ''}"
               @click=${() => { this.mode = m.id; this.toast = null; }}>
            ${m.label}
          </div>`)}
        <div class="mode-btn" @click=${this._openCinematic}>
          Cinematic Video
        </div>
      </div>

      ${this.fromCalendar && this.scheduleDate ? html`
        <div class="sched-banner">
          Scheduling for: ${this._formatDate(this.scheduleDate)}
          <button @click=${() => { this.scheduleDate = ''; this.fromCalendar = false; }}>Clear</button>
        </div>` : nothing}

      ${this._renderContentMix()}

      <div class="form">
        <div class="main-col">
          ${this.mode === 'upload' ? this._renderUpload()
          : this.mode === 'ai-image' ? this._renderAiImage()
          : this.mode === 'slide-video' ? this._renderSlideVideo()
          : this._renderCaptionPost()}
        </div>
        <div class="side-col">
          ${this._renderSharedFields()}
        </div>
      </div>

      ${this.toast ? html`
        <div class="toast ${this.toast.type}">
          ${this.toast.msg}
          ${this.toast.jobId ? html`<a @click=${() => this._goToReview(this.toast!.jobId!)}>View in Review</a>` : nothing}
        </div>` : nothing}
    `;
  }

  private _renderContentMix() {
    if (!this.settings?.content_mix) {return nothing;}
    const m = this.settings.content_mix;
    const video = m.video_reels ?? m.video ?? 0;
    const text = m.text_posts ?? m.text ?? 0;
    const image = m.image_posts ?? m.image ?? 0;
    if (!video && !text && !image) {return nothing;}
    return html`<div class="content-mix">Target content mix: ${video}% video, ${image}% image, ${text}% text</div>`;
  }

  private _renderUpload() {
    return html`
      <div class="drop-zone" id="dz"
        @dragover=${(e: DragEvent) => { e.preventDefault(); this._dz()?.classList.add('over'); }}
        @dragleave=${() => this._dz()?.classList.remove('over')}
        @drop=${(e: DragEvent) => { e.preventDefault(); this._dz()?.classList.remove('over');
          if (e.dataTransfer?.files[0]) {this.file = e.dataTransfer.files[0];} }}
        @click=${() => this.shadowRoot?.querySelector<HTMLInputElement>('#file-in')?.click()}>
        ${this.file
          ? html`<div class="file-info">${this.file.name} (${(this.file.size/1048576).toFixed(1)} MB)</div>`
          : 'Drop an image or video here, or click to browse'}
        <input type="file" id="file-in" accept="image/*,video/*"
          @change=${(e: Event) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) {this.file = f;} }} />
      </div>
      <div class="field"><label>Topic</label>
        <input type="text" .value=${this.topic} @input=${(e: Event) => this.topic = (e.target as HTMLInputElement).value}
          placeholder="What's this about?" /></div>
      <div class="actions">
        <button class="btn btn-primary" ?disabled=${!this.file || this.loading}
          @click=${() => this._doUpload(true)}>${this.loading ? 'Uploading...' : 'Upload + Generate Captions'}</button>
        <button class="btn btn-secondary" ?disabled=${!this.file || this.loading}
          @click=${() => this._doUpload(false)}>Add to Review</button>
      </div>
    `;
  }

  private _renderAiImage() {
    return html`
      <div class="field"><label>Image Prompt</label>
        <textarea .value=${this.topic} @input=${(e: Event) => this.topic = (e.target as HTMLTextAreaElement).value}
          placeholder="Describe the image you want to generate. Be specific about style, colors, composition..."></textarea></div>
      <div class="actions">
        <button class="btn btn-primary" ?disabled=${!this.topic.trim() || this.loading}
          @click=${this._doAiImage}>${this.loading ? 'Generating...' : 'Generate Image'}</button>
      </div>
      <div class="side-label">The AI will generate an image using your configured image provider, then auto-generate per-platform captions.</div>
    `;
  }

  private _renderCaptionPost() {
    return html`
      <div class="field"><label>Post Topic</label>
        <textarea .value=${this.topic} @input=${(e: Event) => this.topic = (e.target as HTMLTextAreaElement).value}
          placeholder="What do you want to post about? The AI will write platform-specific captions."></textarea></div>
      <div class="actions">
        <button class="btn btn-primary" ?disabled=${!this.topic.trim() || this.loading}
          @click=${this._doCaptionPost}>${this.loading ? 'Creating...' : 'Generate Captions'}</button>
      </div>
      <div class="side-label">The copywriter agent will create per-platform captions. Pair this with an image upload for best results.</div>
    `;
  }

  private _renderSharedFields() {
    return html`
      <div class="field"><label>Pillar</label>
        <select .value=${this.pillar} @change=${(e: Event) => this.pillar = (e.target as HTMLSelectElement).value}>
          <option value="">None</option>
          ${this.pillars.map(p => html`<option .value=${p.name} ?selected=${this.pillar === p.name}>${p.name}</option>`)}
        </select></div>
      <div class="field"><label>Platforms</label>
        <div class="platforms">
          ${Object.entries(this.platforms).map(([p, checked]) => html`
            <label><input type="checkbox" .checked=${checked}
              @change=${(e: Event) => { this.platforms = { ...this.platforms, [p]: (e.target as HTMLInputElement).checked }; }} /> ${p}</label>`)}
        </div></div>
      <div class="field"><label>Schedule Date</label>
        <input type="date" .value=${this.scheduleDate} min=${new Date().toISOString().split('T')[0]}
          @input=${(e: Event) => this.scheduleDate = (e.target as HTMLInputElement).value} />
        <div style="font-size:11px;color:var(--text-dim);margin-top:3px">Leave empty to add without scheduling</div>
      </div>
    `;
  }

  // ─── Actions ─────────────────────────────────────────────────
  private async _doUpload(withCaptions: boolean) {
    if (!this.file) {return;}
    this.loading = true; this.toast = null;
    const form = new FormData();
    form.append('file', this.file);
    form.append('topic', this.topic);
    form.append('pillar', this.pillar);
    form.append('platforms', JSON.stringify(this._selectedPlatforms()));
    form.append('platform', this._selectedPlatforms()[0] || 'instagram');
    if (this.scheduleDate) {form.append('scheduled_for_date', this.scheduleDate);}
    if (withCaptions) {form.append('generate_captions', 'true');}

    try {
      const resp = await fetch('/api/studio/upload', { method: 'POST', credentials: 'same-origin', body: form });
      const ct = resp.headers.get('content-type') || '';
      if (!ct.includes('json')) {
        this.toast = { msg: `Error: Server returned ${resp.status}. Try refreshing the page.`, type: 'err' };
        this.loading = false; return;
      }
      const r = await resp.json();
      if (r.ok) {
        this.toast = { msg: `Uploaded! ${withCaptions ? 'Captions generating.' : ''}`, jobId: r.job_id, type: 'ok' };
        this.file = null; this.topic = '';
      } else {
        this.toast = { msg: `Error: ${r.error || 'Unknown error'}`, type: 'err' };
      }
    } catch (e: any) { this.toast = { msg: `Error: ${e.message}`, type: 'err' }; }
    this.loading = false;
  }

  private async _doAiImage() {
    this.loading = true; this.toast = null;
    try {
      const r = await this._api('/api/studio/generate-image', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: this.topic, pillar: this.pillar,
          platforms: this._selectedPlatforms(), scheduled_for_date: this.scheduleDate || undefined }),
      });
      if (r.ok) {
        this.toast = { msg: 'Image generating! Check Review when ready.', jobId: r.job_id, type: 'ok' };
        this.topic = '';
      } else {
        this.toast = { msg: `Error: ${r.error || 'Request failed'}`, type: 'err' };
      }
    } catch (e: any) { this.toast = { msg: `Error: ${e.message}`, type: 'err' }; }
    this.loading = false;
  }

  private async _doCaptionPost() {
    this.loading = true; this.toast = null;
    try {
      const r = await this._api('/api/studio/generate-text', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: this.topic, pillar: this.pillar,
          platforms: this._selectedPlatforms(), scheduled_for_date: this.scheduleDate || undefined }),
      });
      if (r.ok) {
        this.toast = { msg: 'Captions generating! Check Review when ready.', jobId: r.job_id, type: 'ok' };
        this.topic = '';
      } else {
        this.toast = { msg: `Error: ${r.error || 'Request failed'}`, type: 'err' };
      }
    } catch (e: any) { this.toast = { msg: `Error: ${e.message}`, type: 'err' }; }
    this.loading = false;
  }

  private _renderSlideVideo() {
    return html`
      <div class="field"><label>Topic</label>
        <textarea .value=${this.topic} @input=${(e: Event) => this.topic = (e.target as HTMLTextAreaElement).value}
          placeholder="What should this video explain? e.g. 'How to create a morning routine that burns fat'"></textarea></div>
      <div class="field"><label>Or upload slides (PDF, HTML, images)</label>
        <div class="drop-zone" id="sdz"
          @dragover=${(e: DragEvent) => { e.preventDefault(); this.shadowRoot?.querySelector('#sdz')?.classList.add('over'); }}
          @dragleave=${() => this.shadowRoot?.querySelector('#sdz')?.classList.remove('over')}
          @drop=${(e: DragEvent) => { e.preventDefault(); this.shadowRoot?.querySelector('#sdz')?.classList.remove('over');
            if (e.dataTransfer?.files[0]) {this.slideFile = e.dataTransfer.files[0];} }}
          @click=${() => this.shadowRoot?.querySelector<HTMLInputElement>('#slide-in')?.click()}>
          ${this.slideFile
            ? html`<div class="file-info">${this.slideFile.name} (${(this.slideFile.size/1048576).toFixed(1)} MB)</div>`
            : 'Drop a PDF, HTML, or images here — or enter a topic above to generate'}
          <input type="file" id="slide-in" accept=".pdf,.html,.htm,.png,.jpg,.jpeg"
            @change=${(e: Event) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) {this.slideFile = f;} }} />
        </div></div>
      <div class="field"><label>Format</label>
        <select .value=${this.slideFormat} @change=${(e: Event) => this.slideFormat = (e.target as HTMLSelectElement).value}>
          <option value="16:9">Landscape (16:9) — YouTube</option>
          <option value="9:16">Portrait (9:16) — Reels / TikTok</option>
        </select></div>
      <div class="actions">
        <button class="btn btn-primary" ?disabled=${(!this.topic.trim() && !this.slideFile) || this.loading}
          @click=${this._doSlideVideo}>${this.loading ? 'Creating...' : 'Create Slide Video'}</button>
      </div>
      <div class="side-label">${this.slideFile ? 'Slides will be extracted from your upload.' : 'The copywriter will generate branded slides and a voiceover script.'}</div>
    `;
  }

  private async _doSlideVideo() {
    this.loading = true; this.toast = null;
    try {
      if (this.slideFile) {
        const form = new FormData();
        form.append('slides', this.slideFile);
        form.append('topic', this.topic);
        form.append('format', this.slideFormat);
        form.append('pillar', this.pillar);
        form.append('platforms', JSON.stringify(this._selectedPlatforms()));
        const resp = await fetch('/api/studio/slide-video', { method: 'POST', credentials: 'same-origin', body: form });
        const r = await resp.json();
        if (r.ok) {
          this.toast = { msg: 'Slide video created! Processing slides.', jobId: r.job_id, type: 'ok' };
          this.slideFile = null; this.topic = '';
        } else { this.toast = { msg: `Error: ${r.error}`, type: 'err' }; }
      } else {
        const r = await this._api('/api/studio/slide-video', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ topic: this.topic, format: this.slideFormat, pillar: this.pillar,
            platforms: this._selectedPlatforms() }),
        });
        if (r.ok) {
          this.toast = { msg: 'Generating slides from topic! Copywriter is working.', jobId: r.job_id, type: 'ok' };
          this.topic = '';
        } else { this.toast = { msg: `Error: ${r.error}`, type: 'err' }; }
      }
    } catch (e: any) { this.toast = { msg: `Error: ${e.message}`, type: 'err' }; }
    this.loading = false;
  }

  private _openCinematic() {
    this.dispatchEvent(new CustomEvent('open-cinematic', { bubbles: true, composed: true }));
  }

  private _goToReview(jobId: string) {
    this.dispatchEvent(new CustomEvent('navigate-tab', {
      bubbles: true, composed: true, detail: { tab: 'review', jobId },
    }));
  }

  private _selectedPlatforms(): string[] {
    return Object.entries(this.platforms).filter(([, v]) => v).map(([k]) => k);
  }

  private _formatDate(iso: string) {
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }

  private _dz() { return this.shadowRoot?.querySelector('#dz') as HTMLElement | null; }
}
