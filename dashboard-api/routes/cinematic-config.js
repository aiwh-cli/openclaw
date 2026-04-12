// ─── Routes: Cinematic Pipeline — Config (avatar, voice, HeyGen) ─────
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { getSecret } = require('../helpers/secret-loader');
const { sanitizeForPrompt } = require('../helpers/cinematic');

module.exports = function(app, deps) {
  const { db, io, cinematicSync, dashLog } = deps;

// ─── Avatar Config ───────────────────────────────────────────

app.get('/api/cinematic/avatar-config', (req, res) => {
  const configPath = (process.env.CLIENT_ROOT || '/opt/AIWH/client') + '/config/avatar-config.json';
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    res.json(config);
  } catch (e) {
    res.json({ pillars: {}, default_avatar_id: '' });
  }
});

app.put('/api/cinematic/avatar-config', (req, res) => {
  const configPath = (process.env.CLIENT_ROOT || '/opt/AIWH/client') + '/config/avatar-config.json';
  try {
    const current = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const updates = req.body;
    // Merge: update pillars, default_avatar_id, default_voice_id
    if (updates.pillars) current.pillars = updates.pillars;
    if (updates.default_avatar_id !== undefined) current.default_avatar_id = updates.default_avatar_id;
    if (updates.default_voice_id !== undefined) current.default_voice_id = updates.default_voice_id;
    fs.writeFileSync(configPath, JSON.stringify(current, null, 2) + '\n');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Update a single avatar pillar
app.put('/api/cinematic/avatar-config/:pillarId', (req, res) => {
  const pid = req.params.pillarId;
  if (!pid || /^(__proto__|constructor|prototype)$/.test(pid)) return res.status(400).json({ error: 'Invalid pillar ID' });
  const configPath = (process.env.CLIENT_ROOT || '/opt/AIWH/client') + '/config/avatar-config.json';
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const { name, display_name, description, avatar_look_id, look_number, resolution, photo_url } = req.body;
    if (!config.pillars[pid]) {
      config.pillars[pid] = {};
    }
    const p = config.pillars[pid];
    if (name !== undefined) p.name = name;
    if (display_name !== undefined) p.display_name = display_name;
    if (description !== undefined) p.description = description;
    if (avatar_look_id !== undefined) p.avatar_look_id = avatar_look_id;
    if (look_number !== undefined) p.look_number = look_number;
    if (resolution !== undefined) p.resolution = resolution;
    if (photo_url !== undefined) p.photo_url = photo_url;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Delete an avatar pillar
app.delete('/api/cinematic/avatar-config/:pillarId', (req, res) => {
  const pid = req.params.pillarId;
  if (!pid || /^(__proto__|constructor|prototype)$/.test(pid)) return res.status(400).json({ error: 'Invalid pillar ID' });
  const configPath = (process.env.CLIENT_ROOT || '/opt/AIWH/client') + '/config/avatar-config.json';
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    delete config.pillars[pid];
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Voice Config ────────────────────────────────────────────

let _voiceConfigCache = { data: null, ts: 0 };

// Update voice config
app.put('/api/cinematic/voice-config', (req, res) => {
  const configPath = (process.env.CLIENT_ROOT || '/opt/AIWH/client') + '/config/voice-config.json';
  try {
    const current = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (req.body.voices !== undefined) current.voices = req.body.voices;
    if (req.body.default_voice_id !== undefined) current.default_voice_id = req.body.default_voice_id;
    fs.writeFileSync(configPath, JSON.stringify(current, null, 2) + '\n');
    _voiceConfigCache = { data: null, ts: 0 }; // bust cache
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/cinematic/voice-config', (req, res) => {
  if (_voiceConfigCache.data && Date.now() - _voiceConfigCache.ts < 3600000) {
    return res.json(_voiceConfigCache.data);
  }
  const configPath = (process.env.CLIENT_ROOT || '/opt/AIWH/client') + '/config/voice-config.json';
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    _voiceConfigCache = { data: config, ts: Date.now() };
    res.json(config);
  } catch (e) {
    res.json({ voices: [], default_voice_id: '' });
  }
});

// Voice preview — generate a short TTS sample via ElevenLabs
app.get('/api/cinematic/voice-preview/:voiceId', async (req, res) => {
  // Validate voiceId format (ElevenLabs uses alphanumeric IDs)
  if (!/^[a-zA-Z0-9]{10,30}$/.test(req.params.voiceId)) {
    return res.status(400).json({ error: 'Invalid voice ID format' });
  }
  const elevenKey = getSecret('ELEVENLABS_API_KEY');
  if (!elevenKey) return res.status(500).json({ error: 'ElevenLabs key not configured' });

  try {
    const https = require('https');
    const postData = JSON.stringify({
      text: 'Welcome to your cinematic production. This is a preview of how your narration will sound.',
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.5, similarity_boost: 0.75 }
    });
    const options = {
      hostname: 'api.elevenlabs.io',
      path: `/v1/text-to-speech/${req.params.voiceId}`,
      method: 'POST',
      headers: { 'xi-api-key': elevenKey, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
    };
    const proxyReq = https.request(options, (proxyRes) => {
      if (proxyRes.statusCode !== 200) return res.status(proxyRes.statusCode).send('Preview failed');
      res.setHeader('Content-Type', 'audio/mpeg');
      proxyRes.pipe(res);
    });
    proxyReq.on('error', () => res.status(500).send('Preview failed'));
    proxyReq.write(postData);
    proxyReq.end();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── HeyGen Avatars ──────────────────────────────────────────

let _heygenCache = { data: null, ts: 0 };
const HEYGEN_CACHE_TTL = 3600000; // 1 hour

app.get('/api/cinematic/heygen-avatars', (req, res) => {
  // Return cached if fresh
  if (_heygenCache.data && Date.now() - _heygenCache.ts < HEYGEN_CACHE_TTL) {
    return res.json(_heygenCache.data);
  }

  const heygenKey = getSecret('HEYGEN_API_KEY');
  if (!heygenKey) return res.json({ avatars: [] });

  let sent = false;
  const reply = (data) => { if (!sent) { sent = true; _heygenCache = { data, ts: Date.now() }; res.json(data); } };

  const https = require('https');
  const r = https.get('https://api.heygen.com/v2/avatars', {
    headers: { 'X-Api-Key': heygenKey, 'Accept': 'application/json' }
  }, (response) => {
    let data = '';
    response.on('data', chunk => data += chunk);
    response.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        const avatars = (parsed.data || {}).avatars || [];
        reply({ avatars: avatars.slice(0, 50).map(a => ({
          avatar_id: a.avatar_id,
          avatar_name: a.avatar_name,
          preview_image_url: a.preview_image_url || '',
          preview_video_url: a.preview_video_url || ''
        }))});
      } catch (e) {
        reply({ avatars: [] });
      }
    });
  });
  r.on('error', () => reply({ avatars: [] }));
  r.setTimeout(8000, () => { r.destroy(); reply({ avatars: [] }); });
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

// ─── Static Asset Serving ────────────────────────────────────

// Serve cinematic asset files (images/videos) for preview
app.get('/cinematic-asset/:assetId', (req, res) => {
  const filePath = cinematicSync.getAssetFilePath(req.params.assetId);
  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).send('Asset not found');
  }
  res.sendFile(filePath);
});

// List uploaded reference images for a job
app.get('/api/cinematic/jobs/:id/input-refs', (req, res) => {
  if (!CJOB_ID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid job ID' });
  const refDir = path.join((process.env.CLIENT_ROOT || '/opt/AIWH/client') + '/content/cinematic', req.params.id, 'input-refs');
  if (!fs.existsSync(refDir)) return res.json({ images: [] });
  const images = fs.readdirSync(refDir)
    .filter(f => /\.(png|jpe?g|gif|webp)$/i.test(f))
    .map(f => ({ filename: f, url: `/cinematic-input-ref/${req.params.id}/${f}` }));
  res.json({ images });
});

// Serve an individual uploaded reference image
app.get('/cinematic-input-ref/:cjobId/:filename', (req, res) => {
  // Sanitize filename to prevent path traversal
  const safeFilename = path.basename(req.params.filename);
  const CLIENT_ROOT = process.env.CLIENT_ROOT || '/opt/AIWH/client';
  const filePath = path.join(CLIENT_ROOT, 'content', 'cinematic', req.params.cjobId, 'input-refs', safeFilename);
  const resolvedPath = path.resolve(filePath);
  const allowedPrefix = path.resolve(path.join(CLIENT_ROOT, 'content', 'cinematic'));
  if (!resolvedPath.startsWith(allowedPrefix + '/')) return res.status(403).send('Forbidden');
  if (!fs.existsSync(resolvedPath)) return res.status(404).send('Image not found');
  res.sendFile(resolvedPath);
});

app.get('/cinematic-final/:cjobId', (req, res) => {
  const filePath = cinematicSync.getFinalVideoPath(req.params.cjobId);
  if (!filePath) return res.status(404).send('Final video not found');
  res.sendFile(filePath);
});

};
