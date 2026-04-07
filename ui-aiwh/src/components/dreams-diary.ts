import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';

interface DiaryEntry { date: string; body: string; }

const DIARY_START = /<!--\s*openclaw:dreaming:diary:start\s*-->/;
const DIARY_END = /<!--\s*openclaw:dreaming:diary:end\s*-->/;

function parseDiaryEntries(raw: string): DiaryEntry[] {
  let content = raw;
  const s = DIARY_START.exec(raw);
  const e = DIARY_END.exec(raw);
  if (s && e && e.index > s.index) {content = raw.slice(s.index + s[0].length, e.index);}
  const entries: DiaryEntry[] = [];
  for (const block of content.split(/\n---\n/).filter(b => b.trim())) {
    let date = '';
    const body: string[] = [];
    for (const line of block.trim().split('\n')) {
      const t = line.trim();
      if (!date && t.startsWith('*') && t.endsWith('*') && t.length > 2) { date = t.slice(1, -1); continue; }
      if (t.startsWith('#') || t.startsWith('<!--')) {continue;}
      if (t) {body.push(t);}
    }
    if (body.length) {entries.push({ date, body: body.join('\n') });}
  }
  return entries;
}

@customElement('dreams-diary')
export class DreamsDiary extends LitElement {
  @state() private entries: DiaryEntry[] = [];
  @state() private loading = true;
  @state() private error = '';
  @state() private page = 0;

  static styles = css`
    :host { display: block; font-family: 'Inter', -apple-system, sans-serif; color: var(--text-primary, #F5EDD6); }
    .entry { padding: 10px 0; border-bottom: 1px solid rgba(201,168,76,0.06); }
    .entry:last-child { border-bottom: none; }
    .date { font-size: 10px; color: #C9A84C; font-weight: 500; margin-bottom: 4px; }
    .body { font-size: 12px; line-height: 1.5; white-space: pre-wrap; }
    .nav { display: flex; justify-content: center; align-items: center; gap: 12px; margin-top: 8px; }
    .nav button {
      padding: 3px 10px; font-size: 11px; border-radius: 5px; cursor: pointer;
      border: 1px solid rgba(201,168,76,0.12); background: none;
      color: var(--text-muted, #8A8578); font-family: inherit;
    }
    .nav button:hover:not(:disabled) { border-color: rgba(201,168,76,0.25); color: var(--text-primary, #F5EDD6); }
    .nav button:disabled { opacity: 0.3; cursor: default; }
    .counter { font-size: 10px; color: var(--text-muted, #8A8578); font-family: 'JetBrains Mono', monospace; }
    .empty { font-size: 12px; color: var(--text-muted, #8A8578); padding: 8px 0; }
  `;

  connectedCallback() { super.connectedCallback(); this._load(); }

  private async _load() {
    this.loading = true;
    try {
      const res = await fetch('/api/knowledge/dreams/diary');
      const data = await res.json();
      this.entries = data.content ? parseDiaryEntries(data.content) : [];
    } catch (e: unknown) {
      this.error = e instanceof Error ? e.message : 'Failed to load';
    }
    this.loading = false;
  }

  render() {
    if (this.loading) {return html`<div class="empty">Loading diary...</div>`;}
    if (this.error) {return html`<div class="empty" style="color:#E05252">${this.error}</div>`;}
    if (!this.entries.length) {return html`<div class="empty">No diary entries yet. Give it a night or two.</div>`;}

    const entry = this.entries[this.page];
    const total = this.entries.length;
    return html`
      ${entry ? html`
        <div class="entry">
          ${entry.date ? html`<div class="date">${entry.date}</div>` : nothing}
          <div class="body">${entry.body}</div>
        </div>
      ` : nothing}
      ${total > 1 ? html`
        <nav class="nav">
          <button ?disabled=${this.page <= 0} @click=${() => { this.page--; }}>Newer</button>
          <span class="counter">${this.page + 1} / ${total}</span>
          <button ?disabled=${this.page >= total - 1} @click=${() => { this.page++; }}>Older</button>
        </nav>
      ` : nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap { 'dreams-diary': DreamsDiary; }
}
