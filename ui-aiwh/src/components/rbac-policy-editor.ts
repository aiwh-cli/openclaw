import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';

const api = (window as any).api as (url: string, opts?: any) => Promise<any>;
const showToast = (window as any).showToast as (msg: string, type?: string) => void;

type RolePolicy = { views: Record<string, boolean>; actions: Record<string, boolean> };
type Policy = { version: number; roles: Record<string, RolePolicy> };

const VIEW_LABELS: Record<string, string> = {
  overview: 'Overview', team: 'Team', tasks: 'Tasks', schedule: 'Schedule',
  workflows: 'Workflows', knowledge: 'Knowledge', social: 'Social Media',
  costs: 'Costs', channels: 'Channels', connectors: 'Connectors',
  logs: 'Logs', activity: 'Activity', trash: 'Trash',
  'team-access': 'Access', config: 'Config', security: 'Security',
  debug: 'Debug', wealth: 'Wealth',
};

const ACTION_LABELS: Record<string, string> = {
  manage_users: 'Manage Users', create_agents: 'Create Agents',
  manage_connectors: 'Manage Connectors', manage_workflows: 'Manage Workflows',
  manage_knowledge: 'Manage Knowledge', manage_channels: 'Manage Channels',
  view_costs: 'View Costs', manage_providers: 'Manage Providers',
  view_audit: 'View Audit Logs', manage_system: 'System Admin',
};

const VIEW_KEYS = Object.keys(VIEW_LABELS);
const ACTION_KEYS = Object.keys(ACTION_LABELS);

@customElement('rbac-policy-editor')
export class RbacPolicyEditor extends LitElement {
  @state() private policy: Policy | null = null;
  @state() private original = '';
  @state() private loading = true;
  @state() private saving = false;
  @state() private activeRole = 'admin';
  @state() private isOwner = false;

  static styles = css`
    :host { display: block; font-family: 'Inter', -apple-system, sans-serif; color: var(--text-primary, #F5EDD6); }
    .card { background: var(--surface); border: 1px solid var(--border-dim); border-radius: 6px; padding: 20px; margin-bottom: 16px; }
    .card h3 { margin: 0 0 4px; font-size: 14px; font-weight: 600; color: var(--magenta, #C9A84C); text-transform: uppercase; letter-spacing: 0.5px; }
    .card-subtitle { font-size: 12px; color: var(--text-muted); margin-bottom: 16px; }
    .role-tabs { display: flex; gap: 4px; margin-bottom: 16px; }
    .role-tab { padding: 6px 16px; border: 1px solid var(--border-dim); border-radius: 4px; background: transparent; color: var(--text-muted); font-size: 12px; font-weight: 600; cursor: pointer; text-transform: uppercase; letter-spacing: 0.3px; }
    .role-tab:hover { border-color: var(--text-muted); }
    .role-tab.active { background: rgba(201,168,76,0.12); border-color: var(--magenta, #C9A84C); color: var(--magenta, #C9A84C); }
    .section-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); margin: 14px 0 8px; padding-bottom: 4px; border-bottom: 1px solid var(--border-dim); }
    .perm-grid { display: grid; grid-template-columns: 1fr auto; gap: 0; }
    .perm-row { display: contents; }
    .perm-row:hover .perm-label, .perm-row:hover .perm-toggle { background: rgba(201,168,76,0.04); }
    .perm-label { padding: 8px 12px; font-size: 13px; display: flex; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.03); }
    .perm-toggle { padding: 8px 12px; display: flex; align-items: center; justify-content: center; border-bottom: 1px solid rgba(255,255,255,0.03); }
    .toggle { position: relative; width: 36px; height: 20px; cursor: pointer; }
    .toggle input { display: none; }
    .toggle .track { position: absolute; inset: 0; border-radius: 10px; background: rgba(255,255,255,0.08); border: 1px solid var(--border-dim); transition: background 0.15s, border-color 0.15s; }
    .toggle input:checked + .track { background: rgba(76,175,122,0.25); border-color: var(--success, #4CAF7A); }
    .toggle .thumb { position: absolute; top: 3px; left: 3px; width: 14px; height: 14px; border-radius: 50%; background: var(--text-muted); transition: transform 0.15s, background 0.15s; }
    .toggle input:checked ~ .thumb { transform: translateX(16px); background: var(--success, #4CAF7A); }
    .actions-bar { display: flex; gap: 8px; margin-top: 16px; align-items: center; }
    button { padding: 6px 14px; border: 1px solid var(--border-dim); border-radius: 4px; background: var(--magenta-dim); color: var(--magenta, #C9A84C); font-size: 11px; font-weight: 600; cursor: pointer; }
    button:hover { background: var(--magenta-glow); border-color: var(--magenta, #C9A84C); }
    button.primary { background: var(--magenta, #C9A84C); color: var(--void, #0A0A0C); }
    button.primary:hover { background: var(--gold-hot, #F0C040); }
    button:disabled { opacity: 0.4; cursor: not-allowed; }
    button.danger { color: var(--text-muted); border-color: var(--border-dim); }
    .dirty-badge { font-size: 11px; color: var(--gold-hot, #F0C040); margin-left: auto; }
    .empty { text-align: center; padding: 24px; color: var(--text-muted); font-size: 13px; }
  `;

  connectedCallback() { super.connectedCallback(); this._load(); }

  async _load() {
    this.loading = true;
    try {
      const [policyRes, authRes] = await Promise.all([
        fetch('/api/rbac-policy'), fetch('/api/auth/status'),
      ]);
      const authData = await authRes.json();
      this.isOwner = authData.user?.role === 'owner';
      if (this.isOwner && policyRes.ok) {
        this.policy = await policyRes.json();
        this.original = JSON.stringify(this.policy);
      }
    } catch { /* network error — leave empty */ }
    this.loading = false;
  }

  get _dirty(): boolean {
    return this.policy ? JSON.stringify(this.policy) !== this.original : false;
  }

  _togglePerm(section: 'views' | 'actions', key: string) {
    if (!this.policy) return;
    const role = this.policy.roles[this.activeRole];
    if (!role) return;
    const current = role[section][key];
    role[section][key] = !current;
    this.policy = { ...this.policy }; // trigger reactivity
  }

  async _save() {
    if (!this.policy || this.saving) return;
    this.saving = true;
    try {
      const res = await fetch('/api/rbac-policy', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.policy),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      this.original = JSON.stringify(this.policy);
      showToast('Policy saved', 'ok');
    } catch (err: unknown) {
      showToast((err as Error).message || 'Failed to save policy', 'err');
    }
    this.saving = false;
  }

  async _resetDefaults() {
    if (!confirm('Reset permissions to defaults? Admin gets full access, Team gets view-only.')) return;
    const defaults: Policy = {
      version: 1, roles: {
        admin: {
          views: Object.fromEntries(VIEW_KEYS.map(k => [k, !['security', 'debug', 'wealth'].includes(k)])),
          actions: Object.fromEntries(ACTION_KEYS.map(k => [k, !['view_audit', 'manage_system'].includes(k)])),
        },
        team: {
          views: Object.fromEntries(VIEW_KEYS.map(k => [k, ['overview', 'team', 'tasks', 'schedule', 'social', 'activity'].includes(k)])),
          actions: Object.fromEntries(ACTION_KEYS.map(k => [k, false])),
        },
      },
    };
    this.policy = defaults;
  }

  _renderGrid(section: 'views' | 'actions', keys: string[], labels: Record<string, string>) {
    const role = this.policy?.roles[this.activeRole];
    if (!role) return '';
    return html`
      <div class="perm-grid">
        ${keys.map(key => {
          const checked = !!role[section][key];
          return html`
            <div class="perm-row">
              <div class="perm-label">${labels[key] || key}</div>
              <div class="perm-toggle">
                <label class="toggle">
                  <input type="checkbox" ?checked=${checked} @change=${() => this._togglePerm(section, key)} />
                  <span class="track"></span>
                  <span class="thumb"></span>
                </label>
              </div>
            </div>
          `;
        })}
      </div>
    `;
  }

  render() {
    if (this.loading) return html`<div class="empty">Loading policy...</div>`;
    if (!this.isOwner) return html``;

    if (!this.policy) return html`
      <div class="card">
        <h3>Access Policy</h3>
        <div class="empty">Unable to load policy. Check server logs.</div>
      </div>
    `;

    return html`
      <div class="card">
        <h3>Access Policy</h3>
        <div class="card-subtitle">Configure what each role can see and do. Owner always has full access.</div>

        <div class="role-tabs">
          ${['admin', 'team'].map(r => html`
            <button class="role-tab ${this.activeRole === r ? 'active' : ''}" @click=${() => { this.activeRole = r; }}>
              ${r}
            </button>
          `)}
        </div>

        <div class="section-label">Views</div>
        ${this._renderGrid('views', VIEW_KEYS, VIEW_LABELS)}

        <div class="section-label">Actions</div>
        ${this._renderGrid('actions', ACTION_KEYS, ACTION_LABELS)}

        <div class="actions-bar">
          <button class="primary" ?disabled=${!this._dirty || this.saving} @click=${this._save}>
            ${this.saving ? 'Saving...' : 'Save Policy'}
          </button>
          <button class="danger" @click=${this._resetDefaults}>Reset Defaults</button>
          ${this._dirty ? html`<span class="dirty-badge">Unsaved changes</span>` : ''}
        </div>
      </div>
    `;
  }
}
