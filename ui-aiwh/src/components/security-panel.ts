import { LitElement, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { securityStyles } from './security-styles.js';
import type { PolicyData, AuditData, TrashData } from './security-types.js';
import './security-audit-tab.js';
import './security-trash-tab.js';

@customElement('security-panel')
export class SecurityPanel extends LitElement {
  @state() private policy: PolicyData | null = null;
  @state() private audit: AuditData | null = null;
  @state() private trash: TrashData | null = null;
  @state() private overrides: { custom_rules: Array<{ path: string; allow: string[]; deny: string[]; comment: string }> } = { custom_rules: [] };
  @state() private loading = true;
  @state() private tab: 'rules' | 'audit' | 'trash' | 'exec' = 'rules';
  @state() private showAddForm = false;
  @state() private newPath = '';
  @state() private newAllow: Set<string> = new Set(['read', 'write', 'create']);
  @state() private newDeny: Set<string> = new Set(['remove_file', 'remove_dir']);

  static styles = securityStyles;

  connectedCallback() { super.connectedCallback(); this.load(); }

  async load() {
    this.loading = true;
    try {
      const [p, a, t, o] = await Promise.all([
        fetch('/api/security/policy').then(r => r.json()),
        fetch('/api/security/audit?limit=50').then(r => r.json()),
        fetch('/api/security/trash').then(r => r.json()),
        fetch('/api/security/overrides').then(r => r.json()).catch(() => ({ custom_rules: [] })),
      ]);
      this.policy = p; this.audit = a; this.trash = t; this.overrides = o;
    } catch (e) { console.error('Security load failed:', e); }
    this.loading = false;
  }

  private _s(p: string) { return (p || '').replace('/opt/AIWH/', ''); }

  render() {
    if (this.loading) {return html`<div class="empty">Loading security data...</div>`;}

    const kernelActive = this.policy?.guardAvailable ?? false;
    const safeBashActive = (this.policy as any)?.safeBashActive ?? false;
    const active = kernelActive || safeBashActive;
    const p = this.policy?.policy;
    const st = this.audit?.stats?.today || { allowed: 0, redirected: 0, blocked: 0, policy: 0 };
    const total = st.allowed + st.redirected + st.blocked;

    const shieldMsg = kernelActive
      ? `Landlock LSM enforcing ${p?.locked_files?.length || 0} file locks and ${p?.directory_rules?.length || 0} directory rules`
      : safeBashActive
        ? `Trash-redirect protection active with ${p?.directory_rules?.length || 0} directory rules. Kernel enforcement activates inside container.`
        : 'Container restart required to activate kernel-level enforcement';
    const shieldTitle = kernelActive ? 'Kernel Protection Active'
      : safeBashActive ? 'Application Protection Active' : 'Protection Pending';

    return html`
      <!-- Shield -->
      <div class="shield ${active ? 'active' : 'pending'}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M12 2L3 7v5c0 5.25 3.44 9.33 8.25 11.25.49.17.76.25.75.25s.26-.08.75-.25C17.56 21.33 21 17.25 21 12V7L12 2z" fill="currentColor" opacity="0.12"/>
          <path d="M12 2L3 7v5c0 5.25 3.44 9.33 8.25 11.25.49.17.76.25.75.25s.26-.08.75-.25C17.56 21.33 21 17.25 21 12V7L12 2z"/>
          ${active
            ? html`<path d="M9 12l2 2 4-4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
            : html`<path d="M12 9v4M12 16h.01" stroke-width="2" stroke-linecap="round"/>`}
        </svg>
        <div class="shield-text">
          <h3>${shieldTitle}</h3>
          <p>${shieldMsg}</p>
        </div>
      </div>

      <!-- Metrics -->
      <div class="metrics">
        <div class="m-card">
          <div class="m-val" style="color:#4CAF7A">${p?.locked_files?.length || 0}</div>
          <div class="m-lbl">Locked Files</div>
        </div>
        <div class="m-card">
          <div class="m-val" style="color:#4CAF7A">${p?.locked_directories?.length || 0}</div>
          <div class="m-lbl">Locked Dirs</div>
        </div>
        <div class="m-card">
          <div class="m-val" style="color:#C9A84C">${p?.directory_rules?.length || 0}</div>
          <div class="m-lbl">Directory Rules</div>
        </div>
        <div class="m-card">
          <div class="m-val" style="color:${st.blocked > 0 ? '#E05252' : '#8A8578'}">${total}</div>
          <div class="m-lbl">Today's Events</div>
        </div>
      </div>

      <!-- Event summary -->
      <div class="events">
        <div class="ev"><span class="dot dot-g"></span> Allowed: ${st.allowed}</div>
        <div class="ev"><span class="dot dot-o"></span> Trashed: ${st.redirected}</div>
        <div class="ev"><span class="dot dot-r"></span> Blocked: ${st.blocked}</div>
        <div class="ev"><span class="dot dot-c"></span> Policy: ${st.policy}</div>
      </div>

      <!-- Tabs -->
      <div class="tabs">
        <button class="tab" ?active=${this.tab === 'rules'} @click=${() => this.tab = 'rules'}>Protection Rules</button>
        <button class="tab" ?active=${this.tab === 'audit'} @click=${() => this.tab = 'audit'}>Audit Log</button>
        <button class="tab" ?active=${this.tab === 'trash'} @click=${() => this.tab = 'trash'}>Trash (${this.trash?.items?.length || 0})</button>
        <button class="tab" ?active=${this.tab === 'exec'} @click=${() => this.tab = 'exec'}>Exec Approvals</button>
      </div>

      ${this.tab === 'rules' ? this._renderRules() : ''}
      ${this.tab === 'audit' ? html`<security-audit-tab .audit=${this.audit}></security-audit-tab>` : ''}
      ${this.tab === 'trash' ? html`<security-trash-tab .trash=${this.trash} @reload=${() => this.load()}></security-trash-tab>` : ''}
      ${this.tab === 'exec' ? html`<exec-approvals-panel></exec-approvals-panel>` : ''}
    `;
  }

  private _toggleAllow(op: string) {
    const allow = new Set(this.newAllow);
    const deny = new Set(this.newDeny);
    if (allow.has(op)) {
      allow.delete(op);
    } else {
      allow.add(op);
      deny.delete(op);
    }
    this.newAllow = allow;
    this.newDeny = deny;
  }

  private _toggleDeny(op: string) {
    const allow = new Set(this.newAllow);
    const deny = new Set(this.newDeny);
    if (deny.has(op)) {
      deny.delete(op);
    } else {
      deny.add(op);
      allow.delete(op);
    }
    this.newAllow = allow;
    this.newDeny = deny;
  }

  private async _addRule() {
    if (!this.newPath.startsWith('/opt/AIWH/')) {
      alert('Path must start with /opt/AIWH/');
      return;
    }
    try {
      const current = await fetch('/api/security/overrides').then(r => r.ok ? r.json() : { custom_rules: [] }).catch(() => ({ custom_rules: [] }));
      const rules = current?.custom_rules || [];
      rules.push({
        path: this.newPath,
        allow: [...this.newAllow],
        deny: [...this.newDeny],
        comment: `Custom rule added ${new Date().toLocaleDateString()}`,
      });
      await fetch('/api/security/overrides', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          custom_rules: rules,
          _audit_detail: `Added rule: ${this.newPath} — allow: [${[...this.newAllow].join(', ')}], deny: [${[...this.newDeny].join(', ')}]`,
        }),
      });
      this.showAddForm = false;
      this.newPath = '';
      this.newAllow = new Set(['read', 'write', 'create']);
      this.newDeny = new Set(['remove_file', 'remove_dir']);
      this.load();
    } catch {
      alert('Failed to save rule');
    }
  }

  private async _removeCustomRule(index: number) {
    const rules = [...(this.overrides?.custom_rules || [])];
    const removed = rules[index];
    if (!confirm(`Remove protection for ${removed?.path}?`)) {return;}
    rules.splice(index, 1);
    await fetch('/api/security/overrides', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        custom_rules: rules,
        _audit_detail: `Removed rule: ${removed?.path} (was blocking: ${(removed?.deny || []).join(', ')})`,
      }),
    });
    this.load();
  }

  private async _editCustomRule(index: number) {
    const rules = [...(this.overrides?.custom_rules || [])];
    const rule = rules[index];
    if (!rule) {return;}
    const newDeny = prompt(
      `Edit blocked operations for ${rule.path}\n\nCurrent: ${(rule.deny || []).join(', ')}\n\nOptions: remove_file, remove_dir, write, create\nEnter comma-separated:`,
      (rule.deny || []).join(', ')
    );
    if (newDeny === null) {return;}
    rules[index] = { ...rule, deny: newDeny.split(',').map(s => s.trim()).filter(Boolean) };
    await fetch('/api/security/overrides', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        custom_rules: rules,
        _audit_detail: `Edited rule: ${rule.path} — deny changed to: ${newDeny}`,
      }),
    });
    this.load();
  }

  private _renderRules() {
    const p = this.policy?.policy;
    const infraDirs = p?.locked_directories || [];
    const dirRules = p?.directory_rules || [];
    const custom = this.overrides?.custom_rules || [];

    return html`
      <!-- Add Protection -->
      <div style="display:flex;justify-content:flex-end;margin-bottom:16px">
        <button class="btn btn-success" @click=${() => this.showAddForm = !this.showAddForm}>
          ${this.showAddForm ? 'Cancel' : '+ Add Protection'}
        </button>
      </div>
      ${this.showAddForm ? html`
        <div class="add-form">
          <h4>Add Custom Protection</h4>
          <div class="form-row">
            <input class="form-input" placeholder="/opt/AIWH/client/my-custom-data"
                   .value=${this.newPath}
                   @input=${(e: Event) => this.newPath = (e.target as HTMLInputElement).value}>
          </div>
          <div style="margin-bottom:12px">
            <div class="toggles-label">Allowed</div>
            <div class="toggles">
              ${['read', 'write', 'create', 'remove_file', 'remove_dir'].map(op => html`
                <span class="toggle ${this.newAllow.has(op) ? 'allow-on' : 'allow-off'}"
                      @click=${() => this._toggleAllow(op)}>${op}</span>
              `)}
            </div>
          </div>
          <div style="margin-bottom:16px">
            <div class="toggles-label">Blocked</div>
            <div class="toggles">
              ${['remove_file', 'remove_dir', 'write', 'create'].map(op => html`
                <span class="toggle ${this.newDeny.has(op) ? 'deny-on' : 'deny-off'}"
                      @click=${() => this._toggleDeny(op)}>${op}</span>
              `)}
            </div>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center">
            <p style="font-size:11px;color:var(--text-dim);margin:0">
              Container restart required to apply kernel-level changes.
            </p>
            <button class="btn btn-success" @click=${() => this._addRule()}>Save Rule</button>
          </div>
        </div>
      ` : ''}

      <!-- Custom rules (client-editable) -->
      ${custom.length ? html`
        <h4 style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--accent);margin:0 0 12px">Your Custom Rules</h4>
        <table>
          <thead><tr><th>Path</th><th>Protection</th><th>Notes</th><th></th></tr></thead>
          <tbody>
            ${custom.map((r, i) => html`<tr>
              <td><code class="path" title="${r.path}">${this._s(r.path)}</code></td>
              <td>
                ${(r.allow || []).map(a => html`<span class="b b-allow">${a}</span>`)}
                ${(r.deny || []).map(d => html`<span class="b b-deny">${d}</span>`)}
              </td>
              <td class="comment">${r.comment || ''}</td>
              <td style="white-space:nowrap">
                <button class="btn" style="padding:2px 10px;font-size:9px" @click=${() => this._editCustomRule(i)}>Edit</button>
                <button class="btn" style="padding:2px 10px;font-size:9px;color:var(--critical)" @click=${() => this._removeCustomRule(i)}>Remove</button>
              </td>
            </tr>`)}
          </tbody>
        </table>
        <div style="height:24px"></div>
      ` : ''}

      <!-- Default directory rules -->
      <h4 style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--text-muted);margin:0 0 12px">Default Protection</h4>
      <table>
        <thead><tr><th>Path</th><th>Allowed</th><th>Blocked</th><th>Notes</th></tr></thead>
        <tbody>
          ${dirRules.map(r => html`<tr>
            <td><code class="path" title="${r.path}">${this._s(r.path)}/</code></td>
            <td>${(r.allow || []).map(a => html`<span class="b b-allow">${a}</span>`)}</td>
            <td>${(r.deny || []).length ? (r.deny || []).map(d => html`<span class="b b-deny">${d}</span>`) : html`<span style="opacity:0.3;font-size:11px">none</span>`}</td>
            <td class="comment">${r.comment}</td>
          </tr>`)}
        </tbody>
      </table>

      <!-- Infrastructure locks (visible, non-editable) -->
      ${infraDirs.length ? html`
        <div style="height:24px"></div>
        <h4 style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--text-dim);margin:0 0 12px">System Protected (non-editable)</h4>
        <table>
          <thead><tr><th>Path</th><th>Protection</th><th>Notes</th></tr></thead>
          <tbody>
            ${infraDirs.map(d => html`<tr style="opacity:0.6">
              <td><code class="path" title="${d.path}">${this._s(d.path)}/</code></td>
              <td><span class="b b-lock">Locked</span></td>
              <td class="comment">${d.comment}</td>
            </tr>`)}
          </tbody>
        </table>
      ` : ''}
    `;
  }
}
