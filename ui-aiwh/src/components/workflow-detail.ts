// Workflow Detail — step-by-step progress view with DAG visualization.
// Shows pipeline progress, per-step status, cancel/retry controls.

const api = (window as any).api as (url: string, opts?: any) => Promise<any>;
const showToast = (window as any).showToast as (msg: string, type?: string) => void;
const showModal = (window as any).showModal as (html: string, cls?: string) => void;
const closeModal = (window as any).closeModal as () => void;
const escHtml = (window as any).escHtml as (s: string) => string;

const STEP_ICONS: Record<string, string> = {
  pending:   '⏳',
  running:   '🔄',
  succeeded: '✅',
  failed:    '❌',
  cancelled: '⛔',
  skipped:   '⏭️',
};

let _detailRefreshTimer: ReturnType<typeof setInterval> | null = null;

async function showWorkflowDetail(workflowId: string) {
  // Clear any existing refresh timer
  if (_detailRefreshTimer) { clearInterval(_detailRefreshTimer); _detailRefreshTimer = null; }

  const wf = await api(`/workflows/${workflowId}`);
  if (!wf) { showToast('Workflow not found', 'error'); return; }

  renderDetail(wf);

  // Auto-refresh while running
  if (['queued', 'running', 'blocked'].includes(wf.status)) {
    _detailRefreshTimer = setInterval(async () => {
      try {
        const updated = await api(`/workflows/${workflowId}`);
        renderDetail(updated);
        if (['succeeded', 'failed', 'cancelled'].includes(updated.status) && _detailRefreshTimer) {
          clearInterval(_detailRefreshTimer);
          _detailRefreshTimer = null;
        }
      } catch { /* ignore polling errors */ }
    }, 5000);
  }
}

function renderDetail(wf: any) {
  const steps = wf.steps || [];
  const deps = buildDepMap(steps);

  // Pipeline visualization (linear DAG)
  const pipelineHtml = steps.map((step: any, i: number) => {
    const icon = STEP_ICONS[step.status] || '⏳';
    const durLabel = step.duration_ms ? `${Math.round(step.duration_ms / 1000)}s` : '';
    const isLast = i === steps.length - 1;
    const depList = JSON.parse(step.depends_on || '[]');
    const depLabel = depList.length ? `after: ${depList.join(', ')}` : 'start';

    return `<div class="wf-step ${step.status === 'running' ? 'wf-step-running' : ''} wf-step-${step.status}">
      <div class="wf-step-icon">${icon}</div>
      <div class="wf-step-body">
        <div class="wf-step-header">
          <span class="wf-step-name">${escHtml(step.name)}</span>
          <span class="wf-step-agent">${escHtml(step.agent)}</span>
          ${durLabel ? `<span class="wf-step-dur">${durLabel}</span>` : ''}
        </div>
        <div class="wf-step-dep">${depLabel}</div>
        ${step.output_summary ? `<div class="wf-step-output">${escHtml(step.output_summary.slice(0, 200))}</div>` : ''}
        ${step.error ? `<div class="wf-step-error">${escHtml(step.error.slice(0, 200))}</div>` : ''}
      </div>
      <div class="wf-step-actions">
        <button class="btn btn-ghost btn-xs" onclick="editWorkflowStep('${escHtml(wf.id)}','${escHtml(step.step_id)}')" title="Edit step prompt">Edit</button>
      </div>
    </div>
    ${!isLast ? '<div class="wf-step-connector"></div>' : ''}`;
  }).join('');

  // Summary stats
  const succeeded = steps.filter((s: any) => s.status === 'succeeded').length;
  const totalDur = steps.reduce((sum: number, s: any) => sum + (s.duration_ms || 0), 0);
  const durLabel = totalDur > 0 ? `${Math.round(totalDur / 60000)}min` : '-';

  // Status badge
  const statusColors: Record<string, string> = {
    queued: 'var(--text-muted)', running: 'var(--cyan, #00e5ff)',
    succeeded: 'var(--success, #00ff88)', failed: '#E74C3C',
    blocked: '#E74C3C', cancelled: 'var(--text-muted)',
  };
  const statusColor = statusColors[wf.status] || 'var(--text-muted)';

  // Actions
  const actions: string[] = [];
  if (['queued', 'running'].includes(wf.status)) {
    actions.push(`<button class="btn btn-ghost btn-sm" onclick="cancelWf('${escHtml(wf.id)}')">Cancel</button>`);
  }
  if (wf.status === 'blocked') {
    actions.push(`<button class="btn btn-primary btn-sm" onclick="retryWf('${escHtml(wf.id)}')">Retry Failed Steps</button>`);
    actions.push(`<button class="btn btn-ghost btn-sm" onclick="cancelWf('${escHtml(wf.id)}')">Cancel</button>`);
  }
  if (['succeeded', 'failed', 'cancelled'].includes(wf.status)) {
    actions.push(`<button class="btn btn-primary btn-sm" onclick="runWorkflowNow('${escHtml(wf.template_id)}')">Run Again</button>`);
  }

  const html = `
    <div class="wf-detail">
      <div class="wf-detail-header">
        <button class="btn btn-ghost btn-sm" onclick="backToWorkflows()" style="margin-right:8px">← Back</button>
        <div style="flex:1">
          <h3 class="wf-detail-title">${escHtml(wf.name)}</h3>
          <div class="wf-detail-meta">
            <span style="color:${statusColor};font-weight:500">${wf.status.toUpperCase()}</span>
            <span>${succeeded}/${steps.length} steps</span>
            <span>${durLabel}</span>
          </div>
        </div>
        <div class="wf-detail-actions">${actions.join(' ')}</div>
      </div>
      ${wf.error ? `<div class="wf-detail-error">${escHtml(wf.error)}</div>` : ''}
      <div class="wf-pipeline">${pipelineHtml}</div>
    </div>`;

  const el = document.getElementById('workflow-content');
  if (el) el.innerHTML = html;
}

function buildDepMap(steps: any[]): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const step of steps) {
    map[step.step_id] = JSON.parse(step.depends_on || '[]');
  }
  return map;
}

async function cancelWf(workflowId: string) {
  try {
    await api(`/workflows/${workflowId}/cancel`, { method: 'POST' });
    showToast('Workflow cancelled');
    showWorkflowDetail(workflowId);
  } catch (e: any) { showToast(`Cancel failed: ${e.message}`, 'error'); }
}

async function retryWf(workflowId: string) {
  try {
    await api(`/workflows/${workflowId}/retry`, { method: 'POST' });
    showToast('Retrying failed steps...');
    showWorkflowDetail(workflowId);
  } catch (e: any) { showToast(`Retry failed: ${e.message}`, 'error'); }
}

async function editWorkflowStep(workflowId: string, stepId: string) {
  const wf = await api(`/workflows/${workflowId}`);
  const step = wf?.steps?.find((s: any) => s.step_id === stepId);
  if (!step) { showToast('Step not found', 'error'); return; }

  const html = `
    <h3 style="margin:0 0 12px;font-size:14px">Edit Step: ${escHtml(step.name)}</h3>
    <div class="cp-form">
      <div class="cp-field">
        <label class="cp-label">Agent</label>
        <input id="wf-edit-agent" class="cp-input" value="${escHtml(step.agent)}">
      </div>
      <div class="cp-field">
        <label class="cp-label">Model Tier</label>
        <select id="wf-edit-tier" class="cp-input">
          <option value="fast" ${step.tier === 'fast' ? 'selected' : ''}>Fast (cheapest)</option>
          <option value="balanced" ${step.tier === 'balanced' ? 'selected' : ''}>Balanced</option>
          <option value="quality" ${step.tier === 'quality' ? 'selected' : ''}>Quality (best)</option>
        </select>
      </div>
      <div class="cp-field">
        <label class="cp-label">Instructions (what this step does)</label>
        <textarea id="wf-edit-message" class="cp-input cp-textarea" rows="8">${escHtml(step.message)}</textarea>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
        <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="saveStepEdit('${escHtml(workflowId)}','${escHtml(stepId)}')">Save</button>
      </div>
    </div>`;
  showModal(html, 'modal-md');
}

async function saveStepEdit(workflowId: string, stepId: string) {
  const agent = (document.getElementById('wf-edit-agent') as HTMLInputElement)?.value?.trim();
  const tier = (document.getElementById('wf-edit-tier') as HTMLSelectElement)?.value;
  const message = (document.getElementById('wf-edit-message') as HTMLTextAreaElement)?.value?.trim();
  try {
    await api(`/workflows/${workflowId}/steps/${stepId}`, {
      method: 'PUT', body: { agent, tier, message },
    });
    showToast('Step updated');
    closeModal();
    showWorkflowDetail(workflowId);
  } catch (e: any) { showToast(`Save failed: ${e.message}`, 'error'); }
}

function backToWorkflows() {
  if (_detailRefreshTimer) { clearInterval(_detailRefreshTimer); _detailRefreshTimer = null; }
  (window as any).initWorkflows();
}

// Expose on window
(window as any).showWorkflowDetail = showWorkflowDetail;
(window as any).cancelWf = cancelWf;
(window as any).retryWf = retryWf;
(window as any).editWorkflowStep = editWorkflowStep;
(window as any).saveStepEdit = saveStepEdit;
(window as any).backToWorkflows = backToWorkflows;
