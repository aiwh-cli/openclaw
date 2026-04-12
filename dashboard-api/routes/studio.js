// ─── Routes: Studio — Content Creation API ───────────────────
// Theme S.c Phase 3 — Studio tab endpoints for upload, AI image gen,
// text post creation, compositor templates, and render status.
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const { validateJobId, getDefaultPlatforms } = require('../helpers/social-helpers');
const CLIENT_ROOT = process.env.CLIENT_ROOT || '/opt/AIWH/client';
const PROVIDERS_PATH = path.join(CLIENT_ROOT, 'config', 'cinematic-providers.json');
const TEMPLATE_DEFAULTS = path.join('/opt/AIWH/core/config', 'remotion-template-defaults.json');
const CLIENT_TEMPLATES = path.join(CLIENT_ROOT, 'config', 'remotion-templates.json');
const VIDEO_DB_PATH = path.join(CLIENT_ROOT, 'data', 'video-jobs.db');

function readJson(fp, fb) { try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return fb; } }

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const platform = req.body.platform || 'instagram';
      const isVideo = _file.mimetype?.startsWith('video/');
      const sub = isVideo ? 'video' : 'images';
      const dir = path.join(CLIENT_ROOT, 'content', 'social', platform, sub);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const ts = Date.now();
      const ext = path.extname(file.originalname) || '.png';
      cb(null, `studio-${ts}${ext}`);
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

module.exports = function(app, { dashLog }) {
  const { client: gateway } = require('../gateway-ws');

  let vjDb = null;
  function getVjDb() {
    if (vjDb) return vjDb;
    try {
      const Database = require('better-sqlite3');
      vjDb = new Database(VIDEO_DB_PATH, { readonly: false });
      vjDb.pragma('journal_mode = WAL');
      return vjDb;
    } catch (e) {
      console.error('[studio] Cannot open video-jobs.db:', e.message);
      return null;
    }
  }

  // AEST offset helper: stores times as AEST-aware in created_at/updated_at
  const nowAEST = () => {
    const d = new Date();
    return d.toISOString().replace('T', ' ').slice(0, 19);
  };

  // ─── Upload (wraps social upload + auto caption gen) ────────
  app.post('/api/studio/upload', upload.single('file'), async (req, res) => {
    const db = getVjDb();
    if (!db) return res.status(500).json({ error: 'Database unavailable' });
    if (!req.file) return res.status(400).json({ error: 'No file provided' });

    const topic = req.body.topic || '';
    const pillar = req.body.pillar || '';
    const platforms = (() => { try { return JSON.parse(req.body.platforms); } catch { return ['instagram']; } })();
    const scheduleDate = req.body.scheduled_for_date || '';
    const isVideo = req.file.mimetype?.startsWith('video/');
    const contentType = isVideo ? 'video_reel' : 'image_post';
    const jobId = `social-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const withCaptions = req.body.generate_captions === 'true';

    try {
      db.prepare(`INSERT INTO video_jobs (job_id, topic, pillar, content_type, status, captions,
        platform_targets, image_path, scheduled_for_date, source, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'pending_review', ?, ?, ?, ?, 'studio', datetime('now'), datetime('now'))`).run(
        jobId, topic, pillar, contentType,
        withCaptions ? '{"_pending":true}' : null,
        JSON.stringify(platforms), isVideo ? null : req.file.path,
        scheduleDate || null);

      // Dispatch caption generation via gateway RPC
      if (withCaptions) {
        _dispatchCaptions(jobId, platforms, topic, req.file.path);
      }

      dashLog?.('studio', `Uploaded ${contentType}: ${jobId}`);
      res.json({ ok: true, job_id: jobId, content_type: contentType });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── AI Image Generation ───────────────────────────────────
  app.post('/api/studio/generate-image', async (req, res) => {
    const { prompt, pillar, platforms = getDefaultPlatforms(), scheduled_for_date } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Prompt required' });

    const db = getVjDb();
    if (!db) return res.status(500).json({ error: 'Database unavailable' });

    const jobId = `social-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    try {
      db.prepare(`INSERT INTO video_jobs (job_id, topic, pillar, content_type, status, captions,
        platform_targets, scheduled_for_date, source, created_at, updated_at)
        VALUES (?, ?, ?, 'image_post', 'pending_review', '{"_pending":true}', ?, ?, 'studio', datetime('now'), datetime('now'))`).run(
        jobId, prompt, pillar || '',
        JSON.stringify(platforms), scheduled_for_date || null);

      // Dispatch image generation to the social agent
      _dispatchImageGen(jobId, prompt, platforms);

      dashLog?.('studio', `AI image requested: ${jobId}`);
      res.json({ ok: true, job_id: jobId, status: 'generating' });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Caption Post Creation ─────────────────────────────────
  app.post('/api/studio/generate-text', async (req, res) => {
    const { topic, pillar, platforms = getDefaultPlatforms(), scheduled_for_date } = req.body;
    if (!topic) return res.status(400).json({ error: 'Topic required' });

    const db = getVjDb();
    if (!db) return res.status(500).json({ error: 'Database unavailable' });

    const jobId = `social-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    try {
      db.prepare(`INSERT INTO video_jobs (job_id, topic, pillar, content_type, status, captions,
        platform_targets, scheduled_for_date, source, created_at, updated_at)
        VALUES (?, ?, ?, 'text_post', 'pending_review', '{"_pending":true}', ?, ?, 'studio', datetime('now'), datetime('now'))`).run(
        jobId, topic, pillar || '',
        JSON.stringify(platforms), scheduled_for_date || null);

      // Always dispatch caption generation for caption posts
      _dispatchCaptions(jobId, platforms, topic, null);

      dashLog?.('studio', `Caption post created: ${jobId}`);
      res.json({ ok: true, job_id: jobId });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Slide Video Creation ──────────────────────────────────
  const slideUpload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => {
        const dir = path.join(CLIENT_ROOT, 'content', 'slide-video', 'uploads');
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (_req, file, cb) => {
        cb(null, `slides-${Date.now()}${path.extname(file.originalname)}`);
      },
    }),
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const extOk = /\.(pdf|png|jpe?g|html?)$/i.test(path.extname(file.originalname));
      const SAFE_MIMES = ['image/png', 'image/jpeg', 'application/pdf', 'text/html', 'application/octet-stream'];
      const mimeOk = SAFE_MIMES.includes(file.mimetype);
      cb(null, extOk && mimeOk);
    },
  });

  app.post('/api/studio/slide-video', slideUpload.single('slides'), async (req, res) => {
    const db = getVjDb();
    if (!db) return res.status(500).json({ error: 'Database unavailable' });

    const topic = (req.body.topic || '').replace(/[^\w\s\-.,?!'"():;/&+@#%$—–]/g, '').slice(0, 500);
    const VALID_FORMATS = ['16:9', '9:16'];
    const format = VALID_FORMATS.includes(req.body.format) ? req.body.format : '16:9';
    const pillar = req.body.pillar || '';
    const platforms = (() => { try { return JSON.parse(req.body.platforms); } catch { return ['youtube']; } })();
    const jobId = `slide-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const jobDir = path.join(CLIENT_ROOT, 'content', 'slide-video', jobId);
    fs.mkdirSync(path.join(jobDir, 'slides'), { recursive: true });

    const meta = { type: 'slide_video_meta', format, stage: 'pending' };

    if (req.file) {
      // Uploaded file — PDF, HTML, or image
      meta.input_path = req.file.path;
      meta.input_type = path.extname(req.file.originalname).replace('.', '');
      meta.stage = 'uploaded';
    } else if (topic) {
      // Generate from topic — dispatch to copywriter
      meta.stage = 'generating';
    } else {
      return res.status(400).json({ error: 'Provide a topic or upload slides (PDF/HTML/images)' });
    }

    try {
      db.prepare(`INSERT INTO video_jobs (job_id, topic, pillar, content_type, status, script,
        platform_targets, source, created_at, updated_at)
        VALUES (?, ?, ?, 'slide_video', 'draft', ?, ?, 'studio', datetime('now'), datetime('now'))`).run(
        jobId, topic || `Slide video (uploaded ${meta.input_type || 'file'})`, pillar,
        JSON.stringify(meta), JSON.stringify(platforms));

      if (topic && !req.file) {
        _dispatchSlideGen(jobId, topic, format);
      }

      dashLog?.('studio', `Slide video created: ${jobId} (${req.file ? 'upload' : 'generate'})`);
      res.json({ ok: true, job_id: jobId, status: meta.stage });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/studio/slide-video/:jobId/status', validateJobId, (req, res) => {
    const db = getVjDb();
    if (!db) return res.status(500).json({ error: 'Database unavailable' });
    const row = db.prepare('SELECT status, script, failure_reason FROM video_jobs WHERE job_id = ?')
      .get(req.params.jobId);
    if (!row) return res.status(404).json({ error: 'Job not found' });
    let meta = {};
    try { meta = JSON.parse(row.script || '{}'); } catch {}
    res.json({ status: row.status, stage: meta.stage, failure_reason: row.failure_reason });
  });

  async function _dispatchSlideGen(jobId, topic, format) {
    const dims = format === '9:16' ? '1080x1920' : '1920x1080';
    try {
      await gateway.ensureConnected();
      await gateway.request('chat.send', {
        sessionKey: `agent:copywriter:slide-html-${jobId}`,
        message: [
          `Generate a branded HTML slide deck for a slide video about: ${topic}`,
          '',
          'REQUIREMENTS:',
          `- Use the CSS framework: /opt/AIWH/core/scripts/slide-video/slide-deck.css`,
          `- Each slide is a <div class="slide"> section, separated by <!-- PAGE --> markers`,
          `- Keep bottom-right 25% of each slide clear (avatar overlay zone)`,
          `- Target format: ${format} (${dims})`,
          '- Include a cover slide, content slides, and a CTA slide',
          '- Read client profile from your system prompt for brand voice and niche context',
          '',
          'Also write a voiceover script (one paragraph per slide, natural speaking tone).',
          '',
          `Save HTML to: /opt/AIWH/client/content/slide-video/${jobId}/slides.html`,
          `Save script to: /opt/AIWH/client/content/slide-video/${jobId}/script.txt`,
          `mkdir -p /opt/AIWH/client/content/slide-video/${jobId}`,
          '',
          `After saving, update the job:`,
          `python3 /opt/AIWH/core/scripts/lib/db-update.py /opt/AIWH/client/data/video-jobs.db update_field ${jobId} status html_generated`,
        ].join('\n'),
        idempotencyKey: `slide-${jobId}-${Date.now()}`,
      }, 180000);
    } catch (e) {
      console.error('[studio] Slide gen dispatch failed:', e.message);
      _markDispatchFailed(jobId, `Slide generation failed: ${e.message}`);
    }
  }

  // ─── Compositor Templates ──────────────────────────────────
  app.get('/api/studio/templates', (_req, res) => {
    const defaults = readJson(TEMPLATE_DEFAULTS, { templates: [] });
    const client = readJson(CLIENT_TEMPLATES, {});
    const templates = (defaults.templates || []).map(t => ({
      ...t,
      clientBrand: client.brand || null,
    }));
    res.json({
      templates,
      transition_styles: defaults.transition_styles || [],
      caption_styles: defaults.caption_styles || [],
      current_compositor: (() => {
        const p = readJson(PROVIDERS_PATH, {});
        return p.compositor?.provider || 'ffmpeg';
      })(),
    });
  });

  // ─── Render Status ─────────────────────────────────────────
  app.get('/api/studio/render-status/:jobId', validateJobId, (req, res) => {
    const db = getVjDb();
    if (!db) return res.status(500).json({ error: 'Database unavailable' });
    const row = db.prepare('SELECT status, failure_reason FROM video_jobs WHERE job_id = ?')
      .get(req.params.jobId);
    if (!row) return res.status(404).json({ error: 'Job not found' });
    res.json({ status: row.status, failure_reason: row.failure_reason });
  });

  // ─── Gateway dispatch helpers (use .request, not raw .send) ─
  function _loadCaptionStyle(platforms) {
    const policy = readJson(path.join(CLIENT_ROOT, 'config', 'client-policy.json'), {});
    const social = policy.social || {};
    const perPlat = social.caption_style_per_platform || {};
    const fallback = social.caption_style || '';
    return platforms.map(p => {
      const style = perPlat[p] || fallback;
      return style ? `${p}: ${style}` : '';
    }).filter(Boolean).join('\n');
  }

  async function _dispatchCaptions(jobId, platforms, topic, imagePath) {
    const styleGuide = _loadCaptionStyle(platforms);
    try {
      await gateway.ensureConnected();
      await gateway.request('chat.send', {
        sessionKey: `agent:copywriter:social-caption-${jobId}`,
        message: [
          `Generate per-platform captions for social content job ${jobId}.`,
          `Topic: ${topic}`,
          `Platforms: ${platforms.join(', ')}`,
          imagePath ? `Image file: ${imagePath} (describe it first using vision)` : '',
          styleGuide ? `CAPTION STYLE GUIDE (follow these rules strictly):\n${styleGuide}` : '',
          'Write captions as a JSON object with platform keys. Follow the style guide above for length and tone per platform.',
          '',
          'SAVE INSTRUCTIONS (follow exactly):',
          `echo '{"x":"your caption here"}' | python3 /opt/AIWH/core/scripts/lib/db-update.py /opt/AIWH/client/data/video-jobs.db update_field ${jobId} captions`,
          'Replace the example JSON with your actual captions. The JSON goes via stdin (piped with echo).',
          'Keys must be platform names only. Example: {"x":"short caption","instagram":"long storytelling caption"}',
          `Do NOT change the status field. Do NOT pass the JSON as a command-line argument.`,
        ].filter(Boolean).join('\n'),
        idempotencyKey: `caption-${jobId}-${Date.now()}`,
      }, 120000);
      console.log(`[studio] Caption dispatch OK for ${jobId}`);
    } catch (e) {
      console.error('[studio] Caption dispatch failed:', e.message);
      _markDispatchFailed(jobId, `Caption generation failed: ${e.message}`);
    }
  }

  async function _dispatchImageGen(jobId, prompt, platforms) {
    const styleGuide = _loadCaptionStyle(platforms);
    try {
      await gateway.ensureConnected();
      await gateway.request('chat.send', {
        sessionKey: `agent:social:studio-img-${jobId}`,
        message: [
          `Generate a social media image and write captions for job ${jobId}.`,
          `Image prompt: ${prompt}`,
          `Platforms: ${platforms.join(', ')}`,
          '',
          'STEP 1: Source environment',
          `. /opt/AIWH/core/scripts/lib/env.sh`,
          '',
          'STEP 2: Generate the image',
          `bash /opt/AIWH/core/scripts/generate-social-image.sh --job-id ${jobId}`,
          '',
          'STEP 3: Update the image path',
          `python3 /opt/AIWH/core/scripts/lib/db-update.py /opt/AIWH/client/data/video-jobs.db update_field ${jobId} image_path /opt/AIWH/client/content/social/instagram/images/${jobId}.png`,
          '',
          'STEP 4: Write per-platform captions based on the image you just generated',
          styleGuide ? `CAPTION STYLE GUIDE (follow strictly):\n${styleGuide}` : '',
          `Write captions as JSON object. Keys = platform names: ${platforms.join(', ')}`,
          `Save via stdin: echo \'{"${platforms[0]}":"your caption"}\' | python3 /opt/AIWH/core/scripts/lib/db-update.py /opt/AIWH/client/data/video-jobs.db update_field ${jobId} captions`,
          '',
          `Do NOT change the status field. It must stay as pending_review.`,
        ].filter(Boolean).join('\n'),
        idempotencyKey: `img-${jobId}-${Date.now()}`,
      }, 120000);
      console.log(`[studio] Image gen dispatch OK for ${jobId}`);
    } catch (e) {
      console.error('[studio] Image gen dispatch failed:', e.message);
      _markDispatchFailed(jobId, `Image generation failed: ${e.message}`);
    }
  }

  function _markDispatchFailed(jobId, reason) {
    try {
      const db = getVjDb();
      if (db) db.prepare(`UPDATE video_jobs SET failure_reason = ?, captions = NULL, updated_at = datetime('now') WHERE job_id = ?`).run(reason, jobId);
    } catch {}
  }
};
