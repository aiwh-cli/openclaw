import { LitElement, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { securityStyles } from './security-styles.js';
import type { TrashItem, TrashData } from './security-types.js';

@customElement('security-trash-tab')
export class SecurityTrashTab extends LitElement {
  static styles = securityStyles;

  @property({ type: Object }) trash: TrashData | null = null;

  private _bytes(b: number) {
    if (!b) {return '0 B';}
    const k = 1024, s = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(b) / Math.log(k));
    return parseFloat((b / Math.pow(k, i)).toFixed(1)) + ' ' + s[i];
  }

  private _s(p: string) { return (p || '').replace('/opt/AIWH/', ''); }

  private async _restore(item: TrashItem) {
    const defaultDest = item.originPath || `/opt/AIWH/client/content/${item.name}`;
    const dest = prompt(`Restore "${item.name}" to:`, defaultDest);
    if (!dest) {return;}
    try {
      const r = await fetch('/api/security/trash/restore', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trashPath: item.path, restorePath: dest }),
      }).then(r => r.json());
      if (r?.ok) {this.dispatchEvent(new CustomEvent('reload'));}
    } catch { alert('Restore failed'); }
  }

  render() {
    const items = this.trash?.items || [];
    if (!items.length) {return html`<div class="empty">Trash is empty. Files deleted by agents are held here for 48 hours before permanent removal.</div>`;}
    return html`
      <p style="color:#8A8578;font-size:12px;margin-bottom:12px">${items.length} items, ${this._bytes(this.trash?.totalSize || 0)}</p>
      <table>
        <thead><tr><th>File</th><th>Original Location</th><th>Trashed</th><th>Expires</th><th>Size</th><th></th></tr></thead>
        <tbody>
          ${items.map(i => html`<tr>
            <td><code>${i.name}</code></td>
            <td><code class="path" title="${i.originPath}" style="opacity:0.7;font-size:10px">${i.originPath ? this._s(i.originPath) : '—'}</code></td>
            <td style="font-size:11px">${i.date}</td>
            <td style="font-size:11px;color:${i.expired ? '#E05252' : '#8A8578'}">${i.expired ? 'Expired' : new Date(i.expiresAt).toLocaleString()}</td>
            <td style="font-size:11px">${this._bytes(i.size)}</td>
            <td>${!i.expired ? html`<button class="btn" @click=${() => this._restore(i)}>Restore</button>` : ''}</td>
          </tr>`)}
        </tbody>
      </table>`;
  }
}

declare global { interface HTMLElementTagNameMap { 'security-trash-tab': SecurityTrashTab; } }
