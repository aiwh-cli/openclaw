/**
 * AIWH Chat Host — Lit component for the AIWH Express dashboard chat.
 * API/data layer lives in aiwh-chat-api.ts.
 */
import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { SessionsListResult } from "../ui-deps/types.ts";
import type { ChatAttachment } from "../ui-deps/ui-types.ts";
import { renderChat, resetChatViewState, type ChatProps } from "../views/chat.ts";
import {
  loadAgentsList,
  loadChatSessions,
  loadChatHistory,
  loadCurrentModel,
  loadAvailableModels,
  switchModel,
  checkGatewayConnection,
  handleModelCommand,
  getModelShortLabel,
  sendChatStream,
  abortChat,
  createNewSession,
  groupModelsByProvider,
  PROVIDER_LABELS,
  type AgentEntry,
  type AvailableModel,
} from "./aiwh-chat-api.ts";
import {
  type ScrollState,
  createScrollState,
  resetScrollState,
  scheduleChatScroll,
  handleChatScroll,
} from "./aiwh-chat-scroll.ts";
import {
  type ToolStreamState,
  createToolStreamState,
  resetToolStream,
  handleToolEvent,
} from "./aiwh-chat-tool-stream.ts";

@customElement("aiwh-chat-host")
export class AiwhChatHost extends LitElement {
  @state() private _agentId = "main";
  @state() private _sessionKey = "agent:main:main";
  @state() private _departmentId: string | null = null;
  @state() private _userDepartments: string[] = [];
  private _currentUserId: string | null = null;
  private _currentUserRole: string | null = null;
  @state() private _messages: unknown[] = [];
  @state() private _stream: string | null = null;
  @state() private _streamStartedAt: number | null = null;
  @state() private _sending = false;
  @state() private _loading = true;
  @state() private _connected = true;
  @state() private _draft = "";
  @state() private _attachments: ChatAttachment[] = [];
  @state() private _sessions: SessionsListResult | null = null;
  @state() private _error: string | null = null;
  @state() private _agentsList: ChatProps["agentsList"] = null;
  @state() private _assistantName = "Branson";
  @state() private _assistantAvatar: string | null = null;
  @state() private _currentModel = "";
  @state() private _availableModels: AvailableModel[] = [];
  @state() private _sidebarOpen = false;
  @state() private _sidebarContent: string | null = null;
  @state() private _contextTokens: number | null = null;
  @state() private _contextMessageCount = 0;
  @state() private _splitRatio = 0.6;
  @state() private _toolMessages: unknown[] = [];
  @state() private _streamSegments: Array<{ text: string; ts: number }> = [];

  private _abortController: AbortController | null = null;
  private _connectionInterval: ReturnType<typeof setInterval> | null = null;
  private _timestampInterval: ReturnType<typeof setInterval> | null = null;
  private _historySeq = 0;
  private _scroll: ScrollState = createScrollState();
  private _toolStream: ToolStreamState = createToolStreamState();

  private _agentSwitchHandler = ((e: CustomEvent) => {
    this._switchAgent(e.detail.agentId, e.detail.departmentId);
  }) as EventListener;

  private _sessionSwitchHandler = ((e: CustomEvent) => {
    this._switchSession(e.detail.sessionKey);
  }) as EventListener;

  override connectedCallback() {
    super.connectedCallback();
    void this._init();
    this._connectionInterval = setInterval(() => void this._checkConnection(), 15000);
    // Re-render every 60s so relative timestamps ("2m ago") stay fresh
    this._timestampInterval = setInterval(() => this.requestUpdate(), 60_000);
    document.addEventListener("aiwh-agent-switch", this._agentSwitchHandler);
    document.addEventListener("aiwh-session-switch", this._sessionSwitchHandler);
    (window as Record<string, unknown>).__aiwhChatHost = this;
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    resetChatViewState();
    if (this._connectionInterval) {
      clearInterval(this._connectionInterval);
    }
    if (this._timestampInterval) {
      clearInterval(this._timestampInterval);
    }
    document.removeEventListener("aiwh-agent-switch", this._agentSwitchHandler);
    document.removeEventListener("aiwh-session-switch", this._sessionSwitchHandler);
    delete (window as Record<string, unknown>).__aiwhChatHost;
  }

  override createRenderRoot() {
    return this;
  } // light DOM for dashboard CSS

  private async _init() {
    await this._applyRoleDefaults();
    await this._loadAgents();
    await Promise.all([this._loadSessions(), this._loadHistory(), this._loadModel()]);
    void this._checkConnection();
  }

  // AC.1 — team users default to department-lead instead of main (Branson).
  // Owner/admin keep main as the default.
  private async _applyRoleDefaults() {
    try {
      const res = await fetch("/api/auth/status", { credentials: "same-origin" });
      if (!res.ok) {
        return;
      }
      const status = await res.json();
      const role = status?.user?.role;
      const depts: string[] = Array.isArray(status?.user?.departments)
        ? status.user.departments
        : [];
      this._userDepartments = depts;
      this._currentUserId = status?.user?.userId || null;
      this._currentUserRole = role || null;
      if (role === "team") {
        this._agentId = "department-lead";
        this._departmentId = depts[0] || null;
        if (this._departmentId) {
          this._sessionKey = `agent:department-lead:user:${status.user.userId}:dept:${this._departmentId}:main`;
        } else {
          this._sessionKey = `agent:department-lead:main`;
        }
      }
    } catch {
      /* not logged in or auth endpoint unavailable — keep main default */
    }
  }

  private async _loadAgents() {
    const result = await loadAgentsList();
    this._agentsList = result;
    const current = result.agents.find((a: AgentEntry) => a.id === this._agentId);
    if (current) {
      this._assistantName = current.identity?.name || current.name || current.id;
      this._assistantAvatar = current.identity?.avatarUrl || null;
    }
  }

  private async _loadSessions() {
    this._sessions = await loadChatSessions(this._agentId);
  }

  private async _loadHistory() {
    this._loading = true;
    const seq = ++this._historySeq;
    const result = await loadChatHistory(this._agentId, this._sessionKey);
    if (seq !== this._historySeq) {
      return;
    }
    this._messages = result.messages;
    this._contextTokens = result.contextTokens;
    this._contextMessageCount = result.contextMessageCount;
    this._loading = false;
  }

  private async _loadModel() {
    const model = await loadCurrentModel(this._agentId);
    if (model) {
      this._currentModel = model;
    }
    this._availableModels = await loadAvailableModels();
  }

  private async _switchModel(modelId: string) {
    const data = await switchModel(this._agentId, modelId);
    if (data.ok && data.model) {
      this._currentModel = data.model;
      document.dispatchEvent(
        new CustomEvent("aiwh-model-update", {
          detail: { agentId: this._agentId, model: data.model },
        }),
      );
    }
  }

  private _renderModelOptions() {
    if (this._availableModels.length === 0) {
      return html`<option value="" disabled>Loading models...</option>`;
    }
    const groups = groupModelsByProvider(this._availableModels);
    return Array.from(groups.entries()).map(
      ([provider, models]) =>
        html`<optgroup label="${PROVIDER_LABELS[provider] || provider}">
          ${models.map((m) => html`<option value="${m.id}">${m.label}</option>`)}
        </optgroup>`,
    );
  }

  private async _checkConnection() {
    this._connected = await checkGatewayConnection();
  }

  private async _sendMessage() {
    const message = this._draft.trim();
    const attachments = [...this._attachments];
    if (!message && attachments.length === 0) {
      return;
    }
    this._draft = "";
    this._attachments = [];

    const modelMatch = message.match(/^\/model\s+(\S+)/i);
    if (modelMatch) {
      await this._handleModelCommand(modelMatch[1]);
      return;
    }

    this._messages = [
      ...this._messages,
      { role: "user", content: message, created_at: new Date().toISOString() },
    ];
    this._sending = true;
    this._stream = "";
    this._streamStartedAt = Date.now();
    this._toolMessages = [];
    this._streamSegments = [];
    resetToolStream(this._toolStream);
    this._abortController = new AbortController();
    resetScrollState(this._scroll);

    try {
      const result = await sendChatStream(
        this._agentId,
        this._sessionKey,
        message,
        attachments,
        this._abortController.signal,
        {
          onDelta: (text) => {
            this._stream = text;
          },
          onModelChange: (id) => {
            this._currentModel = id;
          },
          onToolEvent: (evt) => {
            handleToolEvent(
              this._toolStream,
              evt,
              (msgs) => {
                this._toolMessages = msgs;
              },
              () => {
                // Commit current streamed text as a segment before tool card
                if (this._stream) {
                  this._streamSegments = [
                    ...this._streamSegments,
                    { text: this._stream, ts: Date.now() },
                  ];
                  this._stream = "";
                }
              },
            );
          },
          onDone: (streamed) => {
            if (streamed) {
              this._messages = [
                ...this._messages,
                { role: "assistant", content: streamed, created_at: new Date().toISOString() },
              ];
            }
            this._stream = null;
            this._streamStartedAt = null;
            this._toolMessages = [];
            this._streamSegments = [];
            resetToolStream(this._toolStream);
            void this._loadHistory();
            void this._loadSessions();
            document.dispatchEvent(new CustomEvent("aiwh-sidebar-refresh"));
          },
          onError: (msg) => {
            this._error = msg;
          },
        },
        this._departmentId || undefined,
      );
      if (!result.ok) {
        this._error = result.error || "Could not connect to gateway";
      } else if (!this._stream) {
        await this._loadHistory();
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        this._error = (e as Error).message;
      }
    }
    this._finishSend();
  }

  private _finishSend() {
    this._sending = false;
    if (!this._stream) {
      this._stream = null;
      this._streamStartedAt = null;
    }
    this._abortController = null;
  }

  private async _abort() {
    this._abortController?.abort();
    this._abortController = null;
    await abortChat(this._agentId, this._sessionKey);
    this._finishSend();
    void this._loadHistory();
  }

  private async _newSession() {
    this._messages = [];
    this._stream = null;
    await createNewSession(this._agentId, this._sessionKey);
    void this._loadHistory();
    void this._loadSessions();
  }

  private _switchAgent(agentId: string, departmentId?: string) {
    this._agentId = agentId;
    // AC.1: department-lead sessions are per-user-per-department. If a departmentId is
    // supplied (from a team user clicking a dept card) or one is already active, keep it.
    if (agentId === "department-lead") {
      const userId = this._currentUserId;
      this._departmentId = departmentId || this._departmentId;
      this._sessionKey =
        userId && this._departmentId
          ? `agent:department-lead:user:${userId}:dept:${this._departmentId}:main`
          : `agent:department-lead:main`;
    } else {
      this._departmentId = null;
      this._sessionKey = `agent:${agentId}:main`;
    }
    const list = this._agentsList?.agents || [];
    const agent =
      list.find(
        (a) =>
          a.id === agentId &&
          (!departmentId || (a as { departmentId?: string }).departmentId === departmentId),
      ) || list.find((a) => a.id === agentId);
    this._assistantName =
      (agent as { displayName?: string })?.displayName ||
      agent?.identity?.name ||
      agent?.name ||
      agentId;
    this._assistantAvatar = agent?.identity?.avatarUrl || null;
    this._messages = [];
    this._loading = true;
    resetScrollState(this._scroll);
    void Promise.all([this._loadSessions(), this._loadHistory(), this._loadModel()]);
  }

  private _switchSession(sessionKey: string) {
    this._sessionKey = sessionKey;
    this._messages = [];
    this._loading = true;
    resetScrollState(this._scroll);
    void this._loadHistory();
  }

  private async _handleModelCommand(model: string) {
    const data = await handleModelCommand(this._agentId, model);
    if (data.ok && data.model) {
      this._currentModel = data.model;
      this._messages = [
        ...this._messages,
        {
          role: "assistant",
          content: `Model switched to **${data.model}**`,
          created_at: new Date().toISOString(),
        },
      ];
    } else {
      this._messages = [
        ...this._messages,
        {
          role: "assistant",
          content: `Failed to switch model: ${data.error || "unknown"}`,
          created_at: new Date().toISOString(),
        },
      ];
    }
  }

  private _refresh() {
    void this._loadHistory();
    void this._loadSessions();
    document.dispatchEvent(new CustomEvent("aiwh-sidebar-refresh"));
  }

  private _scheduleScroll(force = false, smooth = false) {
    scheduleChatScroll(
      this._scroll,
      this.updateComplete,
      (sel) => this.querySelector(sel),
      force,
      smooth,
    );
    // Trigger re-render if "new messages" flag changed
    if (this._scroll.chatNewMessagesBelow) {
      this.requestUpdate();
    }
  }

  private _handleChatScroll(e: Event) {
    handleChatScroll(this._scroll, e);
  }

  override updated(changed: Map<string, unknown>) {
    super.updated(changed);
    if (changed.has("_messages") || changed.has("_stream") || changed.has("_loading")) {
      this._scheduleScroll();
    }
    if (changed.has("_loading") && !this._loading) {
      resetScrollState(this._scroll);
      this._scheduleScroll(true);
    }
  }

  override render() {
    const props: ChatProps = {
      sessionKey: this._sessionKey,
      onSessionKeyChange: (key) => this._switchSession(key),
      thinkingLevel: null,
      showThinking: true,
      showToolCalls: true,
      loading: this._loading,
      sending: this._sending,
      canAbort: this._sending || this._stream !== null,
      messages: this._messages,
      toolMessages: this._toolMessages,
      streamSegments: this._streamSegments,
      stream: this._stream,
      streamStartedAt: this._streamStartedAt,
      draft: this._draft,
      getDraft: () => this._draft,
      queue: [],
      connected: this._connected,
      canSend: this._connected && !this._sending,
      disabledReason: this._connected ? null : "Disconnected from gateway",
      error: this._error,
      sessions: this._sessions,
      focusMode: false,
      splitRatio: this._splitRatio,
      sidebarOpen: this._sidebarOpen,
      sidebarContent: this._sidebarContent,
      assistantName: this._assistantName,
      assistantAvatar: this._assistantAvatar,
      attachments: this._attachments,
      onAttachmentsChange: (atts) => {
        this._attachments = atts;
      },
      onRequestUpdate: () => this.requestUpdate(),
      onRefresh: () => {
        void this._loadHistory();
        void this._loadSessions();
      },
      onToggleFocusMode: () => {},
      onSplitRatioChange: (ratio: number) => {
        this._splitRatio = ratio;
      },
      onDraftChange: (text) => {
        this._draft = text;
      },
      onSend: () => this._sendMessage(),
      onAbort: () => this._abort(),
      onQueueRemove: () => {},
      onNewSession: () => this._newSession(),
      agentsList: this._agentsList,
      currentAgentId: this._agentId,
      onAgentChange: (id) => this._switchAgent(id),
      onSessionSelect: (key) => this._switchSession(key),
      onOpenSidebar: (content) => {
        this._sidebarOpen = true;
        this._sidebarContent = content;
      },
      onCloseSidebar: () => {
        this._sidebarOpen = false;
        this._sidebarContent = null;
      },
      onChatScroll: (e: Event) => this._handleChatScroll(e),
      onScrollToBottom: () => {
        resetScrollState(this._scroll);
        this._scheduleScroll(true);
      },
      showNewMessages: this._scroll.chatNewMessagesBelow,
    };
    const modelLabel = getModelShortLabel(this._currentModel);
    const isBusy = this._sending || this._stream !== null;
    return html`
      <div class="aiwh-chat-header">
        <div class="aiwh-chat-header__left">
          <span
            class="aiwh-chat-header__dot ${this._connected ? "connected" : "disconnected"}"
            title="${this._connected ? "Connected to gateway" : "Disconnected"}"
          ></span>
          <span class="aiwh-chat-header__name">${this._assistantName}</span>
        </div>
        <div class="aiwh-chat-header__right">
          <select
            class="aiwh-chat-header__model-select"
            title="Switch model (current: ${modelLabel || "default"})"
            ?disabled=${!this._connected || isBusy}
            @change=${(e: Event) => {
              const val = (e.target as HTMLSelectElement).value;
              if (val) {
                void this._switchModel(val);
              }
            }}
          >
            <option value="">${modelLabel || "Model"}</option>
            ${this._renderModelOptions()}
          </select>
          <button
            class="aiwh-chat-header__btn"
            @click=${() => this._newSession()}
            title="New session"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <path
                d="M8 3v10M3 8h10"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
              />
            </svg>
          </button>
          <button class="aiwh-chat-header__btn" @click=${() => this._refresh()} title="Refresh">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <path
                d="M2 8a6 6 0 0111.2-3M14 8a6 6 0 01-11.2 3"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
              />
              <path
                d="M13 2v3h-3M3 14v-3h3"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>
      ${this._renderChatSafe(props)}
    `;
  }

  private _renderChatSafe(props: ChatProps) {
    try {
      return renderChat(props);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : "";
      console.error("[aiwh-chat-host] renderChat() failed:", err);
      return html`
        <div style="padding:20px;color:#ef4444;font-family:monospace;font-size:12px;">
          <p><strong>Chat render error:</strong> ${msg}</p>
          <pre style="white-space:pre-wrap;opacity:0.7;margin-top:8px;">${stack}</pre>
          <p style="margin-top:12px;color:#888;">
            Messages loaded: ${this._messages.length} | Connected: ${this._connected} | Agent:
            ${this._agentId}
          </p>
        </div>
      `;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "aiwh-chat-host": AiwhChatHost;
  }
}
