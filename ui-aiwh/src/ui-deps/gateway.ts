/**
 * Gateway client type stub for the AIWH dashboard chat.
 * The real gateway.ts (622 lines) is a full WebSocket client with device auth.
 * We only need the type interface since our chat host uses fetch() to Express.
 * Original: openclaw/ui/src/ui/gateway.ts
 */

export type GatewayEventFrame = {
  type: "event";
  event: string;
  payload?: unknown;
  seq?: number;
};

export type GatewayResponseFrame = {
  type: "res";
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: { code: string; message: string; details?: unknown };
};

export interface GatewayBrowserClient {
  request<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  subscribe(event: string, handler: (frame: GatewayEventFrame) => void): () => void;
  connected: boolean;
  sessionKey?: string;
}
