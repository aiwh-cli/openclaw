/**
 * settings-provider-picker — Provider configuration for all 7 slots.
 *
 * Dropdown per slot (video, image, avatar, tts, storage, notify, compositor).
 * Config fields per provider. Compositor template customization.
 * Saves to cinematic-providers.json and remotion-templates.json.
 */
import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';

const SLOT_INFO: Record<string, { label: string; options: string[] }> = {
  video: { label: 'Video Generation', options: ['veo', 'runway', 'kling', 'pika'] },
  image: { label: 'Image Generation', options: ['imagen', 'stability', 'dalle', 'flux'] },
  avatar: { label: 'Avatar / Presenter', options: ['heygen', 'd-id', 'synthesia'] },
  tts: { label: 'Text-to-Speech', options: ['elevenlabs', 'google-tts', 'playht', 'xtts'] },
  storage: { label: 'Media Storage', options: ['gdrive', 'onedrive', 'r2', 's3', 'local'] },
  notify: { label: 'Notifications', options: ['discord', 'slack', 'telegram', 'email'] },
  compositor: { label: 'Video Compositor', options: ['ffmpeg', 'remotion'] },
};
const PROV_LABELS: Record<string, string> = {
  veo: 'Google Veo', runway: 'Runway Gen-3', kling: 'Kling AI', pika: 'Pika Labs',
  imagen: 'Google Imagen', stability: 'Stability AI', dalle: 'OpenAI DALL-E', flux: 'Flux',
  heygen: 'HeyGen', 'd-id': 'D-ID', synthesia: 'Synthesia',
  elevenlabs: 'ElevenLabs', 'google-tts': 'Google TTS', playht: 'Play.ht', xtts: 'XTTS (Local)',
  gdrive: 'Google Drive', onedrive: 'OneDrive', r2: 'Cloudflare R2', s3: 'AWS S3', local: 'Local Storage',
  discord: 'Discord', slack: 'Slack', telegram: 'Telegram', email: 'Email',
  ffmpeg: 'FFmpeg (Default)', remotion: 'Remotion (React)',
};
const VERTEX_PROVIDERS = new Set(['veo', 'imagen']);

@customElement('settings-provider-picker')
export class SettingsProviderPicker extends LitElement {
  @state() private providers: Record<string, { provider: string; config: Record<string, any> }> = {};
  @state() private templates: any = null;
  @state() private loading = true;
  @state() private msg = '';
  @state() private saving = false;
  @state() private vertexOk: boolean | null = null;

  connectedCallback() { super.connectedCallback(); this._load(); }

  private async _load() {
    this.loading = true;
    try {
      const [prov, tmpl] = await Promise.all([
        this._api('/api/social-hub/settings/providers'),
        this._api('/api/studio/templates'),
      ]);
      this.providers = prov || {};
      this.templates = tmpl;
      // Check if any provider uses Vertex AI
      const usesVertex = Object.values(this.providers).some((p: any) => VERTEX_PROVIDERS.has(p?.provider));
      if (usesVertex) {
        try { const h = await this._api('/api/social-hub/settings/vertex-health'); this.vertexOk = h.ok === true; }
        catch { this.vertexOk = false; }
      }
    } catch (e: any) { this.msg = 'Failed to load providers'; console.error('[provider-picker]', e); }
    this.loading = false;
  }

  private async _api(url: string, opts?: RequestInit) {
    const r = await fetch(url, { credentials: 'same-origin', ...opts });
    return r.ok ? r.json() : {};
  }

  static styles = css`
    :host { display: block; }
    .card { background: var(--surface); border: 1px solid var(--border-dim); border-radius: 12px;
      padding: 16px; margin-bottom: 14px; }
    .card-title { font-size: 14px; font-weight: 600; margin-bottom: 12px; }
    .slot { display: flex; align-items: center; gap: 12px; padding: 10px 0;
      border-bottom: 1px solid var(--border-faint); }
    .slot:last-child { border-bottom: none; }
    .slot-label { font-size: 12px; font-weight: 600; min-width: 140px; }
    .slot-select { flex: 1; }
    select { width: 100%; padding: 6px 10px; background: var(--surface-hi); color: var(--text-primary);
      border: 1px solid var(--border-dim); border-radius: 6px; font-size: 12px; }
    .config-row { margin-top: 4px; }
    .config-row input { width: 100%; padding: 5px 8px; background: var(--surface-hi);
      color: var(--text-primary); border: 1px solid var(--border-dim); border-radius: 6px;
      font-size: 11px; box-sizing: border-box; }
    .config-label { font-size: 10px; color: var(--text-muted); margin-bottom: 2px; }
    .vertex-status { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--text-muted); margin-top: 6px; flex-wrap: wrap; }
    .vertex-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    .vertex-dot.ok { background: var(--success, #4ade80); }
    .vertex-dot.err { background: var(--critical, #ef4444); }
    .vertex-dot.loading { background: var(--text-dim); }
    .vertex-help { width: 100%; margin-top: 4px; padding: 8px 10px; background: rgba(var(--critical-rgb, 224,82,82),0.08);
      border-radius: 6px; font-size: 11px; line-height: 1.6; color: var(--text-primary); }
    .vertex-help code { background: var(--surface-hi); padding: 1px 5px; border-radius: 3px; font-size: 10px; }
    .vertex-help a { color: var(--magenta); text-decoration: none; }
    .vertex-help a:hover { text-decoration: underline; }
    .remotion-config { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border-dim); }
    .field { margin-bottom: 10px; }
    .field label { display: block; font-size: 11px; font-weight: 600; color: var(--text-muted);
      text-transform: uppercase; margin-bottom: 3px; }
    input[type="text"], input[type="color"], textarea { width: 100%; padding: 6px 10px;
      background: var(--surface-hi); color: var(--text-primary); border: 1px solid var(--border-dim);
      border-radius: 6px; font-size: 12px; box-sizing: border-box; font-family: inherit; }
    textarea { min-height: 40px; resize: vertical; }
    .color-row { display: flex; gap: 8px; flex-wrap: wrap; }
    .color-swatch { width: 32px; height: 32px; border-radius: 6px; cursor: pointer; border: 2px solid var(--border-dim); }
    .trans-btns { display: flex; gap: 6px; flex-wrap: wrap; }
    .trans-btn { padding: 5px 12px; border: 1px solid var(--border-dim); border-radius: 6px;
      cursor: pointer; font-size: 11px; background: var(--surface-hi); color: var(--text-primary); }
    .trans-btn.active { background: var(--magenta); color: var(--void); border-color: var(--magenta); }
    .btn { padding: 8px 16px; border-radius: 8px; font-weight: 600; font-size: 12px; cursor: pointer; border: none; }
    .btn-primary { background: var(--magenta); color: var(--void); }
    .btn-primary:disabled { opacity: 0.5; }
    .msg { font-size: 11px; margin-top: 6px; color: var(--success); }
    .msg.err { color: var(--critical); }
    .compositor-note { font-size: 11px; color: var(--text-muted); margin-top: 4px; }
    :host-context([data-theme="light"]) .btn-primary { color: #fff; }
    :host-context([data-theme="light"]) .trans-btn.active { color: #fff; }
  `;

  render() {
    if (this.loading) {return html`<div style="padding:20px;color:var(--text-muted)">Loading providers...</div>`;}

    const isRemotion = this.providers.compositor?.provider === 'remotion';

    return html`
      <div class="card"><div class="card-title">Content Providers</div>
        ${Object.entries(SLOT_INFO).map(([slot, info]) => this._renderSlot(slot, info))}
      </div>

      ${isRemotion ? this._renderRemotionConfig() : nothing}

      <button class="btn btn-primary" ?disabled=${this.saving} @click=${this._save}>
        ${this.saving ? 'Saving...' : 'Save Providers'}</button>
      ${this.msg ? html`<div class="msg ${this.msg.startsWith('Error') ? 'err' : ''}">${this.msg}</div>` : nothing}
    `;
  }

  private _renderSlot(slot: string, info: { label: string; options: string[] }) {
    const current = this.providers[slot] || { provider: '', config: {} };
    return html`
      <div class="slot">
        <div class="slot-label">${info.label}</div>
        <div class="slot-select">
          <select .value=${current.provider || ''}
            @change=${(e: Event) => {
              this.providers = { ...this.providers, [slot]: { ...current, provider: (e.target as HTMLSelectElement).value } };
            }}>
            <option value="">None</option>
            ${info.options.map(o => html`<option value=${o} ?selected=${current.provider === o}>${PROV_LABELS[o] || o}</option>`)}
          </select>
          ${current.config?.model ? html`
            <div class="config-row">
              <div class="config-label">Model</div>
              <input type="text" .value=${current.config.model || ''}
                @input=${(e: Event) => {
                  this.providers = { ...this.providers, [slot]: { ...current, config: { ...current.config, model: (e.target as HTMLInputElement).value } } };
                }} />
            </div>` : nothing}
          ${VERTEX_PROVIDERS.has(current.provider) ? html`
            <div class="vertex-status">
              <span class="vertex-dot ${this.vertexOk === true ? 'ok' : this.vertexOk === false ? 'err' : 'loading'}"></span>
              <span>Google Vertex AI ${this.vertexOk === true ? '— Connected' : this.vertexOk === false ? '— Disconnected' : ''}</span>
              ${this.vertexOk === false ? html`
                <div class="vertex-help">
                  Google Vertex OAuth needs refreshing. Open a terminal and run: <code>gcloud auth login</code><br>
                  <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener">Google Cloud Console</a> |
                  <a href="https://cloud.google.com/sdk/gcloud/reference/auth/login" target="_blank" rel="noopener">gcloud auth docs</a>
                </div>` : nothing}
            </div>` : nothing}
        </div>
      </div>`;
  }

  private _renderRemotionConfig() {
    const brand = this.templates?.templates?.[0]?.clientBrand || {};
    const colors = brand.colors || ['#1a1a2e', '#16213e', '#0f3460', '#e94560'];
    const transStyles = this.templates?.transition_styles || ['crossfade', 'slide', 'fade-black', 'cut'];
    const currentTrans = brand.transition_style || 'crossfade';

    return html`
      <div class="card">
        <div class="card-title">Remotion Compositor Settings</div>
        <div class="compositor-note">Customize your video composition template. Brand colors, intro/outro, transitions.</div>

        <div class="field" style="margin-top:12px"><label>Brand Colors</label>
          <div class="color-row">
            ${colors.map((c: string, i: number) => html`
              <input type="color" .value=${c} style="width:40px;height:32px;padding:2px;cursor:pointer"
                @change=${(e: Event) => {
                  const newColors = [...colors];
                  newColors[i] = (e.target as HTMLInputElement).value;
                  this._updateBrand('colors', newColors);
                }} />`)}
          </div>
        </div>

        <div class="field"><label>Font</label>
          <input type="text" .value=${brand.font || 'Inter'} placeholder="Inter"
            @input=${(e: Event) => this._updateBrand('font', (e.target as HTMLInputElement).value)} /></div>

        <div class="field"><label>Intro Text</label>
          <input type="text" .value=${brand.introText || ''} placeholder="Your brand intro..."
            @input=${(e: Event) => this._updateBrand('introText', (e.target as HTMLInputElement).value)} /></div>

        <div class="field"><label>Outro Text</label>
          <input type="text" .value=${brand.outroText || ''} placeholder="Call to action..."
            @input=${(e: Event) => this._updateBrand('outroText', (e.target as HTMLInputElement).value)} /></div>

        <div class="field"><label>Transition Style</label>
          <div class="trans-btns">
            ${transStyles.map((t: string) => html`
              <div class="trans-btn ${currentTrans === t ? 'active' : ''}"
                @click=${() => this._updateBrand('transition_style', t)}>${t}</div>`)}
          </div>
        </div>
      </div>`;
  }

  private _updateBrand(key: string, value: any) {
    // Store brand updates locally, saved on "Save Providers" click
    if (!this.templates) {this.templates = { templates: [{ clientBrand: {} }] };}
    if (!this.templates.templates?.[0]) {this.templates.templates = [{ clientBrand: {} }];}
    this.templates.templates[0].clientBrand = {
      ...this.templates.templates[0].clientBrand,
      [key]: value,
    };
    this.requestUpdate();
  }

  private async _save() {
    this.saving = true; this.msg = '';
    try {
      // Save providers
      const r = await this._api('/api/social-hub/settings/providers', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.providers) });
      if (r.error) { this.msg = `Error: ${r.error}`; this.saving = false; return; }

      // Save Remotion brand config if applicable
      if (this.providers.compositor?.provider === 'remotion') {
        const brand = this.templates?.templates?.[0]?.clientBrand || {};
        await this._api('/api/social-hub/settings/remotion-templates', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ brand }) });
      }
      this.msg = 'Saved!';
    } catch (e: any) { this.msg = `Error: ${e.message}`; }
    this.saving = false;
  }
}
