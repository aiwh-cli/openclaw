// ─── Tasks View (Kanban) + Dispatch System ────────────────────
// Drag-and-drop kanban with agent dispatch confirmation,
// task queue, and real-time run status.

const KANBAN_COLS = [
  { status: 'backlog',     label: 'Backlog',      color: '#52525b' },
  { status: 'planned',     label: 'Planned',      color: '#C9A84C' },
  { status: 'in_progress', label: 'In Progress',  color: '#4CAF7A' },
  { status: 'blocked',     label: 'Blocked',      color: '#E05252' },
  { status: 'review',      label: 'Review',       color: '#ffaa00' },
  { status: 'done',        label: 'Done',         color: '#3a3a4a' },
];

let _taskDragItem = null;
let _taskDragStatus = null;

// Core files available as reference — user selects which to include.
// Agents with workspaceOnly can't read outside their dir, so selected files
// get embedded in the dispatch message (capped at 4000 chars each).
const CORE_REF_FILES = [
  { path: '/opt/AIWH/core/HARD-LIMITS.md', label: 'HARD-LIMITS.md', hint: 'Boundaries & constraints (1.5KB)', always: false },
  { path: '/opt/AIWH/core/AGENTS.md', label: 'AGENTS.md', hint: 'Agent roster & routing (2KB)', always: false },
  { path: '/opt/AIWH/core/CONTEXT.md', label: 'CONTEXT.md', hint: 'Current project state (5KB)', always: false },
  { path: '/opt/AIWH/client/config/client-profile.md', label: 'client-profile.md', hint: 'Client niche, voice, ICP (3KB)', always: false },
  { path: '/opt/AIWH/core/docs/SYSTEM-UPGRADE-PLAN.md', label: 'SYSTEM-UPGRADE-PLAN.md', hint: 'Current upgrade plan (large — truncated)', always: false },
  { path: '/opt/AIWH/core/docs/BRANDING.md', label: 'BRANDING.md', hint: 'Brand voice & identity', always: false },
  { path: '/opt/AIWH/core/docs/VIDEO-PIPELINE-OPERATOR-GUIDE.md', label: 'VIDEO-PIPELINE-OPERATOR-GUIDE.md', hint: 'Video pipeline reference', always: false },
  { path: '/opt/AIWH/core/docs/KNOWLEDGE-SYSTEM.md', label: 'KNOWLEDGE-SYSTEM.md', hint: 'Knowledge system blueprint', always: false },
];

async function initTasks() {
  await loadTasks();
  setupKanbanDragDrop();
}

async function loadTasks() {
  let url = '/tasks';
  const filter = document.getElementById('task-project-filter');
  if (filter?.value) {url += `?project_id=${filter.value}`;}
  const tasks = await api(url) || [];

  const projects = await api('/projects') || [];
  populateTaskProjectFilter(projects);

  renderKanban(tasks);
}

function populateTaskProjectFilter(projects) {
  const el = document.getElementById('task-project-filter');
  if (!el) {return;}
  const val = el.value;
  el.innerHTML = '<option value="">All Projects</option>' +
    projects.map(p => `<option value="${p.id}">${escHtml(p.name)}</option>`).join('');
  if (val) {el.value = val;}
}

const DONE_VISIBLE_DEFAULT = 5;
let _showAllDone = false;

function renderKanban(tasks) {
  for (const col of KANBAN_COLS) {
    const cards = tasks.filter(t => t.status === col.status);
    const colEl = document.getElementById(`kanban-col-${col.status}`);
    const countEl = document.getElementById(`kanban-count-${col.status}`);
    if (countEl) {countEl.textContent = cards.length;}
    if (!colEl) {continue;}

    if (col.status === 'done') {
      // Sort newest first
      cards.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
      const visible = _showAllDone ? cards : cards.slice(0, DONE_VISIBLE_DEFAULT);
      const hidden = cards.length - DONE_VISIBLE_DEFAULT;
      colEl.innerHTML = visible.map(t => renderDoneCard(t)).join('');
      if (hidden > 0 && !_showAllDone) {
        colEl.innerHTML += `<button class="done-show-more" onclick="_showAllDone=true;loadTasks()">Show ${hidden} more completed</button>`;
      } else if (_showAllDone && cards.length > DONE_VISIBLE_DEFAULT) {
        colEl.innerHTML += `<button class="done-show-more" onclick="_showAllDone=false;loadTasks()">Show less</button>`;
      }
    } else {
      colEl.innerHTML = cards.map(t => renderTaskCard(t)).join('');
    }
    colEl.querySelectorAll('.task-card').forEach(c => setupCardDrag(c));
  }
}

function renderDoneCard(task) {
  return `<div class="task-card task-card-done" data-task-id="${task.id}" data-status="done" onclick="editTask(${task.id})">
    <div class="done-card-row">
      <span class="done-check"><svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M2 8.5l4 4 8-9" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
      <span class="done-title">${escHtml(task.title)}</span>
      <span class="task-time">${timeAgo(task.updated_at)}</span>
    </div>
  </div>`;
}

function renderTaskCard(task) {
  const prioClass = task.priority > 0 ? 'prio-high' : task.priority < 0 ? 'prio-low' : '';
  const isRunning = task.dispatch_run_id && task.status === 'in_progress';
  const canRun = task.assigned_agent && ['planned', 'backlog'].includes(task.status);
  const canCancel = isRunning;
  const inReview = task.status === 'review';

  return `<div class="task-card ${prioClass} ${isRunning ? 'task-running' : ''}" data-task-id="${task.id}" data-status="${task.status}">
    <div class="task-card-title">${escHtml(task.title)}</div>
    ${task.description ? `<div class="task-card-desc">${escHtml(task.description.substring(0, 80))}</div>` : ''}
    <div class="task-card-footer">
      ${task.assigned_agent ? `<span class="task-agent">${escHtml(task.assigned_agent)}</span>` : '<span class="task-agent task-no-agent">unassigned</span>'}
      ${task.type ? `<span class="task-type-badge">${task.type}</span>` : ''}
      <span class="task-time">${timeAgo(task.updated_at)}</span>
    </div>
    ${inReview ? `<div class="task-review-actions">
      <button class="btn-review btn-review-log" onclick="event.stopPropagation();viewRunLog(${task.id})" title="View agent work">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M2 3h12M2 7h12M2 11h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        View Work
      </button>
      <button class="btn-review btn-review-approve" onclick="event.stopPropagation();approveTask(${task.id})" title="Approve — mark done">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M2 8.5l4 4 8-9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Approve
      </button>
      <button class="btn-review btn-review-reject" onclick="event.stopPropagation();showRejectModal(${task.id})" title="Reject">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        Reject
      </button>
    </div>` : ''}
    <div class="task-card-actions">
      ${canRun ? `<button class="btn-icon-xs btn-run-xs" onclick="event.stopPropagation();showDispatchModal(${task.id})" title="Run agent">
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M4 2.5l9 5.5-9 5.5V2.5z" fill="currentColor"/></svg>
      </button>` : ''}
      ${canCancel ? `<button class="btn-icon-xs btn-danger-xs" onclick="event.stopPropagation();cancelDispatch(${task.id})" title="Cancel run">
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </button>` : ''}
      <button class="btn-icon-xs" onclick="event.stopPropagation();editTask(${task.id})" title="Edit">
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>
      </button>
      <button class="btn-icon-xs btn-danger-xs" onclick="event.stopPropagation();deleteTask(${task.id})" title="Delete">
        <svg width="8" height="8" viewBox="0 0 12 12" fill="none"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
      </button>
    </div>
    ${isRunning ? '<div class="task-running-indicator"><span class="running-dot"></span> Running</div>' : ''}
  </div>`;
}

// ─── Dispatch Modal ──────────────────────────────────────────

async function showDispatchModal(taskId) {
  const info = await api(`/tasks/${taskId}/dispatch-info`);
  if (!info) {return showToast('Failed to load dispatch info', 'error');}

  if (!info.canDispatch) {
    showToast(info.reason, 'error');
    return;
  }

  const budgetWarning = info.budget.overBudget
    ? `<div class="dispatch-warning">Daily budget exceeded ($${info.budget.dailySpend.toFixed(2)}/$${info.budget.dailyBudget.toFixed(2)})</div>`
    : '';
  const agentBusyNote = info.agent.busy
    ? `<div class="dispatch-info-note">Agent is busy — task will be <strong>queued</strong> and start when agent is free.</div>`
    : '';
  const queueNote = info.queueDepth > 0
    ? `<div class="dispatch-info-note">${info.queueDepth} task(s) already in queue.</div>`
    : '';

  showModal(`
    <h2>Dispatch Task</h2>
    <div class="dispatch-summary">
      <div class="dispatch-field">
        <span class="dispatch-label">Task</span>
        <span class="dispatch-value">${escHtml(info.task.title)}</span>
      </div>
      <div class="dispatch-field">
        <span class="dispatch-label">Agent</span>
        <span class="dispatch-value">${escHtml(info.agent.id)} <span class="task-type-badge">${info.agent.tier}</span></span>
      </div>
      <div class="dispatch-field">
        <span class="dispatch-label">Context</span>
        <span class="dispatch-value mono">~${(info.estimate.inputTokens || 0).toLocaleString()} tokens${info.estimate.refFileCount ? ` (${info.estimate.refFileCount} files embedded)` : ''}${info.task.hasBrief ? '' : ' <span class="dispatch-warning-inline">no brief!</span>'}</span>
      </div>
      <div class="dispatch-field">
        <span class="dispatch-label">Est. Cost</span>
        <span class="dispatch-value mono">~$${info.estimate.cost.toFixed(3)}</span>
      </div>
      <div class="dispatch-field">
        <span class="dispatch-label">Budget</span>
        <span class="dispatch-value mono">$${info.budget.dailySpend.toFixed(2)} / $${info.budget.dailyBudget.toFixed(2)}</span>
      </div>
    </div>
    ${!info.task.hasBrief ? '<div class="dispatch-warning">This task has no agent brief. The agent will have minimal instructions. Consider editing the task first.</div>' : ''}
    ${budgetWarning}
    ${agentBusyNote}
    ${queueNote}
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="confirmDispatch(${taskId})">
        ${info.agent.busy ? 'Queue Task' : 'Start Work'}
      </button>
    </div>
  `);
}

async function confirmDispatch(taskId) {
  closeModal();
  const result = await api(`/tasks/${taskId}/dispatch`, { method: 'POST' });
  if (!result) {return showToast('Dispatch failed', 'error');}

  if (result.queued) {
    showToast('Task queued — will start when agent is free', 'info');
  } else if (result.dispatched) {
    showToast('Agent dispatched', 'info');
  } else if (result.error) {
    showToast(result.error, 'error');
  }
  await loadTasks();
}

async function cancelDispatch(taskId) {
  const result = await api(`/tasks/${taskId}/cancel-dispatch`, { method: 'POST' });
  if (result?.ok) {
    showToast('Dispatch cancelled', 'info');
    await loadTasks();
  }
}

// ─── Drag & Drop with Dispatch Gate ──────────────────────────

function setupKanbanDragDrop() {
  document.querySelectorAll('.kanban-column').forEach(col => {
    col.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      col.classList.add('drag-over');
    });
    col.addEventListener('dragleave', (e) => {
      // Only remove highlight when leaving the column itself (not child elements)
      if (!col.contains(e.relatedTarget)) {col.classList.remove('drag-over');}
    });
    col.addEventListener('drop', async e => {
      e.preventDefault();
      col.classList.remove('drag-over');
      // Capture drag item before dragend clears it
      const dragItemId = _taskDragItem;
      const dragItemStatus = _taskDragStatus;
      if (!dragItemId) {return;}
      const newStatus = col.dataset.status;
      if (newStatus === dragItemStatus) {return;}

      // Move the task status (drag always moves — use Run button for dispatch)
      await api(`/tasks/${dragItemId}/move`, {
        method: 'POST',
        body: { status: newStatus, sort_order: Date.now() }
      });
      await loadTasks();
    });
  });
}

function setupCardDrag(cardEl) {
  cardEl.draggable = true;
  cardEl.addEventListener('dragstart', (e) => {
    _taskDragItem = cardEl.dataset.taskId;
    _taskDragStatus = cardEl.dataset.status;
    cardEl.classList.add('dragging');
    // Set drag data so the browser treats it as a valid drag
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', cardEl.dataset.taskId);
  });
  cardEl.addEventListener('dragend', () => {
    _taskDragItem = null;
    cardEl.classList.remove('dragging');
    document.querySelectorAll('.drag-over').forEach(c => c.classList.remove('drag-over'));
  });
  // Prevent cards from acting as drop targets (causes red error rectangles)
  cardEl.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); });
  cardEl.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); });
}

// ─── Socket.io: Real-time run updates ────────────────────────

if (typeof socket !== 'undefined') {
  socket.on('run_complete', (data) => {
    if (currentView === 'tasks') {loadTasks();}
  });
}

// ─── Project CRUD ────────────────────────────────────────────

function showCreateProject() {
  showModal(`
    <h2>New Project</h2>
    <div class="modal-form-grid">
      <div class="modal-form-row">
        <div class="modal-form-col">
          <label>Project Name</label>
          <input type="text" id="new-project-name" placeholder="e.g. Video Pipeline v2">
        </div>
      </div>
      <div class="modal-form-row">
        <div class="modal-form-col">
          <label>Description</label>
          <textarea id="new-project-desc" rows="2" placeholder="What this project is about"></textarea>
        </div>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="submitCreateProject()">Create Project</button>
    </div>
  `);
}

async function submitCreateProject() {
  const name = document.getElementById('new-project-name')?.value?.trim();
  const description = document.getElementById('new-project-desc')?.value?.trim();
  if (!name) { showToast('Project name required', 'error'); return; }
  const result = await api('/projects', { method: 'POST', body: { name, description } });
  if (result?.error) { showToast(result.error, 'error'); return; }
  showToast(`Project "${name}" created`, 'success');
  closeModal();
  loadTasks();
}

async function deleteProject() {
  const filter = document.getElementById('task-project-filter');
  const projectId = filter?.value;
  if (!projectId) { showToast('Select a project first', 'error'); return; }
  const projectName = filter.options[filter.selectedIndex]?.textContent || 'this project';
  const ok = await dashConfirm(`Archive project "${projectName}"?\n\nTasks will remain but won't be grouped under this project.`);
  if (!ok) {return;}
  const result = await api(`/projects/${projectId}`, { method: 'DELETE' });
  if (result?.ok) {
    showToast(`Project "${projectName}" archived`, 'success');
    filter.value = '';
    loadTasks();
  } else {
    showToast(result?.error || 'Delete failed', 'error');
  }
}

// ─── Task CRUD ───────────────────────────────────────────────

async function showCreateTask() {
  const agents = await api('/agents');
  const agentList = (agents?.agents || []).filter(a => a.inConfig);

  showModal(`
    <h2>New Task</h2>
    <div class="modal-form-grid">
      <div class="modal-form-row">
        <div class="modal-form-col">
          <label>Title</label>
          <input type="text" id="new-task-title" placeholder="Task title">
        </div>
      </div>
      <div class="modal-form-row">
        <div class="modal-form-col">
          <label>Description <span class="label-hint">Short summary shown on card</span></label>
          <textarea id="new-task-desc" rows="2" placeholder="One-line summary of the task"></textarea>
        </div>
      </div>
      <div class="modal-form-row modal-form-row-3">
        <div class="modal-form-col">
          <label>Status</label>
          <select id="new-task-status">
            ${KANBAN_COLS.map(c => `<option value="${c.status}">${c.label}</option>`).join('')}
          </select>
        </div>
        <div class="modal-form-col">
          <label>Type</label>
          <select id="new-task-type">
            <option value="build">Build</option>
            <option value="plan">Plan</option>
            <option value="ops">Ops</option>
          </select>
        </div>
        <div class="modal-form-col">
          <label>Agent</label>
          <select id="new-task-agent">
            <option value="">Unassigned</option>
            ${agentList.map(a => `<option value="${a.id}">${a.id} (${a.modelTier})</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="modal-form-row">
        <div class="modal-form-col">
          <label>Agent Brief <span class="label-hint">Detailed instructions the agent receives when dispatched</span></label>
          <textarea id="new-task-brief" rows="8" placeholder="Write the full context here:&#10;- What problem are we solving?&#10;- What approach should be taken?&#10;- What files to look at for reference?&#10;- What patterns to follow?&#10;- What to NOT do?&#10;- Acceptance criteria"></textarea>
        </div>
      </div>
      <div class="modal-form-row">
        <div class="modal-form-col">
          <label>Reference Files <span class="label-hint">Selected files are embedded in the agent's prompt so it has context. Larger files are truncated at 4KB.</span></label>
          <div class="ref-files-section">
            <div class="ref-files-core">
              ${CORE_REF_FILES.map(f => `
                <label class="ref-file-check">
                  <input type="checkbox" value="${f.path}" ${f.always ? 'checked' : ''}>
                  <span class="ref-file-name">${f.label}</span>
                  <span class="ref-file-hint">${f.hint}</span>
                </label>
              `).join('')}
            </div>
            <div class="ref-files-custom">
              <div id="new-task-custom-refs"></div>
              <button type="button" class="btn-add-file" onclick="openFileBrowser('new-task-custom-refs')">+ Browse files</button>
            </div>
          </div>
        </div>
      </div>
      <div class="modal-form-row">
        <div class="modal-form-col">
          <label>Expected Deliverables <span class="label-hint">Listed in the agent brief so it knows what to produce. Not auto-verified.</span></label>
          <textarea id="new-task-deliverables" rows="2" placeholder="e.g. scripts/analytics-report.sh, cron registered in openclaw.json"></textarea>
        </div>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="createTask()">Create</button>
    </div>
  `, 'modal-wide');
  setTimeout(() => document.getElementById('new-task-title')?.focus(), 50);
}

async function createTask() {
  const title = document.getElementById('new-task-title')?.value.trim();
  if (!title) {return;}

  const projects = await api('/projects') || [];
  const projectId = projects[0]?.id;

  const refFiles = collectRefFiles('new-task-custom-refs');

  await api('/tasks', {
    method: 'POST',
    body: {
      project_id: projectId,
      title,
      description: document.getElementById('new-task-desc')?.value.trim(),
      status: document.getElementById('new-task-status')?.value || 'backlog',
      type: document.getElementById('new-task-type')?.value || 'build',
      assigned_agent: document.getElementById('new-task-agent')?.value.trim(),
      brief: document.getElementById('new-task-brief')?.value.trim(),
      reference_files: JSON.stringify(refFiles),
      expected_deliverables: document.getElementById('new-task-deliverables')?.value.trim(),
    }
  });
  closeModal();
  await loadTasks();
}

// Collect ref files from checkboxes + custom entries
function collectRefFiles(customContainerId) {
  const checked = [...document.querySelectorAll('.ref-files-core input[type=checkbox]:checked')]
    .map(cb => cb.value);
  const custom = [...document.querySelectorAll(`#${customContainerId} .ref-file-entry`)]
    .map(el => el.dataset.path).filter(Boolean);
  return [...checked, ...custom];
}

// File browser modal
async function openFileBrowser(targetContainerId) {
  window._fileBrowserTarget = targetContainerId;
  await renderFileBrowser('/opt/AIWH/core');
}

async function renderFileBrowser(dir) {
  const data = await api(`/files/browse?dir=${encodeURIComponent(dir)}`);
  if (!data) {return;}

  const target = window._fileBrowserTarget;
  const entries = data.entries || [];

  // Build file list
  const items = entries.map(e => {
    if (e.isDir) {
      return `<div class="fb-entry fb-dir" onclick="renderFileBrowser('${e.path}')">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 4l2-2h4l2 2h4v10H2V4z" stroke="currentColor" stroke-width="1.2"/></svg>
        ${escHtml(e.name)}/
      </div>`;
    }
    const isMd = e.ext === '.md';
    const isSh = e.ext === '.sh';
    const isJs = e.ext === '.js';
    const isPy = e.ext === '.py';
    const isRelevant = isMd || isSh || isJs || isPy || e.ext === '.json';
    return `<div class="fb-entry fb-file ${isRelevant ? 'fb-relevant' : 'fb-dim'}" onclick="addRefFile('${e.path}', '${escHtml(e.name)}')">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 2h6l4 4v8H4V2z" stroke="currentColor" stroke-width="1.2"/><path d="M10 2v4h4" stroke="currentColor" stroke-width="1.2"/></svg>
      ${escHtml(e.name)}
    </div>`;
  }).join('');

  const shortDir = data.dir.replace('/opt/AIWH/core', '~');

  // Show in a sub-modal (overlay on top of current modal)
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
    ${data.parent ? `<div class="fb-entry fb-dir fb-up" onclick="renderFileBrowser('${data.parent}')">.. (up)</div>` : ''}
    <div class="fb-entries">${items}</div>
  `;
  fb.style.display = 'flex';
}

function addRefFile(filePath, fileName) {
  const target = document.getElementById(window._fileBrowserTarget);
  if (!target) {return;}
  // Don't add duplicates
  if (target.querySelector(`[data-path="${filePath}"]`)) {return;}
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
  // Close file browser
  document.getElementById('file-browser-panel')?.remove();
}

async function editTask(id) {
  const [task, agents] = await Promise.all([
    api(`/tasks/${id}`),
    api('/agents'),
  ]);
  if (!task) {return;}
  const agentList = (agents?.agents || []).filter(a => a.inConfig);

  let refFiles = [];
  try { refFiles = JSON.parse(task.reference_files || '[]'); } catch {}

  // Split into core (checkbox) and custom (added via browser)
  const corePaths = new Set(CORE_REF_FILES.map(f => f.path));
  const customRefs = refFiles.filter(f => !corePaths.has(f));

  showModal(`
    <h2>Edit Task</h2>
    <div class="modal-form-grid">
      <div class="modal-form-row">
        <div class="modal-form-col">
          <label>Title</label>
          <input type="text" id="edit-task-title" value="${escHtml(task.title || '')}">
        </div>
      </div>
      <div class="modal-form-row">
        <div class="modal-form-col">
          <label>Description <span class="label-hint">Short summary shown on card</span></label>
          <textarea id="edit-task-desc" rows="2">${escHtml(task.description || '')}</textarea>
        </div>
      </div>
      <div class="modal-form-row modal-form-row-3">
        <div class="modal-form-col">
          <label>Status</label>
          <select id="edit-task-status">
            ${KANBAN_COLS.map(c => `<option value="${c.status}" ${task.status === c.status ? 'selected' : ''}>${c.label}</option>`).join('')}
          </select>
        </div>
        <div class="modal-form-col">
          <label>Type</label>
          <select id="edit-task-type">
            <option value="build" ${task.type === 'build' ? 'selected' : ''}>Build</option>
            <option value="plan" ${task.type === 'plan' ? 'selected' : ''}>Plan</option>
            <option value="ops" ${task.type === 'ops' ? 'selected' : ''}>Ops</option>
          </select>
        </div>
        <div class="modal-form-col">
          <label>Agent</label>
          <select id="edit-task-agent">
            <option value="">Unassigned</option>
            ${agentList.map(a => `<option value="${a.id}" ${task.assigned_agent === a.id ? 'selected' : ''}>${a.id} (${a.modelTier})</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="modal-form-row">
        <div class="modal-form-col">
          <label>Agent Brief <span class="label-hint">Detailed instructions the agent receives when dispatched</span></label>
          <textarea id="edit-task-brief" rows="8">${escHtml(task.brief || '')}</textarea>
        </div>
      </div>
      <div class="modal-form-row">
        <div class="modal-form-col">
          <label>Reference Files <span class="label-hint">Selected files are embedded in the agent's prompt so it has context. Larger files are truncated at 4KB.</span></label>
          <div class="ref-files-section">
            <div class="ref-files-core">
              ${CORE_REF_FILES.map(f => `
                <label class="ref-file-check">
                  <input type="checkbox" value="${f.path}" ${refFiles.includes(f.path) ? 'checked' : ''}>
                  <span class="ref-file-name">${f.label}</span>
                  <span class="ref-file-hint">${f.hint}</span>
                </label>
              `).join('')}
            </div>
            <div class="ref-files-custom">
              <div id="edit-task-custom-refs">
                ${customRefs.map(p => `
                  <div class="ref-file-entry" data-path="${escHtml(p)}">
                    <span class="ref-file-name">${escHtml(p.split('/').pop())}</span>
                    <span class="ref-file-path">${escHtml(p.replace('/opt/AIWH/core/', ''))}</span>
                    <button class="btn-icon-xs btn-danger-xs" onclick="this.parentElement.remove()" title="Remove">
                      <svg width="8" height="8" viewBox="0 0 12 12" fill="none"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
                    </button>
                  </div>
                `).join('')}
              </div>
              <button type="button" class="btn-add-file" onclick="openFileBrowser('edit-task-custom-refs')">+ Browse files</button>
            </div>
          </div>
        </div>
      </div>
      <div class="modal-form-row">
        <div class="modal-form-col">
          <label>Expected Deliverables <span class="label-hint">Listed in the agent brief so it knows what to produce. Not auto-verified.</span></label>
          <textarea id="edit-task-deliverables" rows="2">${escHtml(task.expected_deliverables || '')}</textarea>
        </div>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="updateTask(${id})">Save</button>
    </div>
  `, 'modal-wide');
}

async function updateTask(id) {
  const refFiles = collectRefFiles('edit-task-custom-refs');

  await api(`/tasks/${id}`, {
    method: 'PUT',
    body: {
      title: document.getElementById('edit-task-title')?.value.trim(),
      description: document.getElementById('edit-task-desc')?.value.trim(),
      status: document.getElementById('edit-task-status')?.value,
      type: document.getElementById('edit-task-type')?.value,
      assigned_agent: document.getElementById('edit-task-agent')?.value.trim(),
      brief: document.getElementById('edit-task-brief')?.value.trim(),
      reference_files: JSON.stringify(refFiles),
      expected_deliverables: document.getElementById('edit-task-deliverables')?.value.trim(),
    }
  });
  closeModal();
  await loadTasks();
}

async function viewRunLog(taskId) {
  const run = await api(`/tasks/${taskId}/last-run`);
  if (!run) {return showToast('No run found for this task', 'error');}

  const statusIcon = run.status === 'completed' ? '\u2705' : run.status === 'failed' ? '\u274C' : '\u26A0\uFE0F';
  const duration = run.duration_ms ? `${(run.duration_ms / 1000).toFixed(0)}s` : '—';
  const log = run.log || '(no output captured)';

  showModal(`
    <h2>Agent Work Log</h2>
    <div class="dispatch-summary">
      <div class="dispatch-field">
        <span class="dispatch-label">Agent</span>
        <span class="dispatch-value">${escHtml(run.agent_id)}</span>
      </div>
      <div class="dispatch-field">
        <span class="dispatch-label">Status</span>
        <span class="dispatch-value">${statusIcon} ${run.status} (exit ${run.exit_code ?? '?'})</span>
      </div>
      <div class="dispatch-field">
        <span class="dispatch-label">Duration</span>
        <span class="dispatch-value mono">${duration}</span>
      </div>
      <div class="dispatch-field">
        <span class="dispatch-label">Ran at</span>
        <span class="dispatch-value">${run.started_at || '—'}</span>
      </div>
    </div>
    <div class="run-log-output">${escHtml(log)}</div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Close</button>
    </div>
  `);
}

async function approveTask(id) {
  await api(`/tasks/${id}`, { method: 'PUT', body: { status: 'done' } });
  showToast('Task approved', 'info');
  await loadTasks();
}

function showRejectModal(taskId) {
  showModal(`
    <h2>Reject Task</h2>
    <p style="color:var(--text-secondary);margin-bottom:16px;">What should happen next?</p>
    <div class="modal-actions" style="flex-direction:column;gap:8px;">
      <button class="btn btn-primary" onclick="rejectTask(${taskId},'planned')" style="width:100%;justify-content:flex-start;">
        Retry — move to <strong>Planned</strong> (re-dispatchable)
      </button>
      <button class="btn btn-ghost" onclick="rejectTask(${taskId},'blocked')" style="width:100%;justify-content:flex-start;border-color:var(--critical);">
        Needs manual fix — move to <strong>Blocked</strong>
      </button>
      <button class="btn btn-ghost" onclick="closeModal()" style="width:100%;margin-top:8px;">Cancel</button>
    </div>
  `);
}

async function rejectTask(id, targetStatus) {
  closeModal();
  await api(`/tasks/${id}`, { method: 'PUT', body: { status: targetStatus } });
  showToast(`Task rejected — moved to ${targetStatus}`, 'info');
  await loadTasks();
}

async function deleteTask(id) {
  const ok = typeof dashConfirm === 'function' ? await dashConfirm('Delete this task?') : confirm('Delete this task?');
  if (!ok) {return;}
  await api(`/tasks/${id}`, { method: 'DELETE' });
  await loadTasks();
}
