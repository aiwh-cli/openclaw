// Schedule Cron Detail — detail modal, run history, trigger/toggle/delete actions.
// Reads _schedCache from window (set by schedule-cron-crud.ts).

import { SCHED_DAYS, parseCronDays, cronToHuman } from './schedule-cron-picker.js';
import { getJobStatus, _friendlyError, _cronRunLabel } from './schedule-cron-views.js';

const api = (window as any).api as (url: string, opts?: any) => Promise<any>;
const showToast = (window as any).showToast as (msg: string, type?: string) => void;
const showModal = (window as any).showModal as (html: string, cls?: string) => void;
const closeModal = (window as any).closeModal as () => void;
const escHtml = (window as any).escHtml as (s: string) => string;
const timeAgo = (window as any).timeAgo as (d: string) => string;
const dashConfirm = (window as any).dashConfirm as (msg: string) => Promise<boolean>;

const _statusLabels: Record<string, string> = { ok: 'Healthy', error: 'Failing', disabled: 'Paused', idle: 'Idle' };

function _cache(): any { return (window as any)._schedCache || { openclaw: [], local: [], scripts: [] }; }

function showCronDetail(jobId: string) {
  const cache = _cache();
  const job = ([...cache.openclaw, ...cache.scripts]).find((j: any) => j.id === jobId);
  if (!job) { return showToast('Job not found', 'error'); }
  const st = job.state || {};
  const sched = job.schedule || {};
  const pl = job.payload || {};
  const enabled = job.enabled !== false;
  const status = getJobStatus(job);
  const errors = st.consecutiveErrors || 0;
  const lastMs = st.lastRunAtMs;
  const nextMs = st.nextRunAtMs;
  const isScript = pl.kind === 'systemEvent';
  const msgPreview = isScript ? '' : (pl.message || '').slice(0, 120);
  const hasFullMsg = !isScript && (pl.message || '').length > 120;

  const html = `
    <div class="cron-detail">
      <div class="cron-detail-hdr">
        <div>
          <div class="cron-detail-name">${escHtml(job.name || job.id)}</div>
          <div class="cron-detail-desc">${escHtml(job.description || 'No description')}</div>
        </div>
        <span class="cron-detail-badge cron-detail-badge-${status}">${_statusLabels[status]}</span>
      </div>
      <div class="cron-detail-grid">
        <div class="cron-detail-field">
          <span class="cron-detail-label">Schedule</span>
          <span class="cron-detail-val"><code>${escHtml(sched.expr || '\u2014')}</code></span>
          <span class="cron-detail-sub">${cronToHuman(sched.expr || '')}</span>
        </div>
        <div class="cron-detail-field">
          <span class="cron-detail-label">Timezone</span>
          <span class="cron-detail-val">${escHtml(sched.tz || 'UTC')}</span>
        </div>
        ${pl.kind === 'systemEvent' ? `
        <div class="cron-detail-field" style="grid-column:1/-1">
          <span class="cron-detail-label">Script</span>
          <span class="cron-detail-val"><code>${escHtml(pl.text || pl.message || '\u2014')}</code></span>
        </div>` : `
        <div class="cron-detail-field">
          <span class="cron-detail-label">Agent</span>
          <span class="cron-detail-val"><span class="agent-badge">${escHtml(job.agentId || '\u2014')}</span></span>
        </div>
        <div class="cron-detail-field">
          <span class="cron-detail-label">Session</span>
          <span class="cron-detail-val">${escHtml(job.sessionTarget || 'main')}</span>
        </div>`}
        <div class="cron-detail-field">
          <span class="cron-detail-label">Last Run</span>
          <span class="cron-detail-val">${lastMs ? timeAgo(new Date(lastMs).toISOString()) : 'Never'}</span>
          ${st.lastDurationMs ? `<span class="cron-detail-sub">${(st.lastDurationMs / 1000).toFixed(1)}s</span>` : ''}
        </div>
        <div class="cron-detail-field">
          <span class="cron-detail-label">Next Run</span>
          <span class="cron-detail-val">${nextMs ? timeAgo(new Date(nextMs).toISOString()) : '\u2014'}</span>
        </div>
        ${pl.model ? `<div class="cron-detail-field">
          <span class="cron-detail-label">Model</span>
          <span class="cron-detail-val"><code>${escHtml(pl.model)}</code></span>
        </div>` : ''}
        ${errors > 0 ? `<div class="cron-detail-field">
          <span class="cron-detail-label">Errors</span>
          <span class="cron-detail-val" style="color:var(--critical)">${errors} consecutive</span>
        </div>` : ''}
      </div>
      ${st.lastError ? `<div class="cron-detail-msg">
        <span class="cron-detail-label" style="color:var(--critical)">Last Error</span>
        <div class="cron-detail-msg-text" style="color:var(--critical);background:rgba(var(--critical-rgb),0.06);border:1px solid rgba(var(--critical-rgb),0.15);">${escHtml(_friendlyError(st.lastError))}</div>
      </div>` : ''}
      ${msgPreview ? `<div class="cron-detail-msg">
        <span class="cron-detail-label">Message</span>
        <div class="cron-detail-msg-text">${escHtml(msgPreview)}${hasFullMsg ? '\u2026' : ''}</div>
      </div>` : ''}
      <div class="cron-detail-days">
        <span class="cron-detail-label">Active Days</span>
        <div class="cron-detail-day-pills">
          ${SCHED_DAYS.map((d, i) => {
            const active = parseCronDays(sched.expr).includes(i);
            return `<span class="day-pill${active ? ' day-pill-on' : ''}">${d}</span>`;
          }).join('')}
        </div>
      </div>
      <div class="cron-detail-actions">
        ${job.protected ? '' : `<button class="btn btn-ghost btn-danger-ghost" onclick="deleteCronConfirm('${escHtml(job.id)}', '${escHtml(job.name || job.id)}', ${!!job._isScript})" title="Delete">\u2716 Delete</button>`}
        <span style="flex:1"></span>
        <button class="btn btn-ghost" onclick="showCronRuns('${escHtml(job.id)}', ${!!job._isScript})" title="Run History">\u23F3 History</button>
        <button class="btn btn-ghost" onclick="${job._isScript ? `editScriptCron('${escHtml(job.id)}')` : `editCron('${escHtml(job.id)}')`}">\u270E Edit</button>
        <button class="btn btn-ghost" onclick="triggerCronFromDetail('${escHtml(job.id)}', ${!!job._isScript})" ${!enabled ? 'disabled' : ''}>\u25B6 Run Now</button>
        <button class="btn btn-ghost" onclick="toggleCronFromDetail('${escHtml(job.id)}', ${!enabled}, ${!!job._isScript})">${enabled ? '\u23F8 Pause' : '\u25B6 Resume'}</button>
      </div>
    </div>
  `;
  showModal(html, 'modal-md');
}

async function triggerCronFromDetail(jobId: string, isScript: boolean) {
  closeModal();
  if (isScript) {
    const r = await api(`/script-crons/${jobId}/trigger`, { method: 'POST' });
    if (r?.ok) { showToast('Script triggered'); }
    else { showToast('Failed: ' + (r?.error || 'unknown'), 'error'); }
  } else {
    await (window as any).triggerCron(jobId);
  }
}

async function toggleCronFromDetail(jobId: string, enable: boolean, isScript: boolean) {
  closeModal();
  if (isScript) {
    const r = await api(`/script-crons/${jobId}`, { method: 'PUT', body: { enabled: enable ? 1 : 0 } });
    if (r?.ok) {
      showToast(enable ? 'Script cron enabled' : 'Script cron paused');
      await (window as any).loadSchedule();
    } else { showToast('Failed: ' + (r?.error || 'unknown'), 'error'); }
  } else {
    await (window as any).toggleCron(jobId, enable);
  }
}

async function deleteCronConfirm(jobId: string, name: string, isScript: boolean) {
  closeModal();
  const ok = await dashConfirm(`Delete cron job "${name}"?\n\nThis cannot be undone.`);
  if (!ok) { return; }
  const endpoint = isScript ? `/script-crons/${jobId}` : `/cron/${jobId}`;
  const r = await api(endpoint, { method: 'DELETE' });
  if (r?.ok) {
    showToast('Cron deleted');
    await (window as any).loadSchedule();
  } else {
    showToast('Failed: ' + (r?.error || 'unknown'), 'error');
  }
}

/* ── Run History ──────────────────────────────────────────── */

async function showCronRuns(jobId: string, isScript: boolean) {
  closeModal();
  const cache = _cache();
  const job = ([...cache.openclaw, ...cache.scripts]).find((j: any) => j.id === jobId);
  const name = job?.name || jobId;

  showModal(`<div class="cron-detail"><div style="text-align:center;padding:24px;color:var(--text-dim)">Loading run history\u2026</div></div>`, 'modal-lg');

  let entries: any[], total: number;
  if (isScript) {
    const data = await api(`/script-crons/${jobId}/runs?limit=15`);
    const runs = data?.runs || [];
    total = runs.length;
    entries = runs.map((r: any) => ({
      status: r.status,
      runAtMs: new Date(r.started_at).getTime(),
      ts: new Date(r.started_at).getTime(),
      durationMs: r.duration_ms,
      model: 'shell',
      usage: null,
      summary: (r.output || '').slice(0, 200),
    }));
  } else {
    const data = await api(`/cron/${jobId}/runs?limit=15`);
    entries = data?.entries || [];
    total = data?.total || entries.length;
  }

  if (!entries.length) {
    showModal(`<div class="cron-detail">
      <h3 style="margin:0;font-size:14px;">Run History: ${escHtml(name)}</h3>
      <div class="empty-msg">No run history available for this job.</div>
      <div class="cron-detail-actions">
        <button class="btn btn-ghost" onclick="showCronDetail('${escHtml(jobId)}')">\u2190 Back</button>
      </div>
    </div>`, 'modal-lg');
    return;
  }

  const rows = entries.map((e: any) => {
    const ok = e.status === 'ok';
    const ts = new Date(e.runAtMs || e.ts);
    const time = ts.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Australia/Brisbane' });
    const date = ts.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', timeZone: 'Australia/Brisbane' });
    const dur = e.durationMs ? `${(e.durationMs / 1000).toFixed(1)}s` : '\u2014';
    const model = e.model || '\u2014';
    const tokens = e.usage?.total_tokens ? e.usage.total_tokens.toLocaleString() : '\u2014';
    const summary = (e.summary || '').replace(/\*\*/g, '').replace(/[#>]/g, '').slice(0, 200);
    const fullOutput = escHtml(e.summary || '');
    return `<div class="run-row run-row-${ok ? 'ok' : 'error'}" onclick="this.querySelector('.run-full')?.classList.toggle('run-full-open')" style="cursor:pointer;" title="Click to expand">
      <div class="run-status"><span class="cal-dot cal-dot-${ok ? 'ok' : 'error'}"></span></div>
      <div class="run-time">${date}<br>${time}</div>
      <div class="run-dur">${dur}</div>
      <div class="run-model"><code>${escHtml(model)}</code></div>
      <div class="run-tokens">${tokens}</div>
      <div class="run-summary">${escHtml(summary.slice(0, 100))}${summary.length > 100 ? '\u2026' : ''}
        <div class="run-full">${fullOutput}</div>
      </div>
    </div>`;
  }).join('');

  showModal(`<div class="cron-detail">
    <div class="cron-detail-hdr">
      <h3 style="margin:0;font-size:14px;">Run History: ${escHtml(name)}</h3>
      <span style="font-size:10px;color:var(--text-dim)">${total} total runs</span>
    </div>
    <div class="run-hdr">
      <div class="run-status"></div>
      <div class="run-time">When</div>
      <div class="run-dur">Duration</div>
      <div class="run-model">Model</div>
      <div class="run-tokens">Tokens</div>
      <div class="run-summary">Summary</div>
    </div>
    <div class="run-list">${rows}</div>
    <div class="cron-detail-actions">
      <button class="btn btn-ghost" onclick="showCronDetail('${escHtml(jobId)}')">\u2190 Back</button>
    </div>
  </div>`, 'modal-lg');
}

// Expose on window for inline onclick handlers
(window as any).showCronDetail = showCronDetail;
(window as any).triggerCronFromDetail = triggerCronFromDetail;
(window as any).toggleCronFromDetail = toggleCronFromDetail;
(window as any).deleteCronConfirm = deleteCronConfirm;
(window as any).showCronRuns = showCronRuns;
