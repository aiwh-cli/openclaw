/**
 * AIWH Tool Stream — Adapts SSE tool events into proper chat tool messages.
 *
 * Bridges the SSE-based AIWH dashboard chat with the gateway's tool event format.
 * Builds content blocks that `extractToolCards()` in grouped-render can parse:
 *   { type: "toolcall", name, arguments }
 *   { type: "toolresult", name, text }
 */

const TOOL_STREAM_LIMIT = 50;
const TOOL_STREAM_THROTTLE_MS = 80;
const TOOL_OUTPUT_CHAR_LIMIT = 120_000;

export interface ToolStreamEntry {
  toolCallId: string;
  name: string;
  args?: unknown;
  output?: string;
  startedAt: number;
  updatedAt: number;
}

export interface ToolStreamState {
  entries: Map<string, ToolStreamEntry>;
  order: string[];
  syncTimer: number | null;
}

export function createToolStreamState(): ToolStreamState {
  return { entries: new Map(), order: [], syncTimer: null };
}

export function resetToolStream(ts: ToolStreamState) {
  if (ts.syncTimer != null) {
    clearTimeout(ts.syncTimer);
    ts.syncTimer = null;
  }
  ts.entries.clear();
  ts.order = [];
}

/** SSE event from chat-proxy with enriched tool data */
export interface ToolSseEvent {
  type: "tool_start" | "tool_end" | "agent_event";
  name?: string;
  toolCallId?: string;
  args?: unknown;
  output?: string;
  phase?: string;
  result?: unknown;
  partialResult?: unknown;
}

function truncateOutput(text: string): string {
  if (text.length <= TOOL_OUTPUT_CHAR_LIMIT) {
    return text;
  }
  const truncated = text.slice(0, TOOL_OUTPUT_CHAR_LIMIT);
  return `${truncated}\n\n… truncated (${text.length} chars, showing first ${TOOL_OUTPUT_CHAR_LIMIT}).`;
}

function formatOutput(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === "string") {
    return value ? truncateOutput(value) : undefined;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  // Extract text from { text: "..." } or { content: [{ type: "text", text: "..." }] }
  if (typeof value === "object") {
    const r = value as Record<string, unknown>;
    if (typeof r.text === "string") {
      return truncateOutput(r.text);
    }
    if (Array.isArray(r.content)) {
      const parts = r.content
        .filter(
          (c: unknown) =>
            c && typeof c === "object" && (c as Record<string, unknown>).type === "text",
        )
        .map((c: unknown) => (c as Record<string, unknown>).text as string)
        .filter(Boolean);
      if (parts.length > 0) {
        return truncateOutput(parts.join("\n"));
      }
    }
  }
  try {
    return truncateOutput(JSON.stringify(value, null, 2));
  } catch {
    return undefined;
  }
}

function buildMessage(entry: ToolStreamEntry): Record<string, unknown> {
  const content: Array<Record<string, unknown>> = [];
  content.push({
    type: "toolcall",
    name: entry.name,
    arguments: entry.args ?? {},
  });
  if (entry.output) {
    content.push({
      type: "toolresult",
      name: entry.name,
      text: entry.output,
    });
  }
  return {
    role: "assistant",
    toolCallId: entry.toolCallId,
    content,
    timestamp: entry.startedAt,
  };
}

/**
 * Process a tool SSE event and update tool stream state.
 * Returns updated tool messages array when sync triggers (throttled at 80ms).
 *
 * @param onSync - called with new tool messages array when sync fires
 * @param onCommitStream - called to commit current streaming text as a segment before tool card
 */
export function handleToolEvent(
  ts: ToolStreamState,
  evt: ToolSseEvent,
  onSync: (messages: unknown[]) => void,
  onCommitStream: () => void,
) {
  const now = Date.now();
  let forceSync = false;

  if (evt.type === "tool_start") {
    const toolCallId = evt.toolCallId || `tool-${now}-${ts.order.length}`;
    const name = evt.name || "tool";

    // Commit streaming text before tool card
    onCommitStream();

    const entry: ToolStreamEntry = {
      toolCallId,
      name,
      args: evt.args,
      startedAt: now,
      updatedAt: now,
    };
    ts.entries.set(toolCallId, entry);
    ts.order.push(toolCallId);
    trimStream(ts);
  } else if (evt.type === "tool_end") {
    // Mark most recent entry as complete with output
    const lastId = ts.order[ts.order.length - 1];
    if (lastId) {
      const entry = ts.entries.get(lastId);
      if (entry) {
        if (evt.output) {
          entry.output = formatOutput(evt.output);
        } else if (evt.result !== undefined) {
          entry.output = formatOutput(evt.result);
        }
        entry.updatedAt = now;
      }
    }
    forceSync = true;
  } else if (evt.type === "agent_event") {
    // Full gateway agent event passthrough
    const toolCallId = evt.toolCallId || `tool-${now}-${ts.order.length}`;
    const name = evt.name || "tool";
    const phase = evt.phase || "";

    let entry = ts.entries.get(toolCallId);
    if (!entry) {
      onCommitStream();
      entry = {
        toolCallId,
        name,
        args: phase === "start" ? evt.args : undefined,
        startedAt: now,
        updatedAt: now,
      };
      ts.entries.set(toolCallId, entry);
      ts.order.push(toolCallId);
      trimStream(ts);
    } else {
      entry.name = name;
      if (evt.args !== undefined) {
        entry.args = evt.args;
      }
      entry.updatedAt = now;
    }

    if (phase === "update" && evt.partialResult !== undefined) {
      entry.output = formatOutput(evt.partialResult);
    } else if (phase === "result" && evt.result !== undefined) {
      entry.output = formatOutput(evt.result);
      forceSync = true;
    }
  }

  // Build messages and schedule sync
  for (const id of ts.order) {
    const e = ts.entries.get(id);
    if (e) {
      ts.entries.set(id, { ...e });
    } // trigger new ref for reactive detection
  }
  scheduleSync(ts, onSync, forceSync);
}

function trimStream(ts: ToolStreamState) {
  if (ts.order.length <= TOOL_STREAM_LIMIT) {
    return;
  }
  const overflow = ts.order.length - TOOL_STREAM_LIMIT;
  const removed = ts.order.splice(0, overflow);
  for (const id of removed) {
    ts.entries.delete(id);
  }
}

function syncMessages(ts: ToolStreamState): unknown[] {
  return ts.order
    .map((id) => {
      const e = ts.entries.get(id);
      return e ? buildMessage(e) : null;
    })
    .filter(Boolean);
}

function scheduleSync(ts: ToolStreamState, onSync: (messages: unknown[]) => void, force: boolean) {
  if (force) {
    if (ts.syncTimer != null) {
      clearTimeout(ts.syncTimer);
      ts.syncTimer = null;
    }
    onSync(syncMessages(ts));
    return;
  }
  if (ts.syncTimer != null) {
    return;
  }
  ts.syncTimer = window.setTimeout(() => {
    ts.syncTimer = null;
    onSync(syncMessages(ts));
  }, TOOL_STREAM_THROTTLE_MS);
}
