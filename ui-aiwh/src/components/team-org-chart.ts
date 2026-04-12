import { LitElement, html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';

interface OrgAgent {
  id: string;
  displayName?: string;
  title?: string;
  description?: string;
  commandCentre?: string;
  model?: string;
  modelLabel?: string;
  emoji?: string;
  reports?: OrgAgent[];
  trashed?: boolean;
  trashedAt?: string;
}

interface OrgDepartment {
  id: string;
  name: string;
  agents: OrgAgent[];
}

interface OrgCC {
  id: string;
  name: string;
  icon?: string;
  ownerLocked?: boolean;
  departments: OrgDepartment[];
}

interface OrgHierarchy {
  id: string;
  displayName?: string;
  title?: string;
  description?: string;
  emoji?: string;
  commandCentres?: OrgCC[];
  // Legacy flat reports (v1 compat)
  reports?: OrgAgent[];
}

interface AgentStatus {
  id: string;
  status: string;
  model?: string;
  modelTier?: string;
  display_name?: string;
  avatar_url?: string;
  commandCentre?: string;
  departments?: { id: string; name: string }[];
  source?: string;
}

interface TierInfo {
  tier: string;
  cls: string;
  label: string;
}

const CC_META: Record<string, { label: string; color: string }> = {
  business: { label: 'Business',  color: 'var(--magenta)' },
  wealth:   { label: 'Wealth',    color: '#C9A84C' },
  life:     { label: 'Life',      color: 'var(--green)' },
  system:   { label: 'System',    color: 'var(--text-muted)' },
  custom:   { label: 'Your Agents', color: '#6C5CE7' },
};

@customElement('team-org-chart')
export class TeamOrgChart extends LitElement {
  @state() private orgData: { hierarchy?: OrgHierarchy } | null = null;
  @state() private agentStatuses: Record<string, AgentStatus> = {};
  @state() private activeCCs: string[] = [];
  @state() private loading = false;
  @state() private showCreateModal = false;
  @state() private createForm = { id: '', name: '', description: '' };

  createRenderRoot() { return this; }

  connectedCallback() {
    super.connectedCallback();
    this.load();
  }

  async load() {
    this.loading = true;
    try {
      const apiFn = (window as any).api || ((url: string) => fetch('/api' + url).then(r => r.json()));
      const [org, agents, license] = await Promise.all([
        apiFn('/org-chart'),
        apiFn('/agents'),
        apiFn('/license'),
      ]);
      this.orgData = org;
      (window as any)._orgData = org;
      this.activeCCs = license?.command_centres_active || license?.modules_active || ['business', 'wealth', 'life'];
      const statuses: Record<string, AgentStatus> = {};
      for (const a of (agents?.agents || [])) {
        statuses[a.id] = a;
      }
      this.agentStatuses = statuses;
    } catch { /* ignore */ }
    finally { this.loading = false; }
  }

  private _tierInfo(modelStr: string): TierInfo {
    const fn = (window as any).modelTierInfo;
    if (fn) { return fn(modelStr); }
    return { tier: 'other', cls: 'tier-haiku', label: modelStr || '?' };
  }

  private _openCreate() {
    this.createForm = { id: '', name: '', description: '' };
    this.showCreateModal = true;
  }

  private _closeCreate() { this.showCreateModal = false; }

  private _autoId() {
    const name = this.createForm.name.trim();
    if (!name) return;
    this.createForm = {
      ...this.createForm,
      id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 32),
    };
  }

  private async _submitCreate() {
    const apiFn = (window as any).api;
    const toast = (window as any).showToast;
    const { id, name, description } = this.createForm;
    if (!id || !name) { toast?.('Please fill in agent ID and name', 'error'); return; }
    try {
      const res = await apiFn('/agents/create', {
        method: 'POST', body: { id, name, description, command_centre: 'business' },
      });
      if (res?.ok) {
        toast?.(`${res.name || name} created — your AI system is restarting (~10s)`, 'success');
        this._closeCreate();
        await this.load();
        // Navigate to chat with the new agent after gateway restart
        setTimeout(() => {
          // Switch to chat view
          const switchView = (window as any).switchView;
          if (typeof switchView === 'function') switchView('chat');
          // Select the new agent in chat
          document.dispatchEvent(new CustomEvent('aiwh-agent-switch', { detail: { agentId: id } }));
        }, 4000);
      } else {
        toast?.(res?.error || 'Failed to create agent', 'error');
      }
    } catch { toast?.('Failed to create agent', 'error'); }
  }

  private _onCardClick(agentId: string) {
    if (typeof (window as any).openAgentDetail === 'function') {
      (window as any).openAgentDetail(agentId);
    }
  }

  private _renderAgentCard(node: OrgAgent, isRoot = false) {
    const status = this.agentStatuses[node.id];
    const agentStatus = status?.status || 'idle';
    // Use live agent data from openclaw.json (via /api/agents) as source of truth
    const agentModel = status?.modelTier || status?.model || node.model || 'haiku';
    const mti = this._tierInfo(agentModel);
    const name = status?.display_name || node.displayName || node.id;
    const avatarUrl = status?.avatar_url || '';
    const desc = node.description || '';
    const hasReports = node.reports && node.reports.length > 0;
    const depts = status?.departments || [];
    const isCustom = status?.source === 'client';

    const avatarHtml = avatarUrl
      ? html`<img src="${avatarUrl}" alt="" class="tc-avatar-img">`
      : html`<svg width="26" height="26" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="6" r="3" stroke="currentColor" stroke-width="1.2" opacity="0.4"/><path d="M2.5 14c0-3 2.5-5.5 5.5-5.5s5.5 2.5 5.5 5.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity="0.4"/></svg>`;

    return html`
      <div class="org-node ${isRoot ? 'org-root' : ''}">
        <div class="tc-card ${isRoot ? 'tc-card-ceo' : ''} glass"
             @click=${(e: Event) => {
               // Don't navigate if clicking sub-agent items
               if ((e.target as HTMLElement).closest('.tc-sub-item')) return;
               this._onCardClick(node.id);
             }}
             title="${name} — ${node.title || ''}">
          <span class="tc-status-dot status-dot status-${agentStatus}"></span>
          <div class="tc-avatar">${avatarHtml}</div>
          <div class="tc-info">
            <div class="tc-name" title="${name}">${name}</div>
            <div class="tc-title" title="${node.title || ''}">${node.title || ''}</div>
            <div class="tc-tier-row">
              <span class="tc-tier ${mti.cls}">${mti.label}</span>
            </div>
            <div class="tc-dept-slot">
              ${depts.length ? html`
                <div class="tc-dept-chips">
                  ${depts.map(d => html`<span class="tc-dept-chip">${d.name}</span>`)}
                </div>` : nothing}
            </div>
          </div>
          <div class="tc-desc" title="${desc}">${desc || '\u00A0'}</div>
          ${hasReports ? html`
            <span class="tc-subs-trigger">&#9662;</span>
            <div class="tc-subs-dropdown">
              ${node.reports!.map(child => {
                const cStatus = this.agentStatuses[child.id]?.status || 'idle';
                const cName = this.agentStatuses[child.id]?.display_name || child.displayName || child.id;
                return html`
                  <div class="tc-sub-item" @click=${(e: Event) => { e.stopPropagation(); this._onCardClick(child.id); }}>
                    <span class="status-dot status-${cStatus}"></span>
                    <span class="tc-sub-name">${cName}</span>
                  </div>`;
              })}
            </div>` : nothing}
        </div>
      </div>
    `;
  }

  private _renderCustomAgentCard(node: OrgAgent) {
    const status = this.agentStatuses[node.id];
    const name = status?.display_name || node.displayName || node.id;
    const isTrashed = !!node.trashed;
    const trashedAt = node.trashedAt ? new Date(node.trashedAt) : null;
    const hoursElapsed = trashedAt ? (Date.now() - trashedAt.getTime()) / (1000 * 60 * 60) : 0;
    const canDelete = isTrashed && hoursElapsed >= 48;
    const hoursRemaining = isTrashed && !canDelete ? Math.ceil(48 - hoursElapsed) : 0;

    if (isTrashed) {
      return html`
        <div class="org-node">
          <div class="tc-card glass tc-card-trashed">
            <div class="tc-info" style="width:100%">
              <div class="tc-name" style="opacity:0.5;text-decoration:line-through">${name}</div>
              <div class="tc-title" style="opacity:0.4">Trashed</div>
              <div class="tc-custom-actions">
                <button class="tc-action-btn tc-action-restore" @click=${() => this._restoreAgent(node.id, name)}>Restore</button>
                <button class="tc-action-btn tc-action-delete ${canDelete ? '' : 'tc-action-disabled'}"
                  @click=${() => canDelete ? this._deleteAgent(node.id, name) : null}
                  title=${canDelete ? 'Permanently delete' : `${hoursRemaining}h remaining`}>
                  ${canDelete ? 'Delete' : `Delete (${hoursRemaining}h)`}
                </button>
              </div>
            </div>
          </div>
        </div>`;
    }

    // Active custom agent — render normal card + trash button
    const card = this._renderAgentCard(node);
    return html`
      <div class="tc-custom-wrap">
        ${card}
        <button class="tc-trash-btn" @click=${(e: Event) => { e.stopPropagation(); this._trashAgent(node.id, name); }}
          title="Move to trash">&#128465;</button>
      </div>`;
  }

  @state() private agentActionModal: {
    type: 'trash' | 'restore' | 'delete';
    id: string;
    name: string;
    deps: { tasks: any[]; crons: any[] } | null;
    confirmText: string;
    loading: boolean;
  } | null = null;

  private async _trashAgent(id: string, displayName?: string) {
    const apiFn = (window as any).api;
    const status = this.agentStatuses[id];
    const name = displayName || status?.display_name || id;
    this.agentActionModal = { type: 'trash', id, name, deps: null, confirmText: '', loading: true };
    try {
      const deps = await apiFn(`/agents/${id}/dependencies`);
      this.agentActionModal = { ...this.agentActionModal!, deps, loading: false };
    } catch {
      this.agentActionModal = { ...this.agentActionModal!, deps: { tasks: [], crons: [] }, loading: false };
    }
  }

  private _restoreAgent(id: string, displayName?: string) {
    const status = this.agentStatuses[id];
    const name = displayName || status?.display_name || id;
    this.agentActionModal = { type: 'restore', id, name, deps: null, confirmText: '', loading: false };
  }

  private async _deleteAgent(id: string, displayName?: string) {
    const apiFn = (window as any).api;
    const status = this.agentStatuses[id];
    const name = displayName || status?.display_name || id;
    this.agentActionModal = { type: 'delete', id, name, deps: null, confirmText: '', loading: true };
    try {
      const deps = await apiFn(`/agents/${id}/dependencies`);
      this.agentActionModal = { ...this.agentActionModal!, deps, loading: false };
    } catch {
      this.agentActionModal = { ...this.agentActionModal!, deps: { tasks: [], crons: [] }, loading: false };
    }
  }

  private async _confirmAction() {
    const m = this.agentActionModal;
    if (!m) return;
    const apiFn = (window as any).api;
    const toast = (window as any).showToast;

    // Show processing state — blocks UI until complete
    this.agentActionModal = { ...m, loading: true, confirmText: '' };

    try {
      let res;
      if (m.type === 'trash') {
        res = await apiFn(`/agents/${m.id}/trash`, { method: 'POST', body: {} });
      } else if (m.type === 'restore') {
        res = await apiFn(`/agents/${m.id}/restore`, { method: 'POST', body: {} });
      } else {
        res = await apiFn(`/agents/${m.id}`, { method: 'DELETE' });
      }
      if (res?.ok) {
        // Wait for gateway restart to complete before closing modal
        await new Promise(r => setTimeout(r, 10000));
        await this.load();
        document.dispatchEvent(new CustomEvent('aiwh-sidebar-refresh'));
        toast?.(res.message || 'Done', 'success');
        this.agentActionModal = null;
      } else {
        toast?.(res?.error || 'Action failed', 'error');
        this.agentActionModal = { ...m, loading: false };
      }
    } catch {
      toast?.('Action failed', 'error');
      this.agentActionModal = { ...m, loading: false };
    }
  }

  private _renderActionModal() {
    const m = this.agentActionModal;
    if (!m) return nothing;

    const tasks = m.deps?.tasks || [];
    const crons = m.deps?.crons || [];
    const hasDeps = tasks.length > 0 || crons.length > 0;

    let title = '';
    let body = html``;
    let confirmRequired = '';
    let btnLabel = '';
    let btnClass = '';

    if (m.type === 'trash') {
      title = `Trash "${m.name}"`;
      confirmRequired = 'CONFIRM';
      btnLabel = 'Move to Trash';
      btnClass = 'tc-action-delete';
      body = html`
        <div class="tc-modal-warn">This will immediately:</div>
        <ul class="tc-modal-list">
          <li>Remove the agent from your AI system</li>
          <li>You will no longer be able to chat with this agent</li>
          ${crons.length ? html`<li><strong>${crons.length} cron${crons.length > 1 ? 's' : ''}</strong> will be skipped while trashed</li>` : nothing}
          ${tasks.length ? html`<li><strong>${tasks.length} task${tasks.length > 1 ? 's' : ''}</strong> assigned to this agent will be paused</li>` : nothing}
        </ul>
        ${hasDeps ? html`
          <div class="tc-modal-deps">
            ${crons.length ? html`
              <div class="tc-modal-dep-title">Crons (will be skipped)</div>
              ${crons.map(c => html`<div class="tc-modal-dep-item">${c.name} <span class="tc-modal-dep-meta">${typeof c.schedule === 'string' ? c.schedule : c.schedule?.cron || ''}</span></div>`)}
            ` : nothing}
            ${tasks.length ? html`
              <div class="tc-modal-dep-title">Tasks (will be paused)</div>
              ${tasks.map(t => html`<div class="tc-modal-dep-item">${t.title} <span class="tc-modal-dep-meta">${t.status}</span></div>`)}
            ` : nothing}
          </div>` : nothing}
        <div class="tc-modal-note">Files are preserved for 48 hours. You can restore the agent during this period.</div>
      `;
    } else if (m.type === 'restore') {
      title = `Restore "${m.name}"`;
      confirmRequired = '';
      btnLabel = 'Restore Agent';
      btnClass = 'tc-action-restore';
      body = html`
        <div class="tc-modal-warn">This will:</div>
        <ul class="tc-modal-list">
          <li>Re-register the agent in your AI system (~10s restart)</li>
          <li>You will be able to chat with this agent again</li>
          <li>Crons and tasks will resume as before</li>
        </ul>
      `;
    } else {
      title = `Permanently Delete "${m.name}"`;
      confirmRequired = 'I confirm deletion';
      btnLabel = 'Delete Forever';
      btnClass = 'tc-action-delete';
      body = html`
        <div class="tc-modal-warn tc-modal-danger">This action cannot be undone.</div>
        <ul class="tc-modal-list">
          <li>All agent files will be permanently deleted</li>
          <li>The agent will be removed from your AI system</li>
          ${crons.length ? html`<li><strong>${crons.length} cron${crons.length > 1 ? 's' : ''}</strong> will be <strong>deleted</strong></li>` : nothing}
          ${tasks.length ? html`<li><strong>${tasks.length} task${tasks.length > 1 ? 's' : ''}</strong> will be <strong>unassigned</strong> (tasks remain in your backlog)</li>` : nothing}
        </ul>
        ${hasDeps ? html`
          <div class="tc-modal-deps">
            ${crons.length ? html`
              <div class="tc-modal-dep-title">Crons (will be deleted)</div>
              ${crons.map(c => html`<div class="tc-modal-dep-item">${c.name} <span class="tc-modal-dep-meta">${typeof c.schedule === 'string' ? c.schedule : c.schedule?.cron || ''}</span></div>`)}
            ` : nothing}
            ${tasks.length ? html`
              <div class="tc-modal-dep-title">Tasks (will be unassigned)</div>
              ${tasks.map(t => html`<div class="tc-modal-dep-item">${t.title} <span class="tc-modal-dep-meta">${t.status}</span></div>`)}
            ` : nothing}
          </div>` : nothing}
      `;
    }

    const canConfirm = !confirmRequired || m.confirmText.toLowerCase() === confirmRequired.toLowerCase();

    return html`
      <div class="tc-create-overlay" @click=${(e: Event) => { if (e.target === e.currentTarget) this.agentActionModal = null; }}>
        <div class="tc-create-modal" style="max-width:520px">
          <h3>${title}</h3>
          ${m.loading ? html`<div style="padding:24px;text-align:center;color:var(--text-muted)">
            <div style="margin-bottom:8px;font-size:18px">&#9203;</div>
            ${m.confirmText === '' && m.deps === null ? 'Loading...' : 'Processing — please wait while your AI system restarts...'}
          </div>` : html`
            ${body}
            ${confirmRequired ? html`
              <label style="margin-top:14px">Type <strong style="color:var(--magenta,#C9A84C)">${confirmRequired}</strong> to proceed</label>
              <input type="text" placeholder="Type here..." autocomplete="off" spellcheck="false"
                .value=${m.confirmText}
                @input=${(e: Event) => {
                  this.agentActionModal = { ...m, confirmText: (e.target as HTMLInputElement).value };
                }}
                @keydown=${(e: KeyboardEvent) => { if (e.key === 'Enter' && canConfirm) this._confirmAction(); }}>
            ` : nothing}
            <div class="tc-create-btns">
              <button class="tc-create-btn tc-btn-ghost" @click=${() => { this.agentActionModal = null; }}>Cancel</button>
              <button class="tc-create-btn ${btnClass}" ?disabled=${!canConfirm}
                @click=${() => this._confirmAction()}>${btnLabel}</button>
            </div>
          `}
        </div>
      </div>
    `;
  }

  private _renderCreateModal() {
    return html`
      <div class="tc-create-overlay" @click=${(e: Event) => {
        if (e.target === e.currentTarget) this._closeCreate();
      }}>
        <div class="tc-create-modal">
          <h3>Create Agent</h3>
          <label>Agent Name</label>
          <input type="text" placeholder="e.g. Lead Qualifier" maxlength="40"
            .value=${this.createForm.name}
            @input=${(e: Event) => {
              this.createForm = { ...this.createForm, name: (e.target as HTMLInputElement).value };
            }}
            @blur=${() => { if (!this.createForm.id) this._autoId(); }}>
          <label>Agent ID</label>
          <input type="text" placeholder="e.g. lead-qualifier" maxlength="32"
            .value=${this.createForm.id}
            @input=${(e: Event) => {
              this.createForm = { ...this.createForm, id: (e.target as HTMLInputElement).value.toLowerCase().replace(/[^a-z0-9-]/g, '') };
            }}>
          <div class="tc-id-hint">Lowercase letters, numbers, and hyphens only</div>
          <label>Description (optional)</label>
          <textarea rows="3" placeholder="What should this agent do?"
            .value=${this.createForm.description}
            @input=${(e: Event) => {
              this.createForm = { ...this.createForm, description: (e.target as HTMLTextAreaElement).value };
            }}></textarea>
          <div class="tc-notice">
            <span style="flex-shrink:0;font-size:14px">&#9432;</span>
            <span>Creating an agent will briefly restart your AI system (~10 seconds). You'll be taken to a chat with your new agent once it's ready.</span>
          </div>
          <div class="tc-create-btns">
            <button class="tc-create-btn tc-btn-ghost" @click=${() => this._closeCreate()}>Cancel</button>
            <button class="tc-create-btn" @click=${() => this._submitCreate()}>Create</button>
          </div>
        </div>
      </div>
    `;
  }

  render() {
    if (this.loading) {
      return html`<div style="text-align:center;padding:32px;color:var(--text-muted)">Loading team...</div>`;
    }

    const root = this.orgData?.hierarchy;
    if (!root) {
      return html`<div style="text-align:center;padding:32px;color:var(--text-muted)">No org chart data</div>`;
    }

    // New v2 format: commandCentres array
    const commandCentres = root.commandCentres;
    if (commandCentres && commandCentres.length > 0) {
      return html`
        ${this._renderAgentCard(root as OrgAgent, true)}
        <div class="org-modules">
          ${commandCentres.map(cc => {
            const meta = CC_META[cc.id] || { label: cc.name, color: 'var(--text-muted)' };
            const isLocked = cc.id !== 'system' && cc.id !== 'custom' && !this.activeCCs.includes(cc.id);

            return html`
              <div class="org-module-section${isLocked ? ' module-locked' : ''}">
                <div class="org-module-label" style="--mod-color:${isLocked ? 'var(--text-dim)' : meta.color}">
                  ${cc.icon || ''} ${cc.name}${isLocked ? html` <span class="module-lock-badge">LOCKED</span>` : nothing}
                  ${cc.ownerLocked ? html` <span class="module-lock-badge" style="background:var(--green);color:#000">PRIVATE</span>` : nothing}
                </div>
                ${isLocked
                  ? html`<div class="org-module-locked-msg">This Command Centre is not included in your plan.</div>`
                  : cc.id === 'custom'
                    ? html`${cc.departments.map(dept => html`
                        <div class="org-dept-section">
                          <div class="org-dept-label">${dept.name}</div>
                          <div class="org-module-cards">
                            ${dept.agents.map(agent => this._renderCustomAgentCard(agent))}
                          </div>
                        </div>
                      `)}`
                    : html`${cc.departments.map(dept => html`
                        <div class="org-dept-section">
                          <div class="org-dept-label">${dept.name}</div>
                          <div class="org-module-cards">
                            ${dept.agents.map(agent => this._renderAgentCard(agent))}
                          </div>
                        </div>
                      `)}`
                }
              </div>
            `;
          })}
        </div>
        <div style="text-align:center;margin-top:24px">
          <button class="tc-create-agent-btn" @click=${() => this._openCreate()}>
            <span style="font-size:18px;line-height:1">+</span> Create Custom Agent
          </button>
        </div>
        ${this.showCreateModal ? this._renderCreateModal() : nothing}
        ${this.agentActionModal ? this._renderActionModal() : nothing}
      `;
    }

    // Legacy v1 fallback: flat reports grouped by module
    const ceoHtml = this._renderAgentCard(root as OrgAgent, true);
    const reports = root.reports || [];
    return html`
      ${ceoHtml}
      <div class="org-modules">
        <div class="org-module-section">
          <div class="org-module-cards">
            ${reports.map(child => this._renderAgentCard(child))}
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap { 'team-org-chart': TeamOrgChart; }
}
