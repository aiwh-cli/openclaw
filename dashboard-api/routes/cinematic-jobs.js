// ─── Routes: Cinematic Pipeline — Jobs (CRUD, state, analysis, clips) ────
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { CJOB_ID_RE, sanitizeForPrompt, spawnProducer } = require('../helpers/cinematic');

module.exports = function(app, deps) {
  const { db, io, cinematicSync, dashLog } = deps;

app.get('/api/cinematic/jobs', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 30, 100);
  const phase = req.query.phase || null;
  res.json({ jobs: cinematicSync.getJobs(limit, phase) });
});

app.get('/api/cinematic/pending-reviews', (req, res) => {
  res.json({ count: cinematicSync.getPendingReviewCount() });
});

app.get('/api/cinematic/jobs/:id', (req, res) => {
  const job = cinematicSync.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Not found' });
  const assets = cinematicSync.getAssets(req.params.id);
  res.json({ job, assets });
});

app.post('/api/cinematic/jobs', (req, res) => {
  // Handle both JSON and multipart/form-data
  const multer = require('multer');
  const upload = multer({ dest: '/tmp/cinematic-uploads/' });

  upload.fields([{ name: 'refs', maxCount: 10 }, { name: 'bgm', maxCount: 1 }])(req, res, (err) => {
    if (err) return res.status(400).json({ error: 'Upload failed: ' + err.message });

    const title = req.body.title;
    const brief = req.body.brief;
    const duration = parseInt(req.body.duration || req.body.duration_seconds) || 120;
    if (!title || !brief) return res.status(400).json({ error: 'Title and brief required' });

    const noAvatar = req.body.no_avatar === 'true' || req.body.no_avatar === true;
    const avatarLookId = noAvatar ? null : (req.body.avatar_look_id || null);
    const voiceId = req.body.voice_id || null;
    const outputFormat = req.body.output_format || '16:9';
    const captionsEnabled = parseInt(req.body.captions_enabled ?? req.body.include_captions) || 0;
    const captionPosition = req.body.caption_position || 'bottom';
    const captionStyle = req.body.caption_style || 'clean';
    const autoApproveRefs = parseInt(req.body.auto_approve_refs) || 0;
    const autoApproveKeyframes = parseInt(req.body.auto_approve_keyframes) || 0;
    const autoApproveClips = parseInt(req.body.auto_approve_clips) || 0;
    const autonomyThreshold = parseFloat(req.body.autonomy_threshold) || 4.0;
    const bgmVolume = parseFloat(req.body.bgm_volume) || 0.3;

    // Clip count is determined by analysis, not user input
    const cjobId = cinematicSync.createJob(title, brief, duration, 0, avatarLookId, voiceId, outputFormat, noAvatar, captionsEnabled, captionPosition, captionStyle, autoApproveRefs, autoApproveKeyframes, autoApproveClips, autonomyThreshold);
    if (!cjobId) return res.status(500).json({ error: 'Create failed' });

    // Save scheduling info (new columns)
    const platformTargets = req.body.platform_targets || '["instagram"]';
    const scheduledForDate = req.body.scheduled_for_date || null;
    try {
      const { getDb } = require('../db');
      const sdb = getDb();
      if (sdb) sdb.prepare('UPDATE cinematic_jobs SET platform_targets = ?, scheduled_for_date = ? WHERE cjob_id = ?').run(platformTargets, scheduledForDate, cjobId);
    } catch {}

    // Move uploaded BGM to job directory
    const bgmFiles = req.files?.bgm;
    if (bgmFiles && bgmFiles.length > 0) {
      const bgmDir = path.join((process.env.CLIENT_ROOT || '/opt/AIWH/client') + '/content/cinematic', cjobId, 'bgm');
      fs.mkdirSync(bgmDir, { recursive: true });
      const bgmDest = path.join(bgmDir, path.basename(bgmFiles[0].originalname));
      fs.renameSync(bgmFiles[0].path, bgmDest);
      // Update job with bgm_path and bgm_volume
      const { getDb } = require('../db');
      const localDb = getDb();
      if (localDb) {
        localDb.prepare('UPDATE cinematic_jobs SET bgm_path = ?, bgm_volume = ? WHERE cjob_id = ?').run(bgmDest, bgmVolume, cjobId);
      }
    }

    // Move uploaded refs to job directory
    const refFiles = req.files?.refs;
    if (refFiles && refFiles.length > 0) {
      const refDir = path.join((process.env.CLIENT_ROOT || '/opt/AIWH/client') + '/content/cinematic', cjobId, 'input-refs');
      fs.mkdirSync(refDir, { recursive: true });
      for (const file of refFiles) {
        const ext = path.extname(file.originalname) || '.png';
        const dest = path.join(refDir, path.basename(file.originalname));
        fs.renameSync(file.path, dest);
      }
    }

    // Flush WAL so the producer can see the new job immediately
    try {
      const Database = require('better-sqlite3');
      const CLIENT_ROOT = process.env.CLIENT_ROOT || '/opt/AIWH/client';
      const checkDb = new Database(path.join(CLIENT_ROOT, 'data', 'video-jobs.db'));
      checkDb.pragma('wal_checkpoint(TRUNCATE)');
      checkDb.close();
    } catch {}

    // Fire off the producer to start analysis
    spawnProducer('run', cjobId);

    dashLog('cinematic_created', `${cjobId} — ${title}`);
    res.json({ cjob_id: cjobId, phase: 'brief' });
  });
});

app.patch('/api/cinematic/assets/:id/review', (req, res) => {
  const { cjob_id, grade, action, notes } = req.body;
  if (!cjob_id || !grade) return res.status(400).json({ error: 'cjob_id and grade required' });
  const ok = cinematicSync.reviewAsset(req.params.id, cjob_id, grade, action || 'approve', notes || '');
  if (!ok) return res.status(500).json({ error: 'Review failed' });
  if (io) io.emit('cinematic_updated');
  res.json({ ok: true });
});

// Get ref analysis for a cinematic job
app.get('/api/cinematic/jobs/:id/ref-analysis', (req, res) => {
  if (!CJOB_ID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid job ID' });
  const CLIENT_ROOT = process.env.CLIENT_ROOT || '/opt/AIWH/client';
  const analysisPath = path.join(CLIENT_ROOT, 'content', 'cinematic', req.params.id, 'ref-analysis.json');
  try {
    if (fs.existsSync(analysisPath)) {
      res.json({ analysis: JSON.parse(fs.readFileSync(analysisPath, 'utf8')) });
    } else {
      res.json({ analysis: [] });
    }
  } catch { res.json({ analysis: [] }); }
});

// Update a single clip's prompts during review phases
app.patch('/api/cinematic/jobs/:id/clip/:clipIndex', (req, res) => {
  const cjobId = req.params.id;
  const clipIndex = parseInt(req.params.clipIndex);
  const updates = req.body; // { first_frame_prompt, last_frame_prompt, action_prompt, description, camera_motion }

  const job = cinematicSync.getJob(cjobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (!['keyframe_review', 'clip_review', 'analysis_review'].includes(job.phase)) {
    return res.status(400).json({ error: `Cannot edit clips in phase: ${job.phase}` });
  }

  try {
    const plan = JSON.parse(job.production_plan || '{}');
    const clips = plan.clips || [];
    if (clipIndex < 0 || clipIndex >= clips.length) {
      return res.status(400).json({ error: `Invalid clip index: ${clipIndex}` });
    }

    // Merge updates into clip
    const editableFields = ['first_frame_prompt', 'last_frame_prompt', 'action_prompt', 'description', 'camera_motion', 'narration_line'];
    for (const field of editableFields) {
      if (updates[field] !== undefined) clips[clipIndex][field] = updates[field];
    }

    plan.clips = clips;
    const now = new Date().toISOString();
    const CLIENT_ROOT = process.env.CLIENT_ROOT || '/opt/AIWH/client';
    const dbPath = path.join(CLIENT_ROOT, 'data', 'video-jobs.db');
    const pipeDb = new (require('better-sqlite3'))(dbPath);
    pipeDb.pragma('journal_mode = WAL');
    pipeDb.prepare('UPDATE cinematic_jobs SET production_plan=?, updated_at=? WHERE cjob_id=?')
      .run(JSON.stringify(plan), now, cjobId);
    pipeDb.close();

    // Also write to file if exists
    const planPath = path.join(CLIENT_ROOT, 'content', 'cinematic', cjobId, 'production-plan.json');
    if (fs.existsSync(path.dirname(planPath))) {
      fs.writeFileSync(planPath, JSON.stringify(plan, null, 2));
    }

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/cinematic/confidence', (req, res) => {
  res.json(cinematicSync.getConfidenceByType());
});

app.patch('/api/cinematic/jobs/:id/analysis', (req, res) => {
  const { style_bible, production_plan, narration_script } = req.body;
  if (!style_bible && !production_plan && !narration_script) {
    return res.status(400).json({ error: 'At least one field required: style_bible, production_plan, narration_script' });
  }

  const job = cinematicSync.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.phase !== 'analysis_review') {
    return res.status(400).json({ error: `Cannot edit analysis in phase: ${job.phase}` });
  }

  const ok = cinematicSync.updateAnalysis(
    req.params.id,
    style_bible || job.style_bible,
    production_plan || job.production_plan,
    narration_script || job.narration_script
  );

  if (!ok) return res.status(500).json({ error: 'Update failed' });
  if (io) io.emit('cinematic_updated');
  res.json({ ok: true });
});

// ─── Polish Narration via Copywriter Agent ──────────────────
app.post('/api/cinematic/jobs/:id/polish-narration', async (req, res) => {
  const cjobId = req.params.id;
  const job = cinematicSync.getJob(cjobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.phase !== 'analysis_review') {
    return res.status(400).json({ error: `Can only polish narration during analysis_review (current: ${job.phase})` });
  }

  const CLIENT_ROOT = process.env.CLIENT_ROOT || '/opt/AIWH/client';
  const dbPath = path.join(CLIENT_ROOT, 'data', 'video-jobs.db');

  // Parse production plan for clip context
  let clips = [];
  try {
    const plan = typeof job.production_plan === 'string' ? JSON.parse(job.production_plan) : job.production_plan;
    clips = plan?.clips || [];
  } catch {}

  // Parse style bible for tone
  let styleTone = '';
  try {
    const sb = typeof job.style_bible === 'string' ? JSON.parse(job.style_bible) : job.style_bible;
    if (sb?.tone) styleTone = `Tone: ${sb.tone}`;
    if (sb?.mood) styleTone += styleTone ? `, Mood: ${sb.mood}` : `Mood: ${sb.mood}`;
  } catch {}

  // Build knowledge context
  let knowledgeContext = '';
  try {
    const result = execFileSync(
      '/opt/AIWH/core/scripts/knowledge-search-unified.sh',
      ['--query', `${job.title || ''} narration script writing`, '--agent', 'copywriter', '--count', '5'],
      { timeout: 15000, encoding: 'utf8', env: { ...process.env } }
    ).trim();
    if (result) knowledgeContext = result;
  } catch {}

  const clipContext = clips.map((c, i) =>
    `Clip ${i + 1} (${c.duration_sec || 6}s, ${c.type || 'cinematic'}): ${c.description || ''}\n  Current narration: "${c.narration_line || ''}"`
  ).join('\n');

  const safeTitle = sanitizeForPrompt(job.title);
  const safeBrief = sanitizeForPrompt(job.brief);
  const safeNarration = sanitizeForPrompt(job.narration_script);

  const prompt = `You are polishing the narration script for a cinematic video production. Your goal is to make it sound natural, compelling, and perfectly timed.

**Title:** ${safeTitle || 'Untitled'}
**Duration:** ${job.target_duration_sec || 60} seconds
${styleTone ? `**Style:** ${styleTone}` : ''}

**Brief:**
${safeBrief || '(no brief)'}

**Clip Structure & Current Narration:**
${clipContext}

**Full Current Narration Script:**
${safeNarration || '(empty)'}

${knowledgeContext ? `**Learned Knowledge (from past productions):**\n${knowledgeContext}\n` : ''}

**Your task:**
1. Polish the narration to be conversational yet authoritative
2. Ensure each clip's narration_line fits its duration (~2.5 words/sec for ElevenLabs TTS)
3. Create natural flow between clips — the narration should feel like one cohesive story
4. Match the tone/mood from the style bible
5. Keep total word count proportional to duration (target: ${Math.round((job.target_duration_sec || 60) * 2.5)} words total)

**After polishing, save BOTH the full narration script AND updated per-clip narration lines:**
\`\`\`bash
sqlite3 "${dbPath}" "UPDATE cinematic_jobs SET narration_script='<YOUR_FULL_NARRATION>', updated_at='$(date -u +%Y-%m-%dT%H:%M:%SZ)' WHERE cjob_id='${cjobId}';"
\`\`\`

Also update the production_plan JSON to include your improved narration_line for each clip. Read the current plan, update narration_line values, and save:
\`\`\`bash
sqlite3 "${dbPath}" "UPDATE cinematic_jobs SET production_plan='<UPDATED_JSON>' WHERE cjob_id='${cjobId}';"
\`\`\`

Remember to escape single quotes by doubling them (it's → it''s).
Confirm once saved.`;

  try {
    const { client: gateway } = require('../gateway-ws');
    const sessionKey = `agent:copywriter:cinematic-${cjobId}`;
    await gateway.ensureConnected();
    gateway.request('chat.send', {
      sessionKey,
      message: prompt,
      deliver: false,
      idempotencyKey: `polish-${cjobId}-${Date.now()}`,
      attachments: [],
    }, 120000).catch(e => console.log('[polish-narration] chat.send error:', e.message));

    dashLog('cinematic_polish', `Copywriter polishing narration for ${cjobId}: ${job.title}`);
    res.json({ ok: true, message: 'Copywriter is polishing narration — will update in ~30-60 seconds' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/cinematic/jobs/:id/approve-phase', (req, res) => {
  const { grade, notes } = req.body;
  const ok = cinematicSync.approvePhase(req.params.id, grade || 4, notes || '');
  if (!ok) return res.status(500).json({ error: 'Approve failed' });

  // Fire producer to run next phase
  spawnProducer('run', req.params.id);

  if (io) io.emit('cinematic_updated');
  res.json({ ok: true });
});

app.post('/api/cinematic/jobs/:id/reject', (req, res) => {
  const { notes } = req.body;
  const ok = cinematicSync.rejectPhase(req.params.id, notes || '');
  if (!ok) return res.status(500).json({ error: 'Reject failed' });

  // Re-run producer to redo the phase
  spawnProducer('run', req.params.id);

  if (io) io.emit('cinematic_updated');
  res.json({ ok: true });
});

// Cancel generation — stops the producer and sets phase to cancelled
app.post('/api/cinematic/jobs/:id/cancel', (req, res) => {
  const cjobId = req.params.id;
  const job = cinematicSync.getJob(cjobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  // Kill producer process
  try {
    const pids = execFileSync('pgrep', ['-f', `cinematic-producer.*${cjobId}`],
      { encoding: 'utf8', timeout: 5000 }).trim();
    if (pids) {
      for (const pid of pids.split('\n').filter(Boolean)) {
        try { process.kill(parseInt(pid), 'SIGTERM'); } catch {}
      }
    }
  } catch {}
  // Set phase to cancelled
  const db = require('../db').getDb();
  if (db) db.prepare("UPDATE cinematic_jobs SET phase = 'cancelled', updated_at = datetime('now') WHERE cjob_id = ?").run(cjobId);
  if (io) io.emit('cinematic_updated');
  dashLog('cinematic_cancelled', `${cjobId} — stopped by client`);
  res.json({ ok: true });
});

app.delete('/api/cinematic/jobs/:id', (req, res) => {
  const cjobId = req.params.id;
  // Validate cjob ID format
  if (!CJOB_ID_RE.test(cjobId)) return res.status(400).json({ error: 'Invalid job ID format' });
  // Kill any running cinematic-producer process for this job before deleting
  try {
    const pids = execFileSync('pgrep', ['-f', `cinematic-producer.*${cjobId}`],
      { encoding: 'utf8', timeout: 5000 }).trim();
    if (pids) {
      for (const pid of pids.split('\n').filter(Boolean)) {
        try { process.kill(parseInt(pid), 'SIGTERM'); } catch {}
      }
      dashLog('cinematic_producer_killed', `Stopped running producer for ${cjobId} before delete`);
    }
  } catch {} // pgrep returns exit 1 if no match — expected
  const ok = cinematicSync.deleteJob(cjobId);
  if (!ok) return res.status(404).json({ error: 'Job not found' });
  if (io) io.emit('cinematic_updated');
  dashLog('cinematic_deleted', cjobId);
  res.json({ ok: true });
});

app.post('/api/cinematic/jobs/:id/advance', (req, res) => {
  const ok = cinematicSync.advanceGate(req.params.id);
  if (!ok) return res.status(400).json({ error: 'Cannot advance — no approved assets or wrong phase' });

  // Fire producer to run next phase
  spawnProducer('run', req.params.id);

  if (io) io.emit('cinematic_updated');
  res.json({ ok: true });
});

};
