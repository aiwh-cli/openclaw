import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import './social-upload-modal.js';

interface CalendarItem {
  job_id: string; topic: string; pillar: string; status: string;
  content_type: string; captions: Record<string, string> | null;
  image_path: string | null; scheduled_for_date: string | null;
  created_at: string; source: 'social' | 'cinematic';
  platform_targets: string | null;
}

const TYPE_LABELS: Record<string, string> = { video_reel: 'Video', cinematic: 'Cinematic', text_post: 'Text', image_post: 'Image' };
const PLAT_LABELS: Record<string, string> = { instagram: 'Instagram', x: 'X', linkedin: 'LinkedIn', tiktok: 'TikTok', facebook: 'Facebook' };

@customElement('social-hub-calendar')
export class SocialHubCalendar extends LitElement {
  @state() private items: CalendarItem[] = [];
  @state() private loading = true;
  @state() private filter = { content_type: '', status: 'published', platform: '' };
  @state() private showUpload = false;
  @state() private weekOffset = 0;
  @state() private popoverItem: CalendarItem | null = null;
  @state() private targetPlatforms: string[] = [];

  connectedCallback() { super.connectedCallback(); this._load(); }

  private async _load() {
    this.loading = true;
    try {
      const qs = new URLSearchParams();
      if (this.filter.content_type) {qs.set('content_type', this.filter.content_type);}
      if (this.filter.status) {qs.set('status', this.filter.status);}
      if (this.filter.platform) {qs.set('platform', this.filter.platform);}
      const data = await this._api(`/api/social-hub/calendar?${qs}`);
      this.items = data.items || [];
      if (data.target_platforms?.length) {this.targetPlatforms = data.target_platforms;}
    } catch (e) { console.error('[calendar]', e); }
    this.loading = false;
  }

  private async _api(url: string) {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) {return {};}
    const ct = res.headers.get('content-type') || '';
    return ct.includes('json') ? res.json() : {};
  }

  private get _weekDays(): { date: string; label: string; isToday: boolean }[] {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const monday = new Date(today);
    monday.setDate(today.getDate() - today.getDay() + 1 + this.weekOffset * 7);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday); d.setDate(monday.getDate() + i);
      const iso = d.toISOString().split('T')[0];
      return { date: iso, label: d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }),
        isToday: iso === today.toISOString().split('T')[0] };
    });
  }

  private _itemsForDate(date: string): CalendarItem[] {
    return this.items.filter(i => {
      const d = i.scheduled_for_date || i.created_at?.split('T')[0];
      return d === date;
    });
  }

  private _navigate(item: CalendarItem) {
    if (item.source === 'cinematic') {
      this.dispatchEvent(new CustomEvent('navigate-tab', { bubbles: true, composed: true, detail: { tab: 'review', jobId: item.job_id } }));
    } else if (['pending_review', 'captioning'].includes(item.status)) {
      this.dispatchEvent(new CustomEvent('navigate-tab', { bubbles: true, composed: true, detail: { tab: 'review', jobId: item.job_id } }));
    } else {
      this.popoverItem = item; // show read-only detail for posted/scheduled/approved
    }
  }

  private _createForDate(date: string) {
    this.dispatchEvent(new CustomEvent('navigate-tab', {
      bubbles: true, composed: true,
      detail: { tab: 'studio', date },
    }));
  }

  private _openJob(item: CalendarItem) {
    this._navigate(item);
  }

  static styles = css`
    :host { display: block; color: var(--text-primary); font-family: 'Inter', -apple-system, sans-serif; }
    .toolbar { display: flex; gap: 8px; margin-bottom: 14px; align-items: center; flex-wrap: wrap; }
    select { background: var(--surface-hi); color: var(--text-primary); border: 1px solid var(--border-dim);
      border-radius: 6px; padding: 5px 10px; font-size: 12px; }
    .btn { padding: 5px 12px; border-radius: 6px; font-size: 12px; font-weight: 500; cursor: pointer; border: none; }
    .btn-primary { background: var(--magenta); color: var(--void); }
    .btn-ghost { background: var(--surface-hi); color: var(--text-muted); border: 1px solid var(--border-dim); }
    .btn-ghost:hover { color: var(--text-primary); border-color: var(--border-hover); }
    .spacer { flex: 1; }
    .week-nav { display: flex; align-items: center; gap: 8px; font-size: 12px; }
    .week-nav button { background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 16px; padding: 2px 6px; }
    .week-nav button:hover { color: var(--text-primary); }

    .cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; }
    .cal-day { background: var(--surface); border: 1px solid var(--border-faint); border-radius: 8px;
      padding: 8px; min-height: 120px; }
    .cal-day.today { border-color: var(--magenta); }
    .cal-date { font-size: 11px; color: var(--text-muted); margin-bottom: 6px; font-weight: 600;
      display: flex; justify-content: space-between; align-items: center; }
    .cal-date.today { color: var(--magenta); }
    .cal-add { font-size: 10px; color: var(--text-dim); cursor: pointer; padding: 2px 6px;
      border-radius: 4px; font-weight: 600; opacity: 0; transition: opacity 150ms; }
    .cal-day:hover .cal-add { opacity: 1; }
    .cal-add:hover { color: var(--magenta); background: rgba(var(--magenta-rgb),0.1); }
    .cal-items { display: flex; flex-direction: column; gap: 3px; }

    .cal-item { font-size: 10px; padding: 4px 6px; border-radius: 4px; cursor: pointer;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; transition: opacity 120ms;
      display: flex; align-items: center; gap: 3px; }
    .cal-item:hover { opacity: 0.8; }
    /* Content type left-border */
    .cal-item.video_reel { border-left: 2px solid #8B5CF6; }
    .cal-item.cinematic { border-left: 2px solid #F97316; }
    .cal-item.text_post { border-left: 2px solid #0EA5E9; }
    .cal-item.image_post { border-left: 2px solid #10B981; }
    /* Status-based background */
    .cal-item.s-posted { background: rgba(var(--success-rgb, 74,222,128),0.12); color: var(--success, #4ade80); }
    .cal-item.s-scheduled { background: rgba(59,130,246,0.12); color: #3B82F6; }
    .cal-item.s-approved { background: rgba(59,130,246,0.08); color: #60A5FA; }
    .cal-item.s-draft { background: rgba(128,128,128,0.1); color: var(--text-muted); }
    .cal-item.s-pending_review { background: rgba(var(--amber-rgb, 245,158,11),0.12); color: var(--amber, #F59E0B); }
    .cal-item.s-generating, .cal-item.s-captioning { background: rgba(128,128,128,0.08); color: var(--text-dim); }
    .cal-item.s-failed { background: rgba(var(--critical-rgb, 224,82,82),0.12); color: var(--critical); }
    .cal-item.s-planned { background: rgba(var(--magenta-rgb, 201,168,76),0.1); color: var(--magenta); }
    .type-tag { font-size: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.3px; opacity: 0.8; flex-shrink: 0; }
    .item-topic { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .legend { display: flex; gap: 12px; margin-top: 10px; font-size: 10px; color: var(--text-muted); flex-wrap: wrap; }
    .legend-item { display: flex; align-items: center; gap: 4px; }
    .legend-swatch { width: 10px; height: 10px; border-radius: 2px; }
    .empty { text-align: center; padding: 20px; color: var(--text-dim); font-size: 11px; }
    .info-note { font-size: 9px; color: var(--text-dim); margin-top: 6px; text-align: center; }
    .popover { position: fixed; z-index: 999; background: var(--surface); border: 1px solid var(--border-dim);
      border-radius: 10px; padding: 14px; box-shadow: 0 8px 30px rgba(0,0,0,0.2); max-width: 320px; font-size: 12px; }
    .popover-title { font-weight: 600; margin-bottom: 6px; }
    .popover-row { display: flex; justify-content: space-between; padding: 3px 0; color: var(--text-muted); font-size: 11px; }
    .popover-close { position: absolute; top: 8px; right: 10px; cursor: pointer; color: var(--text-dim); background: none; border: none; font-size: 14px; }
  `;

  render() {
    if (this.loading && !this.items.length) {return html`<div class="empty" style="padding:40px">Loading calendar...</div>`;}
    const days = this._weekDays;

    return html`
      <div class="toolbar">
        <select @change=${(e: Event) => { this.filter = { ...this.filter, content_type: (e.target as HTMLSelectElement).value }; this._load(); }}>
          <option value="">All types</option>
          <option value="text_post">Text Posts</option>
          <option value="image_post">Image Posts</option>
          <option value="video_reel">Video Reels</option>
          <option value="cinematic">Cinematic</option>
        </select>
        <select .value=${this.filter.status} @change=${(e: Event) => { this.filter = { ...this.filter, status: (e.target as HTMLSelectElement).value }; this._load(); }}>
          <option value="published">Posted + Scheduled</option>
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="pending_review">Pending Review</option>
          <option value="posted">Posted only</option>
        </select>
        ${this.targetPlatforms.length ? html`
          <select .value=${this.filter.platform} @change=${(e: Event) => { this.filter = { ...this.filter, platform: (e.target as HTMLSelectElement).value }; this._load(); }}>
            <option value="">All platforms</option>
            ${this.targetPlatforms.map(p => html`<option value=${p}>${PLAT_LABELS[p] || p}</option>`)}
          </select>` : nothing}
        <div class="week-nav">
          <button @click=${() => { this.weekOffset--; }}>\u25C0</button>
          <span @click=${() => { this.weekOffset = 0; }} style="cursor:pointer">${this._weekLabel}</span>
          <button @click=${() => { this.weekOffset++; }}>\u25B6</button>
        </div>
        <span class="spacer"></span>
        <button class="btn btn-ghost" @click=${() => this._load()}>Refresh</button>
        <button class="btn btn-primary" @click=${() => this.showUpload = true}>+ Upload</button>
      </div>

      ${this.showUpload ? html`
        <social-upload-modal @uploaded=${() => { this.showUpload = false; this._load(); }}
          @close=${() => this.showUpload = false}></social-upload-modal>` : nothing}

      <div class="cal-grid">
        ${days.map(day => {
          const dayItems = this._itemsForDate(day.date);
          return html`
            <div class="cal-day ${day.isToday ? 'today' : ''}">
              <div class="cal-date ${day.isToday ? 'today' : ''}">
                ${day.label}
                <span class="cal-add" title="Create content for this day" @click=${(e: Event) => { e.stopPropagation(); this._createForDate(day.date); }}>Create</span>
              </div>
              <div class="cal-items">
                ${dayItems.length ? dayItems.map(item => html`
                  <div class="cal-item ${item.content_type} s-${item.status}" title="${item.topic || item.job_id}" @click=${() => this._openJob(item)}>
                    <span class="type-tag">${TYPE_LABELS[item.content_type] || item.content_type}</span>
                    <span class="item-topic">${item.topic || item.job_id}</span>
                  </div>
                `) : html`<div class="empty">\u2014</div>`}
              </div>
            </div>`;
        })}
      </div>

      <div class="legend">
        <div class="legend-item"><div class="legend-swatch" style="background:#8B5CF6"></div> Video</div>
        <div class="legend-item"><div class="legend-swatch" style="background:#F97316"></div> Cinematic</div>
        <div class="legend-item"><div class="legend-swatch" style="background:#0EA5E9"></div> Text</div>
        <div class="legend-item"><div class="legend-swatch" style="background:#10B981"></div> Image</div>
        <span style="margin-left:8px;color:var(--border-dim)">|</span>
        <div class="legend-item"><div class="legend-swatch" style="background:rgba(74,222,128,0.35)"></div> Posted</div>
        <div class="legend-item"><div class="legend-swatch" style="background:rgba(59,130,246,0.35)"></div> Scheduled</div>
        <div class="legend-item"><div class="legend-swatch" style="background:rgba(245,158,11,0.35)"></div> Review</div>
        <div class="legend-item"><div class="legend-swatch" style="background:rgba(128,128,128,0.25)"></div> Draft</div>
      </div>
      <div class="info-note">Only dashboard-created content shown. External Buffer posts are not synced.</div>

      ${this.popoverItem ? html`
        <div class="popover" style="top:50%;left:50%;transform:translate(-50%,-50%)" @click=${(e: Event) => e.stopPropagation()}>
          <button class="popover-close" @click=${() => this.popoverItem = null}>\u2715</button>
          <div class="popover-title">${this.popoverItem.topic || this.popoverItem.job_id}</div>
          <div class="popover-row"><span>Status</span><span>${this.popoverItem.status.replace('_', ' ')}</span></div>
          <div class="popover-row"><span>Type</span><span>${TYPE_LABELS[this.popoverItem.content_type] || this.popoverItem.content_type}</span></div>
          <div class="popover-row"><span>Source</span><span>${this.popoverItem.source}</span></div>
          ${this.popoverItem.pillar ? html`<div class="popover-row"><span>Pillar</span><span>${this.popoverItem.pillar}</span></div>` : nothing}
          ${this.popoverItem.scheduled_for_date ? html`<div class="popover-row"><span>Scheduled</span><span>${this.popoverItem.scheduled_for_date}</span></div>` : nothing}
        </div>` : nothing}
    `;
  }

  private get _weekLabel(): string {
    if (this.weekOffset === 0) {return 'This Week';}
    const days = this._weekDays;
    const fmt = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { month: 'short', day: 'numeric' });
    return `${fmt(days[0].date)} - ${fmt(days[6].date)}`;
  }
}
