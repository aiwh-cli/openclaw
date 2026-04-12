// Tasks CRUD — task create/edit forms, file browser, project CRUD.
// Exposed on window for inline onclick handlers.

const api = (window as any).api as (url: string, opts?: any) => Promise<any>;
const showToast = (window as any).showToast as (msg: string, type?: string) => void;
const showModal = (window as any).showModal as (html: string, cls?: string) => void;
const closeModal = (window as any).closeModal as () => void;
const escHtml = (window as any).escHtml as (s: string) => string;
const dashConfirm = (window as any).dashConfirm as (msg: string) => Promise<boolean>;

export const KANBAN_COLS = [
  { status: 'backlog',     label: 'Backlog',      color: '#52525b' },
  { status: 'planned',     label: 'Planned',      color: '#C9A84C' },
  { status: 'in_progress', label: 'In Progress',  color: '#4CAF7A' },
  { status: 'blocked',     label: 'Blocked',      color: '#E05252' },
  { status: 'review',      label: 'Review',       color: '#ffaa00' },
  { status: 'done',        label: 'Done',         color: '#3a3a4a' },
];

export const CORE_REF_FILES = [
  { path: '/opt/AIWH/core/HARD-LIMITS.md', label: 'HARD-LIMITS.md', hint: 'Boundaries & constraints (1.5KB)', always: false },
  { path: '/opt/AIWH/core/AGENTS.md', label: 'AGENTS.md', hint: 'Agent roster & routing (2KB)', always: false },
  { path: '/opt/AIWH/core/CONTEXT.md', label: 'CONTEXT.md', hint: 'Current project state (5KB)', always: false },
  { path: '/opt/AIWH/client/config/client-profile.md', label: 'client-profile.md', hint: 'Client niche, voice, ICP (3KB)', always: false },
  { path: '/opt/AIWH/core/docs/SYSTEM-UPGRADE-PLAN.md', label: 'SYSTEM-UPGRADE-PLAN.md', hint: 'Current upgrade plan (large \u2014 truncated)', always: false },
  { path: '/opt/AIWH/core/docs/BRANDING.md', label: 'BRANDING.md', hint: 'Brand voice & identity', always: false },
  { path: '/opt/AIWH/core/docs/VIDEO-PIPELINE-OPERATOR-GUIDE.md', label: 'VIDEO-PIPELINE-OPERATOR-GUIDE.md', hint: 'Video pipeline reference', always: false },
  { path: '/opt/AIWH/core/docs/KNOWLEDGE-SYSTEM.md', label: 'KNOWLEDGE-SYSTEM.md', hint: 'Knowledge system blueprint', always: false },
];

/* ── Project CRUD ─────────────────────────────────────────── */

function showCreateProject() {
  showModal(`
    <h2>New Project</h2>
    <div class="modal-form-grid">
      <div class="modal-form-row"><div class="modal-form-col">
        <label>Project Name</label>
        <input type="text" id="new-project-name" placeholder="e.g. Video Pipeline v2">
      </div></div>
      <div class="modal-form-row"><div class="modal-form-col">
        <label>Description</label>
        <textarea id="new-project-desc" rows="2" placeholder="What this project is about"></textarea>
      </div></div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="submitCreateProject()">Create Project</button>
    </div>
  `);
}

async function submitCreateProject() {
  const name = (document.getElementById('new-project-name') as HTMLInputElement)?.value?.trim();
  const description = (document.getElementById('new-project-desc') as HTMLTextAreaElement)?.value?.trim();
  if (!name) { showToast('Project name required', 'error'); return; }
  const result = await api('/projects', { method: 'POST', body: { name, description } });
  if (result?.error) { showToast(result.error, 'error'); return; }
  showToast(`Project "${name}" created`, 'success');
  closeModal();
  (window as any).loadTasks();
}

async function deleteProject() {
  const filter = document.getElementById('task-project-filter') as HTMLSelectElement | null;
  const projectId = filter?.value;
  if (!projectId) { showToast('Select a project first', 'error'); return; }
  const projectName = filter!.options[filter!.selectedIndex]?.textContent || 'this project';
  const ok = await dashConfirm(`Archive project "${projectName}"?\n\nTasks will remain but won't be grouped under this project.`);
  if (!ok) { return; }
  const result = await api(`/projects/${projectId}`, { method: 'DELETE' });
  if (result?.ok) {
    showToast(`Project "${projectName}" archived`, 'success');
    filter!.value = '';
    (window as any).loadTasks();
  } else {
    showToast(result?.error || 'Delete failed', 'error');
  }
}

/* ── Task Create ──────────────────────────────────────────── */

async function showCreateTask() {
  const agents = await api('/agents');
  const agentList = (agents?.agents || []).filter((a: any) => a.inConfig);
  showModal(`
    <h2>New Task</h2>
    <div class="modal-form-grid">
      <div class="modal-form-row"><div class="modal-form-col">
        <label>Title</label>
        <input type="text" id="new-task-title" placeholder="Task title">
      </div></div>
      <div class="modal-form-row"><div class="modal-form-col">
        <label>Description <span class="label-hint">Short summary shown on card</span></label>
        <textarea id="new-task-desc" rows="2" placeholder="One-line summary of the task"></textarea>
      </div></div>
      <div class="modal-form-row modal-form-row-3">
        <div class="modal-form-col"><label>Status</label>
          <select id="new-task-status">${KANBAN_COLS.map(c => `<option value="${c.status}">${c.label}</option>`).join('')}</select></div>
        <div class="modal-form-col"><label>Type</label>
          <select id="new-task-type"><option value="build">Build</option><option value="plan">Plan</option><option value="ops">Ops</option></select></div>
        <div class="modal-form-col"><label>Agent</label>
          <select id="new-task-agent"><option value="">Unassigned</option>
            ${agentList.map((a: any) => `<option value="${escHtml(a.id)}">${escHtml(a.id)} (${escHtml(a.modelTier || '')})</option>`).join('')}</select></div>
      </div>
      <div class="modal-form-row"><div class="modal-form-col">
        <label>Agent Brief <span class="label-hint">Detailed instructions the agent receives when dispatched</span></label>
        <textarea id="new-task-brief" rows="8" placeholder="Write the full context here:&#10;- What problem are we solving?&#10;- What approach should be taken?&#10;- What files to look at for reference?&#10;- What patterns to follow?&#10;- What to NOT do?&#10;- Acceptance criteria"></textarea>
      </div></div>
      <div class="modal-form-row"><div class="modal-form-col">
        <label>Reference Files <span class="label-hint">Selected files are embedded in the agent's prompt so it has context. Larger files are truncated at 4KB.</span></label>
        <div class="ref-files-section">
          <div class="ref-files-core">
            ${CORE_REF_FILES.map(f => `<label class="ref-file-check"><input type="checkbox" value="${f.path}" ${f.always ? 'checked' : ''}><span class="ref-file-name">${f.label}</span><span class="ref-file-hint">${f.hint}</span></label>`).join('')}
          </div>
          <div class="ref-files-custom"><div id="new-task-custom-refs"></div>
            <button type="button" class="btn-add-file" onclick="openFileBrowser('new-task-custom-refs')">+ Browse files</button></div>
        </div>
      </div></div>
      <div class="modal-form-row"><div class="modal-form-col">
        <label>Expected Deliverables <span class="label-hint">Listed in the agent brief so it knows what to produce. Not auto-verified.</span></label>
        <textarea id="new-task-deliverables" rows="2" placeholder="e.g. scripts/analytics-report.sh, cron registered in openclaw.json"></textarea>
      </div></div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="createTask()">Create</button>
    </div>
  `, 'modal-wide');
  setTimeout(() => document.getElementById('new-task-title')?.focus(), 50);
}

async function createTask() {
  const title = (document.getElementById('new-task-title') as HTMLInputElement)?.value.trim();
  if (!title) { return; }
  const projects = await api('/projects') || [];
  const projectId = projects[0]?.id;
  const refFiles = collectRefFiles('new-task-custom-refs');
  const r = await api('/tasks', {
    method: 'POST',
    body: {
      project_id: projectId, title,
      description: (document.getElementById('new-task-desc') as HTMLTextAreaElement)?.value.trim(),
      status: (document.getElementById('new-task-status') as HTMLSelectElement)?.value || 'backlog',
      type: (document.getElementById('new-task-type') as HTMLSelectElement)?.value || 'build',
      assigned_agent: (document.getElementById('new-task-agent') as HTMLSelectElement)?.value.trim(),
      brief: (document.getElementById('new-task-brief') as HTMLTextAreaElement)?.value.trim(),
      reference_files: JSON.stringify(refFiles),
      expected_deliverables: (document.getElementById('new-task-deliverables') as HTMLTextAreaElement)?.value.trim(),
    }
  });
  if (r?.error) { return showToast('Failed: ' + r.error, 'error'); }
  showToast('Task created', 'success');
  closeModal();
  await (window as any).loadTasks();
}

/* ── Reference Files ──────────────────────────────────────── */

export function collectRefFiles(customContainerId: string): string[] {
  const checked = [...document.querySelectorAll('.ref-files-core input[type=checkbox]:checked')]
    .map(cb => (cb as HTMLInputElement).value);
  const custom = [...document.querySelectorAll(`#${customContainerId} .ref-file-entry`)]
    .map(el => (el as HTMLElement).dataset.path).filter(Boolean) as string[];
  return [...checked, ...custom];
}

function openFileBrowser(targetContainerId: string) {
  (window as any)._fileBrowserTarget = targetContainerId;
  renderFileBrowser('/opt/AIWH/core');
}

async function renderFileBrowser(dir: string) {
  const data = await api(`/files/browse?dir=${encodeURIComponent(dir)}`);
  if (!data) { return; }
  const entries = data.entries || [];
  const items = entries.map((e: any) => {
    if (e.isDir) {
      return `<div class="fb-entry fb-dir" onclick="renderFileBrowser('${escHtml(e.path)}')">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 4l2-2h4l2 2h4v10H2V4z" stroke="currentColor" stroke-width="1.2"/></svg>
        ${escHtml(e.name)}/</div>`;
    }
    const isRelevant = ['.md', '.sh', '.js', '.py', '.json'].includes(e.ext);
    return `<div class="fb-entry fb-file ${isRelevant ? 'fb-relevant' : 'fb-dim'}" onclick="addRefFile('${escHtml(e.path)}', '${escHtml(e.name)}')">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 2h6l4 4v8H4V2z" stroke="currentColor" stroke-width="1.2"/><path d="M10 2v4h4" stroke="currentColor" stroke-width="1.2"/></svg>
      ${escHtml(e.name)}</div>`;
  }).join('');
  const shortDir = data.dir.replace('/opt/AIWH/core', '~');
  let fb = document.getElementById('file-browser-panel');
  if (!fb) {
    fb = document.createElement('div');
    fb.id = 'file-browser-panel';
    fb.className = 'file-browser-panel';
    document.body.appendChild(fb);
  }
  fb.innerHTML = `
    <div class="fb-header">
      <span class="fb-path">${escHtml(shortDir)}</span>
      <button class="btn-icon-xs" onclick="document.getElementById('file-browser-panel').remove()">
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
      </button>
    </div>
    ${data.parent ? `<div class="fb-entry fb-dir fb-up" onclick="renderFileBrowser('${escHtml(data.parent)}')">.. (up)</div>` : ''}
    <div class="fb-entries">${items}</div>
  `;
  fb.style.display = 'flex';
}

function addRefFile(filePath: string, fileName: string) {
  const target = document.getElementById((window as any)._fileBrowserTarget);
  if (!target) { return; }
  if (target.querySelector(`[data-path="${filePath}"]`)) { return; }
  const el = document.createElement('div');
  el.className = 'ref-file-entry';
  el.dataset.path = filePath;
  el.innerHTML = `
    <span class="ref-file-name">${escHtml(fileName)}</span>
    <span class="ref-file-path">${escHtml(filePath.replace('/opt/AIWH/core/', ''))}</span>
    <button class="btn-icon-xs btn-danger-xs" onclick="this.parentElement.remove()" title="Remove">
      <svg width="8" height="8" viewBox="0 0 12 12" fill="none"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
    </button>
  `;
  target.appendChild(el);
  document.getElementById('file-browser-panel')?.remove();
}

/* ── Task Edit ────────────────────────────────────────────── */

async function editTask(id: number) {
  const [task, agents] = await Promise.all([api(`/tasks/${id}`), api('/agents')]);
  if (!task) { return; }
  const agentList = (agents?.agents || []).filter((a: any) => a.inConfig);
  let refFiles: string[] = [];
  try { refFiles = JSON.parse(task.reference_files || '[]'); } catch { /* ignore */ }
  const corePaths = new Set(CORE_REF_FILES.map(f => f.path));
  const customRefs = refFiles.filter(f => !corePaths.has(f));
  showModal(`
    <h2>Edit Task</h2>
    <div class="modal-form-grid">
      <div class="modal-form-row"><div class="modal-form-col">
        <label>Title</label><input type="text" id="edit-task-title" value="${escHtml(task.title || '')}">
      </div></div>
      <div class="modal-form-row"><div class="modal-form-col">
        <label>Description <span class="label-hint">Short summary shown on card</span></label>
        <textarea id="edit-task-desc" rows="2">${escHtml(task.description || '')}</textarea>
      </div></div>
      <div class="modal-form-row modal-form-row-3">
        <div class="modal-form-col"><label>Status</label>
          <select id="edit-task-status">${KANBAN_COLS.map(c => `<option value="${c.status}" ${task.status === c.status ? 'selected' : ''}>${c.label}</option>`).join('')}</select></div>
        <div class="modal-form-col"><label>Type</label>
          <select id="edit-task-type"><option value="build" ${task.type === 'build' ? 'selected' : ''}>Build</option><option value="plan" ${task.type === 'plan' ? 'selected' : ''}>Plan</option><option value="ops" ${task.type === 'ops' ? 'selected' : ''}>Ops</option></select></div>
        <div class="modal-form-col"><label>Agent</label>
          <select id="edit-task-agent"><option value="">Unassigned</option>
            ${agentList.map((a: any) => `<option value="${a.id}" ${task.assigned_agent === a.id ? 'selected' : ''}>${a.id} (${a.modelTier})</option>`).join('')}</select></div>
      </div>
      <div class="modal-form-row"><div class="modal-form-col">
        <label>Agent Brief <span class="label-hint">Detailed instructions the agent receives when dispatched</span></label>
        <textarea id="edit-task-brief" rows="8">${escHtml(task.brief || '')}</textarea>
      </div></div>
      <div class="modal-form-row"><div class="modal-form-col">
        <label>Reference Files <span class="label-hint">Selected files are embedded in the agent's prompt so it has context. Larger files are truncated at 4KB.</span></label>
        <div class="ref-files-section">
          <div class="ref-files-core">
            ${CORE_REF_FILES.map(f => `<label class="ref-file-check"><input type="checkbox" value="${f.path}" ${refFiles.includes(f.path) ? 'checked' : ''}><span class="ref-file-name">${f.label}</span><span class="ref-file-hint">${f.hint}</span></label>`).join('')}
          </div>
          <div class="ref-files-custom"><div id="edit-task-custom-refs">
            ${customRefs.map(p => `<div class="ref-file-entry" data-path="${escHtml(p)}"><span class="ref-file-name">${escHtml(p.split('/').pop() || '')}</span><span class="ref-file-path">${escHtml(p.replace('/opt/AIWH/core/', ''))}</span><button class="btn-icon-xs btn-danger-xs" onclick="this.parentElement.remove()" title="Remove"><svg width="8" height="8" viewBox="0 0 12 12" fill="none"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button></div>`).join('')}
          </div>
            <button type="button" class="btn-add-file" onclick="openFileBrowser('edit-task-custom-refs')">+ Browse files</button></div>
        </div>
      </div></div>
      <div class="modal-form-row"><div class="modal-form-col">
        <label>Expected Deliverables <span class="label-hint">Listed in the agent brief so it knows what to produce. Not auto-verified.</span></label>
        <textarea id="edit-task-deliverables" rows="2">${escHtml(task.expected_deliverables || '')}</textarea>
      </div></div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="updateTask(${id})">Save</button>
    </div>
  `, 'modal-wide');
}

async function updateTask(id: number) {
  const refFiles = collectRefFiles('edit-task-custom-refs');
  const r = await api(`/tasks/${id}`, {
    method: 'PUT',
    body: {
      title: (document.getElementById('edit-task-title') as HTMLInputElement)?.value.trim(),
      description: (document.getElementById('edit-task-desc') as HTMLTextAreaElement)?.value.trim(),
      status: (document.getElementById('edit-task-status') as HTMLSelectElement)?.value,
      type: (document.getElementById('edit-task-type') as HTMLSelectElement)?.value,
      assigned_agent: (document.getElementById('edit-task-agent') as HTMLSelectElement)?.value.trim(),
      brief: (document.getElementById('edit-task-brief') as HTMLTextAreaElement)?.value.trim(),
      reference_files: JSON.stringify(refFiles),
      expected_deliverables: (document.getElementById('edit-task-deliverables') as HTMLTextAreaElement)?.value.trim(),
    }
  });
  if (r?.error) { return showToast('Failed: ' + r.error, 'error'); }
  showToast('Task updated', 'success');
  closeModal();
  await (window as any).loadTasks();
}

// Expose on window for inline onclick handlers
(window as any).showCreateTask = showCreateTask;
(window as any).createTask = createTask;
(window as any).collectRefFiles = collectRefFiles;
(window as any).openFileBrowser = openFileBrowser;
(window as any).renderFileBrowser = renderFileBrowser;
(window as any).addRefFile = addRefFile;
(window as any).editTask = editTask;
(window as any).updateTask = updateTask;
(window as any).showCreateProject = showCreateProject;
(window as any).submitCreateProject = submitCreateProject;
(window as any).deleteProject = deleteProject;
