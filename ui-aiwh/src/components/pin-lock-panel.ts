import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';

@customElement('pin-lock-panel')
export class PinLockPanel extends LitElement {
  @state() private hasPin = false;
  @state() private loading = true;
  @state() private canManagePin = false;
  @state() private pinInput = '';
  @state() private showSetForm = false;
  @state() private msg = '';
  @state() private msgType: 'ok' | 'err' = 'ok';

  static styles = css`
    :host { display: block; font-family: 'Inter', -apple-system, sans-serif; color: var(--text-primary, #F5EDD6); }
    .card { background: var(--surface); border: 1px solid var(--border-dim); border-radius: 6px; padding: 20px; margin-bottom: 16px; }
    .card h3 { margin: 0 0 12px; font-size: 14px; font-weight: 600; color: var(--magenta, #C9A84C); text-transform: uppercase; letter-spacing: 0.5px; }
    .status-row { display: flex; align-items: center; gap: 10px; font-size: 13px; }
    .dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    .dot.ok { background: var(--success, #4CAF7A); }
    .dot.off { background: var(--text-muted, #8A8578); }
    .pin-form { display: flex; gap: 8px; align-items: center; margin-top: 12px; }
    .pin-form input {
      width: 120px; padding: 8px 12px; background: var(--void, #0A0A0C); border: 1px solid var(--border-dim);
      border-radius: 4px; color: var(--text-primary); font-size: 16px; font-family: 'JetBrains Mono', monospace;
      letter-spacing: 4px; text-align: center; outline: none;
    }
    .pin-form input:focus { border-color: var(--magenta, #C9A84C); }
    button {
      padding: 6px 12px; border: 1px solid var(--border-dim); border-radius: 4px;
      background: var(--magenta-dim); color: var(--magenta, #C9A84C); font-size: 11px;
      font-weight: 600; cursor: pointer; white-space: nowrap;
    }
    button:hover { background: var(--magenta-glow); border-color: var(--magenta, #C9A84C); }
    button.danger { color: var(--critical, #E05252); border-color: rgba(224,82,82,0.2); background: rgba(224,82,82,0.06); }
    button.danger:hover { background: rgba(224,82,82,0.15); border-color: var(--critical); }
    button.primary { background: var(--magenta, #C9A84C); color: var(--void, #0A0A0C); }
    button.primary:hover { background: var(--gold-hot, #F0C040); }
    .msg { margin-top: 10px; font-size: 12px; padding: 8px 12px; border-radius: 4px; }
    .msg.ok { background: rgba(76,175,122,0.1); color: var(--success, #4CAF7A); }
    .msg.err { background: rgba(224,82,82,0.1); color: var(--critical, #E05252); }
    .desc { font-size: 12px; color: var(--text-muted); margin-top: 6px; line-height: 1.5; }
  `;

  connectedCallback() { super.connectedCallback(); this._load(); }

  async _load() {
    this.loading = true;
    try {
      const authRes = await fetch('/api/auth/status');
      if (!authRes.ok) { this.loading = false; return; }
      const authData = await authRes.json();
      const role = authData.user?.role;
      const ccs = authData.user?.commandCentres || [];
      this.canManagePin = role === 'owner' || (role === 'admin' && (ccs.includes('wealth') || ccs.includes('life')));
      if (!this.canManagePin) { this.loading = false; return; }
      const pinRes = await fetch('/api/auth/pin/status');
      if (pinRes.ok) { const pinData = await pinRes.json(); this.hasPin = pinData.hasPin || false; }
    } catch { /* fallback */ }
    this.loading = false;
  }

  _showMsg(text: string, type: 'ok' | 'err' = 'ok') {
    this.msg = text; this.msgType = type;
    setTimeout(() => { this.msg = ''; }, 5000);
  }

  async _setPin() {
    if (!/^\d{4,6}$/.test(this.pinInput)) { this._showMsg('PIN must be 4-6 digits', 'err'); return; }
    try {
      const res = await fetch('/api/auth/pin/set', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: this.pinInput }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      this._showMsg('PIN set successfully');
      this.pinInput = ''; this.showSetForm = false; this.hasPin = true;
      window.dispatchEvent(new CustomEvent('pin-changed', { detail: { hasPin: true } }));
    } catch (err: unknown) { this._showMsg((err as Error).message, 'err'); }
  }

  async _removePin() {
    if (!confirm('Remove the Wealth & Life PIN lock? Anyone with dashboard access will be able to view these sections.')) return;
    try {
      const res = await fetch('/api/auth/pin/remove', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      this._showMsg('PIN removed');
      this.hasPin = false;
      window.dispatchEvent(new CustomEvent('pin-changed', { detail: { hasPin: false } }));
    } catch (err: unknown) { this._showMsg((err as Error).message, 'err'); }
  }

  render() {
    if (this.loading || !this.canManagePin) return nothing;

    return html`
      <div class="card">
        <h3>PIN Lock</h3>
        <div class="status-row">
          <span class="dot ${this.hasPin ? 'ok' : 'off'}"></span>
          <span>${this.hasPin ? 'PIN is active — Wealth & Life sections require PIN entry' : 'No PIN set — Wealth & Life sections are open'}</span>
        </div>
        <p class="desc">A 4-6 digit PIN adds an extra layer of protection to your personal Wealth and Life command centres.</p>

        ${this.hasPin ? html`
          <div style="margin-top:12px;display:flex;gap:8px;">
            <button class="danger" @click=${this._removePin}>Remove PIN</button>
          </div>
        ` : html`
          ${this.showSetForm ? html`
            <div class="pin-form">
              <input type="password" maxlength="6" placeholder="••••" .value=${this.pinInput}
                @input=${(e: Event) => { this.pinInput = (e.target as HTMLInputElement).value; }}
                @keydown=${(e: KeyboardEvent) => { if (e.key === 'Enter') this._setPin(); }} />
              <button class="primary" @click=${this._setPin}>Confirm</button>
              <button @click=${() => { this.showSetForm = false; this.pinInput = ''; }}>Cancel</button>
            </div>
          ` : html`
            <div style="margin-top:12px;">
              <button @click=${() => { this.showSetForm = true; }}>Set PIN</button>
            </div>
          `}
        `}
        ${this.msg ? html`<div class="msg ${this.msgType}">${this.msg}</div>` : ''}
      </div>
    `;
  }
}
