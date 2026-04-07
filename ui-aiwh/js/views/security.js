// ─── Security View — Kernel-Level Protection Dashboard ──────
// Phase 70.7 — Lit web component. Shows Landlock policy, audit trail, trash.
// Design: Sovereign Brutalism — matches AIWH dashboard design system.

const { LitElement, html, css } = await import('/lit/components.js').catch(() => {
  // Fallback: grab from global if ESM import fails
  return { LitElement: window.LitElement, html: window.html, css: window.css };
});

class SecurityView extends LitElement {
  static properties = {
    policy: { type: Object },
    audit: { type: Object },
    trash: { type: Object },
    loading: { type: Boolean },
    activeTab: { type: String },
  };

  static styles = css`
    :host {
      display: block;
      font-family: 'Inter', -apple-system, sans-serif;
      color: #F5EDD6;
      --gold: #C9A84C;
      --gold-dim: rgba(201, 168, 76, 0.10);
      --gold-glow: rgba(201, 168, 76, 0.18);
      --surface: rgba(14, 14, 18, 0.65);
      --surface-hi: rgba(20, 20, 24, 0.80);
      --border-dim: rgba(201, 168, 76, 0.12);
      --border-hover: rgba(201, 168, 76, 0.30);
      --void: #0A0A0C;
      --green: #4CAF7A;
      --red: #E05252;
      --orange: #F0C040;
      --cyan: #A0845C;
      --text-muted: #8A8578;
      --text-dim: #4A4740;
      --mono: 'JetBrains Mono', monospace;
      --ease-smooth: cubic-bezier(0.4, 0, 0.2, 1);
    }

    /* ── Shield Status ────────────────────────────── */
    .shield-status {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 16px 20px;
      background: var(--surface);
      border: 1px solid var(--border-dim);
      border-radius: 6px;
      margin-bottom: 20px;
      backdrop-filter: blur(20px);
    }
    .shield-icon {
      width: 40px;
      height: 40px;
      flex-shrink: 0;
    }
    .shield-icon.active { color: var(--green); filter: drop-shadow(0 0 8px rgba(76,175,122,0.4)); }
    .shield-icon.pending { color: var(--orange); filter: drop-shadow(0 0 8px rgba(240,192,64,0.3)); }
    .shield-label { font-family: var(--mono); font-size: 11px; letter-spacing: 2px; text-transform: uppercase; }
    .shield-label.active { color: var(--green); }
    .shield-label.pending { color: var(--orange); }
    .shield-detail { font-size: 12px; color: var(--text-muted); margin-top: 2px; }

    /* ── Metric Cards ─────────────────────────────── */
    .metrics {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      margin-bottom: 24px;
    }
    .metric {
      background: var(--surface);
      border: 1px solid var(--border-dim);
      border-radius: 4px;
      padding: 16px;
      text-align: center;
      position: relative;
      overflow: hidden;
      backdrop-filter: blur(12px);
    }
    .metric::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 2px;
      background: var(--gold);
      opacity: 0.3;
    }
    .metric-value {
      font-family: var(--mono);
      font-size: 28px;
      font-weight: 600;
      line-height: 1;
      margin-bottom: 6px;
    }
    .metric-label {
      font-size: 10px;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      color: var(--text-muted);
    }

    /* ── Event Summary Bar ────────────────────────── */
    .events-bar {
      display: flex;
      gap: 24px;
      padding: 10px 16px;
      background: var(--surface);
      border: 1px solid var(--border-dim);
      border-radius: 4px;
      margin-bottom: 24px;
      font-size: 12px;
    }
    .event-stat { display: flex; align-items: center; gap: 6px; }
    .event-dot {
      width: 6px; height: 6px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .event-dot.allowed { background: var(--green); box-shadow: 0 0 6px rgba(76,175,122,0.5); }
    .event-dot.trashed { background: var(--orange); box-shadow: 0 0 6px rgba(240,192,64,0.4); }
    .event-dot.blocked { background: var(--red); box-shadow: 0 0 6px rgba(224,82,82,0.5); }
    .event-dot.policy { background: var(--cyan); }

    /* ── Tabs ──────────────────────────────────────── */
    .tabs {
      display: flex;
      gap: 0;
      border-bottom: 1px solid var(--border-dim);
      margin-bottom: 20px;
    }
    .tab {
      padding: 8px 20px;
      font-family: var(--mono);
      font-size: 11px;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      color: var(--text-muted);
      background: none;
      border: none;
      border-bottom: 2px solid transparent;
      cursor: pointer;
      transition: all 200ms var(--ease-smooth);
    }
    .tab:hover { color: var(--gold); }
    .tab.active {
      color: var(--gold);
      border-bottom-color: var(--gold);
    }

    /* ── Tables ────────────────────────────────────── */
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }
    th {
      font-family: var(--mono);
      font-size: 9px;
      letter-spacing: 2px;
      text-transform: uppercase;
      color: var(--text-muted);
      text-align: left;
      padding: 8px 12px;
      border-bottom: 1px solid var(--border-dim);
      font-weight: 500;
    }
    td {
      padding: 8px 12px;
      border-bottom: 1px solid rgba(201,168,76,0.04);
      vertical-align: middle;
    }
    tr:hover td {
      background: rgba(201,168,76,0.03);
    }
    code {
      font-family: var(--mono);
      font-size: 11px;
      color: var(--gold);
      opacity: 0.85;
    }

    /* ── Badges ────────────────────────────────────── */
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 3px;
      font-family: var(--mono);
      font-size: 9px;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      font-weight: 500;
    }
    .badge-allow { background: rgba(76,175,122,0.12); color: var(--green); border: 1px solid rgba(76,175,122,0.2); }
    .badge-deny { background: rgba(224,82,82,0.10); color: var(--red); border: 1px solid rgba(224,82,82,0.2); }
    .badge-locked { background: rgba(224,82,82,0.08); color: var(--red); border: 1px solid rgba(224,82,82,0.15); }
    .badge-outcome {
      padding: 2px 8px;
      border-radius: 3px;
      font-family: var(--mono);
      font-size: 9px;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }
    .badge-allowed { background: rgba(76,175,122,0.12); color: var(--green); }
    .badge-redirected { background: rgba(240,192,64,0.12); color: var(--orange); }
    .badge-blocked { background: rgba(224,82,82,0.12); color: var(--red); }
    .badge-policy { background: rgba(160,132,92,0.12); color: var(--cyan); }

    /* ── Restore Button ───────────────────────────── */
    .btn-restore {
      padding: 4px 12px;
      font-family: var(--mono);
      font-size: 10px;
      letter-spacing: 1px;
      text-transform: uppercase;
      background: none;
      border: 1px solid var(--border-dim);
      color: var(--gold);
      border-radius: 3px;
      cursor: pointer;
      transition: all 200ms var(--ease-smooth);
    }
    .btn-restore:hover {
      border-color: var(--gold);
      background: var(--gold-dim);
    }

    /* ── Empty State ──────────────────────────────── */
    .empty {
      text-align: center;
      padding: 40px 20px;
      color: var(--text-dim);
      font-size: 13px;
    }

    .comment { color: var(--text-dim); font-size: 11px; }
    .path-short { max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: inline-block; }

    @media (max-width: 768px) {
      .metrics { grid-template-columns: repeat(2, 1fr); }
      .events-bar { flex-wrap: wrap; gap: 12px; }
    }
  `;

  constructor() {
    super();
    this.policy = null;
    this.audit = null;
    this.trash = null;
    this.loading = true;
    this.activeTab = 'rules';
  }

  connectedCallback() {
    super.connectedCallback();
    this.loadData();
  }

  async loadData() {
    this.loading = true;
    try {
      const [policy, audit, trash] = await Promise.all([
        fetch('/api/security/policy').then(r => r.json()),
        fetch('/api/security/audit?limit=50').then(r => r.json()),
        fetch('/api/security/trash').then(r => r.json()),
      ]);
      this.policy = policy;
      this.audit = audit;
      this.trash = trash;
    } catch (e) {
      console.error('Security data load failed:', e);
    }
    this.loading = false;
  }

  _shieldSvg(active) {
    return html`<svg class="shield-icon ${active ? 'active' : 'pending'}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <path d="M12 2L3 7v5c0 5.25 3.44 9.33 8.25 11.25a1 1 0 00.75.25 1 1 0 00.75-.25C17.56 21.33 21 17.25 21 12V7L12 2z" fill="currentColor" opacity="0.12"/>
      <path d="M12 2L3 7v5c0 5.25 3.44 9.33 8.25 11.25.49.17.76.25.75.25s.26-.08.75-.25C17.56 21.33 21 17.25 21 12V7L12 2z"/>
      ${active
        ? html`<path d="M9 12l2 2 4-4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
        : html`<path d="M12 9v4M12 16h.01" stroke-width="2" stroke-linecap="round"/>`
      }
    </svg>`;
  }

  _renderShield() {
    const active = this.policy?.guardAvailable;
    const stats = this.audit?.stats?.today || {};
    const total = (stats.allowed || 0) + (stats.redirected || 0) + (stats.blocked || 0);
    return html`
      <div class="shield-status">
        ${this._shieldSvg(active)}
        <div>
          <div class="shield-label ${active ? 'active' : 'pending'}">
            ${active ? 'Kernel Protection Active' : 'Protection Pending'}
          </div>
          <div class="shield-detail">
            ${active
              ? `Landlock LSM enforcing ${this.policy?.policy?.locked_files?.length || 0} file locks + ${this.policy?.policy?.directory_rules?.length || 0} directory rules`
              : 'Container restart required to activate kernel-level security'}
          </div>
        </div>
      </div>
    `;
  }

  _renderMetrics() {
    const p = this.policy?.policy || {};
    const stats = this.audit?.stats?.today || {};
    return html`
      <div class="metrics">
        <div class="metric">
          <div class="metric-value" style="color:var(--green)">${p.locked_files?.length || 0}</div>
          <div class="metric-label">Locked Files</div>
        </div>
        <div class="metric">
          <div class="metric-value" style="color:var(--green)">${p.locked_directories?.length || 0}</div>
          <div class="metric-label">Locked Dirs</div>
        </div>
        <div class="metric">
          <div class="metric-value" style="color:var(--gold)">${p.directory_rules?.length || 0}</div>
          <div class="metric-label">Directory Rules</div>
        </div>
        <div class="metric">
          <div class="metric-value" style="color:${(stats.blocked || 0) > 0 ? 'var(--red)' : 'var(--text-muted)'}">
            ${(stats.allowed || 0) + (stats.redirected || 0) + (stats.blocked || 0)}
          </div>
          <div class="metric-label">Today's Events</div>
        </div>
      </div>
      <div class="events-bar">
        <div class="event-stat"><span class="event-dot allowed"></span> Allowed: ${stats.allowed || 0}</div>
        <div class="event-stat"><span class="event-dot trashed"></span> Trashed: ${stats.redirected || 0}</div>
        <div class="event-stat"><span class="event-dot blocked"></span> Blocked: ${stats.blocked || 0}</div>
        <div class="event-stat"><span class="event-dot policy"></span> Policy loads: ${stats.policy || 0}</div>
      </div>
    `;
  }

  _renderTabs() {
    const tabs = [
      { id: 'rules', label: 'Protection Rules' },
      { id: 'audit', label: 'Audit Log' },
      { id: 'trash', label: `Trash (${this.trash?.items?.length || 0})` },
    ];
    return html`
      <div class="tabs">
        ${tabs.map(t => html`
          <button class="tab ${this.activeTab === t.id ? 'active' : ''}"
                  @click=${() => this.activeTab = t.id}>${t.label}</button>
        `)}
      </div>
    `;
  }

  _short(p) { return (p || '').replace('/opt/AIWH/', ''); }

  _renderRules() {
    const p = this.policy?.policy || {};
    return html`
      <table>
        <thead><tr><th>Path</th><th>Protection</th><th>Comment</th></tr></thead>
        <tbody>
          ${(p.locked_files || []).map(f => html`
            <tr>
              <td><code class="path-short" title="${f.path}">${this._short(f.path)}</code></td>
              <td><span class="badge badge-locked">Read Only</span></td>
              <td class="comment">${f.comment || ''}</td>
            </tr>
          `)}
          ${(p.locked_directories || []).map(d => html`
            <tr>
              <td><code class="path-short" title="${d.path}">${this._short(d.path)}/</code></td>
              <td><span class="badge badge-locked">Read Only (dir)</span></td>
              <td class="comment">${d.comment || ''}</td>
            </tr>
          `)}
          ${(p.directory_rules || []).map(r => html`
            <tr>
              <td><code class="path-short" title="${r.path}">${this._short(r.path)}/</code></td>
              <td>
                ${(r.allow || []).map(a => html`<span class="badge badge-allow">${a}</span> `)}
                ${(r.deny || []).map(d => html`<span class="badge badge-deny">${d}</span> `)}
              </td>
              <td class="comment">${r.comment || ''}</td>
            </tr>
          `)}
        </tbody>
      </table>
    `;
  }

  _outcomeClass(o) {
    if (o === 'redirected_to_trash') {return 'badge-redirected';}
    if (o === 'kernel_blocked') {return 'badge-blocked';}
    if (o === 'policy_applied' || o === 'policy_changed') {return 'badge-policy';}
    return 'badge-allowed';
  }

  _outcomeLabel(o) {
    if (o === 'redirected_to_trash') {return 'Trashed';}
    if (o === 'kernel_blocked') {return 'Blocked';}
    if (o === 'policy_applied') {return 'Policy';}
    if (o === 'policy_changed') {return 'Changed';}
    if (o === 'trash_restored') {return 'Restored';}
    if (o === 'trash_purged') {return 'Purged';}
    return 'Allowed';
  }

  _renderAudit() {
    const entries = this.audit?.entries || [];
    if (!entries.length) {return html`<div class="empty">No security events logged yet.</div>`;}
    return html`
      <table>
        <thead><tr><th>Time</th><th>Agent</th><th>Action</th><th>Path</th><th>Outcome</th></tr></thead>
        <tbody>
          ${entries.map(e => html`
            <tr>
              <td style="white-space:nowrap;font-size:11px">${e.timestamp ? new Date(e.timestamp).toLocaleTimeString() : '—'}</td>
              <td style="font-size:11px">${e.agent_id || '—'}</td>
              <td style="font-size:11px">${e.action || '—'}</td>
              <td><code class="path-short" title="${e.target_path || ''}">${this._short(e.target_path)}</code></td>
              <td><span class="badge-outcome ${this._outcomeClass(e.outcome)}">${this._outcomeLabel(e.outcome)}</span></td>
            </tr>
          `)}
        </tbody>
      </table>
    `;
  }

  _formatBytes(b) {
    if (!b) {return '0 B';}
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(b) / Math.log(k));
    return parseFloat((b / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  async _restore(item) {
    const restorePath = prompt(`Restore "${item.name}" to:`, `/opt/AIWH/client/content/${item.name}`);
    if (!restorePath) {return;}
    try {
      const r = await fetch('/api/security/trash/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trashPath: item.path, restorePath }),
      }).then(r => r.json());
      if (r?.ok) {this.loadData();}
    } catch (e) {
      alert('Restore failed: ' + e.message);
    }
  }

  _renderTrash() {
    const items = this.trash?.items || [];
    if (!items.length) {return html`<div class="empty">Trash is empty. Files deleted by agents are held here for 48 hours before permanent removal.</div>`;}
    return html`
      <table>
        <thead><tr><th>File</th><th>Trashed</th><th>Expires</th><th>Size</th><th></th></tr></thead>
        <tbody>
          ${items.map(item => html`
            <tr>
              <td><code>${item.name}</code></td>
              <td style="font-size:11px">${item.date}</td>
              <td style="font-size:11px;color:${item.expired ? 'var(--red)' : 'var(--text-muted)'}">
                ${item.expired ? 'Expired' : new Date(item.expiresAt).toLocaleString()}
              </td>
              <td style="font-size:11px">${this._formatBytes(item.size)}</td>
              <td>${!item.expired ? html`<button class="btn-restore" @click=${() => this._restore(item)}>Restore</button>` : ''}</td>
            </tr>
          `)}
        </tbody>
      </table>
    `;
  }

  render() {
    if (this.loading) {return html`<div class="empty">Loading security data...</div>`;}
    return html`
      ${this._renderShield()}
      ${this._renderMetrics()}
      ${this._renderTabs()}
      ${this.activeTab === 'rules' ? this._renderRules() : ''}
      ${this.activeTab === 'audit' ? this._renderAudit() : ''}
      ${this.activeTab === 'trash' ? this._renderTrash() : ''}
    `;
  }
}

customElements.define('aiwh-security', SecurityView);

// ── Init function (called by VIEW_INIT in app.js) ────────────
// Exposed on window because this is a module but app.js is a regular script
window.initSecurity = async function initSecurity() {
  const container = document.getElementById('security-overview');
  if (!container) {return;}
  // Replace the plain divs with our Lit component
  const parent = container.parentElement;
  // Clear all security divs
  ['security-overview', 'security-rules', 'security-audit', 'security-trash'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {el.style.display = 'none';}
  });
  // Insert component if not already present
  if (!parent.querySelector('aiwh-security')) {
    const comp = document.createElement('aiwh-security');
    parent.appendChild(comp);
  } else {
    parent.querySelector('aiwh-security').loadData();
  }
}
