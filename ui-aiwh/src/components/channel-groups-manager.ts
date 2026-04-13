import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

const api = (window as any).api as (url: string, opts?: any) => Promise<any>;
const showToast = (window as any).showToast as (msg: string, type?: string) => void;

type GroupPolicy = 'open' | 'allowlist' | 'disabled';

type DiscoveredGroup = {
  id: string;
  name: string;
  displayName?: string;
  kind: string;
  memberCount: number | null;
  configured: boolean;
  discovered?: boolean;
};

type GroupConfig = {
  requireMention?: boolean;
  allowFrom?: string[];
  groupPolicy?: GroupPolicy;
  ingest?: boolean;
  enabled?: boolean;
};

type GroupsConfigResponse = {
  groupPolicy: GroupPolicy;
  groupAllowFrom: string[];
  groups: Record<string, GroupConfig>;
  displayNames: Record<string, string>;
};

@customElement('channel-groups-manager')
export class ChannelGroupsManager extends LitElement {
  @property({ type: String }) channel = '';
  @property({ type: String }) accountId = 'default';

  @state() private loading = true;
  @state() private saving = false;
  @state() private error = '';
  @state() private discovered: DiscoveredGroup[] = [];
  @state() private cfg: GroupsConfigResponse = { groupPolicy: 'open', groupAllowFrom: [], groups: {}, displayNames: {} };
  @state() private expandedGroupId: string | null = null;
  @state() private allowFromDraft = '';
  @state() private displayNameDraft: Record<string, string> = {};

  private supportsPerGroupAccess(): boolean {
    return this.channel === 'telegram';
  }

  static styles = css`
    :host { display: block; font-family: 'Inter', -apple-system, sans-serif; color: var(--text-primary, #F5EDD6); }
    .card { background: var(--surface); border: 1px solid var(--border-dim); border-radius: 6px; padding: 18px; margin-bottom: 14px; }
    .card h3 { margin: 0 0 4px; font-size: 13px; font-weight: 600; color: var(--magenta, #C9A84C); text-transform: uppercase; letter-spacing: 0.5px; }
    .card-sub { font-size: 12px; color: var(--text-muted); margin-bottom: 12px; }
    .row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    .row + .row { margin-top: 10px; }
    label { font-size: 12px; color: var(--text-muted); }
    select, input[type="text"] { background: rgba(0,0,0,0.25); color: var(--text-primary); border: 1px solid var(--border-dim); border-radius: 4px; padding: 6px 8px; font-size: 12px; }
    button { background: transparent; color: var(--text-primary); border: 1px solid var(--border-dim); border-radius: 4px; padding: 6px 12px; font-size: 12px; cursor: pointer; }
    button:hover { border-color: var(--magenta, #C9A84C); color: var(--magenta, #C9A84C); }
    button.primary { background: rgba(201,168,76,0.12); border-color: var(--magenta, #C9A84C); color: var(--magenta, #C9A84C); }
    button.danger:hover { border-color: var(--error, #E05770); color: var(--error, #E05770); }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .empty { padding: 20px; text-align: center; color: var(--text-muted); font-size: 12px; }
    .err { padding: 12px; background: rgba(224,87,112,0.08); border: 1px solid var(--error, #E05770); border-radius: 4px; color: var(--error, #E05770); font-size: 12px; margin-bottom: 10px; }
    .group-list { display: flex; flex-direction: column; gap: 6px; }
    .group-row { display: flex; align-items: center; gap: 10px; padding: 10px 12px; background: rgba(0,0,0,0.2); border: 1px solid var(--border-dim); border-radius: 4px; cursor: pointer; }
    .group-row:hover { border-color: var(--text-muted); }
    .group-row.configured { border-color: rgba(76,175,122,0.5); }
    .group-row.allowlisted { border-left: 3px solid var(--success, #4CAF7A); }
    .group-name { flex: 1; font-size: 13px; font-weight: 500; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .group-id { font-size: 11px; color: var(--text-muted); font-family: ui-monospace, monospace; }
    .badge { font-size: 10px; padding: 2px 6px; border-radius: 10px; border: 1px solid var(--border-dim); color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.4px; }
    .badge.on { border-color: var(--success, #4CAF7A); color: var(--success, #4CAF7A); }
    .detail { background: rgba(0,0,0,0.3); border: 1px solid var(--border-dim); border-radius: 4px; padding: 14px; margin-top: 6px; }
    .detail h4 { margin: 0 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.4px; color: var(--text-muted); }
    .chip-list { display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 0 10px; }
    .chip { display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; background: rgba(201,168,76,0.08); border: 1px solid var(--magenta, #C9A84C); border-radius: 10px; font-size: 11px; color: var(--magenta, #C9A84C); }
    .chip button { padding: 0 4px; background: transparent; border: none; color: inherit; font-size: 13px; cursor: pointer; }
    .toggle-row { display: flex; align-items: center; gap: 8px; margin: 10px 0; font-size: 12px; }
    .actions { display: flex; gap: 6px; margin-top: 12px; justify-content: flex-end; }
    .loading { padding: 20px; text-align: center; color: var(--text-muted); font-size: 12px; }
    .warning { padding: 8px 12px; background: rgba(201,168,76,0.06); border: 1px solid var(--magenta, #C9A84C); border-radius: 4px; color: var(--magenta, #C9A84C); font-size: 11px; margin-bottom: 10px; }
  `;

  connectedCallback(): void {
    super.connectedCallback();
    this.load();
  }

  updated(changed: Map<string, unknown>): void {
    if (changed.has('channel') || changed.has('accountId')) {
      this.load();
    }
  }

  private async load() {
    if (!this.channel) return;
    this.loading = true;
    this.error = '';
    try {
      const qs = `?channel=${encodeURIComponent(this.channel)}&accountId=${encodeURIComponent(this.accountId)}`;
      const [listRes, cfgRes] = await Promise.all([
        api('/channels/groups/list' + qs),
        api('/channels/groups/config' + qs),
      ]);
      this.discovered = Array.isArray(listRes?.groups) ? listRes.groups : [];
      if (listRes?.warning) {
        this.error = `Discovery warning: ${listRes.warning}`;
      }
      this.cfg = {
        groupPolicy: cfgRes?.groupPolicy || 'open',
        groupAllowFrom: Array.isArray(cfgRes?.groupAllowFrom) ? cfgRes.groupAllowFrom : [],
        groups: (cfgRes?.groups && typeof cfgRes.groups === 'object') ? cfgRes.groups : {},
        displayNames: (cfgRes?.displayNames && typeof cfgRes.displayNames === 'object') ? cfgRes.displayNames : {},
      };
      this.displayNameDraft = { ...this.cfg.displayNames };
    } catch (e: any) {
      this.error = e?.message || 'Failed to load groups';
    } finally {
      this.loading = false;
    }
  }

  private async saveDefaults() {
    this.saving = true;
    try {
      const res = await api('/channels/groups/config', {
        method: 'POST',
        body: {
          channel: this.channel,
          accountId: this.accountId,
          defaults: {
            groupPolicy: this.cfg.groupPolicy,
            groupAllowFrom: this.cfg.groupAllowFrom,
          },
        },
      });
      if (res?.error) throw new Error(res.error);
      showToast('Defaults saved', 'success');
      await this.load();
    } catch (e: any) {
      showToast(`Save failed: ${e.message}`, 'error');
    } finally {
      this.saving = false;
    }
  }

  private async saveGroup(groupId: string, patch: GroupConfig) {
    this.saving = true;
    try {
      const body: any = {
        channel: this.channel,
        accountId: this.accountId,
        groupId,
        config: { ...patch },
      };
      const draftName = this.displayNameDraft[groupId];
      const savedName = this.cfg.displayNames[groupId] || '';
      if (draftName !== undefined && draftName !== savedName) {
        body.config.displayName = draftName;
      }
      const res = await api('/channels/groups/config', { method: 'POST', body });
      if (res?.error) throw new Error(res.error);
      showToast('Group updated', 'success');
      await this.load();
    } catch (e: any) {
      showToast(`Save failed: ${e.message}`, 'error');
    } finally {
      this.saving = false;
    }
  }

  private async removeGroup(groupId: string) {
    if (!confirm(`Remove per-group config for "${groupId}"?`)) return;
    this.saving = true;
    try {
      const res = await api('/channels/groups/config', {
        method: 'DELETE',
        body: { channel: this.channel, accountId: this.accountId, groupId },
      });
      if (res?.error) throw new Error(res.error);
      showToast('Group config removed', 'success');
      this.expandedGroupId = null;
      await this.load();
    } catch (e: any) {
      showToast(`Delete failed: ${e.message}`, 'error');
    } finally {
      this.saving = false;
    }
  }

  private addAllowFrom(groupId: string | null) {
    const val = this.allowFromDraft.trim();
    if (!val) return;
    if (groupId) {
      const current = this.cfg.groups[groupId]?.allowFrom || [];
      if (current.includes(val)) return;
      const next = [...current, val];
      this.cfg = {
        ...this.cfg,
        groups: { ...this.cfg.groups, [groupId]: { ...this.cfg.groups[groupId], allowFrom: next } },
      };
    } else {
      if (this.cfg.groupAllowFrom.includes(val)) return;
      this.cfg = { ...this.cfg, groupAllowFrom: [...this.cfg.groupAllowFrom, val] };
    }
    this.allowFromDraft = '';
  }

  private removeAllowFrom(groupId: string | null, value: string) {
    if (groupId) {
      const current = this.cfg.groups[groupId]?.allowFrom || [];
      const next = current.filter((v) => v !== value);
      this.cfg = {
        ...this.cfg,
        groups: { ...this.cfg.groups, [groupId]: { ...this.cfg.groups[groupId], allowFrom: next } },
      };
    } else {
      this.cfg = { ...this.cfg, groupAllowFrom: this.cfg.groupAllowFrom.filter((v) => v !== value) };
    }
  }

  render() {
    if (!this.channel) {
      return html`<div class="empty">No channel selected</div>`;
    }
    if (this.loading) {
      return html`<div class="loading">Loading groups…</div>`;
    }

    const perGroup = this.supportsPerGroupAccess();
    const rows = this.discovered.map((g) => {
      const cfg = this.cfg.groups[g.id] || {};
      const effectivePolicy: GroupPolicy = perGroup
        ? (cfg.groupPolicy ?? this.cfg.groupPolicy)
        : this.cfg.groupPolicy;
      const allowed = effectivePolicy !== 'disabled'
        && (effectivePolicy === 'open' || this.cfg.groupAllowFrom.length > 0 || (cfg.allowFrom?.length ?? 0) > 0);
      const expanded = this.expandedGroupId === g.id;
      const label = this.cfg.displayNames[g.id] || g.displayName || g.name || g.id;
      return html`
        <div class="group-row ${g.configured ? 'configured' : ''} ${allowed ? 'allowlisted' : ''}"
             @click=${() => { this.expandedGroupId = expanded ? null : g.id; }}>
          <span class="group-name">${label}</span>
          <span class="group-id">${g.id}</span>
          <span class="badge ${allowed ? 'on' : ''}">${effectivePolicy}</span>
        </div>
        ${expanded ? this.renderDetail(g.id, cfg, perGroup) : ''}
      `;
    });

    const policyHint = this.channel === 'whatsapp'
      ? 'WhatsApp access is channel-level only. The sender allowlist below filters who the bot responds to across every group it is a member of.'
      : 'Default policy applies to every group unless a specific group overrides it below.';

    return html`
      ${this.error ? html`<div class="err">${this.error}</div>` : ''}

      <div class="card">
        <h3>Channel Access</h3>
        <div class="card-sub">${policyHint}</div>
        <div class="row">
          <label>Group policy
            <select .value=${this.cfg.groupPolicy}
                    @change=${(e: Event) => {
                      const v = (e.target as HTMLSelectElement).value as GroupPolicy;
                      this.cfg = { ...this.cfg, groupPolicy: v };
                    }}>
              <option value="open">Open — respond to anyone</option>
              <option value="allowlist">Allowlist — only approved senders</option>
              <option value="disabled">Disabled — ignore all groups</option>
            </select>
          </label>
        </div>
        <div class="row">
          <label style="width:100%">Approved senders (phone numbers, usernames, or user IDs)</label>
        </div>
        <div class="chip-list">
          ${this.cfg.groupAllowFrom.map((v) => html`
            <span class="chip">${v}<button @click=${() => this.removeAllowFrom(null, v)}>×</button></span>
          `)}
        </div>
        <div class="row">
          <input type="text" placeholder="e.g. 61412345678"
                 .value=${this.allowFromDraft}
                 @input=${(e: Event) => { this.allowFromDraft = (e.target as HTMLInputElement).value; }}
                 @keydown=${(e: KeyboardEvent) => { if (e.key === 'Enter') this.addAllowFrom(null); }} />
          <button @click=${() => this.addAllowFrom(null)}>Add</button>
          <button class="primary" ?disabled=${this.saving} @click=${() => this.saveDefaults()}>Save Channel Access</button>
        </div>
      </div>

      <div class="card">
        <h3>Discovered Groups</h3>
        <div class="card-sub">
          ${this.discovered.length} group(s).
          ${perGroup
            ? 'Click a row to override policy for that specific group.'
            : 'Click a row to tweak per-group knobs (require @mention).'}
        </div>
        ${this.discovered.length === 0
          ? html`<div class="empty">No groups found. Add Branson to a group and refresh.</div>`
          : html`<div class="group-list">${rows}</div>`}
        <div class="actions">
          <button @click=${() => this.load()}>Refresh</button>
        </div>
      </div>
    `;
  }

  private renderDetail(groupId: string, cfg: GroupConfig, perGroupAccess: boolean) {
    const draftName = this.displayNameDraft[groupId] ?? this.cfg.displayNames[groupId] ?? '';
    return html`
      <div class="detail" @click=${(e: Event) => e.stopPropagation()}>
        <h4>Per-Group Settings</h4>
        <div class="row">
          <label style="width:100%">Display name (dashboard only, does not rename the real group)</label>
        </div>
        <div class="row">
          <input type="text" placeholder="e.g. Leadership Channel" style="flex:1"
                 .value=${draftName}
                 maxlength="120"
                 @input=${(e: Event) => {
                   const v = (e.target as HTMLInputElement).value;
                   this.displayNameDraft = { ...this.displayNameDraft, [groupId]: v };
                 }} />
          ${draftName ? html`
            <button class="danger" ?disabled=${this.saving}
                    @click=${() => {
                      this.displayNameDraft = { ...this.displayNameDraft, [groupId]: '' };
                    }}>Clear</button>
          ` : ''}
        </div>
        ${perGroupAccess ? html`
          <div class="row">
            <label>Override policy
              <select .value=${cfg.groupPolicy ?? ''}
                      @change=${(e: Event) => {
                        const raw = (e.target as HTMLSelectElement).value;
                        const patch: GroupConfig = { ...cfg };
                        if (raw === '') delete patch.groupPolicy;
                        else patch.groupPolicy = raw as GroupPolicy;
                        this.cfg = { ...this.cfg, groups: { ...this.cfg.groups, [groupId]: patch } };
                      }}>
                <option value="">— inherit channel default —</option>
                <option value="open">Open</option>
                <option value="allowlist">Allowlist</option>
                <option value="disabled">Disabled</option>
              </select>
            </label>
          </div>
          <div class="row"><label style="width:100%">Override allow-from (applies to this group only)</label></div>
          <div class="chip-list">
            ${(cfg.allowFrom || []).map((v) => html`
              <span class="chip">${v}<button @click=${() => this.removeAllowFrom(groupId, v)}>×</button></span>
            `)}
          </div>
          <div class="row">
            <input type="text" placeholder="user id / username"
                   .value=${this.allowFromDraft}
                   @input=${(e: Event) => { this.allowFromDraft = (e.target as HTMLInputElement).value; }}
                   @keydown=${(e: KeyboardEvent) => { if (e.key === 'Enter') this.addAllowFrom(groupId); }} />
            <button @click=${() => this.addAllowFrom(groupId)}>Add</button>
          </div>
        ` : html`
          <div class="warning">
            This channel does not support per-group access control. Use <strong>Channel Access</strong> above to manage who the bot responds to across all groups.
          </div>
        `}
        <div class="toggle-row">
          <label>
            <input type="checkbox" .checked=${cfg.requireMention === true}
                   @change=${(e: Event) => {
                     const v = (e.target as HTMLInputElement).checked;
                     this.cfg = {
                       ...this.cfg,
                       groups: { ...this.cfg.groups, [groupId]: { ...cfg, requireMention: v } },
                     };
                   }} />
            Require @mention
          </label>
        </div>
        <div class="actions">
          <button class="danger" ?disabled=${this.saving} @click=${() => this.removeGroup(groupId)}>Remove overrides</button>
          <button class="primary" ?disabled=${this.saving}
                  @click=${() => this.saveGroup(groupId, this.cfg.groups[groupId] || {})}>Save Group</button>
        </div>
      </div>
    `;
  }
}
