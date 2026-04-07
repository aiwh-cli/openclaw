import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

@customElement('social-upload-modal')
export class SocialUploadModal extends LitElement {
  @property({ type: Array }) platforms: string[] = ['instagram', 'x'];
  @state() private file: File | null = null;
  @state() private msg = '';
  @state() private uploading = false;
  @state() private generatingCaptions = false;

  static styles = css`
    :host { display: block; }
    .upload-panel { border: 2px dashed var(--border-dim); border-radius: 12px; padding: 20px;
      margin-bottom: 16px; text-align: center; transition: border-color 200ms; }
    .upload-panel.dragover { border-color: var(--magenta); background: rgba(var(--magenta-rgb),0.04); }
    .upload-panel input[type="file"] { display: none; }
    .btn-upload { background: var(--magenta); color: var(--void); padding: 8px 16px; border-radius: 8px;
      font-weight: 600; font-size: 12px; cursor: pointer; border: none; display: inline-block; }
    .btn-upload:hover { filter: brightness(1.1); }
    .btn-upload:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-outline { background: transparent; border: 1px solid var(--border-dim); color: var(--text-primary);
      padding: 6px 14px; border-radius: 6px; font-size: 12px; cursor: pointer; }
    .btn-outline:hover { border-color: var(--magenta); color: var(--magenta); }
    .btn-outline:disabled { opacity: 0.5; cursor: not-allowed; }
    .preview { font-size: 12px; color: var(--text-muted); margin: 8px 0; }
    .actions { display: flex; gap: 8px; justify-content: center; margin-top: 12px; flex-wrap: wrap; align-items: center; }
    .msg { font-size: 11px; margin-top: 8px; }
    .msg.err { color: var(--critical); }
    .msg.ok { color: var(--success); }
    select { background: var(--surface-hi); color: var(--text-primary);
      border: 1px solid var(--border-dim); border-radius: 6px; padding: 4px 8px; font-size: 12px; }
    :host-context([data-theme="light"]) .btn-upload { color: #fff; }
    :host-context([data-theme="light"]) select { background: rgba(248,248,252,0.8); }
  `;

  render() {
    return html`<div class="upload-panel"
      @dragover=${(e: DragEvent) => { e.preventDefault(); (e.currentTarget as HTMLElement).classList.add('dragover'); }}
      @dragleave=${(e: DragEvent) => (e.currentTarget as HTMLElement).classList.remove('dragover')}
      @drop=${(e: DragEvent) => { e.preventDefault(); (e.currentTarget as HTMLElement).classList.remove('dragover');
        if (e.dataTransfer?.files[0]) {this.file = e.dataTransfer.files[0];} }}>
      ${this.file
        ? html`<div class="preview">${this.file.name} (${(this.file.size / 1024 / 1024).toFixed(1)} MB)</div>`
        : html`<div style="margin-bottom:10px;font-size:13px;color:var(--text-muted)">Drop an image or video, or click to browse</div>`}
      <input type="file" id="social-file-input" accept="image/*,video/*"
        @change=${(e: Event) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) {this.file = f;} }} />
      <label for="social-file-input" class="btn-upload" style="cursor:pointer">${this.file ? 'Change File' : 'Choose File'}</label>
      ${this.file ? html`
        <input type="text" id="upload-topic" placeholder="What's this about? (e.g. AI cost comparison infographic)"
          style="width:100%;margin:10px 0;padding:8px 12px;background:var(--surface-hi);color:var(--text-primary);border:1px solid var(--border-dim);border-radius:6px;font-size:12px;box-sizing:border-box" />
        <div style="display:flex;gap:12px;margin-bottom:10px;font-size:12px">
          ${this.platforms.map(p => html`<label style="display:flex;align-items:center;gap:4px;cursor:pointer">
            <input type="checkbox" class="plat-cb" value=${p} checked /> ${p}</label>`)}</div>
        <div class="actions">
          <button class="btn-outline" ?disabled=${this.generatingCaptions} @click=${() => this._upload(true)}>
            ${this.generatingCaptions ? 'Generating...' : 'Upload + Generate Captions'}</button>
          <button class="btn-upload" ?disabled=${this.uploading} @click=${() => this._upload(false)}>
            ${this.uploading ? 'Uploading...' : 'Add to Review Queue'}</button>
          <button class="btn-outline" ?disabled=${this.uploading} @click=${() => this._upload(false, true)}>Schedule Now</button>
        </div>` : nothing}
      ${this.msg ? html`<div class="msg ${this.msg.startsWith('Error') ? 'err' : 'ok'}">${this.msg}</div>` : nothing}
    </div>`;
  }

  private async _upload(withCaptions: boolean, scheduleNow = false) {
    if (!this.file) {return;}
    if (withCaptions) {this.generatingCaptions = true;}
    else {this.uploading = true;}
    this.msg = withCaptions ? 'Uploading and dispatching caption generation...' : '';

    const form = new FormData();
    form.append('file', this.file);
    const checked = [...this.shadowRoot!.querySelectorAll('.plat-cb:checked')].map((cb: any) => cb.value);
    const selectedPlatforms = checked.length ? checked : ['instagram'];
    const topicEl = this.shadowRoot?.querySelector('#upload-topic') as HTMLInputElement;
    form.append('platform', selectedPlatforms[0]);
    form.append('platforms', JSON.stringify(selectedPlatforms));
    if (topicEl?.value) {form.append('topic', topicEl.value);}
    if (scheduleNow) {form.append('schedule_now', 'true');}

    try {
      const upRes = await (await fetch('/api/social/upload', { method: 'POST', credentials: 'same-origin', body: form })).json();
      if (!upRes.success) { this.msg = `Error: ${upRes.error}`; this._resetState(); return; }

      if (withCaptions) {
        const capRes = await (await fetch('/api/social/generate-captions', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ job_id: upRes.job_id }),
        })).json();
        this.msg = capRes.success
          ? `Uploaded! Captions generating for ${upRes.job_id}. Check Review Queue shortly.`
          : `Uploaded but caption generation failed: ${capRes.error}`;
      } else {
        this.msg = `Uploaded! Job: ${upRes.job_id} (${upRes.status})`;
      }
      this.file = null;
      this.dispatchEvent(new CustomEvent('uploaded', { bubbles: true, composed: true }));
    } catch (e: any) { this.msg = `Error: ${e.message}`; }
    this._resetState();
  }

  private _resetState() { this.uploading = false; this.generatingCaptions = false; }
}
