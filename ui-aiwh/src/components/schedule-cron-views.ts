// Schedule Cron Views — calendar timeline and list view rendering.
// Accepts cache as parameter (passed by schedule-cron-crud.ts) to avoid circular deps.

import { SCHED_DAYS, expandCronTimes, parseCronDays, cronToHuman } from './schedule-cron-picker.js';

const escHtml = (window as any).escHtml as (s: string) => string;
const timeAgo = (window as any).timeAgo as (d: string) => string;

const HOUR_H = 96;
const CARD_H = 22;
const CARD_GAP = 2;

/* ── Status helpers ───────────────────────────────────────── */

export function getJobStatus(job: any): string {
  if (job.enabled === false) { return 'disabled'; }
  if ((job.state?.consecutiveErrors || 0) > 0) { return 'error'; }
  if (job.state?.lastRunStatus === 'ok') { return 'ok'; }
  return 'idle';
}

export function _friendlyError(err: string | null | undefined): string {
  if (!err) { return ''; }
  const e = String(err);
  if (e.includes('rate_limit') || e.includes('usage limits'))
    { return 'Your API key has reached its usage limit. Check your Anthropic account billing to increase your limit or wait for it to reset.'; }
  if (e.includes('authentication') || e.includes('invalid.*key') || e.includes('401'))
    { return 'Your API key appears to be invalid or expired. Go to Config to update it.'; }
  if (e.includes('timeout') || e.includes('ETIMEDOUT'))
    { return 'The request timed out. This usually means a temporary network issue — it should resolve on the next run.'; }
  if (e.includes('ECONNREFUSED') || e.includes('connection refused'))
    { return 'Could not connect to the AI service. Check your internet connection.'; }
  if (e.includes('insufficient_quota') || e.includes('billing'))
    { return 'Your API account needs more credits. Add funds at your AI provider\'s billing page.'; }
  if (e.includes('overloaded') || e.includes('529'))
    { return 'The AI service is temporarily overloaded. The next run should work fine.'; }
  if (e.includes('No such file') || e.includes('not found') || e.includes('exit code 127'))
    { return 'The script file could not be found. It may have been moved or deleted.'; }
  if (e.includes('Permission denied') || e.includes('exit code 126'))
    { return 'The script does not have permission to run. Contact support.'; }
  if (e.match(/exit.*code\s*(unknown|null)/i) || e === 'Script exited with code unknown')
    { return 'The script timed out or crashed without producing output. It may be taking too long to complete. Try running it manually from the Schedule view to see if it works.'; }
  if (e === '' || e === 'Script exited with code ')
    { return 'The script failed but did not report why. Try running it manually to see the result.'; }
  if (e.match(/exit.*code\s*\d+/) && !e.includes('exit code 0'))
    { return 'The script encountered an error. Click "History" for details.'; }
  return e.length > 300 ? e.slice(0, 300) + '\u2026' : e;
}

export function _cronRunLabel(job: any): { label: string; type: string } {
  const pl = job.payload || {};
  if (job._isScript) {
    const cmd = (job._scriptPath || '').split('/').pop() || 'script';
    return { label: cmd, type: 'script' };
  }
  if (pl.kind === 'systemEvent') {
    const cmd = (pl.text || pl.message || '').replace(/^bash\s+/, '').split('/').pop() || 'script';
    return { label: cmd, type: 'script' };
  }
  if (pl.lightContext) {
    const match = (pl.message || '').match(/bash\s+\S+\/([^\s]+)/);
    return { label: match ? match[1] : 'lightweight', type: 'script' };
  }
  return { label: job.agentId || '', type: 'agent' };
}

/* ── Calendar rendering ───────────────────────────────────── */

function renderSlot(entry: any): string {
  const { job, h, m, top, colIdx = 0, colCount = 1, freq } = entry;
  const status = getJobStatus(job);
  const run = _cronRunLabel(job);
  const isScript = job._isScript || run.type === 'script';
  const typeClass = isScript ? 'cal-tl-type-script' : 'cal-tl-type-agent';
  const name = (job.name || job.id || '').replace(/^com\.aiwh\./, '');
  const time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  const freqBadge = freq ? `<span class="cal-tl-freq">${freq}x/day</span>` : '';
  const widthPct = colCount > 1 ? (100 / colCount) - 1 : 100;
  const leftPct = colIdx * (100 / colCount);
  const sizeStyle = colCount > 1 ? `width:${widthPct}%;left:${leftPct}%;right:auto;` : '';
  const tooltip = `${escHtml(name)} \u2014 ${time}${freq ? ` (${freq}x/day)` : ''}${job.description ? '\n' + escHtml(job.description) : ''}`;
  return `<div class="cal-tl-card cal-tl-${status} ${typeClass}" style="top:${top}px;${sizeStyle}" onclick="showCronDetail('${escHtml(job.id)}')" title="${tooltip}">
    <span class="cal-tl-name">${escHtml(name)}</span>
    ${freqBadge}
  </div>`;
}

export function renderCalendar(cache: any) {
  const el = document.getElementById('schedule-list');
  if (!el) { return; }
  const jobs = [...(cache.openclaw || []), ...(cache.scripts || [])].filter((j: any) => j.schedule?.expr);
  if (!jobs.length) {
    el.innerHTML = '<div class="empty-msg">No cron jobs configured. Click "+ Add Cron" to create one.</div>';
    return;
  }
  const total = jobs.length;
  const active = jobs.filter((j: any) => j.enabled !== false).length;
  const errors = jobs.filter((j: any) => (j.state?.consecutiveErrors || 0) > 0).length;
  const disabled = jobs.filter((j: any) => j.enabled === false).length;
  const now = new Date();
  const todayIdx = (now.getDay() + 6) % 7;
  const totalH = 24 * HOUR_H;

  const weekDates = SCHED_DAYS.map((_, di) => {
    const d = new Date(now);
    d.setDate(d.getDate() - todayIdx + di);
    return d.getDate();
  });

  const MULTI_RUN_THRESHOLD = 3;
  const dayCols = SCHED_DAYS.map((name, di) => {
    const entries: any[] = [];
    jobs.forEach((job: any) => {
      if (!parseCronDays(job.schedule?.expr).includes(di)) { return; }
      const times = expandCronTimes(job.schedule.expr);
      if (times.length === 0) { entries.push({ job, h: 0, m: 0 }); }
      else if (times.length > MULTI_RUN_THRESHOLD) { entries.push({ job, h: times[0].h, m: times[0].m, freq: times.length }); }
      else { times.forEach(t => entries.push({ job, h: t.h, m: t.m })); }
    });
    entries.sort((a, b) => (a.h * 60 + a.m) - (b.h * 60 + b.m));
    const SLOT_WINDOW = 30;
    const COLS = 3;
    const slots: any[] = [];
    for (const e of entries) {
      const eMin = e.h * 60 + e.m;
      const last = slots[slots.length - 1];
      if (last && eMin - last.baseMin < SLOT_WINDOW) { last.items.push(e); }
      else { slots.push({ baseMin: eMin, baseH: e.h, baseM: e.m, items: [e] }); }
    }
    let nextFreeTop = 0;
    for (const slot of slots) {
      const idealTop = slot.baseH * HOUR_H + (slot.baseM / 60) * HOUR_H;
      const top = Math.max(idealTop, nextFreeTop);
      const rowCount = Math.ceil(slot.items.length / COLS);
      slot.items.forEach((e: any, si: number) => {
        const row = Math.floor(si / COLS);
        e.top = top + row * (CARD_H + CARD_GAP);
        e.colIdx = si % COLS;
        e.colCount = Math.min(slot.items.length - row * COLS, COLS);
      });
      nextFreeTop = top + rowCount * (CARD_H + CARD_GAP);
    }
    return { name, entries };
  });

  const ruler = Array.from({ length: 24 }, (_, h) =>
    `<div class="cal-tl-tick" style="top:${h * HOUR_H}px">${String(h).padStart(2, '0')}:00</div>`
  ).join('');
  const nowTop = (now.getHours() * 60 + now.getMinutes()) / 60 * HOUR_H;
  const scriptCount = jobs.filter((j: any) => j._isScript || _cronRunLabel(j).type === 'script').length;
  const agentCount = jobs.length - scriptCount;

  el.innerHTML = `
    <div class="cal-bar">
      <div class="cal-stats">
        <span class="cal-stat">${total} jobs</span>
        <span class="cal-stat cal-stat-active">${active} active</span>
        ${errors ? `<span class="cal-stat cal-stat-error">${errors} failing</span>` : ''}
        ${disabled ? `<span class="cal-stat cal-stat-disabled">${disabled} paused</span>` : ''}
      </div>
      <div class="cal-legend">
        <span class="cal-legend-item"><span class="cal-dot cal-dot-ok"></span>Running OK</span>
        <span class="cal-legend-item"><span class="cal-dot cal-dot-error"></span>Failing</span>
        <span class="cal-legend-item"><span class="cal-dot cal-dot-idle"></span>Not run yet</span>
        <span class="cal-legend-item"><span class="cal-dot cal-dot-disabled"></span>Paused</span>
        <span class="cal-legend-sep"></span>
        <span class="cal-legend-item"><span class="cal-dot cal-dot-type-agent"></span>AI Agent (${agentCount})</span>
        <span class="cal-legend-item"><span class="cal-dot cal-dot-type-script"></span>Script \u2014 no AI cost (${scriptCount})</span>
      </div>
    </div>
    <div class="cal-tl">
      <div class="cal-tl-hdr">
        <div class="cal-tl-corner"></div>
        ${dayCols.map((d, i) => `
          <div class="cal-tl-hdr-day${i === todayIdx ? ' cal-tl-today' : ''}">
            <span>${d.name} <span class="cal-tl-hdr-date">${weekDates[i]}</span></span>
            <span class="cal-tl-hdr-count">${d.entries.length}</span>
          </div>
        `).join('')}
      </div>
      <div class="cal-tl-scroll">
        <div class="cal-tl-body" style="height:${totalH}px">
          <div class="cal-tl-ruler">${ruler}</div>
          ${dayCols.map((d, i) => `
            <div class="cal-tl-col${i === todayIdx ? ' cal-tl-col-today' : ''}">
              ${i === todayIdx ? `<div class="cal-tl-now" style="top:${nowTop}px"></div>` : ''}
              ${d.entries.map(e => renderSlot(e)).join('')}
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
  const scroll = el.querySelector('.cal-tl-scroll');
  if (scroll) {
    const allTimes = dayCols.flatMap(d => d.entries.map((e: any) => e.h * 60 + e.m));
    const earliest = allTimes.length ? Math.min(...allTimes) : 480;
    scroll.scrollTop = Math.max(0, (earliest / 60) * HOUR_H - 24);
  }
}

/* ── List view ────────────────────────────────────────────── */

function renderListRow(job: any): string {
  const st = job.state || {};
  const sched = job.schedule || {};
  const enabled = job.enabled !== false;
  const status = getJobStatus(job);
  const errors = st.consecutiveErrors || 0;
  const lastMs = st.lastRunAtMs;
  const nextMs = st.nextRunAtMs;
  const name = job.name || job.id || '';
  const days = parseCronDays(sched.expr);
  const run = _cronRunLabel(job);
  const isScript = job._isScript || run.type === 'script';
  const typeClass = isScript ? 'sched-row-type-script' : 'sched-row-type-agent';
  const eid = escHtml(job.id);
  return `<div class="sched-row sched-row-${status} ${typeClass}" onclick="showCronDetail('${eid}')">
    <div class="sched-row-status"><span class="cal-dot cal-dot-${status}"></span></div>
    <div class="sched-row-main">
      <div class="sched-row-top">
        <span class="sched-row-name">${escHtml(name)}</span>
        ${(() => { const r = _cronRunLabel(job); return r.type === 'script'
          ? `<span class="script-badge">\u2699 ${escHtml(r.label)}</span>`
          : `<span class="agent-badge">${escHtml(r.label)}</span>`; })()}
      </div>
      <div class="sched-row-desc">${escHtml(job.description || '')}</div>
    </div>
    <div class="sched-row-schedule">
      <code class="sched-row-expr">${escHtml(sched.expr || '\u2014')}</code>
      <span class="sched-row-human">${cronToHuman(sched.expr || '')}</span>
    </div>
    <div class="sched-row-days">
      ${SCHED_DAYS.map((d, i) => `<span class="sched-day-dot${days.includes(i) ? ' sched-day-on' : ''}">${d.charAt(0)}</span>`).join('')}
    </div>
    <div class="sched-row-timing">
      <div class="sched-row-meta">${lastMs ? `Last: ${timeAgo(new Date(lastMs).toISOString())}` : 'Never run'}</div>
      <div class="sched-row-meta">${nextMs ? `Next: ${timeAgo(new Date(nextMs).toISOString())}` : ''}</div>
      ${errors > 0 ? `<div class="sched-row-meta" style="color:var(--critical)" title="${escHtml(st.lastError || '')}">${errors} error${errors !== 1 ? 's' : ''} \u2014 ${escHtml(_friendlyError(st.lastError).slice(0, 60))}${_friendlyError(st.lastError).length > 60 ? '\u2026' : ''}</div>` : ''}
    </div>
    <div class="sched-row-actions" onclick="event.stopPropagation()">
      <button class="btn btn-ghost btn-xs" onclick="editCron('${eid}')" title="Edit">\u270E</button>
      <button class="btn btn-ghost btn-xs" onclick="triggerCron('${eid}')" title="Run now" ${!enabled ? 'disabled' : ''}>\u25B6</button>
      <button class="btn btn-ghost btn-xs" onclick="toggleCron('${eid}', ${!enabled})" title="${enabled ? 'Pause' : 'Resume'}">${enabled ? '\u23F8' : '\u25B6'}</button>
      ${job.protected ? '' : `<button class="btn btn-ghost btn-xs btn-danger-ghost" onclick="deleteCronConfirm('${eid}', '${escHtml(name)}', ${!!job._isScript})" title="Delete">\u2716</button>`}
    </div>
  </div>`;
}

export function renderList(cache: any) {
  const el = document.getElementById('schedule-list');
  if (!el) { return; }
  const jobs = [...(cache.openclaw || []), ...(cache.scripts || [])];
  if (!jobs.length) {
    el.innerHTML = '<div class="empty-msg">No cron jobs configured. Click "+ Add Cron" to create one.</div>';
    return;
  }
  const sorted = [...jobs].toSorted((a: any, b: any) => {
    const ae = (a.state?.consecutiveErrors || 0) > 0 ? 0 : 1;
    const be = (b.state?.consecutiveErrors || 0) > 0 ? 0 : 1;
    if (ae !== be) { return ae - be; }
    return (a.name || '').localeCompare(b.name || '');
  });
  const total = jobs.length;
  const active = jobs.filter((j: any) => j.enabled !== false).length;
  const errors = jobs.filter((j: any) => (j.state?.consecutiveErrors || 0) > 0).length;
  const disabled = jobs.filter((j: any) => j.enabled === false).length;
  const scriptCount = jobs.filter((j: any) => j._isScript || _cronRunLabel(j).type === 'script').length;
  const agentCount = jobs.length - scriptCount;

  el.innerHTML = `
    <div class="cal-bar">
      <div class="cal-stats">
        <span class="cal-stat">${total} jobs</span>
        <span class="cal-stat cal-stat-active">${active} active</span>
        ${errors ? `<span class="cal-stat cal-stat-error">${errors} failing</span>` : ''}
        ${disabled ? `<span class="cal-stat cal-stat-disabled">${disabled} paused</span>` : ''}
      </div>
      <div class="cal-legend">
        <span class="cal-legend-item"><span class="cal-dot cal-dot-ok"></span>Running OK</span>
        <span class="cal-legend-item"><span class="cal-dot cal-dot-error"></span>Failing</span>
        <span class="cal-legend-item"><span class="cal-dot cal-dot-idle"></span>Not run yet</span>
        <span class="cal-legend-item"><span class="cal-dot cal-dot-disabled"></span>Paused</span>
        <span class="cal-legend-sep"></span>
        <span class="cal-legend-item"><span class="cal-dot cal-dot-type-agent"></span>AI Agent (${agentCount})</span>
        <span class="cal-legend-item"><span class="cal-dot cal-dot-type-script"></span>Script \u2014 no AI cost (${scriptCount})</span>
      </div>
    </div>
    <div class="sched-list-rows">
      ${sorted.map((j: any) => renderListRow(j)).join('')}
    </div>
  `;
}

// Expose on window for schedule-cron-crud.ts orchestrator
(window as any).renderCalendar = renderCalendar;
(window as any).renderList = renderList;
