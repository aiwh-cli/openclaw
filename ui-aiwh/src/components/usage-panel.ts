import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { renderUsage } from '@openclaw/ui/views/usage.ts';
import type { UsageProps, UsageColumnId, SessionLogRole } from '@openclaw/ui/views/usageTypes.ts';
import type { SessionsUsageResult, SessionUsageTimePoint } from '@openclaw/ui/usage-types.ts';
import { GatewayBrowserClient } from '@openclaw/ui/gateway.ts';
import { getGatewayClient } from './gateway-client.js';

@customElement('usage-panel')
export class UsagePanel extends LitElement {
  @state() private loading = true;
  @state() private error: string | null = null;
  @state() private connected = false;

  // Data
  @state() private sessions: SessionsUsageResult['sessions'] = [];
  @state() private totals: SessionsUsageResult['totals'] | null = null;
  @state() private aggregates: SessionsUsageResult['aggregates'] | null = null;
  @state() private costDaily: any[] = [];
  @state() private sessionsLimitReached = false;

  // Date range
  @state() private startDate = _isoDate(-7);
  @state() private endDate = _isoDate(0);

  // Selection state
  @state() private selectedSessions: string[] = [];
  @state() private selectedDays: string[] = [];
  @state() private selectedHours: number[] = [];
  @state() private recentSessions: string[] = [];
  @state() private sessionsTab: 'all' | 'recent' = 'all';

  // Chart modes
  @state() private chartMode: 'tokens' | 'cost' = 'cost';
  @state() private dailyChartMode: 'total' | 'by-type' = 'total';
  @state() private timeSeriesMode: 'cumulative' | 'per-turn' = 'cumulative';
  @state() private timeSeriesBreakdownMode: 'total' | 'by-type' = 'total';
  @state() private timeSeriesCursorStart: number | null = null;
  @state() private timeSeriesCursorEnd: number | null = null;

  // Session detail
  @state() private timeSeries: { points: SessionUsageTimePoint[] } | null = null;
  @state() private timeSeriesLoading = false;
  @state() private sessionLogs: any[] | null = null;
  @state() private sessionLogsLoading = false;
  @state() private sessionLogsExpanded = false;

  // Filters
  @state() private query = '';
  @state() private queryDraft = '';
  @state() private logFilterRoles: SessionLogRole[] = [];
  @state() private logFilterTools: string[] = [];
  @state() private logFilterHasTools = false;
  @state() private logFilterQuery = '';

  // Sort & display
  @state() private sessionSort: 'tokens' | 'cost' | 'recent' | 'messages' | 'errors' = 'cost';
  @state() private sessionSortDir: 'asc' | 'desc' = 'desc';
  @state() private visibleColumns: UsageColumnId[] = ['channel', 'agent', 'model', 'messages'];
  @state() private timeZone: 'local' | 'utc' = 'local';
  @state() private contextExpanded = false;
  @state() private headerPinned = false;

  private client: GatewayBrowserClient | null = null;

  static styles = css`:host { display: block; }`;

  connectedCallback() { super.connectedCallback(); this._init(); }

  private async _init() {
    try {
      this.client = await getGatewayClient();
      this.connected = true;
      this._loadUsage();
    } catch (e: unknown) {
      this.error = e instanceof Error ? e.message : 'Failed to connect to gateway';
      this.loading = false;
    }
  }

  private async _loadUsage() {
    if (!this.client?.connected) {return;}
    this.loading = true; this.error = null;
    try {
      const [sessionsResult, costResult] = await Promise.all([
        this.client.request<SessionsUsageResult>('sessions.usage', {
          startDate: this.startDate, endDate: this.endDate,
          limit: 1000, includeContextWeight: true,
        }),
        this.client.request<any>('usage.cost', {
          startDate: this.startDate, endDate: this.endDate,
        }).catch(() => null),
      ]);
      this.sessions = sessionsResult.sessions || [];
      this.totals = sessionsResult.totals || null;
      this.aggregates = sessionsResult.aggregates || null;
      this.sessionsLimitReached = this.sessions.length >= 1000;
      this.costDaily = costResult?.daily || [];
    } catch (e: unknown) {
      this.error = e instanceof Error ? e.message : 'Failed to load usage';
    } finally { this.loading = false; }
  }

  private async _loadTimeSeries(key: string) {
    if (!this.client?.connected) {return;}
    this.timeSeriesLoading = true;
    try {
      const result = await this.client.request<any>('sessions.usage.timeseries', { key });
      this.timeSeries = result || null;
    } catch { this.timeSeries = null; }
    finally { this.timeSeriesLoading = false; }
  }

  private async _loadSessionLogs(key: string) {
    if (!this.client?.connected) {return;}
    this.sessionLogsLoading = true;
    try {
      const result = await this.client.request<any>('sessions.usage.logs', { key });
      this.sessionLogs = result?.entries || result || null;
    } catch { this.sessionLogs = null; }
    finally { this.sessionLogsLoading = false; }
  }

  private _buildProps(): UsageProps {
    return {
      data: {
        loading: this.loading, error: this.error,
        sessions: this.sessions, sessionsLimitReached: this.sessionsLimitReached,
        totals: this.totals, aggregates: this.aggregates, costDaily: this.costDaily,
      },
      filters: {
        startDate: this.startDate, endDate: this.endDate,
        selectedSessions: this.selectedSessions, selectedDays: this.selectedDays,
        selectedHours: this.selectedHours,
        query: this.query, queryDraft: this.queryDraft, timeZone: this.timeZone,
      },
      display: {
        chartMode: this.chartMode, dailyChartMode: this.dailyChartMode,
        sessionSort: this.sessionSort, sessionSortDir: this.sessionSortDir,
        recentSessions: this.recentSessions, sessionsTab: this.sessionsTab,
        visibleColumns: this.visibleColumns,
        contextExpanded: this.contextExpanded, headerPinned: this.headerPinned,
      },
      detail: {
        timeSeriesMode: this.timeSeriesMode, timeSeriesBreakdownMode: this.timeSeriesBreakdownMode,
        timeSeries: this.timeSeries, timeSeriesLoading: this.timeSeriesLoading,
        timeSeriesCursorStart: this.timeSeriesCursorStart, timeSeriesCursorEnd: this.timeSeriesCursorEnd,
        sessionLogs: this.sessionLogs, sessionLogsLoading: this.sessionLogsLoading,
        sessionLogsExpanded: this.sessionLogsExpanded,
        logFilters: {
          roles: this.logFilterRoles, tools: this.logFilterTools,
          hasTools: this.logFilterHasTools, query: this.logFilterQuery,
        },
      },
      callbacks: {
        filters: {
          onStartDateChange: (d) => { this.startDate = d; this._loadUsage(); },
          onEndDateChange: (d) => { this.endDate = d; this._loadUsage(); },
          onRefresh: () => this._loadUsage(),
          onTimeZoneChange: (z) => { this.timeZone = z; },
          onToggleHeaderPinned: () => { this.headerPinned = !this.headerPinned; },
          onSelectDay: (day, shift) => {
            this.selectedDays = shift
              ? (this.selectedDays.includes(day) ? this.selectedDays.filter(d => d !== day) : [...this.selectedDays, day])
              : (this.selectedDays.includes(day) && this.selectedDays.length === 1 ? [] : [day]);
          },
          onSelectHour: (hour, shift) => {
            this.selectedHours = shift
              ? (this.selectedHours.includes(hour) ? this.selectedHours.filter(h => h !== hour) : [...this.selectedHours, hour])
              : (this.selectedHours.includes(hour) && this.selectedHours.length === 1 ? [] : [hour]);
          },
          onClearDays: () => { this.selectedDays = []; },
          onClearHours: () => { this.selectedHours = []; },
          onClearSessions: () => { this.selectedSessions = []; this.timeSeries = null; this.sessionLogs = null; },
          onClearFilters: () => { this.query = ''; this.queryDraft = ''; this.selectedDays = []; this.selectedHours = []; this.selectedSessions = []; },
          onQueryDraftChange: (q) => { this.queryDraft = q; },
          onApplyQuery: () => { this.query = this.queryDraft; },
          onClearQuery: () => { this.query = ''; this.queryDraft = ''; },
        },
        display: {
          onChartModeChange: (m) => { this.chartMode = m; },
          onDailyChartModeChange: (m) => { this.dailyChartMode = m; },
          onSessionSortChange: (s) => { this.sessionSort = s; },
          onSessionSortDirChange: (d) => { this.sessionSortDir = d; },
          onSessionsTabChange: (t) => { this.sessionsTab = t; },
          onToggleColumn: (col) => {
            this.visibleColumns = this.visibleColumns.includes(col)
              ? this.visibleColumns.filter(c => c !== col) : [...this.visibleColumns, col];
          },
        },
        details: {
          onToggleContextExpanded: () => { this.contextExpanded = !this.contextExpanded; },
          onToggleSessionLogsExpanded: () => { this.sessionLogsExpanded = !this.sessionLogsExpanded; },
          onLogFilterRolesChange: (r) => { this.logFilterRoles = r; },
          onLogFilterToolsChange: (t) => { this.logFilterTools = t; },
          onLogFilterHasToolsChange: (h) => { this.logFilterHasTools = h; },
          onLogFilterQueryChange: (q) => { this.logFilterQuery = q; },
          onLogFilterClear: () => { this.logFilterRoles = []; this.logFilterTools = []; this.logFilterHasTools = false; this.logFilterQuery = ''; },
          onSelectSession: (key, shift) => {
            if (shift) {
              this.selectedSessions = this.selectedSessions.includes(key)
                ? this.selectedSessions.filter(s => s !== key) : [...this.selectedSessions, key];
            } else {
              this.selectedSessions = this.selectedSessions.includes(key) && this.selectedSessions.length === 1 ? [] : [key];
            }
            if (this.selectedSessions.length === 1) {
              this._loadTimeSeries(this.selectedSessions[0]);
              this._loadSessionLogs(this.selectedSessions[0]);
              if (!this.recentSessions.includes(key)) {this.recentSessions = [key, ...this.recentSessions.slice(0, 9)];}
            } else { this.timeSeries = null; this.sessionLogs = null; }
          },
          onTimeSeriesModeChange: (m) => { this.timeSeriesMode = m; },
          onTimeSeriesBreakdownChange: (m) => { this.timeSeriesBreakdownMode = m; },
          onTimeSeriesCursorRangeChange: (s, e) => { this.timeSeriesCursorStart = s; this.timeSeriesCursorEnd = e; },
        },
      },
    };
  }

  render() {
    return html`
      <link rel="stylesheet" href="/openclaw-theme-map.css">
      <link rel="stylesheet" href="/openclaw-styles/components.css">
      <link rel="stylesheet" href="/openclaw-styles/layout.css">
      <link rel="stylesheet" href="/openclaw-styles/config.css">
      <link rel="stylesheet" href="/openclaw-styles/usage.css">
      ${renderUsage(this._buildProps())}
    `;
  }
}

function _isoDate(daysOffset: number): string {
  const d = new Date(); d.setDate(d.getDate() + daysOffset);
  return d.toISOString().split('T')[0];
}

declare global {
  interface HTMLElementTagNameMap { 'usage-panel': UsagePanel; }
}
