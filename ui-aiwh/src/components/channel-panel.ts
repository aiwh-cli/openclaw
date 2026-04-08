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

// ── chIcon — imported from shared channel-icons.ts ──
import { chIcon } from './channel-icons.js';

declare global {
  interface HTMLElementTagNameMap {
    'channel-panel': ChannelPanel;
  }
}
