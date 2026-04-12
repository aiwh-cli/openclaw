// Workflow Catalogue — browse, activate, and manage AI workflow pipelines.
// Grid of template cards + active workflow list. Exposed on window.

const api = (window as any).api as (url: string, opts?: any) => Promise<any>;
const showToast = (window as any).showToast as (msg: string, type?: string) => void;
const escHtml = (window as any).escHtml as (s: string) => string;

const MODULE_META: Record<string, { icon: string; color: string }> = {
  frontend: { icon: '🎬', color: 'var(--magenta, #ff00e5)' },
  backend:  { icon: '📊', color: 'var(--accent, #C9A84C)' },
  system:   { icon: '⚙️', color: 'var(--cyan, #00e5ff)' },
};

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  queued:    { label: 'Queued',    cls: 'wf-badge-queued' },
  running:   { label: 'Running',   cls: 'wf-badge-running' },
  succeeded: { label: 'Complete',  cls: 'wf-badge-success' },
  failed:    { label: 'Failed',    cls: 'wf-badge-fail' },
  blocked:   { label: 'Blocked',   cls: 'wf-badge-fail' },
  cancelled: { label: 'Cancelled', cls: 'wf-badge-muted' },
};

let _activeWorkflows: any[] = [];

function _triggersLabel(tpl: any): string {
  const triggers = tpl.triggers || [];
  if (!triggers.length) return 'Manual only';
  const defaults = triggers.filter((t: any) => t.default);
  if (defaults.length === 1) return defaults[0].label || 'Scheduled';
  return `${defaults.length} scheduled runs`;
}

async function initWorkflows() {
  const el = document.getElementById('workflow-content');
  if (!el) return;
  el.innerHTML = '<div class="loading" style="padding:32px;text-align:center;color:var(--text-muted)">Loading workflows...</div>';
  try {
    const [tplData, activeData] = await Promise.all([
      api('/workflows/templates'),
      api('/workflows?limit=50'),
    ]);
    _activeWorkflows = activeData.workflows || [];
    renderCatalogue(el, tplData.workflows || [], _activeWorkflows);
  } catch (e: any) {
    el.innerHTML = `<div style="padding:32px;color:var(--critical)">Failed to load workflows: ${escHtml(e.message)}</div>`;
  }
}

function renderCatalogue(el: HTMLElement, templates: any[], active: any[]) {
  // Group active workflows by template
  const activeByTpl: Record<string, any> = {};
  for (const wf of active) {
    if (!activeByTpl[wf.template_id] || wf.created_at > activeByTpl[wf.template_id].created_at) {
      activeByTpl[wf.template_id] = wf;
    }
  }

  // Active workflows section
  const runningWfs = active.filter(w => ['queued', 'running', 'blocked'].includes(w.status));
  let activeHtml = '';
  if (runningWfs.length > 0) {
    activeHtml = `
      <div class="wf-section">
        <h3 class="wf-section-title">Active Workflows</h3>
        <div class="wf-active-list">${runningWfs.map(wf => renderActiveCard(wf)).join('')}</div>
      </div>`;
  }

  // Template catalogue
  const grouped: Record<string, any[]> = {};
  for (const tpl of templates) {
    const mod = tpl.module || 'system';
    if (!grouped[mod]) grouped[mod] = [];
    grouped[mod].push(tpl);
  }

  let catalogueHtml = '<div class="wf-section"><h3 class="wf-section-title">Workflow Catalogue</h3>';
  catalogueHtml += '<p class="wf-section-desc">Pre-built AI pipelines. Activate one to automate multi-step tasks.</p>';

  for (const mod of ['frontend', 'backend', 'system']) {
    const tpls = grouped[mod];
    if (!tpls?.length) continue;
    const meta = MODULE_META[mod] || { icon: '📦', color: '#888' };
    catalogueHtml += `<div class="wf-module-group">
      <div class="wf-module-label" style="color:${meta.color}">${meta.icon} ${mod.charAt(0).toUpperCase() + mod.slice(1)}</div>
      <div class="wf-grid">${tpls.map(tpl => renderTemplateCard(tpl, activeByTpl[tpl.id])).join('')}</div>
    </div>`;
  }
  catalogueHtml += '</div>';

  // Recent completed
  const recentDone = active.filter(w => ['succeeded', 'failed', 'cancelled'].includes(w.status)).slice(0, 5);
  let historyHtml = '';
  if (recentDone.length > 0) {
    historyHtml = `<div class="wf-section"><h3 class="wf-section-title">Recent Runs</h3>
      <div class="wf-active-list">${recentDone.map(wf => renderActiveCard(wf)).join('')}</div></div>`;
  }

  el.innerHTML = activeHtml + catalogueHtml + historyHtml;
}

function renderTemplateCard(tpl: any, activeWf: any): string {
  const isActive = !!activeWf && ['queued', 'running', 'blocked'].includes(activeWf.status);
  const badge = isActive
    ? `<span class="wf-badge ${STATUS_BADGE[activeWf.status]?.cls || ''}">${STATUS_BADGE[activeWf.status]?.label || activeWf.status}</span>`
    : tpl.enabled_by_default
      ? '<span class="wf-badge wf-badge-rec">Recommended</span>'
      : '';

  return `<div class="wf-card ${isActive ? 'wf-card-active' : ''}">
    <div class="wf-card-header">
      <span class="wf-card-name">${escHtml(tpl.name)}</span>${badge}
    </div>
    <div class="wf-card-desc">${escHtml(tpl.description)}</div>
    <div class="wf-card-meta">
      <span>${tpl.steps.length} steps</span>
      <span>${escHtml(tpl.estimatedDuration || '')}</span>
      <span>${escHtml(tpl.estimatedCost || '')}</span>
    </div>
    <div class="wf-card-meta" style="margin-top:2px">
      <span>${_triggersLabel(tpl)}</span>
      ${tpl.runsPerDay ? `<span>${tpl.runsPerDay}x/day (add more in settings)</span>` : ''}
    </div>
    <div class="wf-card-actions">
      ${isActive
        ? `<button class="btn btn-ghost btn-xs" onclick="viewWorkflow('${escHtml(activeWf.id)}')">View</button>
           <button class="btn btn-ghost btn-xs" onclick="runWorkflowNow('${escHtml(tpl.id)}')">Run Now</button>`
        : `<button class="btn btn-primary btn-xs" onclick="activateWorkflow('${escHtml(tpl.id)}')">Activate</button>`}
    </div>
  </div>`;
}

function renderActiveCard(wf: any): string {
  const badge = STATUS_BADGE[wf.status] || { label: wf.status, cls: '' };
  const timeAgo = _timeAgo(wf.updated_at || wf.created_at);
  return `<div class="wf-active-card" onclick="viewWorkflow('${escHtml(wf.id)}')">
    <div style="display:flex;align-items:center;gap:8px">
      <span class="wf-badge ${badge.cls}">${badge.label}</span>
      <span class="wf-active-name">${escHtml(wf.name)}</span>
    </div>
    <div class="wf-active-meta">
      ${wf.current_step ? `Step: ${escHtml(wf.current_step)}` : ''}
      <span>${timeAgo}</span>
    </div>
  </div>`;
}

async function activateWorkflow(templateId: string) {
  try {
    const res = await api('/workflows/activate', { method: 'POST', body: { templateId } });
    showToast(`Workflow "${res.name}" activated`);
    initWorkflows();
  } catch (e: any) { showToast(`Activation failed: ${e.message}`, 'error'); }
}

async function runWorkflowNow(templateId: string) {
  try {
    const res = await api(`/workflows/${templateId}/trigger`, { method: 'POST' });
    showToast(`Workflow triggered (${res.steps} steps)`);
    setTimeout(initWorkflows, 2000);
  } catch (e: any) { showToast(`Trigger failed: ${e.message}`, 'error'); }
}

async function viewWorkflow(workflowId: string) {
  if (typeof (window as any).showWorkflowDetail === 'function') {
    (window as any).showWorkflowDetail(workflowId);
  }
}

function _timeAgo(dateStr: string): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr + (dateStr.endsWith('Z') ? '' : 'Z')).getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  return Math.floor(diff / 86400000) + 'd ago';
}

// Expose on window
(window as any).initWorkflows = initWorkflows;
(window as any).activateWorkflow = activateWorkflow;
(window as any).runWorkflowNow = runWorkflowNow;
(window as any).viewWorkflow = viewWorkflow;
