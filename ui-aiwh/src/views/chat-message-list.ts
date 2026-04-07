import { normalizeMessage, normalizeRoleForGrouping } from "../chat/message-normalizer.ts";
import { messageMatchesSearchQuery } from "../chat/search-match.ts";
import type { ChatItem, MessageGroup } from "../ui-deps/types/chat-types.ts";
import type { ChatProps, ChatEphemeralState } from "./chat.ts";

export const CHAT_HISTORY_RENDER_LIMIT = 200;

export function groupMessages(items: ChatItem[]): Array<ChatItem | MessageGroup> {
  const result: Array<ChatItem | MessageGroup> = [];
  let currentGroup: MessageGroup | null = null;

  for (const item of items) {
    if (item.kind !== "message") {
      if (currentGroup) {
        result.push(currentGroup);
        currentGroup = null;
      }
      result.push(item);
      continue;
    }

    const normalized = normalizeMessage(item.message);
    const role = normalizeRoleForGrouping(normalized.role);
    const senderLabel = role.toLowerCase() === "user" ? (normalized.senderLabel ?? null) : null;
    const timestamp = normalized.timestamp || Date.now();

    if (
      !currentGroup ||
      currentGroup.role !== role ||
      (role.toLowerCase() === "user" && currentGroup.senderLabel !== senderLabel)
    ) {
      if (currentGroup) {
        result.push(currentGroup);
      }
      currentGroup = {
        kind: "group",
        key: `group:${role}:${item.key}`,
        role,
        senderLabel,
        messages: [{ message: item.message, key: item.key }],
        timestamp,
        isStreaming: false,
      };
    } else {
      currentGroup.messages.push({ message: item.message, key: item.key });
    }
  }

  if (currentGroup) {
    result.push(currentGroup);
  }
  return result;
}

export function buildChatItems(
  props: ChatProps,
  vs: ChatEphemeralState,
): Array<ChatItem | MessageGroup> {
  const items: ChatItem[] = [];
  const history = Array.isArray(props.messages) ? props.messages : [];
  const tools = Array.isArray(props.toolMessages) ? props.toolMessages : [];
  const historyStart = Math.max(0, history.length - CHAT_HISTORY_RENDER_LIMIT);
  if (historyStart > 0) {
    items.push({
      kind: "message",
      key: "chat:history:notice",
      message: {
        role: "system",
        content: `Showing last ${CHAT_HISTORY_RENDER_LIMIT} messages (${historyStart} hidden).`,
        timestamp: Date.now(),
      },
    });
  }
  for (let i = historyStart; i < history.length; i++) {
    const msg = history[i];
    const normalized = normalizeMessage(msg);
    const raw = msg as Record<string, unknown>;
    const marker = raw.__openclaw as Record<string, unknown> | undefined;
    if (marker && marker.kind === "compaction") {
      items.push({
        kind: "divider",
        key:
          typeof marker.id === "string"
            ? `divider:compaction:${marker.id}`
            : `divider:compaction:${normalized.timestamp}:${i}`,
        label: "Compaction",
        timestamp: normalized.timestamp ?? Date.now(),
      });
      continue;
    }

    if (!props.showToolCalls && normalized.role.toLowerCase() === "toolresult") {
      continue;
    }

    // Apply search filter if active
    if (vs.searchOpen && vs.searchQuery.trim() && !messageMatchesSearchQuery(msg, vs.searchQuery)) {
      continue;
    }

    items.push({
      kind: "message",
      key: messageKey(msg, i),
      message: msg,
    });
  }
  // Interleave stream segments and tool cards in order. Each segment
  // contains text that was streaming before the corresponding tool started.
  // This ensures correct visual ordering: text → tool → text → tool → ...
  const segments = props.streamSegments ?? [];
  const maxLen = Math.max(segments.length, tools.length);
  for (let i = 0; i < maxLen; i++) {
    if (i < segments.length && segments[i].text.trim().length > 0) {
      items.push({
        kind: "stream" as const,
        key: `stream-seg:${props.sessionKey}:${i}`,
        text: segments[i].text,
        startedAt: segments[i].ts,
      });
    }
    if (i < tools.length && props.showToolCalls) {
      items.push({
        kind: "message",
        key: messageKey(tools[i], i + history.length),
        message: tools[i],
      });
    }
  }

  if (props.stream !== null) {
    const key = `stream:${props.sessionKey}:${props.streamStartedAt ?? "live"}`;
    if (props.stream.trim().length > 0) {
      items.push({
        kind: "stream",
        key,
        text: props.stream,
        startedAt: props.streamStartedAt ?? Date.now(),
      });
    } else {
      items.push({ kind: "reading-indicator", key });
    }
  }

  return groupMessages(items);
}

export function messageKey(message: unknown, index: number): string {
  const m = message as Record<string, unknown>;
  const toolCallId = typeof m.toolCallId === "string" ? m.toolCallId : "";
  if (toolCallId) {
    return `tool:${toolCallId}`;
  }
  const id = typeof m.id === "string" ? m.id : "";
  if (id) {
    return `msg:${id}`;
  }
  const messageId = typeof m.messageId === "string" ? m.messageId : "";
  if (messageId) {
    return `msg:${messageId}`;
  }
  const timestamp = typeof m.timestamp === "number" ? m.timestamp : null;
  const role = typeof m.role === "string" ? m.role : "unknown";
  if (timestamp != null) {
    return `msg:${role}:${timestamp}:${index}`;
  }
  return `msg:${role}:${index}`;
}
