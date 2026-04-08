import { LitElement, html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';

interface OrgNode {
  id: string;
  displayName?: string;
  title?: string;
  description?: string;
  module?: string;
  model?: string;
  modelLabel?: string;
  reports?: OrgNode[];
}

interface AgentStatus {
  id: string;
  status: string;
  model?: string;
  modelTier?: string;
  display_name?: string;
  avatar_url?: string;
}

interface TierInfo {
  tier: string;
  cls: string;
  label: string;
}

const MODULE_META: Record<string, { label: string; color: string }> = {
  frontend:  { label: 'Frontend',  color: 'var(--magenta)' },
  backend:   { label: 'Backend',   color: 'var(--cyan)' },
  system:    { label: 'System',    color: 'var(--text-muted)' },
  lifestyle: { label: 'Lifestyle', color: 'var(--green)' },
};

@customElement('team-org-chart')
export class TeamOrgChart extends LitElement {
  @state() private orgData: { hierarchy?: OrgNode } | null = null;
  @state() private agentStatuses: Record<string, AgentStatus> = {};
  @state() private activeModules: string[] = [];
  @state() private loading = false;

  // Render in light DOM so dashboard team.css styles apply to org chart classes
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
      // Expose for team-detail.js (Phase 3 — will be removed when team-detail migrates to Lit)
      (window as any)._orgData = org;
      this.activeModules = license?.modules_active || ['frontend', 'backend', 'lifestyle'];
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
    if (fn) {return fn(modelStr);}
    return { tier: 'other', cls: 'tier-haiku', label: modelStr || '?' };
  }

  private _escHtml(str: string): string {
    if (!str) {return '';}
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  private _onCardClick(agentId: string) {
    // Call vanilla JS openAgentDetail (team-detail.js) directly
    if (typeof (window as any).openAgentDetail === 'function') {
      (window as any).openAgentDetail(agentId);
    }
  }

  private _renderNode(node: OrgNode, depth: number, isRoot = false, skipChildren = false) {
    const status = this.agentStatuses[node.id];
    const agentStatus = status?.status || 'idle';
    const agentModel = status?.model || status?.modelTier || node.modelLabel || node.model || 'haiku';
    const mti = this._tierInfo(agentModel);
    const name = status?.display_name || node.displayName || node.id;
    const avatarUrl = status?.avatar_url || '';
    const desc = node.description || '';
    const shortDesc = desc.length > 65 ? desc.substring(0, 62) + '...' : desc;
    const hasReports = node.reports && node.reports.length > 0;

    const hasScriptSubs = hasReports && node.reports!.every(r => {
      const rMod = (r.module || '').toLowerCase();
      return r.model === 'haiku' && rMod === node.module?.toLowerCase();
    });

    const avatarHtml = avatarUrl
      ? html`<img src="${avatarUrl}" alt="" class="tc-avatar-img">`
      : html`<svg width="26" height="26" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="6" r="3" stroke="currentColor" stroke-width="1.2" opacity="0.4"/><path d="M2.5 14c0-3 2.5-5.5 5.5-5.5s5.5 2.5 5.5 5.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity="0.4"/></svg>`;

    return html`
      <div class="org-node ${isRoot ? 'org-root' : ''}" data-depth="${depth}">
        <div class="tc-card ${isRoot ? 'tc-card-ceo' : ''} glass"
             @click=${() => this._onCardClick(node.id)}
             title="${name} — ${node.title || ''}">
          <span class="tc-status-dot status-dot status-${agentStatus}"></span>
          <div class="tc-avatar">${avatarHtml}</div>
          <div class="tc-info">
            <div class="tc-name">${name}</div>
            <div class="tc-title">${node.title || ''}</div>
            <span class="tc-tier ${mti.cls}">${node.modelLabel || mti.label}</span>
          </div>
          ${shortDesc ? html`<div class="tc-desc">${shortDesc}</div>` : nothing}
        </div>
        ${hasReports && !skipChildren
          ? hasScriptSubs
            ? html`<div class="org-subs-inline">
                ${node.reports!.map(child => {
                  const cStatus = this.agentStatuses[child.id]?.status || 'idle';
                  const cName = this.agentStatuses[child.id]?.display_name || child.displayName || child.id;
                  return html`
                    <div class="org-sub-chip" @click=${() => this._onCardClick(child.id)}>
                      <span class="status-dot status-${cStatus}"></span>
                      <span class="org-sub-name">${cName}</span>
                    </div>`;
                })}
              </div>`
            : html`<div class="org-children">
                ${node.reports!.map(child => this._renderNode(child, depth + 1))}
              </div>`
          : nothing
        }
      </div>
    `;
  }

  render() {
    if (this.loading) {
      return html`<div style="text-align:center;padding:32px;color:var(--text-muted)">Loading team...</div>`;
    }

    const node = this.orgData?.hierarchy;
    if (!node) {
      return html`<div style="text-align:center;padding:32px;color:var(--text-muted)">No org chart data</div>`;
    }

    // CEO at top
    const ceoHtml = this._renderNode(node, 0, true, true);

    // Group reports by module
    const reports = node.reports || [];
    const groups: Record<string, OrgNode[]> = {};
    for (const r of reports) {
      const mod = (r.module || 'system').toLowerCase();
      if (!groups[mod]) {groups[mod] = [];}
      groups[mod].push(r);
    }

    return html`
      ${ceoHtml}
      <div class="org-modules">
        ${['system', 'frontend', 'backend', 'lifestyle'].map(mod => {
          const agents = groups[mod];
          if (!agents?.length) {return nothing;}
          const meta = MODULE_META[mod] || { label: mod, color: 'var(--text-muted)' };
          const isLocked = mod !== 'system' && mod !== 'core' && !this.activeModules.includes(mod);

          return html`
            <div class="org-module-section${isLocked ? ' module-locked' : ''}">
              <div class="org-module-label" style="--mod-color:${isLocked ? 'var(--text-dim)' : meta.color}">
                ${meta.label}${isLocked ? html` <span class="module-lock-badge">LOCKED</span>` : nothing}
                <span class="org-module-count">${agents.length}</span>
              </div>
              ${isLocked
                ? html`<div class="org-module-locked-msg">This module is not included in your plan. Contact support to upgrade.</div>`
                : html`<div class="org-module-cards">
                    ${agents.map(child => this._renderNode(child, 1))}
                  </div>`
              }
            </div>
          `;
        })}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap { 'team-org-chart': TeamOrgChart; }
}
