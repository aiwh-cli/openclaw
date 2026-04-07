/**
 * Type definitions for the AIWH chat UI.
 * Slimmed from openclaw/ui/src/ui/types.ts — only types used by chat.
 * Deep imports (session-types, config-ui-hints, cron) stubbed inline.
 */

// Stub: SessionRunStatus from session-types
export type SessionRunStatus = "idle" | "running" | "paused" | "error" | "unknown";

// Stub: SessionsListResultBase from src/shared/session-types.js
type SessionsListResultBase<TDefaults, TRow> = {
  ts?: number;
  path?: string;
  count?: number;
  defaults?: TDefaults;
  sessions: TRow[];
};

// Stub: GatewaySessionsDefaults
export type GatewaySessionsDefaults = {
  model?: string;
  modelProvider?: string;
  thinkingLevel?: string;
  fastMode?: boolean;
};

export type GatewaySessionRow = {
  key: string;
  spawnedBy?: string;
  kind: "direct" | "group" | "global" | "unknown";
  label?: string;
  displayName?: string;
  surface?: string;
  subject?: string;
  room?: string;
  space?: string;
  updatedAt: number | null;
  sessionId?: string;
  systemSent?: boolean;
  abortedLastRun?: boolean;
  thinkingLevel?: string;
  fastMode?: boolean;
  verboseLevel?: string;
  reasoningLevel?: string;
  elevatedLevel?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  totalTokensFresh?: boolean;
  status?: SessionRunStatus;
  startedAt?: number;
  endedAt?: number;
  runtimeMs?: number;
  childSessions?: string[];
  model?: string;
  modelProvider?: string;
  contextTokens?: number;
};

export type SessionsListResult = SessionsListResultBase<GatewaySessionsDefaults, GatewaySessionRow>;

// Stub: SessionsPatchResultBase
type SessionsPatchResultBase<T> = {
  ok: boolean;
} & T;

export type SessionsPatchResult = SessionsPatchResultBase<{
  sessionId: string;
  updatedAt?: number;
  thinkingLevel?: string;
  fastMode?: boolean;
  verboseLevel?: string;
  reasoningLevel?: string;
  elevatedLevel?: string;
}> & {
  resolved?: {
    modelProvider?: string;
    model?: string;
  };
};

// Model catalog
export type ModelCatalogEntry = {
  id: string;
  name?: string;
  provider?: string;
  reasoning?: string;
  contextLength?: number;
  maxOutputTokens?: number;
};

// Agents list
export type AgentsListResult = {
  agents: Array<{
    id: string;
    name?: string;
    identity?: { name?: string; avatarUrl?: string };
  }>;
  defaultId?: string;
};

// Stub: ConfigUiHints — used in settings views, not chat
export type ConfigUiHint = {
  key: string;
  label?: string;
  description?: string;
};
export type ConfigUiHints = Record<string, ConfigUiHint>;
