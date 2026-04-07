import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

interface ChannelAccount {
  accountId: string;
  name?: string;
  configured?: boolean;
  linked?: boolean;
  running?: boolean;
  connected?: boolean;
  reconnectAttempts?: number;
  lastConnectedAt?: number;
  lastStartAt?: number;
  lastStopAt?: number;
  lastError?: string;
  lastInboundAt?: number;
  lastOutboundAt?: number;
  bot?: { username?: string };
  application?: { intents?: Record<string, string> };
  mode?: string;
  dmPolicy?: string;
  tokenSource?: string;
}

interface ChannelData {
  id: string;
  label: string;
  accounts: ChannelAccount[];
}

const RECENT_MS = 600_000; // 10 minutes

@customElement('channel-health')
export class ChannelHealth extends LitElement {
  @property({ type: Boolean }) compact = false;
  @property({ type: Boolean, attribute: 'show-actions' }) showActions = false;

  @state() private channels: ChannelData[] = [];
  @state() private loading = true;
  @state() private error = '';

  static styles = css`
    :host { display: block; font-family: 'Inter', -apple-system, sans-serif; color: var(--text-primary, #F5EDD6); }

    /* Grid */
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }
    :host([compact]) .grid { grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 10px; }

    /* Card — uses theme variables from host page (pierce shadow DOM) */
    .card {
      background: var(--surface, rgba(14, 14, 18, 0.65)); border: 1px solid var(--border-dim, rgba(201, 168, 76, 0.08));
      border-radius: 12px; padding: 18px; transition: border-color 200ms, box-shadow 200ms;
    }
    .card:hover { border-color: var(--border-subtle, rgba(201, 168, 76, 0.18)); box-shadow: var(--shadow-sm, 0 2px 12px rgba(0,0,0,0.3)); }
    .card-title {
      font-size: 15px; font-weight: 600; letter-spacing: -0.02em;
      display: flex; align-items: center; gap: 8px;
    }
    .card-sub { color: var(--text-muted, #8A8578); font-size: 13px; margin-top: 4px; }

    /* Status indicator dot */
    .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
    .dot-live { background: #4CAF7A; box-shadow: 0 0 6px rgba(76,175,122,0.5); }
    .dot-active { background: #4CAF7A; box-shadow: 0 0 8px rgba(76,175,122,0.6); animation: pulse 2s infinite; }
    .dot-run  { background: #C9A84C; box-shadow: 0 0 6px rgba(201,168,76,0.4); }
    .dot-cfg  { background: #8A8578; }
    .dot-off  { background: #E05252; }
    @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }

    /* Status list — OpenClaw pattern: label-value rows with dividers */
    .status-list { display: grid; gap: 0; margin-top: 12px; }
    .status-row {
      display: flex; justify-content: space-between; align-items: center;
      gap: 12px; padding: 7px 0; border-bottom: 1px solid var(--border-faint, rgba(201,168,76,0.05));
      font-size: 13px;
    }
    .status-row:last-child { border-bottom: none; }
    .status-label { color: var(--text-muted, #8A8578); }
    .status-value { font-family: 'JetBrains Mono', monospace; font-size: 12px; text-align: right; }
    .status-value.ok { color: #4CAF7A; }
    .status-value.warn { color: #C9A84C; }
    .status-value.err { color: #E05252; }
    .status-value.muted { color: var(--text-muted, #8A8578); }

    /* Account cards — for multi-account channels */
    .account-count { font-size: 12px; font-weight: 500; color: var(--text-muted, #8A8578); margin-top: 10px; }
    .account-list { display: grid; gap: 10px; margin-top: 10px; }
    .account-card {
      border: 1px solid rgba(201,168,76,0.06); border-radius: 8px;
      padding: 12px; background: rgba(18,18,26,0.4); transition: border-color 150ms;
    }
    .account-card:hover { border-color: rgba(201,168,76,0.15); }
    .account-header {
      display: flex; justify-content: space-between; align-items: baseline; gap: 12px;
    }
    .account-title { font-weight: 500; display: flex; align-items: center; gap: 6px; }
    .account-id { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--text-muted, #8A8578); }

    /* Error callout */
    .error-callout {
      margin-top: 8px; padding: 8px 10px; border-radius: 6px;
      background: rgba(224,82,82,0.08); border-left: 3px solid #E05252;
      color: #E05252; font-size: 12px; font-family: 'JetBrains Mono', monospace;
      word-break: break-word;
    }

    /* Intents */
    .intents { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 6px; }
    .intent { font-size: 10px; padding: 2px 5px; border-radius: 3px; font-family: 'JetBrains Mono', monospace; }
    .intent-ok { background: rgba(76,175,122,0.10); color: #4CAF7A; }
    .intent-miss { background: rgba(224,82,82,0.10); color: #E05252; }

    /* Actions */
    .actions { display: flex; gap: 6px; margin-top: 12px; padding-top: 10px; border-top: 1px solid rgba(201,168,76,0.06); }
    .btn {
      font-size: 11px; padding: 5px 12px; border-radius: 6px; border: none;
      cursor: pointer; font-family: 'Inter', sans-serif; font-weight: 500; transition: all 150ms;
    }
    .btn-primary { background: rgba(201,168,76,0.15); color: #C9A84C; }
    .btn-primary:hover { background: rgba(201,168,76,0.25); }
    .btn-ghost { background: transparent; color: var(--text-muted, #8A8578); border: 1px solid rgba(201,168,76,0.10); }
    .btn-ghost:hover { border-color: rgba(201,168,76,0.25); color: var(--text-primary, #F5EDD6); }

    .loading, .error-msg, .empty { text-align: center; padding: 32px 16px; color: var(--text-muted, #8A8578); font-size: 13px; }
    .error-msg { color: #E05252; }
  `;

  connectedCallback() {
    super.connectedCallback();
    this.fetchChannels();
  }

  async fetchChannels() {
    this.loading = true; this.error = '';
    try {
      const res = await fetch('/api/channels/health');
      if (!res.ok) {throw new Error(`HTTP ${res.status}`);}
      this.channels = (await res.json()).channels || [];
    } catch (e: unknown) {
      this.error = e instanceof Error ? e.message : 'Failed to load';
    } finally { this.loading = false; }
  }

  // Activity detection (matches OpenClaw pattern)
  private _hasRecent(ts?: number) { return !!ts && (Date.now() - ts) < RECENT_MS; }

  private _runStatus(a: ChannelAccount): [string, string] {
    if (this._hasRecent(a.lastInboundAt)) {return ['Active', 'ok'];}
    if (a.running) {return ['Yes', 'ok'];}
    return ['No', 'muted'];
  }

  private _connStatus(a: ChannelAccount): [string, string] {
    if (this._hasRecent(a.lastInboundAt)) {return ['Active', 'ok'];}
    if (a.connected) {return ['Yes', 'ok'];}
    if (a.running && !a.connected) {return ['No', 'warn'];}
    return ['n/a', 'muted'];
  }

  private _dotClass(a: ChannelAccount) {
    if (this._hasRecent(a.lastInboundAt)) {return 'dot-active';}
    if (a.connected) {return 'dot-live';}
    if (a.running) {return 'dot-run';}
    if (a.configured) {return 'dot-cfg';}
    return 'dot-off';
  }

  private _ago(ts?: number): string {
    if (!ts) {return 'never';}
    const d = Date.now() - ts;
    if (d < 60000) {return 'just now';}
    if (d < 3600000) {return Math.floor(d / 60000) + 'm ago';}
    if (d < 86400000) {return Math.floor(d / 3600000) + 'h ago';}
    return Math.floor(d / 86400000) + 'd ago';
  }

  private _parseErr(err?: string): string {
    if (!err) {return '';}
    try {
      const o = JSON.parse(err);
      const msg = o?.error?.output?.payload?.message || o?.error?.message || o?.message;
      const reason = o?.error?.data?.reason;
      return msg && reason ? `${msg} (${reason})` : msg || err.slice(0, 120);
    } catch { return err.length > 120 ? err.slice(0, 120) + '...' : err; }
  }

  private _fire(name: string, detail: unknown) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  render() {
    if (this.loading) {return html`<div class="loading">Loading channels...</div>`;}
    if (this.error) {return html`<div class="error-msg">${this.error}</div>`;}
    if (!this.channels.length) {return html`<div class="empty">No channels configured</div>`;}
    return html`<div class="grid">${this.channels.map(ch => this._card(ch))}</div>`;
  }

  private _card(ch: ChannelData) {
    const multi = ch.accounts.length > 1;
    return html`
      <div class="card">
        <div class="card-title">
          <span class="dot ${this._dotClass(ch.accounts[0])}"></span>
          ${ch.label}
        </div>
        ${multi ? html`
          <div class="account-count">${ch.accounts.length} accounts</div>
          <div class="account-list">${ch.accounts.map(a => this._acctCard(ch, a))}</div>
        ` : this._statusBlock(ch, ch.accounts[0])}
        ${this.showActions ? html`
          <div class="actions">
            <button class="btn btn-primary" @click=${() => this._fire('channel-settings', { channel: ch.id })}>Settings</button>
            <button class="btn btn-ghost" @click=${() => this._fire('channel-remove', { channel: ch.id, accountId: ch.accounts[0]?.accountId })}>Remove</button>
          </div>
        ` : nothing}
      </div>`;
  }

  private _acctCard(ch: ChannelData, a: ChannelAccount) {
    return html`
      <div class="account-card">
        <div class="account-header">
          <span class="account-title"><span class="dot ${this._dotClass(a)}"></span>${a.name || a.accountId}</span>
          ${a.name ? html`<span class="account-id">${a.accountId}</span>` : nothing}
        </div>
        ${this._statusRows(a)}
        ${this._errorBlock(a)}
      </div>`;
  }

  private _statusBlock(ch: ChannelData, a: ChannelAccount) {
    return html`
      ${a.bot?.username ? html`<div class="card-sub">@${a.bot.username}</div>` : nothing}
      ${this._statusRows(a)}
      ${this._intentsBlock(a)}
      ${this._errorBlock(a)}
    `;
  }

  private _statusRows(a: ChannelAccount) {
    const [runText, runCls] = this._runStatus(a);
    const [connText, connCls] = this._connStatus(a);
    return html`
      <div class="status-list">
        <div class="status-row">
          <span class="status-label">Configured</span>
          <span class="status-value ${a.configured ? 'ok' : 'muted'}">${a.configured ? 'Yes' : 'No'}</span>
        </div>
        ${a.linked !== undefined ? html`
          <div class="status-row">
            <span class="status-label">Linked</span>
            <span class="status-value ${a.linked ? 'ok' : 'muted'}">${a.linked ? 'Yes' : 'No'}</span>
          </div>
        ` : nothing}
        <div class="status-row">
          <span class="status-label">Running</span>
          <span class="status-value ${runCls}">${runText}</span>
        </div>
        <div class="status-row">
          <span class="status-label">Connected</span>
          <span class="status-value ${connCls}">${connText}</span>
        </div>
        <div class="status-row">
          <span class="status-label">Last connected</span>
          <span class="status-value muted">${this._ago(a.lastConnectedAt)}</span>
        </div>
        <div class="status-row">
          <span class="status-label">Last inbound</span>
          <span class="status-value ${this._hasRecent(a.lastInboundAt) ? 'ok' : 'muted'}">${this._ago(a.lastInboundAt)}</span>
        </div>
        <div class="status-row">
          <span class="status-label">Last outbound</span>
          <span class="status-value muted">${this._ago(a.lastOutboundAt)}</span>
        </div>
        ${(a.reconnectAttempts || 0) > 0 ? html`
          <div class="status-row">
            <span class="status-label">Reconnect attempts</span>
            <span class="status-value warn">${a.reconnectAttempts}</span>
          </div>
        ` : nothing}
      </div>`;
  }

  private _intentsBlock(a: ChannelAccount) {
    const intents = a.application?.intents;
    if (!intents) {return nothing;}
    return html`<div class="intents">${Object.entries(intents).map(([k, v]) =>
      html`<span class="intent ${v === 'granted' ? 'intent-ok' : 'intent-miss'}">${k}: ${v}</span>`
    )}</div>`;
  }

  private _errorBlock(a: ChannelAccount) {
    const err = this._parseErr(a.lastError);
    if (!err) {return nothing;}
    return html`<div class="error-callout">${err}</div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'channel-health': ChannelHealth;
  }
}
