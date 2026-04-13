#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// db-init.js — Initialize all AIWH client databases with correct schemas
//
// Usage:
//   node core/scripts/db-init.js           # Initialize all DBs
//   node core/scripts/db-init.js --check   # Check schemas without modifying
//
// Called by: server.js on startup, setup.sh on install, update-aiwh.sh on update
// ─────────────────────────────────────────────────────────────────────────────

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const paths = require('./lib/paths');

const CHECK_ONLY = process.argv.includes('--check');
const log = (msg) => console.log(`  ${msg}`);

// Ensure directories exist
function ensureDirs() {
  for (const dir of [paths.CLIENT_DATA, paths.UPLOAD_DIR, paths.CLIENT_LOGS, paths.MIGRATIONS_DIR]) {
    if (!fs.existsSync(dir)) {
      if (CHECK_ONLY) { log(`✗ Missing: ${dir}`); continue; }
      fs.mkdirSync(dir, { recursive: true });
      log(`✓ Created: ${dir}`);
    }
  }
}

// Initialize a single DB with schema
function initDb(dbPath, label, schemaFn) {
  const exists = fs.existsSync(dbPath);
  if (CHECK_ONLY) {
    log(exists ? `✓ ${label}: ${dbPath}` : `✗ ${label}: MISSING — ${dbPath}`);
    return;
  }
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  schemaFn(db);
  db.close();
  log(`✓ ${label}${exists ? '' : ' (created)'}`);
}

// ── Client Knowledge DB ────────────────────────────────────────────────────
function clientKnowledgeSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS client_knowledge (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      category TEXT,
      knowledge_type TEXT,
      version INTEGER DEFAULT 1,
      embedding TEXT,
      embedding_model TEXT,
      target_agents TEXT DEFAULT '["all"]',
      status TEXT DEFAULT 'draft',
      source TEXT,
      expires_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      is_archived INTEGER DEFAULT 0,
      content_hash TEXT UNIQUE,
      reference TEXT
    );
  `);
}

// ── Video Jobs DB ──────────────────────────────────────────────────────────
function videoJobsSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS video_jobs (
      job_id TEXT PRIMARY KEY,
      topic TEXT NOT NULL,
      pillar TEXT,
      hook TEXT, script TEXT, final_transcript TEXT,
      voice_audio_path TEXT, avatar_video_path TEXT, captioned_video_path TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      platform_targets TEXT, scheduled_time TEXT, heygen_video_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      voice_gdrive_url TEXT, video_gdrive_url TEXT, caption TEXT, video_r2_url TEXT,
      priority TEXT DEFAULT 'normal',
      scheduled_for_date TEXT, source TEXT DEFAULT 'calendar',
      avatar_look_id TEXT, grade INTEGER, grade_notes TEXT,
      failure_reason TEXT, retry_count INTEGER DEFAULT 0, last_failed_stage TEXT,
      content_type TEXT DEFAULT 'video_reel',
      captions TEXT,
      image_path TEXT,
      image_paths TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_vj_status ON video_jobs(status);
    CREATE INDEX IF NOT EXISTS idx_vj_created ON video_jobs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_vj_content_type ON video_jobs(content_type);

    CREATE TABLE IF NOT EXISTS cinematic_jobs (
      cjob_id TEXT PRIMARY KEY,
      video_job_id TEXT, title TEXT NOT NULL, brief TEXT NOT NULL,
      style_bible TEXT, production_plan TEXT, narration_script TEXT,
      bgm_path TEXT, target_duration_sec INTEGER DEFAULT 120,
      clip_count INTEGER DEFAULT 10,
      phase TEXT NOT NULL DEFAULT 'brief',
      auto_approve_refs INTEGER DEFAULT 0,
      auto_approve_keyframes INTEGER DEFAULT 0,
      auto_approve_clips INTEGER DEFAULT 0,
      autonomy_threshold REAL DEFAULT 4.0,
      analysis_grade INTEGER, analysis_notes TEXT,
      final_grade INTEGER, final_notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT, total_cost_usd REAL DEFAULT 0.0,
      total_credits INTEGER DEFAULT 0, error_message TEXT,
      avatar_look_id TEXT, voice_id TEXT,
      output_format TEXT DEFAULT '16:9',
      no_avatar INTEGER DEFAULT 0, captions_enabled INTEGER DEFAULT 0,
      caption_position TEXT DEFAULT 'bottom',
      caption_style TEXT DEFAULT 'clean',
      bgm_volume REAL DEFAULT 0.3, caption TEXT DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_cj_phase ON cinematic_jobs(phase);

    CREATE TABLE IF NOT EXISTS cinematic_assets (
      asset_id TEXT PRIMARY KEY,
      cjob_id TEXT NOT NULL REFERENCES cinematic_jobs(cjob_id),
      asset_type TEXT NOT NULL,
      clip_index INTEGER NOT NULL DEFAULT -1,
      sequence INTEGER NOT NULL DEFAULT 0,
      prompt TEXT NOT NULL,
      reference_asset_ids TEXT, generation_params TEXT,
      file_path TEXT, file_url TEXT, runway_task_id TEXT,
      status TEXT NOT NULL DEFAULT 'generating',
      grade INTEGER, grade_notes TEXT,
      generation_version INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      reviewed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_ca_cjob ON cinematic_assets(cjob_id, asset_type);

    CREATE TABLE IF NOT EXISTS style_grades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cjob_id TEXT NOT NULL, asset_id TEXT NOT NULL,
      asset_type TEXT NOT NULL, grade INTEGER NOT NULL,
      style_tags TEXT, color_palette TEXT,
      composition_type TEXT, motion_type TEXT, mood TEXT,
      prompt_used TEXT NOT NULL,
      review_source TEXT DEFAULT 'human',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS style_profile (
      dimension TEXT PRIMARY KEY,
      avg_grade REAL NOT NULL, sample_count INTEGER NOT NULL,
      confidence REAL NOT NULL, preference TEXT NOT NULL,
      last_updated TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS social_grades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      content_type TEXT NOT NULL,
      platform TEXT,
      grade INTEGER NOT NULL,
      caption_quality TEXT,
      visual_quality TEXT,
      engagement_result TEXT,
      feedback TEXT,
      review_source TEXT DEFAULT 'human',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sg_job ON social_grades(job_id);
    CREATE INDEX IF NOT EXISTS idx_sg_type ON social_grades(content_type);

    CREATE TABLE IF NOT EXISTS metadata (
      type TEXT PRIMARY KEY,
      checksum TEXT,
      last_sync DATETIME
    );
  `);
}

// ── Schema Version Tracking ────────────────────────────────────────────────
function ensureSchemaVersion(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _schema_version (
      db_name TEXT NOT NULL,
      version INTEGER NOT NULL,
      applied_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (db_name, version)
    );
  `);
}

// ── Run Pending Migrations ─────────────────────────────────────────────────
function runMigrations(dbPath, dbName) {
  if (!fs.existsSync(paths.MIGRATIONS_DIR)) return;
  const files = fs.readdirSync(paths.MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql') && f.startsWith(dbName))
    .sort();
  if (files.length === 0) return;

  const db = new Database(dbPath);
  ensureSchemaVersion(db);
  for (const file of files) {
    const version = parseInt(file.split('-')[1] || '0', 10);
    const applied = db.prepare('SELECT 1 FROM _schema_version WHERE db_name = ? AND version = ?').get(dbName, version);
    if (applied) continue;
    if (CHECK_ONLY) { log(`⏭ Migration pending: ${file}`); continue; }
    const sql = fs.readFileSync(path.join(paths.MIGRATIONS_DIR, file), 'utf8');
    db.exec(sql);
    db.prepare('INSERT INTO _schema_version (db_name, version) VALUES (?, ?)').run(dbName, version);
    log(`✓ Migration: ${file}`);
  }
  db.close();
}

// ── Main ───────────────────────────────────────────────────────────────────
function main() {
  console.log(CHECK_ONLY ? 'Checking AIWH databases...' : 'Initializing AIWH databases...');
  ensureDirs();
  initDb(paths.KNOWLEDGE_DB, 'client_knowledge', clientKnowledgeSchema);
  initDb(paths.VIDEO_DB, 'video-jobs', videoJobsSchema);
  runMigrations(paths.KNOWLEDGE_DB, 'knowledge');
  runMigrations(paths.VIDEO_DB, 'video-jobs');
  console.log(CHECK_ONLY ? 'Check complete.' : 'All databases initialized.');
}

main();
