import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';

type TrashStats = {
  total_files: number;
  total_size: number;
  verified: number;
  deletable: number;
};

type TrashItem = {
  id: number;
  original_path: string;
  file_size: number;
  verified: boolean;
  gdrive_folder_path?: string;
  trashed_at: string;
  deleted_at?: string;
};

const api = (window as any).api as (url: string, opts?: any) => Promise<any>;
const showToast = (window as any).showToast as (msg: string, type?: string) => void;
const dashConfirm = (window as any).dashConfirm as (msg: string) => Promise<boolean>;
const escHtml = (window as any).escHtml as (s: string) => string;

@customElement('trash-view')
export class TrashView extends LitElement {
  createRenderRoot() { return this; }

  @state() private stats: TrashStats | null = null;
  @state() private items: TrashItem[] = [];
  @state() private loading = true;
  @state() private archiverRunning = false;
  @state() private archiverProgress = '';
  private _pollTimer = 0;
  private _pollTimeout = 0;

  connectedCallback() { super.connectedCallback(); this.load(); }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._pollTimer) {clearInterval(this._pollTimer); this._pollTimer = 0;}
    if (this._pollTimeout) {clearTimeout(this._pollTimeout); this._pollTimeout = 0;}
  }

  async load() {
    this.loading = true;
    try {
      const [stats, manifest] = await Promise.all([
        api('/trash/stats'),
        api('/trash/manifest'),
      ]);
      this.stats = stats;
      this.items = manifest?.items || [];
    } catch (e) { console.error('Trash load failed:', e); }
    this.loading = false;
  }

  private _bytes(b: number) {
    if (!b) {return '0 B';}
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0, val = b;
    while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
    return val.toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
  }

  private _icon(ext: string) {
    const m: Record<string, string> = { mp4: '🎬', mp3: '🎵', wav: '🎵', mov: '🎬', png: '🖼️', jpg: '🖼️', jpeg: '🖼️', webp: '🖼️' };
    return m[ext] || '📄';
  }

  private _source(path: string) {
    if (path.includes('/content/jobs/')) {return 'Video Job';}
    if (path.includes('/cinematic/')) {return 'Cinematic';}
    if (path.includes('/outputs/')) {return 'Output';}
    return 'Other';
  }

  private async _deleteFile(id: number) {
    const ok = await dashConfirm('Permanently delete this file? This cannot be undone.');
    if (!ok) {return;}
    try {
      const r = await fetch(`/api/trash/${id}`, { method: 'DELETE' });
      const data = await r.json();
      if (data.ok) { showToast('File deleted', 'success'); this.load(); }
      else { showToast('Delete failed: ' + (data.error || 'unknown'), 'error'); }
    } catch (e: any) { showToast('Delete failed: ' + e.message, 'error'); }
  }

  private async _deleteAllReady() {
    const ok = await dashConfirm('Delete ALL files that are verified and past 48h cooldown?');
    if (!ok) {return;}
    try {
      const r = await fetch('/api/trash/delete-ready', { method: 'POST' });
      const data = await r.json();
      if (data.ok) {
        if (data.deleted > 0) {
          showToast(`Deleted ${data.deleted} file(s)${data.errors ? ` (${data.errors} errors)` : ''}`, 'success');
        } else {
          showToast('No files ready to delete (need 48h cooldown + GDrive verification)', 'info');
        }
        this.load();
      } else { showToast('Delete failed: ' + (data.error || 'unknown'), 'error'); }
    } catch (e: any) { showToast('Delete failed: ' + e.message, 'error'); }
  }

  private async _runArchiver() {
    const ok = await dashConfirm('Run the media archiver now? This will upload completed media to GDrive and move files to trash.');
    if (!ok) {return;}
    this.archiverRunning = true;
    this.archiverProgress = 'Starting...';
    try {
      const r = await fetch('/api/trash/run-archiver', { method: 'POST' });
      const data = await r.json();
      if (!data.ok) {
        this.archiverRunning = false;
        showToast(data.error || 'Failed to start', 'error');
        return;
      }
      this._pollTimer = window.setInterval(async () => {
        try {
          const pr = await fetch('/api/trash/archiver-progress');
          const job = await pr.json();
          this.archiverProgress = job.progress || 'Running...';
          if (job.status === 'done' || job.status === 'error') {
            clearInterval(this._pollTimer); this._pollTimer = 0;
            clearTimeout(this._pollTimeout); this._pollTimeout = 0;
            this.archiverRunning = false;
            showToast(job.status === 'done' ? 'Archiver complete' : 'Archiver failed: ' + (job.error || 'unknown'),
              job.status === 'done' ? 'success' : 'error');
            this.load();
          }
        } catch { /* keep polling */ }
      }, 2000);
      this._pollTimeout = window.setTimeout(() => {
        if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = 0; }
        this.archiverRunning = false;
      }, 600000);
    } catch {
      this.archiverRunning = false;
    }
  }

  render() {
    return html`
      <header class="view-header">
        <div class="view-header-left">
          <span class="view-eyebrow">Storage</span>
          <h2>Trash</h2>
        </div>
        <div class="view-header-actions">
          <button class="btn btn-ghost btn-sm"
                  ?disabled=${this.archiverRunning}
                  @click=${() => this._runArchiver()}>
            ${this.archiverRunning ? this.archiverProgress : 'Run Archiver'}
          </button>
          <button class="btn btn-ghost btn-sm trash-delete-all-btn"
                  @click=${() => this._deleteAllReady()}>Delete All Ready</button>
        </div>
      </header>

      ${this.loading ? html`<div class="trash-empty">Loading...</div>` : html`
        ${this._renderStats()}
        <div class="trash-info">
          Files are moved here after being uploaded and verified on Google Drive. You can permanently delete them after a 48-hour cooldown.
          Only files with a verified GDrive copy can be deleted.
        </div>
        ${this._renderList()}
      `}
    `;
  }

  private _renderStats() {
    if (!this.stats) {return '';}
    const s = this.stats;
    return html`
      <div class="trash-stats">
        <div class="trash-stat"><span class="trash-stat-value">${s.total_files || 0}</span><span class="trash-stat-label">Files</span></div>
        <div class="trash-stat"><span class="trash-stat-value">${this._bytes(s.total_size || 0)}</span><span class="trash-stat-label">Total Size</span></div>
        <div class="trash-stat"><span class="trash-stat-value">${s.verified || 0}</span><span class="trash-stat-label">Verified on GDrive</span></div>
        <div class="trash-stat"><span class="trash-stat-value">${s.deletable || 0}</span><span class="trash-stat-label">Ready to Delete</span></div>
      </div>
    `;
  }

  private _renderList() {
    if (!this.items.length) {
      return html`<div class="trash-empty">Trash is empty. Media archiver moves files here after uploading to GDrive.</div>`;
    }
    return html`
      <div class="trash-list">
        <table class="trash-table">
          <thead><tr><th>File</th><th>Size</th><th>Source</th><th>GDrive</th><th>Trashed</th><th>Action</th></tr></thead>
          <tbody>${this.items.map(item => this._renderRow(item))}</tbody>
        </table>
      </div>
    `;
  }

  private _renderRow(item: TrashItem) {
    const filename = item.original_path.split('/').pop() || '';
    const relPath = item.original_path.replace('/opt/AIWH/', '');
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    const sizeStr = this._bytes(item.file_size || 0);

    const trashedAt = item.trashed_at ? new Date(item.trashed_at) : null;
    const hoursAgo = trashedAt ? (Date.now() - trashedAt.getTime()) / 3600000 : 0;
    const canDelete = item.verified && hoursAgo >= 48;
    const cooldownLeft = Math.max(0, 48 - hoursAgo);
    const trashedStr = trashedAt ? (window as any).timeAgo(item.trashed_at) : '-';

    return html`<tr class="${item.deleted_at ? 'trash-row-deleted' : ''}">
      <td>
        <div class="trash-file-info">
          <span class="trash-file-icon">${this._icon(ext)}</span>
          <div>
            <div class="trash-filename">${filename}</div>
            <div class="trash-filepath">${relPath}</div>
          </div>
        </div>
      </td>
      <td>${sizeStr}</td>
      <td><span class="trash-source">${this._source(item.original_path)}</span></td>
      <td>${item.verified
        ? html`<span class="trash-verified" title="Verified on GDrive: ${item.gdrive_folder_path || ''}/${filename}">Verified</span>`
        : html`<span class="trash-unverified">Not verified</span>`}</td>
      <td>${trashedStr}</td>
      <td>${item.deleted_at
        ? html`<span class="trash-deleted-label">Deleted</span>`
        : canDelete
          ? html`<button class="btn btn-ghost btn-xs trash-delete-btn" @click=${() => this._deleteFile(item.id)}>Delete</button>`
          : !item.verified
            ? html`<span class="trash-cooldown">Upload not verified</span>`
            : html`<span class="trash-cooldown">${Math.ceil(cooldownLeft)}h cooldown</span>`
      }</td>
    </tr>`;
  }
}

declare global { interface HTMLElementTagNameMap { 'trash-view': TrashView; } }
