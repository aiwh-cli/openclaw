// ─── OpenClaw Gateway WebSocket Client ───────────────────────
// Implements the ACP (Agent Control Protocol) used by OpenClaw Gateway.
// The gateway ONLY accepts WebSocket — not HTTP REST.
//
// ACP message format:
//   Request: {type:"req", id:"<uuid>", method:"methodName", payload:{...}}
//   Response:{type:"res", id:"<uuid>", result:{...}} or {type:"res", id, error:{code,message}}
//   Event:   {type:"event", event:"stream"|"connect.challenge"|..., ...}
//
// Auth flow:
//   1. Connect WS → receive {type:"event", event:"connect.challenge", payload:{nonce:"..."}}
//   2. Send {type:"req", id, method:"connect", payload:{auth:{token:"..."}, ...}}
//   3. Receive {type:"res", id, result:{...}} → connected

const WebSocket = require('ws');
const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');

const GATEWAY_URL = 'ws://127.0.0.1:18789';

let _config = null;
function loadConfig() {
  if (_config) return _config;
  try {
    _config = JSON.parse(fs.readFileSync(path.join(__dirname, 'dashboard.config.json'), 'utf8'));
  } catch {
    _config = { gateway: { url: 'http://127.0.0.1:18789', token: '' } };
  }
  return _config;
}

function getWsUrl() {
  const cfg = loadConfig();
  return (cfg.gateway?.url || 'http://127.0.0.1:18789').replace(/^http/, 'ws');
}
function getToken() {
  const token = loadConfig().gateway?.token || '';
  if (token) return token;
  // Fallback: read from openclaw.json (fresh client — gateway generates token on first boot)
  try {
    const stateDir = process.env.OPENCLAW_STATE_DIR || '/opt/AIWH/.openclaw';
    const ocCfg = JSON.parse(fs.readFileSync(path.join(stateDir, 'openclaw.json'), 'utf8'));
    return ocCfg.gateway?.auth?.token || '';
  } catch { return ''; }
}

class GatewayClient {
  constructor() {
    this.ws = null;
    this.connected = false;
    this.connecting = false;
    this._reqId = 1;
    this._pending = new Map();    // id -> {resolve, reject, timeout}
    this._streamHandlers = new Map(); // sessionKey -> [handler, ...]
    this._reconnectDelay = 1000;
    this._maxReconnectDelay = 30000;
    this._nonce = null;
  }

  // ── Public API ────────────────────────────────────────────

  /**
   * Ensure connected, then resolve. Rejects after timeout.
   */
  async ensureConnected(timeoutMs = 8000) {
    if (this.connected) return;
    if (!this.connecting) this._connect();

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Gateway connection timeout')), timeoutMs);
      const check = setInterval(() => {
        if (this.connected) { clearInterval(check); clearTimeout(timer); resolve(); }
      }, 100);
    });
  }

  /**
   * Send a request to the gateway and wait for its response.
   */
  async request(method, payload, timeoutMs = 30000) {
    await this.ensureConnected();
    const id = String(this._reqId++);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`Request ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this._pending.set(id, {
        resolve: (result) => { clearTimeout(timer); resolve(result); },
        reject:  (err)    => { clearTimeout(timer); reject(err); },
      });

      this._send({ type: 'req', id, method, params: payload });
    });
  }

  /**
   * Register a handler for stream events on a session key.
   * Returns an unsubscribe function.
   */
  onStream(sessionKey, handler) {
    if (!this._streamHandlers.has(sessionKey)) {
      this._streamHandlers.set(sessionKey, []);
    }
    this._streamHandlers.get(sessionKey).push(handler);
    return () => {
      const handlers = this._streamHandlers.get(sessionKey) || [];
      this._streamHandlers.set(sessionKey, handlers.filter(h => h !== handler));
    };
  }

  // ── Connection ────────────────────────────────────────────

  _connect() {
    if (this.connecting || this.connected) return;
    this.connecting = true;

    const wsUrl = getWsUrl();
    let ws;
    try {
      // Origin header required: gateway validates origin matches the gateway host
      ws = new WebSocket(wsUrl, { headers: { Origin: wsUrl.replace(/^ws/, 'http') } });
    } catch (e) {
      console.error('[gateway-ws] WS init error:', e.message);
      this.connecting = false;
      this._scheduleReconnect();
      return;
    }

    this.ws = ws;

    ws.on('open', () => {
      // Wait for connect.challenge event before sending auth
    });

    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      // Debug: log all event types received from gateway
      if (msg.type === 'event' && msg.event !== 'connect.challenge') {
        console.log(`[gateway-ws] RAW event: ${msg.event} sessionKey=${msg.payload?.sessionKey || msg.sessionKey || 'none'}`);
      }
      this._handleMessage(msg);
    });

    ws.on('close', (code, reason) => {
      console.log(`[gateway-ws] Disconnected (${code}): ${reason}`);
      this.connected = false;
      this.connecting = false;
      this.ws = null;
      this._nonce = null;

      // Reject all pending requests
      for (const [, cb] of this._pending) cb.reject(new Error('Gateway disconnected'));
      this._pending.clear();

      this._scheduleReconnect();
    });

    ws.on('error', (err) => {
      console.error('[gateway-ws] WS error:', err.message);
    });
  }

  _scheduleReconnect() {
    setTimeout(() => {
      if (!this.connected && !this.connecting) this._connect();
    }, this._reconnectDelay);

    this._reconnectDelay = Math.min(this._reconnectDelay * 1.5, this._maxReconnectDelay);
  }

  _send(obj) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  async _sendConnect() {
    const id = String(this._reqId++);
    const token = getToken();

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error('Connect handshake timed out'));
      }, 10000);

      this._pending.set(id, {
        resolve: (result) => {
          clearTimeout(timer);
          this.connected = true;
          this.connecting = false;
          this._reconnectDelay = 1000; // Reset backoff on success
          console.log('[gateway-ws] Connected to OpenClaw Gateway');
          resolve(result);
        },
        reject: (err) => {
          clearTimeout(timer);
          this.connecting = false;
          reject(err);
        },
      });

      this._send({
        type: 'req',
        id,
        method: 'connect',
        params: {
          minProtocol: 3,
          maxProtocol: 3,
          client: {
            id: 'node-host',
            version: '3.0',
            platform: 'node',
            mode: 'webchat',
            instanceId: 'dashboard-' + process.pid,
          },
          role: 'operator',
          scopes: ['operator.admin', 'operator.read', 'operator.write', 'operator.approvals'],
          auth: token ? { token } : undefined,
          caps: [],
        },
      });
    });
  }

  _handleMessage(msg) {
    if (msg.type === 'event') {
      const evt = msg;

      // Auth challenge
      if (evt.event === 'connect.challenge') {
        const nonce = evt.payload?.nonce || null;
        this._nonce = nonce;
        this._sendConnect().catch(e => {
          console.error('[gateway-ws] Connect handshake failed:', e.message);
          this.ws?.close();
        });
        return;
      }

      // Stream events — dispatch to session handlers
      // Gateway sends: 'stream' (legacy), 'chat' (text deltas/final), 'agent' (tool use/lifecycle), 'session.tool'
      if (evt.event === 'stream' || evt.event === 'chat' || evt.event === 'agent' || evt.event === 'session.tool') {
        const sessionKey = evt.sessionKey || evt.payload?.sessionKey;
        const state = evt.state || evt.payload?.state;
        if (evt.event !== 'stream') {
          console.log(`[gateway-ws] ${evt.event} event: sessionKey=${sessionKey} state=${state} subscribers=${[...this._streamHandlers.keys()].join(',')}`);
        } else {
          console.log(`[gateway-ws] stream event: sessionKey=${sessionKey} state=${state} subscribers=${[...this._streamHandlers.keys()].join(',')}`);
        }
        if (sessionKey) {
          let dispatched = 0;
          for (const [key, handlers] of this._streamHandlers) {
            if (sessionKey === key || sessionKey.startsWith(key)) {
              for (const h of handlers) {
                try { h(evt); dispatched++; } catch {}
              }
            }
          }
          // Also broadcast to wildcard handlers
          const wildcard = this._streamHandlers.get('*') || [];
          for (const h of wildcard) {
            try { h(evt); dispatched++; } catch {}
          }
          if (dispatched === 0) {
            console.log(`[gateway-ws] WARNING: ${evt.event} event for sessionKey="${sessionKey}" had no matching subscribers`);
          }
        }
        return;
      }

      return;
    }

    if (msg.type === 'res') {
      const cb = this._pending.get(msg.id);
      if (cb) {
        this._pending.delete(msg.id);
        if (msg.error) {
          // Explicit error field — reject
          cb.reject(new Error(msg.error?.message || 'Gateway error'));
        } else {
          // Resolve with payload if present, otherwise the full message.
          // The gateway only uses ok+payload for connect; other responses
          // (chat.send, chat.history, etc.) return data directly in the res message.
          cb.resolve(msg.payload !== undefined ? msg.payload : msg);
        }
      }
      return;
    }
  }
}

// Singleton instance
const _client = new GatewayClient();

// Start connecting immediately on module load
_client._connect();

module.exports = { GatewayClient, client: _client };
