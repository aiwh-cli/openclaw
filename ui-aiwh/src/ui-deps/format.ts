/**
 * Format utilities for the AIWH chat UI.
 * Inlines simple implementations to avoid deep src/ dependencies.
 * Original: openclaw/ui/src/ui/format.ts
 */

// Inline: formatDurationHuman from src/infra/format-time/format-duration.ts
export function formatDurationHuman(ms: number): string {
  if (ms < 1000) {return `${Math.round(ms)}ms`;}
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {return `${seconds}s`;}
  const minutes = Math.floor(seconds / 60);
  const remainSec = seconds % 60;
  if (minutes < 60) {return remainSec > 0 ? `${minutes}m ${remainSec}s` : `${minutes}m`;}
  const hours = Math.floor(minutes / 60);
  const remainMin = minutes % 60;
  return remainMin > 0 ? `${hours}h ${remainMin}m` : `${hours}h`;
}

// Inline: formatRelativeTimestamp from src/infra/format-time/format-relative.ts
export function formatRelativeTimestamp(date: Date | number | string): string {
  const now = Date.now();
  const then = typeof date === "number" ? date : new Date(date).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 5) {return "just now";}
  if (diffSec < 60) {return `${diffSec}s ago`;}
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {return `${diffMin}m ago`;}
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) {return `${diffHr}h ago`;}
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) {return `${diffDay}d ago`;}
  return new Date(then).toLocaleDateString();
}

// Inline: stripAssistantInternalScaffolding — removes <think> tags and metadata
function stripAssistantInternalScaffolding(value: string): string {
  return value.replace(/<\s*think(?:ing)?\s*>[\s\S]*?<\s*\/\s*think(?:ing)?\s*>/gi, "").trim();
}

// Stub: t() i18n — returns the fallback key for now
function t(key: string): string {
  const fallbacks: Record<string, string> = {
    "common.na": "N/A",
  };
  return fallbacks[key] ?? key;
}

export function formatMs(ms?: number | null): string {
  if (!ms && ms !== 0) {
    return t("common.na");
  }
  return new Date(ms).toLocaleString();
}

export function formatList(values?: Array<string | null | undefined>): string {
  if (!values || values.length === 0) {
    return "none";
  }
  return values.filter((v): v is string => Boolean(v && v.trim())).join(", ");
}

export function clampText(value: string, max = 120): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}

export function truncateText(
  value: string,
  max: number,
): {
  text: string;
  truncated: boolean;
  total: number;
} {
  if (value.length <= max) {
    return { text: value, truncated: false, total: value.length };
  }
  return {
    text: value.slice(0, Math.max(0, max)),
    truncated: true,
    total: value.length,
  };
}

export function toNumber(value: string, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function parseList(input: string): string[] {
  return input
    .split(/[,\n]/)
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

export function stripThinkingTags(value: string): string {
  return stripAssistantInternalScaffolding(value);
}

export function formatCost(cost: number | null | undefined, fallback = "$0.00"): string {
  if (cost == null || !Number.isFinite(cost)) {
    return fallback;
  }
  if (cost === 0) {
    return "$0.00";
  }
  if (cost < 0.01) {
    return `$${cost.toFixed(4)}`;
  }
  if (cost < 1) {
    return `$${cost.toFixed(3)}`;
  }
  return `$${cost.toFixed(2)}`;
}

export function formatTokens(tokens: number | null | undefined, fallback = "0"): string {
  if (tokens == null || !Number.isFinite(tokens)) {
    return fallback;
  }
  if (tokens < 1000) {
    return String(Math.round(tokens));
  }
  if (tokens < 1_000_000) {
    const k = tokens / 1000;
    return k < 10 ? `${k.toFixed(1)}k` : `${Math.round(k)}k`;
  }
  const m = tokens / 1_000_000;
  return m < 10 ? `${m.toFixed(1)}M` : `${Math.round(m)}M`;
}

export function formatPercent(value: number | null | undefined, fallback = "—"): string {
  if (value == null || !Number.isFinite(value)) {
    return fallback;
  }
  return `${(value * 100).toFixed(1)}%`;
}
