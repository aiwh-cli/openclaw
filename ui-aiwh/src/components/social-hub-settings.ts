import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import './settings-format-editor.js';

@customElement('social-hub-settings')
export class SocialHubSettings extends LitElement {
  @state() private social: any = null;
  @state() private pipeline: any = null;
  @state() private pillars: any = null;
  @state() private providers: any = null;
  @state() private loading = true;
  @state() private saveMsg = '';
  @state() private section: 'social' | 'pipeline' | 'pillars' | 'providers' | 'formats' = 'social';

  connectedCallback() { super.connectedCallback(); this._load(); }

  private async _load() {
    this.loading = true;
    try {
      const [s, p, pil, prov] = await Promise.all([
        this._api('/api/social/settings'),
        this._api('/api/social-hub/settings/pipeline'),
        this._api('/api/social-hub/settings/pillars'),
        this._api('/api/social-hub/settings/providers'),
      ]);
      this.social = s; this.pipeline = p; this.pillars = pil; this.providers = prov;
    } catch (e) { console.error('[settings]', e); }
    this.loading = false;
  }

  private async _api(url: string, opts?: RequestInit) {
    const res = await fetch(url, { credentials: 'same-origin', ...opts });
    if (!res.ok) {return {};}
    const ct = res.headers.get('content-type') || '';
    return ct.includes('json') ? res.json() : {};
  }

  private async _saveSocial(key: string, value: any) {
    this.saveMsg = '';
    const r = await this._api('/api/social/settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [key]: value }),
    });
    if (r.error) {this.saveMsg = `Error: ${r.error}`;}
    else { if (r.social) {this.social = r.social;} this.saveMsg = 'Saved!'; setTimeout(() => { this.saveMsg = ''; }, 2000); }
  }

  private async _savePipeline(data: any) {
    this.saveMsg = '';
    const r = await this._api('/api/social-hub/settings/pipeline', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    });
    if (r.error) {this.saveMsg = `Error: ${r.error}`;}
    else { if (r.pipeline) {this.pipeline = r.pipeline;} this.saveMsg = 'Saved!'; setTimeout(() => { this.saveMsg = ''; }, 2000); }
  }

  static styles = css`
    :host { display: block; color: var(--text-primary); font-family: 'Inter', -apple-system, sans-serif; }
    .section-tabs { display: flex; gap: 6px; margin-bottom: 16px; }
    .sec-tab { padding: 5px 12px; border-radius: 6px; font-size: 11px; font-weight: 500; cursor: pointer;
      border: 1px solid var(--border-dim); background: var(--surface); color: var(--text-muted); }
    .sec-tab.active { border-color: var(--magenta); color: var(--magenta); background: var(--magenta-dim); }
    .card { background: var(--surface); border: 1px solid var(--border-dim); border-radius: 12px;
      padding: 20px; margin-bottom: 16px; }
    .card-title { font-size: 14px; font-weight: 600; margin-bottom: 12px; }
    .empty { text-align: center; padding: 40px; color: var(--text-muted); font-size: 13px; }
    .row { display: flex; justify-content: space-between; align-items: center; padding: 8px 0;
      border-bottom: 1px solid var(--border-faint); }
    .row:last-child { border-bottom: none; }
    .label { font-size: 12px; font-weight: 500; }
    .tip { font-size: 10px; color: var(--text-dim); margin-top: 2px; }
    .range-row { display: flex; align-items: center; gap: 8px; width: 180px; }
    .range-row input[type=range] { flex: 1; accent-color: var(--magenta); }
    .range-val { font-size: 12px; color: var(--magenta); font-weight: 600; min-width: 30px; text-align: right; }
    input[type=number] { background: var(--surface-hi); color: var(--text-primary); border: 1px solid var(--border-dim);
      border-radius: 6px; padding: 4px 8px; font-size: 12px; width: 70px; }
    select { background: var(--surface-hi); color: var(--text-primary); border: 1px solid var(--border-dim);
      border-radius: 6px; padding: 4px 8px; font-size: 12px; }
    textarea { background: var(--surface-hi); color: var(--text-primary); border: 1px solid var(--border-dim);
      border-radius: 8px; padding: 8px; font-size: 12px; width: 100%; resize: vertical; min-height: 36px;
      font-family: inherit; box-sizing: border-box; }
    label.toggle { position: relative; width: 36px; height: 20px; cursor: pointer; flex-shrink: 0; }
    label.toggle input { opacity: 0; width: 0; height: 0; }
    label.toggle .slider { position: absolute; inset: 0; background: var(--border-dim); border-radius: 10px; transition: 200ms; }
    label.toggle .slider:before { content: ''; position: absolute; width: 16px; height: 16px; left: 2px; bottom: 2px;
      background: var(--text-primary); border-radius: 50%; transition: 200ms; }
    label.toggle input:checked + .slider { background: var(--magenta); }
    label.toggle input:checked + .slider:before { transform: translateX(16px); }
    .save-msg { font-size: 11px; margin-top: 8px; padding: 4px 8px; border-radius: 4px; }
    .save-msg.err { color: var(--critical); background: rgba(224,82,82,0.1); }
    .save-msg.ok { color: var(--success, #4ade80); background: rgba(74,222,128,0.1); }
    .prov-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .prov-table th { text-align: left; font-weight: 600; color: var(--text-muted); padding: 6px 8px; border-bottom: 1px solid var(--border-dim); }
    .prov-table td { padding: 6px 8px; border-bottom: 1px solid var(--border-faint); }
    .pillar-list { display: flex; flex-direction: column; gap: 6px; }
    .pillar-item { padding: 8px 12px; background: var(--surface-hi); border-radius: 6px; font-size: 12px; }
    .pillar-name { font-weight: 600; }
    .pillar-desc { color: var(--text-muted); margin-top: 2px; font-size: 11px; }
  `;

  render() {
    if (this.loading) {return html`<div class="empty">Loading settings...</div>`;}
    return html`
      <div class="section-tabs">
        ${(['social', 'pipeline', 'pillars', 'formats', 'providers'] as const).map(s => html`
          <div class="sec-tab ${this.section === s ? 'active' : ''}" @click=${() => this.section = s}>
            ${{ social: 'Social Policy', pipeline: 'Pipeline', pillars: 'Content Pillars', formats: 'Platform Formats', providers: 'Providers' }[s]}
          </div>`)}
      </div>
      ${this.section === 'social' ? this._renderSocial() : nothing}
      ${this.section === 'pipeline' ? this._renderPipeline() : nothing}
      ${this.section === 'pillars' ? this._renderPillars() : nothing}
      ${this.section === 'formats' ? html`<div class="card"><div class="card-title">Platform Formats</div><settings-format-editor></settings-format-editor></div>` : nothing}
      ${this.section === 'providers' ? this._renderProviders() : nothing}
      ${this.saveMsg ? html`<div class="save-msg ${this.saveMsg.startsWith('Error') ? 'err' : 'ok'}">${this.saveMsg}</div>` : nothing}
    `;
  }

  private _renderSocial() {
    const s = this.social;
    if (!s || !Object.keys(s).length) {return html`<div class="empty">Social settings not configured yet.</div>`;}
    const mix = s.content_mix || { video_reels: 50, text_posts: 30, image_posts: 20 };
    return html`
      <div class="card"><div class="card-title">Publishing</div>
        ${this._toggle('Auto-publish text', s.auto_publish_text, (v: boolean) => this._saveSocial('auto_publish_text', v))}
        ${this._toggle('Auto-publish images', s.auto_publish_images, (v: boolean) => this._saveSocial('auto_publish_images', v))}
        ${this._range('Max posts/day', s.max_posts_per_day, 1, 10, 1, (v: number) => this._saveSocial('max_posts_per_day', v))}
        ${this._range('Autonomy threshold', s.autonomy_threshold, 1, 5, 0.5, (v: number) => this._saveSocial('autonomy_threshold', v))}
      </div>
      <div class="card"><div class="card-title">Content Mix</div>
        ${this._range('Video reels', mix.video_reels, 0, 100, 5, (v: number) => { this.social = { ...this.social, content_mix: { ...mix, video_reels: v } }; })}
        ${this._range('Text posts', mix.text_posts, 0, 100, 5, (v: number) => { this.social = { ...this.social, content_mix: { ...mix, text_posts: v } }; })}
        ${this._range('Image posts', mix.image_posts, 0, 100, 5, (v: number) => { this.social = { ...this.social, content_mix: { ...mix, image_posts: v } }; })}
        <div class="row" style="justify-content:flex-end">
          <button class="sec-tab" style="cursor:pointer" @click=${() => {
            const total = (mix.video_reels||0)+(mix.text_posts||0)+(mix.image_posts||0);
            if (total !== 100) { this.saveMsg = `Mix totals ${total}%, must be 100%`; return; }
            this._saveSocial('content_mix', mix);
          }}>Save Mix</button>
        </div>
      </div>
      <div class="card"><div class="card-title">Captions & Engagement</div>
        ${(this._targetPlatforms).map(plat => html`
          <div class="row" style="flex-direction:column;align-items:stretch;margin-bottom:6px">
            <div class="label">Caption style — ${this._cap(plat)}</div>
            <textarea style="margin-top:4px" .value=${(s.caption_style_per_platform || {})[plat] || s.caption_style || ''}
              @change=${(e: Event) => {
                const perPlat = { ...s.caption_style_per_platform, [plat]: (e.target as HTMLTextAreaElement).value };
                this._saveSocial('caption_style_per_platform', perPlat);
              }}></textarea>
          </div>`)}
        <div class="row" style="flex-direction:column;align-items:stretch;margin-top:8px">
          <div class="label">Reply tone</div>
          <textarea style="margin-top:6px" .value=${s.reply_tone || ''}
            @change=${(e: Event) => this._saveSocial('reply_tone', (e.target as HTMLTextAreaElement).value)}></textarea>
        </div>
      </div>`;
  }

  private _renderPipeline() {
    const p = this.pipeline || {};
    const wc = p.script_word_count || { min: 130, max: 160 };
    const qa = p.qa_thresholds || { min_duration: 50, max_duration: 70, min_file_size_mb: 2 };
    const as = p.auto_approve_samples || { text_post: 15, image_post: 30 };
    const cd = p.cinematic_defaults || {};
    return html`
      <div class="card"><div class="card-title">Script Settings</div>
        ${this._numRow('Min word count', wc.min, (v: number) => this._savePipeline({ script_word_count: { ...wc, min: v } }))}
        ${this._numRow('Max word count', wc.max, (v: number) => this._savePipeline({ script_word_count: { ...wc, max: v } }))}
      </div>
      <div class="card"><div class="card-title">QA Thresholds</div>
        ${this._numRow('Min duration (sec)', qa.min_duration, (v: number) => this._savePipeline({ qa_thresholds: { ...qa, min_duration: v } }))}
        ${this._numRow('Max duration (sec)', qa.max_duration, (v: number) => this._savePipeline({ qa_thresholds: { ...qa, max_duration: v } }))}
        ${this._numRow('Min file size (MB)', qa.min_file_size_mb, (v: number) => this._savePipeline({ qa_thresholds: { ...qa, min_file_size_mb: v } }))}
      </div>
      <div class="card"><div class="card-title">Auto-Approve Samples Required</div>
        ${this._numRow('Text posts', as.text_post, (v: number) => this._savePipeline({ auto_approve_samples: { ...as, text_post: v } }))}
        ${this._numRow('Image posts', as.image_post, (v: number) => this._savePipeline({ auto_approve_samples: { ...as, image_post: v } }))}
      </div>
      <div class="card"><div class="card-title">Cinematic Defaults</div>
        ${this._numRow('Duration (sec)', cd.duration || 120, (v: number) => this._savePipeline({ cinematic_defaults: { ...cd, duration: v } }))}
        <div class="row"><div class="label">Format</div>
          <select .value=${cd.format || '16:9'} @change=${(e: Event) => this._savePipeline({ cinematic_defaults: { ...cd, format: (e.target as HTMLSelectElement).value } })}>
            <option value="16:9">16:9 (YouTube)</option><option value="9:16">9:16 (Reels)</option><option value="1:1">1:1 (Square)</option>
          </select></div>
        ${this._range('BGM volume', cd.bgm_volume ?? 0.3, 0, 1, 0.1, (v: number) => this._savePipeline({ cinematic_defaults: { ...cd, bgm_volume: v } }))}
      </div>`;
  }

  private _renderPillars() {
    return html`<settings-pillars-editor></settings-pillars-editor>`;
  }

  private _renderProviders() {
    return html`<settings-provider-picker></settings-provider-picker>`;
  }

  private get _targetPlatforms(): string[] {
    return this.pillars?.target_platforms || ['instagram', 'x'];
  }
  private _cap(p: string): string {
    const m: Record<string, string> = { instagram: 'Instagram', x: 'X', linkedin: 'LinkedIn', tiktok: 'TikTok', facebook: 'Facebook' };
    return m[p] || p;
  }
  // ─── Helpers ──────────────────────────────────────────────
  private _toggle(label: string, checked: boolean, onChange: (v: boolean) => void) {
    return html`<div class="row"><div class="label">${label}</div>
      <label class="toggle"><input type="checkbox" ?checked=${checked}
        @change=${(e: Event) => onChange((e.target as HTMLInputElement).checked)} /><span class="slider"></span></label>
    </div>`;
  }

  private _range(label: string, value: number, min: number, max: number, step: number, onChange: (v: number) => void) {
    return html`<div class="row"><div class="label">${label}</div>
      <div class="range-row"><input type="range" min=${min} max=${max} step=${step} .value=${String(value)}
        @input=${() => this.requestUpdate()} @change=${(e: Event) => onChange(parseFloat((e.target as HTMLInputElement).value))} />
        <span class="range-val">${value}</span></div>
    </div>`;
  }

  private _numRow(label: string, value: number, onChange: (v: number) => void) {
    return html`<div class="row"><div class="label">${label}</div>
      <input type="number" .value=${String(value)} @change=${(e: Event) => onChange(parseFloat((e.target as HTMLInputElement).value))} />
    </div>`;
  }
}
