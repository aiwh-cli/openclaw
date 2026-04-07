/**
 * AIWH Chat Sidebar — Lit component for agent list + session list.
 * Replaces chat-agents.js (agent sidebar) and session sidebar from chat-core.js.
 * Communicates with aiwh-chat-host via custom events.
 */
import { LitElement, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  loadAgentsList,
  loadRawChatSessions,
  deleteSession,
  renameSession,
  escHtml,
  type AgentEntry,
  type RawSessionRow,
} from "./aiwh-chat-api.ts";

// Typed access to window globals defined in app.js
interface AppGlobals {
  modelTierInfo?: (model: string) => { cls: string; label: string };
  timeAgo?: (ts: string) => string;
  showToast?: (msg: string, type?: string) => void;
  dashConfirm?: (msg: string) => Promise<boolean>;
  dashPrompt?: (msg: string, defaultVal?: string) => Promise<string | null>;
  switchView?: (view: string) => void;
}
const win = window as unknown as AppGlobals & typeof globalThis;

@customElement("aiwh-chat-sidebar")
export class AiwhChatSidebar extends LitElement {
  @state() private _agentId = "main";
  @state() private _sessionKey = "agent:main:main";
  @state() private _agents: AgentEntry[] = [];
  @state() private _sessions: RawSessionRow[] = [];
  @state() private _currentModels: Record<string, string> = {};
  @state() private _agentsLoaded = false;

  private _refreshHandler = () => {
    void this._loadSessions();
  };
  private _modelUpdateHandler = ((e: CustomEvent<{ agentId: string; model: string }>) => {
    this._currentModels = { ...this._currentModels, [e.detail.agentId]: e.detail.model };
  }) as EventListener;

  override createRenderRoot() {
    return this;
  }

  override connectedCallback() {
    super.connectedCallback();
    document.addEventListener("aiwh-sidebar-refresh", this._refreshHandler);
    document.addEventListener("aiwh-model-update", this._modelUpdateHandler);
    void this._init();
    // Expose legacy globals for team-detail.js openChatWith()
    (window as Record<string, unknown>).openChat = (agentId?: string) => {
      if (win.switchView) {
        win.switchView("chat");
      }
      if (agentId) {
        this._selectAgent(agentId);
      }
    };
    (window as Record<string, unknown>).switchChatAgent = (agentId: string) => {
      this._selectAgent(agentId);
    };
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener("aiwh-sidebar-refresh", this._refreshHandler);
    document.removeEventListener("aiwh-model-update", this._modelUpdateHandler);
  }

  private async _init() {
    await this._loadAgents();
    await this._loadSessions();
  }

  // ─── Data Loading ────────────────────────────────────────

  private async _loadAgents() {
    const result = await loadAgentsList();
    this._agents = result.agents;
    this._agentsLoaded = true;
  }

  private async _loadSessions() {
    this._sessions = await loadRawChatSessions(this._agentId);
  }

  // ─── Agent Selection ─────────────────────────────────────

  private _selectAgent(agentId: string) {
    this._agentId = agentId;
    this._sessionKey = `agent:${agentId}:main`;
    document.dispatchEvent(new CustomEvent("aiwh-agent-switch", { detail: { agentId } }));
    void this._loadSessions();
  }

  // ─── Session Actions ─────────────────────────────────────

  private _selectSession(sessionId: string) {
    this._sessionKey = sessionId;
    document.dispatchEvent(
      new CustomEvent("aiwh-session-switch", { detail: { sessionKey: sessionId } }),
    );
  }

  private async _deleteSession(sessionId: string) {
    if (win.dashConfirm) {
      const ok = await win.dashConfirm("Delete this session?");
      if (!ok) {
        return;
      }
    }
    const result = await deleteSession(sessionId);
    if (result.ok) {
      if (win.showToast) {
        win.showToast("Session deleted");
      }
      if (sessionId === this._sessionKey) {
        this._sessionKey = `agent:${this._agentId}:main`;
        document.dispatchEvent(
          new CustomEvent("aiwh-session-switch", {
            detail: { sessionKey: this._sessionKey },
          }),
        );
      }
      void this._loadSessions();
    } else {
      if (win.showToast) {
        win.showToast("Delete failed: " + (result.error || "unknown"), "error");
      }
    }
  }

  private async _renameSession(sessionId: string) {
    let newLabel: string | null = null;
    if (win.dashPrompt) {
      newLabel = await win.dashPrompt("Session label:", sessionId);
    } else {
      newLabel = prompt("Session label:", sessionId);
    }
    if (!newLabel || newLabel === sessionId) {
      return;
    }
    await renameSession(sessionId, newLabel);
    void this._loadSessions();
  }

  // ─── Helpers ─────────────────────────────────────────────

  private _modelBadge(model: string): { cls: string; label: string } {
    if (win.modelTierInfo) {
      return win.modelTierInfo(model);
    }
    return { cls: "", label: model };
  }

  private _timeAgo(ts: string): string {
    if (win.timeAgo) {
      return win.timeAgo(ts);
    }
    return "";
  }

  private _truncate(str: string, max: number): string {
    return str.length > max ? str.substring(0, max - 2) + "\u2026" : str;
  }

  // ─── Render ──────────────────────────────────────────────

  override render() {
    return html`
      <div class="chat-sidebar-section chat-sidebar-agents">
        <div class="chat-sidebar-header"><h3>Agents</h3></div>
        <div class="chat-agent-list">${this._renderAgentList()}</div>
      </div>
      <div class="chat-sidebar-section chat-sidebar-sessions">
        <div class="chat-sidebar-header"><h3>Sessions</h3></div>
        <div class="chat-session-list">${this._renderSessionList()}</div>
      </div>
    `;
  }

  private _renderAgentList() {
    if (!this._agentsLoaded) {
      return nothing;
    }

    const sorted = [...this._agents].toSorted((a, b) => {
      if (a.id === "main") {
        return -1;
      }
      if (b.id === "main") {
        return 1;
      }
      const aName = a.display_name || a.displayName || a.name || a.id;
      const bName = b.display_name || b.displayName || b.name || b.id;
      return aName.localeCompare(bName);
    });

    const branson = sorted.find((a) => a.id === "main");
    const others = sorted.filter((a) => a.id !== "main");

    return html`
      ${branson ? this._renderAgent(branson, true) : nothing}
      <div class="chat-agent-notice">
        Branson is the main orchestrator. He can delegate to all agents. Talk to him first unless
        you need a specific agent directly.
      </div>
      <div class="chat-agent-divider">Other Agents</div>
      ${others.map((a) => this._renderAgent(a, false))}
    `;
  }

  private _renderAgent(agent: AgentEntry, isRecommended: boolean) {
    const isActive = agent.id === this._agentId;
    const model = this._currentModels[agent.id] || agent.model || agent.modelTier || "";
    const badge = this._modelBadge(String(model));
    const displayName =
      agent.identity?.name || agent.display_name || agent.displayName || agent.name || agent.id;
    const title = agent.description || agent.role || "";

    return html`
      <button
        class="chat-agent-item ${isRecommended ? "chat-agent-recommended" : ""} ${isActive
          ? "active"
          : ""}"
        title=${title}
        data-agent-id=${agent.id}
        @click=${() => this._selectAgent(agent.id)}
      >
        <span class="agent-orb orb-idle"></span>
        <span class="chat-agent-item-name">${displayName}</span>
        <span class="agent-model-badge ${badge.cls}">${badge.label}</span>
      </button>
    `;
  }

  private _renderSessionList() {
    if (!this._sessions.length) {
      return html`<div class="chat-session-empty">No sessions yet</div>`;
    }

    return this._sessions.map((s) => {
      const isActive = s.session_id === this._sessionKey;
      const label = s.label || (s.session_id === "default" ? "Default Session" : s.session_id);
      const shortLabel = this._truncate(label, 24);
      const preview = s.last_message ? this._truncate(s.last_message, 60) : "";
      const when = s.last_message_at ? this._timeAgo(s.last_message_at) : "";
      const kind = s.kind && s.kind !== "session" ? s.kind : "";
      const modelShort = s.model ? escHtml(s.model.replace("claude-", "").split("-")[0]) : "";

      return html`
        <div class="chat-session-item ${isActive ? "active" : ""}" data-session-id=${s.session_id}>
          <div class="chat-session-item-main" @click=${() => this._selectSession(s.session_id)}>
            <div class="chat-session-item-top">
              <span class="chat-session-item-name">${escHtml(shortLabel)}</span>
              <span class="chat-session-item-meta">
                ${kind ? html`<span class="session-kind">${escHtml(kind)}</span>` : nothing}
                ${modelShort ? html`<span class="session-model">${modelShort}</span>` : nothing}
              </span>
            </div>
            ${preview
              ? html`<div class="chat-session-item-preview">${escHtml(preview)}</div>`
              : nothing}
            <div class="chat-session-item-time">${when}</div>
          </div>
          <div class="chat-session-actions">
            <button
              class="chat-session-action danger"
              @click=${() => this._deleteSession(s.session_id)}
              title="Delete"
            >
              ✕
            </button>
          </div>
        </div>
      `;
    });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "aiwh-chat-sidebar": AiwhChatSidebar;
  }
}
