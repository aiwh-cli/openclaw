import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';

type PolicyData = {
  policy: {
    locked_files: Array<{ path: string; comment: string }>;
    locked_directories: Array<{ path: string; comment: string }>;
    directory_rules: Array<{ path: string; allow: string[]; deny: string[]; comment: string }>;
  };
  guardAvailable: boolean;
};

type AuditEntry = {
  timestamp: string;
  agent_id: string;
  action: string;
  target_path: string;
  outcome: string;
  detail: string;
};

type AuditData = {
  entries: AuditEntry[];
  stats: { total: number; today: { allowed: number; redirected: number; blocked: number; policy: number } };
};

type TrashItem = {
  name: string;
  date: string;
  path: string;
  size: number;
  originPath: string;
  expiresAt: string;
  expired: boolean;
};

type TrashData = { items: TrashItem[]; totalSize: number };

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

  static styles = css`
    :host {
      display: block;
      color: var(--text-primary, #F5EDD6);
      font-family: 'Inter', -apple-system, sans-serif;
    }

    /* ── Shield ──────────────────── */
    .shield {
      display: flex; align-items: center; gap: 16px;
      padding: 20px; margin-bottom: 20px;
      background: var(--surface, rgba(14,14,18,0.65));
      border: 1px solid var(--border-dim, rgba(201,168,76,0.12));
      border-radius: 6px;
      backdrop-filter: blur(20px);
    }
    .shield svg { width: 44px; height: 44px; flex-shrink: 0; }
    .shield.active svg { color: var(--success, #4CAF7A); filter: drop-shadow(0 0 10px rgba(76,175,122,0.4)); }
    .shield.pending svg { color: var(--amber, #F0C040); filter: drop-shadow(0 0 10px rgba(240,192,64,0.3)); }
    .shield-text h3 {
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px; letter-spacing: 2px; text-transform: uppercase;
      margin: 0 0 4px;
    }
    .shield.active h3 { color: var(--success, #4CAF7A); }
    .shield.pending h3 { color: var(--amber, #F0C040); }
    .shield-text p { font-size: 12px; color: var(--text-muted, #8A8578); margin: 0; }

    /* ── Metrics ─────────────────── */
    .metrics { display: grid; grid-template-columns: repeat(4,1fr); gap: 12px; margin-bottom: 20px; }
    .m-card {
      background: var(--surface, rgba(14,14,18,0.65));
      border: 1px solid var(--border-dim, rgba(201,168,76,0.12));
      border-radius: 4px;
      padding: 18px 16px;
      text-align: center;
      position: relative;
      backdrop-filter: blur(12px);
    }
    .m-card::after {
      content: ''; position: absolute; top: 0; left: 0; right: 0;
      height: 2px; background: var(--accent, #C9A84C); opacity: 0.25;
    }
    .m-val {
      font-family: 'JetBrains Mono', monospace;
      font-size: 28px; font-weight: 600; line-height: 1; margin-bottom: 6px;
    }
    .m-lbl {
      font-size: 10px; letter-spacing: 1.5px; text-transform: uppercase; color: var(--text-muted, #8A8578);
    }

    /* ── Event Bar ────────────────── */
    .events {
      display: flex; gap: 24px; padding: 10px 16px;
      background: var(--surface, rgba(14,14,18,0.65));
      border: 1px solid var(--border-dim, rgba(201,168,76,0.12));
      border-radius: 4px; margin-bottom: 24px; font-size: 12px;
    }
    .ev { display: flex; align-items: center; gap: 6px; }
    .dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
    .dot-g { background: var(--success, #4CAF7A); box-shadow: 0 0 6px rgba(76,175,122,0.5); }
    .dot-o { background: var(--amber, #F0C040); box-shadow: 0 0 6px rgba(240,192,64,0.4); }
    .dot-r { background: var(--critical, #E05252); box-shadow: 0 0 6px rgba(224,82,82,0.5); }
    .dot-c { background: var(--cyan, #A0845C); }

    /* ── Tabs ─────────────────────── */
    .tabs {
      display: flex; gap: 0;
      border-bottom: 1px solid var(--border-dim, rgba(201,168,76,0.12));
      margin-bottom: 20px;
    }
    .tab {
      padding: 10px 24px; background: none; border: none;
      border-bottom: 2px solid transparent;
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase;
      color: var(--text-muted, #8A8578); cursor: pointer;
      transition: all 200ms cubic-bezier(0.4,0,0.2,1);
    }
    .tab:hover { color: var(--accent, #C9A84C); }
    .tab[active] { color: var(--accent, #C9A84C); border-bottom-color: var(--accent, #C9A84C); }

    /* ── Table ────────────────────── */
    table { width: 100%; border-collapse: collapse; }
    th {
      font-family: 'JetBrains Mono', monospace;
      font-size: 9px; letter-spacing: 2px; text-transform: uppercase;
      color: var(--text-muted, #8A8578); text-align: left; padding: 10px 12px;
      border-bottom: 1px solid var(--border-dim, rgba(201,168,76,0.12)); font-weight: 500;
    }
    td {
      padding: 10px 12px;
      border-bottom: 1px solid var(--border-faint, rgba(201,168,76,0.04));
      font-size: 12px;
    }
    tr:hover td { background: rgba(var(--accent-rgb, 201,168,76), 0.03); }
    code {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px; color: var(--accent, #C9A84C); opacity: 0.85;
    }

    /* ── Badges ───────────────────── */
    .b {
      display: inline-block; padding: 2px 8px; border-radius: 3px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 9px; letter-spacing: 0.5px; text-transform: uppercase;
      font-weight: 500; margin: 1px 2px;
    }
    .b-lock { background: rgba(var(--critical-rgb, 224,82,82), 0.08); color: var(--critical, #E05252); border: 1px solid rgba(var(--critical-rgb, 224,82,82), 0.15); }
    .b-allow { background: rgba(var(--success-rgb, 76,175,122), 0.10); color: var(--success, #4CAF7A); border: 1px solid rgba(var(--success-rgb, 76,175,122), 0.18); }
    .b-deny { background: rgba(var(--critical-rgb, 224,82,82), 0.10); color: var(--critical, #E05252); border: 1px solid rgba(var(--critical-rgb, 224,82,82), 0.18); }
    .b-out {
      display: inline-block; padding: 3px 10px; border-radius: 3px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 9px; letter-spacing: 0.5px; text-transform: uppercase;
    }
    .b-out-g { background: rgba(var(--success-rgb, 76,175,122), 0.12); color: var(--success, #4CAF7A); }
    .b-out-o { background: rgba(var(--amber-rgb, 240,192,64), 0.12); color: var(--amber, #F0C040); }
    .b-out-r { background: rgba(var(--critical-rgb, 224,82,82), 0.12); color: var(--critical, #E05252); }
    .b-out-c { background: rgba(var(--cyan-rgb, 160,132,92), 0.12); color: var(--cyan, #A0845C); }

    /* ── Buttons ──────────────────── */
    .btn {
      padding: 6px 16px; background: none;
      border: 1px solid var(--border-dim, rgba(201,168,76,0.12));
      color: var(--accent, #C9A84C); border-radius: 3px; cursor: pointer;
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px; letter-spacing: 1px; text-transform: uppercase;
      transition: all 200ms;
    }
    .btn:hover { border-color: var(--accent, #C9A84C); background: var(--magenta-dim, rgba(201,168,76,0.08)); }
    .btn-success { border-color: var(--success, #4CAF7A); color: var(--success, #4CAF7A); }
    .btn-success:hover { background: rgba(var(--success-rgb, 76,175,122), 0.10); }

    /* ── Add Rule Form ───────────── */
    .add-form {
      background: var(--surface, rgba(14,14,18,0.65));
      border: 1px solid var(--border-dim);
      border-radius: 6px;
      padding: 20px;
      margin-bottom: 20px;
    }
    .add-form h4 {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px; letter-spacing: 2px; text-transform: uppercase;
      color: var(--accent); margin: 0 0 16px;
    }
    .form-row { display: flex; gap: 12px; margin-bottom: 12px; align-items: center; }
    .form-input {
      flex: 1; padding: 8px 12px;
      background: var(--surface-hi, rgba(20,20,24,0.80));
      border: 1px solid var(--border-dim);
      border-radius: 4px;
      color: var(--text-primary); font-size: 12px;
      font-family: 'JetBrains Mono', monospace;
    }
    .form-input:focus { outline: none; border-color: var(--accent); }
    .form-input::placeholder { color: var(--text-dim); }
    .form-select {
      padding: 8px 12px;
      background: var(--surface-hi, rgba(20,20,24,0.80));
      border: 1px solid var(--border-dim);
      border-radius: 4px;
      color: var(--text-primary); font-size: 12px;
      font-family: 'JetBrains Mono', monospace;
    }

    /* ── Toggle badges ─────────── */
    .toggles { display: flex; gap: 6px; flex-wrap: wrap; }
    .toggle {
      padding: 4px 12px; border-radius: 3px; cursor: pointer;
      font-family: 'JetBrains Mono', monospace;
      font-size: 9px; letter-spacing: 0.5px; text-transform: uppercase;
      font-weight: 500; border: 1px solid; transition: all 150ms;
      user-select: none;
    }
    .toggle.allow-on { background: rgba(var(--success-rgb, 76,175,122), 0.15); color: var(--success, #4CAF7A); border-color: rgba(var(--success-rgb, 76,175,122), 0.3); }
    .toggle.allow-off { background: transparent; color: var(--text-dim, #4A4740); border-color: var(--border-dim, rgba(201,168,76,0.12)); opacity: 0.5; }
    .toggle.deny-on { background: rgba(var(--critical-rgb, 224,82,82), 0.15); color: var(--critical, #E05252); border-color: rgba(var(--critical-rgb, 224,82,82), 0.3); }
    .toggle.deny-off { background: transparent; color: var(--text-dim, #4A4740); border-color: var(--border-dim, rgba(201,168,76,0.12)); opacity: 0.5; }
    .toggle:hover { opacity: 1 !important; }
    .toggles-label {
      font-size: 9px; letter-spacing: 1.5px; text-transform: uppercase;
      color: var(--text-muted); margin-bottom: 6px;
      font-family: 'JetBrains Mono', monospace;
    }

    .empty { text-align: center; padding: 48px 20px; color: var(--text-dim, #4A4740); font-size: 13px; }
    .comment { color: var(--text-dim, #4A4740); font-size: 11px; }
    .path { max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: inline-block; vertical-align: middle; }

    @media (max-width: 768px) {
      .metrics { grid-template-columns: repeat(2, 1fr); }
      .events { flex-wrap: wrap; gap: 12px; }
    }
  `;

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

  private _bytes(b: number) {
    if (!b) {return '0 B';}
    const k = 1024, s = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(b) / Math.log(k));
    return parseFloat((b / Math.pow(k, i)).toFixed(1)) + ' ' + s[i];
  }

  private _outBadge(o: string) {
    const map: Record<string, [string, string]> = {
      'redirected_to_trash': ['b-out-o', 'Trashed'],
      'kernel_blocked': ['b-out-r', 'Blocked'],
      'policy_applied': ['b-out-c', 'Policy'],
      'policy_changed': ['b-out-c', 'Changed'],
      'trash_restored': ['b-out-g', 'Restored'],
      'trash_purged': ['b-out-o', 'Purged'],
    };
    const [cls, label] = map[o] || ['b-out-g', 'Allowed'];
    return html`<span class="b-out ${cls}">${label}</span>`;
  }

  private async _restore(item: TrashItem) {
    const defaultDest = item.originPath || `/opt/AIWH/client/content/${item.name}`;
    const dest = prompt(`Restore "${item.name}" to:`, defaultDest);
    if (!dest) {return;}
    try {
      const r = await fetch('/api/security/trash/restore', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trashPath: item.path, restorePath: dest }),
      }).then(r => r.json());
      if (r?.ok) {this.load();}
    } catch (e) { alert('Restore failed'); }
  }

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
      ${this.tab === 'audit' ? this._renderAudit() : ''}
      ${this.tab === 'trash' ? this._renderTrash() : ''}
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
      deny.delete(op); // mutually exclusive
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
      allow.delete(op); // mutually exclusive
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
      // Load existing overrides
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
    } catch (e) {
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
    // Infrastructure locks — visible but non-editable (no locked_files shown — those are internal)
    const infraDirs = p?.locked_directories || [];
    // Client-visible directory rules
    const dirRules = p?.directory_rules || [];
    // Custom overrides
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

  private _renderAudit() {
    const entries = this.audit?.entries || [];
    if (!entries.length) {return html`<div class="empty">No security events logged yet.</div>`;}
    return html`<table>
      <thead><tr><th>Time</th><th>Outcome</th><th>Detail</th></tr></thead>
      <tbody>
        ${entries.map(e => html`<tr>
          <td style="white-space:nowrap;font-size:11px">${e.timestamp ? new Date(e.timestamp).toLocaleString() : '—'}</td>
          <td>${this._outBadge(e.outcome)}</td>
          <td style="font-size:11px">
            <span style="color:var(--text-muted)">${e.agent_id || '—'}</span>
            ${e.action ? html` <span style="opacity:0.5">›</span> <span>${e.action}</span>` : ''}
            ${e.target_path ? html` <span style="opacity:0.5">›</span> <code class="path" title="${e.target_path}">${this._s(e.target_path)}</code>` : ''}
            ${e.detail ? html`<br><span style="color:var(--text-muted);font-size:10px">${e.detail}</span>` : ''}
          </td>
        </tr>`)}
      </tbody>
    </table>`;
  }

  private _renderTrash() {
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
