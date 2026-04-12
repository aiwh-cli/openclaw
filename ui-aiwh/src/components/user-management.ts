import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';

type User = {
  id: string; email: string; display_name: string; role: string;
  departments: string[]; command_centres: string[]; status: string;
  must_change_password: boolean; personal_cc_access: boolean; created_at: string;
  protected?: boolean;
};
type TeamMember = { id: string; email: string; status: string; createdAt: string };
type Dept = { id: string; name: string; command_centre: string };
type CC = { id: string; name: string };

@customElement('user-management')
export class UserManagement extends LitElement {
  @state() private users: User[] = [];
  @state() private departments: Dept[] = [];
  @state() private commandCentres: CC[] = [];
  @state() private teamMembers: TeamMember[] = [];
  @state() private loading = true;
  @state() private msg = '';
  @state() private msgType: 'ok' | 'err' = 'ok';
  @state() private showCreate = false;
  @state() private editUserId = '';
  @state() private currentRole = 'owner';
  // Create form
  @state() private newEmail = '';
  @state() private newName = '';
  @state() private newRole = 'team';
  @state() private newDepts: string[] = [];
  @state() private newCCs: string[] = [];
  @state() private newPcc = false;
  // Edit form
  @state() private editRole = 'team';
  @state() private editDepts: string[] = [];
  @state() private editCCs: string[] = [];
  @state() private editName = '';
  @state() private editPcc = false;

  static styles = css`
    :host { display: block; font-family: 'Inter', -apple-system, sans-serif; color: var(--text-primary, #F5EDD6); }
    .card { background: var(--surface); border: 1px solid var(--border-dim); border-radius: 6px; padding: 20px; margin-bottom: 16px; }
    .card h3 { margin: 0 0 12px; font-size: 14px; font-weight: 600; color: var(--magenta, #C9A84C); text-transform: uppercase; letter-spacing: 0.5px; }
    .user-row { display: flex; align-items: center; gap: 12px; padding: 12px 14px; background: var(--surface-hi, rgba(20,20,24,0.80)); border: 1px solid var(--border-dim); border-radius: 4px; margin-bottom: 8px; }
    .user-info { flex: 1; min-width: 0; }
    .user-name { font-size: 14px; font-weight: 500; }
    .user-email { font-size: 12px; color: var(--text-muted); font-family: 'JetBrains Mono', monospace; }
    .badge { font-size: 10px; padding: 2px 8px; border-radius: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px; }
    .badge.owner { background: rgba(201,168,76,0.15); color: #C9A84C; }
    .badge.admin { background: rgba(99,102,241,0.15); color: #818CF8; }
    .badge.team { background: rgba(76,175,122,0.12); color: #4CAF7A; }
    .badge.pending { background: rgba(240,192,64,0.12); color: #F0C040; }
    .badge.suspended { background: rgba(224,82,82,0.12); color: #E05252; }
    .badge.active { background: rgba(76,175,122,0.12); color: #4CAF7A; }
    .badge.accepted { background: rgba(76,175,122,0.12); color: #4CAF7A; }
    .badge.tailscale { background: rgba(99,102,241,0.12); color: #818CF8; font-size: 9px; }
    .badge.invite-only { background: rgba(240,192,64,0.08); color: #F0C040; }
    .badge.protected { background: rgba(201,168,76,0.18); color: #F0C040; border: 1px solid rgba(201,168,76,0.35); }
    .dept-chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
    .dept-chip { font-size: 10px; padding: 1px 6px; border-radius: 8px; background: rgba(201,168,76,0.08); color: var(--text-muted); border: 1px solid var(--border-dim); }
    .actions { display: flex; gap: 6px; flex-shrink: 0; }
    button { padding: 6px 12px; border: 1px solid var(--border-dim); border-radius: 4px; background: var(--magenta-dim); color: var(--magenta, #C9A84C); font-size: 11px; font-weight: 600; cursor: pointer; white-space: nowrap; }
    button:hover { background: var(--magenta-glow); border-color: var(--magenta, #C9A84C); }
    button.danger { color: var(--critical, #E05252); border-color: rgba(224,82,82,0.2); background: rgba(224,82,82,0.06); }
    button.danger:hover { background: rgba(224,82,82,0.15); border-color: var(--critical); }
    button.primary { background: var(--magenta, #C9A84C); color: var(--void, #0A0A0C); }
    button.primary:hover { background: var(--gold-hot, #F0C040); }
    button:disabled { opacity: 0.4; cursor: not-allowed; }
    .form-row { display: flex; gap: 8px; margin-bottom: 10px; align-items: center; }
    .form-row label { font-size: 12px; color: var(--text-muted); min-width: 80px; }
    .form-row input, .form-row select { flex: 1; padding: 8px 12px; background: var(--void, #0A0A0C); border: 1px solid var(--border-dim); border-radius: 4px; color: var(--text-primary); font-size: 13px; font-family: 'JetBrains Mono', monospace; outline: none; }
    .form-row input:focus, .form-row select:focus { border-color: var(--magenta, #C9A84C); }
    .form-row select { font-family: 'Inter', sans-serif; }
    .checkbox-group { display: flex; flex-wrap: wrap; gap: 8px; flex: 1; }
    .checkbox-group label { display: flex; align-items: center; gap: 4px; font-size: 12px; cursor: pointer; color: var(--text-primary); padding: 4px 8px; border: 1px solid var(--border-dim); border-radius: 4px; }
    .checkbox-group label.checked { border-color: var(--magenta, #C9A84C); background: rgba(201,168,76,0.08); }
    .checkbox-group input { display: none; }
    .msg { margin-top: 10px; font-size: 12px; padding: 8px 12px; border-radius: 4px; }
    .msg.ok { background: rgba(76,175,122,0.1); color: var(--success, #4CAF7A); }
    .msg.err { background: rgba(224,82,82,0.1); color: var(--critical, #E05252); }
    .temp-pw { font-family: 'JetBrains Mono', monospace; font-size: 14px; padding: 8px 12px; background: var(--void); border: 1px solid var(--magenta, #C9A84C); border-radius: 4px; margin-top: 8px; user-select: all; }
    .empty { text-align: center; padding: 24px; color: var(--text-muted); font-size: 13px; }
    .header-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
    .header-row h3 { margin: 0; }
  `;

  connectedCallback() { super.connectedCallback(); this._load(); }

  async _load() {
    this.loading = true;
    try {
      const [uRes, dRes, aRes, lRes, tRes] = await Promise.all([
        fetch('/api/users'), fetch('/api/departments'), fetch('/api/auth/status'), fetch('/api/license'), fetch('/api/team/members'),
      ]);
      const uData = await uRes.json();
      const dData = await dRes.json();
      const aData = await aRes.json();
      const lData = await lRes.json();
      const tData = await tRes.json();
      this.users = uData.users || [];
      this.departments = dData.departments || [];
      this.teamMembers = tData.members || [];
      this.currentRole = aData.user?.role || 'owner';
      const ccIds = lData.command_centres_active || lData.modules_active || ['business', 'wealth', 'life'];
      this.commandCentres = ccIds.map((id: string) => ({ id, name: id.charAt(0).toUpperCase() + id.slice(1) }));
    } catch { /* fallback */ }
    this.loading = false;
  }

  _showMsg(text: string, type: 'ok' | 'err' = 'ok') {
    this.msg = text; this.msgType = type;
    setTimeout(() => { this.msg = ''; }, 5000);
  }

  async _createUser() {
    if (!this.newEmail || !this.newName) { this._showMsg('Email and name required', 'err'); return; }
    try {
      const res = await fetch('/api/users', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: this.newEmail, displayName: this.newName, role: this.newRole, departments: this.newDepts, commandCentres: this.newRole === 'admin' ? this.newCCs : [], personalCcAccess: this.newRole === 'admin' ? this.newPcc : false }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const tsMsg = data.tailscaleInvited ? ' Tailscale invite sent.' : ' Tailscale invite could not be sent — resend from team panel.';
      this._showMsg(`User created! Temp password: ${data.tempPassword}.${tsMsg}`);
      this.showCreate = false; this.newEmail = ''; this.newName = ''; this.newRole = 'team'; this.newDepts = []; this.newCCs = []; this.newPcc = false;
      this._load();
    } catch (err: unknown) { this._showMsg((err as Error).message, 'err'); }
  }

  async _simpleFetch(url: string, method: string, okMsg: (data: Record<string, unknown>) => string) {
    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      this._showMsg(okMsg(data));
      this._load();
    } catch (err: unknown) { this._showMsg((err as Error).message, 'err'); }
  }

  _resetPassword(userId: string) { return this._simpleFetch(`/api/users/${userId}/reset-password`, 'POST', d => `Password reset! New temp password: ${d.tempPassword}`); }
  _resendInvite(email: string) { return this._simpleFetch(`/api/team/resend/${encodeURIComponent(email)}`, 'POST', () => `Invite resent to ${email}`); }
  _revokeInvite(email: string) { return this._simpleFetch(`/api/team/invite/${encodeURIComponent(email)}`, 'DELETE', () => `Access revoked for ${email}`); }

  async _protectedRequest(url: string, method: 'PUT' | 'DELETE', body: Record<string, unknown>): Promise<{ok: boolean; data: Record<string, unknown>}> {
    const send = (extra: Record<string, unknown> = {}) => fetch(url, {
      method, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, ...extra }),
    });
    let res = await send();
    let data = await res.json();
    if (res.status === 409 && data.requireConfirmation) {
      const phrase = prompt(`${data.error}\n\nType exactly to confirm:\n\n${data.confirmPhrase}`);
      if (!phrase) return { ok: false, data: { error: 'Cancelled' } };
      res = await send({ confirmCode: phrase });
      data = await res.json();
    }
    return { ok: res.ok, data };
  }

  async _toggleSuspend(user: User) {
    const newStatus = user.status === 'suspended' ? 'active' : 'suspended';
    try {
      const { ok, data } = await this._protectedRequest(`/api/users/${user.id}`, 'PUT', { status: newStatus });
      if (!ok) throw new Error((data.error as string) || 'Failed');
      this._showMsg(`${user.display_name} ${newStatus === 'suspended' ? 'suspended' : 'reactivated'}`);
      this._load();
    } catch (err: unknown) { this._showMsg((err as Error).message, 'err'); }
  }

  async _deleteUser(user: User) {
    if (!confirm(`Permanently delete ${user.display_name} (${user.email})? This cannot be undone.`)) return;
    try {
      const { ok, data } = await this._protectedRequest(`/api/users/${user.id}`, 'DELETE', {});
      if (!ok) throw new Error((data.error as string) || 'Failed');
      this._showMsg(`${user.display_name} deleted`);
      this._load();
    } catch (err: unknown) { this._showMsg((err as Error).message, 'err'); }
  }

  async _toggleProtect(user: User) {
    const next = !user.protected;
    const verb = next ? 'protect' : 'unprotect';
    if (!confirm(`${next ? 'Enable' : 'Remove'} shareholder protection for ${user.display_name}?`)) return;
    try {
      const { ok, data } = await this._protectedRequest(`/api/users/${user.id}`, 'PUT', { protected: next });
      if (!ok) throw new Error((data.error as string) || 'Failed');
      this._showMsg(`${user.display_name} ${verb}ed`);
      this._load();
    } catch (err: unknown) { this._showMsg((err as Error).message, 'err'); }
  }

  _startEdit(u: User) {
    this.editUserId = u.id;
    this.editName = u.display_name;
    this.editRole = u.role;
    this.editDepts = [...u.departments];
    this.editCCs = [...u.command_centres];
    this.editPcc = u.personal_cc_access;
  }

  _cancelEdit() { this.editUserId = ''; }

  async _saveEdit(userId: string) {
    try {
      const { ok, data } = await this._protectedRequest(`/api/users/${userId}`, 'PUT', {
        displayName: this.editName,
        role: this.editRole,
        departments: this.editDepts,
        commandCentres: this.editCCs,
        personalCcAccess: this.editPcc,
      });
      if (!ok) throw new Error((data.error as string) || 'Failed');
      this._showMsg('User updated');
      this.editUserId = '';
      this._load();
    } catch (err: unknown) { this._showMsg((err as Error).message, 'err'); }
  }

  _toggleIn(key: 'editDepts' | 'editCCs' | 'newDepts' | 'newCCs', id: string) {
    const arr = this[key] as string[];
    this[key] = arr.includes(id) ? arr.filter(x => x !== id) : [...arr, id];
  }
  _toggleEditDept(id: string) { this._toggleIn('editDepts', id); }
  _toggleEditCC(id: string) { this._toggleIn('editCCs', id); }
  _toggleDept(id: string) { this._toggleIn('newDepts', id); }
  _toggleNewCC(id: string) { this._toggleIn('newCCs', id); }

  _fmtDate(iso: string) {
    if (!iso) return '';
    try { return new Date(iso + 'Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
    catch { return iso; }
  }

  _tailscaleStatus(email: string): TeamMember | undefined {
    return this.teamMembers.find(m => m.email.toLowerCase() === email.toLowerCase());
  }

  _inviteOnlyMembers(): TeamMember[] {
    const userEmails = new Set(this.users.map(u => u.email.toLowerCase()));
    return this.teamMembers.filter(m => !userEmails.has(m.email.toLowerCase()));
  }

  _renderEditRow(u: User) {
    return html`
      <div style="border: 1px solid var(--magenta, #C9A84C); border-radius: 4px; padding: 14px; margin-bottom: 8px; background: var(--void);">
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">Editing: <strong style="color:var(--text-primary)">${u.email}</strong></div>
        <div class="form-row">
          <label>Name</label>
          <input type="text" .value=${this.editName}
            @input=${(e: Event) => { this.editName = (e.target as HTMLInputElement).value; }} />
        </div>
        ${this.currentRole === 'owner' ? html`
          <div class="form-row">
            <label>Role</label>
            <select .value=${this.editRole} @change=${(e: Event) => { this.editRole = (e.target as HTMLSelectElement).value; }}>
              <option value="team">Team</option>
              <option value="admin">Admin</option>
            </select>
          </div>
        ` : ''}
        <div class="form-row"><label>Depts</label><div class="checkbox-group">
          ${this.departments.map(d => html`<label class=${this.editDepts.includes(d.id) ? 'checked' : ''}><input type="checkbox" ?checked=${this.editDepts.includes(d.id)} @change=${() => this._toggleEditDept(d.id)} />${d.name}</label>`)}
        </div></div>
        ${this.editRole === 'admin' ? html`<div class="form-row"><label>CCs</label><div class="checkbox-group">
          ${this.commandCentres.map(cc => html`<label class=${this.editCCs.includes(cc.id) ? 'checked' : ''}><input type="checkbox" ?checked=${this.editCCs.includes(cc.id)} @change=${() => this._toggleEditCC(cc.id)} />${cc.name}</label>`)}
        </div></div>` : ''}
        ${this.currentRole === 'owner' ? html`<div class="form-row"><label>Personal CC</label><div class="checkbox-group">
          <label class=${this.editPcc ? 'checked' : ''}><input type="checkbox" ?checked=${this.editPcc} @change=${() => { this.editPcc = !this.editPcc; }} />Wealth &amp; Life access</label>
        </div></div>` : ''}
        <div style="display:flex;gap:8px;margin-top:8px;">
          <button class="primary" @click=${() => this._saveEdit(u.id)}>Save</button>
          <button @click=${this._cancelEdit}>Cancel</button>
        </div>
      </div>
    `;
  }

  render() {
    if (this.loading) return html`<div class="empty">Loading users...</div>`;
    const canDelete = this.currentRole === 'owner';

    return html`
      <div class="card">
        <div class="header-row">
          <h3>Team Members</h3>
          <button class="primary" @click=${() => { this.showCreate = !this.showCreate; }}>
            ${this.showCreate ? 'Cancel' : '+ Add User'}
          </button>
        </div>

        ${this.showCreate ? html`
          <div style="border: 1px solid var(--border-dim); border-radius: 4px; padding: 14px; margin-bottom: 14px; background: var(--void);">
            <div class="form-row">
              <label>Email</label>
              <input type="email" placeholder="va@example.com" .value=${this.newEmail}
                @input=${(e: Event) => { this.newEmail = (e.target as HTMLInputElement).value; }} />
            </div>
            <div class="form-row">
              <label>Name</label>
              <input type="text" placeholder="Jane Smith" .value=${this.newName}
                @input=${(e: Event) => { this.newName = (e.target as HTMLInputElement).value; }} />
            </div>
            <div class="form-row">
              <label>Role</label>
              <select .value=${this.newRole} @change=${(e: Event) => { this.newRole = (e.target as HTMLSelectElement).value; }}>
                <option value="team">Team</option>
                ${this.currentRole === 'owner' ? html`<option value="admin">Admin</option>` : ''}
              </select>
            </div>
            <div class="form-row">
              <label>Depts</label>
              <div class="checkbox-group">
                ${this.departments.filter(d => this.newRole === 'admin' || !['wealth', 'personal'].includes(d.id)).map(d => html`
                  <label class=${this.newDepts.includes(d.id) ? 'checked' : ''}>
                    <input type="checkbox" ?checked=${this.newDepts.includes(d.id)} @change=${() => this._toggleDept(d.id)} />
                    ${d.name}
                  </label>
                `)}
              </div>
            </div>
            ${this.newRole === 'admin' ? html`
              <div class="form-row">
                <label>CCs</label>
                <div class="checkbox-group">
                  ${this.commandCentres.map(cc => html`
                    <label class=${this.newCCs.includes(cc.id) ? 'checked' : ''}>
                      <input type="checkbox" ?checked=${this.newCCs.includes(cc.id)} @change=${() => this._toggleNewCC(cc.id)} />
                      ${cc.name}
                    </label>`)}
                </div>
              </div>
              <div class="form-row">
                <label>Personal CC</label>
                <div class="checkbox-group">
                  <label class=${this.newPcc ? 'checked' : ''}>
                    <input type="checkbox" ?checked=${this.newPcc} @change=${() => { this.newPcc = !this.newPcc; }} />
                    Wealth &amp; Life access
                  </label>
                </div>
              </div>
            ` : ''}
            <button class="primary" @click=${this._createUser}>Create User</button>
          </div>
        ` : ''}

        ${this.users.length === 0
          ? html`<div class="empty">No users yet.</div>`
          : this.users.map(u => this.editUserId === u.id ? this._renderEditRow(u) : html`
            <div class="user-row">
              <div class="user-info">
                <div class="user-name">${u.display_name}</div>
                <div class="user-email">${u.email}</div>
                ${u.departments.length > 0 ? html`
                  <div class="dept-chips">
                    ${u.departments.map(d => html`<span class="dept-chip">${d}</span>`)}
                  </div>
                ` : ''}
              </div>
              <span class="badge ${u.role}">${u.role}</span>
              <span class="badge ${u.status}">${u.status}</span>
              ${u.protected ? html`<span class="badge protected" title="Shareholder-protected — destructive actions require typed confirmation">🛡 protected</span>` : ''}
              ${u.personal_cc_access ? html`<span class="badge owner" style="font-size:9px">PCC</span>` : ''}
              ${(() => { const ts = this._tailscaleStatus(u.email); return ts ? html`<span class="badge tailscale" title="Tailscale: ${ts.status}">${ts.status === 'accepted' ? 'TS ✓' : 'TS pending'}</span>` : ''; })()}
              <span style="font-size:11px;color:var(--text-muted)">${this._fmtDate(u.created_at)}</span>
              ${u.role !== 'owner' ? html`
                <div class="actions">
                  <button @click=${() => this._startEdit(u)} title="Edit user">Edit</button>
                  <button @click=${() => this._resetPassword(u.id)} title="Reset password">Reset PW</button>
                  <button @click=${() => this._toggleSuspend(u)}>${u.status === 'suspended' ? 'Activate' : 'Suspend'}</button>
                  ${canDelete ? html`<button @click=${() => this._toggleProtect(u)} title="Toggle shareholder protection">${u.protected ? 'Unprotect' : 'Protect'}</button>` : ''}
                  ${canDelete ? html`<button class="danger" @click=${() => this._deleteUser(u)}>Delete</button>` : ''}
                </div>
              ` : ''}
            </div>
          `)}

        ${this._inviteOnlyMembers().length > 0 ? html`
          <div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--border-dim);">
            <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.3px;">Tailscale Invites (No Dashboard Account)</div>
            ${this._inviteOnlyMembers().map(m => html`<div class="user-row">
              <div class="user-info"><div class="user-email">${m.email}</div></div>
              <span class="badge invite-only">invite only</span>
              <span class="badge ${m.status}">${m.status}</span>
              <span style="font-size:11px;color:var(--text-muted)">${this._fmtDate(m.createdAt)}</span>
              <div class="actions">
                <button class="primary" @click=${() => { this.newEmail = m.email; this.showCreate = true; }}>Create Account</button>
                ${m.status === 'pending' ? html`<button @click=${() => this._resendInvite(m.email)}>Resend</button>` : ''}
                <button class="danger" @click=${() => this._revokeInvite(m.email)}>Revoke</button>
              </div>
            </div>`)}
          </div>` : ''}

        ${this.msg ? html`<div class="msg ${this.msgType}">${this.msg}</div>` : ''}
      </div>
    `;
  }
}
