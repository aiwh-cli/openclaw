import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';

type Member = { id: string; email: string; status: string; createdAt: string };
type DeviceStatus = { registered: boolean; clientId: string | null; clientName: string | null };

@customElement('team-access-panel')
export class TeamAccessPanel extends LitElement {
  @state() private members: Member[] = [];
  @state() private device: DeviceStatus = { registered: false, clientId: null, clientName: null };
  @state() private loading = true;
  @state() private inviteEmail = '';
  @state() private actionMsg = '';
  @state() private actionType: 'ok' | 'err' = 'ok';

  static styles = css`
    :host {
      display: block;
      font-family: 'Inter', -apple-system, sans-serif;
      color: var(--text-primary, #F5EDD6);
    }
    .card {
      background: var(--surface);
      border: 1px solid var(--border-dim);
      border-radius: 6px;
      padding: 20px;
      margin-bottom: 16px;
    }
    .card h3 {
      margin: 0 0 12px;
      font-size: 14px;
      font-weight: 600;
      color: var(--magenta, #C9A84C);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .device-status {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 13px;
    }
    .dot {
      width: 8px; height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .dot.ok { background: var(--success, #4CAF7A); }
    .dot.warn { background: var(--amber, #F0C040); }
    .device-id {
      font-size: 11px;
      color: var(--text-muted);
      font-family: 'JetBrains Mono', monospace;
    }
    .invite-form {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .invite-form input {
      flex: 1;
      padding: 8px 12px;
      background: var(--void, #0A0A0C);
      border: 1px solid var(--border-dim);
      border-radius: 4px;
      color: var(--text-primary, #F5EDD6);
      font-size: 13px;
      font-family: 'JetBrains Mono', monospace;
      outline: none;
    }
    .invite-form input:focus {
      border-color: var(--magenta, #C9A84C);
    }
    .invite-form input::placeholder { color: var(--text-muted); }
    button {
      padding: 8px 16px;
      border: 1px solid var(--border-dim);
      border-radius: 4px;
      background: var(--magenta-dim);
      color: var(--magenta, #C9A84C);
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
    }
    button:hover {
      background: var(--magenta-glow);
      border-color: var(--magenta, #C9A84C);
    }
    button.danger {
      color: var(--critical, #E05252);
      border-color: rgba(var(--critical-rgb, 224, 82, 82), 0.2);
      background: rgba(var(--critical-rgb, 224, 82, 82), 0.06);
    }
    button.danger:hover {
      background: rgba(var(--critical-rgb, 224, 82, 82), 0.15);
      border-color: var(--critical, #E05252);
    }
    button:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    .members-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .member-row {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 14px;
      background: var(--surface-hi, rgba(20, 20, 24, 0.80));
      border: 1px solid var(--border-dim);
      border-radius: 4px;
    }
    .member-email {
      flex: 1;
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
    }
    .badge {
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    .badge.pending {
      background: rgba(var(--amber-rgb, 240, 192, 64), 0.12);
      color: var(--amber, #F0C040);
    }
    .badge.accepted {
      background: rgba(var(--success-rgb, 76, 175, 122), 0.12);
      color: var(--success, #4CAF7A);
    }
    .member-date {
      font-size: 11px;
      color: var(--text-muted);
    }
    .member-actions {
      display: flex;
      gap: 6px;
    }
    .member-actions button { padding: 4px 10px; font-size: 11px; }
    .msg {
      margin-top: 10px;
      font-size: 12px;
      padding: 8px 12px;
      border-radius: 4px;
    }
    .msg.ok { background: rgba(var(--success-rgb, 76, 175, 122), 0.1); color: var(--success, #4CAF7A); }
    .msg.err { background: rgba(var(--critical-rgb, 224, 82, 82), 0.1); color: var(--critical, #E05252); }
    .empty {
      text-align: center;
      padding: 24px;
      color: var(--text-muted);
      font-size: 13px;
    }
    .loading {
      text-align: center;
      padding: 32px;
      color: var(--text-muted);
    }
    .desc {
      font-size: 13px;
      color: var(--text-muted);
      margin-bottom: 14px;
      line-height: 1.5;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    this._load();
  }

  async _load() {
    this.loading = true;
    try {
      const [devRes, memRes] = await Promise.all([
        fetch('/api/team/device-status'),
        fetch('/api/team/members'),
      ]);
      this.device = await devRes.json();
      const data = await memRes.json();
      this.members = data.members || [];
    } catch {
      this.members = [];
    }
    this.loading = false;
  }

  _showMsg(text: string, type: 'ok' | 'err' = 'ok') {
    this.actionMsg = text;
    this.actionType = type;
    setTimeout(() => { this.actionMsg = ''; }, 4000);
  }

  async _invite() {
    const email = this.inviteEmail.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) {
      this._showMsg('Enter a valid email address', 'err');
      return;
    }
    try {
      const res = await fetch('/api/team/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {throw new Error(data.error);}
      this.inviteEmail = '';
      this._showMsg(`Invite sent to ${email}`);
      this._load();
    } catch (err: unknown) {
      this._showMsg((err as Error).message || 'Invite failed', 'err');
    }
  }

  async _revoke(email: string) {
    try {
      const res = await fetch(`/api/team/invite/${encodeURIComponent(email)}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' } });
      const data = await res.json();
      if (!res.ok) {throw new Error(data.error);}
      this._showMsg(`Access revoked for ${email}`);
      this._load();
    } catch (err: unknown) {
      this._showMsg((err as Error).message || 'Revoke failed', 'err');
    }
  }

  async _resend(email: string) {
    try {
      const res = await fetch(`/api/team/resend/${encodeURIComponent(email)}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {throw new Error(data.error);}
      this._showMsg(`Invite resent to ${email}`);
      this._load();
    } catch (err: unknown) {
      this._showMsg((err as Error).message || 'Resend failed', 'err');
    }
  }

  async _registerDevice() {
    try {
      const res = await fetch('/api/team/register-device', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {throw new Error(data.error);}
      this._showMsg('Device registered');
      this._load();
    } catch (err: unknown) {
      this._showMsg((err as Error).message || 'Registration failed', 'err');
    }
  }

  _fmtDate(iso: string) {
    if (!iso) {return '';}
    try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
    catch { return iso; }
  }

  render() {
    if (this.loading) {return html`<div class="loading">Loading team access...</div>`;}

    return html`
      <!-- Device Status -->
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
      </div>

      <!-- Add Team Member -->
      <div class="card">
        <h3>Add Team Member</h3>
        <p class="desc">
          Enter your team member's email. They'll receive an invite to install Tailscale
          and connect to this dashboard securely.
        </p>
        <div class="invite-form">
          <input
            type="email"
            placeholder="va@example.com"
            .value=${this.inviteEmail}
            @input=${(e: Event) => { this.inviteEmail = (e.target as HTMLInputElement).value; }}
            @keydown=${(e: KeyboardEvent) => { if (e.key === 'Enter') {this._invite();} }}
            ?disabled=${!this.device.registered}
          />
          <button @click=${this._invite} ?disabled=${!this.device.registered}>
            Send Invite
          </button>
        </div>
        ${!this.device.registered ? html`<div class="msg err">Register your device first to enable team invites.</div>` : ''}
        ${this.actionMsg ? html`<div class="msg ${this.actionType}">${this.actionMsg}</div>` : ''}
      </div>

      <!-- Team Members List -->
      <div class="card">
        <h3>Team Members</h3>
        ${this.members.length === 0
          ? html`<div class="empty">No team members yet. Add someone above to get started.</div>`
          : html`
            <div class="members-list">
              ${this.members.map(m => html`
                <div class="member-row">
                  <span class="member-email">${m.email}</span>
                  <span class="badge ${m.status}">${m.status}</span>
                  <span class="member-date">${this._fmtDate(m.createdAt)}</span>
                  <div class="member-actions">
                    ${m.status === 'pending' ? html`
                      <button @click=${() => this._resend(m.email)}>Resend</button>
                    ` : ''}
                    <button class="danger" @click=${() => this._revoke(m.email)}>Revoke</button>
                  </div>
                </div>
              `)}
            </div>
          `}
      </div>
    `;
  }
}
