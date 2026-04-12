// Tasks View — kanban board rendering, drag-drop, dispatch, task actions.
// Imports KANBAN_COLS from tasks-crud.ts.

import { KANBAN_COLS } from './tasks-crud.js';

const api = (window as any).api as (url: string, opts?: any) => Promise<any>;
const showToast = (window as any).showToast as (msg: string, type?: string) => void;
const showModal = (window as any).showModal as (html: string, cls?: string) => void;
const closeModal = (window as any).closeModal as () => void;
const escHtml = (window as any).escHtml as (s: string) => string;
const timeAgo = (window as any).timeAgo as (d: string) => string;
const dashConfirm = (window as any).dashConfirm as (msg: string) => Promise<boolean>;

let _taskDragItem: string | null = null;
let _taskDragStatus: string | null = null;
const DONE_VISIBLE_DEFAULT = 5;
// _showAllDone is on window because inline onclick handlers set it directly
(window as any)._showAllDone = (window as any)._showAllDone || false;
let _socketBound = false;

/* ── Init / Load ──────────────────────────────────────────── */

async function initTasks() {
  await loadTasks();
  setupKanbanDragDrop();
  // Bind socket once
  if (!_socketBound && typeof (window as any).socket !== 'undefined') {
    (window as any).socket.on('run_complete', () => {
      if ((window as any).currentView === 'tasks') { loadTasks(); }
    });
    _socketBound = true;
  }
}

async function loadTasks() {
  let url = '/tasks';
  const filter = document.getElementById('task-project-filter') as HTMLSelectElement | null;
  if (filter?.value) { url += `?project_id=${filter.value}`; }
  const tasks = await api(url) || [];
  const projects = await api('/projects') || [];
  populateTaskProjectFilter(projects);
  renderKanban(tasks);
}

function populateTaskProjectFilter(projects: any[]) {
  const el = document.getElementById('task-project-filter') as HTMLSelectElement | null;
  if (!el) { return; }
  const val = el.value;
  el.innerHTML = '<option value="">All Projects</option>' +
    projects.map(p => `<option value="${p.id}">${escHtml(p.name)}</option>`).join('');
  if (val) { el.value = val; }
}

/* ── Kanban Rendering ─────────────────────────────────────── */

function renderKanban(tasks: any[]) {
  for (const col of KANBAN_COLS) {
    const cards = tasks.filter(t => t.status === col.status);
    const colEl = document.getElementById(`kanban-col-${col.status}`);
    const countEl = document.getElementById(`kanban-count-${col.status}`);
    if (countEl) { countEl.textContent = String(cards.length); }
    if (!colEl) { continue; }
    if (col.status === 'done') {
      cards.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
      const visible = (window as any)._showAllDone ? cards : cards.slice(0, DONE_VISIBLE_DEFAULT);
      const hidden = cards.length - DONE_VISIBLE_DEFAULT;
      colEl.innerHTML = visible.map(t => renderDoneCard(t)).join('');
      if (hidden > 0 && !(window as any)._showAllDone) {
        colEl.innerHTML += `<button class="done-show-more" onclick="_showAllDone=true;loadTasks()">Show ${hidden} more completed</button>`;
      } else if ((window as any)._showAllDone && cards.length > DONE_VISIBLE_DEFAULT) {
        colEl.innerHTML += `<button class="done-show-more" onclick="_showAllDone=false;loadTasks()">Show less</button>`;
      }
    } else {
      colEl.innerHTML = cards.map(t => renderTaskCard(t)).join('');
    }
    colEl.querySelectorAll('.task-card').forEach(c => setupCardDrag(c as HTMLElement));
  }
}

function renderDoneCard(task: any): string {
  return `<div class="task-card task-card-done" data-task-id="${task.id}" data-status="done" onclick="editTask(${task.id})">
    <div class="done-card-row">
      <span class="done-check"><svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M2 8.5l4 4 8-9" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
      <span class="done-title">${escHtml(task.title)}</span>
      <span class="task-time">${timeAgo(task.updated_at)}</span>
    </div>
  </div>`;
}

function renderTaskCard(task: any): string {
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
      ${task.type ? `<span class="task-type-badge">${escHtml(task.type)}</span>` : ''}
      <span class="task-time">${timeAgo(task.updated_at)}</span>
    </div>
    ${inReview ? `<div class="task-review-actions">
      <button class="btn-review btn-review-log" onclick="event.stopPropagation();viewRunLog(${task.id})" title="View agent work">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M2 3h12M2 7h12M2 11h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg> View Work</button>
      <button class="btn-review btn-review-approve" onclick="event.stopPropagation();approveTask(${task.id})" title="Approve \u2014 mark done">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M2 8.5l4 4 8-9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg> Approve</button>
      <button class="btn-review btn-review-reject" onclick="event.stopPropagation();showRejectModal(${task.id})" title="Reject">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> Reject</button>
    </div>` : ''}
    <div class="task-card-actions">
      ${canRun ? `<button class="btn-icon-xs btn-run-xs" onclick="event.stopPropagation();showDispatchModal(${task.id})" title="Run agent">
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M4 2.5l9 5.5-9 5.5V2.5z" fill="currentColor"/></svg></button>` : ''}
      ${canCancel ? `<button class="btn-icon-xs btn-danger-xs" onclick="event.stopPropagation();cancelDispatch(${task.id})" title="Cancel run">
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>` : ''}
      <button class="btn-icon-xs" onclick="event.stopPropagation();editTask(${task.id})" title="Edit">
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg></button>
      <button class="btn-icon-xs btn-danger-xs" onclick="event.stopPropagation();deleteTask(${task.id})" title="Delete">
        <svg width="8" height="8" viewBox="0 0 12 12" fill="none"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
    </div>
    ${isRunning ? '<div class="task-running-indicator"><span class="running-dot"></span> Running</div>' : ''}
  </div>`;
}

/* ── Dispatch ─────────────────────────────────────────────── */

async function showDispatchModal(taskId: number) {
  const info = await api(`/tasks/${taskId}/dispatch-info`);
  if (!info) { return showToast('Failed to load dispatch info', 'error'); }
  if (!info.canDispatch) { showToast(info.reason, 'error'); return; }
  const budgetWarning = info.budget.overBudget
    ? `<div class="dispatch-warning">Daily budget exceeded ($${info.budget.dailySpend.toFixed(2)}/$${info.budget.dailyBudget.toFixed(2)})</div>` : '';
  const agentBusyNote = info.agent.busy
    ? `<div class="dispatch-info-note">Agent is busy \u2014 task will be <strong>queued</strong> and start when agent is free.</div>` : '';
  const queueNote = info.queueDepth > 0
    ? `<div class="dispatch-info-note">${info.queueDepth} task(s) already in queue.</div>` : '';
  showModal(`
    <h2>Dispatch Task</h2>
    <div class="dispatch-summary">
      <div class="dispatch-field"><span class="dispatch-label">Task</span><span class="dispatch-value">${escHtml(info.task.title)}</span></div>
      <div class="dispatch-field"><span class="dispatch-label">Agent</span><span class="dispatch-value">${escHtml(info.agent.id)} <span class="task-type-badge">${escHtml(info.agent.tier || '')}</span></span></div>
      <div class="dispatch-field"><span class="dispatch-label">Context</span><span class="dispatch-value mono">~${(info.estimate.inputTokens || 0).toLocaleString()} tokens${info.estimate.refFileCount ? ` (${info.estimate.refFileCount} files embedded)` : ''}${info.task.hasBrief ? '' : ' <span class="dispatch-warning-inline">no brief!</span>'}</span></div>
      <div class="dispatch-field"><span class="dispatch-label">Est. Cost</span><span class="dispatch-value mono">~$${info.estimate.cost.toFixed(3)}</span></div>
      <div class="dispatch-field"><span class="dispatch-label">Budget</span><span class="dispatch-value mono">$${info.budget.dailySpend.toFixed(2)} / $${info.budget.dailyBudget.toFixed(2)}</span></div>
    </div>
    ${!info.task.hasBrief ? '<div class="dispatch-warning">This task has no agent brief. The agent will have minimal instructions. Consider editing the task first.</div>' : ''}
    ${budgetWarning}${agentBusyNote}${queueNote}
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="confirmDispatch(${taskId})">${info.agent.busy ? 'Queue Task' : 'Start Work'}</button>
    </div>
  `);
}

async function confirmDispatch(taskId: number) {
  closeModal();
  const result = await api(`/tasks/${taskId}/dispatch`, { method: 'POST' });
  if (!result) { return showToast('Dispatch failed', 'error'); }
  if (result.queued) { showToast('Task queued \u2014 will start when agent is free', 'info'); }
  else if (result.dispatched) { showToast('Agent dispatched', 'info'); }
  else if (result.error) { showToast(result.error, 'error'); }
  await loadTasks();
}

async function cancelDispatch(taskId: number) {
  const result = await api(`/tasks/${taskId}/cancel-dispatch`, { method: 'POST' });
  if (result?.ok) { showToast('Dispatch cancelled', 'info'); await loadTasks(); }
}

/* ── Drag & Drop ──────────────────────────────────────────── */

function setupKanbanDragDrop() {
  document.querySelectorAll('.kanban-column').forEach(col => {
    col.addEventListener('dragover', (e: Event) => {
      (e as DragEvent).preventDefault();
      (e as DragEvent).dataTransfer!.dropEffect = 'move';
      col.classList.add('drag-over');
    });
    col.addEventListener('dragleave', (e: Event) => {
      if (!col.contains((e as MouseEvent).relatedTarget as Node)) { col.classList.remove('drag-over'); }
    });
    col.addEventListener('drop', async (e: Event) => {
      (e as DragEvent).preventDefault();
      col.classList.remove('drag-over');
      const dragItemId = _taskDragItem;
      const dragItemStatus = _taskDragStatus;
      if (!dragItemId) { return; }
      const newStatus = (col as HTMLElement).dataset.status;
      if (newStatus === dragItemStatus) { return; }
      const r = await api(`/tasks/${dragItemId}/move`, { method: 'POST', body: { status: newStatus, sort_order: Date.now() } });
      if (r?.ok) {
        const label = KANBAN_COLS.find(c => c.status === newStatus)?.label || newStatus;
        showToast(`Moved to ${label}`, 'success');
      } else {
        showToast('Failed to move task: ' + (r?.error || 'unknown'), 'error');
      }
      await loadTasks();
    });
  });
}

function setupCardDrag(cardEl: HTMLElement) {
  cardEl.draggable = true;
  cardEl.addEventListener('dragstart', (e: Event) => {
    _taskDragItem = cardEl.dataset.taskId || null;
    _taskDragStatus = cardEl.dataset.status || null;
    cardEl.classList.add('dragging');
    (e as DragEvent).dataTransfer!.effectAllowed = 'move';
    (e as DragEvent).dataTransfer!.setData('text/plain', cardEl.dataset.taskId || '');
  });
  cardEl.addEventListener('dragend', () => {
    _taskDragItem = null;
    cardEl.classList.remove('dragging');
    document.querySelectorAll('.drag-over').forEach(c => c.classList.remove('drag-over'));
  });
  cardEl.addEventListener('dragover', (e: Event) => { e.preventDefault(); });
  cardEl.addEventListener('drop', (e: Event) => { e.preventDefault(); });
}

/* ── Task Actions ─────────────────────────────────────────── */

async function viewRunLog(taskId: number) {
  const run = await api(`/tasks/${taskId}/last-run`);
  if (!run) { return showToast('No run found for this task', 'error'); }
  const statusIcon = run.status === 'completed' ? '\u2705' : run.status === 'failed' ? '\u274C' : '\u26A0\uFE0F';
  const duration = run.duration_ms ? `${(run.duration_ms / 1000).toFixed(0)}s` : '\u2014';
  const log = run.log || '(no output captured)';
  showModal(`
    <h2>Agent Work Log</h2>
    <div class="dispatch-summary">
      <div class="dispatch-field"><span class="dispatch-label">Agent</span><span class="dispatch-value">${escHtml(run.agent_id)}</span></div>
      <div class="dispatch-field"><span class="dispatch-label">Status</span><span class="dispatch-value">${statusIcon} ${run.status} (exit ${run.exit_code ?? '?'})</span></div>
      <div class="dispatch-field"><span class="dispatch-label">Duration</span><span class="dispatch-value mono">${duration}</span></div>
      <div class="dispatch-field"><span class="dispatch-label">Ran at</span><span class="dispatch-value">${run.started_at || '\u2014'}</span></div>
    </div>
    <div class="run-log-output">${escHtml(log)}</div>
    <div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Close</button></div>
  `);
}

async function approveTask(id: number) {
  const r = await api(`/tasks/${id}`, { method: 'PUT', body: { status: 'done' } });
  if (r?.error) { return showToast('Failed: ' + r.error, 'error'); }
  showToast('Task approved', 'success');
  await loadTasks();
}

function showRejectModal(taskId: number) {
  showModal(`
    <h2>Reject Task</h2>
    <p style="color:var(--text-secondary);margin-bottom:16px;">What should happen next?</p>
    <div class="modal-actions" style="flex-direction:column;gap:8px;">
      <button class="btn btn-primary" onclick="rejectTask(${taskId},'planned')" style="width:100%;justify-content:flex-start;">Retry \u2014 move to <strong>Planned</strong> (re-dispatchable)</button>
      <button class="btn btn-ghost" onclick="rejectTask(${taskId},'blocked')" style="width:100%;justify-content:flex-start;border-color:var(--critical);">Needs manual fix \u2014 move to <strong>Blocked</strong></button>
      <button class="btn btn-ghost" onclick="closeModal()" style="width:100%;margin-top:8px;">Cancel</button>
    </div>
  `);
}

async function rejectTask(id: number, targetStatus: string) {
  closeModal();
  const r = await api(`/tasks/${id}`, { method: 'PUT', body: { status: targetStatus } });
  if (r?.error) { return showToast('Failed: ' + r.error, 'error'); }
  showToast(`Task rejected \u2014 moved to ${targetStatus}`, 'info');
  await loadTasks();
}

async function deleteTask(id: number) {
  const ok = await dashConfirm('Delete this task?');
  if (!ok) { return; }
  await api(`/tasks/${id}`, { method: 'DELETE' });
  await loadTasks();
}

// Expose on window
(window as any).initTasks = initTasks;
(window as any).loadTasks = loadTasks;
(window as any).showDispatchModal = showDispatchModal;
(window as any).confirmDispatch = confirmDispatch;
(window as any).cancelDispatch = cancelDispatch;
(window as any).viewRunLog = viewRunLog;
(window as any).approveTask = approveTask;
(window as any).showRejectModal = showRejectModal;
(window as any).rejectTask = rejectTask;
(window as any).deleteTask = deleteTask;
