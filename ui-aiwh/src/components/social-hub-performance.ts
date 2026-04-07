import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';

interface ConfidenceItem { count: number; avgGrade: number; }

@customElement('social-hub-performance')
export class SocialHubPerformance extends LitElement {
  @state() private metrics: any = null;
  @state() private socialConf: Record<string, ConfidenceItem> = {};
  @state() private cinematicConf: Record<string, ConfidenceItem> = {};
  @state() private platforms: string[] = [];
  @state() private recommendations: string[] = [];
  @state() private loading = true;
  @state() private platform = 'all';

  connectedCallback() { super.connectedCallback(); this._load(); }

  private async _load() {
    this.loading = true;
    try {
      const data = await this._api('/api/social-hub/performance');
      this.metrics = data.metrics?.status === 'no_data' ? null : data.metrics;
      this.socialConf = data.socialConfidence || {};
      this.cinematicConf = data.cinematicConfidence || {};
      this.platforms = data.platforms || [];
      this.recommendations = data.recommendations || [];
    } catch (e) { console.error('[performance]', e); }
    this.loading = false;
  }

  private async _api(url: string) {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) {return {};}
    const ct = res.headers.get('content-type') || '';
    return ct.includes('json') ? res.json() : {};
  }

  private _confPct(item: ConfidenceItem, required: number): number {
    if (!item || !required) {return 0;}
    const sample = Math.min(1.0, item.count / required);
    const grade = item.avgGrade / 5.0;
    return Math.round(sample * grade * 100);
  }

  private _confClass(pct: number): string {
    if (pct >= 70) {return 'high';}
    if (pct >= 40) {return 'mid';}
    return 'low';
  }

  static styles = css`
    :host { display: block; color: var(--text-primary); font-family: 'Inter', -apple-system, sans-serif; }
    .empty { text-align: center; padding: 40px; color: var(--text-muted); font-size: 13px; }
    .card { background: var(--surface); border: 1px solid var(--border-dim); border-radius: 12px; padding: 20px; margin-bottom: 16px; }
    .card-title { font-size: 14px; font-weight: 600; margin-bottom: 12px; }

    .metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 12px; }
    .metric { text-align: center; padding: 16px; }
    .metric-value { font-size: 24px; font-weight: 700; color: var(--magenta); }
    .metric-label { font-size: 11px; color: var(--text-muted); margin-top: 4px; }

    .conf-section { margin-bottom: 16px; }
    .conf-section h4 { font-size: 12px; font-weight: 600; margin-bottom: 8px; color: var(--text-muted); }
    .conf-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
    .conf-label { font-size: 12px; min-width: 90px; color: var(--text-primary); }
    .conf-bar { flex: 1; height: 6px; background: var(--border-dim); border-radius: 3px; overflow: hidden; }
    .conf-fill { height: 100%; border-radius: 3px; transition: width 300ms; }
    .conf-fill.low { background: var(--critical, #EF4444); }
    .conf-fill.mid { background: var(--amber, #F59E0B); }
    .conf-fill.high { background: var(--success, #4CAF7A); }
    .conf-pct { font-size: 11px; color: var(--text-muted); min-width: 36px; text-align: right; }
    .conf-detail { font-size: 10px; color: var(--text-dim); min-width: 80px; text-align: right; }

    .recs { margin-top: 8px; }
    .rec { font-size: 12px; padding: 8px 12px; background: var(--magenta-dim);
      border-left: 2px solid var(--magenta); border-radius: 0 6px 6px 0; margin-bottom: 6px; line-height: 1.4; }

    .plat-tabs { display: flex; gap: 6px; margin-bottom: 14px; }
    .plat-tab { padding: 4px 10px; border-radius: 5px; font-size: 11px; cursor: pointer;
      border: 1px solid var(--border-dim); background: var(--surface); color: var(--text-muted); }
    .plat-tab.active { border-color: var(--magenta); color: var(--magenta); background: var(--magenta-dim); }
  `;

  render() {
    if (this.loading) {return html`<div class="empty">Loading performance data...</div>`;}
    const latestWeek = this.metrics?.weeks?.[this.metrics.weeks.length - 1];
    return html`
      ${this._renderMetrics(latestWeek)}
      ${this.recommendations.length ? this._renderRecs() : nothing}
      ${this._renderConfidence()}
    `;
  }

  private _cap(p: string): string {
    const m: Record<string, string> = { instagram: 'Instagram', x: 'X', linkedin: 'LinkedIn', tiktok: 'TikTok', facebook: 'Facebook' };
    return m[p] || p;
  }

  private _renderMetrics(w: any) {
    return html`
      <div class="card">
        <div class="card-title">Performance — This Week</div>
        <div class="plat-tabs">
          <div class="plat-tab ${this.platform === 'all' ? 'active' : ''}" @click=${() => this.platform = 'all'}>Overview</div>
          ${this.platforms.map(p => html`
            <div class="plat-tab ${this.platform === p ? 'active' : ''}" @click=${() => this.platform = p}>${this._cap(p)}</div>
          `)}
        </div>
        <div class="metrics-grid">
          <div class="metric"><div class="metric-value">${this._fmt(w?.reach)}</div><div class="metric-label">Reach</div></div>
          <div class="metric"><div class="metric-value">${w?.engagement_rate != null ? w.engagement_rate + '%' : '\u2014'}</div><div class="metric-label">Engagement</div></div>
          <div class="metric"><div class="metric-value">${this._fmt(w?.followers)}</div><div class="metric-label">Followers</div></div>
          <div class="metric"><div class="metric-value">${w?.posts_count || '\u2014'}</div><div class="metric-label">Posts</div></div>
        </div>
        ${!w ? html`<div style="font-size:11px;color:var(--text-dim);text-align:center;margin-top:8px">Metrics will appear after the weekly social strategy report runs.</div>` : nothing}
      </div>`;
  }

  private _renderConfidence() {
    const socialSamples: Record<string, number> = { text_post: 15, image_post: 30 };
    const cinematicSamples: Record<string, number> = { ref_image: 30, keyframe_first: 30, keyframe_last: 30, video_clip: 30 };

    const hasSocial = Object.keys(this.socialConf).some(k => this.socialConf[k]?.count > 0);
    const hasCinematic = Object.keys(this.cinematicConf).some(k => (this.cinematicConf as any)[k]?.count > 0);
    if (!hasSocial && !hasCinematic) {return nothing;}

    return html`
      <div class="card">
        <div class="card-title">AI Quality Training</div>
        ${hasSocial ? html`
          <div class="conf-section"><h4>Social Content</h4>
            ${Object.entries(socialSamples).map(([type, req]) => this._confRow(type.replace('_', ' '), this.socialConf[type], req))}
          </div>` : nothing}
        ${hasCinematic ? html`
          <div class="conf-section"><h4>Cinematic Assets</h4>
            ${Object.entries(cinematicSamples).map(([type, req]) => this._confRow(type.replace(/_/g, ' '), (this.cinematicConf as any)[type], req))}
          </div>` : nothing}
      </div>`;
  }

  private _confRow(label: string, item: ConfidenceItem | undefined, required: number) {
    const pct = this._confPct(item || { count: 0, avgGrade: 0 }, required);
    return html`
      <div class="conf-row">
        <span class="conf-label">${label}</span>
        <div class="conf-bar"><div class="conf-fill ${this._confClass(pct)}" style="width:${pct}%"></div></div>
        <span class="conf-pct">${pct}%</span>
        <span class="conf-detail">${item?.count || 0}/${required} samples</span>
      </div>`;
  }

  private _renderRecs() {
    return html`
      <div class="card">
        <div class="card-title">Recommendations</div>
        <div class="recs">${this.recommendations.map(r => html`<div class="rec">${r}</div>`)}</div>
      </div>`;
  }

  private _fmt(n: any): string {
    if (!n || isNaN(n)) {return '—';}
    if (n >= 1000000) {return (n / 1000000).toFixed(1) + 'M';}
    if (n >= 1000) {return (n / 1000).toFixed(1) + 'K';}
    return String(n);
  }
}
