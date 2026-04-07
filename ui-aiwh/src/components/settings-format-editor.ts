import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';

const RATIO_OPTIONS = ['9:16', '16:9', '3:4', '4:3', '1:1'];
const CONTENT_TYPES = ['video_reel', 'image_post', 'text_post'] as const;
const CONTENT_LABELS: Record<string, string> = {
  video_reel: 'Video Reel', image_post: 'Image Post', text_post: 'Text Post',
};

@customElement('settings-format-editor')
export class SettingsFormatEditor extends LitElement {
  @state() private formats: Record<string, Record<string, string | null>> = {};
  @state() private defaults: Record<string, Record<string, string | null>> = {};
  @state() private loading = true;
  @state() private saveMsg = '';

  connectedCallback() { super.connectedCallback(); this._load(); }

  private async _load() {
    this.loading = true;
    try {
      const res = await fetch('/api/social-hub/settings/platform-formats', { credentials: 'same-origin' });
      if (res.ok) {
        const data = await res.json();
        this.formats = data.formats || {};
        this.defaults = data.defaults || {};
      }
    } catch (e) { console.error('[format-editor]', e); }
    this.loading = false;
  }

  private _platforms() { return Object.keys(this.formats).length ? Object.keys(this.formats) : Object.keys(this.defaults); }

  private _value(platform: string, ct: string): string | null {
    return this.formats[platform]?.[ct] ?? this.defaults[platform]?.[ct] ?? null;
  }

  private _onChange(platform: string, ct: string, value: string) {
    const updated = { ...this.formats };
    if (!updated[platform]) {updated[platform] = {};}
    updated[platform] = { ...updated[platform], [ct]: value === 'null' ? null : value };
    this.formats = updated;
  }

  private async _save() {
    this.saveMsg = '';
    try {
      const res = await fetch('/api/social-hub/settings/platform-formats', {
        method: 'PUT', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform_formats: this.formats }),
      });
      const data = await res.json();
      if (data.error) {this.saveMsg = `Error: ${data.error}`;}
      else { this.saveMsg = 'Saved!'; setTimeout(() => { this.saveMsg = ''; }, 2000); }
    } catch { this.saveMsg = 'Save failed'; }
  }

  private _reset() { this.formats = JSON.parse(JSON.stringify(this.defaults)); }

  static styles = css`
    :host { display: block; }
    .grid { display: grid; grid-template-columns: 120px repeat(3, 1fr); gap: 1px; font-size: 12px; }
    .cell { padding: 8px 10px; background: var(--surface); border: 1px solid var(--border-faint); }
    .cell.header { font-weight: 600; color: var(--text-muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; background: var(--surface-hi); }
    .cell.platform { font-weight: 600; text-transform: capitalize; }
    select { background: var(--surface-hi); color: var(--text-primary); border: 1px solid var(--border-dim);
      border-radius: 6px; padding: 4px 6px; font-size: 12px; width: 100%; }
    select.na { color: var(--text-dim); font-style: italic; }
    .actions { display: flex; gap: 8px; margin-top: 12px; align-items: center; }
    button { padding: 6px 14px; border-radius: 6px; font-size: 12px; font-weight: 500; cursor: pointer; border: none; }
    .btn-save { background: var(--magenta); color: white; }
    .btn-reset { background: var(--surface-hi); color: var(--text-muted); border: 1px solid var(--border-dim); }
    .save-msg { font-size: 11px; margin-left: 8px; }
    .save-msg.err { color: var(--critical); }
    .save-msg.ok { color: var(--success, #4ade80); }
    .note { font-size: 11px; color: var(--text-dim); margin-top: 8px; }
  `;

  render() {
    if (this.loading) {return html`<div style="color: var(--text-muted); font-size: 13px; padding: 20px;">Loading formats...</div>`;}
    const platforms = this._platforms();
    return html`
      <div class="grid">
        <div class="cell header">Platform</div>
        ${CONTENT_TYPES.map(ct => html`<div class="cell header">${CONTENT_LABELS[ct]}</div>`)}
        ${platforms.map(p => html`
          <div class="cell platform">${p === 'x' ? 'X / Twitter' : p}</div>
          ${CONTENT_TYPES.map(ct => {
            const val = this._value(p, ct);
            const isText = ct === 'text_post';
            if (isText) {return html`<div class="cell" style="color: var(--text-dim); font-style: italic;">n/a</div>`;}
            return html`<div class="cell">
              <select class="${val === null ? 'na' : ''}"
                @change=${(e: Event) => this._onChange(p, ct, (e.target as HTMLSelectElement).value)}>
                <option value="null" ?selected=${val === null}>Not supported</option>
                ${RATIO_OPTIONS.map(r => html`<option value="${r}" ?selected=${val === r}>${r}</option>`)}
              </select>
            </div>`;
          })}
        `)}
      </div>
      <div class="actions">
        <button class="btn-save" @click=${this._save}>Save</button>
        <button class="btn-reset" @click=${this._reset}>Reset to Defaults</button>
        ${this.saveMsg ? html`<span class="save-msg ${this.saveMsg.startsWith('Error') ? 'err' : 'ok'}">${this.saveMsg}</span>` : nothing}
      </div>
      <div class="note">Ratios must be compatible with your image provider. Imagen 3 supports: 1:1, 3:4, 4:3, 9:16, 16:9.</div>
    `;
  }
}
