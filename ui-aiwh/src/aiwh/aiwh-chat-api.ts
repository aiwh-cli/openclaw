/**
 * AIWH Chat API — Pure data-layer functions for the AIWH chat host.
 *
 * Each function takes explicit params and returns typed results.
 * No component state access — designed for import by aiwh-chat-host.ts.
 */

import type { SessionsListResult } from "../ui-deps/types.ts";

// ─── Types ─────────────────────────────────────────────────

export interface AgentEntry {
  id: string;
  name?: string;
  identity?: { name?: string; avatarUrl?: string };
}

export interface AgentsList {
  agents: AgentEntry[];
  defaultId: string;
}

export interface HistoryResult {
  messages: unknown[];
  contextTokens: number | null;
  contextMessageCount: number;
}

export interface ModelSwitchResult {
  ok: boolean;
  model?: string;
  error?: string;
}

export interface AvailableModel {
  id: string;
  label: string;
}

// ─── Helpers ───────────────────────────────────────────────

/** Fetch wrapper with 401 redirect */
export async function api<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, opts);
  if (res.status === 401) {
    try {
      const err = await res.json();
      if (err?.redirect) {
        window.location.href = err.redirect;
      }
    } catch {
      /* empty */
    }
    window.location.href = "/login.html";
    throw new Error("Unauthorized");
  }
  return res.json() as Promise<T>;
}

export function escHtml(str: string): string {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ─── Data Loading Functions ────────────────────────────────

export async function loadAgentsList(): Promise<AgentsList> {
  try {
    const agents = await api<AgentEntry[]>("/agents");
    const list = Array.isArray(agents) ? agents : [];
    return { agents: list, defaultId: "main" };
  } catch {
    return { agents: [], defaultId: "main" };
  }
}

export async function loadChatSessions(agentId: string): Promise<SessionsListResult | null> {
  try {
    const rows = await api<Array<Record<string, unknown>>>(`/chat/sessions?agentId=${agentId}`);
    const sessions = Array.isArray(rows) ? rows : [];
    return {
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
    return null;
  }
}

export async function loadChatHistory(agentId: string, sessionKey: string): Promise<HistoryResult> {
  try {
    const data = await api<{ messages?: unknown[]; context?: Record<string, unknown> }>(
      `/chat/history?agentId=${agentId}&sessionId=${encodeURIComponent(sessionKey)}`,
    );
    const msgs = Array.isArray(data) ? data : data?.messages || [];
    const contextTokens = data?.context ? (data.context.tokens as number) || null : null;
    const contextMessageCount = data?.context ? (data.context.messageCount as number) || 0 : 0;
    return { messages: msgs, contextTokens, contextMessageCount };
  } catch {
    return { messages: [], contextTokens: null, contextMessageCount: 0 };
  }
}

export async function loadCurrentModel(agentId: string): Promise<string> {
  try {
    const { model } = await api<{ model?: string }>(`/chat/model/${agentId}`);
    if (model && typeof model === "string") {
      return model;
    }
  } catch {
    /* empty */
  }
  return "";
}

export async function loadAvailableModels(): Promise<AvailableModel[]> {
  try {
    const data = await api<{
      models?: Array<{
        id: string;
        name: string;
        provider?: string;
        tier?: string;
        featured?: boolean;
      }>;
      providers?: string[];
    }>("/agents/models/available");
    const all = data?.models || [];
    // Direct providers (Anthropic, OpenAI, Codex): show all
    // OpenRouter: show only top featured (max 15)
    const direct = all.filter((m) => m.provider !== "openrouter");
    const orFeatured = all.filter((m) => m.provider === "openrouter" && m.featured).slice(0, 15);
    return [...direct, ...orFeatured].map((m) => ({
      id: m.id,
      label: m.name,
    }));
  } catch {
    return [];
  }
}

export async function switchModel(agentId: string, modelId: string): Promise<ModelSwitchResult> {
  try {
    const data = await api<{ ok?: boolean; model?: string; error?: string }>(
      `/chat/model/${agentId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: modelId }),
      },
    );
    return {
      ok: data.ok === true,
      model: data.model,
      error: data.error,
    };
  } catch {
    return { ok: false };
  }
}

export async function checkGatewayConnection(): Promise<boolean> {
  try {
    const data = await api<{ connected?: boolean }>("/gateway/status");
    return data?.connected === true;
  } catch {
    return false;
  }
}

export async function handleModelCommand(
  agentId: string,
  model: string,
): Promise<ModelSwitchResult> {
  try {
    const data = await api<{ ok?: boolean; model?: string; error?: string }>(
      `/chat/model/${agentId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
      },
    );
    return {
      ok: data.ok === true,
      model: data.model,
      error: data.error,
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export function getModelShortLabel(model: unknown): string {
  if (!model || typeof model !== "string") {
    return "";
  }
  // Strip provider prefix and version details for compact display
  const name = model.replace(/^(anthropic|openai|google|openrouter)\//, "");
  if (name.includes("opus")) {
    return "Opus";
  }
  if (name.includes("sonnet")) {
    return "Sonnet";
  }
  if (name.includes("haiku")) {
    return "Haiku";
  }
  if (name.includes("gpt-4")) {
    return "GPT-4";
  }
  if (name.includes("gpt-5")) {
    return "GPT-5";
  }
  if (name.includes("gemini")) {
    return "Gemini";
  }
  return name.split("-").slice(0, 2).join("-");
}

// ─── SSE Chat Stream ───────────────────────────────────────

export interface SseCallbacks {
  onDelta: (fullText: string) => void;
  onModelChange: (modelId: string) => void;
  onDone: (streamedText: string | null) => void;
  onError: (message: string) => void;
}

export interface ChatAttachmentPayload {
  mimeType: string;
  dataUrl: string;
}

/**
 * Send a chat message via SSE streaming.
 * Returns { ok: false, error } on connection failure, or { ok: true } after stream completes.
 * State mutations happen via callbacks.
 */
export async function sendChatStream(
  agentId: string,
  sessionKey: string,
  message: string,
  attachments: ChatAttachmentPayload[],
  signal: AbortSignal,
  callbacks: SseCallbacks,
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      agentId,
      sessionId: sessionKey,
      attachments: attachments.map((a) => ({
        type: "image",
        mimeType: a.mimeType,
        content: a.dataUrl.replace(/^data:[^;]+;base64,/, ""),
      })),
    }),
    signal,
  });

  if (!res.ok || !res.body) {
    if (res.status === 401) {
      window.location.href = "/login.html";
      return { ok: false, error: "Unauthorized" };
    }
    return { ok: false, error: "Could not connect to gateway" };
  }

  // Read SSE stream
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let accumulated = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) {
        continue;
      }
      try {
        const event = JSON.parse(line.slice(6)) as Record<string, unknown>;
        const type = event.type as string;

        if (type === "delta") {
          const delta = event.delta as string;
          // Delta may be full accumulated text or incremental
          if (delta.length >= accumulated.length) {
            accumulated = delta;
          } else {
            accumulated += delta;
          }
          callbacks.onDelta(accumulated);
        } else if (type === "model_change" || type === "model") {
          const modelId = (event.modelId || event.model || "") as string;
          if (modelId) {
            callbacks.onModelChange(modelId);
          }
        } else if (type === "done") {
          callbacks.onDone(accumulated || null);
        } else if (type === "error") {
          callbacks.onError((event.error as string) || "Unknown error");
        }
        // tool_start / tool_end — stream handles these visually
      } catch {
        /* malformed event */
      }
    }
  }

  return { ok: true };
}

/** Send abort signal to the backend */
export async function abortChat(agentId: string, sessionKey: string): Promise<void> {
  try {
    await fetch("/api/chat/abort", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, sessionId: sessionKey }),
    });
  } catch {
    /* empty */
  }
}

/** Request a new session from the backend */
export async function createNewSession(agentId: string, sessionKey: string): Promise<void> {
  try {
    await fetch("/api/chat/new", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, sessionId: sessionKey }),
    });
  } catch {
    /* empty */
  }
}

/** Group available models by provider prefix for display */
export function groupModelsByProvider(models: AvailableModel[]): Map<string, AvailableModel[]> {
  const groups = new Map<string, AvailableModel[]>();
  for (const m of models) {
    const provider = m.id.split("/")[0] || "other";
    if (!groups.has(provider)) {
      groups.set(provider, []);
    }
    groups.get(provider)!.push(m);
  }
  return groups;
}

export const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  "openai-codex": "Codex (ChatGPT)",
  openrouter: "OpenRouter",
};
