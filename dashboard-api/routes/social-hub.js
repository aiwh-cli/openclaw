// ─── Routes: Social Strategy Hub — Aggregation Layer ──────────
// Theme S.c (Phase 2) — Unified calendar, pipeline, review, performance, settings
// Aggregates data from /api/social/* and /api/cinematic/* for the <social-hub> component
const fs = require('fs');
const path = require('path');

const CLIENT_ROOT = process.env.CLIENT_ROOT || '/opt/AIWH/client';
const POLICY_PATH = path.join(CLIENT_ROOT, 'config', 'client-policy.json');
const PILLARS_PATH = path.join(CLIENT_ROOT, 'config', 'content-pillars.json');
const METRICS_PATH = path.join(CLIENT_ROOT, 'data', 'social-metrics.json');
const VIDEO_DB_PATH = path.join(CLIENT_ROOT, 'data', 'video-jobs.db');
const PROVIDERS_PATH = path.join(CLIENT_ROOT, 'config', 'cinematic-providers.json');

function readJson(fp, fb) { try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return fb; } }
function writeJson(fp, d) { fs.writeFileSync(fp, JSON.stringify(d, null, 2) + '\n'); }
function safeJson(s) { try { return JSON.parse(s); } catch { return s; } }

module.exports = function(app, { db, io, cinematicSync, dashLog }) {
  const { client: gateway } = require('../gateway-ws');

  // ─── DB helper (WAL, shared with social.js) ─────────────────
  let vjDb = null;
  function getVjDb() {
    if (vjDb) return vjDb;
    try {
      const Database = require('better-sqlite3');
      vjDb = new Database(VIDEO_DB_PATH, { readonly: false });
      vjDb.pragma('journal_mode = WAL');
      return vjDb;
    } catch (e) {
      console.error('[social-hub] Cannot open video-jobs.db:', e.message);
      return null;
    }
  }

  // ─── Settings: Pipeline Config ──────────────────────────────
  app.get('/api/social-hub/settings/pipeline', (req, res) => {
    const policy = readJson(POLICY_PATH, {});
    res.json(policy.pipeline || {});
  });

  app.put('/api/social-hub/settings/pipeline', (req, res) => {
    const policy = readJson(POLICY_PATH, {});
    const p = req.body;
    if (!p || typeof p !== 'object') return res.status(400).json({ error: 'Invalid body' });

    // Validate and merge
    const cur = policy.pipeline || {};
    if (p.script_word_count) {
      const wc = p.script_word_count;
      if (typeof wc.min === 'number') cur.script_word_count = { ...cur.script_word_count, min: Math.max(50, Math.min(300, wc.min)) };
      if (typeof wc.max === 'number') cur.script_word_count = { ...cur.script_word_count, max: Math.max(50, Math.min(500, wc.max)) };
    }
    if (p.qa_thresholds) {
      const qt = p.qa_thresholds;
      cur.qa_thresholds = {
        min_duration: typeof qt.min_duration === 'number' ? Math.max(10, Math.min(300, qt.min_duration)) : (cur.qa_thresholds?.min_duration || 50),
        max_duration: typeof qt.max_duration === 'number' ? Math.max(10, Math.min(600, qt.max_duration)) : (cur.qa_thresholds?.max_duration || 70),
        min_file_size_mb: typeof qt.min_file_size_mb === 'number' ? Math.max(0.5, Math.min(100, qt.min_file_size_mb)) : (cur.qa_thresholds?.min_file_size_mb || 2),
      };
    }
    if (p.auto_approve_samples) {
      const as = p.auto_approve_samples;
      cur.auto_approve_samples = {
        text_post: typeof as.text_post === 'number' ? Math.max(5, Math.min(100, as.text_post)) : (cur.auto_approve_samples?.text_post || 15),
        image_post: typeof as.image_post === 'number' ? Math.max(5, Math.min(200, as.image_post)) : (cur.auto_approve_samples?.image_post || 30),
      };
    }
    if (p.cinematic_defaults && typeof p.cinematic_defaults === 'object') {
      cur.cinematic_defaults = { ...(cur.cinematic_defaults || {}), ...p.cinematic_defaults };
    }

    policy.pipeline = cur;
    writeJson(POLICY_PATH, policy);
    res.json({ ok: true, pipeline: cur });
  });

  app.get('/api/social-hub/settings/providers', (req, res) => {
    res.json(readJson(PROVIDERS_PATH, {}));
  });

  // ─── Settings: Social (proxy to existing data) ──────────────
  app.get('/api/social-hub/settings/social', (req, res) => {
    const policy = readJson(POLICY_PATH, {});
    res.json(policy.social || {});
  });

  app.get('/api/social-hub/settings/pillars', (req, res) => {
    res.json(readJson(PILLARS_PATH, { pillars: [] }));
  });

  app.put('/api/social-hub/settings/pillars', (req, res) => {
    const body = req.body;
    if (!body || !Array.isArray(body.pillars)) return res.status(400).json({ error: 'pillars array required' });
    const current = readJson(PILLARS_PATH, {});
    current.pillars = body.pillars.map(p => ({
      id: p.id || p.name?.toLowerCase().replace(/\s+/g, '-') || 'unnamed',
      name: p.name || 'Unnamed', description: p.description || '',
      hashtags: Array.isArray(p.hashtags) ? p.hashtags : [],
    }));
    if (body.target_platforms) current.target_platforms = body.target_platforms;
    if (body.posting_frequency) current.posting_frequency = body.posting_frequency;
    writeJson(PILLARS_PATH, current);
    dashLog?.('settings', `Updated ${current.pillars.length} pillars`);
    res.json({ ok: true });
  });

  app.put('/api/social-hub/settings/providers', (req, res) => {
    const body = req.body;
    if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Invalid body' });
    const current = readJson(PROVIDERS_PATH, {});
    const validSlots = ['video', 'image', 'avatar', 'tts', 'storage', 'notify', 'compositor'];
    for (const slot of validSlots) {
      if (body[slot]) {
        current[slot] = {
          provider: body[slot].provider || current[slot]?.provider || '',
          config: body[slot].config || current[slot]?.config || {},
        };
      }
    }
    writeJson(PROVIDERS_PATH, current);
    dashLog?.('settings', `Updated providers config`);
    res.json({ ok: true });
  });

  app.put('/api/social-hub/settings/remotion-templates', (req, res) => {
    const body = req.body;
    if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Invalid body' });
    const tmplPath = path.join(CLIENT_ROOT, 'config', 'remotion-templates.json');
    const current = readJson(tmplPath, {});
    if (body.brand) current.brand = body.brand;
    if (body.transition_style) current.transition_style = body.transition_style;
    if (body.transition_frames) current.transition_frames = body.transition_frames;
    writeJson(tmplPath, current);
    res.json({ ok: true });
  });

  // ─── Google Vertex AI health check ────────────────────────
  app.get('/api/social-hub/settings/vertex-health', (_req, res) => {
    try {
      const { execFileSync } = require('child_process');
      const r = execFileSync('python3', ['-c',
        'import os,json,urllib.request as u,urllib.parse as p;c=json.load(open(os.path.expanduser("~/.config/gcloud/application_default_credentials.json")));d=p.urlencode({"grant_type":"refresh_token","refresh_token":c["refresh_token"],"client_id":c["client_id"],"client_secret":c["client_secret"]}).encode();print("ok" if json.loads(u.urlopen(u.Request("https://oauth2.googleapis.com/token",d,{"Content-Type":"application/x-www-form-urlencoded"}),timeout=10).read()).get("access_token") else "fail")'
      ], { timeout: 15000, env: { ...process.env, PATH: `/opt/homebrew/bin:${process.env.PATH}` } }).toString().trim();
      res.json({ ok: r === 'ok' });
    } catch { res.json({ ok: false }); }
  });

  // ─── Unified Calendar ───────────────────────────────────────
  app.get('/api/social-hub/calendar', (req, res) => {
    const vdb = getVjDb();
    const pillars = readJson(PILLARS_PATH, { pillars: [], target_platforms: [] });
    if (!vdb) return res.json({ items: [], pillars: pillars.pillars, target_platforms: pillars.target_platforms || [] });

    try {
      const socialRows = vdb.prepare(`
        SELECT job_id, topic, pillar, status, content_type, captions, image_path,
               scheduled_for_date, scheduled_time, created_at, platform_targets, 'social' as source
        FROM video_jobs
        WHERE created_at >= datetime('now', '-14 days')
              AND status NOT IN ('rejected', 'failed', 'skipped')
        ORDER BY created_at DESC LIMIT 150
      `).all();

      const cinematicRows = vdb.prepare(`
        SELECT cjob_id as job_id, title as topic, NULL as pillar,
               CASE
                 WHEN phase IN ('brief','analyzing','analysis_review') THEN 'draft'
                 WHEN phase IN ('ref_images','ref_review','keyframes','keyframe_review',
                                'video_clips','clip_review','narration','assembly') THEN 'generating'
                 WHEN phase IN ('qa','final_review') THEN 'pending_review'
                 WHEN phase = 'approved' THEN 'approved'
                 WHEN phase = 'published' THEN 'posted'
                 WHEN phase IN ('failed','cancelled') THEN 'failed'
                 ELSE phase
               END as status,
               'cinematic' as content_type,
               caption as captions, NULL as image_path,
               date(created_at) as scheduled_for_date, NULL as scheduled_time,
               created_at, NULL as platform_targets, 'cinematic' as source
        FROM cinematic_jobs
        WHERE created_at >= datetime('now', '-30 days')
        ORDER BY created_at DESC LIMIT 50
      `).all();

      const items = [...socialRows, ...cinematicRows]
        .map(r => ({ ...r, captions: r.captions ? safeJson(r.captions) : null }))
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      // Filter
      const { platform, pillar, content_type, status } = req.query;
      let filtered = items;
      if (content_type) filtered = filtered.filter(i => i.content_type === content_type);
      if (status === 'published') {
        // Calendar default: show posted + scheduled + planned (the content calendar)
        filtered = filtered.filter(i => ['posted', 'scheduled', 'planned', 'approved'].includes(i.status));
      } else if (status) {
        filtered = filtered.filter(i => i.status === status);
      }
      if (pillar) filtered = filtered.filter(i => i.pillar === pillar);
      if (platform) filtered = filtered.filter(i => {
        const pt = i.platform_targets;
        if (!pt) return false;
        const arr = typeof pt === 'string' ? safeJson(pt) : pt;
        return Array.isArray(arr) && arr.includes(platform);
      });

      res.json({ items: filtered, pillars: pillars.pillars, target_platforms: pillars.target_platforms || [], platform_formats: pillars.platform_formats || {} });
    } catch (e) {
      console.error('[social-hub] calendar error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Pipeline (Video Jobs — daily content pipeline) ──────────
  app.get('/api/social-hub/pipeline', (req, res) => {
    const vdb = getVjDb();
    if (!vdb) return res.json({ jobs: [] });

    try {
      const jobs = vdb.prepare(`
        SELECT job_id, topic, pillar, status, content_type, priority,
               failure_reason, last_failed_stage, retry_count,
               created_at, updated_at
        FROM video_jobs
        WHERE content_type = 'video_reel'
        ORDER BY
          CASE WHEN status IN ('posted','failed','rejected') THEN 1 ELSE 0 END,
          updated_at DESC
        LIMIT 100
      `).all();
      res.json({ jobs });
    } catch (e) {
      console.error('[social-hub] pipeline error:', e.message);
      res.json({ jobs: [] });
    }
  });

  // ─── Review Queue (Unified) ─────────────────────────────────
  app.get('/api/social-hub/review-queue', (req, res) => {
    const vdb = getVjDb();
    if (!vdb) return res.json({ items: [] });

    try {
      const socialItems = vdb.prepare(`
        SELECT job_id, topic, pillar, status, content_type, captions, image_path,
               retry_count, grade, grade_notes, failure_reason, created_at, 'social' as source
        FROM video_jobs WHERE status IN ('pending_review', 'approved', 'captioning', 'captioned')
              AND content_type != 'video_reel'
        ORDER BY created_at DESC LIMIT 50
      `).all();

      const cinematicItems = vdb.prepare(`
        SELECT cjob_id as job_id, title as topic, NULL as pillar,
               phase as status, 'cinematic' as content_type,
               caption as captions, NULL as image_path,
               0 as retry_count, final_grade as grade, final_notes as grade_notes,
               created_at, 'cinematic' as source
        FROM cinematic_jobs
        WHERE phase IN ('analysis_review', 'ref_review', 'keyframe_review', 'clip_review', 'final_review', 'approved')
        ORDER BY updated_at DESC LIMIT 20
      `).all();

      const items = [...socialItems, ...cinematicItems]
        .map(r => ({ ...r, captions: r.captions ? safeJson(r.captions) : null }))
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      res.json({ items });
    } catch (e) {
      console.error('[social-hub] review-queue error:', e.message);
      res.json({ items: [] });
    }
  });

  // ─── Cinematic social captions (copywriter generates from narration)
  app.post('/api/social-hub/cinematic-captions/:jobId', async (req, res) => {
    const { jobId } = req.params; const { platforms = ['instagram', 'x'] } = req.body;
    const vdb = getVjDb(); if (!vdb) return res.status(500).json({ error: 'DB unavailable' });
    const job = vdb.prepare('SELECT title, narration_script FROM cinematic_jobs WHERE cjob_id = ?').get(jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const policy = readJson(POLICY_PATH, {}); const social = policy.social || {};
    const perPlat = social.caption_style_per_platform || {};
    const style = platforms.map(p => perPlat[p] ? `${p}: ${perPlat[p]}` : '').filter(Boolean).join('\n') || social.caption_style || '';
    try {
      await gateway.ensureConnected();
      await gateway.request('chat.send', { sessionKey: `agent:copywriter:cinematic-caption-${jobId}`,
        message: `Generate social captions for cinematic video ${jobId}.\nTitle: ${job.title}\nNarration:\n${(job.narration_script||'').slice(0,2000)}\nPlatforms: ${platforms.join(', ')}\n${style ? 'STYLE GUIDE:\n'+style : ''}\nWrite as JSON. Save: echo '<json>' | python3 /opt/AIWH/core/scripts/lib/db-update.py /opt/AIWH/client/data/video-jobs.db update_field ${jobId} caption\nDo NOT change the phase.`,
        idempotencyKey: `cin-cap-${jobId}-${Date.now()}` }, 120000);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: 'Caption dispatch failed: ' + e.message }); }
  });

  // ─── Publish (Dispatch to Social Agent) ─────────────────────
  app.post('/api/social-hub/publish/:jobId', async (req, res) => {
    const { jobId } = req.params;
    const { source, platforms, captions } = req.body;
    let scheduledAt = req.body.scheduledAt || null;
    if (!platforms || !platforms.length) return res.status(400).json({ error: 'No platforms selected' });

    // Look up the job to build a content-type-aware dispatch message
    const vdb = getVjDb();
    let contentType = 'unknown';
    let mediaPath = '';
    let dbTable = 'video_jobs';
    let dbIdCol = 'job_id';
    let dbStatusCol = 'status';
    let dbStatusVal = 'scheduled';

    if (source === 'cinematic') {
      dbTable = 'cinematic_jobs';
      dbIdCol = 'cjob_id';
      dbStatusCol = 'phase';
      dbStatusVal = 'published';
      contentType = 'cinematic_video';
      mediaPath = `/opt/AIWH/client/content/cinematic/${jobId}/output/final.mp4`;
      // Pre-check: don't re-publish
      if (vdb) {
        const cj = vdb.prepare('SELECT phase FROM cinematic_jobs WHERE cjob_id = ?').get(jobId);
        if (!cj) return res.status(404).json({ error: 'Job not found' });
        // Note: cinematic 'published' means pipeline complete, not posted to Buffer
        // Allow publishing to Buffer from any completed phase
      }
    } else if (vdb) {
      const job = vdb.prepare('SELECT content_type, status, image_path, captioned_video_path, avatar_video_path, scheduled_for_date, scheduled_time FROM video_jobs WHERE job_id = ?').get(jobId);
      if (!job) return res.status(404).json({ error: 'Job not found' });
      if (job.status === 'posted') return res.status(400).json({ error: 'Already published' });
      contentType = job.content_type || 'text_post';
      // Use scheduled date from DB if frontend didn't provide one
      if (!scheduledAt && job.scheduled_for_date) {
        scheduledAt = job.scheduled_time || `${job.scheduled_for_date}T09:00:00Z`;
      }
      if (contentType === 'image_post') {
        // Per-platform image selection from image_paths JSON
        mediaPath = job.image_path || '';
        try {
          const { resolveFormat } = require('../helpers/format-resolver');
          const imagePaths = JSON.parse(job.image_paths || '{}');
          if (Object.keys(imagePaths).length > 0) {
            // Attach per-platform media paths for the dispatch message
            req._perPlatformMedia = {};
            for (const plat of platforms) {
              const ratio = resolveFormat(plat, 'image_post');
              if (ratio && imagePaths[ratio]) req._perPlatformMedia[plat] = imagePaths[ratio];
              else if (mediaPath) req._perPlatformMedia[plat] = mediaPath;
            }
          }
        } catch {}
      } else if (contentType === 'video_reel') {
        mediaPath = job.captioned_video_path || job.avatar_video_path || '';
      }
    }

    const sessionKey = `agent:social:publish-${jobId}-${Date.now()}`;
    const platList = platforms.map(p => {
      const cap = (typeof captions === 'object' && captions[p]) || '';
      return `- ${p}: ${cap.slice(0, 500)}`;
    }).join('\n');

    // Upload media to storage provider if needed (get public URL for Buffer)
    let mediaUrl = '';
    let perPlatformUrls = {};
    const { uploadMedia } = require('../helpers/media-upload');

    if (req._perPlatformMedia && Object.keys(req._perPlatformMedia).length > 0) {
      // Per-platform images (different ratios per platform)
      const seen = {};  // path -> url (dedup uploads)
      for (const [plat, path] of Object.entries(req._perPlatformMedia)) {
        if (seen[path]) { perPlatformUrls[plat] = seen[path]; continue; }
        const upload = uploadMedia(path);
        if (upload.ok) { perPlatformUrls[plat] = upload.url; seen[path] = upload.url; }
      }
      mediaUrl = Object.values(perPlatformUrls)[0] || '';
    } else if (mediaPath) {
      const upload = uploadMedia(mediaPath);
      if (!upload.ok) return res.status(400).json({ error: upload.error || 'Media upload failed' });
      mediaUrl = upload.url;
    }

    // Build content-type-specific instructions
    let mediaLine;
    if (Object.keys(perPlatformUrls).length > 1) {
      const lines = Object.entries(perPlatformUrls).map(([p, u]) => `  ${p}: ${u}`).join('\n');
      mediaLine = `MEDIA URLS (per-platform, different ratios):\n${lines}\nUse the correct URL for each platform's createPost call.`;
    } else if (mediaUrl) {
      mediaLine = `MEDIA URL: ${mediaUrl} (use this public URL in the Buffer createPost assets field)`;
    } else {
      mediaLine = 'MEDIA: None (text-only post)';
    }

    const message = [
      `Publish content to social media via Buffer.`,
      ``,
      `JOB_ID: ${jobId}`,
      `CONTENT TYPE: ${contentType}`,
      `SCHEDULED_AT: ${scheduledAt || 'next available slot'}`,
      `${mediaLine}`,
      ``,
      `PLATFORMS AND CAPTIONS:`,
      platList,
      ``,
      `Steps:`,
      `1. Source env: . /opt/AIWH/core/scripts/lib/env.sh`,
      `2. Load secrets: aiwh_load_secrets BUFFER_API_TOKEN BUFFER_IG_CHANNEL_ID BUFFER_X_CHANNEL_ID`,
      `3. Read your Buffer SKILL.md for the ShareMode and SchedulingType reference`,
      `4. Use schedulingType "automatic" and mode "${scheduledAt ? 'customScheduled' : 'shareNext'}"${scheduledAt ? ` with dueAt "${scheduledAt}"` : ' (next available slot)'}`,
      `5. Schedule each platform post via Buffer GraphQL createPost mutation`,
      contentType === 'image_post'
        ? `6. For Instagram: use metadata {"instagram":{"type":"post","shouldShareToFeed":true}} (NOT "reel"). Include the platform's MEDIA URL in the assets images array.`
        : contentType === 'video_reel'
          ? `6. For Instagram: use metadata {"instagram":{"type":"reel","shouldShareToFeed":true}}. Include MEDIA URL in assets videos array.`
          : `6. Skip media (text-only post).`,
      `7. Confirm the result with the job_id and platform URLs.`,
      `Note: the database is updated automatically by the dashboard — do NOT update status/phase yourself.`,
    ].join('\n');

    try {
      await gateway.ensureConnected();
      const result = await gateway.request('chat.send', {
        sessionKey,
        message,
        idempotencyKey: `publish-${jobId}-${Date.now()}`,
      }, 120000);
      // Update DB immediately (don't rely on agent to do it)
      try {
        if (source === 'cinematic') {
          vdb.prepare("UPDATE cinematic_jobs SET phase = 'published', updated_at = datetime('now') WHERE cjob_id = ?").run(jobId);
        } else {
          vdb.prepare("UPDATE video_jobs SET status = 'scheduled', updated_at = datetime('now') WHERE job_id = ?").run(jobId);
        }
      } catch {}
      dashLog('social_publish_dispatched', `Job ${jobId} (${contentType}) publish dispatched`);
      res.json({ ok: true, sessionKey, result });
    } catch (e) {
      console.error('[social-hub] publish dispatch error:', e.message);
      res.status(500).json({ error: 'Failed to dispatch publish: ' + e.message });
    }
  });

  // ─── Performance (Combined Metrics) ─────────────────────────
  app.get('/api/social-hub/performance', (req, res) => {
    const vdb = getVjDb();
    const metrics = readJson(METRICS_PATH, null);
    const pillars = readJson(PILLARS_PATH, { target_platforms: [] });

    const socialConfidence = {};
    if (vdb) {
      for (const ct of ['text_post', 'image_post']) {
        try {
          const row = vdb.prepare('SELECT COUNT(*) as count, AVG(grade) as avg FROM social_grades WHERE content_type = ?').get(ct);
          socialConfidence[ct] = { count: row?.count || 0, avgGrade: Math.round((row?.avg || 0) * 100) / 100 };
        } catch { socialConfidence[ct] = { count: 0, avgGrade: 0 }; }
      }
    }

    let cinematicConfidence = {};
    try { cinematicConfidence = cinematicSync.getConfidenceByType(); } catch { /* no data */ }

    res.json({
      metrics: metrics || { status: 'no_data' },
      socialConfidence,
      cinematicConfidence,
      platforms: pillars.target_platforms || [],
      recommendations: metrics?.recommendations || [],
    });
  });
};
