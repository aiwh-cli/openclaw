// ─── Cinematic Sync ───────────────────────────────────────────
// Reads/writes the cinematic pipeline tables in video-jobs.db.

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const _CLIENT_ROOT = process.env.CLIENT_ROOT || '/opt/AIWH/client';
const VIDEO_DB = _CLIENT_ROOT + '/data/video-jobs.db';
const CINEMATIC_DIR = _CLIENT_ROOT + '/content/cinematic';

let _db = null;

function getDb() {
  if (_db) return _db;
  if (!fs.existsSync(VIDEO_DB)) return null;
  try {
    _db = new Database(VIDEO_DB);
    _db.pragma('journal_mode = WAL');
    return _db;
  } catch { return null; }
}

// ── Read Operations ────────────────────────────────────────────

function getJobs(limit = 20, phase = null) {
  const db = getDb();
  if (!db) return [];
  try {
    let sql = 'SELECT * FROM cinematic_jobs';
    const params = [];
    if (phase) { sql += ' WHERE phase = ?'; params.push(phase); }
    sql += ' ORDER BY updated_at DESC LIMIT ?';
    params.push(limit);
    return db.prepare(sql).all(...params);
  } catch { return []; }
}

function getJob(cjobId) {
  const db = getDb();
  if (!db) return null;
  try {
    return db.prepare('SELECT * FROM cinematic_jobs WHERE cjob_id = ?').get(cjobId);
  } catch { return null; }
}

function getAssets(cjobId, assetType = null) {
  const db = getDb();
  if (!db) return [];
  try {
    let sql = 'SELECT * FROM cinematic_assets WHERE cjob_id = ?';
    const params = [cjobId];
    if (assetType) { sql += ' AND asset_type = ?'; params.push(assetType); }
    sql += ' ORDER BY clip_index, sequence, generation_version';
    return db.prepare(sql).all(...params);
  } catch { return []; }
}

function getPendingReviewCount() {
  const db = getDb();
  if (!db) return 0;
  try {
    const row = db.prepare(
      "SELECT COUNT(*) as n FROM cinematic_jobs WHERE phase LIKE '%_review'"
    ).get();
    return row?.n || 0;
  } catch { return 0; }
}

function getAssetFilePath(assetId) {
  const db = getDb();
  if (!db) return null;
  try {
    const row = db.prepare('SELECT file_path FROM cinematic_assets WHERE asset_id = ?').get(assetId);
    return row?.file_path || null;
  } catch { return null; }
}

function getFinalVideoPath(cjobId) {
  const finalPath = path.join(CINEMATIC_DIR, cjobId, 'output', 'final.mp4');
  return fs.existsSync(finalPath) ? finalPath : null;
}

// ── Write Operations ───────────────────────────────────────────

function createJob(title, brief, duration, clips, avatarLookId, voiceId, outputFormat, noAvatar = false, captionsEnabled = 0, captionPosition = 'bottom', captionStyle = 'clean', autoApproveRefs = 0, autoApproveKeyframes = 0, autoApproveClips = 0, autonomyThreshold = 4.0) {
  const db = getDb();
  if (!db) return null;

  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const row = db.prepare(
    `SELECT MAX(CAST(SUBSTR(cjob_id, -4) AS INTEGER)) as n FROM cinematic_jobs WHERE cjob_id LIKE 'cjob_${today}_%'`
  ).get();
  const n = (row?.n || 0) + 1;
  const cjobId = `cjob_${today}_${String(n).padStart(4, '0')}`;
  const now = new Date().toISOString();

  db.prepare(
    'INSERT INTO cinematic_jobs (cjob_id, title, brief, target_duration_sec, clip_count, avatar_look_id, voice_id, output_format, no_avatar, captions_enabled, caption_position, caption_style, auto_approve_refs, auto_approve_keyframes, auto_approve_clips, autonomy_threshold, phase, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
  ).run(cjobId, title, brief, duration, clips, avatarLookId || null, voiceId || null, outputFormat || '16:9', noAvatar ? 1 : 0, captionsEnabled ? 1 : 0, captionPosition || 'bottom', captionStyle || 'clean', autoApproveRefs ? 1 : 0, autoApproveKeyframes ? 1 : 0, autoApproveClips ? 1 : 0, autonomyThreshold || 4.0, 'brief', now, now);

  return cjobId;
}

function reviewAsset(assetId, cjobId, grade, action, notes) {
  const db = getDb();
  if (!db) return false;

  const now = new Date().toISOString();
  const statusMap = { approve: 'approved', reject: 'rejected', regen: 'regenerating' };
  const newStatus = statusMap[action] || 'approved';

  db.prepare(
    'UPDATE cinematic_assets SET status=?, grade=?, grade_notes=?, reviewed_at=?, updated_at=? WHERE asset_id=? AND cjob_id=?'
  ).run(newStatus, grade, notes || '', now, now, assetId, cjobId);

  // Log to style_grades
  const asset = db.prepare('SELECT * FROM cinematic_assets WHERE asset_id=?').get(assetId);
  if (asset) {
    db.prepare(
      'INSERT INTO style_grades (cjob_id, asset_id, asset_type, grade, prompt_used, review_source, created_at) VALUES (?,?,?,?,?,?,?)'
    ).run(cjobId, assetId, asset.asset_type, grade, asset.prompt, 'human', now);
  }

  return true;
}

function approvePhase(cjobId, grade, notes) {
  const db = getDb();
  if (!db) return false;

  const job = db.prepare('SELECT * FROM cinematic_jobs WHERE cjob_id=?').get(cjobId);
  if (!job) return false;

  const now = new Date().toISOString();
  const advanceMap = {
    'analysis_review': { next: 'ref_images', gradeCol: 'analysis_grade', notesCol: 'analysis_notes' },
    'final_review': { next: 'approved', gradeCol: 'final_grade', notesCol: 'final_notes' },
  };

  const advance = advanceMap[job.phase];
  if (!advance) return false;

  db.prepare(
    `UPDATE cinematic_jobs SET phase=?, ${advance.gradeCol}=?, ${advance.notesCol}=?, updated_at=? WHERE cjob_id=?`
  ).run(advance.next, grade, notes || '', now, cjobId);

  return true;
}

function rejectPhase(cjobId, notes) {
  const db = getDb();
  if (!db) return false;

  const job = db.prepare('SELECT * FROM cinematic_jobs WHERE cjob_id=?').get(cjobId);
  if (!job) return false;

  const now = new Date().toISOString();
  // Go back to the generating phase
  const rejectMap = {
    'analysis_review': 'analyzing',
    'ref_review': 'ref_images',
    'keyframe_review': 'keyframes',
    'clip_review': 'video_clips',
    'final_review': 'assembly',
  };

  const prevPhase = rejectMap[job.phase];
  if (!prevPhase) return false;

  db.prepare(
    'UPDATE cinematic_jobs SET phase=?, error_message=?, updated_at=? WHERE cjob_id=?'
  ).run(prevPhase, `Rejected: ${notes || 'no notes'}`, now, cjobId);

  return true;
}

function advanceGate(cjobId) {
  const db = getDb();
  if (!db) return false;

  const job = db.prepare('SELECT * FROM cinematic_jobs WHERE cjob_id=?').get(cjobId);
  if (!job) return false;

  const now = new Date().toISOString();
  const gateMap = {
    'ref_review': 'keyframes',
    'keyframe_review': 'video_clips',
    'clip_review': 'narration',
  };

  const nextPhase = gateMap[job.phase];
  if (!nextPhase) return false;

  // Check that at least some assets are approved
  const assetTypeMap = {
    'ref_review': 'ref_image',
    'keyframe_review': 'keyframe_%',
    'clip_review': 'video_clip',
  };

  const pattern = assetTypeMap[job.phase];
  const approved = db.prepare(
    "SELECT COUNT(*) as n FROM cinematic_assets WHERE cjob_id=? AND asset_type LIKE ? AND status='approved'"
  ).get(cjobId, pattern);

  if (!approved || approved.n === 0) return false;

  db.prepare('UPDATE cinematic_jobs SET phase=?, updated_at=? WHERE cjob_id=?').run(nextPhase, now, cjobId);
  return true;
}

function deleteJob(cjobId) {
  const db = getDb();
  if (!db) return false;

  const job = db.prepare('SELECT * FROM cinematic_jobs WHERE cjob_id=?').get(cjobId);
  if (!job) return false;

  // Delete assets, style grades, then the job
  db.prepare('DELETE FROM style_grades WHERE cjob_id=?').run(cjobId);
  db.prepare('DELETE FROM cinematic_assets WHERE cjob_id=?').run(cjobId);
  db.prepare('DELETE FROM cinematic_jobs WHERE cjob_id=?').run(cjobId);

  // Remove job directory if it exists
  const jobDir = path.join(CINEMATIC_DIR, cjobId);
  if (fs.existsSync(jobDir)) {
    fs.rmSync(jobDir, { recursive: true, force: true });
  }

  return true;
}

function getConfidenceByType() {
  const db = getDb();
  if (!db) return {};

  try {
    const rows = db.prepare(`
      SELECT asset_type,
             COUNT(*) as sample_count,
             AVG(grade) as avg_grade,
             MIN(grade) as min_grade,
             MAX(grade) as max_grade
      FROM style_grades
      GROUP BY asset_type
    `).all();

    const result = {};
    for (const row of rows) {
      const sampleFactor = Math.min(1.0, row.sample_count / 30);
      const gradeFactor = row.avg_grade / 5.0;
      result[row.asset_type] = {
        sample_count: row.sample_count,
        avg_grade: Math.round(row.avg_grade * 100) / 100,
        min_grade: row.min_grade,
        max_grade: row.max_grade,
        confidence: Math.round(sampleFactor * gradeFactor * 100) / 100
      };
    }
    return result;
  } catch { return {}; }
}

function updateAnalysis(cjobId, styleBible, productionPlan, narrationScript) {
  const db = getDb();
  if (!db) return false;

  const job = db.prepare('SELECT * FROM cinematic_jobs WHERE cjob_id=?').get(cjobId);
  if (!job) return false;

  // Only allow editing during analysis_review phase
  if (job.phase !== 'analysis_review') return false;

  const now = new Date().toISOString();

  // Update DB columns
  db.prepare(
    'UPDATE cinematic_jobs SET style_bible=?, production_plan=?, narration_script=?, updated_at=? WHERE cjob_id=?'
  ).run(
    typeof styleBible === 'string' ? styleBible : JSON.stringify(styleBible),
    typeof productionPlan === 'string' ? productionPlan : JSON.stringify(productionPlan),
    narrationScript,
    now,
    cjobId
  );

  // Also write to asset directory files
  const jobDir = path.join(CINEMATIC_DIR, cjobId);
  if (fs.existsSync(jobDir)) {
    try {
      fs.writeFileSync(path.join(jobDir, 'style-bible.json'),
        JSON.stringify(typeof styleBible === 'string' ? JSON.parse(styleBible) : styleBible, null, 2));
      fs.writeFileSync(path.join(jobDir, 'production-plan.json'),
        JSON.stringify(typeof productionPlan === 'string' ? JSON.parse(productionPlan) : productionPlan, null, 2));
      fs.writeFileSync(path.join(jobDir, 'narration-script.txt'), narrationScript);
    } catch (e) {
      console.error('Failed to write analysis files:', e.message);
    }
  }

  return true;
}

function publishJob(cjobId, platforms) {
  const db = getDb();
  if (!db) return { error: 'Database not available' };

  const job = db.prepare('SELECT * FROM cinematic_jobs WHERE cjob_id=?').get(cjobId);
  if (!job) return { error: 'Job not found' };
  if (job.phase !== 'approved') return { error: `Job is in phase '${job.phase}', must be 'approved' to publish` };

  const now = new Date().toISOString();
  db.prepare(
    'UPDATE cinematic_jobs SET phase=?, updated_at=?, completed_at=? WHERE cjob_id=?'
  ).run('published', now, now, cjobId);

  return { ok: true };
}

function completeJob(cjobId) {
  const db = getDb();
  if (!db) return { error: 'Database not available' };

  const job = db.prepare('SELECT * FROM cinematic_jobs WHERE cjob_id=?').get(cjobId);
  if (!job) return { error: 'Job not found' };
  if (job.phase !== 'final_review') return { error: `Job is in phase '${job.phase}', must be 'final_review' to complete` };

  const now = new Date().toISOString();
  // Mark as approved (ready for social publishing). 'published' only after Buffer dispatch.
  db.prepare(
    'UPDATE cinematic_jobs SET phase=?, updated_at=?, completed_at=? WHERE cjob_id=?'
  ).run('approved', now, now, cjobId);

  return { ok: true };
}

module.exports = {
  getJobs, getJob, getAssets, getPendingReviewCount,
  getAssetFilePath, getFinalVideoPath,
  createJob, reviewAsset, approvePhase, rejectPhase, advanceGate, deleteJob,
  updateAnalysis, getConfidenceByType, publishJob, completeJob
};
