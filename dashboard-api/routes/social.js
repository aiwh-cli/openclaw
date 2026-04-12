// ─── Routes: Social Strategy ─────────────────────────────────
// Theme S (Phase 77) — Calendar, metrics, settings, review queue, pillars, upload
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const crypto = require('crypto');

const { describeImage, safeParseJson, insertGrade, validateJobId, getDefaultPlatforms } = require('../helpers/social-helpers');
const CLIENT_ROOT = process.env.CLIENT_ROOT || '/opt/AIWH/client';
const POLICY_PATH = path.join(CLIENT_ROOT, 'config', 'client-policy.json');
const PILLARS_PATH = path.join(CLIENT_ROOT, 'config', 'content-pillars.json');
const METRICS_PATH = path.join(CLIENT_ROOT, 'data', 'social-metrics.json');
const VIDEO_DB_PATH = path.join(CLIENT_ROOT, 'data', 'video-jobs.db');

function readJson(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return fallback; }
}

function writeJson(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

module.exports = function(app, deps) {
  const { db } = deps;

  // Helper: open video-jobs.db (separate from mission-control.db)
  let vjDb = null;
  function getVjDb() {
    if (vjDb) return vjDb;
    try {
      const Database = require('better-sqlite3');
      vjDb = new Database(VIDEO_DB_PATH, { readonly: false });
      vjDb.pragma('journal_mode = WAL');
      return vjDb;
    } catch (e) {
      console.error('[social] Cannot open video-jobs.db:', e.message);
      return null;
    }
  }

  // ─── Calendar ──────────────────────────────────────────────
  app.get('/api/social/calendar', (req, res) => {
    const pillars = readJson(PILLARS_PATH, { pillars: [], rotation: [] });
    const vdb = getVjDb();
    if (!vdb) return res.json({ days: [], pillars: pillars.pillars });

    // Get content from last 14 days + next 7 days
    const rows = vdb.prepare(`
      SELECT job_id, topic, pillar, status, content_type, captions, image_path,
             scheduled_for_date, scheduled_time, created_at, platform_targets
      FROM video_jobs
      WHERE created_at >= datetime('now', '-14 days')
      ORDER BY scheduled_for_date DESC, created_at DESC
      LIMIT 100
    `).all();

    // Group by date
    const byDate = {};
    for (const row of rows) {
      const date = row.scheduled_for_date || row.created_at?.split('T')[0] || row.created_at?.split(' ')[0];
      if (!date) continue;
      if (!byDate[date]) byDate[date] = [];
      byDate[date].push({
        job_id: row.job_id,
        topic: row.topic,
        pillar: row.pillar,
        status: row.status,
        content_type: row.content_type || 'video_reel',
        captions: row.captions ? safeParseJson(row.captions) : null,
        image_path: row.image_path,
        scheduled_time: row.scheduled_time,
        platform_targets: row.platform_targets ? safeParseJson(row.platform_targets) : null,
      });
    }

    const days = Object.entries(byDate)
      .map(([date, posts]) => ({ date, posts }))
      .sort((a, b) => a.date.localeCompare(b.date));

    res.json({
      days,
      pillars: pillars.pillars,
      target_platforms: pillars.target_platforms || [],
      platform_formats: pillars.platform_formats || {},
    });
  });

  // ─── Metrics ───────────────────────────────────────────────
  app.get('/api/social/metrics', (req, res) => {
    const metrics = readJson(METRICS_PATH, null);
    if (!metrics) {
      return res.json({ status: 'no_data', message: 'Waiting for first weekly strategy report.' });
    }
    res.json(metrics);
  });

  // ─── Settings (Social Policy) ─────────────────────────────
  app.get('/api/social/settings', (req, res) => {
    const policy = readJson(POLICY_PATH, {});
    res.json(policy.social || {});
  });

  app.put('/api/social/settings', (req, res) => {
    const updates = req.body;
    if (!updates || typeof updates !== 'object') return res.status(400).json({ error: 'Invalid request body' });
    const err = (msg) => res.status(400).json({ error: msg });
    if (updates.max_posts_per_day !== undefined) { const n = parseInt(updates.max_posts_per_day, 10); if (isNaN(n) || n < 1 || n > 10) return err('max_posts_per_day must be 1-10'); updates.max_posts_per_day = n; }
    if (updates.engagement_hours !== undefined && !/^\d{2}:\d{2}-\d{2}:\d{2}$/.test(updates.engagement_hours)) return err('engagement_hours must be HH:MM-HH:MM');
    if (updates.autonomy_threshold !== undefined) { const t = parseFloat(updates.autonomy_threshold); if (isNaN(t) || t < 1 || t > 5) return err('autonomy_threshold must be 1.0-5.0'); updates.autonomy_threshold = t; }
    if (updates.content_mix !== undefined) { const m = updates.content_mix; if (typeof m !== 'object') return err('content_mix must be an object'); if ((m.video_reels||0)+(m.text_posts||0)+(m.image_posts||0) !== 100) return err('content_mix must sum to 100'); }
    if (updates.max_retries !== undefined) { const r = parseInt(updates.max_retries, 10); if (isNaN(r) || r < 1 || r > 5) return err('max_retries must be 1-5'); updates.max_retries = r; }
    for (const key of ['auto_publish_text', 'auto_publish_images', 'notify_on_comments']) { if (updates[key] !== undefined) updates[key] = !!updates[key]; }

    const policy = readJson(POLICY_PATH, {});
    policy.social = { ...(policy.social || {}), ...updates };
    writeJson(POLICY_PATH, policy);
    res.json({ ok: true, social: policy.social });
  });

  // ─── Review Queue ──────────────────────────────────────────
  app.get('/api/social/review-queue', (req, res) => {
    const vdb = getVjDb();
    if (!vdb) return res.json({ items: [] });

    const items = vdb.prepare(`
      SELECT job_id, topic, pillar, status, content_type, captions, image_path,
             retry_count, grade, grade_notes, created_at
      FROM video_jobs
      WHERE status IN ('pending_review', 'captioning', 'captioned')
      ORDER BY created_at DESC
      LIMIT 50
    `).all();

    res.json({
      items: items.map(r => ({
        ...r,
        captions: r.captions ? safeParseJson(r.captions) : null,
        content_type: r.content_type || 'video_reel',
      })),
    });
  });

  app.post('/api/social/review/:jobId', validateJobId, (req, res) => {
    const { jobId } = req.params;
    const { action, grade, feedback, captions, skip } = req.body;

    if (!['approve', 'reject', 'edit', 'regen_captions'].includes(action)) {
      return res.status(400).json({ error: 'action must be approve, reject, edit, or regen_captions' });
    }
    if (action === 'approve' && (grade === undefined || grade < 1 || grade > 5)) {
      return res.status(400).json({ error: 'grade must be 1-5 for approval' });
    }

    const vdb = getVjDb();
    if (!vdb) return res.status(500).json({ error: 'Database unavailable' });

    const job = vdb.prepare('SELECT * FROM video_jobs WHERE job_id = ?').get(jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    if (action === 'approve') {
      vdb.prepare(`UPDATE video_jobs SET status = 'approved', grade = ?, grade_notes = ?,
                    updated_at = datetime('now') WHERE job_id = ?`).run(grade, feedback || null, jobId);
      // Record in social_grades
      insertGrade(vdb, jobId, job.content_type || 'video_reel', grade, feedback, 'human');
      return res.json({ ok: true, status: 'approved' });
    }

    if (action === 'regen_captions') {
      vdb.prepare(`UPDATE video_jobs SET captions = NULL, grade_notes = ?, updated_at = datetime('now') WHERE job_id = ?`).run(feedback || null, jobId);
      if (grade) insertGrade(vdb, jobId, job.content_type || 'video_reel', grade, feedback, 'human');
      try { // Dispatch copywriter to regenerate captions with feedback
        const { client: gateway } = require('../gateway-ws');
        const jp = job.platform_targets ? safeParseJson(job.platform_targets) : null;
        const plats = (Array.isArray(jp) ? jp : (readJson(PILLARS_PATH, {}).target_platforms || ['instagram', 'x'])).join(', ');
        const socialCfg = readJson(POLICY_PATH, {}).social || {};
        const perPlat = socialCfg.caption_style_per_platform || {};
        const platArr = Array.isArray(jp) ? jp : (readJson(PILLARS_PATH, {}).target_platforms || ['instagram', 'x']);
        const styleLines = platArr.map(p => perPlat[p] ? `${p}: ${perPlat[p]}` : '').filter(Boolean).join('\n');
        const styleNote = styleLines ? `\nCAPTION STYLE GUIDE (follow strictly):\n${styleLines}` : (socialCfg.caption_style ? ` Caption style: "${socialCfg.caption_style}".` : '');
        const regenDesc = describeImage(job.image_path);
        const imgCtx = regenDesc ? ` Image shows: "${regenDesc}". Base captions on the actual image.` : '';
        gateway.ensureConnected().then(() => gateway.request('chat.send', { sessionKey: `agent:copywriter:social-caption-${jobId}`,
          message: `Regenerate captions for this social post. Topic: "${job.topic}". Pillar: "${job.pillar}". Content type: ${job.content_type}.${styleNote}${imgCtx} Previous captions rejected — feedback: "${feedback || 'none'}". ONLY generate for these platforms (no others): ${plats}. Write as JSON with ONLY these keys. Follow CORE.md rules. Save via stdin to avoid shell quoting issues: echo '<your JSON>' | python3 /opt/AIWH/core/scripts/lib/db-update.py ${VIDEO_DB_PATH} update_field ${jobId} captions`,
          deliver: false, idempotencyKey: `regen-${jobId}-${Date.now()}`, attachments: [] }, 120000));
      } catch (e) { console.error('[social] Caption regen failed:', e.message); }
      return res.json({ ok: true, status: 'regenerating_captions' });
    }

    if (action === 'reject') {
      const ct = job.content_type || 'video_reel';
      if (skip) { // Skip: drop entirely
        vdb.prepare(`UPDATE video_jobs SET status='failed', grade=?, grade_notes=?, failure_reason='Skipped', updated_at=datetime('now') WHERE job_id=?`).run(grade||1, feedback||null, jobId);
        if (grade) insertGrade(vdb, jobId, ct, grade, feedback, 'human');
        return res.json({ ok: true, status: 'skipped' });
      }
      const maxRetries = (readJson(POLICY_PATH, {}).social?.max_retries) || 3, retryCount = (job.retry_count||0) + 1;
      if (retryCount > maxRetries) vdb.prepare(`UPDATE video_jobs SET status='failed', grade=?, grade_notes=?, failure_reason='Max retries', updated_at=datetime('now') WHERE job_id=?`).run(grade||1, feedback||null, jobId);
      else vdb.prepare(`UPDATE video_jobs SET status='rejected', grade=?, grade_notes=?, retry_count=?, updated_at=datetime('now') WHERE job_id=?`).run(grade||2, feedback||null, retryCount, jobId);
      if (grade) insertGrade(vdb, jobId, ct, grade, feedback, 'human');
      return res.json({ ok: true, status: retryCount > maxRetries ? 'failed' : 'rejected', retryCount });
    }

    if (action === 'edit') {
      if (captions) {
        vdb.prepare(`UPDATE video_jobs SET captions = ?, updated_at = datetime('now') WHERE job_id = ?`)
          .run(JSON.stringify(captions), jobId);
      }
      return res.json({ ok: true, status: 'edited' });
    }
  });

  // ─── Confidence (Auto-Approve Progress) ───────────────────
  app.get('/api/social/confidence', (req, res) => {
    const vdb = getVjDb();
    if (!vdb) return res.json({ text_post: null, image_post: null });

    const policy = readJson(POLICY_PATH, {});
    const threshold = (policy.social?.autonomy_threshold || 4.0) / 5.0;

    const result = {};
    for (const contentType of ['text_post', 'image_post']) {
      const pipelineCfg = policy.pipeline || {};
      const approvesamples = pipelineCfg.auto_approve_samples || {};
      const requiredSamples = approvesamples[contentType] || (contentType === 'image_post' ? 30 : 15);
      try {
        const row = vdb.prepare(`
          SELECT COUNT(*) as count, AVG(grade) as avg_grade
          FROM social_grades WHERE content_type = ?
        `).get(contentType);

        const count = row?.count || 0;
        const avgGrade = row?.avg_grade || 0;
        const sampleFactor = Math.min(1.0, count / requiredSamples);
        const gradeFactor = avgGrade / 5.0;
        const confidence = sampleFactor * gradeFactor;

        result[contentType] = {
          count,
          requiredSamples,
          avgGrade: Math.round(avgGrade * 100) / 100,
          confidence: Math.round(confidence * 1000) / 1000,
          threshold,
          eligible: confidence >= threshold && count >= Math.floor(requiredSamples / 2),
        };
      } catch {
        result[contentType] = { count: 0, requiredSamples, avgGrade: 0, confidence: 0, threshold, eligible: false };
      }
    }
    res.json(result);
  });

  // ─── Pillars ──────────────────────────────────────────────
  app.get('/api/social/pillars', (req, res) => { res.json(readJson(PILLARS_PATH, { pillars: [] })); });

  app.put('/api/social/pillars', (req, res) => {
    const updates = req.body;
    if (!updates || typeof updates !== 'object') return res.status(400).json({ error: 'Invalid body' });
    const pillars = readJson(PILLARS_PATH, {});
    if (updates.target_platforms && Array.isArray(updates.target_platforms)) {
      const valid = ['instagram', 'x', 'linkedin', 'tiktok', 'facebook'];
      pillars.target_platforms = updates.target_platforms.filter(p => valid.includes(p));
    }
    if (updates.platform_formats && typeof updates.platform_formats === 'object') {
      const vf = ['9:16', '16:9', '1:1', '4:5'], cleaned = {};
      for (const [p, fmt] of Object.entries(updates.platform_formats)) { if (vf.includes(fmt)) cleaned[p] = fmt; }
      pillars.platform_formats = cleaned;
    }
    if (updates.pillars && Array.isArray(updates.pillars)) {
      for (const update of updates.pillars) {
        const existing = pillars.pillars?.find(p => p.id === update.id);
        if (existing && update.hashtags && Array.isArray(update.hashtags)) {
          existing.hashtags = update.hashtags;
        }
      }
    }

    writeJson(PILLARS_PATH, pillars);
    res.json({ success: true });
  });

  // ─── Image Preview ─────────────────────────────────────────
  app.get('/api/social/image/:jobId', validateJobId, (req, res) => {
    const vdb = getVjDb(); if (!vdb) return res.status(500).send('DB unavailable');
    const job = vdb.prepare('SELECT image_path FROM video_jobs WHERE job_id = ?').get(req.params.jobId);
    if (!job?.image_path || !fs.existsSync(job.image_path) || !job.image_path.startsWith(CLIENT_ROOT)) return res.status(404).send('Not found');
    res.sendFile(job.image_path);
  });

  // ─── Upload Content ────────────────────────────────────────
  const SOCIAL_DIR = path.join(CLIENT_ROOT, 'content', 'social');
  const socialUpload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => {
        const platform = (req.body.platform || 'instagram').toLowerCase();
        const dest = path.join(SOCIAL_DIR, platform, file.mimetype.startsWith('image/') ? 'images' : 'video');
        fs.mkdirSync(dest, { recursive: true });
        cb(null, dest);
      },
      filename: (req, file, cb) => {
        req._socialJobId = `social-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
        cb(null, `${req._socialJobId}${path.extname(file.originalname)}`);
      },
    }),
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: (req, file, cb) => cb(null, /^(image|video)\//.test(file.mimetype)),
  });

  app.post('/api/social/upload', socialUpload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No valid file uploaded' });

    const vdb = getVjDb();
    if (!vdb) return res.status(500).json({ error: 'Database unavailable' });

    const jobId = req._socialJobId;
    const isImage = req.file.mimetype.startsWith('image/');
    const contentType = isImage ? 'image_post' : 'video_reel';
    const platforms = req.body.platforms ? JSON.parse(req.body.platforms) : ['instagram', 'x'];
    const captions = req.body.captions || null;
    const pillar = req.body.pillar || 'manual';
    const scheduledDate = req.body.scheduled_for_date || null;
    const status = req.body.schedule_now === 'true' ? 'approved' : 'pending_review';

    try {
      vdb.prepare(`INSERT INTO video_jobs (job_id, topic, pillar, status, content_type,
                    captions, image_path, platform_targets, scheduled_for_date, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`)
        .run(jobId, req.body.topic || `Manual upload: ${req.file.originalname}`, pillar, status, contentType,
             captions, isImage ? req.file.path : null, JSON.stringify(platforms), scheduledDate);

      res.json({ ok: true, job_id: jobId, content_type: contentType, status });
    } catch (e) {
      res.status(500).json({ error: 'Failed to create job: ' + e.message });
    }
  });

  // ─── Generate Captions (async copywriter dispatch) ────────
  app.post('/api/social/generate-captions', async (req, res) => {
    const { job_id } = req.body;
    if (!job_id) return res.status(400).json({ error: 'job_id required' });

    const vdb = getVjDb();
    if (!vdb) return res.status(500).json({ error: 'Database unavailable' });

    const job = vdb.prepare('SELECT * FROM video_jobs WHERE job_id = ?').get(job_id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    try {
      const { client: gateway } = require('../gateway-ws');
      await gateway.ensureConnected();
      const sessionKey = `agent:copywriter:social-caption-${job_id}`;
      const jobPlatforms = job.platform_targets ? safeParseJson(job.platform_targets) : null;
      const platforms = Array.isArray(jobPlatforms) ? jobPlatforms : (readJson(PILLARS_PATH, {}).target_platforms || ['instagram', 'x']);
      const policy = readJson(POLICY_PATH, {});
      const captionStyle = policy.social?.caption_style ? ` Caption style: "${policy.social.caption_style}".` : '';
      const desc = describeImage(job.image_path);
      const imageContext = desc ? `\n\nImage description (vision): "${desc}"\nIMPORTANT: Base captions on the actual image content.` : '';
      const message = `Generate captions for this social media post. Topic: "${job.topic}". Pillar: "${job.pillar}". Content type: ${job.content_type}.${captionStyle}${imageContext}\n\nONLY generate captions for these platforms (do NOT add others): ${platforms.join(', ')}.\nWrite captions as a JSON object with ONLY these keys: ${platforms.map(p => `"${p}"`).join(', ')}. Follow the caption rules from your CORE.md. Save via: python3 /opt/AIWH/core/scripts/lib/db-update.py ${VIDEO_DB_PATH} update_field ${job_id} captions '<your JSON>'`;

      await gateway.request('chat.send', {
        sessionKey, message, deliver: false,
        idempotencyKey: `caption-${job_id}-${Date.now()}`, attachments: [],
      }, 120000);
      res.json({ ok: true, status: 'dispatched', session: sessionKey });
    } catch (e) {
      res.status(500).json({ error: 'Failed to dispatch: ' + e.message });
    }
  });

}; // end module.exports
