import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { renderLogs, type LogsProps, type LogEntry, type LogLevel } from '@openclaw/ui/views/logs.ts';
import { GatewayBrowserClient } from '@openclaw/ui/gateway.ts';
import { getGatewayClient } from './gateway-client.js';

const ALL_LEVELS: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as LogLevel[];

@customElement('logs-panel')
export class LogsPanel extends LitElement {
  @state() private loading = true;
  @state() private error: string | null = null;
  @state() private connected = false;
  @state() private file: string | null = null;
  @state() private entries: LogEntry[] = [];
  @state() private filterText = '';
  @state() private levelFilters: Record<string, boolean> = {
    trace: false, debug: false, info: true, warn: true, error: true, fatal: true,
  };
  @state() private autoFollow = true;
  @state() private truncated = false;

  private client: GatewayBrowserClient | null = null;
  private pollTimer: number | null = null;

  static styles = css`:host { display: block; }`;

  connectedCallback() { super.connectedCallback(); this._init(); }
  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.pollTimer) {window.clearInterval(this.pollTimer);}
  }

  private async _init() {
    try {
      this.client = await getGatewayClient();
      this.connected = true;
      this._loadLogs();
      // Poll every 3 seconds for new logs
      this.pollTimer = window.setInterval(() => {
        if (this.autoFollow) {this._loadLogs();}
      }, 3000);
    } catch (e: unknown) {
      this.error = e instanceof Error ? e.message : 'Failed to connect';
      this.loading = false;
    }
  }

  private async _loadLogs() {
    if (!this.client?.connected) {return;}
    try {
      const result = await this.client.request<any>('logs.tail', {});
      this.file = result.file || null;
      this.truncated = result.truncated || false;
      // Parse log lines into entries
      const lines: string[] = result.lines || [];
      this.entries = lines.map((line: string) => this._parseLine(line)).filter(Boolean) as LogEntry[];
      this.loading = false;
    } catch (e: unknown) {
      if (this.loading) {
        this.error = e instanceof Error ? e.message : 'Failed to load logs';
        this.loading = false;
      }
    }
  }

  private _parseLine(line: string): LogEntry | null {
    try {
      const obj = JSON.parse(line);
      return {
        time: obj.time || obj.timestamp || obj.date,
        level: (obj.level || 'info').toLowerCase(),
        subsystem: obj.subsystem || obj.module || '',
        message: obj.message || obj.msg || line,
        raw: line,
      };
    } catch {
      // Plain text log line
      const level = /\berror\b/i.test(line) ? 'error' :
                    /\bwarn/i.test(line) ? 'warn' :
                    /\bdebug\b/i.test(line) ? 'debug' : 'info';
      return { time: '', level, subsystem: '', message: line, raw: line };
    }
  }

  private _export(lines: string[], label: string) {
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `logs-${label}-${new Date().toISOString().split('T')[0]}.txt`;
    a.click(); URL.revokeObjectURL(url);
  }

  render() {
    const props: LogsProps = {
      loading: this.loading,
      error: this.error,
      file: this.file,
      entries: this.entries,
      filterText: this.filterText,
      levelFilters: this.levelFilters as Record<LogLevel, boolean>,
      autoFollow: this.autoFollow,
      truncated: this.truncated,
      onFilterTextChange: (t) => { this.filterText = t; },
      onLevelToggle: (level, enabled) => {
        this.levelFilters = { ...this.levelFilters, [level]: enabled };
      },
      onToggleAutoFollow: (v) => { this.autoFollow = v; },
      onRefresh: () => this._loadLogs(),
      onExport: (lines, label) => this._export(lines, label),
      onScroll: () => {},
    };

    return html`
      <link rel="stylesheet" href="/openclaw-theme-map.css">
      <link rel="stylesheet" href="/openclaw-styles/components.css">
      <link rel="stylesheet" href="/openclaw-styles/layout.css">
      ${renderLogs(props)}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap { 'logs-panel': LogsPanel; }
}
