/**
 * settings-pillars-editor — Full pillar CRUD for the Settings tab.
 *
 * Add, edit, delete, reorder content pillars. Saves to content-pillars.json.
 * Editable fields: name, description, hashtags, platforms.
 */
import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';

interface Pillar { name: string; description: string; hashtags: string[]; id?: string; schedule_days?: string[]; }
const PLAT_LABELS: Record<string, string> = { instagram: 'Instagram', x: 'X', linkedin: 'LinkedIn', tiktok: 'TikTok', facebook: 'Facebook' };
const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

@customElement('settings-pillars-editor')
export class SettingsPillarsEditor extends LitElement {
  @state() private pillars: Pillar[] = [];
  @state() private platforms: string[] = [];
  @state() private frequency = '';
  @state() private loading = true;
  @state() private editing: number | null = null; // index of pillar being edited
  @state() private editDraft: Pillar = { name: '', description: '', hashtags: [] };
  @state() private msg = '';
  @state() private saving = false;

  connectedCallback() { super.connectedCallback(); this._load(); }

  private async _load() {
    this.loading = true;
    try {
      const data = await this._api('/api/social-hub/settings/pillars');
      this.pillars = (data.pillars || []).map((p: any) => ({
        name: p.name || p.id || '', description: p.description || '',
        hashtags: p.hashtags || [], id: p.id,
      }));
      this.platforms = data.target_platforms || [];
      this.frequency = data.posting_frequency || '';
    } catch (e: any) { this.msg = 'Failed to load pillars'; console.error('[pillars-editor]', e); }
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
    .card-title { font-size: 14px; font-weight: 600; margin-bottom: 10px; }
    .pillar-list { display: flex; flex-direction: column; gap: 6px; }
    .pillar-item { display: flex; align-items: center; gap: 10px; padding: 10px 12px;
      background: var(--surface-hi); border-radius: 8px; }
    .pillar-info { flex: 1; }
    .pillar-name { font-weight: 600; font-size: 13px; }
    .pillar-desc { font-size: 11px; color: var(--text-muted); margin-top: 2px; }
    .pillar-tags { font-size: 10px; color: var(--magenta); margin-top: 2px; }
    .pillar-actions { display: flex; gap: 4px; }
    .act { padding: 3px 8px; border-radius: 4px; font-size: 10px; cursor: pointer; border: none; font-weight: 600; }
    .act-edit { background: rgba(var(--magenta-rgb),0.1); color: var(--magenta); }
    .act-del { background: rgba(var(--critical-rgb),0.1); color: var(--critical); }
    .act-move { background: var(--surface); border: 1px solid var(--border-dim); color: var(--text-muted); }
    .add-btn { display: inline-block; padding: 8px 14px; border: 1px dashed var(--border-dim);
      border-radius: 8px; cursor: pointer; font-size: 12px; color: var(--text-muted); margin-top: 8px; }
    .add-btn:hover { border-color: var(--magenta); color: var(--magenta); }
    .edit-form { border: 1px solid var(--magenta); border-radius: 10px; padding: 14px; margin-bottom: 10px; }
    .field { margin-bottom: 10px; }
    .field label { display: block; font-size: 11px; font-weight: 600; color: var(--text-muted);
      text-transform: uppercase; margin-bottom: 3px; }
    input, textarea { width: 100%; padding: 7px 10px; background: var(--surface-hi);
      color: var(--text-primary); border: 1px solid var(--border-dim); border-radius: 6px;
      font-size: 12px; box-sizing: border-box; font-family: inherit; }
    textarea { min-height: 50px; resize: vertical; }
    .form-actions { display: flex; gap: 8px; }
    .btn { padding: 7px 14px; border-radius: 6px; font-weight: 600; font-size: 12px; cursor: pointer; border: none; }
    .btn-primary { background: var(--magenta); color: var(--void); }
    .btn-primary:disabled { opacity: 0.5; }
    .btn-secondary { background: transparent; border: 1px solid var(--border-dim); color: var(--text-primary); }
    .platform-row { display: flex; gap: 10px; font-size: 12px; flex-wrap: wrap; }
    .platform-row label { display: flex; align-items: center; gap: 4px; cursor: pointer; }
    .msg { font-size: 11px; margin-top: 6px; color: var(--success); }
    .msg.err { color: var(--critical); }
    :host-context([data-theme="light"]) .btn-primary { color: #fff; }
  `;

  render() {
    if (this.loading) {return html`<div style="padding:20px;color:var(--text-muted)">Loading pillars...</div>`;}

    return html`
      <div class="card"><div class="card-title">Target Platforms</div>
        <div class="platform-row">
          ${['instagram', 'x', 'linkedin', 'tiktok', 'facebook'].map(p => html`
            <label><input type="checkbox" .checked=${this.platforms.includes(p)}
              @change=${(e: Event) => {
                const cb = e.target as HTMLInputElement;
                this.platforms = cb.checked ? [...this.platforms, p] : this.platforms.filter(x => x !== p);
              }} /> ${PLAT_LABELS[p] || p}</label>`)}
        </div>
      </div>

      <div class="card"><div class="card-title">Posting Frequency</div>
        <select .value=${this.frequency} @change=${(e: Event) => this.frequency = (e.target as HTMLSelectElement).value}>
          ${['1/day', '2/day', '3/day', '5/day', '1/week', '3/week', '5/week'].map(f =>
            html`<option value=${f} ?selected=${this.frequency === f}>${f}</option>`)}
        </select>
      </div>

      <div class="card"><div class="card-title">Content Pillars (${this.pillars.length})</div>
        <div class="pillar-list">
          ${this.pillars.map((p, i) => this.editing === i ? this._renderEditForm(i) : this._renderPillarItem(p, i))}
        </div>
        ${this.editing === null ? html`
          <div class="add-btn" @click=${this._addPillar}>+ Add Pillar</div>` : nothing}
      </div>

      <button class="btn btn-primary" ?disabled=${this.saving} @click=${this._save}>
        ${this.saving ? 'Saving...' : 'Save All Changes'}</button>
      ${this.msg ? html`<div class="msg ${this.msg.startsWith('Error') ? 'err' : ''}">${this.msg}</div>` : nothing}
    `;
  }

  private _renderPillarItem(p: Pillar, i: number) {
    return html`
      <div class="pillar-item">
        <div class="pillar-info">
          <div class="pillar-name">${p.name}</div>
          ${p.description ? html`<div class="pillar-desc">${p.description}</div>` : nothing}
          ${p.hashtags?.length ? html`<div class="pillar-tags">${p.hashtags.join(' ')}</div>` : nothing}
          ${p.schedule_days?.length ? html`<div class="pillar-tags" style="color:var(--magenta)">${p.schedule_days.map(d => d.slice(0, 3).replace(/^./, c => c.toUpperCase())).join(', ')}</div>` : nothing}
        </div>
        <div class="pillar-actions">
          ${i > 0 ? html`<button class="act act-move" @click=${() => this._move(i, -1)}>\u2191</button>` : nothing}
          ${i < this.pillars.length - 1 ? html`<button class="act act-move" @click=${() => this._move(i, 1)}>\u2193</button>` : nothing}
          <button class="act act-edit" @click=${() => { this.editDraft = { ...p }; this.editing = i; }}>Edit</button>
          <button class="act act-del" @click=${() => this._deletePillar(i)}>Del</button>
        </div>
      </div>`;
  }

  private _renderEditForm(i: number) {
    const d = this.editDraft;
    return html`
      <div class="edit-form">
        <div class="field"><label>Name</label>
          <input type="text" .value=${d.name} @input=${(e: Event) => this.editDraft = { ...d, name: (e.target as HTMLInputElement).value }} /></div>
        <div class="field"><label>Description</label>
          <textarea .value=${d.description} @input=${(e: Event) => this.editDraft = { ...d, description: (e.target as HTMLTextAreaElement).value }}></textarea></div>
        <div class="field"><label>Hashtags (one per line)</label>
          <textarea .value=${(d.hashtags || []).join('\n')}
            @input=${(e: Event) => this.editDraft = { ...d, hashtags: (e.target as HTMLTextAreaElement).value.split('\n').filter(Boolean) }}></textarea></div>
        <div class="field"><label>Schedule Days</label>
          <div class="platform-row">
            ${DAYS.map(day => html`
              <label style="font-size:11px"><input type="checkbox" .checked=${(d.schedule_days || []).includes(day)}
                @change=${(e: Event) => {
                  const cb = e.target as HTMLInputElement;
                  const days = cb.checked ? [...(d.schedule_days || []), day] : (d.schedule_days || []).filter((x: string) => x !== day);
                  this.editDraft = { ...d, schedule_days: days };
                }} /> ${day.slice(0, 3).replace(/^./, c => c.toUpperCase())}</label>`)}
          </div>
        </div>
        <div class="form-actions">
          <button class="btn btn-primary" @click=${() => this._applyEdit(i)}>Apply</button>
          <button class="btn btn-secondary" @click=${() => this.editing = null}>Cancel</button>
        </div>
      </div>`;
  }

  private _addPillar() {
    this.pillars = [...this.pillars, { name: 'New Pillar', description: '', hashtags: [] }];
    this.editDraft = { ...this.pillars[this.pillars.length - 1] };
    this.editing = this.pillars.length - 1;
  }

  private _applyEdit(i: number) {
    this.pillars = this.pillars.map((p, j) => j === i ? { ...this.editDraft } : p);
    this.editing = null;
  }

  private _deletePillar(i: number) {
    if (!confirm(`Delete "${this.pillars[i].name}"?`)) {return;}
    this.pillars = this.pillars.filter((_, j) => j !== i);
    if (this.editing === i) {this.editing = null;}
  }

  private _move(i: number, dir: number) {
    const arr = [...this.pillars];
    const j = i + dir;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    this.pillars = arr;
  }

  private async _save() {
    this.saving = true; this.msg = '';
    try {
      const body = {
        pillars: this.pillars.map(p => ({
          name: p.name, id: p.id || p.name.toLowerCase().replace(/\s+/g, '-'),
          description: p.description, hashtags: p.hashtags, schedule_days: p.schedule_days || [],
        })),
        target_platforms: this.platforms,
        posting_frequency: this.frequency,
      };
      const r = await this._api('/api/social-hub/settings/pillars', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      this.msg = r.error ? `Error: ${r.error}` : 'Saved!';
    } catch (e: any) { this.msg = `Error: ${e.message}`; }
    this.saving = false;
  }
}
