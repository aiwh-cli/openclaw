// Schedule Script Cron — modal utility functions for script cron CRUD.
// Exposed on window so schedule-cron-crud.ts and inline onclick handlers can call them.

import { _cpPickerHTML, _cpBuildExpr, _cpParseCron } from './schedule-cron-picker.js';
import { _schedCache, loadSchedule } from './schedule-cron-crud.js';

const api = (window as any).api as (url: string, opts?: any) => Promise<any>;
const showToast = (window as any).showToast as (msg: string, type?: string) => void;
const showModal = (window as any).showModal as (html: string, cls?: string) => void;
const closeModal = (window as any).closeModal as () => void;
const escHtml = (window as any).escHtml as (s: string) => string;

export function showAddScriptCron() {
  const state = { freq: 'once', times: ['09:00'], days: [0,1,2,3,4,5,6] };
  const html = `
    <h3 style="margin:0 0 12px;font-size:14px;">Add Script Cron <span style="font-size:10px;color:var(--success);font-weight:400;">$0 cost</span></h3>
    <div class="cp-form">
      <div class="cp-field">
        <label class="cp-label">Name</label>
        <input id="sc-add-name" class="cp-input" placeholder="my-backup-job">
      </div>
      <div class="cp-field">
        <label class="cp-label">Script path</label>
        <input id="sc-add-path" class="cp-input" placeholder="/opt/AIWH/core/scripts/my-script.sh">
      </div>
      ${_cpPickerHTML(state)}
      <div class="cp-field">
        <label class="cp-label">Timezone</label>
        <input id="sc-add-tz" class="cp-input" value="Australia/Brisbane">
      </div>
      <div class="cp-field">
        <label class="cp-label">Description</label>
        <input id="sc-add-desc" class="cp-input" placeholder="What this script does">
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:4px;">
        <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button class="btn btn-success" onclick="addScriptCron()">Create</button>
      </div>
    </div>
  `;
  showModal(html, 'modal-md');
}

export async function addScriptCron() {
  const name = (document.getElementById('sc-add-name') as HTMLInputElement)?.value?.trim();
  const script_path = (document.getElementById('sc-add-path') as HTMLInputElement)?.value?.trim();
  const cron_expr = _cpBuildExpr();
  const timezone = (document.getElementById('sc-add-tz') as HTMLInputElement)?.value?.trim();
  const description = (document.getElementById('sc-add-desc') as HTMLInputElement)?.value?.trim();

  if (!name || !script_path || !cron_expr) { return showToast('Name, script path, and schedule are required', 'error'); }

  const r = await api('/script-crons', {
    method: 'POST',
    body: { name, script_path, cron_expr, timezone, description },
  });
  if (r?.ok) {
    showToast('Script cron created');
    closeModal();
    await loadSchedule();
  } else {
    showToast('Failed: ' + (r?.error || 'unknown'), 'error');
  }
}

export async function editScriptCron(jobId: string) {
  const job = _schedCache.scripts.find((j: any) => j.id === jobId);
  if (!job) { return showToast('Script cron not found', 'error'); }

  const state = _cpParseCron(job.schedule?.expr || '');
  const tz = job.schedule?.tz || 'Australia/Brisbane';

  const html = `
    <h3 style="margin:0 0 12px;font-size:14px;">Edit Script: ${escHtml(job.name)} <span style="font-size:10px;color:var(--success);font-weight:400;">$0 cost</span></h3>
    <div class="cp-form">
      <div class="cp-field">
        <label class="cp-label">Script path</label>
        <input id="sc-edit-path" class="cp-input" value="${escHtml(job._scriptPath || '')}">
      </div>
      ${_cpPickerHTML(state)}
      <div class="cp-field">
        <label class="cp-label">Timezone</label>
        <input id="sc-edit-tz" class="cp-input" value="${escHtml(tz)}">
      </div>
      <div class="cp-field">
        <label class="cp-label">Description</label>
        <input id="sc-edit-desc" class="cp-input" value="${escHtml(job.description || '')}">
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:4px;">
        <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button class="btn btn-success" onclick="saveScriptCronEdit('${escHtml(jobId)}')">Save</button>
      </div>
    </div>
  `;
  showModal(html, 'modal-md');
}

export async function saveScriptCronEdit(jobId: string) {
  const script_path = (document.getElementById('sc-edit-path') as HTMLInputElement)?.value?.trim();
  const cron_expr = _cpBuildExpr();
  const timezone = (document.getElementById('sc-edit-tz') as HTMLInputElement)?.value?.trim();
  const description = (document.getElementById('sc-edit-desc') as HTMLInputElement)?.value?.trim();

  const r = await api(`/script-crons/${jobId}`, {
    method: 'PUT',
    body: { script_path, cron_expr, timezone, description },
  });
  if (r?.ok) {
    showToast('Script cron updated');
    closeModal();
    await loadSchedule();
  } else {
    showToast('Failed: ' + (r?.error || 'unknown'), 'error');
  }
}

// Expose on window for inline onclick handlers in generated HTML
(window as any).showAddScriptCron = showAddScriptCron;
(window as any).addScriptCron = addScriptCron;
(window as any).editScriptCron = editScriptCron;
(window as any).saveScriptCronEdit = saveScriptCronEdit;
