// ─── Schedule View: OpenClaw Crons & Shared Infrastructure ───────────
// This file contains:
//   - Shared state, constants, and init/load functions
//   - Cron field expansion & time parsing helpers
//   - Calendar and list view rendering
//   - Cron detail modal and run history display
//   - Cron picker widget (shared by agent and script cron forms)
//   - OpenClaw agent cron CRUD (trigger, edit, add, toggle, delete)
//
// Loaded FIRST — provides globals used by schedule-scripts.js.

// ─── Provider-aware model picker ──────────────────────────────
// Uses /api/agents/models/available — credential-driven, includes OpenRouter catalog
let _availModelsCache = null;
async function _loadAvailableModels() {
  if (_availModelsCache) {return _availModelsCache;}
  try { _availModelsCache = await api('/agents/models/available'); } catch { _availModelsCache = { models: [], providers: [] }; }
  return _availModelsCache;
}
function _modelOptionsHTML(currentModel) {
  const data = _availModelsCache || { models: [], providers: [] };
  let html = `<option value="" ${!currentModel ? 'selected' : ''}>Agent default</option>`;

  // Group models by provider
  const byProvider = {};
  for (const m of data.models || []) {
    const prov = m.provider || (m.id || '').split('/')[0] || 'unknown';
    if (!byProvider[prov]) {byProvider[prov] = [];}
    byProvider[prov].push(m);
  }

  // Provider display order — show installed providers first
  const providerOrder = ['anthropic', 'openai-codex', 'openai', 'openrouter', 'ollama'];
  const sortedProviders = Object.keys(byProvider).toSorted((a, b) => {
    const ai = providerOrder.indexOf(a); const bi = providerOrder.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  for (const prov of sortedProviders) {
    const models = byProvider[prov];
    if (!models?.length) {continue;}
    const label = prov.charAt(0).toUpperCase() + prov.slice(1);

    if (prov === 'openrouter') {
      // Split into featured (newest flagships) and rest
      // Pick 1 best (newest) per provider family, then cap at 15
      const allFeatured = models.filter(m => m.featured);
      const seenFamily = new Set();
      const featured = [];
      for (const m of allFeatured) {
        // Extract family: "openai/gpt-5.4-mini" → "openai/gpt-5.4", "anthropic/claude-opus-4.6" → "anthropic/claude-opus"
        const rawId = (m.id || '').replace('openrouter/', '');
        const family = rawId.replace(/[-.]?\d+$/, '').replace(/-(mini|nano|lite|pro|chat|preview|beta|thinking|flash).*$/i, '');
        if (seenFamily.has(family)) {continue;}
        seenFamily.add(family);
        featured.push(m);
        if (featured.length >= 15) {break;}
      }
      const rest = models.filter(m => !m.featured);
      if (featured.length) {
        html += `<optgroup label="OpenRouter — Top Models (newest)">`;
        for (const m of featured) {
          const val = m.id || '';
          const short = (m.name || val).replace(/^OpenRouter:\s*/i, '');
          const cost = m.outputCost ? ` · $${m.outputCost.toFixed(1)}/M` : '';
          const tierBadge = m.tier === 'fast' ? ' ⚡' : m.tier === 'powerful' ? ' 🔥' : '';
          html += `<option value="${val}" ${currentModel === val ? 'selected' : ''}>${short}${tierBadge}${cost}</option>`;
        }
        html += `</optgroup>`;
      }
      if (rest.length) {
        html += `<optgroup label="OpenRouter — All (${models.length} total)">`;
        for (const m of rest.slice(0, 30)) {
          const val = m.id || '';
          const short = (m.name || val).replace(/^OpenRouter:\s*/i, '');
          html += `<option value="${val}" ${currentModel === val ? 'selected' : ''}>${short}</option>`;
        }
        if (rest.length > 30) {html += `<option disabled>... ${rest.length - 30} more</option>`;}
        html += `</optgroup>`;
      }
    } else {
      html += `<optgroup label="${label}">`;
      for (const m of models) {
        const val = m.id || '';
        const name = m.name || val.split('/').pop();
        const tierBadge = m.tier === 'fast' ? ' ⚡' : m.tier === 'powerful' ? ' 🔥' : '';
        html += `<option value="${val}" ${currentModel === val ? 'selected' : ''}>${name}${tierBadge}</option>`;
      }
      html += `</optgroup>`;
    }
  }
  return html;
}

const SCHED_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HOUR_H = 96;   // pixels per hour row (spacious, 15-min = 24px)
const CARD_H = 22;   // card height (1-liner)
const CARD_GAP = 2;  // gap between stacked cards

let _schedCache = { openclaw: [], local: [], scripts: [] };
let _schedTab = 'calendar';

async function initSchedule() {
  await loadSchedule();
}

async function loadSchedule() {
  const sched = await api('/schedules');
  _schedCache = {
    openclaw: sched?.openclaw || [],
    local: sched?.local || [],
    scripts: (sched?.scripts || []).map(_normalizeScriptJob),
  };
  renderSchedView();
}

// Normalize script cron to look like an OpenClaw job for shared rendering
function _normalizeScriptJob(sj) {
  const lr = sj.lastRun;
  return {
    id: sj.id,
    name: sj.name,
    description: sj.description || '',
    agentId: null,
    enabled: sj.enabled === 1,
    _isScript: true,
    _scriptPath: sj.script_path,
    schedule: { expr: sj.cron_expr, tz: sj.timezone || 'Australia/Brisbane' },
    payload: { kind: 'script', message: sj.script_path },
    sessionTarget: null,
    state: {
      lastRunAtMs: lr?.started_at ? new Date(lr.started_at).getTime() : null,
      lastRunStatus: lr?.status || null,
      lastDurationMs: lr?.duration_ms || null,
      consecutiveErrors: lr?.status === 'error' ? 1 : 0,
      lastError: lr?.status === 'error' ? (lr.output || `Script exited with code ${lr.exit_code ?? 'unknown'}`) : null,
    },
  };
}

function switchSchedTab(tab) {
  _schedTab = tab;
  document.querySelectorAll('.sched-tabs .log-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.schedTab === tab);
  });
  renderSchedView();
}

function renderSchedView() {
  if (_schedTab === 'list') {renderList();}
  else {renderCalendar();}
}

/* ── Cron field expansion ─────────────────────────────────── */

function _expandField(field, min, max) {
  if (field === '*') {
    const a = [];
    for (let i = min; i <= max; i++) {a.push(i);}
    return a;
  }
  const vals = new Set();
  field.split(',').forEach(seg => {
    if (seg.includes('/')) {
      const [range, step] = seg.split('/');
      const s = parseInt(step);
      const start = range === '*' ? min : parseInt(range);
      for (let i = start; i <= max; i += s) {vals.add(i);}
    } else if (seg.includes('-')) {
      const [a, b] = seg.split('-').map(Number);
      for (let i = a; i <= b; i++) {vals.add(i);}
    } else {
      vals.add(parseInt(seg));
    }
  });
  return [...vals].toSorted((a, b) => a - b);
}

// Expand cron expr -> array of {h, m} for every run in a day
function expandCronTimes(expr) {
  const p = (expr || '').trim().split(/\s+/);
  if (p.length < 2) {return [];}
  const [minF, hourF] = p;
  const hours = _expandField(hourF, 0, 23);
  const mins = _expandField(minF, 0, 59);
  // Cap: if too many combos, collapse minutes to just :00
  if (hours.length * mins.length > 48) {
    return hours.map(h => ({ h, m: 0 }));
  }
  const times = [];
  for (const h of hours) {
    for (const m of mins) {times.push({ h, m });}
  }
  return times.toSorted((a, b) => (a.h * 60 + a.m) - (b.h * 60 + b.m));
}

/* ── Cron day / time helpers ──────────────────────────────── */

function _cronDayToIdx(d) {
  d = d % 7;
  return d === 0 ? 6 : d - 1;
}

function parseCronDays(expr) {
  const p = (expr || '').trim().split(/\s+/);
  if (p.length < 5) {return [0, 1, 2, 3, 4, 5, 6];}
  const dow = p[4];
  if (dow === '*' || dow === '?') {return [0, 1, 2, 3, 4, 5, 6];}
  const days = new Set();
  dow.split(',').forEach(seg => {
    if (seg.includes('/')) {
      const step = parseInt(seg.split('/')[1]) || 1;
      for (let i = 0; i <= 6; i += step) {days.add(_cronDayToIdx(i));}
    } else if (seg.includes('-')) {
      const [a, b] = seg.split('-').map(Number);
      for (let i = a; i <= b; i++) {days.add(_cronDayToIdx(i));}
    } else {
      days.add(_cronDayToIdx(parseInt(seg)));
    }
  });
  return [...days].toSorted((a, b) => a - b);
}

function parseCronTime(expr) {
  const p = (expr || '').trim().split(/\s+/);
  if (p.length < 2) {return '??';}
  const [min, hour] = p;
  if (min.startsWith('*/')) {return `Every ${min.slice(2)}m`;}
  if (hour.startsWith('*/')) {
    const m = min === '0' ? '' : `:${min.padStart(2, '0')}`;
    return `Every ${hour.slice(2)}h${m}`;
  }
  if (hour === '*') {return min === '*' ? 'Every min' : `xx:${min.padStart(2, '0')}`;}
  const pad = v => String(v === '0' ? '00' : v).padStart(2, '0');
  if (hour.includes(',')) {
    return hour.split(',').map(h => `${h.padStart(2, '0')}:${pad(min)}`).join(', ');
  }
  return `${hour.padStart(2, '0')}:${pad(min)}`;
}

function cronToHuman(expr) {
  const p = (expr || '').trim().split(/\s+/);
  if (p.length < 5) {return expr;}
  const [, , dom, , dow] = p;
  const time = parseCronTime(expr);
  let freq = '';
  if (dow === '*' && dom === '*') {freq = 'daily';}
  else if (dow === '1-5') {freq = 'weekdays';}
  else if (dow === '0,6' || dow === '6,0') {freq = 'weekends';}
  else if (dom !== '*') {freq = `day ${dom} of month`;}
  return freq ? `${time}, ${freq}` : time;
}

/* ── Status ───────────────────────────────────────────────── */

function getJobStatus(job) {
  if (job.enabled === false) {return 'disabled';}
  if ((job.state?.consecutiveErrors || 0) > 0) {return 'error';}
  if (job.state?.lastRunStatus === 'ok') {return 'ok';}
  return 'idle';
}

const _statusLabels = { ok: 'Healthy', error: 'Failing', disabled: 'Paused', idle: 'Idle' };

function _friendlyError(err) {
  if (!err) {return '';}
  const e = String(err);
  if (e.includes('rate_limit') || e.includes('usage limits'))
    {return 'Your API key has reached its usage limit. Check your Anthropic account billing to increase your limit or wait for it to reset.';}
  if (e.includes('authentication') || e.includes('invalid.*key') || e.includes('401'))
    {return 'Your API key appears to be invalid or expired. Go to Config to update it.';}
  if (e.includes('timeout') || e.includes('ETIMEDOUT'))
    {return 'The request timed out. This usually means a temporary network issue — it should resolve on the next run.';}
  if (e.includes('ECONNREFUSED') || e.includes('connection refused'))
    {return 'Could not connect to the AI service. Check your internet connection.';}
  if (e.includes('insufficient_quota') || e.includes('billing'))
    {return 'Your API account needs more credits. Add funds at your AI provider\'s billing page.';}
  if (e.includes('overloaded') || e.includes('529'))
    {return 'The AI service is temporarily overloaded. The next run should work fine.';}
  if (e.includes('No such file') || e.includes('not found') || e.includes('exit code 127'))
    {return 'The script file could not be found. It may have been moved or deleted.';}
  if (e.includes('Permission denied') || e.includes('exit code 126'))
    {return 'The script does not have permission to run. Contact support.';}
  if (e.match(/exit.*code\s*(unknown|null)/i) || e === 'Script exited with code unknown')
    {return 'The script timed out or crashed without producing output. It may be taking too long to complete. Try running it manually from the Schedule view to see if it works.';}
  if (e === '' || e === 'Script exited with code ')
    {return 'The script failed but did not report why. Try running it manually to see the result.';}
  if (e.match(/exit.*code\s*\d+/) && !e.includes('exit code 0'))
    {return 'The script encountered an error. Click "History" for details.';}
  // Fallback: show the raw error but trimmed
  return e.length > 300 ? e.slice(0, 300) + '…' : e;
}

/* ── Timeline calendar rendering ──────────────────────────── */

function renderCalendar() {
  const el = document.getElementById('schedule-list');
  if (!el) {return;}
  const jobs = [..._schedCache.openclaw, ..._schedCache.scripts].filter(j => j.schedule?.expr);

  if (!jobs.length) {
    el.innerHTML = '<div class="empty-msg">No cron jobs configured. Click "+ Add Cron" to create one.</div>';
    return;
  }

  const total = jobs.length;
  const active = jobs.filter(j => j.enabled !== false).length;
  const errors = jobs.filter(j => (j.state?.consecutiveErrors || 0) > 0).length;
  const disabled = jobs.filter(j => j.enabled === false).length;
  const now = new Date();
  const todayIdx = (now.getDay() + 6) % 7;
  const totalH = 24 * HOUR_H;

  // Calculate actual dates for this week (Mon-Sun)
  const weekDates = SCHED_DAYS.map((_, di) => {
    const d = new Date(now);
    d.setDate(d.getDate() - todayIdx + di);
    return d.getDate();
  });

  // Build entries per day column — collapse multi-run crons into single card
  const MULTI_RUN_THRESHOLD = 3; // collapse if more than 3 runs/day
  const dayCols = SCHED_DAYS.map((name, di) => {
    const entries = [];
    jobs.forEach(job => {
      if (!parseCronDays(job.schedule?.expr).includes(di)) {return;}
      const times = expandCronTimes(job.schedule.expr);
      if (times.length === 0) {
        entries.push({ job, h: 0, m: 0 }); // fallback: show at midnight
      } else if (times.length > MULTI_RUN_THRESHOLD) {
        entries.push({ job, h: times[0].h, m: times[0].m, freq: times.length });
      } else {
        times.forEach(t => entries.push({ job, h: t.h, m: t.m }));
      }
    });
    // Sort by time of day
    entries.sort((a, b) => (a.h * 60 + a.m) - (b.h * 60 + b.m));
    // Group entries within same 30-min window into slots, place side-by-side (up to 3 per row)
    const SLOT_WINDOW = 30; // minutes — groups 8:00 and 8:15 together
    const COLS = 3;
    const slots = [];
    for (const e of entries) {
      const eMin = e.h * 60 + e.m;
      const last = slots[slots.length - 1];
      if (last && eMin - last.baseMin < SLOT_WINDOW) {
        last.items.push(e);
      } else {
        slots.push({ baseMin: eMin, baseH: e.h, baseM: e.m, items: [e] });
      }
    }
    // Position: up to COLS side-by-side, overflow to next row
    let nextFreeTop = 0;
    for (const slot of slots) {
      const idealTop = slot.baseH * HOUR_H + (slot.baseM / 60) * HOUR_H;
      const top = Math.max(idealTop, nextFreeTop);
      const rowCount = Math.ceil(slot.items.length / COLS);
      slot.items.forEach((e, si) => {
        const row = Math.floor(si / COLS);
        e.top = top + row * (CARD_H + CARD_GAP);
        e.colIdx = si % COLS;
        const itemsInRow = Math.min(slot.items.length - row * COLS, COLS);
        e.colCount = itemsInRow;
      });
      nextFreeTop = top + rowCount * (CARD_H + CARD_GAP);
    }
    return { name, entries };
  });

  // Hour ruler
  const ruler = Array.from({ length: 24 }, (_, h) =>
    `<div class="cal-tl-tick" style="top:${h * HOUR_H}px">${String(h).padStart(2, '0')}:00</div>`
  ).join('');

  // Current time marker
  const nowTop = (now.getHours() * 60 + now.getMinutes()) / 60 * HOUR_H;
  const scriptCount = jobs.filter(j => j._isScript || _cronRunLabel(j).type === 'script').length;
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
        <span class="cal-legend-item"><span class="cal-dot cal-dot-type-script"></span>Script — no AI cost (${scriptCount})</span>
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

  // Auto-scroll to first card area (with some breathing room above)
  const scroll = el.querySelector('.cal-tl-scroll');
  if (scroll) {
    const allTimes = dayCols.flatMap(d => d.entries.map(e => e.h * 60 + e.m));
    const earliest = allTimes.length ? Math.min(...allTimes) : 480;
    scroll.scrollTop = Math.max(0, (earliest / 60) * HOUR_H - 24);
  }
}

function _cronRunLabel(job) {
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

function renderSlot(entry) {
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
  const tooltip = `${escHtml(name)} — ${time}${freq ? ` (${freq}x/day)` : ''}${job.description ? '\n' + escHtml(job.description) : ''}`;

  return `<div class="cal-tl-card cal-tl-${status} ${typeClass}" style="top:${top}px;${sizeStyle}" onclick="showCronDetail('${job.id}')" title="${tooltip}">
    <span class="cal-tl-name">${escHtml(name)}</span>
    ${freqBadge}
  </div>`;
}

/* ── List view ────────────────────────────────────────────── */

function renderList() {
  const el = document.getElementById('schedule-list');
  if (!el) {return;}
  const jobs = [..._schedCache.openclaw, ..._schedCache.scripts];

  if (!jobs.length) {
    el.innerHTML = '<div class="empty-msg">No cron jobs configured. Click "+ Add Cron" to create one.</div>';
    return;
  }

  // Sort: errors first, then by name
  const sorted = [...jobs].toSorted((a, b) => {
    const ae = (a.state?.consecutiveErrors || 0) > 0 ? 0 : 1;
    const be = (b.state?.consecutiveErrors || 0) > 0 ? 0 : 1;
    if (ae !== be) {return ae - be;}
    return (a.name || '').localeCompare(b.name || '');
  });

  const total = jobs.length;
  const active = jobs.filter(j => j.enabled !== false).length;
  const errors = jobs.filter(j => (j.state?.consecutiveErrors || 0) > 0).length;
  const disabled = jobs.filter(j => j.enabled === false).length;
  const scriptCount = jobs.filter(j => j._isScript || _cronRunLabel(j).type === 'script').length;
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
        <span class="cal-legend-item"><span class="cal-dot cal-dot-type-script"></span>Script — no AI cost (${scriptCount})</span>
      </div>
    </div>
    <div class="sched-list-rows">
      ${sorted.map(j => renderListRow(j)).join('')}
    </div>
  `;
}

function renderListRow(job) {
  const st = job.state || {};
  const sched = job.schedule || {};
  const enabled = job.enabled !== false;
  const status = getJobStatus(job);
  const errors = st.consecutiveErrors || 0;
  const lastMs = st.lastRunAtMs;
  const nextMs = st.nextRunAtMs;
  const name = job.name || job.id || '';
  const days = parseCronDays(sched.expr);
  const allDays = days.length === 7;

  const run = _cronRunLabel(job);
  const isScript = job._isScript || run.type === 'script';
  const typeClass = isScript ? 'sched-row-type-script' : 'sched-row-type-agent';
  return `<div class="sched-row sched-row-${status} ${typeClass}" onclick="showCronDetail('${job.id}')">
    <div class="sched-row-status">
      <span class="cal-dot cal-dot-${status}"></span>
    </div>
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
      ${errors > 0 ? `<div class="sched-row-meta" style="color:var(--critical)" title="${escHtml(st.lastError || '')}">${errors} error${errors !== 1 ? 's' : ''} — ${escHtml(_friendlyError(st.lastError).slice(0, 60))}${_friendlyError(st.lastError).length > 60 ? '…' : ''}</div>` : ''}
    </div>
    <div class="sched-row-actions" onclick="event.stopPropagation()">
      <button class="btn btn-ghost btn-xs" onclick="editCron('${job.id}')" title="Edit">\u270E</button>
      <button class="btn btn-ghost btn-xs" onclick="triggerCron('${job.id}')" title="Run now" ${!enabled ? 'disabled' : ''}>\u25B6</button>
      <button class="btn btn-ghost btn-xs" onclick="toggleCron('${job.id}', ${!enabled})" title="${enabled ? 'Pause' : 'Resume'}">${enabled ? '\u23F8' : '\u25B6'}</button>
      <button class="btn btn-ghost btn-xs btn-danger-ghost" onclick="deleteCronConfirm('${job.id}', '${escHtml(name)}', ${!!job._isScript})" title="Delete">\u2716</button>
    </div>
  </div>`;
}

/* ── Detail modal ─────────────────────────────────────────── */

function showCronDetail(jobId) {
  const job = ([..._schedCache.openclaw, ..._schedCache.scripts]).find(j => j.id === jobId);
  if (!job) {return showToast('Job not found', 'error');}
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
        <button class="btn btn-ghost btn-danger-ghost" onclick="deleteCronConfirm('${job.id}', '${escHtml(job.name || job.id)}', ${!!job._isScript})" title="Delete">\u2716 Delete</button>
        <span style="flex:1"></span>
        <button class="btn btn-ghost" onclick="showCronRuns('${job.id}', ${!!job._isScript})" title="Run History">\u23F3 History</button>
        <button class="btn btn-ghost" onclick="${job._isScript ? `editScriptCron('${job.id}')` : `editCron('${job.id}')`}">\u270E Edit</button>
        <button class="btn btn-ghost" onclick="triggerCronFromDetail('${job.id}', ${!!job._isScript})" ${!enabled ? 'disabled' : ''}>\u25B6 Run Now</button>
        <button class="btn btn-ghost" onclick="toggleCronFromDetail('${job.id}', ${!enabled}, ${!!job._isScript})">${enabled ? '\u23F8 Pause' : '\u25B6 Resume'}</button>
      </div>
    </div>
  `;
  showModal(html, 'modal-md');
}

async function triggerCronFromDetail(jobId, isScript) {
  closeModal();
  if (isScript) {
    const r = await api(`/script-crons/${jobId}/trigger`, { method: 'POST' });
    if (r?.ok) {showToast('Script triggered');}
    else {showToast('Failed: ' + (r?.error || 'unknown'), 'error');}
  } else {
    await triggerCron(jobId);
  }
}

async function toggleCronFromDetail(jobId, enable, isScript) {
  closeModal();
  if (isScript) {
    const r = await api(`/script-crons/${jobId}`, { method: 'PUT', body: { enabled: enable ? 1 : 0 } });
    if (r?.ok) { showToast(enable ? 'Script cron enabled' : 'Script cron paused'); await loadSchedule(); }
    else {showToast('Failed: ' + (r?.error || 'unknown'), 'error');}
  } else {
    await toggleCron(jobId, enable);
  }
}

/* ── Delete cron ──────────────────────────────────────────── */

async function deleteCronConfirm(jobId, name, isScript) {
  closeModal();
  const ok = await dashConfirm(`Delete cron job "${name}"?\n\nThis cannot be undone.`);
  if (!ok) {return;}
  const endpoint = isScript ? `/script-crons/${jobId}` : `/cron/${jobId}`;
  const r = await api(endpoint, { method: 'DELETE' });
  if (r?.ok) {
    showToast('Cron deleted');
    await loadSchedule();
  } else {
    showToast('Failed: ' + (r?.error || 'unknown'), 'error');
  }
}

/* ── Run History ──────────────────────────────────────────── */

async function showCronRuns(jobId, isScript) {
  closeModal();
  const job = ([..._schedCache.openclaw, ..._schedCache.scripts]).find(j => j.id === jobId);
  const name = job?.name || jobId;

  showModal(`<div class="cron-detail"><div style="text-align:center;padding:24px;color:var(--text-dim)">Loading run history\u2026</div></div>`, 'modal-lg');

  let entries, total;
  if (isScript) {
    const data = await api(`/script-crons/${jobId}/runs?limit=15`);
    const runs = data?.runs || [];
    total = runs.length;
    // Normalize script runs to same shape
    entries = runs.map(r => ({
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
        <button class="btn btn-ghost" onclick="showCronDetail('${jobId}')">\u2190 Back</button>
      </div>
    </div>`, 'modal-lg');
    return;
  }

  const rows = entries.map(e => {
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
      <button class="btn btn-ghost" onclick="showCronDetail('${jobId}')">\u2190 Back</button>
    </div>
  </div>`, 'modal-lg');
}

/* ── Cron Picker ──────────────────────────────────────────── */
// Visual schedule builder that generates cron expressions.
// Shared by both agent cron and script cron forms.

function _cpParseCron(expr) {
  const p = (expr || '').trim().split(/\s+/);
  if (p.length < 5) {return { freq: 'once', times: ['09:00'], days: [0,1,2,3,4,5,6] };}
  const [min, hour, , , dow] = p;
  const days = parseCronDays(expr);

  if (min.startsWith('*/'))
    {return { freq: 'every-m', interval: parseInt(min.slice(2)), days };}
  if (hour.startsWith('*/'))
    {return { freq: 'every-h', interval: parseInt(hour.slice(2)), startMin: parseInt(min) || 0, days };}
  if (hour.includes(',')) {
    const m = String(parseInt(min) || 0).padStart(2, '0');
    return { freq: 'multi', times: hour.split(',').map(h => `${h.padStart(2,'0')}:${m}`), days };
  }
  const h = String(parseInt(hour) || 0).padStart(2, '0');
  const m = String(parseInt(min) || 0).padStart(2, '0');
  return { freq: 'once', times: [`${h}:${m}`], days };
}

function _cpBuildExpr() {
  const freq = document.getElementById('cp-freq')?.value || 'once';
  const days = _cpGetDays();
  const dow = days.length === 7 ? '*' : days.map(d => d === 6 ? 0 : d + 1).toSorted((a,b) => a-b).join(',');

  switch (freq) {
    case 'once': {
      const [h, m] = (document.getElementById('cp-time-0')?.value || '09:00').split(':');
      return `${parseInt(m)} ${parseInt(h)} * * ${dow}`;
    }
    case 'multi': {
      const inputs = document.querySelectorAll('.cp-time-input');
      const times = [...inputs].map(i => i.value).filter(Boolean).toSorted();
      if (!times.length) {return `0 9 * * ${dow}`;}
      const m = parseInt(times[0].split(':')[1]) || 0;
      const hours = [...new Set(times.map(t => parseInt(t.split(':')[0])))].toSorted((a,b) => a-b);
      return `${m} ${hours.join(',')} * * ${dow}`;
    }
    case 'every-h': {
      const n = document.getElementById('cp-interval')?.value || '2';
      const sm = document.getElementById('cp-start-min')?.value || '0';
      return `${sm} */${n} * * ${dow}`;
    }
    case 'every-m': {
      const n = document.getElementById('cp-interval')?.value || '30';
      return `*/${n} * * * ${dow}`;
    }
  }
  return '0 9 * * *';
}

function _cpGetDays() {
  const pills = document.querySelectorAll('.cp-day-pill');
  const days = [];
  pills.forEach((p, i) => { if (p.classList.contains('day-pill-on')) {days.push(i);} });
  return days;
}

function _cpToggleDay(el) {
  el.classList.toggle('day-pill-on');
  _cpUpdatePreview();
}

function _cpUpdatePreview() {
  const pre = document.getElementById('cp-preview');
  if (pre) {
    const expr = _cpBuildExpr();
    pre.textContent = expr;
    const human = document.getElementById('cp-human');
    if (human) {human.textContent = cronToHuman(expr);}
  }
}

function _cpFreqChanged() {
  const freq = document.getElementById('cp-freq')?.value || 'once';
  const sections = ['once', 'multi', 'every'];
  sections.forEach(s => {
    const el = document.getElementById(`cp-section-${s}`);
    if (el) {el.style.display = 'none';}
  });
  if (freq === 'once') {document.getElementById('cp-section-once').style.display = '';}
  else if (freq === 'multi') {document.getElementById('cp-section-multi').style.display = '';}
  else {document.getElementById('cp-section-every').style.display = '';}

  // Update interval label
  const lbl = document.getElementById('cp-interval-label');
  if (lbl) {lbl.textContent = freq === 'every-h' ? 'hours' : 'minutes';}
  // Update interval options
  const sel = document.getElementById('cp-interval');
  if (sel) {
    const opts = freq === 'every-h' ? [1,2,3,4,6,8,12] : [5,10,15,20,30];
    sel.innerHTML = opts.map(v => `<option value="${v}">${v}</option>`).join('');
    sel.value = freq === 'every-h' ? '2' : '30';
  }
  _cpUpdatePreview();
}

/* ── Custom Time Picker ────────────────────────────────────── */
// Replaces native <input type="time"> with a styled dual-column picker.

function _cpTimeHTML(id, value, extraClass) {
  const [h, m] = (value || '09:00').split(':').map(v => parseInt(v) || 0);
  const hh = String(h).padStart(2, '0');
  const mm = String(Math.round(m / 5) * 5 % 60).padStart(2, '0');

  const hours = Array.from({length: 24}, (_, i) => {
    const v = String(i).padStart(2, '0');
    return `<div class="cp-tp-opt${i === h ? ' cp-tp-sel' : ''}" data-v="${i}" onclick="_cpPickH(this)">${v}</div>`;
  }).join('');

  const mins = Array.from({length: 12}, (_, i) => {
    const val = i * 5;
    const v = String(val).padStart(2, '0');
    const snap = Math.round(m / 5) * 5 % 60;
    return `<div class="cp-tp-opt${val === snap ? ' cp-tp-sel' : ''}" data-v="${val}" onclick="_cpPickM(this)">${v}</div>`;
  }).join('');

  return `<div class="cp-tp" data-cptp>
    <input type="hidden" ${id ? `id="${id}"` : ''} class="${extraClass || ''}" value="${hh}:${mm}">
    <button type="button" class="cp-tp-btn" onclick="_cpToggleTP(this)">${hh}:${mm}</button>
    <div class="cp-tp-drop">
      <div class="cp-tp-col" data-role="h">${hours}</div>
      <div class="cp-tp-sep">:</div>
      <div class="cp-tp-col" data-role="m">${mins}</div>
    </div>
  </div>`;
}

function _cpToggleTP(btn) {
  const tp = btn.closest('[data-cptp]');
  const drop = tp.querySelector('.cp-tp-drop');
  const wasOpen = drop.classList.contains('cp-tp-open');
  // Close all open pickers first
  document.querySelectorAll('.cp-tp-drop.cp-tp-open').forEach(d => d.classList.remove('cp-tp-open'));
  if (!wasOpen) {
    drop.classList.add('cp-tp-open');
    // Scroll selected items into view
    setTimeout(() => {
      drop.querySelectorAll('.cp-tp-sel').forEach(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    }, 10);
  }
}

function _cpPickH(el) {
  const col = el.closest('.cp-tp-col');
  col.querySelectorAll('.cp-tp-opt').forEach(o => o.classList.remove('cp-tp-sel'));
  el.classList.add('cp-tp-sel');
  _cpSyncTP(el.closest('[data-cptp]'));
}

function _cpPickM(el) {
  const col = el.closest('.cp-tp-col');
  col.querySelectorAll('.cp-tp-opt').forEach(o => o.classList.remove('cp-tp-sel'));
  el.classList.add('cp-tp-sel');
  _cpSyncTP(el.closest('[data-cptp]'));
}

function _cpSyncTP(tp) {
  const h = tp.querySelector('[data-role="h"] .cp-tp-sel')?.dataset.v || '0';
  const m = tp.querySelector('[data-role="m"] .cp-tp-sel')?.dataset.v || '0';
  const val = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  tp.querySelector('input[type="hidden"]').value = val;
  tp.querySelector('.cp-tp-btn').textContent = val;
  _cpUpdatePreview();
}

// Close time pickers when clicking outside
document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-cptp]')) {
    document.querySelectorAll('.cp-tp-drop.cp-tp-open').forEach(d => d.classList.remove('cp-tp-open'));
  }
});

function cpAddTime() {
  const list = document.getElementById('cp-times-list');
  if (!list) {return;}
  const row = document.createElement('div');
  row.className = 'cp-time-row';
  row.innerHTML = `${_cpTimeHTML(null, '12:00', 'cp-time-input')}
    <button class="btn btn-ghost btn-xs" onclick="this.parentElement.remove();_cpUpdatePreview()" title="Remove">\u2715</button>`;
  list.appendChild(row);
  _cpUpdatePreview();
}

function _cpPickerHTML(state) {
  const { freq, times, days, interval, startMin } = state;
  const isOnce = freq === 'once';
  const isMulti = freq === 'multi';
  const isEvery = freq === 'every-h' || freq === 'every-m';
  const intOpts = (freq === 'every-h' ? [1,2,3,4,6,8,12] : [5,10,15,20,30]);

  return `
    <div class="cp-field">
      <label class="cp-label">Frequency</label>
      <select id="cp-freq" class="cp-input" onchange="_cpFreqChanged()">
        <option value="once" ${freq === 'once' ? 'selected' : ''}>Once a day</option>
        <option value="multi" ${freq === 'multi' ? 'selected' : ''}>Multiple times a day</option>
        <option value="every-h" ${freq === 'every-h' ? 'selected' : ''}>Every N hours</option>
        <option value="every-m" ${freq === 'every-m' ? 'selected' : ''}>Every N minutes</option>
      </select>
    </div>

    <div id="cp-section-once" class="cp-field" style="${isOnce ? '' : 'display:none'}">
      <label class="cp-label">Time</label>
      ${_cpTimeHTML('cp-time-0', (times && times[0]) || '09:00', '')}
    </div>

    <div id="cp-section-multi" class="cp-field" style="${isMulti ? '' : 'display:none'}">
      <label class="cp-label">Times</label>
      <div id="cp-times-list">
        ${(times || ['08:00', '14:00']).map((t, i) => `
          <div class="cp-time-row">
            ${_cpTimeHTML(null, t, 'cp-time-input')}
            ${i > 0 ? `<button class="btn btn-ghost btn-xs" onclick="this.parentElement.remove();_cpUpdatePreview()" title="Remove">\u2715</button>` : ''}
          </div>
        `).join('')}
      </div>
      <button class="btn btn-ghost btn-xs" onclick="cpAddTime()" style="align-self:flex-start;margin-top:4px;">+ Add time</button>
    </div>

    <div id="cp-section-every" class="cp-field" style="${isEvery ? '' : 'display:none'}">
      <label class="cp-label">Interval</label>
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:11px;color:var(--text-muted);">Every</span>
        <select id="cp-interval" class="cp-input" style="width:auto;" onchange="_cpUpdatePreview()">
          ${intOpts.map(v => `<option value="${v}" ${v === (interval || intOpts[0]) ? 'selected' : ''}>${v}</option>`).join('')}
        </select>
        <span id="cp-interval-label" style="font-size:11px;color:var(--text-muted);">${freq === 'every-m' ? 'minutes' : 'hours'}</span>
      </div>
      ${freq === 'every-h' ? `
        <div style="margin-top:6px;">
          <label class="cp-label">Starting at minute</label>
          <select id="cp-start-min" class="cp-input" style="width:auto;" onchange="_cpUpdatePreview()">
            ${[0,5,10,15,20,25,30,35,40,45,50,55].map(v => `<option value="${v}" ${v === (startMin || 0) ? 'selected' : ''}>:${String(v).padStart(2,'0')}</option>`).join('')}
          </select>
        </div>
      ` : `<input type="hidden" id="cp-start-min" value="0">`}
    </div>

    <div class="cp-field">
      <label class="cp-label">Days</label>
      <div class="cp-days">
        ${SCHED_DAYS.map((d, i) => `<span class="day-pill cp-day-pill${days.includes(i) ? ' day-pill-on' : ''}" onclick="_cpToggleDay(this)">${d}</span>`).join('')}
      </div>
    </div>

    <div class="cp-preview-box">
      <span class="cp-label">Expression</span>
      <code id="cp-preview">${_cpBuildExprFromState(state)}</code>
      <span id="cp-human" class="cp-human">${cronToHuman(_cpBuildExprFromState(state))}</span>
    </div>
  `;
}

// Build expr from state object (before DOM exists)
function _cpBuildExprFromState(state) {
  const { freq, times, days, interval, startMin } = state;
  const dow = days.length === 7 ? '*' : days.map(d => d === 6 ? 0 : d + 1).toSorted((a,b) => a-b).join(',');
  switch (freq) {
    case 'once': {
      const [h, m] = (times[0] || '09:00').split(':');
      return `${parseInt(m)} ${parseInt(h)} * * ${dow}`;
    }
    case 'multi': {
      const m = parseInt((times[0] || '08:00').split(':')[1]) || 0;
      const hours = [...new Set(times.map(t => parseInt(t.split(':')[0])))].toSorted((a,b) => a-b);
      return `${m} ${hours.join(',')} * * ${dow}`;
    }
    case 'every-h': return `${startMin || 0} */${interval || 2} * * ${dow}`;
    case 'every-m': return `*/${interval || 30} * * * ${dow}`;
  }
  return '0 9 * * *';
}

/* ── OpenClaw Agent Cron CRUD ─────────────────────────────── */

async function triggerCron(jobId) {
  const r = await api(`/cron/${jobId}/trigger`, { method: 'POST' });
  if (r?.ok) {showToast('Cron triggered');}
  else {showToast('Failed: ' + (r?.error || 'unknown'), 'error');}
}

async function editCron(jobId) {
  const [sched] = await Promise.all([api('/schedules'), _loadAvailableModels()]);
  const job = (sched?.openclaw || []).find(j => j.id === jobId);
  if (!job) {return showToast('Job not found', 'error');}

  const state = _cpParseCron(job.schedule?.expr || '');
  const tz = job.schedule?.tz || 'Australia/Brisbane';
  const desc = job.description || '';
  const pl = job.payload || {};
  const msg = pl.message || '';
  const sessionTarget = job.sessionTarget || 'main';
  const model = pl.model || '';

  const html = `
    <h3 style="margin:0 0 12px;font-size:14px;">Edit: ${escHtml(job.name)}</h3>
    <div class="cp-form">
      ${_cpPickerHTML(state)}
      <div class="cp-field">
        <label class="cp-label">Message (agent prompt)</label>
        <textarea id="cron-edit-message" class="cp-input cp-textarea" style="min-height:80px">${escHtml(msg)}</textarea>
      </div>
      <div class="cp-field">
        <label class="cp-label">Timezone</label>
        <input id="cron-edit-tz" class="cp-input" value="${escHtml(tz)}">
      </div>
      <div class="cp-field">
        <label class="cp-label">Description</label>
        <input id="cron-edit-desc" class="cp-input" value="${escHtml(desc)}">
      </div>
      <div style="display:flex;gap:12px;">
        <div class="cp-field" style="flex:1">
          <label class="cp-label">Agent</label>
          <input class="cp-input" value="${escHtml(job.agentId || '')}" disabled style="opacity:0.5;">
        </div>
        <div class="cp-field" style="flex:1">
          <label class="cp-label">Session mode</label>
          <select id="cron-edit-session" class="cp-input">
            <option value="main" ${sessionTarget === 'main' ? 'selected' : ''}>Main (shared context)</option>
            <option value="isolated" ${sessionTarget === 'isolated' ? 'selected' : ''}>Isolated (fresh each run)</option>
          </select>
        </div>
        <div class="cp-field" style="flex:1">
          <label class="cp-label">Model override</label>
          <select id="cron-edit-model" class="cp-input">
            ${_modelOptionsHTML(model)}
          </select>
        </div>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:4px;">
        <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button class="btn btn-success" onclick="saveCronEdit('${jobId}')">Save</button>
      </div>
    </div>
  `;
  showModal(html, 'modal-md');
}

async function saveCronEdit(jobId) {
  const expr = _cpBuildExpr();
  const tz = document.getElementById('cron-edit-tz')?.value?.trim();
  const desc = document.getElementById('cron-edit-desc')?.value?.trim();
  const message = document.getElementById('cron-edit-message')?.value?.trim();
  const session = document.getElementById('cron-edit-session')?.value;
  const model = document.getElementById('cron-edit-model')?.value;

  const r = await api(`/cron/${jobId}/edit`, {
    method: 'POST',
    body: {
      cron: expr || undefined,
      tz: tz || undefined,
      description: desc || undefined,
      message: message || undefined,
      session: session || undefined,
      model: model || undefined,
    },
  });
  if (r?.ok) {
    showToast('Cron updated');
    closeModal();
    await loadSchedule();
  } else {
    showToast('Failed: ' + (r?.error || 'unknown'), 'error');
  }
}

async function showAddCron() {
  const state = { freq: 'once', times: ['09:00'], days: [0,1,2,3,4,5,6] };
  const [agentsData] = await Promise.all([api('/agents'), _loadAvailableModels()]);
  const agents = (agentsData?.agents || []).filter(a => a.inConfig).toSorted((a, b) => {
    if (a.id === 'main') {return -1;}
    if (b.id === 'main') {return 1;}
    return a.id.localeCompare(b.id);
  });
  const agentOptions = agents.map(a =>
    `<option value="${escHtml(a.id)}" ${a.id === 'main' ? 'selected' : ''}>${escHtml(a.displayName || a.id)}</option>`
  ).join('');
  const html = `
    <h3 style="margin:0 0 12px;font-size:14px;">Add Cron Job</h3>
    <div class="cp-form">
      <div class="cp-field">
        <label class="cp-label">Name</label>
        <input id="cron-add-name" class="cp-input" placeholder="com.aiwh.my-job">
      </div>
      <div class="cp-field">
        <label class="cp-label">Agent</label>
        <select id="cron-add-agent" class="cp-input">${agentOptions}</select>
      </div>
      ${_cpPickerHTML(state)}
      <div class="cp-field">
        <label class="cp-label">Timezone</label>
        <input id="cron-add-tz" class="cp-input" value="Australia/Brisbane">
      </div>
      <div class="cp-field">
        <label class="cp-label">Message (agent prompt)</label>
        <textarea id="cron-add-message" class="cp-input cp-textarea" placeholder="What the agent should do..."></textarea>
      </div>
      <div class="cp-field">
        <label class="cp-label">Description</label>
        <input id="cron-add-desc" class="cp-input" placeholder="What this cron does">
      </div>
      <div style="display:flex;gap:12px;">
        <div class="cp-field" style="flex:1">
          <label class="cp-label">Session mode</label>
          <select id="cron-add-session" class="cp-input">
            <option value="isolated" selected>Isolated (fresh each run)</option>
            <option value="main">Main (shared context)</option>
          </select>
        </div>
        <div class="cp-field" style="flex:1">
          <label class="cp-label">Model override</label>
          <select id="cron-add-model" class="cp-input">
            ${_modelOptionsHTML('')}
          </select>
        </div>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:4px;">
        <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button class="btn btn-success" onclick="addCron()">Create</button>
      </div>
    </div>
  `;
  showModal(html, 'modal-md');
}

async function addCron() {
  const name = document.getElementById('cron-add-name')?.value?.trim();
  const agent = document.getElementById('cron-add-agent')?.value?.trim();
  const cron = _cpBuildExpr();
  const tz = document.getElementById('cron-add-tz')?.value?.trim();
  const message = document.getElementById('cron-add-message')?.value?.trim();
  const description = document.getElementById('cron-add-desc')?.value?.trim();
  const session = document.getElementById('cron-add-session')?.value;
  const model = document.getElementById('cron-add-model')?.value;
  const isolated = session === 'isolated';

  if (!name || !cron || !message) {return showToast('Name, cron expression, and message are required', 'error');}

  const r = await api('/cron/add', {
    method: 'POST',
    body: { name, agent, cron, tz, message, description, isolated, model: model || undefined },
  });
  if (r?.ok) {
    showToast('Cron created');
    closeModal();
    await api('/cron/sync'); // Force cache refresh before loading
    await loadSchedule();
  } else {
    showToast('Failed: ' + (r?.error || 'unknown'), 'error');
  }
}

async function toggleCron(jobId, enable) {
  const r = await api(`/cron/${jobId}/toggle`, { method: 'POST', body: { enabled: enable } });
  if (r?.ok) {
    showToast(enable ? 'Cron enabled' : 'Cron paused');
    await loadSchedule();
  } else {
    showToast('Failed: ' + (r?.error || 'unknown'), 'error');
  }
}
