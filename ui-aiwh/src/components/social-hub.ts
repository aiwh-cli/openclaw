import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';

type TabId = 'calendar' | 'pipeline' | 'studio' | 'review' | 'performance' | 'settings';
interface TabContext { date?: string; pillar?: string; jobId?: string; }

@customElement('social-hub')
export class SocialHub extends LitElement {
  @state() private tab: TabId = 'calendar';
  @state() private reviewCount = 0;
  @state() private pipelineCount = 0;
  @state() private tabContext: TabContext = {};
  @state() private showCinematic = false;

  private _countPoll: ReturnType<typeof setInterval> | null = null;
  connectedCallback() { super.connectedCallback(); this._loadCounts(); this._countPoll = setInterval(() => this._loadCounts(), 30000); }
  disconnectedCallback() { super.disconnectedCallback(); if (this._countPoll) { clearInterval(this._countPoll); this._countPoll = null; } }

  /** Public: called by app.js when socket refresh fires */
  public refresh() { this._loadCounts(); }

  private async _loadCounts() {
    try {
      const [review, pipeline] = await Promise.all([
        this._api('/api/social-hub/review-queue'),
        this._api('/api/social-hub/pipeline'),
      ]);
      this.reviewCount = (review.items || []).length;
      this.pipelineCount = (pipeline.jobs || []).filter(
        (j: any) => !['approved', 'published', 'failed', 'cancelled'].includes(j.phase)
      ).length;
    } catch (e) { console.error('[social-hub]', e); }
  }

  private async _api(url: string) {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) {return {};}
    const ct = res.headers.get('content-type') || '';
    return ct.includes('json') ? res.json() : {};
  }

  private _onNavigate(e: CustomEvent) {
    const { tab, jobId, date, pillar } = e.detail || {};
    if (tab) {
      this.tab = tab as TabId;
      this.tabContext = { jobId, date, pillar };
      this.showCinematic = false;
    }
  }

  static styles = css`
    :host { display: block; font-family: 'Inter', -apple-system, sans-serif; color: var(--text-primary); }

    .tabs { display: flex; gap: 2px; margin-bottom: 20px; border-bottom: 1px solid var(--border-dim); }
    .tab { padding: 10px 18px; cursor: pointer; font-size: 13px; font-weight: 500;
      border-bottom: 2px solid transparent; color: var(--text-muted); transition: all 150ms;
      display: flex; align-items: center; gap: 6px; user-select: none; }
    .tab:hover { color: var(--text-primary); }
    .tab.active { color: var(--magenta); border-bottom-color: var(--magenta); }
    .badge { background: rgba(var(--critical-rgb, 224,82,82), 0.15); color: var(--critical, #EF4444);
      font-size: 10px; padding: 1px 6px; border-radius: 8px; font-weight: 600; }
    .badge.info { background: rgba(var(--magenta-rgb, 201,168,76), 0.15); color: var(--magenta); }
    .placeholder { text-align: center; padding: 60px 20px; color: var(--text-muted); font-size: 14px; }
    .placeholder p { margin-top: 8px; font-size: 12px; }
  `;

  render() {
    const tabs: { id: TabId; label: string; badge?: number; badgeClass?: string }[] = [
      { id: 'calendar', label: 'Calendar' },
      { id: 'pipeline', label: 'Pipeline', badge: this.pipelineCount || undefined, badgeClass: 'info' },
      { id: 'studio', label: 'Studio' },
      { id: 'review', label: 'Review', badge: this.reviewCount || undefined },
      { id: 'performance', label: 'Performance' },
      { id: 'settings', label: 'Settings' },
    ];

    return html`
      <div class="tabs">
        ${tabs.map(t => html`
          <div class="tab ${this.tab === t.id ? 'active' : ''}" @click=${() => this.tab = t.id}>
            ${t.label}
            ${t.badge ? html`<span class="badge ${t.badgeClass || ''}">${t.badge}</span>` : nothing}
          </div>
        `)}
      </div>
      ${this._renderTab()}
    `;
  }

  private _renderTab() {
    switch (this.tab) {
      case 'calendar': return html`<social-hub-calendar @navigate-tab=${this._onNavigate}></social-hub-calendar>`;
      case 'pipeline': return html`<social-hub-pipeline @navigate-tab=${this._onNavigate}></social-hub-pipeline>`;
      case 'studio':
        if (this.showCinematic) {return html`
          <studio-cinematic-form @navigate-tab=${this._onNavigate}
            @back-to-studio=${() => this.showCinematic = false}></studio-cinematic-form>`;}
        return html`<social-hub-studio .context=${this.tabContext}
          @navigate-tab=${this._onNavigate}
          @open-cinematic=${() => this.showCinematic = true}></social-hub-studio>`;
      case 'review': return html`<social-hub-review .focusJobId=${this.tabContext.jobId || ''}></social-hub-review>`;
      case 'performance': return html`<social-hub-performance></social-hub-performance>`;
      case 'settings': return html`<social-hub-settings></social-hub-settings>`;
    }
  }
}
