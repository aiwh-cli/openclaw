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

@customElement("aiwh-chat-host")
export class AiwhChatHost extends LitElement {
  @state() private _agentId = "main";
  @state() private _sessionKey = "agent:main:main";
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

  private _abortController: AbortController | null = null;
  private _connectionInterval: ReturnType<typeof setInterval> | null = null;
  private _historySeq = 0;
  private _userScrolledUp = false;

  private _agentSwitchHandler = ((e: CustomEvent) => {
    this._switchAgent(e.detail.agentId);
  }) as EventListener;

  private _sessionSwitchHandler = ((e: CustomEvent) => {
    this._switchSession(e.detail.sessionKey);
  }) as EventListener;

  override connectedCallback() {
    super.connectedCallback();
    void this._init();
    this._connectionInterval = setInterval(() => void this._checkConnection(), 15000);
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
    document.removeEventListener("aiwh-agent-switch", this._agentSwitchHandler);
    document.removeEventListener("aiwh-session-switch", this._sessionSwitchHandler);
    delete (window as Record<string, unknown>).__aiwhChatHost;
  }

  override createRenderRoot() {
    return this;
  } // light DOM for dashboard CSS

  private async _init() {
    await this._loadAgents();
    await Promise.all([this._loadSessions(), this._loadHistory(), this._loadModel()]);
    void this._checkConnection();
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
      if (typeof (window as Record<string, unknown>).updateModelBadge === "function") {
        (window as Record<string, unknown>).updateModelBadge(this._agentId, data.model);
      }
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
    this._abortController = new AbortController();
    this._userScrolledUp = false;

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
          onDone: (streamed) => {
            if (streamed) {
              this._messages = [
                ...this._messages,
                { role: "assistant", content: streamed, created_at: new Date().toISOString() },
              ];
            }
            this._stream = null;
            this._streamStartedAt = null;
            void this._loadHistory();
            void this._loadSessions();
          },
          onError: (msg) => {
            this._error = msg;
          },
        },
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

  private _switchAgent(agentId: string) {
    this._agentId = agentId;
    this._sessionKey = `agent:${agentId}:main`;
    const agent = this._agentsList?.agents?.find((a) => a.id === agentId);
    this._assistantName = agent?.identity?.name || agent?.name || agentId;
    this._assistantAvatar = agent?.identity?.avatarUrl || null;
    this._messages = [];
    this._loading = true;
    void Promise.all([this._loadSessions(), this._loadHistory(), this._loadModel()]);
  }

  private _switchSession(sessionKey: string) {
    this._sessionKey = sessionKey;
    this._messages = [];
    this._loading = true;
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
    try {
      const fn = (window as Record<string, unknown>).loadChatSessions;
      if (typeof fn === "function") {
        (fn as () => void)();
      }
    } catch {
      /* empty */
    }
  }

  private _scrollToBottom() {
    requestAnimationFrame(() => {
      const thread = this.querySelector(".chat-thread") as HTMLElement | null;
      if (thread) {
        thread.scrollTop = thread.scrollHeight;
      }
    });
  }

  private _handleChatScroll(e: Event) {
    const el = e.target as HTMLElement;
    if (!el) {
      return;
    }
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    this._userScrolledUp = !atBottom;
  }

  override updated(changed: Map<string, unknown>) {
    super.updated(changed);
    if (!this._userScrolledUp) {
      if (changed.has("_messages") || changed.has("_stream") || changed.has("_loading")) {
        this._scrollToBottom();
      }
    }
    if (changed.has("_loading") && !this._loading) {
      this._userScrolledUp = false;
      this._scrollToBottom();
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
      toolMessages: [],
      streamSegments: [],
      stream: this._stream,
      streamStartedAt: this._streamStartedAt,
      draft: this._draft,
      queue: [],
      connected: this._connected,
      canSend: this._connected && !this._sending,
      disabledReason: this._connected ? null : "Disconnected from gateway",
      error: this._error,
      sessions: this._sessions,
      focusMode: false,
      sidebarOpen: this._sidebarOpen,
      sidebarContent: this._sidebarContent,
      assistantName: this._assistantName,
      assistantAvatar: this._assistantAvatar,
      attachments: this._attachments,
      onAttachmentsChange: (atts) => {
        this._attachments = atts;
      },
      onRefresh: () => {
        void this._loadHistory();
        void this._loadSessions();
      },
      onToggleFocusMode: () => {},
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
        this._userScrolledUp = false;
        this._scrollToBottom();
      },
      showNewMessages: this._userScrolledUp && (this._stream !== null || this._sending),
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
