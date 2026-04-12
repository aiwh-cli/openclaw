// ─── Script Scheduler ────────────────────────────────────────
// Runs shell scripts on cron schedules — zero LLM cost.
// Managed by the dashboard server, independent of OpenClaw.

const cron = require('node-cron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const { buildScriptEnv } = require('./helpers/secret-loader');
let _db = null;
const _tasks = new Map(); // id → cron task instance

// Detect correct interpreter from file extension or shebang
function _detectInterpreter(scriptPath) {
  const ext = path.extname(scriptPath).toLowerCase();
  if (ext === '.py') return 'python3';
  if (ext === '.js') return 'node';
  try {
    const fd = fs.openSync(scriptPath, 'r');
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    // Mach-O magic: 0xFEEDFACF (64-bit) or 0xFEEDFACE (32-bit)
    // shc-compiled binaries are Mach-O — run directly, not via bash
    if (buf[0] === 0xCF && buf[1] === 0xFA && buf[2] === 0xED && buf[3] === 0xFE) return null;
    if (buf[0] === 0xCE && buf[1] === 0xFA && buf[2] === 0xED && buf[3] === 0xFE) return null;
    // Re-read first line for shebang detection
    const fd2 = fs.openSync(scriptPath, 'r');
    const shebangBuf = Buffer.alloc(128);
    fs.readSync(fd2, shebangBuf, 0, 128, 0);
    fs.closeSync(fd2);
    const firstLine = shebangBuf.toString('utf8').split('\n')[0];
    if (firstLine.startsWith('#!')) {
      if (firstLine.includes('python')) return 'python3';
      if (firstLine.includes('node')) return 'node';
    }
  } catch {}
  return 'bash';
}

function init(db) {
  _db = db;

  // Create table if not exists
  _db.exec(`
    CREATE TABLE IF NOT EXISTS script_crons (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      description TEXT DEFAULT '',
      script_path TEXT NOT NULL,
      cron_expr   TEXT NOT NULL,
      timezone    TEXT DEFAULT 'Australia/Brisbane',
      enabled     INTEGER DEFAULT 1,
      created_at  TEXT DEFAULT (datetime('now')),
      updated_at  TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS script_cron_runs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      cron_id     TEXT NOT NULL,
      started_at  TEXT NOT NULL,
      finished_at TEXT,
      exit_code   INTEGER,
      duration_ms INTEGER,
      output      TEXT DEFAULT '',
      status      TEXT DEFAULT 'running',
      FOREIGN KEY (cron_id) REFERENCES script_crons(id) ON DELETE CASCADE
    );
  `);

  // Add timeout column if missing (safe migration)
  try { _db.exec(`ALTER TABLE script_crons ADD COLUMN timeout_ms INTEGER DEFAULT 1800000`); } catch {}

  // Schedule all enabled crons
  const jobs = _db.prepare('SELECT * FROM script_crons WHERE enabled = 1').all();
  for (const job of jobs) {
    _scheduleJob(job);
  }
  console.log(`  ✅ Script scheduler: ${jobs.length} jobs scheduled`);
}

function _scheduleJob(job) {
  // Stop existing task if any
  if (_tasks.has(job.id)) {
    _tasks.get(job.id).stop();
    _tasks.delete(job.id);
  }

  if (!cron.validate(job.cron_expr)) {
    console.error(`  ⚠️  Invalid cron expr for ${job.name}: ${job.cron_expr}`);
    return;
  }

  const task = cron.schedule(job.cron_expr, () => {
    _runJob(job);
  }, {
    timezone: job.timezone || 'Australia/Brisbane',
    scheduled: true,
  });

  _tasks.set(job.id, task);
}

function _runJob(job) {
  // Phase 72: resolve client/scripts/ override before running
  const resolvedPath = _resolveScriptPath(job.script_path);
  try { _validateScriptPath(resolvedPath); } catch { return; }
  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  // Insert run record
  const run = _db.prepare(
    'INSERT INTO script_cron_runs (cron_id, started_at, status) VALUES (?, ?, ?)'
  ).run(job.id, startedAt, 'running');
  const runId = run.lastInsertRowid;

  const env = buildScriptEnv();
  const interpreter = _detectInterpreter(resolvedPath);
  const timeoutMs = job.timeout_ms || 1800000; // per-job or 30 min default
  // null interpreter = compiled binary (Mach-O), run directly
  const proc = interpreter
    ? spawn(interpreter, [resolvedPath], { env, timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe'] })
    : spawn(resolvedPath, [], { env, timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe'] });

  let output = '';

  proc.stdout.on('data', (d) => { output += d.toString(); });
  proc.stderr.on('data', (d) => { output += d.toString(); });

  proc.on('close', (code) => {
    const durationMs = Date.now() - startMs;
    const finishedAt = new Date().toISOString();
    const status = code === 0 ? 'ok' : 'error';

    // Trim output to 10KB max
    const trimmed = output.length > 10240 ? output.slice(-10240) : output;

    _db.prepare(`
      UPDATE script_cron_runs
      SET finished_at = ?, exit_code = ?, duration_ms = ?, output = ?, status = ?
      WHERE id = ?
    `).run(finishedAt, code, durationMs, trimmed, status, runId);

    // Update last run info on the cron itself
    _db.prepare(`
      UPDATE script_crons SET updated_at = datetime('now') WHERE id = ?
    `).run(job.id);

    // Prune old runs (keep last 50 per job)
    _db.prepare(`
      DELETE FROM script_cron_runs
      WHERE cron_id = ? AND id NOT IN (
        SELECT id FROM script_cron_runs WHERE cron_id = ? ORDER BY id DESC LIMIT 50
      )
    `).run(job.id, job.id);
  });

  proc.on('error', (err) => {
    const durationMs = Date.now() - startMs;
    _db.prepare(`
      UPDATE script_cron_runs
      SET finished_at = ?, exit_code = -1, duration_ms = ?, output = ?, status = 'error'
      WHERE id = ?
    `).run(new Date().toISOString(), durationMs, err.message, runId);
  });
}

// ─── CRUD ────────────────────────────────────────────────────

function generateId() {
  return 'sc_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function list() {
  const jobs = _db.prepare('SELECT * FROM script_crons ORDER BY name').all();

  // Attach last run info
  return jobs.map(job => {
    const lastRun = _db.prepare(
      'SELECT * FROM script_cron_runs WHERE cron_id = ? ORDER BY id DESC LIMIT 1'
    ).get(job.id);
    const normName = (job.name || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
    return { ...job, lastRun: lastRun || null, protected: PROTECTED_CRONS.has(normName) };
  });
}

const CLIENT_SCRIPTS = (process.env.CLIENT_ROOT || '/opt/AIWH/client') + '/scripts';
const ALLOWED_SCRIPT_DIRS = ['/opt/AIWH/core/scripts/', CLIENT_SCRIPTS + '/'];

// Phase 72: resolve client override → core fallback
function _resolveScriptPath(scriptPath) {
  const basename = path.basename(scriptPath);
  const clientVersion = path.join(CLIENT_SCRIPTS, basename);
  if (fs.existsSync(clientVersion)) return clientVersion;
  return scriptPath;
}

function _validateScriptPath(scriptPath) {
  const resolved = path.resolve(scriptPath);
  if (!ALLOWED_SCRIPT_DIRS.some(dir => resolved.startsWith(dir))) {
    throw new Error('Script path must be under /opt/AIWH/core/scripts/ or client/scripts/');
  }
  return resolved;
}

function create({ name, description, script_path, cron_expr, timezone }) {
  if (!name || !script_path || !cron_expr) {
    throw new Error('name, script_path, and cron_expr are required');
  }
  const resolvedPath = _validateScriptPath(script_path);
  if (!cron.validate(cron_expr)) {
    throw new Error(`Invalid cron expression: ${cron_expr}`);
  }
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Script not found: ${resolvedPath}`);
  }

  const id = generateId();
  _db.prepare(`
    INSERT INTO script_crons (id, name, description, script_path, cron_expr, timezone)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, name, description || '', script_path, cron_expr, timezone || 'Australia/Brisbane');

  const job = _db.prepare('SELECT * FROM script_crons WHERE id = ?').get(id);
  _scheduleJob(job);
  return job;
}

function update(id, fields) {
  const job = _db.prepare('SELECT * FROM script_crons WHERE id = ?').get(id);
  if (!job) throw new Error('Script cron not found');

  const allowed = ['name', 'description', 'script_path', 'cron_expr', 'timezone', 'enabled', 'timeout_ms'];
  const sets = [];
  const vals = [];

  for (const [k, v] of Object.entries(fields)) {
    if (allowed.includes(k) && v !== undefined) {
      sets.push(`${k} = ?`);
      vals.push(v);
    }
  }

  if (sets.length === 0) throw new Error('No valid fields to update');

  if (fields.cron_expr && !cron.validate(fields.cron_expr)) {
    throw new Error(`Invalid cron expression: ${fields.cron_expr}`);
  }
  if (fields.script_path) {
    const resolvedPath = _validateScriptPath(fields.script_path);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Script not found: ${resolvedPath}`);
    }
  }

  sets.push("updated_at = datetime('now')");
  vals.push(id);

  _db.prepare(`UPDATE script_crons SET ${sets.join(', ')} WHERE id = ?`).run(...vals);

  const updated = _db.prepare('SELECT * FROM script_crons WHERE id = ?').get(id);

  // Reschedule or stop
  if (updated.enabled) {
    _scheduleJob(updated);
  } else if (_tasks.has(id)) {
    _tasks.get(id).stop();
    _tasks.delete(id);
  }

  return updated;
}

// System crons that cannot be deleted (product-managed)
const PROTECTED_CRONS = new Set([
  'license-heartbeat', 'backup-snapshot', 'system-backup',
  'log-rotate', 'log-rotation', 'update-check',
]);

function remove(id) {
  const job = _db.prepare('SELECT * FROM script_crons WHERE id = ?').get(id);
  if (!job) throw new Error('Script cron not found');

  // Block deletion of system-essential crons
  const normName = (job.name || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (PROTECTED_CRONS.has(normName)) {
    throw new Error('This is a system cron and cannot be deleted. You can disable it instead.');
  }

  if (_tasks.has(id)) {
    _tasks.get(id).stop();
    _tasks.delete(id);
  }

  _db.prepare('DELETE FROM script_cron_runs WHERE cron_id = ?').run(id);
  _db.prepare('DELETE FROM script_crons WHERE id = ?').run(id);
  return { ok: true };
}

function trigger(id) {
  const job = _db.prepare('SELECT * FROM script_crons WHERE id = ?').get(id);
  if (!job) throw new Error('Script cron not found');
  _runJob(job);
  return { ok: true };
}

function getRuns(id, limit = 15) {
  const runs = _db.prepare(
    'SELECT * FROM script_cron_runs WHERE cron_id = ? ORDER BY id DESC LIMIT ?'
  ).all(id, limit);
  return runs;
}

module.exports = { init, list, create, update, remove, trigger, getRuns };
