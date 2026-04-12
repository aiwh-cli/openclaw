// ─── Workflow Engine ──────────────────────────────────────────
// Theme AA — Durable multi-step workflow orchestration.
// Stores workflow state in mission-control.db. Triggers agent steps
// via `openclaw agent` CLI. Polls for completion and advances steps.
//
// Architecture: Dashboard owns orchestration state (our IP).
// OpenClaw owns agent execution. Clean separation.

const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const crypto = require('crypto');

const OPENCLAW_BIN = '/opt/homebrew/bin/openclaw';
const OC_ENV = {
  ...process.env,
  OPENCLAW_STATE_DIR: '/opt/AIWH/.openclaw',
  PATH: `/opt/homebrew/bin:/opt/homebrew/sbin:${process.env.PATH || '/usr/bin:/bin'}`,
};
const POLL_INTERVAL_MS = 5000;
const STEP_TIMEOUT_MS = 10 * 60 * 1000; // 10 min per step

// ─── Schema Migration ──────────────────────────────────────────

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY, template_id TEXT NOT NULL, name TEXT NOT NULL,
      status TEXT DEFAULT 'queued' CHECK(status IN ('queued','running','succeeded','failed','cancelled','blocked')),
      current_step TEXT DEFAULT '', state_json TEXT DEFAULT '{}', trigger_cron_id TEXT DEFAULT '',
      notification_category TEXT DEFAULT 'general', error TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')), ended_at TEXT);
    CREATE INDEX IF NOT EXISTS idx_wf_status ON workflows(status);
    CREATE INDEX IF NOT EXISTS idx_wf_template ON workflows(template_id);
    CREATE TABLE IF NOT EXISTS workflow_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
      step_id TEXT NOT NULL, name TEXT NOT NULL, agent TEXT NOT NULL, tier TEXT DEFAULT 'fast',
      message TEXT NOT NULL, depends_on TEXT DEFAULT '[]',
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','running','succeeded','failed','skipped','cancelled')),
      run_id TEXT DEFAULT '', session_key TEXT DEFAULT '', output_summary TEXT DEFAULT '', error TEXT DEFAULT '',
      started_at TEXT, ended_at TEXT, duration_ms INTEGER DEFAULT 0, UNIQUE(workflow_id, step_id));
    CREATE INDEX IF NOT EXISTS idx_wfs_workflow ON workflow_steps(workflow_id);
    CREATE INDEX IF NOT EXISTS idx_wfs_status ON workflow_steps(status);
    CREATE TABLE IF NOT EXISTS workflow_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
      status TEXT DEFAULT 'running' CHECK(status IN ('running','succeeded','failed','cancelled')),
      started_at TEXT DEFAULT (datetime('now')), ended_at TEXT, duration_ms INTEGER DEFAULT 0,
      steps_total INTEGER DEFAULT 0, steps_completed INTEGER DEFAULT 0, steps_failed INTEGER DEFAULT 0, error TEXT DEFAULT '');
    CREATE INDEX IF NOT EXISTS idx_wr_workflow ON workflow_runs(workflow_id);
  `);
}

// ─── Template Loading ──────────────────────────────────────────

function loadWorkflowTemplates() {
  const P = require('./paths');
  return P.getCatalogues().workflowTemplates;
}
// ─── Workflow CRUD ─────────────────────────────────────────────

function createWorkflow(db, templateId) {
  const { workflows } = loadWorkflowTemplates();
  const tpl = workflows.find(w => w.id === templateId);
  if (!tpl) throw new Error(`Workflow template not found: ${templateId}`);

  const workflowId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO workflows (id, template_id, name, status, notification_category)
    VALUES (?, ?, ?, 'queued', ?)
  `).run(workflowId, tpl.id, tpl.name, tpl.notificationCategory || 'general');

  // Create step records
  const insertStep = db.prepare(`
    INSERT INTO workflow_steps (workflow_id, step_id, name, agent, tier, message, depends_on)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const step of tpl.steps) {
    insertStep.run(
      workflowId, step.id, step.name, step.agent,
      step.tier || 'fast', step.message, JSON.stringify(step.dependsOn || [])
    );
  }

  return { workflowId, template: tpl };
}

function getWorkflow(db, workflowId) {
  const wf = db.prepare('SELECT * FROM workflows WHERE id = ?').get(workflowId);
  if (!wf) return null;
  wf.steps = db.prepare('SELECT * FROM workflow_steps WHERE workflow_id = ? ORDER BY id').all(workflowId);
  wf.stateJson = JSON.parse(wf.state_json || '{}');
  return wf;
}

function listWorkflows(db, opts = {}) {
  let sql = 'SELECT * FROM workflows';
  const params = [];
  if (opts.status) { sql += ' WHERE status = ?'; params.push(opts.status); }
  sql += ' ORDER BY created_at DESC';
  if (opts.limit) { sql += ' LIMIT ?'; params.push(opts.limit); }
  return db.prepare(sql).all(...params);
}

function cancelWorkflow(db, workflowId) {
  const wf = getWorkflow(db, workflowId);
  if (!wf) throw new Error('Workflow not found');
  if (['succeeded', 'cancelled'].includes(wf.status)) {
    throw new Error(`Cannot cancel workflow in ${wf.status} state`);
  }
  // Cancel running steps
  db.prepare(`
    UPDATE workflow_steps SET status = 'cancelled', ended_at = datetime('now')
    WHERE workflow_id = ? AND status IN ('pending', 'running')
  `).run(workflowId);
  db.prepare(`
    UPDATE workflows SET status = 'cancelled', ended_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `).run(workflowId);
  return getWorkflow(db, workflowId);
}

// ─── Step Execution ────────────────────────────────────────────

function getReadySteps(db, workflowId) {
  const steps = db.prepare(`
    SELECT * FROM workflow_steps WHERE workflow_id = ? AND status = 'pending'
  `).all(workflowId);

  return steps.filter(step => {
    const deps = JSON.parse(step.depends_on || '[]');
    if (!deps.length) return true;
    // All dependencies must be succeeded
    const depStatuses = db.prepare(`
      SELECT step_id, status FROM workflow_steps
      WHERE workflow_id = ? AND step_id IN (${deps.map(() => '?').join(',')})
    `).all(workflowId, ...deps);
    return depStatuses.every(d => d.status === 'succeeded');
  });
}

function resolveStepModel(step) {
  // Use cron-provisioner's tier resolution
  try {
    const { resolveModel, detectDefaultProvider, loadTemplates } = require('./cron-provisioner');
    const { tierMap } = loadTemplates();
    const provider = detectDefaultProvider();
    const resolved = resolveModel({ tier: step.tier, model: null }, tierMap || {}, provider);
    return resolved || null;
  } catch {
    return null;
  }
}

function executeStep(db, workflowId, step) {
  const sessionKey = `agent:${step.agent}:workflow:${workflowId}:${step.step_id}`;
  const model = resolveStepModel(step);

  // Mark step as running
  db.prepare(`
    UPDATE workflow_steps SET status = 'running', session_key = ?, started_at = datetime('now')
    WHERE workflow_id = ? AND step_id = ?
  `).run(sessionKey, workflowId, step.step_id);

  // Update workflow status
  db.prepare(`
    UPDATE workflows SET status = 'running', current_step = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(step.step_id, workflowId);

  // Build context from previous step outputs
  const prevSteps = db.prepare(`
    SELECT step_id, output_summary FROM workflow_steps
    WHERE workflow_id = ? AND status = 'succeeded'
  `).all(workflowId);
  const context = prevSteps.reduce((acc, s) => {
    if (s.output_summary) acc[s.step_id] = s.output_summary;
    return acc;
  }, {});

  // Inject previous step context into message
  let message = step.message;
  if (Object.keys(context).length > 0) {
    const contextBlock = Object.entries(context)
      .map(([id, summary]) => `[Previous step "${id}" output]: ${summary}`)
      .join('\n');
    message = `${contextBlock}\n\n---\n\n${message}`;
  }

  // Launch agent turn in background
  const args = ['agent', '--message', message, '--agent', step.agent, '--json'];
  if (model) args.push('--model', model);
  args.push('--thinking', 'low');
  args.push('--timeout', '600');

  const proc = spawn(OPENCLAW_BIN, args, {
    env: OC_ENV,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });

  let stdout = '';
  let stderr = '';
  proc.stdout.on('data', d => { stdout += d.toString(); });
  proc.stderr.on('data', d => { stderr += d.toString(); });

  proc.on('close', (code) => {
    const endedAt = new Date().toISOString().replace('T', ' ').replace('Z', '');
    const startedRow = db.prepare(`
      SELECT started_at FROM workflow_steps WHERE workflow_id = ? AND step_id = ?
    `).get(workflowId, step.step_id);
    const startMs = startedRow?.started_at ? new Date(startedRow.started_at + 'Z').getTime() : Date.now();
    const durationMs = Date.now() - startMs;

    if (code === 0) {
      // Parse output for summary
      let summary = '';
      try {
        const result = JSON.parse(stdout);
        summary = result.summary || result.result?.payloads?.[0]?.text?.slice(0, 500) || 'Completed';
      } catch {
        summary = stdout.slice(0, 500) || 'Completed';
      }

      // Check for soft failure — agent completed but reported it couldn't do the task
      const lowerSummary = summary.toLowerCase();
      const softFail = /cannot proceed|pipeline is broken|file.*missing|file.*not found|i cannot|failed to|error:|does not exist|doesn't exist/i.test(summary);

      if (softFail) {
        db.prepare(`
          UPDATE workflow_steps
          SET status = 'failed', output_summary = ?, error = ?, ended_at = ?, duration_ms = ?
          WHERE workflow_id = ? AND step_id = ?
        `).run(summary, 'Agent reported failure: ' + summary.slice(0, 200), endedAt, durationMs, workflowId, step.step_id);

        db.prepare(`
          UPDATE workflows SET status = 'blocked', error = ?, updated_at = datetime('now')
          WHERE id = ?
        `).run(`Step "${step.step_id}" soft-failed: ${summary.slice(0, 200)}`, workflowId);
      } else {
        db.prepare(`
          UPDATE workflow_steps
          SET status = 'succeeded', output_summary = ?, ended_at = ?, duration_ms = ?
          WHERE workflow_id = ? AND step_id = ?
        `).run(summary, endedAt, durationMs, workflowId, step.step_id);

        // Advance workflow
        advanceWorkflow(db, workflowId);
      }
    } else {
      const errMsg = stderr.slice(0, 500) || `Exit code ${code}`;
      db.prepare(`
        UPDATE workflow_steps
        SET status = 'failed', error = ?, ended_at = ?, duration_ms = ?
        WHERE workflow_id = ? AND step_id = ?
      `).run(errMsg, endedAt, durationMs, workflowId, step.step_id);

      db.prepare(`
        UPDATE workflows SET status = 'blocked', error = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(`Step "${step.step_id}" failed: ${errMsg}`, workflowId);
    }
  });

  proc.unref();
  return { sessionKey, pid: proc.pid };
}

// ─── Workflow Advancement ──────────────────────────────────────

function advanceWorkflow(db, workflowId) {
  const wf = getWorkflow(db, workflowId);
  if (!wf || ['cancelled', 'succeeded', 'failed'].includes(wf.status)) return;

  // Check if all steps are done
  const allSteps = wf.steps;
  const succeeded = allSteps.filter(s => s.status === 'succeeded').length;
  const failed = allSteps.filter(s => s.status === 'failed').length;
  const running = allSteps.filter(s => s.status === 'running').length;

  if (succeeded === allSteps.length) {
    // All done
    db.prepare(`
      UPDATE workflows SET status = 'succeeded', ended_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `).run(workflowId);
    notifyWorkflowComplete(db, wf);
    return;
  }

  if (failed > 0 && running === 0) {
    // Blocked — a step failed and nothing is running
    db.prepare(`
      UPDATE workflows SET status = 'blocked', updated_at = datetime('now')
      WHERE id = ?
    `).run(workflowId);
    return;
  }

  // Find and start ready steps (supports parallel execution)
  const ready = getReadySteps(db, workflowId);
  for (const step of ready) {
    executeStep(db, workflowId, step);
  }
}

function notifyWorkflowComplete(db, wf) {
  try {
    const { loadNotificationConfig } = require('./cron-provisioner');
    const routing = (loadNotificationConfig())[wf.notification_category || 'general'];
    if (!routing?.channel || !routing?.target) return;
    const durMin = Math.round(wf.steps.reduce((s, st) => s + (st.duration_ms || 0), 0) / 60000);
    execFileSync(OPENCLAW_BIN, ['message', 'send', '--channel', routing.channel, '-t', routing.target,
      '-m', `Workflow "${wf.name}" completed in ${durMin}min (${wf.steps.length} steps)`], { timeout: 10000, env: OC_ENV });
  } catch (e) { console.error('[workflow-engine] notification failed:', e.message); }
}

// ─── Trigger (called by cron or manual) ────────────────────────

function triggerWorkflow(db, templateId) {
  const { workflowId, template } = createWorkflow(db, templateId);

  // Create a run record
  db.prepare(`
    INSERT INTO workflow_runs (workflow_id, steps_total) VALUES (?, ?)
  `).run(workflowId, template.steps.length);

  // Start the workflow
  advanceWorkflow(db, workflowId);

  return { workflowId, name: template.name, steps: template.steps.length };
}

// ─── Retry blocked workflow ────────────────────────────────────

function retryWorkflow(db, workflowId) {
  const wf = getWorkflow(db, workflowId);
  if (!wf) throw new Error('Workflow not found');
  if (wf.status !== 'blocked') throw new Error('Only blocked workflows can be retried');

  // Reset failed steps to pending
  db.prepare(`
    UPDATE workflow_steps SET status = 'pending', error = '', started_at = NULL, ended_at = NULL, duration_ms = 0
    WHERE workflow_id = ? AND status = 'failed'
  `).run(workflowId);

  db.prepare(`
    UPDATE workflows SET status = 'running', error = '', updated_at = datetime('now')
    WHERE id = ?
  `).run(workflowId);

  advanceWorkflow(db, workflowId);
  return getWorkflow(db, workflowId);
}

// ─── Edit step message (client customization via Branson) ──────

function editStep(db, workflowId, stepId, updates) {
  const fields = [];
  const params = [];
  if (updates.message !== undefined) { fields.push('message = ?'); params.push(updates.message); }
  if (updates.agent !== undefined) { fields.push('agent = ?'); params.push(updates.agent); }
  if (updates.tier !== undefined) { fields.push('tier = ?'); params.push(updates.tier); }
  if (!fields.length) return null;
  params.push(workflowId, stepId);
  db.prepare(`UPDATE workflow_steps SET ${fields.join(', ')} WHERE workflow_id = ? AND step_id = ?`).run(...params);
  return db.prepare('SELECT * FROM workflow_steps WHERE workflow_id = ? AND step_id = ?').get(workflowId, stepId);
}

module.exports = {
  ensureSchema,
  loadWorkflowTemplates,
  createWorkflow,
  getWorkflow,
  listWorkflows,
  cancelWorkflow,
  triggerWorkflow,
  retryWorkflow,
  advanceWorkflow,
  editStep,
};
