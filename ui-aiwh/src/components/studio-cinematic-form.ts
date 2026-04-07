/**
 * studio-cinematic-form — Full cinematic video creation form.
 *
 * Migrated from production-create.js. Handles: title, brief, duration,
 * format picker, avatar carousel (format-filtered), voice selector
 * with preview, caption controls, BGM upload+volume, reference files,
 * and auto-approve thresholds per asset type.
 */
import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';

interface Avatar { id: string; name: string; pillar: string; photo_url: string; avatar_look_id: string; resolution: string; }
interface Voice { name: string; voice_id: string; gender: string; accent?: string; description?: string; }

@customElement('studio-cinematic-form')
export class StudioCinematicForm extends LitElement {
  @state() private title = '';
  @state() private brief = '';
  @state() private duration = 120;
  @state() private format: '9:16' | '16:9' | '1:1' = '16:9';
  @state() private avatars: Avatar[] = [];
  @state() private voices: Voice[] = [];
  @state() private selectedAvatar = 'none';
  @state() private selectedVoice = '';
  @state() private captionsEnabled = false;
  @state() private captionPos: 'bottom' | 'center' | 'top' = 'bottom';
  @state() private captionStyle: 'clean' | 'bold' | 'minimal' = 'clean';
  @state() private bgmFile: File | null = null;
  @state() private bgmVolume = 30;
  @state() private refFiles: File[] = [];
  @state() private autoApprove = { refs: false, keyframes: false, clips: false };
  @state() private aaThreshold = { refs: 4.0, keyframes: 4.0, clips: 4.0 };
  @state() private creating = false;
  @state() private msg = '';
  @state() private scheduleDate = '';
  @state() private platforms: Record<string, boolean> = { instagram: true, x: true };
  @state() private showAvatarMgr = false;

  connectedCallback() { super.connectedCallback(); this._loadConfig(); }

  private async _loadConfig() {
    try {
      const [av, vo] = await Promise.all([
        this._api('/api/cinematic/avatar-config'),
        this._api('/api/cinematic/voice-config'),
      ]);
      // API returns { pillars: { id: {...} } } — map to flat array
      const avatarData = av?.pillars || av?.avatars || {};
      this.avatars = Object.entries(avatarData).map(([id, a]: [string, any]) => ({
        id, name: a.display_name || a.name || id, pillar: a.pillar || id,
        photo_url: a.photo_url || '', avatar_look_id: a.avatar_look_id || '',
        resolution: a.resolution || '16:9',
      }));
      if (vo?.voices) { this.voices = vo.voices; if (vo.voices[0]) {this.selectedVoice = vo.voices[0].voice_id;} }
    } catch (e: any) { this.msg = 'Failed to load config'; console.error('[cinematic-form]', e); }
  }

  private async _api(url: string, opts?: RequestInit) {
    const r = await fetch(url, { credentials: 'same-origin', ...opts });
    return r.ok ? r.json() : {};
  }

  static styles = css`
    :host { display: block; }
    .back { font-size: 13px; color: var(--magenta); cursor: pointer; margin-bottom: 14px; display: inline-block; }
    .back:hover { text-decoration: underline; }
    h3 { margin: 0 0 20px; font-size: 18px; font-weight: 600; }
    .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    @media (max-width: 800px) { .two-col { grid-template-columns: 1fr; } }
    .section { background: var(--surface); border: 1px solid var(--border-dim); border-radius: 12px;
      padding: 18px; margin-bottom: 18px; }
    .section-title { font-size: 13px; font-weight: 600; margin-bottom: 14px; color: var(--text-primary);
      padding-bottom: 8px; border-bottom: 1px solid var(--border-faint); }
    .field { margin-bottom: 16px; }
    .field label { display: block; font-size: 12px; font-weight: 600; color: var(--text-muted);
      text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
    input, textarea, select { width: 100%; padding: 10px 14px; background: var(--surface-hi);
      color: var(--text-primary); border: 1px solid var(--border-dim); border-radius: 8px;
      font-size: 14px; box-sizing: border-box; font-family: inherit; }
    textarea { resize: vertical; min-height: 120px; }
    .formats { display: flex; gap: 10px; }
    .fmt-btn { padding: 12px 20px; border: 1px solid var(--border-dim); border-radius: 10px;
      cursor: pointer; font-size: 13px; font-weight: 600; background: var(--surface-hi); color: var(--text-primary);
      transition: all 150ms; }
    .fmt-btn:hover { border-color: var(--magenta); }
    .fmt-btn.active { background: var(--magenta); color: var(--void); border-color: var(--magenta); }
    .avatars { display: flex; gap: 12px; overflow-x: auto; padding: 10px 0; }
    .avatar-card { min-width: 90px; text-align: center; cursor: pointer; padding: 10px;
      border: 2px solid transparent; border-radius: 12px; font-size: 12px; transition: all 150ms; }
    .avatar-card:hover { border-color: var(--border-dim); background: var(--surface-hi); }
    .avatar-card.sel { border-color: var(--magenta); background: rgba(var(--magenta-rgb),0.06); }
    .avatar-card img { width: 64px; height: 64px; border-radius: 50%; object-fit: cover; }
    .avatar-card .name { margin-top: 6px; font-weight: 600; }
    .voices { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; }
    .voice-card { padding: 12px 16px; border: 1px solid var(--border-dim); border-radius: 10px;
      cursor: pointer; font-size: 13px; transition: all 150ms; }
    .voice-card:hover { border-color: var(--magenta); }
    .voice-card.sel { border-color: var(--magenta); background: rgba(var(--magenta-rgb),0.06); }
    .voice-name { font-weight: 600; }
    .voice-meta { font-size: 11px; color: var(--text-muted); margin-top: 2px; }
    .caption-controls { background: var(--surface-hi); border-radius: 10px; padding: 14px; margin-top: 10px; }
    .caption-row { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
    .caption-row:last-child { margin-bottom: 0; }
    .caption-label { font-size: 12px; font-weight: 600; color: var(--text-muted); min-width: 70px; }
    .caption-opts { display: flex; gap: 8px; flex: 1; }
    .cap-btn { padding: 8px 16px; border: 1px solid var(--border-dim); border-radius: 8px;
      cursor: pointer; font-size: 12px; font-weight: 500; background: var(--surface); color: var(--text-primary);
      transition: all 150ms; }
    .cap-btn:hover { border-color: var(--magenta); }
    .cap-btn.active { background: var(--magenta); color: var(--void); border-color: var(--magenta); }
    .range-row { display: flex; align-items: center; gap: 12px; font-size: 13px; }
    .range-row input[type="range"] { flex: 1; width: auto; accent-color: var(--magenta); }
    .range-val { font-weight: 600; color: var(--magenta); min-width: 40px; text-align: right; }
    .aa-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
    .aa-card { background: var(--surface-hi); border: 1px solid var(--border-dim); border-radius: 10px;
      padding: 14px; }
    .aa-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .aa-header label { font-size: 13px; font-weight: 600; text-transform: none; letter-spacing: 0; cursor: pointer;
      display: flex; align-items: center; gap: 6px; }
    .aa-slider { margin-top: 6px; }
    .ref-zone { border: 2px dashed var(--border-dim); border-radius: 12px; padding: 24px;
      text-align: center; font-size: 13px; color: var(--text-muted); cursor: pointer; transition: all 200ms; }
    .ref-zone:hover { border-color: var(--magenta); }
    .ref-list { font-size: 12px; color: var(--text-muted); margin-top: 8px; }
    .btn { padding: 14px 28px; border-radius: 10px; font-weight: 600; font-size: 14px;
      cursor: pointer; border: none; }
    .btn-primary { background: var(--magenta); color: var(--void); }
    .btn-primary:hover { filter: brightness(1.1); }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-link { background: none; border: none; color: var(--magenta); cursor: pointer;
      font-size: 12px; padding: 4px 0; }
    .btn-link:hover { text-decoration: underline; }
    .msg { font-size: 13px; margin-top: 14px; padding: 10px 14px; border-radius: 8px; }
    .msg.ok { color: var(--success); background: rgba(var(--success-rgb, 34,197,94), 0.08); }
    .msg.err { color: var(--critical); background: rgba(var(--critical-rgb), 0.08); }
    :host-context([data-theme="light"]) .btn-primary { color: #fff; }
    :host-context([data-theme="light"]) .fmt-btn.active, :host-context([data-theme="light"]) .cap-btn.active { color: #fff; }
  `;

  render() {
    if (this.showAvatarMgr) {return html`<studio-avatar-voice @back=${() => this.showAvatarMgr = false}></studio-avatar-voice>`;}

    const filteredAvatars = this.avatars.filter(a => a.resolution === this.format || !a.resolution);

    return html`
      <div class="back" @click=${this._goBack}>\u2190 Back to Studio</div>
      <h3>Create Cinematic Video</h3>

      <div class="section">
        <div class="section-title">Video Details</div>
        <div class="two-col">
          <div>
            <div class="field"><label>Title</label>
              <input type="text" .value=${this.title} @input=${(e: Event) => this.title = (e.target as HTMLInputElement).value}
                placeholder="Video title" /></div>
            <div class="field"><label>Creative Brief</label>
              <textarea .value=${this.brief} @input=${(e: Event) => this.brief = (e.target as HTMLTextAreaElement).value}
                placeholder="Describe the video concept, mood, and key messages..."></textarea></div>
          </div>
          <div>
            <div class="field"><label>Duration</label>
              <div class="range-row">
                <input type="range" min="30" max="300" step="10" .value=${String(this.duration)}
                  @input=${(e: Event) => this.duration = Number((e.target as HTMLInputElement).value)} />
                <span class="range-val">${this.duration}s</span>
              </div></div>
            <div class="field"><label>Output Format</label>
              <div class="formats">
                ${(['9:16', '16:9', '1:1'] as const).map(f => html`
                  <div class="fmt-btn ${this.format === f ? 'active' : ''}"
                       @click=${() => { this.format = f; this.selectedAvatar = 'none'; }}>
                    ${f === '9:16' ? 'Reel 9:16' : f === '16:9' ? 'YouTube 16:9' : 'Square 1:1'}
                  </div>`)}
              </div></div>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Presenter & Voice</div>
        <div class="field"><label>Avatar ${filteredAvatars.length ? `(${filteredAvatars.length} available for ${this.format})` : '(none for this format)'}</label>
          <div class="avatars">
            <div class="avatar-card ${this.selectedAvatar === 'none' ? 'sel' : ''}"
                 @click=${() => this.selectedAvatar = 'none'}>
              <div style="width:64px;height:64px;border-radius:50%;background:var(--surface-hi);display:flex;align-items:center;justify-content:center;font-size:24px;color:var(--text-dim)">--</div>
              <div class="name">No Avatar</div>
            </div>
            ${filteredAvatars.map(a => html`
              <div class="avatar-card ${this.selectedAvatar === a.id ? 'sel' : ''}"
                   @click=${() => this.selectedAvatar = a.id}>
                <img src=${a.photo_url || ''} alt=${a.name}
                     @error=${(e: Event) => (e.target as HTMLImageElement).style.display = 'none'} />
                <div class="name">${a.name}</div>
              </div>`)}
          </div>
          <button class="btn-link" @click=${() => this.showAvatarMgr = true}>Manage Avatars & Voices</button>
        </div>

        <div class="field"><label>Narrator Voice</label>
          <div class="voices">
            ${this.voices.map(v => html`
              <div class="voice-card ${this.selectedVoice === v.voice_id ? 'sel' : ''}"
                   @click=${() => this.selectedVoice = v.voice_id}>
                <div class="voice-name">${v.name}</div>
                <div class="voice-meta">${v.gender || ''} ${v.accent ? `\u00B7 ${v.accent}` : ''}</div>
              </div>`)}
          </div></div>
      </div>

      <div class="two-col">
        <div class="section">
          <div class="section-title">Captions</div>
          <label style="display:flex;align-items:center;gap:8px;font-size:14px;cursor:pointer;margin-bottom:12px">
            <input type="checkbox" .checked=${this.captionsEnabled}
              @change=${(e: Event) => this.captionsEnabled = (e.target as HTMLInputElement).checked} />
            Enable captions on video
          </label>
          ${this.captionsEnabled ? html`
            <div class="caption-controls">
              <div class="caption-row">
                <span class="caption-label">Position</span>
                <div class="caption-opts">
                  ${(['bottom', 'center', 'top'] as const).map(p => html`
                    <div class="cap-btn ${this.captionPos === p ? 'active' : ''}" @click=${() => this.captionPos = p}>${p}</div>`)}
                </div>
              </div>
              <div class="caption-row">
                <span class="caption-label">Style</span>
                <div class="caption-opts">
                  ${(['clean', 'bold', 'minimal'] as const).map(s => html`
                    <div class="cap-btn ${this.captionStyle === s ? 'active' : ''}" @click=${() => this.captionStyle = s}>${s}</div>`)}
                </div>
              </div>
            </div>` : nothing}
        </div>

        <div class="section">
          <div class="section-title">Background Music</div>
          <input type="file" accept="audio/*" @change=${(e: Event) => {
            this.bgmFile = (e.target as HTMLInputElement).files?.[0] || null; }} />
          ${this.bgmFile ? html`
            <div class="range-row" style="margin-top:12px">
              <span>Volume</span>
              <input type="range" min="5" max="100" .value=${String(this.bgmVolume)}
                @input=${(e: Event) => this.bgmVolume = Number((e.target as HTMLInputElement).value)} />
              <span class="range-val">${this.bgmVolume}%</span>
            </div>` : nothing}
        </div>
      </div>

      <div class="two-col">
        <div class="section">
          <div class="section-title">Reference Files</div>
          <div class="ref-zone" @click=${() => this.shadowRoot?.querySelector<HTMLInputElement>('#ref-in')?.click()}>
            ${this.refFiles.length ? `${this.refFiles.length} file(s) selected` : 'Click to add reference images or videos (up to 10)'}
            <input type="file" id="ref-in" multiple accept="image/*,video/*" style="display:none"
              @change=${(e: Event) => {
                const files = Array.from((e.target as HTMLInputElement).files || []);
                const seen = new Set(this.refFiles.map(f => f.name));
                this.refFiles = [...this.refFiles, ...files.filter(f => !seen.has(f.name))].slice(0, 10);
              }} />
          </div>
          ${this.refFiles.length ? html`<div class="ref-list">${this.refFiles.map(f => f.name).join(', ')}</div>` : nothing}
        </div>

        <div class="section">
          <div class="section-title">Auto-Approval</div>
          <div class="aa-grid">
            ${this._renderAA('refs', 'Reference Images')}
            ${this._renderAA('keyframes', 'Keyframes')}
            ${this._renderAA('clips', 'Video Clips')}
          </div>
        </div>
      </div>

      <div class="section"><div class="section-title">Publishing</div>
        <div class="field"><label>Target Platforms</label>
          <div style="display:flex;gap:10px;font-size:12px">
            ${['instagram', 'x', 'linkedin', 'tiktok'].map(p => html`
              <label style="display:flex;align-items:center;gap:4px;cursor:pointer">
                <input type="checkbox" .checked=${this.platforms[p] || false}
                  @change=${(e: Event) => { this.platforms = { ...this.platforms, [p]: (e.target as HTMLInputElement).checked }; }} />
                ${{ instagram: 'Instagram', x: 'X', linkedin: 'LinkedIn', tiktok: 'TikTok' }[p]}</label>`)}
          </div>
        </div>
        <div class="field"><label>Schedule Date (optional)</label>
          <input type="date" .value=${this.scheduleDate}
            @input=${(e: Event) => this.scheduleDate = (e.target as HTMLInputElement).value} />
        </div>
      </div>

      <button class="btn btn-primary" ?disabled=${!this.title.trim() || !this.brief.trim() || this.creating}
        @click=${this._create}>${this.creating ? 'Creating & Analyzing...' : 'Create & Analyze'}</button>
      ${this.msg ? html`<div class="msg ${this.msg.startsWith('Error') ? 'err' : 'ok'}">${this.msg}</div>` : nothing}
    `;
  }

  private _renderAA(key: 'refs' | 'keyframes' | 'clips', label: string) {
    return html`<div class="aa-card">
      <div class="aa-header">
        <label><input type="checkbox" .checked=${this.autoApprove[key]}
          @change=${(e: Event) => { this.autoApprove = { ...this.autoApprove, [key]: (e.target as HTMLInputElement).checked }; }} />
          ${label}</label>
      </div>
      ${this.autoApprove[key] ? html`
        <div class="aa-slider">
          <div class="range-row">
            <span style="font-size:11px;color:var(--text-muted)">Threshold</span>
            <input type="range" min="2" max="5" step="0.5" .value=${String(this.aaThreshold[key])}
              @input=${(e: Event) => { this.aaThreshold = { ...this.aaThreshold, [key]: Number((e.target as HTMLInputElement).value) }; }} />
            <span class="range-val">${this.aaThreshold[key]}</span>
          </div>
        </div>` : nothing}
    </div>`;
  }

  private async _create() {
    this.creating = true; this.msg = '';
    const form = new FormData();
    form.append('title', this.title);
    form.append('brief', this.brief);
    form.append('duration', String(this.duration));
    form.append('output_format', this.format);
    const avatar = this.avatars.find(a => a.id === this.selectedAvatar);
    form.append('avatar_look_id', avatar?.avatar_look_id || this.selectedAvatar);
    form.append('no_avatar', this.selectedAvatar === 'none' ? 'true' : 'false');
    form.append('voice_id', this.selectedVoice);
    form.append('captions_enabled', this.captionsEnabled ? '1' : '0');
    form.append('caption_position', this.captionPos);
    form.append('caption_style', this.captionStyle);
    if (this.bgmFile) { form.append('bgm', this.bgmFile); form.append('bgm_volume', String(this.bgmVolume / 100)); }
    const aa = this.autoApprove;
    const thr = this.aaThreshold;
    form.append('auto_approve_refs', aa.refs ? '1' : '0');
    form.append('auto_approve_keyframes', aa.keyframes ? '1' : '0');
    form.append('auto_approve_clips', aa.clips ? '1' : '0');
    form.append('autonomy_threshold', String(Math.min(
      aa.refs ? thr.refs : 5, aa.keyframes ? thr.keyframes : 5, aa.clips ? thr.clips : 5)));
    for (const f of this.refFiles) {form.append('refs', f);}
    const selPlats = Object.entries(this.platforms).filter(([, v]) => v).map(([k]) => k);
    form.append('platform_targets', JSON.stringify(selPlats));
    if (this.scheduleDate) {form.append('scheduled_for_date', this.scheduleDate);}

    try {
      const r = await fetch('/api/cinematic/jobs', { method: 'POST', credentials: 'same-origin', body: form });
      const data = await r.json();
      if (data.cjob_id) {
        this.msg = `Created! Job: ${data.cjob_id}. Analysis starting...`;
        this.dispatchEvent(new CustomEvent('navigate-tab', {
          bubbles: true, composed: true,
          detail: { tab: 'pipeline' },
        }));
      } else { this.msg = `Error: ${data.error || 'Unknown error'}`; }
    } catch (e: any) { this.msg = `Error: ${e.message}`; }
    this.creating = false;
  }

  private _goBack() {
    this.dispatchEvent(new CustomEvent('back-to-studio', { bubbles: true, composed: true }));
  }
}
