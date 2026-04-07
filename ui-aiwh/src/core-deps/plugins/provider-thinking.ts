/**
 * Stub for provider-thinking.ts
 * The real implementation queries the plugin registry at runtime.
 * For the chat UI, we return safe defaults — thinking level display
 * works without real plugin resolution.
 */

type ProviderThinkingContext = {
  provider: string;
  context: { provider: string; modelId: string; reasoning?: unknown };
};

export function resolveProviderBinaryThinking(_params: ProviderThinkingContext): boolean | null {
  return null; // No plugin override — fallback to shared defaults
}

export function resolveProviderDefaultThinkingLevel(
  _params: ProviderThinkingContext,
): string | null {
  return null; // No plugin override — fallback to shared defaults
}

export function resolveProviderXHighThinking(_params: ProviderThinkingContext): boolean | null {
  return null; // No plugin override — fallback to shared defaults
}
