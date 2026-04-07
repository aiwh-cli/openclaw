import { html, nothing } from "lit";
import { ref } from "lit/directives/ref.js";
import { CHAT_ATTACHMENT_ACCEPT } from "../chat/attachment-support.ts";
import type { SlashCommandDef } from "../chat/slash-commands.ts";
import { stopStt } from "../chat/speech.ts";
import type {
  CompactionStatus as CompactionIndicatorStatus,
  FallbackStatus as FallbackIndicatorStatus,
} from "../ui-deps/app-tool-stream.ts";
import { icons } from "../ui-deps/icons.ts";
import { detectTextDirection } from "../ui-deps/text-direction.ts";
import type { SessionsListResult } from "../ui-deps/types.ts";
import type { ChatAttachment, ChatQueueItem } from "../ui-deps/ui-types.ts";
import { resolveAgentAvatarUrl } from "./agents-utils.ts";
import {
  renderCompactionIndicator,
  renderFallbackIndicator,
  renderContextNotice,
} from "./chat-indicators.ts";
import "../components/resizable-divider.ts";
import {
  adjustTextareaHeight,
  handlePaste,
  handleFileSelect,
  handleDrop,
  renderAttachmentPreview,
  tokenEstimate,
  renderSlashMenu,
} from "./chat-input.ts";
import { createHandleKeyDown, createHandleInput } from "./chat-keyboard.ts";
import { buildChatItems } from "./chat-message-list.ts";
import { renderSearchBar, renderPinnedSection } from "./chat-panels.ts";
import { getInputHistory, getPinnedMessages, getDeletedMessages } from "./chat-session-state.ts";
import { renderThread } from "./chat-thread.ts";
import { renderToolbar } from "./chat-toolbar.ts";
import { renderMarkdownSidebar } from "./markdown-sidebar.ts";

export type ChatProps = {
  sessionKey: string;
  onSessionKeyChange: (next: string) => void;
  thinkingLevel: string | null;
  showThinking: boolean;
  showToolCalls: boolean;
  loading: boolean;
  sending: boolean;
  canAbort?: boolean;
  compactionStatus?: CompactionIndicatorStatus | null;
  fallbackStatus?: FallbackIndicatorStatus | null;
  messages: unknown[];
  toolMessages: unknown[];
  streamSegments: Array<{ text: string; ts: number }>;
  stream: string | null;
  streamStartedAt: number | null;
  assistantAvatarUrl?: string | null;
  draft: string;
  queue: ChatQueueItem[];
  connected: boolean;
  canSend: boolean;
  disabledReason: string | null;
  error: string | null;
  sessions: SessionsListResult | null;
  focusMode: boolean;
  sidebarOpen?: boolean;
  sidebarContent?: string | null;
  sidebarError?: string | null;
  splitRatio?: number;
  assistantName: string;
  assistantAvatar: string | null;
  attachments?: ChatAttachment[];
  onAttachmentsChange?: (attachments: ChatAttachment[]) => void;
  showNewMessages?: boolean;
  onScrollToBottom?: () => void;
  onRefresh: () => void;
  onToggleFocusMode: () => void;
  getDraft?: () => string;
  onDraftChange: (next: string) => void;
  onRequestUpdate?: () => void;
  onSend: () => void;
  onAbort?: () => void;
  onQueueRemove: (id: string) => void;
  onNewSession: () => void;
  onClearHistory?: () => void;
  agentsList: {
    agents: Array<{ id: string; name?: string; identity?: { name?: string; avatarUrl?: string } }>;
    defaultId?: string;
  } | null;
  currentAgentId: string;
  onAgentChange: (agentId: string) => void;
  onNavigateToAgent?: () => void;
  onSessionSelect?: (sessionKey: string) => void;
  onOpenSidebar?: (content: string) => void;
  onCloseSidebar?: () => void;
  onSplitRatioChange?: (ratio: number) => void;
  onChatScroll?: (event: Event) => void;
  basePath?: string;
};

export interface ChatEphemeralState {
  sttRecording: boolean;
  sttInterimText: string;
  slashMenuOpen: boolean;
  slashMenuItems: SlashCommandDef[];
  slashMenuIndex: number;
  slashMenuMode: "command" | "args";
  slashMenuCommand: SlashCommandDef | null;
  slashMenuArgItems: string[];
  searchOpen: boolean;
  searchQuery: string;
  pinnedExpanded: boolean;
}

function createChatEphemeralState(): ChatEphemeralState {
  return {
    sttRecording: false,
    sttInterimText: "",
    slashMenuOpen: false,
    slashMenuItems: [],
    slashMenuIndex: 0,
    slashMenuMode: "command",
    slashMenuCommand: null,
    slashMenuArgItems: [],
    searchOpen: false,
    searchQuery: "",
    pinnedExpanded: false,
  };
}

export const vs: ChatEphemeralState = createChatEphemeralState();

/**
 * Reset chat view ephemeral state when navigating away.
 * Stops STT recording and clears search/slash UI that should not survive navigation.
 */
export function resetChatViewState() {
  if (vs.sttRecording) {
    stopStt();
  }
  Object.assign(vs, createChatEphemeralState());
}

export const cleanupChatModuleState = resetChatViewState;

export function renderChat(props: ChatProps) {
  const canCompose = props.connected;
  const isBusy = props.sending || props.stream !== null || props.canAbort;
  const canAbort = Boolean(props.canAbort && props.onAbort);
  const activeSession = props.sessions?.sessions?.find((row) => row.key === props.sessionKey);
  const reasoningLevel = activeSession?.reasoningLevel ?? "off";
  const showReasoning = props.showThinking && reasoningLevel !== "off";
  const assistantIdentity = {
    name: props.assistantName,
    avatar:
      resolveAgentAvatarUrl({
        identity: {
          avatar: props.assistantAvatar ?? undefined,
          avatarUrl: props.assistantAvatarUrl ?? undefined,
        },
      }) ?? null,
  };
  const pinned = getPinnedMessages(props.sessionKey);
  const deleted = getDeletedMessages(props.sessionKey);
  const inputHistory = getInputHistory(props.sessionKey);
  const hasAttachments = (props.attachments?.length ?? 0) > 0;
  const tokens = tokenEstimate(props.draft);

  const placeholder = props.connected
    ? hasAttachments
      ? "Add a message or paste more images..."
      : `Message ${props.assistantName || "agent"} (Enter to send)`
    : "Connect to the gateway to start chatting...";

  const requestUpdate = props.onRequestUpdate ?? (() => {});
  const getDraft = props.getDraft ?? (() => props.draft);
  const splitRatio = props.splitRatio ?? 0.6;
  const sidebarOpen = Boolean(props.sidebarOpen && props.onCloseSidebar);

  const chatItems = buildChatItems(props, vs);
  const isEmpty = chatItems.length === 0 && !props.loading;

  const handleKeyDown = createHandleKeyDown(props, vs, requestUpdate, inputHistory, canCompose);
  const handleInput = createHandleInput(props, vs, requestUpdate, inputHistory);

  const thread = renderThread(
    props,
    chatItems,
    isEmpty,
    assistantIdentity,
    deleted,
    showReasoning,
    activeSession,
    requestUpdate,
    vs,
  );

  return html`
    <section
      class="card chat"
      @drop=${(e: DragEvent) => handleDrop(e, props)}
      @dragover=${(e: DragEvent) => e.preventDefault()}
    >
      ${props.disabledReason ? html`<div class="callout">${props.disabledReason}</div>` : nothing}
      ${props.error ? html`<div class="callout danger">${props.error}</div>` : nothing}
      ${props.focusMode
        ? html`
            <button
              class="chat-focus-exit"
              type="button"
              @click=${props.onToggleFocusMode}
              aria-label="Exit focus mode"
              title="Exit focus mode"
            >
              ${icons.x}
            </button>
          `
        : nothing}
      ${renderSearchBar(requestUpdate, vs)} ${renderPinnedSection(props, pinned, requestUpdate, vs)}

      <div class="chat-split-container ${sidebarOpen ? "chat-split-container--open" : ""}">
        <div
          class="chat-main"
          style="flex: ${sidebarOpen ? `0 0 ${splitRatio * 100}%` : "1 1 100%"}"
        >
          ${thread}
        </div>
        ${sidebarOpen
          ? html`
              <resizable-divider
                .splitRatio=${splitRatio}
                @resize=${(e: CustomEvent) => props.onSplitRatioChange?.(e.detail.splitRatio)}
              ></resizable-divider>
              <div class="chat-sidebar">
                ${renderMarkdownSidebar({
                  content: props.sidebarContent ?? null,
                  error: props.sidebarError ?? null,
                  onClose: props.onCloseSidebar!,
                  onViewRawText: () => {
                    if (!props.sidebarContent || !props.onOpenSidebar) {
                      return;
                    }
                    props.onOpenSidebar(`\`\`\`\n${props.sidebarContent}\n\`\`\``);
                  },
                })}
              </div>
            `
          : nothing}
      </div>

      ${renderQueue(props)} ${renderFallbackIndicator(props.fallbackStatus)}
      ${renderCompactionIndicator(props.compactionStatus)}
      ${renderContextNotice(activeSession, props.sessions?.defaults?.contextTokens ?? null)}
      ${props.showNewMessages
        ? html`
            <button class="chat-new-messages" type="button" @click=${props.onScrollToBottom}>
              ${icons.arrowDown} New messages
            </button>
          `
        : nothing}

      <!-- Input bar -->
      <div class="agent-chat__input">
        ${renderSlashMenu(requestUpdate, props, vs)} ${renderAttachmentPreview(props)}
        <input
          type="file"
          accept=${CHAT_ATTACHMENT_ACCEPT}
          multiple
          class="agent-chat__file-input"
          @change=${(e: Event) => handleFileSelect(e, props)}
        />
        ${vs.sttRecording && vs.sttInterimText
          ? html`<div class="agent-chat__stt-interim">${vs.sttInterimText}</div>`
          : nothing}
        <textarea
          ${ref((el) => el && adjustTextareaHeight(el as HTMLTextAreaElement))}
          .value=${props.draft}
          dir=${detectTextDirection(props.draft)}
          ?disabled=${!props.connected}
          @keydown=${handleKeyDown}
          @input=${handleInput}
          @paste=${(e: ClipboardEvent) => handlePaste(e, props)}
          placeholder=${vs.sttRecording ? "Listening..." : placeholder}
          rows="1"
        ></textarea>
        ${renderToolbar(props, vs, requestUpdate, getDraft, inputHistory, isBusy, canAbort, tokens)}
      </div>
    </section>
  `;
}

function renderQueue(props: ChatProps) {
  if (!props.queue.length) {
    return nothing;
  }
  return html`
    <div class="chat-queue" role="status" aria-live="polite">
      <div class="chat-queue__title">Queued (${props.queue.length})</div>
      <div class="chat-queue__list">
        ${props.queue.map(
          (item) => html`
            <div class="chat-queue__item">
              <div class="chat-queue__text">
                ${item.text ||
                (item.attachments?.length ? `Image (${item.attachments.length})` : "")}
              </div>
              <button
                class="btn chat-queue__remove"
                type="button"
                aria-label="Remove queued message"
                @click=${() => props.onQueueRemove(item.id)}
              >
                ${icons.x}
              </button>
            </div>
          `,
        )}
      </div>
    </div>
  `;
}
