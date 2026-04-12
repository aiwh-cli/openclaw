// ─── Content Sync ─────────────────────────────────────────────
// Reads the video pipeline DB and returns structured job data for the dashboard.
// This module opens it read-only to avoid conflicts with the pipeline agents.

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const CLIENT_ROOT = process.env.CLIENT_ROOT || '/opt/AIWH/client';
const VIDEO_DB = path.join(CLIENT_ROOT, 'data', 'video-jobs.db');
const TOPICS_CSV = path.join(CLIENT_ROOT, 'data', 'video-topics.csv');
const JOBS_DIR = path.join(CLIENT_ROOT, 'data', 'video-jobs');

// Pipeline statuses in order
const STATUS_ORDER = ['draft', 'planned', 'scripted', 'voice_ready', 'avatar_ready', 'captioned', 'qa_passed', 'qa_failed', 'approved', 'scheduled', 'published', 'failed'];

let _videoDb = null;
let _videoDbTs = 0;
const VIDEO_DB_REFRESH_MS = 10000; // reopen every 10s to see fresh WAL writes
function getVideoDb() {
  // Periodically reopen to ensure we see latest WAL writes from external processes
  if (_videoDb && Date.now() - _videoDbTs > VIDEO_DB_REFRESH_MS) {
    try { _videoDb.close(); } catch {}
    _videoDb = null;
  }
  if (_videoDb) return _videoDb;
  if (!fs.existsSync(VIDEO_DB)) return null;
  try {
    _videoDb = new Database(VIDEO_DB, { readonly: true });
    _videoDbTs = Date.now();
    return _videoDb;
  } catch {
    return null;
  }
}

function getVideoDbWrite() {
  // Open per-call, close after use to avoid blocking cinematic producer
  if (!fs.existsSync(VIDEO_DB)) return null;
  try {
    const db = new Database(VIDEO_DB);
    // Ensure grade columns exist
    try {
      db.exec('ALTER TABLE video_jobs ADD COLUMN grade INTEGER;');
    } catch {} // already exists
    try {
      db.exec('ALTER TABLE video_jobs ADD COLUMN grade_notes TEXT;');
    } catch {} // already exists
    return db;
  } catch {
    return null;
  }
}

/**
 * Get all video jobs, most recent first.
 */
function getJobs(limit = 20, status = null) {
  const db = getVideoDb();
  if (!db) return [];
  try {
    let sql = 'SELECT * FROM video_jobs';
    const params = [];
    if (status) { sql += ' WHERE status = ?'; params.push(status); }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);
    return db.prepare(sql).all(...params);
  } catch { return []; }
}

/**
 * Get pipeline stats: count by status.
 */
function getPipelineStats() {
  const db = getVideoDb();
  if (!db) return { available: false, counts: {} };
  try {
    const rows = db.prepare(
      'SELECT status, COUNT(*) as n FROM video_jobs GROUP BY status'
    ).all();
    const counts = {};
    for (const r of rows) counts[r.status] = r.n;
    return { available: true, counts, total: rows.reduce((s, r) => s + r.n, 0) };
  } catch { return { available: false, counts: {} }; }
}

/**
 * Get today's job (most recently updated job).
 */
function getTodayJob() {
  const db = getVideoDb();
  if (!db) return null;
  try {
    const today = new Date().toISOString().split('T')[0];
    return db.prepare(
      "SELECT * FROM video_jobs WHERE date(created_at) = ? ORDER BY updated_at DESC LIMIT 1"
    ).get(today);
  } catch { return null; }
}

/**
 * Get topic queue count from CSV.
 */
function getTopicsRemaining() {
  if (!fs.existsSync(TOPICS_CSV)) return 0;
  try {
    const lines = fs.readFileSync(TOPICS_CSV, 'utf8').split('\n').filter(l => l.trim() && !l.startsWith('#'));
    return lines.length;
  } catch { return 0; }
}

/**
 * Get file size of a video job's output files.
 */
function getJobFiles(jobId) {
  const jobDir = path.join(JOBS_DIR, jobId);
  if (!fs.existsSync(jobDir)) return [];
  try {
    return fs.readdirSync(jobDir).map(f => {
      const fp = path.join(jobDir, f);
      const stat = fs.statSync(fp);
      return { name: f, size: stat.size, path: fp };
    });
  } catch { return []; }
}

/**
 * Get a summary suitable for the overview widget.
 */
function getContentSummary() {
  const stats = getPipelineStats();
  if (!stats.available) return null;

  const { counts } = stats;
  const inProgress = (counts.scripted || 0) + (counts.voice_ready || 0) + (counts.avatar_ready || 0) + (counts.captioned || 0);
  const queued = counts.draft || 0;
  const done = (counts.qa_passed || 0) + (counts.approved || 0) + (counts.scheduled || 0) + (counts.published || 0);
  const failed = (counts.qa_failed || 0) + (counts.failed || 0);

  return {
    available: true,
    queued,
    inProgress,
    done,
    failed,
    topicsRemaining: getTopicsRemaining(),
    todayJob: getTodayJob(),
  };
}

/**
 * Get a single job by ID.
 */
function getJob(jobId) {
  const db = getVideoDb();
  if (!db) return null;
  try {
    return db.prepare('SELECT * FROM video_jobs WHERE job_id = ?').get(jobId) || null;
  } catch { return null; }
}

/**
 * Update editable fields on a video job.
 * Only allows: script, caption, hook, priority, status
 */
function updateJob(jobId, updates) {
  // Validate jobId format
  if (!/^(job_|cjob_)[a-zA-Z0-9_-]+$/.test(jobId)) {
    return { error: 'Invalid job ID format' };
  }

  const db = getVideoDbWrite();
  if (!db) return { error: 'Database not available' };

  const ALLOWED = ['script', 'caption', 'hook', 'priority', 'status', 'grade', 'grade_notes', 'scheduled_time', 'failure_reason', 'platform_targets',
    'voice_audio_path', 'avatar_video_path', 'captioned_video_path', 'video_r2_url', 'video_gdrive_url', 'heygen_video_id', 'last_failed_stage', 'retry_count'];
  const VALID_STATUSES = ['draft', 'planned', 'scripted', 'voice_ready', 'avatar_ready', 'captioned',
    'qa_passed', 'qa_failed', 'approved', 'scheduled', 'posted', 'urgent_review',
    'voice_failed', 'avatar_failed', 'avatar_timeout', 'avatar_processing', 'caption_failed', 'script_too_long', 'rejected'];
  const VALID_PLATFORMS = ['instagram', 'x'];

  const fields = [];
  const values = [];

  for (const [key, val] of Object.entries(updates)) {
    if (!ALLOWED.includes(key)) continue;

    // Validate specific fields
    if (key === 'status' && !VALID_STATUSES.includes(val)) {
      try { db.close(); } catch {} return { error: `Invalid status: ${val}` };
    }
    if (key === 'grade') {
      const g = parseInt(val);
      if (isNaN(g) || g < 1 || g > 5) {
        try { db.close(); } catch {} return { error: 'Grade must be 1-5' };
      }
      fields.push(`${key} = ?`); values.push(g); continue;
    }
    if (key === 'platform_targets' && val) {
      try {
        const pt = JSON.parse(val);
        if (!Array.isArray(pt) || !pt.every(p => VALID_PLATFORMS.includes(p))) {
          try { db.close(); } catch {} return { error: 'platform_targets must be JSON array of: ' + VALID_PLATFORMS.join(', ') };
        }
      } catch {
        try { db.close(); } catch {} return { error: 'platform_targets must be valid JSON array' };
      }
    }
    if (key === 'script' && typeof val === 'string' && val.length > 10000) {
      try { db.close(); } catch {} return { error: 'Script too long (max 10000 chars)' };
    }
    if (key === 'caption' && typeof val === 'string' && val.length > 5000) {
      try { db.close(); } catch {} return { error: 'Caption too long (max 5000 chars)' };
    }

    fields.push(`${key} = ?`);
    values.push(val);
  }

  if (!fields.length) { try { db.close(); } catch {} return { error: 'No valid fields to update' }; }

  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(jobId);

  try {
    const result = db.prepare(`UPDATE video_jobs SET ${fields.join(', ')} WHERE job_id = ?`).run(...values);
    db.close(); // Release write lock immediately
    if (result.changes === 0) return { error: 'Job not found' };
    // Reopen read-only connection to pick up changes
    if (_videoDb) { try { _videoDb.close(); } catch {} _videoDb = null; }
    return { ok: true };
  } catch (e) {
    try { db.close(); } catch {}
    return { error: e.message };
  }
}

/**
 * Delete a video job and its associated files.
 */
function deleteJob(jobId) {
  const db = getVideoDbWrite();
  if (!db) return { error: 'Database not available' };

  try {
    const job = db.prepare('SELECT * FROM video_jobs WHERE job_id = ?').get(jobId);
    if (!job) { db.close(); return { error: 'Job not found' }; }

    db.prepare('DELETE FROM video_jobs WHERE job_id = ?').run(jobId);
    db.close();

    // Reopen read-only connection
    if (_videoDb) { try { _videoDb.close(); } catch {} _videoDb = null; }

    // Remove job files directory
    const jobDir = path.join(JOBS_DIR, jobId);
    if (fs.existsSync(jobDir)) {
      fs.rmSync(jobDir, { recursive: true, force: true });
    }

    return { ok: true };
  } catch (e) {
    try { db.close(); } catch {}
    return { error: e.message };
  }
}

module.exports = { getJobs, getJob, getPipelineStats, getTodayJob, getTopicsRemaining, getJobFiles, getContentSummary, updateJob, deleteJob, STATUS_ORDER };
