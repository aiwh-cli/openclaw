// ─── Database Foundation ─────────────────────────────────────
// SQLite schema for Mission Control: projects, tasks, agents, runs, schedules, chat, artifacts
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { migrateOwnerFromAuth } = require('./helpers/user-migration');

const DB_PATH = path.join(__dirname, 'mission-control.db');

let db;
function getDb() {
  if (db) return db;
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  // SECURITY: Restrict DB file permissions — contains sessions, passwords, user data
  try { fs.chmodSync(DB_PATH, 0o600); } catch {}
  try { fs.chmodSync(DB_PATH + '-wal', 0o600); } catch {}
  try { fs.chmodSync(DB_PATH + '-shm', 0o600); } catch {}
  initSchema();
  return db;
}

function initSchema() {
  // Migrations for existing databases
  try {
    const projCols = db.pragma('table_info(projects)').map(c => c.name);
    if (!projCols.includes('workspace_paths')) db.exec("ALTER TABLE projects ADD COLUMN workspace_paths TEXT DEFAULT '[]'");
    if (!projCols.includes('linked_agents'))   db.exec("ALTER TABLE projects ADD COLUMN linked_agents TEXT DEFAULT '[]'");
    if (!projCols.includes('status'))          db.exec("ALTER TABLE projects ADD COLUMN status TEXT DEFAULT 'active'");
  } catch {
    // Table doesn't exist yet — will be created below
  }

  // agents migrations: module → command_centre, add source
  try {
    const agentCols = db.pragma('table_info(agents)').map(c => c.name);
    if (agentCols.includes('module') && !agentCols.includes('command_centre')) {
      db.exec("ALTER TABLE agents RENAME COLUMN module TO command_centre");
    }
    if (!agentCols.includes('command_centre')) db.exec("ALTER TABLE agents ADD COLUMN command_centre TEXT DEFAULT ''");
    if (!agentCols.includes('source')) db.exec("ALTER TABLE agents ADD COLUMN source TEXT DEFAULT 'product'");
  } catch {}

  // chat_messages migrations: add agent_id, make project_id nullable
  try {
    const chatCols = db.pragma('table_info(chat_messages)').map(c => c.name);
    if (!chatCols.includes('agent_id')) db.exec("ALTER TABLE chat_messages ADD COLUMN agent_id TEXT DEFAULT 'main'");
  } catch {}

  // tasks migrations: add cron_job_id, source, dispatch_run_id, auto_complete
  try {
    const taskCols = db.pragma('table_info(tasks)').map(c => c.name);
    if (!taskCols.includes('cron_job_id'))     db.exec("ALTER TABLE tasks ADD COLUMN cron_job_id TEXT DEFAULT ''");
    if (!taskCols.includes('source'))          db.exec("ALTER TABLE tasks ADD COLUMN source TEXT DEFAULT 'manual'");
    if (!taskCols.includes('dispatch_run_id')) db.exec("ALTER TABLE tasks ADD COLUMN dispatch_run_id INTEGER DEFAULT NULL");
    if (!taskCols.includes('auto_complete'))   db.exec("ALTER TABLE tasks ADD COLUMN auto_complete INTEGER DEFAULT 0");
    if (!taskCols.includes('brief'))           db.exec("ALTER TABLE tasks ADD COLUMN brief TEXT DEFAULT ''");
    if (!taskCols.includes('reference_files')) db.exec("ALTER TABLE tasks ADD COLUMN reference_files TEXT DEFAULT '[]'");

    // Migrate tasks CHECK constraint to include 'review' status
    // SQLite can't ALTER CHECK, so we rebuild the constraint via a temp table
    const checkInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='tasks'").get();
    if (checkInfo?.sql && !checkInfo.sql.includes("'review'")) {
      db.exec(`
        CREATE TABLE tasks_new AS SELECT * FROM tasks;
        DROP TABLE tasks;
        CREATE TABLE tasks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          description TEXT DEFAULT '',
          type TEXT DEFAULT 'build' CHECK(type IN ('plan','build','ops')),
          status TEXT DEFAULT 'backlog' CHECK(status IN ('backlog','planned','in_progress','blocked','review','done')),
          priority INTEGER DEFAULT 0,
          assigned_agent TEXT DEFAULT '',
          expected_deliverables TEXT DEFAULT '',
          sort_order REAL DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now')),
          cron_job_id TEXT DEFAULT '',
          source TEXT DEFAULT 'manual',
          dispatch_run_id INTEGER DEFAULT NULL,
          auto_complete INTEGER DEFAULT 0
        );
        INSERT INTO tasks SELECT
          id, project_id, title, description, type, status, priority,
          assigned_agent, expected_deliverables, sort_order, created_at, updated_at,
          COALESCE(cron_job_id,''), COALESCE(source,'manual'), dispatch_run_id, COALESCE(auto_complete,0)
        FROM tasks_new;
        DROP TABLE tasks_new;
        CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
        CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      `);
      console.log('  ✅ Migrated tasks table: added review status');
    }
  } catch {}

  // Migration: add user_id to audit_log if missing
  try {
    const auditCols = db.pragma('table_info(audit_log)').map(c => c.name);
    if (!auditCols.includes('user_id')) db.exec("ALTER TABLE audit_log ADD COLUMN user_id TEXT DEFAULT ''");
  } catch {}

  // Migration: add personal_cc_access to users if missing (AB.12.6)
  try {
    const userCols = db.pragma('table_info(users)').map(c => c.name);
    if (!userCols.includes('personal_cc_access')) db.exec("ALTER TABLE users ADD COLUMN personal_cc_access INTEGER DEFAULT 0");
  } catch {}

  // Migration: add protected flag to users for shareholder protection (AC.3)
  try {
    const userCols = db.pragma('table_info(users)').map(c => c.name);
    if (!userCols.includes('protected')) db.exec("ALTER TABLE users ADD COLUMN protected INTEGER DEFAULT 0");
  } catch {}

  // Migration: add user_id to wealth_data for per-user isolation (AB.12.6)
  try {
    const wealthCols = db.pragma('table_info(wealth_data)').map(c => c.name);
    if (!wealthCols.includes('user_id')) {
      db.exec("ALTER TABLE wealth_data ADD COLUMN user_id TEXT DEFAULT 'default'");
      // Migrate existing default row to owner
      const owner = db.prepare("SELECT id FROM users WHERE role = 'owner' LIMIT 1").get();
      if (owner) db.exec(`UPDATE wealth_data SET user_id = '${owner.id}' WHERE id = 'default'`);
    }
  } catch {}

  db.exec(`
    -- Projects: logical containers only (no filesystem creation)
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      workspace_paths TEXT DEFAULT '[]',
      linked_agents TEXT DEFAULT '[]',
      status TEXT DEFAULT 'active' CHECK(status IN ('active','paused','completed','archived')),
      root_dir TEXT DEFAULT '',
      output_dir TEXT DEFAULT '',
      git_ref TEXT DEFAULT '',
      color TEXT DEFAULT '#6366f1',
      icon TEXT DEFAULT '📁',
      archived INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Tasks: structured work units (Kanban)
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      type TEXT DEFAULT 'build' CHECK(type IN ('plan','build','ops')),
      status TEXT DEFAULT 'backlog' CHECK(status IN ('backlog','planned','in_progress','blocked','review','done')),
      priority INTEGER DEFAULT 0,
      assigned_agent TEXT DEFAULT '',
      expected_deliverables TEXT DEFAULT '',
      sort_order REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      cron_job_id TEXT DEFAULT '',
      source TEXT DEFAULT 'manual',
      dispatch_run_id INTEGER DEFAULT NULL,
      auto_complete INTEGER DEFAULT 0,
      brief TEXT DEFAULT '',
      reference_files TEXT DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

    -- Agents: discovered from openclaw.json
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      model TEXT DEFAULT '',
      model_tier TEXT DEFAULT 'haiku',
      workspace TEXT DEFAULT '',
      command_centre TEXT DEFAULT '',
      source TEXT DEFAULT 'product',
      status TEXT DEFAULT 'idle',
      last_task TEXT DEFAULT '',
      last_active_at TEXT,
      cost_today REAL DEFAULT 0,
      cost_month REAL DEFAULT 0,
      avatar_url TEXT DEFAULT '',
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Agent-project assignments
    CREATE TABLE IF NOT EXISTS project_agents (
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      PRIMARY KEY (project_id, agent_id)
    );

    -- Task runs: execution history with logs
    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
      project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
      agent_id TEXT DEFAULT '',
      command TEXT DEFAULT '',
      status TEXT DEFAULT 'running' CHECK(status IN ('running','completed','failed','cancelled')),
      exit_code INTEGER,
      log TEXT DEFAULT '',
      started_at TEXT DEFAULT (datetime('now')),
      finished_at TEXT,
      duration_ms INTEGER DEFAULT 0,
      cost REAL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_runs_task ON runs(task_id);
    CREATE INDEX IF NOT EXISTS idx_runs_project ON runs(project_id);

    -- Scheduled jobs (cron)
    CREATE TABLE IF NOT EXISTS schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      cron_expr TEXT NOT NULL,
      timezone TEXT DEFAULT 'Australia/Brisbane',
      agent_id TEXT DEFAULT '',
      command TEXT DEFAULT '',
      enabled INTEGER DEFAULT 1,
      last_run_at TEXT,
      last_run_status TEXT,
      next_run_at TEXT,
      prevent_overlap INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Schedule run history
    CREATE TABLE IF NOT EXISTS schedule_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      schedule_id INTEGER NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
      status TEXT DEFAULT 'running',
      log TEXT DEFAULT '',
      started_at TEXT DEFAULT (datetime('now')),
      finished_at TEXT,
      duration_ms INTEGER DEFAULT 0
    );

    -- Chat messages (per-project)
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      agent_id TEXT DEFAULT 'main',
      session_id TEXT DEFAULT 'default',
      role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
      content TEXT NOT NULL,
      model TEXT DEFAULT '',
      cost REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_chat_project ON chat_messages(project_id, session_id);

    -- Artifacts: files linked to tasks/projects
    CREATE TABLE IF NOT EXISTS artifacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
      file_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_size INTEGER DEFAULT 0,
      mime_type TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Cost tracking: daily by agent and model tier
    CREATE TABLE IF NOT EXISTS cost_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      agent_id TEXT DEFAULT '',
      model_tier TEXT DEFAULT 'haiku',
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      cost REAL DEFAULT 0,
      project_id INTEGER,
      task_id INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_cost_date ON cost_entries(date);
    CREATE INDEX IF NOT EXISTS idx_cost_agent ON cost_entries(agent_id, date);

    -- Activity feed
    CREATE TABLE IF NOT EXISTS activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER,
      agent_id TEXT DEFAULT '',
      action TEXT NOT NULL,
      detail TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_activity_time ON activity(created_at DESC);

    -- Settings KV store
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT DEFAULT ''
    );

    -- Notifications table
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL DEFAULT 'info',
      title TEXT NOT NULL,
      body TEXT DEFAULT '',
      priority TEXT DEFAULT 'normal' CHECK(priority IN ('low','normal','high','critical')),
      agent_id TEXT DEFAULT '',
      action_url TEXT DEFAULT '',
      read_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_notif_read ON notifications(read_at);

    -- Subscriptions: external services with monthly costs
    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      cost REAL DEFAULT 0,
      cycle TEXT DEFAULT 'monthly',
      renewal_day INTEGER DEFAULT 1,
      active INTEGER DEFAULT 1,
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Cost breakdown: per-agent per-model per-day (supplemental to cost_entries)
    CREATE TABLE IF NOT EXISTS cost_breakdown (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      model TEXT DEFAULT '',
      model_tier TEXT DEFAULT 'haiku',
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      cost REAL DEFAULT 0,
      source TEXT DEFAULT 'session',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_breakdown_date_agent ON cost_breakdown(date, agent_id);

    -- Task dispatch queue: zero-cost Node.js polling (no LLM calls)
    CREATE TABLE IF NOT EXISTS task_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL,
      message TEXT NOT NULL,
      priority INTEGER DEFAULT 0,
      status TEXT DEFAULT 'queued' CHECK(status IN ('queued','dispatching','dispatched','failed','cancelled')),
      created_at TEXT DEFAULT (datetime('now')),
      dispatched_at TEXT,
      error TEXT DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_queue_status ON task_queue(status);

    -- Wealth Command Centre: persistent storage (survives browser data clear)
    CREATE TABLE IF NOT EXISTS wealth_data (
      id TEXT PRIMARY KEY DEFAULT 'default',
      data TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Team invites: local cache of Tailscale device share invites
    CREATE TABLE IF NOT EXISTS team_invites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','accepted','revoked')),
      invited_at TEXT DEFAULT (datetime('now')),
      accepted_at TEXT,
      revoked_at TEXT,
      tailscale_invite_id TEXT DEFAULT ''
    );

    -- Audit log: full transparency for every dashboard action (Theme AB.2)
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      target TEXT DEFAULT '',
      detail TEXT DEFAULT '{}',
      result TEXT NOT NULL DEFAULT 'success',
      ip_address TEXT DEFAULT '',
      user_id TEXT DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);
    CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor);
    CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);

    -- Users: multi-user RBAC (Theme AB.10)
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'team' CHECK(role IN ('owner','admin','team')),
      departments TEXT DEFAULT '[]',
      command_centres TEXT DEFAULT '[]',
      password_hash TEXT,
      password_salt TEXT,
      status TEXT DEFAULT 'active' CHECK(status IN ('active','suspended','pending')),
      must_change_password INTEGER DEFAULT 0,
      personal_cc_access INTEGER DEFAULT 0,
      life_cc_pin TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

    -- RBAC audit: auth-specific events (Theme AB.12)
    CREATE TABLE IF NOT EXISTS rbac_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      user_id TEXT DEFAULT '',
      email TEXT DEFAULT '',
      event TEXT NOT NULL,
      detail TEXT DEFAULT '{}',
      ip_address TEXT DEFAULT '',
      success INTEGER DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_rbac_audit_timestamp ON rbac_audit(timestamp);
    CREATE INDEX IF NOT EXISTS idx_rbac_audit_user ON rbac_audit(user_id);
    CREATE INDEX IF NOT EXISTS idx_rbac_audit_event ON rbac_audit(event);

    -- Insert default settings if empty
    INSERT OR IGNORE INTO settings (key, value) VALUES ('daily_budget', '5.00');
    INSERT OR IGNORE INTO settings (key, value) VALUES ('monthly_budget', '100.00');
    INSERT OR IGNORE INTO settings (key, value) VALUES ('theme', 'dark');
    INSERT OR IGNORE INTO settings (key, value) VALUES ('view_logs_enabled', 'true');
    INSERT OR IGNORE INTO settings (key, value) VALUES ('view_debug_enabled', 'true');
    INSERT OR IGNORE INTO settings (key, value) VALUES ('view_knowledge_enabled', 'false');

    -- Insert default project if none exist
    INSERT OR IGNORE INTO projects (slug, name, description, root_dir, icon, color)
    SELECT 'aiwh', 'AI Wealth Hub', 'Main AIWH project', '/opt/AIWH/core', '🤖', '#6366f1'
    WHERE NOT EXISTS (SELECT 1 FROM projects);
  `);

  // Auto-create owner account from existing auth.json if no users exist yet (AB.10 migration)
  migrateOwnerFromAuth(db);
}

module.exports = { getDb, DB_PATH };
