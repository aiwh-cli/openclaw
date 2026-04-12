// Schedule Cron Picker — cron expression parsing, expansion, and visual builder widget.
// Shared by schedule-cron-crud.ts, schedule-script-cron.ts, and schedule-templates.ts.
// Exposed on window for inline onclick handlers in generated HTML.

const escHtml = (window as any).escHtml as (s: string) => string;

export const SCHED_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/* ── Cron field expansion ─────────────────────────────────── */

function _expandField(field: string, min: number, max: number): number[] {
  if (field === '*') {
    const a: number[] = [];
    for (let i = min; i <= max; i++) { a.push(i); }
    return a;
  }
  const vals = new Set<number>();
  field.split(',').forEach(seg => {
    if (seg.includes('/')) {
      const [range, step] = seg.split('/');
      const s = parseInt(step);
      const start = range === '*' ? min : parseInt(range);
      for (let i = start; i <= max; i += s) { vals.add(i); }
    } else if (seg.includes('-')) {
      const [a, b] = seg.split('-').map(Number);
      for (let i = a; i <= b; i++) { vals.add(i); }
    } else {
      vals.add(parseInt(seg));
    }
  });
  return [...vals].toSorted((a, b) => a - b);
}

export function expandCronTimes(expr: string): Array<{ h: number; m: number }> {
  const p = (expr || '').trim().split(/\s+/);
  if (p.length < 2) { return []; }
  const [minF, hourF] = p;
  const hours = _expandField(hourF, 0, 23);
  const mins = _expandField(minF, 0, 59);
  if (hours.length * mins.length > 48) {
    return hours.map(h => ({ h, m: 0 }));
  }
  const times: Array<{ h: number; m: number }> = [];
  for (const h of hours) {
    for (const m of mins) { times.push({ h, m }); }
  }
  return times.toSorted((a, b) => (a.h * 60 + a.m) - (b.h * 60 + b.m));
}

/* ── Cron day / time helpers ──────────────────────────────── */

function _cronDayToIdx(d: number): number {
  d = d % 7;
  return d === 0 ? 6 : d - 1;
}

export function parseCronDays(expr: string): number[] {
  const p = (expr || '').trim().split(/\s+/);
  if (p.length < 5) { return [0, 1, 2, 3, 4, 5, 6]; }
  const dow = p[4];
  if (dow === '*' || dow === '?') { return [0, 1, 2, 3, 4, 5, 6]; }
  const days = new Set<number>();
  dow.split(',').forEach(seg => {
    if (seg.includes('/')) {
      const step = parseInt(seg.split('/')[1]) || 1;
      for (let i = 0; i <= 6; i += step) { days.add(_cronDayToIdx(i)); }
    } else if (seg.includes('-')) {
      const [a, b] = seg.split('-').map(Number);
      for (let i = a; i <= b; i++) { days.add(_cronDayToIdx(i)); }
    } else {
      days.add(_cronDayToIdx(parseInt(seg)));
    }
  });
  return [...days].toSorted((a, b) => a - b);
}

export function parseCronTime(expr: string): string {
  const p = (expr || '').trim().split(/\s+/);
  if (p.length < 2) { return '??'; }
  const [min, hour] = p;
  if (min.startsWith('*/')) { return `Every ${min.slice(2)}m`; }
  if (hour.startsWith('*/')) {
    const m = min === '0' ? '' : `:${min.padStart(2, '0')}`;
    return `Every ${hour.slice(2)}h${m}`;
  }
  if (hour === '*') { return min === '*' ? 'Every min' : `xx:${min.padStart(2, '0')}`; }
  const pad = (v: string) => String(v === '0' ? '00' : v).padStart(2, '0');
  if (hour.includes(',')) {
    return hour.split(',').map(h => `${h.padStart(2, '0')}:${pad(min)}`).join(', ');
  }
  return `${hour.padStart(2, '0')}:${pad(min)}`;
}

export function cronToHuman(expr: string): string {
  const p = (expr || '').trim().split(/\s+/);
  if (p.length < 5) { return expr; }
  const [, , dom, , dow] = p;
  const time = parseCronTime(expr);
  let freq = '';
  if (dow === '*' && dom === '*') { freq = 'daily'; }
  else if (dow === '1-5') { freq = 'weekdays'; }
  else if (dow === '0,6' || dow === '6,0') { freq = 'weekends'; }
  else if (dom !== '*') { freq = `day ${dom} of month`; }
  return freq ? `${time}, ${freq}` : time;
}

/* ── Cron picker state parsing ────────────────────────────── */
interface CpState {
  freq: string;
  times?: string[];
  days: number[];
  interval?: number;
  startMin?: number;
}

export function _cpParseCron(expr: string): CpState {
  const p = (expr || '').trim().split(/\s+/);
  if (p.length < 5) { return { freq: 'once', times: ['09:00'], days: [0, 1, 2, 3, 4, 5, 6] }; }
  const [min, hour] = p;
  const days = parseCronDays(expr);

  if (min.startsWith('*/'))
    { return { freq: 'every-m', interval: parseInt(min.slice(2)), days }; }
  if (hour.startsWith('*/'))
    { return { freq: 'every-h', interval: parseInt(hour.slice(2)), startMin: parseInt(min) || 0, days }; }
  if (hour.includes(',')) {
    const m = String(parseInt(min) || 0).padStart(2, '0');
    return { freq: 'multi', times: hour.split(',').map(h => `${h.padStart(2, '0')}:${m}`), days };
  }
  const h = String(parseInt(hour) || 0).padStart(2, '0');
  const m = String(parseInt(min) || 0).padStart(2, '0');
  return { freq: 'once', times: [`${h}:${m}`], days };
}

/* ── Build expression from DOM ────────────────────────────── */
export function _cpBuildExpr(): string {
  const freq = (document.getElementById('cp-freq') as HTMLSelectElement)?.value || 'once';
  const days = _cpGetDays();
  const dow = days.length === 7 ? '*' : days.map(d => d === 6 ? 0 : d + 1).toSorted((a: number, b: number) => a - b).join(',');

  switch (freq) {
    case 'once': {
      const [h, m] = ((document.getElementById('cp-time-0') as HTMLInputElement)?.value || '09:00').split(':');
      return `${parseInt(m)} ${parseInt(h)} * * ${dow}`;
    }
    case 'multi': {
      const inputs = document.querySelectorAll('.cp-time-input') as NodeListOf<HTMLInputElement>;
      const times = [...inputs].map(i => i.value).filter(Boolean).toSorted();
      if (!times.length) { return `0 9 * * ${dow}`; }
      const m = parseInt(times[0].split(':')[1]) || 0;
      const hours = [...new Set(times.map(t => parseInt(t.split(':')[0])))].toSorted((a, b) => a - b);
      return `${m} ${hours.join(',')} * * ${dow}`;
    }
    case 'every-h': {
      const n = (document.getElementById('cp-interval') as HTMLSelectElement)?.value || '2';
      const sm = (document.getElementById('cp-start-min') as HTMLSelectElement)?.value || '0';
      return `${sm} */${n} * * ${dow}`;
    }
    case 'every-m': {
      const n = (document.getElementById('cp-interval') as HTMLSelectElement)?.value || '30';
      return `*/${n} * * * ${dow}`;
    }
  }
  return '0 9 * * *';
}

/* ── Build expression from state (before DOM exists) ──────── */
export function _cpBuildExprFromState(state: CpState): string {
  const { freq, times, days, interval, startMin } = state;
  const dow = days.length === 7 ? '*' : days.map(d => d === 6 ? 0 : d + 1).toSorted((a: number, b: number) => a - b).join(',');
  switch (freq) {
    case 'once': {
      const [h, m] = ((times?.[0]) || '09:00').split(':');
      return `${parseInt(m)} ${parseInt(h)} * * ${dow}`;
    }
    case 'multi': {
      const m = parseInt(((times?.[0]) || '08:00').split(':')[1]) || 0;
      const hours = [...new Set((times || []).map(t => parseInt(t.split(':')[0])))].toSorted((a, b) => a - b);
      return `${m} ${hours.join(',')} * * ${dow}`;
    }
    case 'every-h': return `${startMin || 0} */${interval || 2} * * ${dow}`;
    case 'every-m': return `*/${interval || 30} * * * ${dow}`;
  }
  return '0 9 * * *';
}

/* ── DOM helpers ──────────────────────────────────────────── */

function _cpGetDays(): number[] {
  const pills = document.querySelectorAll('.cp-day-pill');
  const days: number[] = [];
  pills.forEach((p, i) => { if (p.classList.contains('day-pill-on')) { days.push(i); } });
  return days;
}

function _cpToggleDay(el: HTMLElement) {
  el.classList.toggle('day-pill-on');
  _cpUpdatePreview();
}

function _cpUpdatePreview() {
  const pre = document.getElementById('cp-preview');
  if (pre) {
    const expr = _cpBuildExpr();
    pre.textContent = expr;
    const human = document.getElementById('cp-human');
    if (human) { human.textContent = cronToHuman(expr); }
  }
}

function _cpFreqChanged() {
  const freq = (document.getElementById('cp-freq') as HTMLSelectElement)?.value || 'once';
  const sections = ['once', 'multi', 'every'];
  sections.forEach(s => {
    const el = document.getElementById(`cp-section-${s}`);
    if (el) { el.style.display = 'none'; }
  });
  if (freq === 'once') { document.getElementById('cp-section-once')!.style.display = ''; }
  else if (freq === 'multi') { document.getElementById('cp-section-multi')!.style.display = ''; }
  else { document.getElementById('cp-section-every')!.style.display = ''; }

  const lbl = document.getElementById('cp-interval-label');
  if (lbl) { lbl.textContent = freq === 'every-h' ? 'hours' : 'minutes'; }
  const sel = document.getElementById('cp-interval') as HTMLSelectElement | null;
  if (sel) {
    const opts = freq === 'every-h' ? [1, 2, 3, 4, 6, 8, 12] : [5, 10, 15, 20, 30];
    sel.innerHTML = opts.map(v => `<option value="${v}">${v}</option>`).join('');
    sel.value = freq === 'every-h' ? '2' : '30';
  }
  _cpUpdatePreview();
}

/* ── Custom Time Picker ───────────────────────────────────── */

function _cpTimeHTML(id: string | null, value: string, extraClass: string): string {
  const [h, m] = (value || '09:00').split(':').map(v => parseInt(v) || 0);
  const hh = String(h).padStart(2, '0');
  const mm = String(Math.round(m / 5) * 5 % 60).padStart(2, '0');

  const hours = Array.from({ length: 24 }, (_, i) => {
    const v = String(i).padStart(2, '0');
    return `<div class="cp-tp-opt${i === h ? ' cp-tp-sel' : ''}" data-v="${i}" onclick="_cpPickH(this)">${v}</div>`;
  }).join('');

  const mins = Array.from({ length: 12 }, (_, i) => {
    const val = i * 5;
    const v = String(val).padStart(2, '0');
    const snap = Math.round(m / 5) * 5 % 60;
    return `<div class="cp-tp-opt${val === snap ? ' cp-tp-sel' : ''}" data-v="${val}" onclick="_cpPickM(this)">${v}</div>`;
  }).join('');

  return `<div class="cp-tp" data-cptp>
    <input type="hidden" ${id ? `id="${escHtml(id)}"` : ''} class="${escHtml(extraClass || '')}" value="${hh}:${mm}">
    <button type="button" class="cp-tp-btn" onclick="_cpToggleTP(this)">${hh}:${mm}</button>
    <div class="cp-tp-drop">
      <div class="cp-tp-col" data-role="h">${hours}</div>
      <div class="cp-tp-sep">:</div>
      <div class="cp-tp-col" data-role="m">${mins}</div>
    </div>
  </div>`;
}

function _cpToggleTP(btn: HTMLElement) {
  const tp = btn.closest('[data-cptp]')!;
  const drop = tp.querySelector('.cp-tp-drop')!;
  const wasOpen = drop.classList.contains('cp-tp-open');
  document.querySelectorAll('.cp-tp-drop.cp-tp-open').forEach(d => d.classList.remove('cp-tp-open'));
  if (!wasOpen) {
    drop.classList.add('cp-tp-open');
    setTimeout(() => {
      drop.querySelectorAll('.cp-tp-sel').forEach(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    }, 10);
  }
}

function _cpPickH(el: HTMLElement) {
  const col = el.closest('.cp-tp-col')!;
  col.querySelectorAll('.cp-tp-opt').forEach(o => o.classList.remove('cp-tp-sel'));
  el.classList.add('cp-tp-sel');
  _cpSyncTP(el.closest('[data-cptp]')!);
}

function _cpPickM(el: HTMLElement) {
  const col = el.closest('.cp-tp-col')!;
  col.querySelectorAll('.cp-tp-opt').forEach(o => o.classList.remove('cp-tp-sel'));
  el.classList.add('cp-tp-sel');
  _cpSyncTP(el.closest('[data-cptp]')!);
}

function _cpSyncTP(tp: Element) {
  const h = (tp.querySelector('[data-role="h"] .cp-tp-sel') as HTMLElement)?.dataset.v || '0';
  const m = (tp.querySelector('[data-role="m"] .cp-tp-sel') as HTMLElement)?.dataset.v || '0';
  const val = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  (tp.querySelector('input[type="hidden"]') as HTMLInputElement).value = val;
  tp.querySelector('.cp-tp-btn')!.textContent = val;
  _cpUpdatePreview();
}

// Close time pickers when clicking outside
document.addEventListener('click', (e) => {
  if (!(e.target as HTMLElement).closest('[data-cptp]')) {
    document.querySelectorAll('.cp-tp-drop.cp-tp-open').forEach(d => d.classList.remove('cp-tp-open'));
  }
});

function cpAddTime() {
  const list = document.getElementById('cp-times-list');
  if (!list) { return; }
  const row = document.createElement('div');
  row.className = 'cp-time-row';
  row.innerHTML = `${_cpTimeHTML(null, '12:00', 'cp-time-input')}
    <button class="btn btn-ghost btn-xs" onclick="this.parentElement.remove();_cpUpdatePreview()" title="Remove">\u2715</button>`;
  list.appendChild(row);
  _cpUpdatePreview();
}

/* ── Picker form HTML ─────────────────────────────────────── */

export function _cpPickerHTML(state: CpState): string {
  const { freq, times, days, interval, startMin } = state;
  const isOnce = freq === 'once';
  const isMulti = freq === 'multi';
  const isEvery = freq === 'every-h' || freq === 'every-m';
  const intOpts = (freq === 'every-h' ? [1, 2, 3, 4, 6, 8, 12] : [5, 10, 15, 20, 30]);

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
            ${[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map(v => `<option value="${v}" ${v === (startMin || 0) ? 'selected' : ''}>:${String(v).padStart(2, '0')}</option>`).join('')}
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

// Expose on window for inline onclick handlers in generated HTML
(window as any)._cpPickerHTML = _cpPickerHTML;
(window as any)._cpBuildExpr = _cpBuildExpr;
(window as any)._cpBuildExprFromState = _cpBuildExprFromState;
(window as any)._cpParseCron = _cpParseCron;
(window as any)._cpFreqChanged = _cpFreqChanged;
(window as any)._cpToggleDay = _cpToggleDay;
(window as any)._cpUpdatePreview = _cpUpdatePreview;
(window as any)._cpToggleTP = _cpToggleTP;
(window as any)._cpPickH = _cpPickH;
(window as any)._cpPickM = _cpPickM;
(window as any).cpAddTime = cpAddTime;
