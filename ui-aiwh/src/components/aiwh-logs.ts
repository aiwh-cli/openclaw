import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';

interface LogFile {
  id: string; label: string; exists: boolean; size?: number;
}

@customElement('aiwh-logs')
export class AiwhLogs extends LitElement {
  @state() private files: LogFile[] = [];
  @state() private activeId = '';
  @state() private lines: string[] = [];
  @state() private loading = false;
  @state() private filterText = '';
  @state() private autoFollow = true;
  private socket: any = null;

  static styles = css`
    :host { display: block; font-family: 'Inter', -apple-system, sans-serif; color: var(--text-primary, #F5EDD6); }

    .tabs { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 12px; }
    .tab {
      padding: 6px 12px; font-size: 12px; font-weight: 500; border-radius: 6px;
      cursor: pointer; border: 1px solid rgba(201,168,76,0.08); background: none;
      color: var(--text-muted, #8A8578); transition: all 150ms; white-space: nowrap;
    }
    .tab:hover { border-color: rgba(201,168,76,0.20); color: var(--text-primary, #F5EDD6); }
    .tab.active { border-color: var(--magenta, #C9A84C); background: rgba(201,168,76,0.10); color: var(--magenta, #C9A84C); }
    .tab:disabled { opacity: 0.3; cursor: not-allowed; }
    .tab-size { font-size: 10px; color: var(--text-muted, #8A8578); margin-left: 4px; font-family: 'JetBrains Mono', monospace; }

    .toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
    .search {
      flex: 1; max-width: 300px; padding: 6px 10px; font-size: 12px;
      background: rgba(14,14,18,0.5); color: var(--text-primary, #F5EDD6);
      border: 1px solid rgba(201,168,76,0.08); border-radius: 6px;
      font-family: 'Inter', sans-serif;
    }
    .search:focus { outline: none; border-color: var(--magenta, #C9A84C); }
    .search::placeholder { color: var(--text-muted, #8A8578); }
    .btn {
      padding: 5px 10px; font-size: 11px; font-weight: 500; border-radius: 5px;
      cursor: pointer; border: 1px solid rgba(201,168,76,0.10); background: none;
      color: var(--text-muted, #8A8578); transition: all 150ms; font-family: 'Inter', sans-serif;
    }
    .btn:hover { border-color: rgba(201,168,76,0.25); color: var(--text-primary, #F5EDD6); }
    .btn.active { border-color: var(--magenta, #C9A84C); color: var(--magenta, #C9A84C); }

    .output {
      font-family: 'JetBrains Mono', monospace; font-size: 11px; line-height: 1.7;
      background: rgba(10,10,15,0.6); color: var(--text-muted, #8A8578);
      padding: 12px; border-radius: 8px; max-height: 500px; overflow: auto;
      border: 1px solid rgba(201,168,76,0.06);
    }
    .line { padding: 1px 0; white-space: pre-wrap; word-break: break-all; }
    .line:hover { background: rgba(201,168,76,0.03); }
    .line.match { background: rgba(201,168,76,0.06); }
    .empty { text-align: center; padding: 32px; color: var(--text-muted, #8A8578); font-size: 13px; }
    .loading { text-align: center; padding: 24px; color: var(--text-muted, #8A8578); }

    :host-context([data-theme="light"]) .output { background: rgba(248,248,252,0.9); color: #444466; }
    :host-context([data-theme="light"]) .search { background: rgba(240,241,245,0.8); color: #1a1a2e; }
  `;

  connectedCallback() {
    super.connectedCallback();
    this._loadFiles();
    // Listen for live log lines via the global socket
    if ((window as any).io) {
      this.socket = (window as any).io();
      this.socket.on('log_line', (data: any) => {
        if (data.logId === this.activeId) {this._appendLine(data.line);}
      });
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.socket?.disconnect();
  }

  private async _loadFiles() {
    try {
      const res = await fetch('/api/logs/list');
      this.files = await res.json();
      if (this.files.length && !this.activeId) {
        const first = this.files.find(f => f.exists);
        if (first) {this._select(first.id);}
      }
    } catch { /* ignore */ }
  }

  private async _select(id: string) {
    this.activeId = id;
    this.lines = [];
    this.loading = true;
    try {
      const res = await fetch(`/api/logs/${id}?lines=300`);
      const data = await res.json();
      this.lines = data.lines || [];
    } catch { this.lines = ['Failed to load log']; }
    finally { this.loading = false; this._scrollBottom(); }
  }

  private _appendLine(line: string) {
    this.lines = [...this.lines.slice(-499), line];
    if (this.autoFollow) {this._scrollBottom();}
  }

  private _scrollBottom() {
    requestAnimationFrame(() => {
      const el = this.renderRoot.querySelector('.output');
      if (el && this.autoFollow) {el.scrollTop = el.scrollHeight;}
    });
  }

  private _strip(str: string): string {
    return str.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
  }

  private _formatSize(b?: number): string {
    if (!b) {return '';}
    if (b < 1024) {return b + ' B';}
    if (b < 1048576) {return (b / 1024).toFixed(1) + ' KB';}
    return (b / 1048576).toFixed(1) + ' MB';
  }

  private _export() {
    const blob = new Blob([this.lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${this.activeId}-${new Date().toISOString().split('T')[0]}.log`;
    a.click(); URL.revokeObjectURL(url);
  }

  render() {
    const filter = this.filterText.toLowerCase();
    const filtered = filter
      ? this.lines.filter(l => l.toLowerCase().includes(filter))
      : this.lines;

    return html`
      <div class="tabs">
        ${this.files.map(f => html`
          <button class="tab ${f.id === this.activeId ? 'active' : ''}"
            ?disabled=${!f.exists} @click=${() => f.exists && this._select(f.id)}>
            ${f.label}${f.size ? html`<span class="tab-size">${this._formatSize(f.size)}</span>` : nothing}
          </button>
        `)}
      </div>
      <div class="toolbar">
        <input class="search" type="text" placeholder="Filter logs..."
          .value=${this.filterText} @input=${(e: Event) => { this.filterText = (e.target as HTMLInputElement).value; }}>
        <button class="btn ${this.autoFollow ? 'active' : ''}"
          @click=${() => { this.autoFollow = !this.autoFollow; }}>
          Auto-follow: ${this.autoFollow ? 'ON' : 'OFF'}
        </button>
        <button class="btn" @click=${() => { this.lines = []; }}>Clear</button>
        <button class="btn" @click=${() => this._export()}>Export</button>
        <button class="btn" @click=${() => this._select(this.activeId)}>Refresh</button>
      </div>
      ${this.loading ? html`<div class="loading">Loading...</div>` :
        filtered.length ? html`
          <div class="output">
            ${filtered.map(line => html`
              <div class="line ${filter && line.toLowerCase().includes(filter) ? 'match' : ''}">${this._strip(line)}</div>
            `)}
          </div>
        ` : html`<div class="empty">${this.lines.length ? 'No lines match filter' : 'Log is empty'}</div>`
      }
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap { 'aiwh-logs': AiwhLogs; }
}
