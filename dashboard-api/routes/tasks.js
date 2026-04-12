// ─── Routes: Tasks (Kanban) + Runs + Dispatch ────────────────
const fs = require('fs');
const path = require('path');

const CORE = '/opt/AIWH/core';

module.exports = function(app, deps) {
  const { db, io, adapter, notifEngine, sendDiscordAlert, logActivity, dashLog, buildAgentAliasMap, costSync } = deps;

app.get('/api/projects/:projectId/tasks', (req, res) => {
  const tasks = db.prepare(
    'SELECT * FROM tasks WHERE project_id=? ORDER BY sort_order, created_at'
  ).all(req.params.projectId);
  res.json(tasks);
});

app.get('/api/tasks', (req, res) => {
  let sql = 'SELECT t.*, p.name as project_name, p.slug as project_slug FROM tasks t LEFT JOIN projects p ON t.project_id = p.id WHERE (p.archived = 0 OR p.id IS NULL)';
  const params = [];
  if (req.query.status) { sql += ' AND t.status = ?'; params.push(req.query.status); }
  if (req.query.project_id) { sql += ' AND t.project_id = ?'; params.push(req.query.project_id); }
  sql += ' ORDER BY t.sort_order, t.created_at';
  res.json(db.prepare(sql).all(...params));
});

app.post('/api/tasks', (req, res) => {
  let { project_id, title, description, type, status, priority, assigned_agent, expected_deliverables, brief, reference_files } = req.body;
  if (!title) return res.status(400).json({ error: 'title required' });
  // Auto-resolve default project if none provided
  if (!project_id) {
    const def = db.prepare('SELECT id FROM projects WHERE archived=0 ORDER BY id LIMIT 1').get();
    project_id = def?.id;
  }
  if (!project_id) return res.status(400).json({ error: 'No project available' });
  const maxSort = db.prepare('SELECT COALESCE(MAX(sort_order),0)+1 as n FROM tasks WHERE project_id=? AND status=?')
    .get(project_id, status || 'backlog');
  const r = db.prepare(
    'INSERT INTO tasks (project_id, title, description, type, status, priority, assigned_agent, expected_deliverables, brief, reference_files, sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
  ).run(project_id, title, description || '', type || 'build', status || 'backlog', priority || 0, assigned_agent || '', expected_deliverables || '', brief || '', reference_files || '[]', maxSort.n);
  logActivity(project_id, assigned_agent || '', 'task_created', title);
  io.emit('task_updated', { project_id });
  res.json({ id: r.lastInsertRowid });
});

app.get('/api/tasks/:id', (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Not found' });
  res.json(task);
});

// File browser for reference file picker
app.get('/api/files/browse', (req, res) => {
  const dir = path.resolve(req.query.dir || CORE);
  // Security: only allow browsing under /opt/AIWH (canonicalized to prevent traversal)
  if (!dir.startsWith('/opt/AIWH/')) return res.status(403).json({ error: 'Access denied' });
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => !e.name.startsWith('.') && !['node_modules', '__pycache__', '.git'].includes(e.name))
      .map(e => ({
        name: e.name,
        path: path.join(dir, e.name),
        isDir: e.isDirectory(),
        ext: e.isDirectory() ? '' : path.extname(e.name),
      }))
      .sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    res.json({ dir, entries, parent: dir === '/opt/AIWH' ? null : path.dirname(dir) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/tasks/:id', (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Not found' });

  const fields = ['title', 'description', 'type', 'status', 'priority', 'assigned_agent', 'expected_deliverables', 'brief', 'reference_files', 'sort_order', 'project_id'];
  const updates = [];
  const vals = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      updates.push(`${f}=?`);
      vals.push(req.body[f]);
    }
  }
  if (updates.length === 0) return res.json({ ok: true });
  updates.push("updated_at=datetime('now')");
  vals.push(req.params.id);
  db.prepare(`UPDATE tasks SET ${updates.join(',')} WHERE id=?`).run(...vals);

  // Log status changes
  if (req.body.status && req.body.status !== task.status) {
    logActivity(task.project_id, task.assigned_agent, 'task_status_changed',
      `${task.title}: ${task.status} → ${req.body.status}`);
  }
  io.emit('task_updated', { project_id: task.project_id });
  res.json({ ok: true });
});

app.delete('/api/tasks/:id', (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.id);
  if (task) {
    logActivity(task.project_id, '', 'task_deleted', task.title);
  }
  db.prepare('DELETE FROM tasks WHERE id=?').run(req.params.id);
  io.emit('task_updated', { project_id: task?.project_id });
  res.json({ ok: true });
});

// Last run for a task (for review cards)
app.get('/api/tasks/:id/last-run', (req, res) => {
  const run = db.prepare(
    'SELECT id, agent_id, status, exit_code, log, started_at, finished_at, duration_ms, cost FROM runs WHERE task_id=? ORDER BY id DESC LIMIT 1'
  ).get(req.params.id);
  if (!run) return res.json(null);
  res.json(run);
});

// Kanban: reorder / move between columns
app.post('/api/tasks/:id/move', (req, res) => {
  const { status, sort_order } = req.body;
  const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Not found' });
  db.prepare("UPDATE tasks SET status=?, sort_order=?, updated_at=datetime('now') WHERE id=?")
    .run(status || task.status, sort_order ?? task.sort_order, req.params.id);
  if (status && status !== task.status) {
    logActivity(task.project_id, task.assigned_agent, 'task_moved',
      `${task.title}: ${task.status} → ${status}`);
  }
  io.emit('task_updated', { project_id: task.project_id });
  res.json({ ok: true });
});

// ─── Task Dispatch ───────────────────────────────────────────

// Cost estimation for dispatch confirmation
app.get('/api/tasks/:id/dispatch-info', (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Not found' });

  if (!task.assigned_agent) {
    return res.json({ canDispatch: false, reason: 'No agent assigned to this task' });
  }

  // Check if already running
  if (task.dispatch_run_id) {
    const run = db.prepare('SELECT status FROM runs WHERE id=?').get(task.dispatch_run_id);
    if (run?.status === 'running') {
      return res.json({ canDispatch: false, reason: 'Task already has an active run' });
    }
  }

  // Check if agent is busy
  const agentBusy = db.prepare("SELECT status FROM agents WHERE id=?").get(task.assigned_agent);

  // Estimate message size from brief + reference files
  let refFiles = [];
  try { refFiles = JSON.parse(task.reference_files || '[]'); } catch {}
  let contextChars = (task.brief || '').length + (task.description || '').length + (task.expected_deliverables || '').length;
  for (const fp of refFiles) {
    try {
      const stat = fs.statSync(fp);
      contextChars += stat.size;
    } catch {}
  }
  const estInputTokens = Math.ceil(contextChars / 3.5) + 500; // ~3.5 chars/token + overhead
  const estOutputTokens = 1500;

  // Estimate cost
  const agent = deps.agentsFullCache.find(a => a.id === task.assigned_agent);
  const tier = agent?.modelTier || 'haiku';
  const est = adapter.estimateCost(tier, estInputTokens, estOutputTokens);

  // Budget check
  const dailySpend = costSync.getDailySpend();
  const dailyBudget = parseFloat(db.prepare("SELECT value FROM settings WHERE key='daily_budget'").get()?.value || '5');

  // Check queue depth
  const queueDepth = db.prepare("SELECT COUNT(*) as n FROM task_queue WHERE status='queued'").get()?.n || 0;

  res.json({
    canDispatch: true,
    task: { id: task.id, title: task.title, description: task.description, hasBrief: !!(task.brief) },
    agent: { id: task.assigned_agent, tier, busy: agentBusy?.status === 'active' },
    estimate: { cost: est, tier, inputTokens: estInputTokens, refFileCount: refFiles.length },
    budget: { dailySpend, dailyBudget, overBudget: dailySpend >= dailyBudget },
    queueDepth,
  });
});

// Dispatch a task — spawns the assigned agent
app.post('/api/tasks/:id/dispatch', (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Not found' });
  if (!task.assigned_agent) return res.status(400).json({ error: 'No agent assigned to this task' });

  // Check for active run
  if (task.dispatch_run_id) {
    const existingRun = db.prepare('SELECT status FROM runs WHERE id=?').get(task.dispatch_run_id);
    if (existingRun?.status === 'running') {
      return res.status(409).json({ error: 'Task already has an active run' });
    }
  }

  // Build dispatch message with embedded file contents
  const agent = deps.agentsFullCache.find(a => a.id === task.assigned_agent);
  const agentWorkspace = agent?.workspace || '';

  // Parse reference files (JSON array of paths)
  let refFiles = [];
  try { refFiles = JSON.parse(task.reference_files || '[]'); } catch {}

  // Read and embed reference file contents (server-side, bypasses sandbox)
  // Cap each file at 4000 chars to prevent prompt bloat
  const REF_FILE_MAX_CHARS = 4000;
  const embeddedFiles = [];
  for (const filePath of refFiles) {
    const resolvedRef = path.resolve(filePath);
    if (!resolvedRef.startsWith('/opt/AIWH/')) continue; // security guard
    try {
      let content = fs.readFileSync(resolvedRef, 'utf8');
      if (content.length > REF_FILE_MAX_CHARS) {
        content = content.substring(0, REF_FILE_MAX_CHARS) + `\n\n[... truncated — full file: ${resolvedRef} (${Math.round(content.length / 1024)}KB)]`;
      }
      embeddedFiles.push({ path: resolvedRef.replace('/opt/AIWH/core/', ''), content });
    } catch (e) {
      embeddedFiles.push({ path: resolvedRef.replace('/opt/AIWH/core/', ''), content: `(could not read: ${e.code})` });
    }
  }

  const refSection = embeddedFiles.length > 0
    ? '## Reference Files\nThese files were loaded for you (your sandbox prevents reading them directly).\n\n' +
      embeddedFiles.map(f =>
        `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``
      ).join('\n\n')
    : '';

  const aliasMap = buildAgentAliasMap();
  const message = [
    `# TASK #${task.id}: ${task.title}`,
    '',
    '## Before You Start',
    '1. Read your SOUL.md in your workspace (you have access to this)',
    aliasMap ? `\n${aliasMap}` : '',
    '',
    '## Task Description',
    task.description || '(no description)',
    '',
    task.brief ? `## Detailed Brief\n${task.brief}\n` : '',
    task.expected_deliverables ? `## Expected Deliverables\n${task.expected_deliverables}\n` : '',
    refSection,
    '',
    '## Rules',
    '- Work ONLY within your workspace: ' + (agentWorkspace || 'unknown'),
    '- Do NOT create files outside your workspace unless the brief explicitly says to',
    '- Follow existing patterns and conventions in the codebase',
    '- If something is unclear, err on the side of doing less rather than guessing',
    '- Do NOT install new dependencies without explicit instruction',
    '',
    '## When Complete',
    'Summarize: (1) what you did, (2) files created/modified, (3) what was delivered, (4) any concerns or follow-ups.',
  ].filter(Boolean).join('\n');

  // Check if agent is currently busy — queue if so
  const agentStatus = db.prepare("SELECT status FROM agents WHERE id=?").get(task.assigned_agent);
  if (agentStatus?.status === 'active') {
    // Queue the task instead of dispatching immediately
    const q = db.prepare(
      'INSERT INTO task_queue (task_id, agent_id, message, priority) VALUES (?,?,?,?)'
    ).run(task.id, task.assigned_agent, message, task.priority || 0);

    db.prepare("UPDATE tasks SET status='planned', updated_at=datetime('now') WHERE id=?").run(task.id);
    logActivity(task.project_id, task.assigned_agent, 'task_queued', `${task.title} (agent busy)`);
    io.emit('task_updated', { project_id: task.project_id });

    return res.json({ queued: true, queueId: q.lastInsertRowid });
  }

  // Alert if over budget
  const dailySpend = costSync.getDailySpend();
  const dailyBudget = parseFloat(db.prepare("SELECT value FROM settings WHERE key='daily_budget'").get()?.value || '5');
  if (dailySpend >= dailyBudget) {
    sendDiscordAlert(
      `\u{26A0}\u{FE0F} **Over-budget dispatch**: ${task.title}\n` +
      `Agent: \`${task.assigned_agent}\` | Spend: $${dailySpend.toFixed(2)}/$${dailyBudget.toFixed(2)}`
    );
  }

  // Dispatch immediately
  const runResult = dispatchTask(task, message);
  res.json(runResult);
});

// Cancel a queued task
app.post('/api/tasks/:id/cancel-dispatch', (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Not found' });

  // Cancel queue entry
  db.prepare("UPDATE task_queue SET status='cancelled' WHERE task_id=? AND status='queued'").run(task.id);

  // Cancel active run if any
  if (task.dispatch_run_id) {
    const run = db.prepare('SELECT status FROM runs WHERE id=?').get(task.dispatch_run_id);
    if (run?.status === 'running') {
      adapter.cancelRun(task.dispatch_run_id);
      db.prepare("UPDATE runs SET status='cancelled', finished_at=datetime('now') WHERE id=?").run(task.dispatch_run_id);
      db.prepare("UPDATE agents SET status='idle' WHERE id=?").run(task.assigned_agent);
      io.emit('agent_status', { id: task.assigned_agent, status: 'idle' });
    }
  }

  db.prepare("UPDATE tasks SET status='planned', dispatch_run_id=NULL, updated_at=datetime('now') WHERE id=?").run(task.id);
  logActivity(task.project_id, task.assigned_agent, 'dispatch_cancelled', task.title);
  io.emit('task_updated', { project_id: task.project_id });
  res.json({ ok: true });
});

// Get queue status
app.get('/api/task-queue', (req, res) => {
  const items = db.prepare(`
    SELECT q.*, t.title as task_title, t.project_id
    FROM task_queue q
    JOIN tasks t ON q.task_id = t.id
    WHERE q.status IN ('queued','dispatching')
    ORDER BY q.priority DESC, q.created_at ASC
  `).all();
  res.json(items);
});

/**
 * Core dispatch function — creates run, starts agent, wires lifecycle.
 */
function dispatchTask(task, message) {
  // Create run record
  const r = db.prepare(
    'INSERT INTO runs (task_id, project_id, agent_id, command, status) VALUES (?,?,?,?,?)'
  ).run(task.id, task.project_id, task.assigned_agent, message.substring(0, 500), 'running');
  const runId = r.lastInsertRowid;

  // Update task
  db.prepare("UPDATE tasks SET status='in_progress', dispatch_run_id=?, updated_at=datetime('now') WHERE id=?")
    .run(runId, task.id);

  // Update agent status
  db.prepare("UPDATE agents SET status='active', last_task=?, last_active_at=datetime('now') WHERE id=?")
    .run(task.title.substring(0, 100), task.assigned_agent);

  logActivity(task.project_id, task.assigned_agent, 'task_dispatched', task.title);
  io.emit('task_updated', { project_id: task.project_id });
  io.emit('agent_status', { id: task.assigned_agent, status: 'active' });

  // Notify
  notifEngine.createNotification(db, {
    type: 'task_dispatch',
    title: `Task dispatched: ${task.title}`,
    body: `Agent ${task.assigned_agent} started work on task #${task.id}`,
    priority: 'normal',
    agentId: task.assigned_agent,
  });
  io.emit('notifications', { unread: notifEngine.getUnreadCount(db) });

  // Determine timeout based on task type
  const timeouts = { plan: 300, build: 600, ops: 1200 };
  const timeoutSeconds = timeouts[task.type] || 600;

  // Dispatch via gateway chat.send for proper isolated session key,
  // then poll chat.history to detect when the agent finishes.
  const { client: gateway } = require('../gateway-ws');
  const taskSlug = (task.title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 30);
  const taskSessionKey = `agent:${task.assigned_agent}:task-${task.id}-${taskSlug}`;
  const startTime = Date.now();
  let pollTimer = null;
  let finished = false;

  function finishDispatch(success, response, errorMsg) {
    if (finished) return;
    finished = true;
    if (pollTimer) clearInterval(pollTimer);

    const duration = Date.now() - startTime;
    const status = success ? 'completed' : 'failed';

    // Save response to run log
    if (response) {
      db.prepare('UPDATE runs SET log = ? WHERE id=?').run(response, runId);
    }

    db.prepare(
      "UPDATE runs SET status=?, exit_code=?, finished_at=datetime('now'), duration_ms=? WHERE id=?"
    ).run(status, success ? 0 : -1, duration, runId);

    db.prepare("UPDATE agents SET status='idle', last_active_at=datetime('now') WHERE id=?")
      .run(task.assigned_agent);

    const newTaskStatus = success ? (task.auto_complete ? 'done' : 'review') : 'blocked';
    db.prepare("UPDATE tasks SET status=?, dispatch_run_id=NULL, updated_at=datetime('now') WHERE id=?")
      .run(newTaskStatus, task.id);

    notifEngine.createNotification(db, {
      type: success ? 'task_complete' : 'task_failed',
      title: success ? `Task completed: ${task.title}` : `Task FAILED: ${task.title}`,
      body: success
        ? `Agent ${task.assigned_agent} finished in ${(duration / 1000).toFixed(0)}s`
        : `Agent ${task.assigned_agent} failed: ${errorMsg}`,
      priority: success ? 'normal' : 'high',
      agentId: task.assigned_agent,
    });

    if (!success) {
      sendDiscordAlert(
        `\u{1F6A8} **Task FAILED**: ${task.title}\n` +
        `Agent: \`${task.assigned_agent}\` | Error: ${errorMsg}\n` +
        `Task moved to **blocked** — check dashboard for logs.`
      );
    }

    io.emit('run_complete', { runId, taskId: task.id, status, exitCode: success ? 0 : -1, duration });
    io.emit('task_updated', { project_id: task.project_id });
    io.emit('agent_status', { id: task.assigned_agent, status: 'idle' });
    io.emit('notifications', { unread: notifEngine.getUnreadCount(db) });

    logActivity(task.project_id, task.assigned_agent, `task_${status}`,
      `${task.title} (${(duration / 1000).toFixed(0)}s)`);

    processTaskQueue();
  }

  // Send message to isolated session via gateway
  // Run dispatch as async IIFE with proper error handling
  (async function runDispatch() {
    try {
      console.log(`[DISPATCH] Sending task ${task.id} to session ${taskSessionKey}`);
      await gateway.ensureConnected();

      const sendResult = await gateway.request('chat.send', {
        sessionKey: taskSessionKey,
        message,
        deliver: false,
        idempotencyKey: `task-${task.id}-${Date.now()}`,
        attachments: [],
      }, 15000);
      console.log(`[DISPATCH] chat.send OK for task ${task.id}: ${JSON.stringify(sendResult)}`);

      // Get current message count so we only detect NEW assistant messages
      let lastMsgCount = 0;
      try {
        const h = await gateway.request('chat.history', { sessionKey: taskSessionKey, limit: 100 }, 5000);
        lastMsgCount = (h?.messages || []).length;
      } catch {}
      console.log(`[DISPATCH] Initial msg count for task ${task.id}: ${lastMsgCount}`);

      // Poll for completion
      pollTimer = setInterval(async () => {
        if (Date.now() - startTime > timeoutSeconds * 1000) {
          finishDispatch(false, null, `Timeout after ${timeoutSeconds}s`);
          return;
        }
        try {
          const history = await gateway.request('chat.history', { sessionKey: taskSessionKey, limit: 50 }, 5000);
          const msgs = history?.messages || [];
          if (msgs.length <= lastMsgCount) return;

          // Find last assistant message after our user message
          const lastMsg = msgs[msgs.length - 1];
          if (lastMsg?.role === 'assistant') {
            const content = lastMsg.content;
            const text = typeof content === 'string' ? content
              : (Array.isArray(content) ? content.filter(b => b.type === 'text').map(b => b.text).join('') : '');
            console.log(`[DISPATCH] Task ${task.id} completed, response length: ${text.length}`);
            finishDispatch(true, text);
          }
          lastMsgCount = msgs.length;
        } catch (pollErr) {
          console.log(`[DISPATCH] Poll error for task ${task.id}: ${pollErr.message}`);
        }
      }, 3000);

    } catch (err) {
      console.log(`[DISPATCH] FAILED task ${task.id}: ${err.message}`);
      finishDispatch(false, null, err.message);
    }
  })();

  return { runId, dispatched: true };
}

/**
 * Task queue processor — runs in Node.js, ZERO LLM cost.
 * Called after a dispatch completes, or periodically via setInterval.
 */
function processTaskQueue() {
  // Get next queued item (highest priority first, then oldest)
  const next = db.prepare(`
    SELECT q.*, t.project_id, t.title, t.description, t.expected_deliverables,
           t.type, t.priority as task_priority, t.auto_complete
    FROM task_queue q
    JOIN tasks t ON q.task_id = t.id
    WHERE q.status = 'queued'
    ORDER BY q.priority DESC, q.created_at ASC
    LIMIT 1
  `).get();

  if (!next) return;

  // Check if the agent is free
  const agentStatus = db.prepare("SELECT status FROM agents WHERE id=?").get(next.agent_id);
  if (agentStatus?.status === 'active') return; // agent still busy, wait

  // Mark as dispatching
  db.prepare("UPDATE task_queue SET status='dispatching', dispatched_at=datetime('now') WHERE id=?").run(next.id);

  // Build task object for dispatchTask
  const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(next.task_id);
  if (!task) {
    db.prepare("UPDATE task_queue SET status='failed', error='task not found' WHERE id=?").run(next.id);
    return;
  }

  // Dispatch
  try {
    dispatchTask(task, next.message);
    db.prepare("UPDATE task_queue SET status='dispatched' WHERE id=?").run(next.id);
  } catch (e) {
    db.prepare("UPDATE task_queue SET status='failed', error=? WHERE id=?").run(e.message, next.id);
    notifEngine.createNotification(db, {
      type: 'task_failed',
      title: `Queue dispatch failed: ${task.title}`,
      body: e.message,
      priority: 'high',
      agentId: next.agent_id,
    });
    io.emit('notifications', { unread: notifEngine.getUnreadCount(db) });
    sendDiscordAlert(
      `\u{1F6A8} **Queue dispatch failed**: ${task.title}\nAgent: \`${next.agent_id}\` | Error: ${e.message}`
    );
  }
}

// ─── ROUTES: Runs (Execution) ───────────────────────────────
app.get('/api/runs', (req, res) => {
  let sql = 'SELECT * FROM runs';
  const params = [];
  if (req.query.project_id) { sql += ' WHERE project_id=?'; params.push(req.query.project_id); }
  sql += ' ORDER BY started_at DESC LIMIT 50';
  res.json(db.prepare(sql).all(...params));
});

app.post('/api/runs', (req, res) => {
  const { task_id, project_id, agent_id, command } = req.body;
  if (!agent_id || !command) return res.status(400).json({ error: 'agent_id and command required' });

  const r = db.prepare(
    'INSERT INTO runs (task_id, project_id, agent_id, command, status) VALUES (?,?,?,?,?)'
  ).run(task_id || null, project_id || null, agent_id, command, 'running');
  const runId = r.lastInsertRowid;

  // Update agent status
  db.prepare("UPDATE agents SET status='active', last_task=?, last_active_at=datetime('now') WHERE id=?")
    .run(command.substring(0, 100), agent_id);

  logActivity(project_id, agent_id, 'run_started', command.substring(0, 200));
  io.emit('agent_status', { id: agent_id, status: 'active' });

  // Execute via OpenClaw adapter
  const startTime = Date.now();
  adapter.executeAgent(agent_id, command, {
    cwd: req.body.cwd || CORE,
    model: req.body.model,
    onData: (chunk) => {
      // Stream log to connected clients
      io.emit('run_log', { runId, chunk });
      // Append to DB periodically (batch later)
      db.prepare('UPDATE runs SET log = log || ? WHERE id=?').run(chunk, runId);
    },
    onClose: (result) => {
      const duration = Date.now() - startTime;
      const status = result.exitCode === 0 ? 'completed' : (result.killed ? 'cancelled' : 'failed');
      db.prepare(
        "UPDATE runs SET status=?, exit_code=?, finished_at=datetime('now'), duration_ms=? WHERE id=?"
      ).run(status, result.exitCode, duration, runId);

      db.prepare("UPDATE agents SET status='idle', last_active_at=datetime('now') WHERE id=?")
        .run(agent_id);

      logActivity(project_id, agent_id, `run_${status}`, `Exit ${result.exitCode} (${duration}ms)`);
      io.emit('run_complete', { runId, status, exitCode: result.exitCode, duration });
      io.emit('agent_status', { id: agent_id, status: 'idle' });
    }
  });

  res.json({ runId });
});

app.post('/api/runs/:id/cancel', (req, res) => {
  const ok = adapter.cancelRun(parseInt(req.params.id));
  if (ok) {
    db.prepare("UPDATE runs SET status='cancelled', finished_at=datetime('now') WHERE id=?").run(req.params.id);
    res.json({ ok: true });
  } else {
    res.status(404).json({ error: 'Run not found or already finished' });
  }
});

  // Expose processTaskQueue for use by setInterval in server.js
  return { processTaskQueue };

};
