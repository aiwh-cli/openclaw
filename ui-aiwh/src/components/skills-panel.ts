import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { renderSkills, type SkillsProps, type SkillsStatusFilter } from '@openclaw/ui/views/skills.ts';
import { GatewayBrowserClient } from '@openclaw/ui/gateway.ts';
import { getGatewayClient } from './gateway-client.js';

type SkillStatusReport = { skills: any[]; workspaceDir?: string; managedSkillsDir?: string };
type SkillMessageMap = Record<string, { type: 'success' | 'error'; text: string }>;

@customElement('skills-panel')
export class SkillsPanel extends LitElement {
  @state() private connected = false;
  @state() private loading = true;
  @state() private error: string | null = null;
  @state() private report: SkillStatusReport | null = null;
  @state() private filter = '';
  @state() private edits: Record<string, string> = {};
  @state() private busyKey: string | null = null;
  @state() private messages: SkillMessageMap = {};
  @state() private statusFilter: SkillsStatusFilter = 'all';
  @state() private detailKey: string | null = null;

  private client: GatewayBrowserClient | null = null;

  static styles = css`:host { display: block; }`;

  connectedCallback() { super.connectedCallback(); this._init(); }

  private async _init() {
    this.client = await getGatewayClient();
    this.connected = true;
    this._loadSkills();
  }

  private async _loadSkills() {
    if (!this.client?.connected) {return;}
    this.loading = true; this.error = null;
    try {
      this.report = await this.client.request<SkillStatusReport>('skills.status', {});
    } catch (e: unknown) {
      this.error = e instanceof Error ? e.message : 'Failed to load skills';
    } finally { this.loading = false; }
  }

  private async _toggleSkill(skillKey: string, enabled: boolean) {
    if (!this.client?.connected) {return;}
    this.busyKey = skillKey;
    try {
      await this.client.request('skills.update', { skillKey, enabled });
      this.messages = { ...this.messages, [skillKey]: { type: 'success', text: enabled ? 'Enabled' : 'Disabled' } };
      this._loadSkills();
    } catch (e: unknown) {
      this.messages = { ...this.messages, [skillKey]: { type: 'error', text: e instanceof Error ? e.message : 'Failed' } };
    } finally { this.busyKey = null; }
  }

  private async _saveKey(skillKey: string) {
    if (!this.client?.connected) {return;}
    const value = this.edits[skillKey];
    if (!value) {return;}
    this.busyKey = skillKey;
    try {
      await this.client.request('skills.update', { skillKey, apiKey: value });
      this.messages = { ...this.messages, [skillKey]: { type: 'success', text: 'Key saved' } };
      const { [skillKey]: _, ...rest } = this.edits;
      this.edits = rest;
      this._loadSkills();
    } catch (e: unknown) {
      this.messages = { ...this.messages, [skillKey]: { type: 'error', text: e instanceof Error ? e.message : 'Failed' } };
    } finally { this.busyKey = null; }
  }

  private async _installSkill(skillKey: string, name: string, installId: string) {
    if (!this.client?.connected) {return;}
    this.busyKey = skillKey;
    try {
      await this.client.request('skills.install', { skillKey, name, installId });
      this.messages = { ...this.messages, [skillKey]: { type: 'success', text: 'Installed' } };
      this._loadSkills();
    } catch (e: unknown) {
      this.messages = { ...this.messages, [skillKey]: { type: 'error', text: e instanceof Error ? e.message : 'Failed' } };
    } finally { this.busyKey = null; }
  }

  render() {
    const props: SkillsProps = {
      connected: this.connected,
      loading: this.loading,
      report: this.report,
      error: this.error,
      filter: this.filter,
      statusFilter: this.statusFilter,
      edits: this.edits,
      busyKey: this.busyKey,
      messages: this.messages,
      detailKey: this.detailKey,
      onFilterChange: (f) => { this.filter = f; },
      onStatusFilterChange: (next) => { this.statusFilter = next; },
      onRefresh: () => this._loadSkills(),
      onToggle: (key, enabled) => this._toggleSkill(key, enabled),
      onEdit: (key, value) => { this.edits = { ...this.edits, [key]: value }; },
      onSaveKey: (key) => this._saveKey(key),
      onInstall: (key, name, installId) => this._installSkill(key, name, installId),
      onDetailOpen: (skillKey) => { this.detailKey = skillKey; },
      onDetailClose: () => { this.detailKey = null; },
    };

    return html`
      <link rel="stylesheet" href="/openclaw-theme-map.css">
      <link rel="stylesheet" href="/openclaw-styles/components.css">
      <link rel="stylesheet" href="/openclaw-styles/layout.css">
      ${renderSkills(props)}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap { 'skills-panel': SkillsPanel; }
}
