import { LitElement, html, nothing, render as litRender } from 'lit';
import { customElement, state } from 'lit/decorators.js';

interface Connector {
  id: string; name: string; description: string; agents: string[];
  module: string; category: string; priority: string; authType: string;
  verified: boolean; docs_url: string; notes: string;
  credentials_required: string[];
  credential_hints: Record<string, string>;
  connected: boolean; has_credentials: boolean;
}

const CATEGORY_LABELS: Record<string, string> = {
  sales: 'Sales & CRM',
  finance: 'Finance',
  content: 'Content Creation',
  productivity: 'Productivity',
  infrastructure: 'Infrastructure',
  health: 'Health & Fitness',
  other: 'Other',
};
const CATEGORY_ORDER = ['sales', 'finance', 'content', 'productivity', 'infrastructure', 'health', 'other'];

const api = (window as any).api as (url: string, opts?: any) => Promise<any>;
const escHtml = (window as any).escHtml as (s: string) => string;
const showToast = (window as any).showToast as (msg: string, type?: string) => void;

@customElement('connectors-view')
export class ConnectorsView extends LitElement {
  createRenderRoot() { return this; }

  @state() private connectors: Connector[] = [];
  @state() private loading = true;
  @state() private filter = '';
  @state() private connectingId: string | null = null;
  @state() private credentialInputs: Record<string, string> = {};
  @state() private testingId: string | null = null;
  @state() private testResult: { id: string; ok: boolean; message: string } | null = null;
  private _portalEl: HTMLDivElement | null = null;

  connectedCallback() { super.connectedCallback(); this.load(); }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._removePortal();
  }

  async load() {
    this.loading = true;
    try {
      const res = await api('/connectors');
      this.connectors = res?.connectors || [];
    } catch { this.connectors = []; }
    finally { this.loading = false; }
  }

  private _filtered() {
    let list = this.connectors;
    if (this.filter) {
      const q = this.filter.toLowerCase();
      list = list.filter(c =>
        c.id.includes(q) || c.name.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        c.agents.some(a => a.includes(q)) ||
        (CATEGORY_LABELS[c.category] || '').toLowerCase().includes(q)
      );
    }
    // Connected first within each category
    return [...list].sort((a, b) => {
      if (a.connected && !b.connected) return -1;
      if (!a.connected && b.connected) return 1;
      return 0;
    });
  }

  /** Group filtered connectors by category in display order */
  private _grouped(): Array<{ category: string; label: string; connectors: Connector[] }> {
    const filtered = this._filtered();
    const groups: Record<string, Connector[]> = {};
    for (const c of filtered) {
      const cat = c.category || 'other';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(c);
    }
    return CATEGORY_ORDER
      .filter(cat => groups[cat]?.length)
      .map(cat => ({ category: cat, label: CATEGORY_LABELS[cat] || cat, connectors: groups[cat] }));
  }

  private _openConnect(c: Connector) {
    this.connectingId = c.id;
    this.credentialInputs = {};
    c.credentials_required.forEach(k => { this.credentialInputs[k] = ''; });
    this.requestUpdate();
  }

  private _closeConnect() {
    this.connectingId = null;
    this.credentialInputs = {};
  }

  private async _submitConnect() {
    const id = this.connectingId;
    if (!id) return;
    const empty = Object.entries(this.credentialInputs).filter(([, v]) => !v.trim());
    if (empty.length > 0) { showToast('Please fill in all credential fields', 'error'); return; }
    try {
      const res = await api(`/connectors/${id}/connect`, {
        method: 'POST', body: { credentials: this.credentialInputs },
      });
      if (res?.ok) {
        if (res.mcp === false) {
          showToast('Credentials saved but tools failed to load — try disconnecting and reconnecting', 'warning');
        } else {
          showToast('Connected — your AI system is restarting to load the new tools', 'success');
        }
        this._closeConnect();
        await this.load();
      } else {
        showToast(res?.error || 'Failed to connect', 'error');
      }
    } catch { showToast('Failed to connect', 'error'); }
  }

  private async _disconnect(id: string) {
    try {
      const res = await api(`/connectors/${id}/disconnect`, { method: 'POST' });
      if (res?.ok) {
        showToast('Disconnected — your AI system is restarting to remove the tools', 'info');
        if (this.testResult?.id === id) this.testResult = null;
        await this.load();
      } else { showToast(res?.error || 'Failed to disconnect', 'error'); }
    } catch { showToast('Failed to disconnect', 'error'); }
  }

  private async _test(id: string) {
    this.testingId = id;
    this.testResult = null;
    try {
      const res = await api(`/connectors/${id}/test`);
      this.testResult = { id, ok: res?.ok || false, message: res?.message || 'Unknown result' };
    } catch { this.testResult = { id, ok: false, message: 'Connection test failed' }; }
    finally { this.testingId = null; }
  }

  private _priorityBadge(p: string) {
    const cls = p === 'P1' ? 'conn-badge-p1' : 'conn-badge-p2';
    return html`<span class="conn-badge ${cls}">${p}</span>`;
  }

  private _statusBadge(c: Connector) {
    if (c.connected) return html`<span class="conn-badge conn-badge-on">Connected</span>`;
    return html`<span class="conn-badge conn-badge-off">Not connected</span>`;
  }

  render() {
    return html`
      <div class="conn-summary">
        <div>
          <div class="conn-summary-stat">${this.connectors.length}</div>
          <div class="conn-summary-label">Available</div>
        </div>
        <div class="conn-summary-divider"></div>
        <div>
          <div class="conn-summary-stat" style="color:#4CAF50">${this.connectors.filter(c => c.connected).length}</div>
          <div class="conn-summary-label">Connected</div>
        </div>
      </div>

      <div class="conn-toolbar">
        <input class="conn-filter" placeholder="Search connectors..."
          .value=${this.filter}
          @input=${(e: Event) => { this.filter = (e.target as HTMLInputElement).value; }}>
        <button class="conn-btn" @click=${() => this.load()}>Refresh</button>
      </div>

      ${this.loading ? html`<div class="conn-empty">Loading connectors...</div>` :
        this._grouped().length === 0 ? html`<div class="conn-empty">No connectors found</div>` :
        this._grouped().map(g => html`
          <div class="conn-category-header">${g.label}</div>
          <div class="conn-grid">${g.connectors.map(c => this._renderCard(c))}</div>
        `)
      }

    `;
  }

  updated() {
    // Portal the modal into document.body so it covers the full viewport
    if (this.connectingId) {
      if (!this._portalEl) {
        this._portalEl = document.createElement('div');
        document.body.appendChild(this._portalEl);
      }
      litRender(this._renderConnectModal(), this._portalEl);
    } else {
      this._removePortal();
    }
  }

  private _removePortal() {
    if (this._portalEl) {
      litRender(nothing, this._portalEl);
      this._portalEl.remove();
      this._portalEl = null;
    }
  }

  private _renderCard(c: Connector) {
    return html`
      <div class="conn-card ${c.connected ? 'connected' : ''}">
        <div class="conn-card-header">
          <span class="conn-card-name">${escHtml(c.name)}</span>
          ${this._statusBadge(c)}
        </div>
        <div class="conn-card-desc" title="${escHtml(c.description)}">${escHtml(c.description)}</div>
        <div class="conn-card-meta">
          ${this._priorityBadge(c.priority)}
          ${c.verified ? html`<span class="conn-badge conn-badge-verified">Verified</span>` : nothing}
          ${c.authType === 'oauth' ? html`<span>OAuth</span>` : html`<span>API Key</span>`}
        </div>
        <div class="conn-card-agents">
          ${c.agents.map(a => html`<span class="conn-agent-chip">${escHtml(a)}</span>`)}
        </div>
        <div class="conn-card-actions">
          ${c.connected ? html`
            <button class="conn-btn" @click=${() => this._test(c.id)}
              ?disabled=${this.testingId === c.id}>
              ${this.testingId === c.id ? 'Testing...' : 'Test'}
            </button>
            <button class="conn-btn conn-btn-danger" @click=${() => this._disconnect(c.id)}>
              Disconnect
            </button>
          ` : html`
            <button class="conn-btn conn-btn-primary" @click=${() => this._openConnect(c)}>
              Connect
            </button>
          `}
          ${c.docs_url && (c.docs_url.startsWith('https://') || c.docs_url.startsWith('http://')) ? html`
            <a class="conn-btn" href="${c.docs_url}" target="_blank" rel="noopener"
              style="text-decoration:none">Docs</a>
          ` : nothing}
        </div>
        ${this.testResult?.id === c.id ? html`
          <div class="conn-test-result ${this.testResult.ok ? 'conn-test-ok' : 'conn-test-fail'}">
            ${this.testResult.ok ? 'Pass' : 'Fail'}: ${escHtml(this.testResult.message)}
          </div>
        ` : nothing}
      </div>
    `;
  }

  private _renderConnectModal() {
    const c = this.connectors.find(x => x.id === this.connectingId);
    if (!c) return nothing;
    return html`
      <div class="conn-modal-overlay" @click=${(e: Event) => {
        if (e.target === e.currentTarget) this._closeConnect();
      }}>
        <div class="conn-modal">
          <h3>Connect ${escHtml(c.id)}</h3>
          <p style="font-size:12px;color:var(--text-muted);margin-bottom:8px">${escHtml(c.description)}</p>
          ${c.docs_url && (c.docs_url.startsWith('https://') || c.docs_url.startsWith('http://')) ? html`
            <a class="conn-docs-link" href="${c.docs_url}" target="_blank" rel="noopener">
              Where do I find these credentials? &rarr;
            </a>
          ` : nothing}
          ${c.credentials_required.map(key => html`
            <label>${key}</label>
            <input type="password" placeholder="Enter ${key}" autocomplete="off"
              .value=${this.credentialInputs[key] || ''}
              @input=${(e: Event) => {
                this.credentialInputs = {
                  ...this.credentialInputs,
                  [key]: (e.target as HTMLInputElement).value,
                };
              }}>
            ${c.credential_hints?.[key] ? html`
              <div class="conn-hint">${escHtml(c.credential_hints[key])}</div>
            ` : nothing}
          `)}
          <div class="conn-notice">
            <span class="conn-notice-icon">&#9432;</span>
            <span>Connecting a service will briefly restart your AI system (~10 seconds) so your agents can start using it. Any active conversations will resume automatically.</span>
          </div>
          <div class="conn-modal-btns">
            <button class="conn-btn" @click=${() => this._closeConnect()}>Cancel</button>
            <button class="conn-btn conn-btn-primary" @click=${() => this._submitConnect()}>Connect</button>
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap { 'connectors-view': ConnectorsView; }
}
