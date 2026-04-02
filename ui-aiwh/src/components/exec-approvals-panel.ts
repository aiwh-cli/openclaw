import { LitElement, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { execApprovalsStyles } from "./exec-approvals-styles.js";

type ExecSecurity = "deny" | "allowlist" | "full";
type ExecAsk = "off" | "on-miss" | "always";
type AllowlistEntry = {
  id?: string;
  pattern: string;
  lastUsedAt?: number;
  lastUsedCommand?: string;
};
type ExecApprovalsDefaults = {
  security?: ExecSecurity;
  ask?: ExecAsk;
  askFallback?: ExecSecurity;
  autoAllowSkills?: boolean;
};
type ExecApprovalsAgent = ExecApprovalsDefaults & { allowlist?: AllowlistEntry[] };
type ExecApprovalsFile = {
  version: 1;
  defaults?: ExecApprovalsDefaults;
  agents?: Record<string, ExecApprovalsAgent>;
};
type ExecApprovalsSnapshot = {
  path: string;
  exists: boolean;
  hash: string;
  file: ExecApprovalsFile;
};
type AgentInfo = { id: string; name: string; emoji: string };

@customElement("exec-approvals-panel")
export class ExecApprovalsPanel extends LitElement {
  @state() private loading = true;
  @state() private snapshot: ExecApprovalsSnapshot | null = null;
  @state() private baseHash = "";
  @state() private showAdvanced = false;
  @state() private expandedAgent: string | null = null;
  @state() private showAddFor: string | null = null;
  @state() private newPattern = "";
  @state() private editingDefaults = false;
  @state() private draftSecurity: ExecSecurity = "allowlist";
  @state() private draftAsk: ExecAsk = "on-miss";
  @state() private draftFallback: ExecSecurity = "allowlist";
  @state() private draftAutoSkills = true;
  @state() private error = "";
  @state() private orgChart: AgentInfo[] = [];
  @state() private tier1Collapsed = false;
  @state() private baseCollapsed = false;
  @state() private basePatternsCollapsed = false;

  static styles = execApprovalsStyles;

  connectedCallback() {
    super.connectedCallback();
    void this._init();
  }

  private async _init() {
    await Promise.all([this.load(), this._loadOrgChart()]);
  }

  async load() {
    this.loading = true;
    this.error = "";
    try {
      const r = await fetch("/api/security/exec-approvals");
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: "Unknown error" }));
        this.error = err.error || `HTTP ${r.status}`;
        this.loading = false;
        return;
      }
      const snap: ExecApprovalsSnapshot = await r.json();
      this.snapshot = snap;
      this.baseHash = snap.hash || "";
    } catch {
      this.error = "Failed to connect to gateway";
    }
    this.loading = false;
    this.requestUpdate();
  }

  private async _loadOrgChart() {
    try {
      const r = await fetch("/api/org-chart");
      if (!r.ok) {
        return;
      }
      const data = await r.json();
      const agents: AgentInfo[] = [];
      const walk = (node: Record<string, unknown>) => {
        if (node.id) {
          agents.push({
            id: node.id as string,
            name: (node.displayName || node.id) as string,
            emoji: (node.emoji || "") as string,
          });
        }
        const reports = node.reports as Record<string, unknown>[] | undefined;
        if (Array.isArray(reports)) {
          for (const c of reports) {
            walk(c);
          }
        }
      };
      walk(data.hierarchy || data);
      this.orgChart = agents;
    } catch {
      /* non-fatal — we'll show IDs without display names */
    }
  }

  // Agents with explicit entries in config (beyond '*')
  private _tier1Ids(): string[] {
    const agents = this.snapshot?.file?.agents || {};
    return Object.keys(agents)
      .filter((k) => k !== "*")
      .toSorted();
  }

  // All org-chart agents NOT in tier 1 (exclude sub-agents like voice-agent, avatar-agent etc.)
  private _baseAgents(): AgentInfo[] {
    const tier1ConfigIds = new Set(this._tier1Ids());
    // Map config IDs to org-chart IDs for exclusion
    const tier1OrgIds = new Set([...tier1ConfigIds].map((id) => (id === "branson" ? "main" : id)));
    tier1OrgIds.add("main"); // Branson is always Tier 1
    const subAgentPattern = /-agent$/;
    return this.orgChart.filter((a) => !tier1OrgIds.has(a.id) && !subAgentPattern.test(a.id));
  }

  // Tier 1 agents with display info
  private _tier1Agents(): (AgentInfo & { configId: string })[] {
    const ids = this._tier1Ids();
    return ids.map((id) => {
      // 'branson' in config = 'main' in org-chart
      const chartId = id === "branson" ? "main" : id;
      const found = this.orgChart.find((a) => a.id === chartId);
      return { ...(found || { id: chartId, name: id, emoji: "" }), configId: id };
    });
  }

  private _agentPatterns(agentId: string): AllowlistEntry[] {
    return this.snapshot?.file?.agents?.[agentId]?.allowlist || [];
  }

  private _basePatterns(): AllowlistEntry[] {
    return this.snapshot?.file?.agents?.["*"]?.allowlist || [];
  }

  private _totalPatterns(): number {
    const agents = this.snapshot?.file?.agents || {};
    return Object.values(agents).reduce((sum, a) => sum + (a.allowlist?.length || 0), 0);
  }

  private _agentDisplayName(id: string): string {
    if (id === "*") {
      return "All Agents";
    }
    const found = this.orgChart.find((a) => a.id === id);
    return found?.name || id;
  }

  private _agentEmoji(id: string): string {
    const found = this.orgChart.find((a) => a.id === id);
    return found?.emoji || "";
  }

  private async _reloadAfterSave() {
    await new Promise((r) => setTimeout(r, 120));
    await this.load();
  }

  private async _addPattern(agentId: string) {
    if (!this.newPattern.trim()) {
      return;
    }
    try {
      const r = await fetch("/api/security/exec-approvals/pattern", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId, pattern: this.newPattern.trim(), baseHash: this.baseHash }),
      });
      if (r.status === 409) {
        await this.load();
        alert("Config changed. Refreshed.");
        return;
      }
      if (!r.ok) {
        throw new Error(await r.text());
      }
      this.newPattern = "";
      this.showAddFor = null;
      await this._reloadAfterSave();
    } catch {
      alert("Failed to add pattern");
    }
  }

  private async _removePattern(agentId: string, entry: AllowlistEntry) {
    if (!confirm(`Remove pattern "${entry.pattern}"?`)) {
      return;
    }
    try {
      const r = await fetch("/api/security/exec-approvals/pattern", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId, patternId: entry.id, baseHash: this.baseHash }),
      });
      if (r.status === 409) {
        await this.load();
        alert("Config changed. Refreshed.");
        return;
      }
      if (!r.ok) {
        throw new Error(await r.text());
      }
      await this._reloadAfterSave();
    } catch {
      alert("Failed to remove pattern");
    }
  }

  private async _saveDefaults() {
    if (!this.snapshot) {
      return;
    }
    const file: ExecApprovalsFile = JSON.parse(JSON.stringify(this.snapshot.file));
    file.defaults = {
      security: this.draftSecurity,
      ask: this.draftAsk,
      askFallback: this.draftFallback,
      autoAllowSkills: this.draftAutoSkills,
    };
    try {
      const r = await fetch("/api/security/exec-approvals", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file,
          baseHash: this.baseHash,
          _audit_detail: `Global policy: security=${this.draftSecurity}, ask=${this.draftAsk}`,
        }),
      });
      if (r.status === 409) {
        await this.load();
        alert("Config changed. Refreshed.");
        return;
      }
      if (!r.ok) {
        throw new Error(await r.text());
      }
      this.editingDefaults = false;
      await this._reloadAfterSave();
    } catch {
      alert("Failed to save policy");
    }
  }

  private _syncDraftFromSnapshot() {
    const d = this.snapshot?.file?.defaults;
    this.draftSecurity = (d?.security as ExecSecurity) || "allowlist";
    this.draftAsk = (d?.ask as ExecAsk) || "on-miss";
    this.draftFallback = (d?.askFallback as ExecSecurity) || "allowlist";
    this.draftAutoSkills = d?.autoAllowSkills ?? true;
    this.editingDefaults = false;
  }

  private _securityLabel(s: ExecSecurity): string {
    return { deny: "Restricted", allowlist: "Balanced", full: "Unrestricted" }[s] || s;
  }

  private _askLabel(a: ExecAsk): string {
    return { off: "Never", "on-miss": "When needed", always: "Every time" }[a] || a;
  }

  private _toggleExpand(agentId: string) {
    this.expandedAgent = this.expandedAgent === agentId ? null : agentId;
    this.showAddFor = null;
    this.newPattern = "";
  }

  // ─── Render ────────────────────────────────────────────────

  render() {
    if (this.loading) {
      return html`<div class="empty">Loading command permissions...</div>`;
    }
    if (this.error) {
      return html`<div class="error">${this.error}</div>
        <button class="btn" @click=${() => this.load()}>Retry</button>`;
    }

    const exists = this.snapshot?.exists ?? false;
    const defs = this.snapshot?.file?.defaults;
    const total = this._totalPatterns();
    const autoSkills = defs?.autoAllowSkills ?? true;

    return html`
      <div class="header">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="3" y="11" width="18" height="11" rx="2" fill="currentColor" opacity="0.12" />
          <rect x="3" y="11" width="18" height="11" rx="2" />
          <path d="M7 11V7a5 5 0 0110 0v4" />
          <circle cx="12" cy="16" r="1" />
        </svg>
        <div>
          <h3>Command Permissions</h3>
          <p>
            ${exists
              ? html`Your AI team can run <strong>${total}</strong> pre-approved commands.
                  ${autoSkills ? "Skill commands are auto-approved." : ""} Anything else will ask
                  for your approval.`
              : "Not configured yet. Ask Branson to set up command permissions."}
          </p>
        </div>
      </div>

      <div class="policy-grid" style="margin-bottom:24px">
        <div class="policy-item">
          <label>Permission Level</label>
          <div style="font-size:13px">
            ${this._securityLabel((defs?.security as ExecSecurity) || "allowlist")}
          </div>
        </div>
        <div class="policy-item">
          <label>Ask for Approval</label>
          <div style="font-size:13px">${this._askLabel((defs?.ask as ExecAsk) || "on-miss")}</div>
        </div>
        <div class="policy-item">
          <label>Skill Commands</label>
          <div style="font-size:13px">${autoSkills ? "Auto-approved" : "Need approval"}</div>
        </div>
        <div class="policy-item">
          <label>Approved Commands</label>
          <div style="font-size:13px">${total} patterns</div>
        </div>
      </div>

      <p style="font-size:12px;color:var(--text-muted);margin-bottom:24px">
        To change what commands your AI team can run, ask Branson:
        <em>"Add permission for [tool name]"</em> or <em>"Show me what commands are approved."</em>
      </p>

      <button
        class="btn btn-sm"
        style="margin-bottom:16px"
        @click=${() => {
          this.showAdvanced = !this.showAdvanced;
        }}
      >
        ${this.showAdvanced ? "Hide Details" : "Show Details"}
      </button>

      ${this.showAdvanced ? this._renderAdvanced() : nothing}
    `;
  }

  private _renderAdvanced() {
    const tier1 = this._tier1Agents();
    const base = this._baseAgents();
    const basePatterns = this._basePatterns();

    return html`
      <!-- Tier 1 -->
      <div class="tier-section">
        <div
          class="tier-header"
          @click=${() => {
            this.tier1Collapsed = !this.tier1Collapsed;
          }}
        >
          <span class="tier-chevron">${this.tier1Collapsed ? "\u25B8" : "\u25BE"}</span>
          <span class="tier-label tier-1">TIER 1</span>
          <span class="tier-title">Full Shell Access</span>
        </div>
        ${!this.tier1Collapsed
          ? html`
              <div class="tier-desc">
                npm, git, ffmpeg, gcloud, brew, openclaw + all base commands
              </div>
              ${tier1.map((a) => this._renderAgentRow(a.configId, a))}
            `
          : nothing}
      </div>

      <!-- Base -->
      <div class="tier-section">
        <div
          class="tier-header"
          @click=${() => {
            this.baseCollapsed = !this.baseCollapsed;
          }}
        >
          <span class="tier-chevron">${this.baseCollapsed ? "\u25B8" : "\u25BE"}</span>
          <span class="tier-label tier-base">BASE</span>
          <span class="tier-title">Standard Operational Access</span>
        </div>
        ${!this.baseCollapsed
          ? html`
              <div class="tier-desc">cat, grep, sqlite3, curl, jq, awk, sed, scripts, file ops</div>
              ${base.map((a) => this._renderAgentRow(a.id, a))}
            `
          : nothing}
      </div>

      <!-- Base Patterns (shared) -->
      <div class="tier-section">
        <div
          class="tier-header"
          @click=${() => {
            this.basePatternsCollapsed = !this.basePatternsCollapsed;
          }}
        >
          <span class="tier-chevron">${this.basePatternsCollapsed ? "\u25B8" : "\u25BE"}</span>
          <span class="tier-label tier-base">BASE PATTERNS</span>
          <span class="tier-title">Applies to ALL agents (${basePatterns.length})</span>
        </div>
        ${!this.basePatternsCollapsed
          ? html` ${this._renderPatternTable("*", basePatterns)} `
          : nothing}
      </div>

      <!-- Global Policy Editor -->
      <div style="margin-top:16px;display:flex;justify-content:space-between;align-items:center">
        <h4 class="section-title">Global Policy</h4>
        ${!this.editingDefaults
          ? html`<button
              class="btn btn-sm"
              @click=${() => {
                this._syncDraftFromSnapshot();
                this.editingDefaults = true;
              }}
            >
              Edit
            </button>`
          : nothing}
      </div>
      ${this.editingDefaults ? this._renderPolicyEditor() : nothing}
    `;
  }

  private _renderAgentRow(agentId: string, info: AgentInfo) {
    const patterns = this._agentPatterns(agentId);
    const count = patterns.length;
    const isExpanded = this.expandedAgent === agentId;

    return html`
      <div class="agent-row ${isExpanded ? "expanded" : ""}">
        <div class="agent-row-header" @click=${() => this._toggleExpand(agentId)}>
          <span class="agent-chevron">${isExpanded ? "\u25BE" : "\u25B8"}</span>
          <span class="agent-name">${info.emoji} ${info.name}</span>
          <span class="agent-count"
            >${count
              ? html`<span class="b-count">${count}</span>`
              : html`<span class="b-base">base only</span>`}</span
          >
          <button
            class="btn btn-success btn-sm agent-add-btn"
            @click=${(e: Event) => {
              e.stopPropagation();
              this.showAddFor = this.showAddFor === agentId ? null : agentId;
              this.newPattern = "";
            }}
          >
            + Add
          </button>
        </div>
        ${this.showAddFor === agentId
          ? html`
              <div class="add-row">
                <input
                  class="form-input"
                  placeholder="/path/to/tool or command-name"
                  .value=${this.newPattern}
                  @input=${(e: Event) => {
                    this.newPattern = (e.target as HTMLInputElement).value;
                  }}
                  @keydown=${(e: KeyboardEvent) => {
                    if (e.key === "Enter") {
                      void this._addPattern(agentId);
                    }
                  }}
                />
                <button class="btn btn-success" @click=${() => this._addPattern(agentId)}>
                  Add
                </button>
              </div>
            `
          : nothing}
        ${isExpanded && count ? this._renderPatternTable(agentId, patterns) : nothing}
        ${isExpanded && !count
          ? html`<div class="empty-sm">
              Inherits base patterns only. Add a pattern to grant extra access.
            </div>`
          : nothing}
      </div>
    `;
  }

  private _renderPatternTable(agentId: string, list: AllowlistEntry[]) {
    if (!list.length) {
      return html`<div class="empty-sm">No patterns.</div>`;
    }
    return html`
      <table>
        <thead>
          <tr>
            <th>Pattern</th>
            <th>Last Used</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${list.map(
            (entry) => html`<tr>
              <td><code>${entry.pattern}</code></td>
              <td style="font-size:11px;color:var(--text-muted)">
                ${entry.lastUsedAt ? new Date(entry.lastUsedAt).toLocaleDateString() : "\u2014"}
              </td>
              <td style="text-align:right">
                <button
                  class="btn btn-danger btn-sm"
                  @click=${() => this._removePattern(agentId, entry)}
                >
                  Remove
                </button>
              </td>
            </tr>`,
          )}
        </tbody>
      </table>
    `;
  }

  private _renderPolicyEditor() {
    const sel = (val: string, cb: (v: string) => void) => (e: Event) => {
      cb((e.target as HTMLSelectElement).value);
    };
    return html` <div class="policy-grid">
        <div class="policy-item">
          <label>Security Mode</label>
          <select
            class="form-select"
            .value=${this.draftSecurity}
            @change=${sel("", (v) => {
              this.draftSecurity = v as ExecSecurity;
            })}
          >
            <option value="deny">Restricted (block all)</option>
            <option value="allowlist">Balanced (recommended)</option>
            <option value="full">Unrestricted (allow all)</option>
          </select>
        </div>
        <div class="policy-item">
          <label>Ask for Approval</label>
          <select
            class="form-select"
            .value=${this.draftAsk}
            @change=${sel("", (v) => {
              this.draftAsk = v as ExecAsk;
            })}
          >
            <option value="off">Never</option>
            <option value="on-miss">When command not listed</option>
            <option value="always">Every time</option>
          </select>
        </div>
        <div class="policy-item">
          <label>If approval unavailable</label>
          <select
            class="form-select"
            .value=${this.draftFallback}
            @change=${sel("", (v) => {
              this.draftFallback = v as ExecSecurity;
            })}
          >
            <option value="deny">Block</option>
            <option value="allowlist">Allow if listed</option>
            <option value="full">Allow all</option>
          </select>
        </div>
      </div>
      <div class="toggle-row">
        <div
          class="toggle-switch"
          ?active=${this.draftAutoSkills}
          @click=${() => {
            this.draftAutoSkills = !this.draftAutoSkills;
          }}
        ></div>
        <span class="toggle-label">Auto-approve skill commands</span>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:24px">
        <button class="btn btn-success" @click=${() => this._saveDefaults()}>Save</button>
        <button
          class="btn"
          @click=${() => {
            this._syncDraftFromSnapshot();
            this.editingDefaults = false;
          }}
        >
          Cancel
        </button>
      </div>`;
  }
}
