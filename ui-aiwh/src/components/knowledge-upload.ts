import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';

interface IngestedDoc {
  filename: string;
  uploadedAt: string;
  entries: number;
  status: 'done' | 'processing' | 'error';
  error?: string;
}

@customElement('knowledge-upload')
export class KnowledgeUpload extends LitElement {
  @state() private docs: IngestedDoc[] = [];
  @state() private uploading = false;
  @state() private uploadMsg = '';
  @state() private uploadMsgType: 'success' | 'error' | '' = '';
  @state() private processing = '';
  @state() private dragOver = false;

  static styles = css`
    :host { display: block; font-family: 'Inter', -apple-system, sans-serif; color: var(--text-primary, #F5EDD6); }

    .drop-zone {
      border: 2px dashed rgba(201,168,76,0.15); border-radius: 12px;
      padding: 40px 20px; text-align: center; cursor: pointer;
      transition: all 200ms; background: rgba(14,14,18,0.3);
    }
    .drop-zone:hover, .drop-zone.active {
      border-color: rgba(201,168,76,0.40); background: rgba(201,168,76,0.04);
    }
    .drop-title { font-size: 15px; font-weight: 500; margin-bottom: 6px; }
    .drop-sub { font-size: 12px; color: var(--text-muted, #8A8578); }
    .drop-formats { font-size: 11px; color: var(--text-muted, #8A8578); margin-top: 8px;
      font-family: 'JetBrains Mono', monospace; }

    input[type="file"] { display: none; }

    .msg { padding: 10px 14px; border-radius: 8px; margin-top: 12px; font-size: 12px; }
    .msg.success { background: rgba(76,175,122,0.08); border-left: 3px solid #4CAF7A; color: #4CAF7A; }
    .msg.error { background: rgba(224,82,82,0.08); border-left: 3px solid #E05252; color: #E05252; }
    .msg.processing { background: rgba(201,168,76,0.08); border-left: 3px solid #C9A84C; color: #C9A84C; }

    .docs-list { margin-top: 20px; }
    .docs-header { font-size: 14px; font-weight: 600; margin-bottom: 10px; }
    .doc-row {
      display: flex; justify-content: space-between; align-items: center;
      padding: 10px 14px; border-radius: 8px; margin-bottom: 6px;
      background: rgba(14,14,18,0.4); border: 1px solid rgba(201,168,76,0.06);
      transition: border-color 150ms;
    }
    .doc-row:hover { border-color: rgba(201,168,76,0.15); }
    .doc-name { font-weight: 500; font-size: 13px; }
    .doc-meta { font-size: 11px; color: var(--text-muted, #8A8578); margin-top: 2px; }
    .doc-entries { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #4CAF7A; }
    .doc-actions { display: flex; gap: 6px; }
    .btn {
      padding: 4px 10px; font-size: 11px; border-radius: 5px; cursor: pointer;
      border: 1px solid rgba(201,168,76,0.10); background: none;
      color: var(--text-muted, #8A8578); font-family: 'Inter', sans-serif; transition: all 150ms;
    }
    .btn:hover { border-color: rgba(201,168,76,0.25); color: var(--text-primary, #F5EDD6); }
    .btn-danger { border-color: rgba(224,82,82,0.15); color: #E05252; }
    .btn-danger:hover { background: rgba(224,82,82,0.08); }
    .empty { text-align: center; padding: 20px; color: var(--text-muted, #8A8578); font-size: 13px; }

    :host-context([data-theme="light"]) .drop-zone { background: rgba(248,248,252,0.5); }
    :host-context([data-theme="light"]) .doc-row { background: rgba(240,241,245,0.5); }
  `;

  connectedCallback() { super.connectedCallback(); this._loadDocs(); }

  private async _loadDocs() {
    try {
      const res = await fetch('/api/knowledge/documents');
      if (res.ok) {this.docs = await res.json();}
    } catch { /* ignore */ }
  }

  private _onDragOver(e: DragEvent) { e.preventDefault(); this.dragOver = true; }
  private _onDragLeave() { this.dragOver = false; }

  private _onDrop(e: DragEvent) {
    e.preventDefault(); this.dragOver = false;
    const files = e.dataTransfer?.files;
    if (files?.length) {this._upload(files[0]);}
  }

  private _onFileSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files?.length) {this._upload(input.files[0]);}
    input.value = '';
  }

  private async _upload(file: File) {
    const allowed = ['.pdf', '.docx', '.pptx', '.md', '.txt', '.json', '.jsonl', '.csv'];
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    if (!allowed.includes(ext)) {
      this.uploadMsg = `Unsupported file type: ${ext}. Supported: ${allowed.join(', ')}`;
      this.uploadMsgType = 'error';
      return;
    }

    // Check for duplicate
    const existing = this.docs.find(d => d.filename === file.name);
    if (existing) {
      this.uploadMsg = `"${file.name}" has already been ingested (${existing.entries} entries). Delete it first or rename the file.`;
      this.uploadMsgType = 'error';
      return;
    }

    this.uploading = true;
    this.processing = file.name;
    this.uploadMsg = `Uploading ${file.name}...`;
    this.uploadMsgType = '';

    const form = new FormData();
    form.append('file', file);

    try {
      const res = await fetch('/api/knowledge/upload', { method: 'POST', body: form });
      const data = await res.json();
      if (data.ok && data.status === 'processing') {
        this.uploadMsg = `Processing ${file.name}... This may take a few minutes.`;
        this.uploadMsgType = '';
        this._pollProgress(file.name);
      } else if (data.error) {
        this.uploadMsg = data.error;
        this.uploadMsgType = 'error';
        this.uploading = false;
        this.processing = '';
      }
    } catch (e: unknown) {
      this.uploadMsg = e instanceof Error ? e.message : 'Upload failed';
      this.uploadMsgType = 'error';
      this.uploading = false;
      this.processing = '';
    }
  }

  private _pollProgress(filename: string) {
    const poll = setInterval(async () => {
      try {
        const res = await fetch(`/api/knowledge/progress/${encodeURIComponent(filename)}`);
        const job = await res.json();
        if (job.progress) {this.uploadMsg = job.progress;}
        if (job.status === 'done') {
          clearInterval(poll);
          this.uploadMsg = `${filename}: ${job.entries} knowledge entries extracted`;
          this.uploadMsgType = 'success';
          this.uploading = false;
          this.processing = '';
          this._loadDocs();
        } else if (job.status === 'error') {
          clearInterval(poll);
          this.uploadMsg = job.error || 'Processing failed';
          this.uploadMsgType = 'error';
          this.uploading = false;
          this.processing = '';
        }
      } catch { /* keep polling */ }
    }, 3000);
    // Timeout after 10 minutes
    setTimeout(() => {
      clearInterval(poll);
      if (this.uploading) {
        this.uploadMsg = 'Processing timed out. Check the documents list.';
        this.uploadMsgType = 'error';
        this.uploading = false;
        this.processing = '';
        this._loadDocs();
      }
    }, 600000);
  }

  private async _reprocess(filename: string) {
    this.processing = filename;
    try {
      const res = await fetch('/api/knowledge/reprocess', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename }),
      });
      const data = await res.json();
      if (data.ok) {this._loadDocs();}
    } catch { /* ignore */ }
    finally { this.processing = ''; }
  }

  private async _delete(filename: string) {
    if (!confirm(`Delete all knowledge entries from "${filename}"?`)) {return;}
    try {
      const res = await fetch('/api/knowledge/document', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename }),
      });
      const data = await res.json();
      if (data.ok) {this._loadDocs();}
    } catch { /* ignore */ }
  }

  render() {
    return html`
      <div class="drop-zone ${this.dragOver ? 'active' : ''}"
        @dragover=${this._onDragOver} @dragleave=${this._onDragLeave}
        @drop=${this._onDrop} @click=${() => this.renderRoot.querySelector<HTMLInputElement>('#file-input')?.click()}>
        <div class="drop-title">${this.uploading ? 'Processing...' : 'Drop a document here or click to upload'}</div>
        <div class="drop-sub">Documents are distilled into knowledge entries — no copy-paste, AI rephrases everything</div>
        <div class="drop-formats">PDF, DOCX, PPTX, MD, TXT, JSON, JSONL, CSV</div>
        <input type="file" id="file-input" accept=".pdf,.docx,.pptx,.md,.txt,.json,.jsonl,.csv" @change=${this._onFileSelect}>
      </div>

      ${this.uploadMsg ? html`
        <div class="msg ${this.uploadMsgType || 'processing'}">${this.uploadMsg}</div>
      ` : nothing}

      ${this.processing ? html`
        <div class="msg processing">Processing: ${this.processing}... This may take a minute.</div>
      ` : nothing}

      <div class="docs-list">
        <div class="docs-header">Ingested Documents (${this.docs.length})</div>
        ${this.docs.length ? this.docs.map(doc => html`
          <div class="doc-row">
            <div>
              <div class="doc-name">${doc.filename}</div>
              <div class="doc-meta">${doc.uploadedAt} · ${doc.status}</div>
            </div>
            <div style="display:flex;align-items:center;gap:12px">
              <span class="doc-entries">${doc.entries} entries</span>
              <div class="doc-actions">
                <button class="btn" @click=${() => this._reprocess(doc.filename)}
                  ?disabled=${this.processing === doc.filename}>Re-process</button>
                <button class="btn btn-danger" @click=${() => this._delete(doc.filename)}>Delete</button>
              </div>
            </div>
          </div>
        `) : html`<div class="empty">No documents ingested yet. Upload one above.</div>`}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap { 'knowledge-upload': KnowledgeUpload; }
}
