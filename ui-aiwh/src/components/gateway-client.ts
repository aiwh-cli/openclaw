// Shared gateway client — single WebSocket connection for all Lit components.

import { GatewayBrowserClient } from '@openclaw/ui/gateway.ts';

let _client: GatewayBrowserClient | null = null;
let _initPromise: Promise<GatewayBrowserClient> | null = null;
let _connected = false;

export async function getGatewayClient(): Promise<GatewayBrowserClient> {
  if (_client && _connected) {return _client;}
  if (_initPromise) {return _initPromise;}

  _initPromise = new Promise<GatewayBrowserClient>(async (resolve, reject) => {
    let gwUrl = `ws://${window.location.hostname}:18789`;
    let gwToken = '';
    try {
      const res = await fetch('/api/gateway-info');
      if (res.ok) {
        const info = await res.json();
        if (info.url) {gwUrl = info.url;}
        if (info.token) {gwToken = info.token;}
      }
    } catch { /* defaults */ }

    // Timeout after 10s
    const timeout = window.setTimeout(() => {
      console.warn('[gateway-client] Connection timed out');
      _initPromise = null;
      reject(new Error('Gateway connection timed out'));
    }, 10000);

    _client = new GatewayBrowserClient({
      url: gwUrl,
      token: gwToken,
      mode: 'webchat' as any,
      instanceId: 'dashboard-ui',
      onHello: () => {
        window.clearTimeout(timeout);
        _connected = true;
        console.log('[gateway-client] Connected to gateway');
        resolve(_client);
      },
      onClose: () => {
        _connected = false;
        _initPromise = null;
        console.log('[gateway-client] Disconnected');
      },
    });
    _client.start();
  });

  return _initPromise;
}
