/**
 * AIWH Chat Host — Lit component bridging OpenClaw's renderChat()
 * to the AIWH Express dashboard backend (SSE streaming).
 *
 * Replaces chat-core.js DOM manipulation with reactive Lit state.
 * Backend API calls (SSE, sessions, model, history) stay identical.
 */

import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { renderChat, resetChatViewState, type ChatProps } from "../views/chat.ts";
import type { ChatAttachment } from "../ui-deps/ui-types.ts";
import type { SessionsListResult } from "../ui-deps/types.ts";

// ─── Helpers ────────────────────────────────────────────────

/** Fetch wrapper with 401 redirect */
async function api<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, opts);
  if (res.status === 401) {
    try {
      const err = await res.json();
      if (err?.redirect) {
        window.location.href = err.redirect;
      }
    } catch { /* empty */ }
    window.location.href = "/login.html";
    throw new Error("Unauthorized");
  }
  return res.json() as Promise<T>;
}

function escHtml(str: string): string {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ─── Component ──────────────────────────────────────────────

@customElement("aiwh-chat-host")
export class AiwhChatHost extends LitElement {
  // ── Reactive State ──────────────────────────────────────
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
  @state() private _availableModels: Array<{ id: string; label: string }> = [];
  @state() private _sidebarOpen = false;
  @state() private _sidebarContent: string | null = null;
  @state() private _contextTokens: number | null = null;
  @state() private _contextMessageCount = 0;

  private _abortController: AbortController | null = null;
  private _connectionInterval: ReturnType<typeof setInterval> | null = null;
  private _historySeq = 0;
  private _userScrolledUp = false;

  // ── Lifecycle ───────────────────────────────────────────

  private _agentSwitchHandler = ((e: CustomEvent) => {
    this._switchAgent(e.detail.agentId);
  }) as EventListener;

  private _sessionSwitchHandler = ((e: CustomEvent) => {
    this._switchSession(e.detail.sessionKey);
  }) as EventListener;

  override connectedCallback() {
    super.connectedCallback();
    this._init();
    this._connectionInterval = setInterval(() => this._checkConnection(), 15000);
    // Listen for agent/session switch events from vanilla JS sidebar
    document.addEventListener("aiwh-agent-switch", this._agentSwitchHandler);
    document.addEventListener("aiwh-session-switch", this._sessionSwitchHandler);
    // Expose switch methods globally for vanilla JS compat
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

  // Render into light DOM so existing dashboard CSS applies
  override createRenderRoot() {
    return this;
  }

  private async _init() {
    await this._loadAgents();
    await Promise.all([
      this._loadSessions(),
      this._loadHistory(),
      this._loadModel(),
    ]);
    this._checkConnection();
  }

  // ── Agents ──────────────────────────────────────────────

  private async _loadAgents() {
    try {
      const agents = await api<Array<{ id: string; name?: string; identity?: { name?: string; avatarUrl?: string } }>>("/agents");
      const list = Array.isArray(agents) ? agents : [];
      this._agentsList = { agents: list, defaultId: "main" };
      const current = list.find((a) => a.id === this._agentId);
      if (current) {
        this._assistantName = current.identity?.name || current.name || current.id;
        this._assistantAvatar = current.identity?.avatarUrl || null;
      }
    } catch {
      this._agentsList = { agents: [], defaultId: "main" };
    }
  }

  // ── Sessions ────────────────────────────────────────────

  private async _loadSessions() {
    try {
      const rows = await api<Array<Record<string, unknown>>>(`/chat/sessions?agentId=${this._agentId}`);
      const sessions = Array.isArray(rows) ? rows : [];
      this._sessions = {
        sessions: sessions.map((s) => ({
          key: (s.session_id as string) || (s.key as string) || "",
          kind: ((s.kind as string) || "direct") as "direct" | "group" | "global" | "unknown",
          label: (s.label as string) || undefined,
          updatedAt: s.last_message_at ? new Date(s.last_message_at as string).getTime() : null,
          model: (s.model as string) || undefined,
          totalTokens: (s.tokens as number) || undefined,
        })),
      };
    } catch {
      this._sessions = null;
    }
  }

  // ── History ─────────────────────────────────────────────

  private async _loadHistory() {
    this._loading = true;
    const seq = ++this._historySeq;
    try {
      const data = await api<{ messages?: unknown[]; context?: Record<string, unknown> }>(
        `/chat/history?agentId=${this._agentId}&sessionId=${encodeURIComponent(this._sessionKey)}`
      );
      if (seq !== this._historySeq) {return;} // stale
      const msgs = Array.isArray(data) ? data : data?.messages || [];
      this._messages = msgs;
      if (data?.context) {
        this._contextTokens = (data.context.tokens as number) || null;
        this._contextMessageCount = (data.context.messageCount as number) || 0;
      }
    } catch {
      this._messages = [];
    }
    this._loading = false;
  }

  // ── Model ───────────────────────────────────────────────

  private async _loadModel() {
    try {
      const { model } = await api<{ model?: string }>(`/chat/model/${this._agentId}`);
      if (model && typeof model === "string") {this._currentModel = model;}
    } catch { /* empty */ }
    this._loadAvailableModels();
  }

  private async _loadAvailableModels() {
    // Fetch from the same endpoint the Team section uses — provider-agnostic (NORTH-STAR)
    try {
      const data = await api<{
        models?: Array<{ id: string; name: string; provider?: string; tier?: string; featured?: boolean }>;
        providers?: string[];
      }>("/agents/models/available");
      const all = data?.models || [];
      // Direct providers (Anthropic, OpenAI, Codex): show all
      // OpenRouter: show only top featured (max 15)
      const direct = all.filter((m) => m.provider !== "openrouter");
      const orFeatured = all
        .filter((m) => m.provider === "openrouter" && m.featured)
        .slice(0, 15);
      this._availableModels = [...direct, ...orFeatured].map((m) => ({
        id: m.id,
        label: m.name,
      }));
    } catch {
      this._availableModels = [];
    }
  }

  private async _switchModel(modelId: string) {
    try {
      const data = await api<{ ok?: boolean; model?: string; error?: string }>(
        `/chat/model/${this._agentId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: modelId }),
        }
      );
      if (data.ok && data.model) {
        this._currentModel = data.model;
        // Update badge in agent sidebar
        if (typeof (window as Record<string, unknown>).updateModelBadge === "function") {
          (window as Record<string, unknown>).updateModelBadge(this._agentId, data.model);
        }
      }
    } catch { /* empty */ }
  }

  private _renderModelOptions() {
    if (this._availableModels.length === 0) {
      return html`<option value="" disabled>Loading models...</option>`;
    }
    // Group by provider prefix
    const groups = new Map<string, Array<{ id: string; label: string }>>();
    for (const m of this._availableModels) {
      const provider = m.id.split("/")[0] || "other";
      if (!groups.has(provider)) {groups.set(provider, []);}
      groups.get(provider)!.push(m);
    }
    const providerLabels: Record<string, string> = {
      anthropic: "Anthropic",
      openai: "OpenAI",
      "openai-codex": "Codex (ChatGPT)",
      openrouter: "OpenRouter",
    };
    return Array.from(groups.entries()).map(
      ([provider, models]) =>
        html`<optgroup label="${providerLabels[provider] || provider}">
          ${models.map((m) => html`<option value="${m.id}">${m.label}</option>`)}
        </optgroup>`
    );
  }

  private _getModelShortLabel(model: unknown): string {
    if (!model || typeof model !== "string") {return "";}
    // Strip provider prefix and version details for compact display
    const name = model.replace(/^(anthropic|openai|google|openrouter)\//, "");
    if (name.includes("opus")) {return "Opus";}
    if (name.includes("sonnet")) {return "Sonnet";}
    if (name.includes("haiku")) {return "Haiku";}
    if (name.includes("gpt-4")) {return "GPT-4";}
    if (name.includes("gpt-5")) {return "GPT-5";}
    if (name.includes("gemini")) {return "Gemini";}
    return name.split("-").slice(0, 2).join("-");
  }

  // ── Connection ──────────────────────────────────────────

  private async _checkConnection() {
    try {
      const data = await api<{ connected?: boolean }>("/gateway/status");
      this._connected = data?.connected === true;
    } catch {
      this._connected = false;
    }
  }

  // ── Send Message (SSE) ──────────────────────────────────

  private async _sendMessage() {
    const message = this._draft.trim();
    const attachments = [...this._attachments];
    if (!message && attachments.length === 0) {return;}

    // Clear input
    this._draft = "";
    this._attachments = [];

    // Intercept /model command
    const modelMatch = message.match(/^\/model\s+(\S+)/i);
    if (modelMatch) {
      await this._handleModelCommand(modelMatch[1]);
      return;
    }

    // Optimistic user message
    this._messages = [
      ...this._messages,
      { role: "user", content: message, created_at: new Date().toISOString() },
    ];

    this._sending = true;
    this._stream = "";
    this._streamStartedAt = Date.now();
    this._abortController = new AbortController();
    this._userScrolledUp = false; // Always scroll to see response

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          agentId: this._agentId,
          sessionId: this._sessionKey,
          attachments: attachments.map((a) => ({
            type: "image",
            mimeType: a.mimeType,
            content: a.dataUrl.replace(/^data:[^;]+;base64,/, ""),
          })),
        }),
        signal: this._abortController.signal,
      });

      if (!res.ok || !res.body) {
        if (res.status === 401) {
          window.location.href = "/login.html";
          return;
        }
        this._error = "Could not connect to gateway";
        this._finishSend();
        return;
      }

      // Read SSE stream
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {break;}
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) {continue;}
          try {
            const event = JSON.parse(line.slice(6));
            this._handleSseEvent(event);
          } catch { /* malformed event */ }
        }
      }

      // Stream ended — finalize
      if (this._stream) {
        // Stream completed without explicit 'done' event
      } else {
        // No stream text received — reload history for full message
        await this._loadHistory();
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        this._error = (e as Error).message;
      }
    }

    this._finishSend();
  }

  private _handleSseEvent(event: Record<string, unknown>) {
    const type = event.type as string;

    if (type === "delta") {
      const delta = event.delta as string;
      // Delta may be full accumulated text or incremental
      if (delta.length >= (this._stream || "").length) {
        this._stream = delta;
      } else {
        this._stream = (this._stream || "") + delta;
      }
    } else if (type === "model_change" || type === "model") {
      const modelId = (event.modelId || event.model || "") as string;
      if (modelId) {this._currentModel = modelId;}
    } else if (type === "done") {
      // Finalize: add streamed text as assistant message
      if (this._stream) {
        this._messages = [
          ...this._messages,
          { role: "assistant", content: this._stream, created_at: new Date().toISOString() },
        ];
      }
      this._stream = null;
      this._streamStartedAt = null;
      // Reload to get full message with tool results
      this._loadHistory();
      this._loadSessions();
    } else if (type === "error") {
      this._error = (event.error as string) || "Unknown error";
    }
    // tool_start / tool_end — stream handles these visually
  }

  private _finishSend() {
    this._sending = false;
    if (!this._stream) {
      this._stream = null;
      this._streamStartedAt = null;
    }
    this._abortController = null;
  }

  // ── Abort ───────────────────────────────────────────────

  private async _abort() {
    this._abortController?.abort();
    this._abortController = null;
    try {
      await fetch("/api/chat/abort", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: this._agentId,
          sessionId: this._sessionKey,
        }),
      });
    } catch { /* empty */ }
    this._finishSend();
    this._loadHistory();
  }

  // ── New Session ─────────────────────────────────────────

  private async _newSession() {
    this._messages = [];
    this._stream = null;
    try {
      await fetch("/api/chat/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: this._agentId,
          sessionId: this._sessionKey,
        }),
      });
    } catch { /* empty */ }
    this._loadHistory();
    this._loadSessions();
  }

  // ── Agent Switch ────────────────────────────────────────

  private _switchAgent(agentId: string) {
    this._agentId = agentId;
    this._sessionKey = `agent:${agentId}:main`;
    const agent = this._agentsList?.agents?.find((a) => a.id === agentId);
    this._assistantName = agent?.identity?.name || agent?.name || agentId;
    this._assistantAvatar = agent?.identity?.avatarUrl || null;
    this._messages = [];
    this._loading = true;
    Promise.all([this._loadSessions(), this._loadHistory(), this._loadModel()]);
  }

  // ── Session Switch ──────────────────────────────────────

  private _switchSession(sessionKey: string) {
    this._sessionKey = sessionKey;
    this._messages = [];
    this._loading = true;
    this._loadHistory();
  }

  // ── Model Command ───────────────────────────────────────

  private async _handleModelCommand(model: string) {
    try {
      const data = await api<{ ok?: boolean; model?: string; error?: string }>(
        `/chat/model/${this._agentId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model }),
        }
      );
      if (data.ok && data.model) {
        this._currentModel = data.model;
        this._messages = [
          ...this._messages,
          { role: "assistant", content: `Model switched to **${data.model}**`, created_at: new Date().toISOString() },
        ];
      } else {
        this._messages = [
          ...this._messages,
          { role: "assistant", content: `Failed to switch model: ${data.error || "unknown"}`, created_at: new Date().toISOString() },
        ];
      }
    } catch (e) {
      this._messages = [
        ...this._messages,
        { role: "assistant", content: `Error: ${(e as Error).message}`, created_at: new Date().toISOString() },
      ];
    }
  }

  // ── Refresh ─────────────────────────────────────────────

  private _refresh() {
    this._loadHistory();
    this._loadSessions();
    // Also refresh the vanilla JS sessions sidebar
    try {
      const fn = (window as Record<string, unknown>).loadChatSessions;
      if (typeof fn === "function") {(fn as () => void)();}
    } catch { /* empty */ }
  }

  // ── Scroll Management ────────────────────────────────────

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
    if (!el) {return;}
    // User is "at bottom" if within 80px of the end
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    this._userScrolledUp = !atBottom;
  }

  override updated(changed: Map<string, unknown>) {
    super.updated(changed);
    // Auto-scroll when messages change or stream updates, unless user scrolled up
    if (!this._userScrolledUp) {
      if (changed.has("_messages") || changed.has("_stream") || changed.has("_loading")) {
        this._scrollToBottom();
      }
    }
    // Always scroll to bottom on first load
    if (changed.has("_loading") && !this._loading) {
      this._userScrolledUp = false;
      this._scrollToBottom();
    }
  }

  // ── Render ──────────────────────────────────────────────

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
      onAttachmentsChange: (atts) => { this._attachments = atts; },
      onRefresh: () => { this._loadHistory(); this._loadSessions(); },
      onToggleFocusMode: () => {},
      onDraftChange: (text) => { this._draft = text; },
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
      onScrollToBottom: () => { this._userScrolledUp = false; this._scrollToBottom(); },
      showNewMessages: this._userScrolledUp && (this._stream !== null || this._sending),
    };

    const modelLabel = this._getModelShortLabel(this._currentModel);
    const isBusy = this._sending || this._stream !== null;

    return html`
      <div class="aiwh-chat-header">
        <div class="aiwh-chat-header__left">
          <span class="aiwh-chat-header__dot ${this._connected ? "connected" : "disconnected"}"
                title="${this._connected ? "Connected to gateway" : "Disconnected"}"></span>
          <span class="aiwh-chat-header__name">${this._assistantName}</span>
        </div>
        <div class="aiwh-chat-header__right">
          <select
            class="aiwh-chat-header__model-select"
            title="Switch model (current: ${modelLabel || 'default'})"
            ?disabled=${!this._connected || isBusy}
            @change=${(e: Event) => {
              const val = (e.target as HTMLSelectElement).value;
              if (val) {this._switchModel(val);}
            }}
          >
            <option value="">${modelLabel || "Model"}</option>
            ${this._renderModelOptions()}
          </select>
          <button class="aiwh-chat-header__btn" @click=${() => this._newSession()} title="New session">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          </button>
          <button class="aiwh-chat-header__btn" @click=${() => this._refresh()} title="Refresh">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2 8a6 6 0 0111.2-3M14 8a6 6 0 01-11.2 3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M13 2v3h-3M3 14v-3h3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
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
          <p style="margin-top:12px;color:#888;">Messages loaded: ${this._messages.length} | Connected: ${this._connected} | Agent: ${this._agentId}</p>
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
