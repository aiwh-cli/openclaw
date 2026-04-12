import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';

type DeviceStatus = { registered: boolean; clientId: string | null; clientName: string | null };

@customElement('team-access-panel')
export class TeamAccessPanel extends LitElement {
  @state() private device: DeviceStatus = { registered: false, clientId: null, clientName: null };
  @state() private loading = true;
  @state() private msg = '';
  @state() private msgType: 'ok' | 'err' = 'ok';

  static styles = css`
    :host { display: block; font-family: 'Inter', -apple-system, sans-serif; color: var(--text-primary, #F5EDD6); }
    .card { background: var(--surface); border: 1px solid var(--border-dim); border-radius: 6px; padding: 20px; margin-bottom: 16px; }
    .card h3 { margin: 0 0 12px; font-size: 14px; font-weight: 600; color: var(--magenta, #C9A84C); text-transform: uppercase; letter-spacing: 0.5px; }
    .device-status { display: flex; align-items: center; gap: 10px; font-size: 13px; }
    .dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    .dot.ok { background: var(--success, #4CAF7A); }
    .dot.warn { background: var(--amber, #F0C040); }
    .device-id { font-size: 11px; color: var(--text-muted); font-family: 'JetBrains Mono', monospace; }
    button { padding: 8px 16px; border: 1px solid var(--border-dim); border-radius: 4px; background: var(--magenta-dim); color: var(--magenta, #C9A84C); font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap; }
    button:hover { background: var(--magenta-glow); border-color: var(--magenta, #C9A84C); }
    .msg { margin-top: 10px; font-size: 12px; padding: 8px 12px; border-radius: 4px; }
    .msg.ok { background: rgba(76,175,122,0.1); color: var(--success, #4CAF7A); }
    .msg.err { background: rgba(224,82,82,0.1); color: var(--critical, #E05252); }
    .loading { text-align: center; padding: 32px; color: var(--text-muted); }
  `;

  connectedCallback() { super.connectedCallback(); this._load(); }

  async _load() {
    this.loading = true;
    try {
      const res = await fetch('/api/team/device-status');
      this.device = await res.json();
    } catch { /* fallback */ }
    this.loading = false;
  }

  _showMsg(text: string, type: 'ok' | 'err' = 'ok') {
    this.msg = text; this.msgType = type;
    setTimeout(() => { this.msg = ''; }, 4000);
  }

  async _registerDevice() {
    try {
      const res = await fetch('/api/team/register-device', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      this._showMsg('Device registered');
      this._load();
    } catch (err: unknown) { this._showMsg((err as Error).message || 'Registration failed', 'err'); }
  }

  render() {
    if (this.loading) return html`<div class="loading">Loading device status...</div>`;
    return html`
      <div class="card">
        <h3>Device</h3>
        <div class="device-status">
          <span class="dot ${this.device.registered ? 'ok' : 'warn'}"></span>
          ${this.device.registered
            ? html`<span><strong>${this.device.clientName || this.device.clientId}</strong>${this.device.clientName ? html`<br><span class="device-id">${this.device.clientId}</span>` : ''}</span>`
            : html`
              <span>Device not registered for team management</span>
              <button @click=${this._registerDevice}>Register Device</button>
            `}
        </div>
        ${this.msg ? html`<div class="msg ${this.msgType}">${this.msg}</div>` : ''}
      </div>
    `;
  }
}
