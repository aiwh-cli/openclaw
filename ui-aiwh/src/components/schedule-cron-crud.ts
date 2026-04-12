// Schedule Cron CRUD — orchestrator: shared state, init/load, model picker, agent cron CRUD.
// Owns _schedCache. Calls renderCalendar/renderList from schedule-cron-views.ts.

import { _cpPickerHTML, _cpBuildExpr, _cpParseCron, cronToHuman } from './schedule-cron-picker.js';
import { renderCalendar, renderList } from './schedule-cron-views.js';

const api = (window as any).api as (url: string, opts?: any) => Promise<any>;
const showToast = (window as any).showToast as (msg: string, type?: string) => void;
const showModal = (window as any).showModal as (html: string, cls?: string) => void;
const closeModal = (window as any).closeModal as () => void;
const escHtml = (window as any).escHtml as (s: string) => string;

/* ── Shared state ─────────────────────────────────────────── */

export const _schedCache: { openclaw: any[]; local: any[]; scripts: any[] } = { openclaw: [], local: [], scripts: [] };
let _schedTab = 'calendar';

/* ── Provider-aware model picker ──────────────────────────── */

let _availModelsCache: any = null;
async function _loadAvailableModels(): Promise<any> {
  if (_availModelsCache) { return _availModelsCache; }
  try { _availModelsCache = await api('/agents/models/available'); }
  catch { _availModelsCache = { models: [], providers: [] }; }
  return _availModelsCache;
}

function _modelOptionsHTML(currentModel: string): string {
  const data = _availModelsCache || { models: [], providers: [] };
  let html = `<option value="" ${!currentModel ? 'selected' : ''}>Agent default</option>`;
  const byProvider: Record<string, any[]> = {};
  for (const m of data.models || []) {
    const prov = m.provider || (m.id || '').split('/')[0] || 'unknown';
    if (!byProvider[prov]) { byProvider[prov] = []; }
    byProvider[prov].push(m);
  }
  const providerOrder = ['anthropic', 'openai-codex', 'openai', 'openrouter', 'ollama'];
  const sortedProviders = Object.keys(byProvider).toSorted((a, b) => {
    const ai = providerOrder.indexOf(a); const bi = providerOrder.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
  for (const prov of sortedProviders) {
    const models = byProvider[prov];
    if (!models?.length) { continue; }
    const label = prov.charAt(0).toUpperCase() + prov.slice(1);
    if (prov === 'openrouter') {
      const allFeatured = models.filter((m: any) => m.featured);
      const seenFamily = new Set<string>();
      const featured: any[] = [];
      for (const m of allFeatured) {
        const rawId = (m.id || '').replace('openrouter/', '');
        const family = rawId.replace(/[-.]?\d+$/, '').replace(/-(mini|nano|lite|pro|chat|preview|beta|thinking|flash).*$/i, '');
        if (seenFamily.has(family)) { continue; }
        seenFamily.add(family);
        featured.push(m);
        if (featured.length >= 15) { break; }
      }
      const rest = models.filter((m: any) => !m.featured);
      if (featured.length) {
        html += `<optgroup label="OpenRouter \u2014 Top Models (newest)">`;
        for (const m of featured) {
          const val = escHtml(m.id || '');
          const short = escHtml((m.name || m.id || '').replace(/^OpenRouter:\s*/i, ''));
          const cost = m.outputCost ? ` \u00b7 $${m.outputCost.toFixed(1)}/M` : '';
          const tierBadge = m.tier === 'fast' ? ' \u26A1' : m.tier === 'powerful' ? ' \uD83D\uDD25' : '';
          html += `<option value="${val}" ${currentModel === (m.id || '') ? 'selected' : ''}>${short}${tierBadge}${cost}</option>`;
        }
        html += `</optgroup>`;
      }
      if (rest.length) {
        html += `<optgroup label="OpenRouter \u2014 All (${models.length} total)">`;
        for (const m of rest.slice(0, 30)) {
          const val = escHtml(m.id || '');
          const short = escHtml((m.name || m.id || '').replace(/^OpenRouter:\s*/i, ''));
          html += `<option value="${val}" ${currentModel === (m.id || '') ? 'selected' : ''}>${short}</option>`;
        }
        if (rest.length > 30) { html += `<option disabled>... ${rest.length - 30} more</option>`; }
        html += `</optgroup>`;
      }
    } else {
      html += `<optgroup label="${escHtml(label)}">`;
      for (const m of models) {
        const val = escHtml(m.id || '');
        const name = escHtml(m.name || (m.id || '').split('/').pop() || '');
        const tierBadge = m.tier === 'fast' ? ' \u26A1' : m.tier === 'powerful' ? ' \uD83D\uDD25' : '';
        html += `<option value="${val}" ${currentModel === (m.id || '') ? 'selected' : ''}>${name}${tierBadge}</option>`;
      }
      html += `</optgroup>`;
    }
  }
  return html;
}

/* ── Init / Load ──────────────────────────────────────────── */

function _normalizeScriptJob(sj: any): any {
  const lr = sj.lastRun;
  return {
    id: sj.id, name: sj.name, description: sj.description || '', agentId: null,
    enabled: sj.enabled === 1, _isScript: true, _scriptPath: sj.script_path,
    schedule: { expr: sj.cron_expr, tz: sj.timezone || 'Australia/Brisbane' },
    payload: { kind: 'script', message: sj.script_path }, sessionTarget: null,
    state: {
      lastRunAtMs: lr?.started_at ? new Date(lr.started_at).getTime() : null,
      lastRunStatus: lr?.status || null, lastDurationMs: lr?.duration_ms || null,
      consecutiveErrors: lr?.status === 'error' ? 1 : 0,
      lastError: lr?.status === 'error' ? (lr.output || `Script exited with code ${lr.exit_code ?? 'unknown'}`) : null,
    },
  };
}

async function initSchedule() { await loadSchedule(); }

export async function loadSchedule() {
  const sched = await api('/schedules');
  // Mutate in-place so exported ref + window ref stay valid
  _schedCache.openclaw = sched?.openclaw || [];
  _schedCache.local = sched?.local || [];
  _schedCache.scripts = (sched?.scripts || []).map(_normalizeScriptJob);
  (window as any)._schedCache = _schedCache;
  renderSchedView();
}

function switchSchedTab(tab: string) {
  _schedTab = tab;
  document.querySelectorAll('.sched-tabs .log-tab').forEach((b: any) => {
    b.classList.toggle('active', b.dataset.schedTab === tab);
  });
  renderSchedView();
}

function renderSchedView() {
  if (_schedTab === 'list') { renderList(_schedCache); }
  else { renderCalendar(_schedCache); }
}

/* ── Agent Cron CRUD ──────────────────────────────────────── */

async function triggerCron(jobId: string) {
  const r = await api(`/cron/${jobId}/trigger`, { method: 'POST' });
  if (r?.ok) { showToast('Cron triggered'); }
  else { showToast('Failed: ' + (r?.error || 'unknown'), 'error'); }
}

async function editCron(jobId: string) {
  const [sched] = await Promise.all([api('/schedules'), _loadAvailableModels()]);
  const job = (sched?.openclaw || []).find((j: any) => j.id === jobId);
  if (!job) { return showToast('Job not found', 'error'); }
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
          <select id="cron-edit-model" class="cp-input">${_modelOptionsHTML(model)}</select>
        </div>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:4px;">
        <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button class="btn btn-success" onclick="saveCronEdit('${escHtml(jobId)}')">Save</button>
      </div>
    </div>
  `;
  showModal(html, 'modal-md');
}

async function saveCronEdit(jobId: string) {
  const expr = _cpBuildExpr();
  const tz = (document.getElementById('cron-edit-tz') as HTMLInputElement)?.value?.trim();
  const desc = (document.getElementById('cron-edit-desc') as HTMLInputElement)?.value?.trim();
  const message = (document.getElementById('cron-edit-message') as HTMLTextAreaElement)?.value?.trim();
  const session = (document.getElementById('cron-edit-session') as HTMLSelectElement)?.value;
  const model = (document.getElementById('cron-edit-model') as HTMLSelectElement)?.value;
  const r = await api(`/cron/${jobId}/edit`, {
    method: 'POST',
    body: { cron: expr || undefined, tz: tz || undefined, description: desc || undefined, message: message || undefined, session: session || undefined, model: model || undefined },
  });
  if (r?.ok) { showToast('Cron updated'); closeModal(); await loadSchedule(); }
  else { showToast('Failed: ' + (r?.error || 'unknown'), 'error'); }
}

async function showAddCron() {
  const state = { freq: 'once', times: ['09:00'], days: [0, 1, 2, 3, 4, 5, 6] };
  const [agentsData] = await Promise.all([api('/agents'), _loadAvailableModels()]);
  const agents = (agentsData?.agents || []).filter((a: any) => a.inConfig).toSorted((a: any, b: any) => {
    if (a.id === 'main') { return -1; } if (b.id === 'main') { return 1; }
    return a.id.localeCompare(b.id);
  });
  const agentOptions = agents.map((a: any) =>
    `<option value="${escHtml(a.id)}" ${a.id === 'main' ? 'selected' : ''}>${escHtml(a.displayName || a.id)}</option>`
  ).join('');
  const html = `
    <h3 style="margin:0 0 12px;font-size:14px;">Add Cron Job</h3>
    <div class="cp-form">
      <div class="cp-field"><label class="cp-label">Name</label>
        <input id="cron-add-name" class="cp-input" placeholder="com.aiwh.my-job"></div>
      <div class="cp-field"><label class="cp-label">Agent</label>
        <select id="cron-add-agent" class="cp-input">${agentOptions}</select></div>
      ${_cpPickerHTML(state)}
      <div class="cp-field"><label class="cp-label">Timezone</label>
        <input id="cron-add-tz" class="cp-input" value="Australia/Brisbane"></div>
      <div class="cp-field"><label class="cp-label">Message (agent prompt)</label>
        <textarea id="cron-add-message" class="cp-input cp-textarea" placeholder="What the agent should do..."></textarea></div>
      <div class="cp-field"><label class="cp-label">Description</label>
        <input id="cron-add-desc" class="cp-input" placeholder="What this cron does"></div>
      <div style="display:flex;gap:12px;">
        <div class="cp-field" style="flex:1"><label class="cp-label">Session mode</label>
          <select id="cron-add-session" class="cp-input">
            <option value="isolated" selected>Isolated (fresh each run)</option>
            <option value="main">Main (shared context)</option>
          </select></div>
        <div class="cp-field" style="flex:1"><label class="cp-label">Model override</label>
          <select id="cron-add-model" class="cp-input">${_modelOptionsHTML('')}</select></div>
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
  const name = (document.getElementById('cron-add-name') as HTMLInputElement)?.value?.trim();
  const agent = (document.getElementById('cron-add-agent') as HTMLSelectElement)?.value?.trim();
  const cron = _cpBuildExpr();
  const tz = (document.getElementById('cron-add-tz') as HTMLInputElement)?.value?.trim();
  const message = (document.getElementById('cron-add-message') as HTMLTextAreaElement)?.value?.trim();
  const description = (document.getElementById('cron-add-desc') as HTMLInputElement)?.value?.trim();
  const session = (document.getElementById('cron-add-session') as HTMLSelectElement)?.value;
  const model = (document.getElementById('cron-add-model') as HTMLSelectElement)?.value;
  const isolated = session === 'isolated';
  if (!name || !cron || !message) { return showToast('Name, cron expression, and message are required', 'error'); }
  const r = await api('/cron/add', {
    method: 'POST', body: { name, agent, cron, tz, message, description, isolated, model: model || undefined },
  });
  if (r?.ok) { showToast('Cron created'); closeModal(); await api('/cron/sync'); await loadSchedule(); }
  else { showToast('Failed: ' + (r?.error || 'unknown'), 'error'); }
}

async function toggleCron(jobId: string, enable?: boolean) {
  const r = await api(`/cron/${jobId}/toggle`, { method: 'POST', body: { enabled: enable } });
  if (r?.ok) { showToast(enable ? 'Cron enabled' : 'Cron paused'); await loadSchedule(); }
  else { showToast('Failed: ' + (r?.error || 'unknown'), 'error'); }
}

// Expose on window
(window as any)._schedCache = _schedCache;
(window as any).initSchedule = initSchedule;
(window as any).loadSchedule = loadSchedule;
(window as any).switchSchedTab = switchSchedTab;
(window as any).triggerCron = triggerCron;
(window as any).editCron = editCron;
(window as any).saveCronEdit = saveCronEdit;
(window as any).showAddCron = showAddCron;
(window as any).addCron = addCron;
(window as any).toggleCron = toggleCron;
(window as any)._loadAvailableModels = _loadAvailableModels;
(window as any)._modelOptionsHTML = _modelOptionsHTML;
