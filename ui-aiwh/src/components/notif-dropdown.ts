import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';

interface Notification {
  id: string;
  title: string;
  body?: string;
  priority?: string;
  read_at?: string;
  created_at: string;
}

@customElement('notif-dropdown')
export class NotifDropdown extends LitElement {
  @state() private items: Notification[] = [];
  @state() private loading = false;

  private _markReadTimer?: ReturnType<typeof setTimeout>;

  static styles = css`
    :host { display: block; }

    .notif-item {
      padding: 10px 14px; border-bottom: 1px solid rgba(201,168,76,0.06);
      cursor: default; transition: background 120ms;
    }
    .notif-item:hover { background: rgba(201,168,76,0.04); }
    .notif-item.unread { border-left: 2px solid var(--magenta, #C9A84C); }
    .notif-item.read { opacity: 0.6; }
    .notif-item.priority-high .notif-title { color: var(--critical, #E74C3C); }
    .notif-item.priority-urgent .notif-title { color: var(--critical, #E74C3C); font-weight: 600; }

    .notif-title {
      font-size: 13px; font-weight: 500; color: var(--text-primary, #F5EDD6);
      margin-bottom: 2px;
    }
    .notif-body {
      font-size: 12px; color: var(--text-muted, #8A8578);
      line-height: 1.4; margin-bottom: 4px;
    }
    .notif-time {
      font-size: 10px; color: var(--text-dim, #5A5548);
      font-family: 'JetBrains Mono', monospace;
    }
    .notif-empty {
      text-align: center; padding: 32px 16px;
      font-size: 13px; color: var(--text-muted, #8A8578);
    }
    .loading {
      text-align: center; padding: 24px;
      font-size: 12px; color: var(--text-muted, #8A8578);
    }

    :host-context([data-theme="light"]) .notif-title { color: #1a1a2e; }
    :host-context([data-theme="light"]) .notif-body { color: #555577; }
    :host-context([data-theme="light"]) .notif-item:hover { background: rgba(0,0,0,0.03); }
  `;

  /** Called by app.js when the notifications panel opens. */
  async load() {
    this.loading = true;
    try {
      const res = await fetch('/api/notifications?limit=20');
      this.items = await res.json() || [];
    } catch {
      this.items = [];
    } finally {
      this.loading = false;
    }

    // Mark as read after 2s of viewing
    if (this._markReadTimer) {clearTimeout(this._markReadTimer);}
    this._markReadTimer = setTimeout(() => {
      fetch('/api/notifications/read-all', { method: 'POST' }).catch(() => {});
    }, 2000);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._markReadTimer) {clearTimeout(this._markReadTimer);}
  }

  private _timeAgo(dateStr: string): string {
    if (!dateStr) {return 'never';}
    const diff = Date.now() - new Date(dateStr + (dateStr.endsWith('Z') ? '' : 'Z')).getTime();
    if (diff < 0 || diff < 60000) {return 'just now';}
    if (diff < 3600000) {return Math.floor(diff / 60000) + 'm ago';}
    if (diff < 86400000) {return Math.floor(diff / 3600000) + 'h ago';}
    return Math.floor(diff / 86400000) + 'd ago';
  }

  render() {
    if (this.loading) {
      return html`<div class="loading">Loading...</div>`;
    }
    if (!this.items.length) {
      return html`<div class="notif-empty">No notifications</div>`;
    }
    return html`
      ${this.items.map(n => html`
        <div class="notif-item ${n.read_at ? 'read' : 'unread'} priority-${n.priority || 'normal'}">
          <div class="notif-title">${n.title}</div>
          ${n.body ? html`<div class="notif-body">${n.body}</div>` : nothing}
          <div class="notif-time">${this._timeAgo(n.created_at)}</div>
        </div>
      `)}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap { 'notif-dropdown': NotifDropdown; }
}
