import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { renderChannels } from '@openclaw/ui/views/channels.ts';
import type { ChannelsProps } from '@openclaw/ui/views/channels.types.ts';
import type { ChannelsStatusSnapshot } from '@openclaw/ui/types.ts';
import { GatewayBrowserClient } from '@openclaw/ui/gateway.ts';
import { getGatewayClient } from './gateway-client.js';

@customElement('channel-panel')
export class ChannelPanel extends LitElement {
  @state() private connected = false;
  @state() private loading = true;
  @state() private snapshot: ChannelsStatusSnapshot | null = null;
  @state() private lastError: string | null = null;
  @state() private lastSuccessAt: number | null = null;

  // WhatsApp state
  @state() private whatsappMessage: string | null = null;
  @state() private whatsappQrDataUrl: string | null = null;
  @state() private whatsappConnected: boolean | null = null;
  @state() private whatsappBusy = false;

  // Config state
  @state() private configSchema: unknown = null;
  @state() private configSchemaLoading = false;
  @state() private configForm: Record<string, unknown> | null = null;
  @state() private configUiHints: Record<string, unknown> = {};
  @state() private configSaving = false;
  @state() private configFormDirty = false;

  // Nostr profile state
  @state() private nostrProfileFormState: unknown = null;
  @state() private nostrProfileAccountId: string | null = null;

  private client: GatewayBrowserClient | null = null;

  static styles = css`
    :host { display: block; }
  `;

  connectedCallback() {
    super.connectedCallback();
    this._init();

    // Handle events from OpenClaw's renderChannels() — replaces vanilla JS channels.js wiring
    this.addEventListener('channel-remove', ((e: CustomEvent) => {
      this._removeChannel(e.detail.channel, e.detail.accountId);
    }) as EventListener);
    this.addEventListener('channel-settings', ((e: CustomEvent) => {
      if (typeof (window as any).openChannelSettings === 'function') {
        (window as any).openChannelSettings(e.detail.channel);
      }
    }) as EventListener);
  }

  private async _init() {
    this.client = await getGatewayClient();
    this.connected = true;
    this._loadChannels();
    this._loadConfigSchema();
    this._loadConfigForm();
  }

  private async _loadChannels(probe = false) {
    if (!this.client?.connected) {return;}
    this.loading = true;
    try {
      const result = await this.client.request<ChannelsStatusSnapshot>(
        'channels.status',
        probe ? { probe: true, timeoutMs: 10000 } : {}
      );
      this.snapshot = result;
      this.lastError = null;
      this.lastSuccessAt = Date.now();
    } catch (e: unknown) {
      this.lastError = e instanceof Error ? e.message : 'Failed to load channels';
    } finally {
      this.loading = false;
    }
  }

  private async _loadConfigSchema() {
    if (!this.client?.connected) {return;}
    this.configSchemaLoading = true;
    try {
      const result = await this.client.request<any>('config.schema', {});
      const schema = result?.schema;
      this.configSchema = schema || null;
      this.configUiHints = result?.uiHints || {};
    } catch (e) {
      console.warn('[channel-panel] Schema load failed:', e);
    }
    finally { this.configSchemaLoading = false; }
  }

  private configHash = '';

  private async _loadConfigForm() {
    if (!this.client?.connected) {return;}
    try {
      const result = await this.client.request<any>('config.get', {});
      this.configForm = result?.config || {};
      this.configHash = result?.hash || '';
    } catch { /* ignore */ }
  }

  private _buildProps(): ChannelsProps {
    return {
      connected: this.connected,
      loading: this.loading,
      snapshot: this.snapshot,
      lastError: this.lastError,
      lastSuccessAt: this.lastSuccessAt,
      whatsappMessage: this.whatsappMessage,
      whatsappQrDataUrl: this.whatsappQrDataUrl,
      whatsappConnected: this.whatsappConnected,
      whatsappBusy: this.whatsappBusy,
      configSchema: this.configSchema,
      configSchemaLoading: this.configSchemaLoading,
      configForm: this.configForm,
      configUiHints: this.configUiHints as any,
      configSaving: this.configSaving,
      configFormDirty: this.configFormDirty,
      nostrProfileFormState: this.nostrProfileFormState as any,
      nostrProfileAccountId: this.nostrProfileAccountId,
      onRefresh: (probe: boolean) => this._loadChannels(probe),
      onWhatsAppStart: (force: boolean) => this._whatsAppStart(force),
      onWhatsAppWait: () => this._whatsAppWait(),
      onWhatsAppLogout: () => this._whatsAppLogout(),
      onConfigPatch: (path: Array<string | number>, value: unknown) => {
        if (!this.configForm) {this.configForm = {};}
          // Apply patch at path — create intermediate objects as needed
        let target: any = this.configForm;
        for (let i = 0; i < path.length - 1; i++) {
          if (!target[path[i]] || typeof target[path[i]] !== 'object') {target[path[i]] = {};}
          target = target[path[i]];
        }
        target[path[path.length - 1]] = value;
        this.configFormDirty = true;
        this.requestUpdate();
      },
      onConfigSave: () => this._saveConfig(),
      onConfigReload: () => {
        this._loadConfigSchema();
        this._loadConfigForm();
      },
      onNostrProfileEdit: () => {},
      onNostrProfileCancel: () => { this.nostrProfileFormState = null; },
      onNostrProfileFieldChange: () => {},
      onNostrProfileSave: () => {},
      onNostrProfileImport: () => {},
      onNostrProfileToggleAdvanced: () => {},
    };
  }

  private async _whatsAppStart(force: boolean) {
    if (!this.client?.connected) {return;}
    this.whatsappBusy = true;
    try {
      const result = await this.client.request<any>('web.login.start', { force, timeoutMs: 30000 });
      if (result?.qrDataUrl) {this.whatsappQrDataUrl = result.qrDataUrl;}
      if (result?.message) {this.whatsappMessage = result.message;}
    } catch (e: unknown) {
      this.whatsappMessage = e instanceof Error ? e.message : 'Failed';
    } finally { this.whatsappBusy = false; }
  }

  private async _whatsAppWait() {
    if (!this.client?.connected) {return;}
    this.whatsappBusy = true;
    try {
      const result = await this.client.request<any>('web.login.wait', { timeoutMs: 120000 });
      this.whatsappMessage = result?.message || 'Connected!';
      this.whatsappQrDataUrl = null;
      this._loadChannels();
    } catch (e: unknown) {
      this.whatsappMessage = e instanceof Error ? e.message : 'Timeout';
    } finally { this.whatsappBusy = false; }
  }

  private async _whatsAppLogout() {
    if (!this.client?.connected) {return;}
    this.whatsappBusy = true;
    try {
      await this.client.request('channels.logout', { channel: 'whatsapp' });
      this.whatsappMessage = 'Logged out.';
      this._loadChannels();
    } catch (e: unknown) {
      this.whatsappMessage = e instanceof Error ? e.message : 'Failed';
    } finally { this.whatsappBusy = false; }
  }

  private async _saveConfig() {
    if (!this.client?.connected || !this.configForm) {return;}
    this.configSaving = true;
    try {
      // Get fresh hash to avoid conflicts
      const configResult = await this.client.request<any>('config.get', {});
      const baseHash = configResult?.hash || this.configHash;
      const result = await this.client.request('config.patch', {
        raw: JSON.stringify(this.configForm),
        baseHash,
      });
      void result;
      this.configFormDirty = false;
      this._loadChannels();
      this._loadConfigForm();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[channel-panel] Config save FAILED:', msg);
    }
    finally { this.configSaving = false; }
  }

  private _showAddChannel() {
    // Call vanilla JS handler directly (channels-setup.js — Phase 3)
    if (typeof (window as any).showChannelPicker === 'function') {
      (window as any).showChannelPicker();
    }
  }

  private _esc(s: string): string {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  private async _removeChannel(channel: string, accountId: string) {
    const safe = `${this._esc(channel)}/${this._esc(accountId)}`;
    const confirmFn = (window as any).dashConfirm || window.confirm;
    const confirmed = await confirmFn(`Remove ${safe}? This deletes the channel config.`);
    if (!confirmed) {return;}
    try {
      const res = await fetch('/api/channels/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, account: accountId }),
      });
      if (!res.ok) { (window as any).showToast?.(`HTTP ${res.status}`, 'error'); return; }
      const r = await res.json();
      if (r?.ok) {
        (window as any).showToast?.(`${safe} removed`, 'success');
        this._loadChannels();
      } else {
        (window as any).showToast?.(this._esc(r?.error) || 'Failed', 'error');
      }
    } catch {
      (window as any).showToast?.('Remove failed', 'error');
    }
  }

  render() {
    return html`
      <link rel="stylesheet" href="/openclaw-theme-map.css">
      <link rel="stylesheet" href="/openclaw-styles/components.css">
      <link rel="stylesheet" href="/openclaw-styles/layout.css">
      <link rel="stylesheet" href="/openclaw-styles/config.css">
      <div style="display:flex;justify-content:flex-end;margin-bottom:12px">
        <button class="btn primary" @click=${() => this._showAddChannel()} style="padding:8px 16px;font-size:13px">+ Add Channel</button>
      </div>
      ${renderChannels(this._buildProps())}
    `;
  }
}

// ── chIcon bridge for Phase 3 vanilla JS files (channels-setup.js, channels-config.js) ──
const CH_ICONS: Record<string, string> = {
  discord:  '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M13.5 3.5a13 13 0 00-3.2-1l-.15.3a12 12 0 00-4.3 0l-.14-.3a13 13 0 00-3.2 1A14 14 0 00.5 12.5a13 13 0 004 2l.5-.7c-.5-.2-.9-.4-1.4-.7l.3-.25a9.2 9.2 0 008.2 0l.3.25c-.4.3-.9.5-1.4.7l.5.7a13 13 0 004-2A14 14 0 002.5 3.5zM5.8 10.8c-.7 0-1.3-.7-1.3-1.5s.6-1.5 1.3-1.5 1.3.7 1.3 1.5-.6 1.5-1.3 1.5zm4.4 0c-.7 0-1.3-.7-1.3-1.5s.6-1.5 1.3-1.5 1.3.7 1.3 1.5-.6 1.5-1.3 1.5z"/></svg>',
  telegram: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M14.8 1.5L1.3 6.5c-.9.4-.9 1 0 1.2l3.5 1.1 1.3 4.2c.2.4.5.5.8.3l1.9-1.6 3.6 2.7c.7.4 1.2.2 1.4-.6l2.4-11.2c.2-1-.4-1.4-1.4-1.1z"/></svg>',
  slack:    '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M3.5 9.5a1.5 1.5 0 110-3h3v3a1.5 1.5 0 01-3 0zm1.5-5a1.5 1.5 0 113 0v3h-3a1.5 1.5 0 010-3zm5 1.5a1.5 1.5 0 110 3h-3v-3a1.5 1.5 0 013 0zm-1.5 5a1.5 1.5 0 11-3 0v-3h3a1.5 1.5 0 010 3z"/></svg>',
  whatsapp: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 00-6 10.5L1 15l3.6-1A7 7 0 108 1zm3.5 9.7c-.15.4-1 .8-1.4.9s-.6.1-1.1-.1c-.4-.2-1.7-.7-3.3-2.1-1.2-1.1-2-2.5-2.3-2.9s0-.7.2-.9l.5-.5c.1-.2.2-.3.3-.5s0-.3 0-.5l-.8-2c-.2-.5-.4-.4-.6-.4h-.5s-.4 0-.6.3c-.2.3-.9.9-.9 2.1s.9 2.5 1 2.6c.1.2 1.8 3 4.5 4.1.6.3 1.1.4 1.5.6s1 .2 1.4.1c.4-.1 1.3-.5 1.5-1s.2-1 .1-1l-.5-.3z"/></svg>',
  signal:   '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5.5 8.5l2 2 3-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>',
  imessage: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 2C4.13 2 1 4.69 1 8c0 1.7.87 3.22 2.24 4.27L2.5 14.5l2.72-1.36C6.06 13.7 7 14 8 14c3.87 0 7-2.69 7-6S11.87 2 8 2z"/></svg>',
  googlechat: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M2 3h12v8H6l-4 3V3z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  nostr:    '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="2" fill="currentColor"/></svg>',
};
function chIcon(ch: string): string {
  return CH_ICONS[ch] || '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
}
(window as any).chIcon = chIcon;

declare global {
  interface HTMLElementTagNameMap {
    'channel-panel': ChannelPanel;
  }
}
