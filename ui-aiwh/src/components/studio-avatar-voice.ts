/**
 * studio-avatar-voice — Avatar & Voice CRUD management.
 *
 * Migrated from production-create.js avatar/voice management modals.
 * Full CRUD: list, add, edit, delete avatars + voices. Voice preview playback.
 * Shared between Studio tab and Settings.
 */
import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';

interface Avatar {
  id: string; name: string; pillar: string; photo_url: string;
  avatar_look_id: string; look_number: string; resolution: string; description: string;
}
interface Voice { name: string; voice_id: string; gender: string; accent: string; description: string; }

type View = 'list' | 'edit-avatar' | 'add-avatar' | 'edit-voice' | 'add-voice';

@customElement('studio-avatar-voice')
export class StudioAvatarVoice extends LitElement {
  @state() private view: View = 'list';
  @state() private avatars: Avatar[] = [];
  @state() private voices: Voice[] = [];
  @state() private editItem: any = null;
  @state() private saving = false;
  @state() private msg = '';
  private _audio: HTMLAudioElement | null = null;

  connectedCallback() { super.connectedCallback(); this._load(); }
  disconnectedCallback() { super.disconnectedCallback(); this._audio?.pause(); this._audio = null; }

  private async _load() {
    try {
      const [av, vo] = await Promise.all([
        this._api('/api/cinematic/avatar-config'),
        this._api('/api/cinematic/voice-config'),
      ]);
      const avatarData = av?.pillars || av?.avatars || {};
      this.avatars = Object.entries(avatarData).map(([id, a]: [string, any]) => ({
        id, name: a.display_name || a.name || id, pillar: a.pillar || id,
        photo_url: a.photo_url || '', avatar_look_id: a.avatar_look_id || '',
        look_number: a.look_number || '', resolution: a.resolution || '16:9',
        description: a.description || '',
      }));
      if (vo?.voices) {this.voices = vo.voices;}
    } catch (e: any) { this.msg = 'Failed to load avatars/voices'; console.error('[avatar-voice]', e); }
  }

  private async _api(url: string, opts?: RequestInit) {
    const r = await fetch(url, { credentials: 'same-origin', ...opts });
    return r.ok ? r.json() : {};
  }

  static styles = css`
    :host { display: block; }
    .back { font-size: 12px; color: var(--magenta); cursor: pointer; margin-bottom: 12px; display: inline-block; }
    .back:hover { text-decoration: underline; }
    h3 { margin: 0 0 12px; font-size: 15px; font-weight: 600; }
    h4 { margin: 16px 0 8px; font-size: 13px; font-weight: 600; color: var(--text-muted); }
    .list { display: grid; gap: 8px; }
    .card { display: flex; align-items: center; gap: 12px; padding: 10px 14px;
      border: 1px solid var(--border-dim); border-radius: 10px; cursor: pointer; transition: all 150ms; }
    .card:hover { border-color: var(--magenta); }
    .card img { width: 40px; height: 40px; border-radius: 50%; object-fit: cover; }
    .card-info { flex: 1; }
    .card-name { font-size: 13px; font-weight: 600; }
    .card-meta { font-size: 11px; color: var(--text-muted); }
    .card-badge { font-size: 10px; padding: 2px 8px; border-radius: 6px;
      background: rgba(var(--magenta-rgb),0.1); color: var(--magenta); }
    .btn-add { display: inline-block; padding: 6px 14px; border: 1px dashed var(--border-dim);
      border-radius: 8px; cursor: pointer; font-size: 12px; color: var(--text-muted); margin-top: 8px; }
    .btn-add:hover { border-color: var(--magenta); color: var(--magenta); }
    .field { margin-bottom: 12px; }
    .field label { display: block; font-size: 11px; font-weight: 600; color: var(--text-muted);
      text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
    input, select, textarea { width: 100%; padding: 8px 12px; background: var(--surface-hi);
      color: var(--text-primary); border: 1px solid var(--border-dim); border-radius: 8px;
      font-size: 13px; box-sizing: border-box; }
    .actions { display: flex; gap: 8px; margin-top: 14px; }
    .btn { padding: 8px 16px; border-radius: 8px; font-weight: 600; font-size: 12px;
      cursor: pointer; border: none; }
    .btn-primary { background: var(--magenta); color: var(--void); }
    .btn-primary:disabled { opacity: 0.5; }
    .btn-danger { background: rgba(var(--critical-rgb),0.1); color: var(--critical); }
    .btn-danger:hover { background: rgba(var(--critical-rgb),0.2); }
    .btn-secondary { background: transparent; border: 1px solid var(--border-dim); color: var(--text-primary); }
    .msg { font-size: 11px; margin-top: 8px; color: var(--success); }
    .msg.err { color: var(--critical); }
    .play-btn { background: none; border: none; cursor: pointer; font-size: 16px; padding: 4px; }
    :host-context([data-theme="light"]) .btn-primary { color: #fff; }
  `;

  render() {
    switch (this.view) {
      case 'list': return this._renderList();
      case 'edit-avatar': case 'add-avatar': return this._renderAvatarForm();
      case 'edit-voice': case 'add-voice': return this._renderVoiceForm();
    }
  }

  private _renderList() {
    return html`
      <div class="back" @click=${() => this.dispatchEvent(new CustomEvent('back', { bubbles: true, composed: true }))}>\u2190 Back</div>
      <h3>Manage Avatars & Voices</h3>

      <h4>Avatars</h4>
      <div class="list">
        ${this.avatars.map(a => html`
          <div class="card" @click=${() => { this.editItem = { ...a }; this.view = 'edit-avatar'; }}>
            ${a.photo_url ? html`<img src=${a.photo_url} alt=${a.name}
              @error=${(e: Event) => (e.target as HTMLImageElement).style.display = 'none'} />` : nothing}
            <div class="card-info">
              <div class="card-name">${a.name}</div>
              <div class="card-meta">${a.pillar} \u00B7 Look ${a.look_number || '?'}</div>
            </div>
            <span class="card-badge">${a.resolution || '16:9'}</span>
          </div>`)}
      </div>
      <div class="btn-add" @click=${() => { this.editItem = { id: '', name: '', pillar: '', photo_url: '', avatar_look_id: '', look_number: '', resolution: '16:9', description: '' }; this.view = 'add-avatar'; }}>+ Add Avatar</div>

      <h4>Voices</h4>
      <div class="list">
        ${this.voices.map((v, i) => html`
          <div class="card" @click=${() => { this.editItem = { ...v, _index: i }; this.view = 'edit-voice'; }}>
            <div class="card-info">
              <div class="card-name">${v.name}</div>
              <div class="card-meta">${v.gender || ''} ${v.accent ? `\u00B7 ${v.accent}` : ''}</div>
            </div>
            <button class="play-btn" title="Preview" @click=${(e: Event) => { e.stopPropagation(); this._preview(v.voice_id); }}>\u{1F50A}</button>
          </div>`)}
      </div>
      <div class="btn-add" @click=${() => { this.editItem = { name: '', voice_id: '', gender: 'male', accent: '', description: '' }; this.view = 'add-voice'; }}>+ Add Voice</div>
    `;
  }

  private _renderAvatarForm() {
    const a = this.editItem;
    const isNew = this.view === 'add-avatar';
    return html`
      <div class="back" @click=${() => { this.view = 'list'; this.msg = ''; }}>\u2190 Back to list</div>
      <h3>${isNew ? 'Add Avatar' : `Edit: ${a.name}`}</h3>
      ${this._field('Name', 'name', a.name)}
      ${this._field('Pillar', 'pillar', a.pillar)}
      ${this._field('Photo URL', 'photo_url', a.photo_url)}
      ${this._field('HeyGen Look ID', 'avatar_look_id', a.avatar_look_id)}
      ${this._field('Look #', 'look_number', a.look_number)}
      <div class="field"><label>Resolution</label>
        <select .value=${a.resolution || '16:9'} @change=${(e: Event) => this.editItem = { ...a, resolution: (e.target as HTMLSelectElement).value }}>
          <option value="9:16">9:16</option><option value="16:9">16:9</option><option value="1:1">1:1</option>
        </select></div>
      ${this._field('Description', 'description', a.description, true)}
      <div class="actions">
        <button class="btn btn-primary" ?disabled=${this.saving} @click=${() => this._saveAvatar(isNew)}>
          ${this.saving ? 'Saving...' : 'Save'}</button>
        ${!isNew ? html`<button class="btn btn-danger" @click=${this._deleteAvatar}>Delete</button>` : nothing}
      </div>
      ${this.msg ? html`<div class="msg ${this.msg.startsWith('Error') ? 'err' : ''}">${this.msg}</div>` : nothing}
    `;
  }

  private _renderVoiceForm() {
    const v = this.editItem;
    const isNew = this.view === 'add-voice';
    return html`
      <div class="back" @click=${() => { this.view = 'list'; this.msg = ''; }}>\u2190 Back to list</div>
      <h3>${isNew ? 'Add Voice' : `Edit: ${v.name}`}</h3>
      ${this._field('Name', 'name', v.name)}
      ${this._field('ElevenLabs Voice ID', 'voice_id', v.voice_id)}
      <div class="field"><label>Gender</label>
        <select .value=${v.gender || 'male'} @change=${(e: Event) => this.editItem = { ...v, gender: (e.target as HTMLSelectElement).value }}>
          <option value="male">Male</option><option value="female">Female</option>
        </select></div>
      ${this._field('Accent', 'accent', v.accent || '')}
      ${this._field('Description', 'description', v.description || '')}
      <div class="actions">
        <button class="btn btn-primary" ?disabled=${this.saving} @click=${() => this._saveVoice(isNew)}>
          ${this.saving ? 'Saving...' : 'Save'}</button>
        ${!isNew ? html`<button class="btn btn-danger" @click=${this._deleteVoice}>Delete</button>` : nothing}
      </div>
      ${this.msg ? html`<div class="msg ${this.msg.startsWith('Error') ? 'err' : ''}">${this.msg}</div>` : nothing}
    `;
  }

  private _field(label: string, key: string, value: string, textarea = false) {
    return html`<div class="field"><label>${label}</label>
      ${textarea
        ? html`<textarea .value=${value} @input=${(e: Event) => this.editItem = { ...this.editItem, [key]: (e.target as HTMLTextAreaElement).value }}></textarea>`
        : html`<input type="text" .value=${value} @input=${(e: Event) => this.editItem = { ...this.editItem, [key]: (e.target as HTMLInputElement).value }} />`}
    </div>`;
  }

  private async _saveAvatar(isNew: boolean) {
    this.saving = true; this.msg = '';
    const a = this.editItem;
    const id = isNew ? `${a.pillar || 'custom'}-${Date.now()}`.replace(/\s/g, '-').toLowerCase() : a.id;
    try {
      await this._api(`/api/cinematic/avatar-config/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: a.name, pillar: a.pillar, photo_url: a.photo_url,
          avatar_look_id: a.avatar_look_id, look_number: a.look_number,
          resolution: a.resolution, description: a.description }),
      });
      this.msg = 'Saved!'; await this._load(); this.view = 'list';
    } catch (e: any) { this.msg = `Error: ${e.message}`; }
    this.saving = false;
  }

  private async _deleteAvatar() {
    if (!confirm(`Delete avatar "${this.editItem.name}"?`)) {return;}
    try {
      await this._api(`/api/cinematic/avatar-config/${this.editItem.id}`, { method: 'DELETE' });
      await this._load(); this.view = 'list';
    } catch (e: any) { this.msg = `Error: ${e.message}`; }
  }

  private async _saveVoice(isNew: boolean) {
    this.saving = true; this.msg = '';
    const v = this.editItem;
    try {
      const voices = [...this.voices];
      const entry = { name: v.name, voice_id: v.voice_id, gender: v.gender, accent: v.accent, description: v.description };
      if (isNew) {voices.push(entry);}
      else {voices[v._index] = entry;}
      await this._api('/api/cinematic/voice-config', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voices }),
      });
      this.msg = 'Saved!'; await this._load(); this.view = 'list';
    } catch (e: any) { this.msg = `Error: ${e.message}`; }
    this.saving = false;
  }

  private async _deleteVoice() {
    if (!confirm(`Delete voice "${this.editItem.name}"?`)) {return;}
    try {
      const voices = this.voices.filter((_, i) => i !== this.editItem._index);
      await this._api('/api/cinematic/voice-config', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voices }),
      });
      await this._load(); this.view = 'list';
    } catch (e: any) { this.msg = `Error: ${e.message}`; }
  }

  private _preview(voiceId: string) {
    this._audio?.pause();
    this._audio = new Audio(`/api/cinematic/voice-preview/${voiceId}`);
    this._audio.play().catch(() => {});
  }
}
