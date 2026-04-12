// ─── Routes: Content (Video Pipeline) ────────────────────────
const fs = require('fs');
const path = require('path');

module.exports = function(app, deps) {
  const { db, io, contentSync, adapter, dashLog } = deps;

// JobId format validation middleware
const JOB_ID_RE = /^((job_|cjob_|social-|video-)[a-zA-Z0-9_-]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
function validateJobId(req, res, next) {
  if (!JOB_ID_RE.test(req.params.jobId)) {
    return res.status(400).json({ error: 'Invalid job ID format' });
  }
  next();
}

// Rate limiter for pipeline trigger (1 call per 30s)
let _lastPipelineTrigger = 0;
const PIPELINE_COOLDOWN_MS = 30000;

app.get('/api/content/summary', (req, res) => {
  res.json(contentSync.getContentSummary());
});

app.get('/api/content/jobs', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 30, 100);
  const status = req.query.status || null;
  res.json(contentSync.getJobs(limit, status));
});

app.get('/api/content/stats', (req, res) => {
  const stats = contentSync.getPipelineStats();
  const topics = contentSync.getTopicsRemaining();
  const today = contentSync.getTodayJob();
  res.json({ ...stats, topicsRemaining: topics, todayJob: today });
});

app.get('/api/content/jobs/:jobId', validateJobId, (req, res) => {
  const job = contentSync.getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Not found' });
  res.json(job);
});

app.patch('/api/content/jobs/:jobId', validateJobId, (req, res) => {
  const result = contentSync.updateJob(req.params.jobId, req.body);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

app.delete('/api/content/jobs/:jobId', validateJobId, (req, res) => {
  const result = contentSync.deleteJob(req.params.jobId);
  if (result.error) return res.status(result.error === 'Job not found' ? 404 : 400).json(result);
  dashLog('content_deleted', req.params.jobId);
  res.json(result);
});

// ─── Prompt Sanitization ──────────────────────────────────────
// Strip control characters and injection patterns from user-editable fields
// before they're interpolated into LLM prompts
function sanitizeForPrompt(text) {
  if (!text || typeof text !== 'string') return text || '';
  return text
    // Remove control characters (except newlines and tabs)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    // Collapse sequences of backticks that could form code blocks
    .replace(/`{3,}/g, '``')
    // Remove lines that look like system/instruction overrides
    .replace(/^(SYSTEM|INSTRUCTION|IGNORE|OVERRIDE|FORGET|DISREGARD)\s*:/gmi, '[FILTERED]:')
    // Remove shell command patterns that shouldn't appear in topics/hooks
    .replace(/\$\([^)]*\)/g, '[FILTERED]')
    .replace(/`[^`]*`/g, function(match) {
      // Allow short inline code (less than 50 chars, no dangerous commands)
      if (match.length < 50 && !/\b(curl|wget|rm|cat|bash|sh|python|sqlite3|eval|exec)\b/i.test(match)) return match;
      return '[FILTERED]';
    });
}

// ─── Standard Pipeline Processing ─────────────────────────────
// Helper: trigger copywriter via OpenClaw gateway for a planned job
async function triggerCopywriter(jobId) {
  const job = contentSync.getJob(jobId);
  if (!job) throw new Error('Job not found');

  const CLIENT_ROOT = process.env.CLIENT_ROOT || '/opt/AIWH/client';
  const dbPath = path.join(CLIENT_ROOT, 'data', 'video-jobs.db');

  // Run knowledge search for the topic (server-side, included in brief)
  let knowledgeContext = '';
  try {
    const { execFileSync } = require('child_process');
    const result = execFileSync(
      '/opt/AIWH/core/scripts/knowledge-search-unified.sh',
      ['--query', job.topic, '--agent', 'copywriter', '--count', '5'],
      { timeout: 15000, encoding: 'utf8', env: { ...process.env } }
    ).trim();
    if (result) knowledgeContext = result;
  } catch (e) {
    console.log('[copywriter] knowledge search failed (non-fatal):', e.message);
  }

  // Build the brief
  const isRetry = !!job.failure_reason;

  // Determine target platforms (default both if not set)
  let platforms = ['instagram', 'x'];
  try {
    const pt = JSON.parse(job.platform_targets || '[]');
    if (Array.isArray(pt) && pt.length > 0) platforms = pt;
  } catch {}
  const wantIG = platforms.includes('instagram');
  const wantX = platforms.includes('x');
  const dualCaption = wantIG && wantX;

  let captionRequirements;
  if (dualCaption) {
    captionRequirements = `2. Write TWO platform-specific captions, separated by a line containing only \`---X---\`:
   **Instagram caption** (FIRST): 1-2 punchy lines + 5-8 niche hashtags + soft CTA. Max 220 characters.
   **X/Twitter caption** (AFTER the ---X--- separator): Conversational, no hashtags, punchy. Max 280 characters. Shorter is better — aim for 180-220 chars.
   Format example:
   Your IG caption here #Hashtag1 #Hashtag2
   Save this for later 🔥

   ---X---

   Your X caption here — conversational, no hashtags, under 280 chars.`;
  } else if (wantX) {
    captionRequirements = `2. Write an X/Twitter caption: Conversational, no hashtags, punchy. Max 280 characters. Shorter is better — aim for 180-220 chars.`;
  } else {
    captionRequirements = `2. Write an Instagram caption: 1-2 punchy lines + 5-8 niche hashtags + soft CTA. Max 220 characters.`;
  }

  // Sanitize user-editable fields before prompt injection
  const safeTopic = sanitizeForPrompt(job.topic);
  const safeHook = sanitizeForPrompt(job.hook);
  const safeFailureReason = sanitizeForPrompt(job.failure_reason);

  const prompt = `You have a video script writing task. Write a script and caption(s) for this video job.

**Job ID:** ${jobId}
**Topic:** ${safeTopic}
**Pillar:** ${job.pillar || 'not assigned'}
**Target Platforms:** ${platforms.join(', ')}
${safeHook ? `**Hook:** ${safeHook}` : ''}
${isRetry ? `\n**RETRY — Previous attempt failed:** ${safeFailureReason}\nPlease adjust your script to avoid this issue. If the failure was about duration/word count, write a longer or shorter script accordingly.\n` : ''}

${knowledgeContext ? `**Knowledge Context (from unified search):**\n${knowledgeContext}\n` : ''}

**Requirements:**
1. Write a video script: 130-160 words exactly. Structure: HOOK → PROBLEM → FRAMEWORK → EXAMPLE → CTA. Tonality: Taki Moore (direct, no fluff, transformation-focused). Reference TRAINING.md for voice guide.
${captionRequirements}

**After writing, you MUST save to the database:**
\`\`\`bash
sqlite3 "${dbPath}" "UPDATE video_jobs SET script='<YOUR_SCRIPT>', caption='<YOUR_CAPTION>', status='scripted', updated_at='$(date -u +%Y-%m-%dT%H:%M:%SZ)' WHERE job_id='${jobId}';"
\`\`\`
Make sure to escape any single quotes in the script/caption by doubling them (e.g. it's → it''s).
${dualCaption ? '**IMPORTANT:** The caption field must contain BOTH captions separated by `---X---` on its own line. The publisher agent will split them automatically.' : ''}

**IMPORTANT: After saving to DB, trigger the next pipeline phase by running:**
\`\`\`bash
curl -s -X POST "http://localhost:3001/api/content/jobs/${jobId}/process"
\`\`\`
This chains the pipeline automatically — voice generation will start immediately after your script is saved.

Confirm once saved and pipeline triggered.`;

  const { client: gateway } = require('../gateway-ws');
  const sessionKey = `agent:copywriter:video-${jobId}`;

  await gateway.ensureConnected();
  gateway.request('chat.send', {
    sessionKey,
    message: prompt,
    deliver: false,
    idempotencyKey: `script-${jobId}-${Date.now()}`,
    attachments: [],
  }, 120000).catch(e => console.log('[copywriter] chat.send error:', e.message));

  dashLog('copywriter_triggered', `${jobId} — "${job.topic}" sent to copywriter session ${sessionKey}`);
  return { ok: true, message: `Script generation sent to copywriter. Job will move to "scripted" when complete (~30-60s).` };
}

app.post('/api/content/jobs/:jobId/process', validateJobId, async (req, res) => {
  const jobId = req.params.jobId;
  const job = contentSync.getJob(jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  // Handle planned status via copywriter gateway
  if (job.status === 'planned') {
    // Clear stale artifacts from previous run (retry safety)
    if (job.voice_audio_path || job.avatar_video_path || job.video_r2_url) {
      contentSync.updateJob(jobId, {
        voice_audio_path: null, avatar_video_path: null, captioned_video_path: null,
        video_r2_url: null, video_gdrive_url: null, heygen_video_id: null,
        platform_targets: null, failure_reason: null, last_failed_stage: null,
      });
      dashLog('pipeline_retry_cleanup', `Cleared stale artifacts for ${jobId}`);
    }
    try {
      const result = await triggerCopywriter(jobId);
      return res.json(result);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Map status → sub-agent script that processes jobs IN that status
  const AGENT_SCRIPTS = {
    scripted:      '/opt/AIWH/core/modules/frontend/video/voice-agent/run.sh',
    voice_ready:   '/opt/AIWH/core/modules/frontend/video/avatar-agent/run.sh',
    avatar_ready:  '/opt/AIWH/core/modules/frontend/video/caption-agent/run.sh',
    captioned:     '/opt/AIWH/core/modules/frontend/video/qa-agent/run.sh',
    approved:      '/opt/AIWH/core/modules/frontend/video/publisher-agent/run.sh',
  };

  const script = AGENT_SCRIPTS[job.status];
  if (!script) {
    return res.status(400).json({ error: `No pipeline step for status '${job.status}'. Processable statuses: planned, ${Object.keys(AGENT_SCRIPTS).join(', ')}` });
  }

  try {
    const { spawn } = require('child_process');
    const proc = spawn('bash', [script, jobId], {
      stdio: 'ignore',
      detached: true,
      env: { ...process.env, CLIENT_ROOT: process.env.CLIENT_ROOT || '/opt/AIWH/client' },
    });
    proc.unref();
    dashLog('pipeline_process', `Processing job ${jobId} (status: ${job.status}) via ${path.basename(path.dirname(script))}`);
    res.json({ ok: true, status: job.status, agent: path.basename(path.dirname(script)), message: `Processing started. ${job.topic || jobId} will advance when complete.` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Trigger full pipeline: runs all sub-agent scripts in sequence for all eligible jobs
app.post('/api/content/pipeline/trigger', async (req, res) => {
  // Rate limit: 1 trigger per 30 seconds
  const now = Date.now();
  if (now - _lastPipelineTrigger < PIPELINE_COOLDOWN_MS) {
    const waitSec = Math.ceil((PIPELINE_COOLDOWN_MS - (now - _lastPipelineTrigger)) / 1000);
    return res.status(429).json({ error: `Pipeline trigger rate limited. Wait ${waitSec}s.` });
  }
  _lastPipelineTrigger = now;

  const scripts = [
    { status: 'scripted', script: '/opt/AIWH/core/modules/frontend/video/voice-agent/run.sh', name: 'voice' },
    { status: 'voice_ready', script: '/opt/AIWH/core/modules/frontend/video/avatar-agent/run.sh', name: 'avatar' },
    { status: 'avatar_ready', script: '/opt/AIWH/core/modules/frontend/video/caption-agent/run.sh', name: 'caption' },
    { status: 'captioned', script: '/opt/AIWH/core/modules/frontend/video/qa-agent/run.sh', name: 'qa' },
    { status: 'approved', script: '/opt/AIWH/core/modules/frontend/video/publisher-agent/run.sh', name: 'publisher' },
  ];

  // Check which stages have work
  const stats = contentSync.getPipelineStats();
  const counts = stats.counts || {};
  const triggered = [];

  // Handle planned jobs via copywriter (one session per job)
  if ((counts.planned || 0) > 0) {
    const plannedJobs = contentSync.getJobs(50, 'planned');
    let copywriterCount = 0;
    for (const job of plannedJobs) {
      try {
        await triggerCopywriter(job.job_id);
        copywriterCount++;
      } catch (e) {
        console.log(`[pipeline] copywriter trigger failed for ${job.job_id}:`, e.message);
      }
    }
    if (copywriterCount > 0) {
      triggered.push({ agent: 'copywriter', jobs: copywriterCount });
    }
  }

  for (const s of scripts) {
    if ((counts[s.status] || 0) > 0) {
      try {
        const { spawn } = require('child_process');
        const proc = spawn('bash', [s.script], {
          stdio: 'ignore',
          detached: true,
          env: { ...process.env, CLIENT_ROOT: process.env.CLIENT_ROOT || '/opt/AIWH/client' },
        });
        proc.unref();
        triggered.push({ agent: s.name, jobs: counts[s.status] });
      } catch {}
    }
  }

  dashLog('pipeline_trigger', `Manual pipeline trigger: ${triggered.map(t => `${t.agent}(${t.jobs})`).join(', ') || 'no eligible jobs'}`);
  res.json({ ok: true, triggered, message: triggered.length ? `Pipeline triggered: ${triggered.map(t => `${t.agent} (${t.jobs} jobs)`).join(', ')}` : 'No jobs ready for processing' });
});

// ─── Schedule Slots ────────────────────────────────────────────
app.get('/api/content/schedule-slots', (req, res) => {
  const db = require('better-sqlite3')(path.join(__dirname, '..', 'mission-control.db'), { readonly: true });
  const row = db.prepare("SELECT value FROM settings WHERE key='video_schedule_slots'").get();
  db.close();
  if (!row) return res.json({ slots: [], timezone: 'Australia/Brisbane', max_per_day: 5 });
  try { res.json(JSON.parse(row.value)); } catch { res.json({ slots: [], timezone: 'Australia/Brisbane', max_per_day: 5 }); }
});

app.put('/api/content/schedule-slots', (req, res) => {
  const db = require('better-sqlite3')(path.join(__dirname, '..', 'mission-control.db'));
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('video_schedule_slots', ?)").run(JSON.stringify(req.body));
  db.close();
  dashLog('schedule_slots_updated', JSON.stringify(req.body.slots?.map(s => s.time)));
  res.json({ ok: true });
});

// Get next available schedule slot for a specific job
app.get('/api/content/next-slot', (req, res) => {
  const db = require('better-sqlite3')(path.join(__dirname, '..', 'mission-control.db'), { readonly: true });
  const row = db.prepare("SELECT value FROM settings WHERE key='video_schedule_slots'").get();
  db.close();
  if (!row) return res.json({ error: 'No schedule slots configured' });

  const config = JSON.parse(row.value);
  const slots = config.slots || [];
  const slotType = req.query.type || 'manual'; // 'cron' or 'manual'

  // Get already-scheduled jobs for today and tomorrow
  const videoDb = contentSync.getJobs(50, 'scheduled');
  const scheduledTimes = videoDb.map(j => j.scheduled_time).filter(Boolean);

  // Find next available slot
  const now = new Date();
  for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
    const day = new Date(now.getTime() + dayOffset * 86400000);
    const dateStr = day.toISOString().split('T')[0];

    for (const slot of slots) {
      if (slotType === 'cron' && slot.type !== 'cron') continue;
      if (slotType === 'manual' && slot.type === 'cron') continue;

      // Convert AEST slot time to UTC
      const [h, m] = slot.time.split(':').map(Number);
      const aestDate = new Date(`${dateStr}T${slot.time}:00+10:00`);

      // Skip past slots
      if (aestDate <= now) continue;

      const utcIso = aestDate.toISOString();

      // Check if this slot is already taken
      const taken = scheduledTimes.some(st => {
        const diff = Math.abs(new Date(st) - aestDate);
        return diff < 1800000; // Within 30 minutes = same slot
      });
      if (taken) continue;

      return res.json({ ok: true, scheduled_time: utcIso, slot_label: slot.label, date: dateStr, time_aest: slot.time });
    }
  }
  res.json({ error: 'No available slots in next 7 days' });
});

// ─── Standard Pipeline Media Serving ──────────────────────────
app.get('/api/content/jobs/:jobId/files', validateJobId, (req, res) => {
  const CLIENT_ROOT = process.env.CLIENT_ROOT || '/opt/AIWH/client';
  const jobDir = path.join(CLIENT_ROOT, 'content', 'jobs', req.params.jobId);
  if (!fs.existsSync(jobDir)) return res.json({ files: [] });
  try {
    const files = fs.readdirSync(jobDir)
      .filter(f => !f.startsWith('.') && !f.startsWith('generate-'))
      .map(f => {
        const fp = path.join(jobDir, f);
        const stat = fs.statSync(fp);
        if (stat.isDirectory()) return null;
        const ext = path.extname(f).toLowerCase();
        const type = ['.mp3', '.wav'].includes(ext) ? 'audio' : ['.mp4', '.mov', '.webm'].includes(ext) ? 'video' : 'other';
        return { name: f, size: stat.size, type, ext };
      })
      .filter(Boolean);
    res.json({ files });
  } catch (e) {
    res.json({ files: [] });
  }
});

// Get recent log entries for a specific job from agent logs
app.get('/api/content/jobs/:jobId/logs', validateJobId, (req, res) => {
  const CLIENT_ROOT = process.env.CLIENT_ROOT || '/opt/AIWH/client';
  const jobId = req.params.jobId;
  const logFiles = [
    { name: 'voice', path: path.join(CLIENT_ROOT, 'logs', 'video-voice-agent.log') },
    { name: 'avatar', path: path.join(CLIENT_ROOT, 'logs', 'video-avatar-agent.log') },
    { name: 'caption', path: path.join(CLIENT_ROOT, 'logs', 'video-caption-agent.log') },
    { name: 'qa', path: path.join(CLIENT_ROOT, 'logs', 'video-qa-agent.log') },
    { name: 'publisher', path: path.join(CLIENT_ROOT, 'logs', 'video-publisher-agent.log') },
  ];

  const entries = [];
  for (const lf of logFiles) {
    if (!fs.existsSync(lf.path)) continue;
    try {
      // Read last 200 lines and find entries for this job
      const content = fs.readFileSync(lf.path, 'utf8');
      const lines = content.split('\n');
      const last200 = lines.slice(-200);
      const jobLines = last200.filter(l => l.includes(jobId));
      if (jobLines.length) {
        entries.push({ agent: lf.name, lines: jobLines.slice(-10) });
      }
    } catch {}
  }
  res.json({ entries });
});

// ─── Pipeline Production Report ──────────────────────────────
app.get('/api/content/pipeline-report', (req, res) => {
  const CLIENT_ROOT = process.env.CLIENT_ROOT || '/opt/AIWH/client';
  const agents = [
    { name: 'voice',     label: 'Voice Agent',     file: 'video-voice-agent.log',     icon: '🎙️' },
    { name: 'avatar',    label: 'Avatar Agent',    file: 'video-avatar-agent.log',    icon: '🎬' },
    { name: 'caption',   label: 'Caption Agent',   file: 'video-caption-agent.log',   icon: '📝' },
    { name: 'qa',        label: 'QA Agent',        file: 'video-qa-agent.log',        icon: '✅' },
    { name: 'publisher', label: 'Publisher Agent',  file: 'video-publisher-agent.log', icon: '📤' },
  ];

  const report = agents.map(ag => {
    const logPath = path.join(CLIENT_ROOT, 'logs', ag.file);
    const info = { ...ag, exists: false, lastRun: null, runs: 0, successes: 0, failures: 0, recentLines: [] };
    if (!fs.existsSync(logPath)) return info;
    info.exists = true;
    try {
      const stat = fs.statSync(logPath);
      info.fileSize = stat.size;
      const content = fs.readFileSync(logPath, 'utf8');
      const lines = content.split('\n');

      // Parse RUN markers
      let runStarts = 0, lastStart = null, lastEnd = null;
      const jobResults = []; // { jobId, success, timestamp }
      let currentJobId = null;
      for (const line of lines) {
        const startMatch = line.match(/=== \[.*\] RUN START (\S+)/);
        if (startMatch) { runStarts++; lastStart = startMatch[1]; currentJobId = null; }
        const endMatch = line.match(/=== \[.*\] RUN END (\S+)/);
        if (endMatch) { lastEnd = endMatch[1]; }
        const jobMatch = line.match(/Processing job:\s*(job_\S+)/i) || line.match(/Job:\s*(job_\S+)/i);
        if (jobMatch) currentJobId = jobMatch[1];
        if (currentJobId && (line.includes('✅') || line.toLowerCase().includes('complete') || line.toLowerCase().includes('success'))) {
          jobResults.push({ jobId: currentJobId, success: true, ts: lastStart });
        }
        if (currentJobId && (line.includes('ERROR') || line.includes('❌') || line.toLowerCase().includes('failed'))) {
          jobResults.push({ jobId: currentJobId, success: false, ts: lastStart });
        }
      }

      info.runs = runStarts;
      info.lastRun = lastEnd || lastStart;
      info.successes = jobResults.filter(r => r.success).length;
      info.failures = jobResults.filter(r => !r.success).length;
      // Recent activity: last 30 meaningful lines (skip blanks)
      info.recentLines = lines.filter(l => l.trim()).slice(-30);
    } catch {}
    return info;
  });

  // Also get recent job history from DB
  let recentJobs = [];
  try {
    const dbPath = path.join(CLIENT_ROOT, 'data', 'video-jobs.db');
    if (fs.existsSync(dbPath)) {
      const Database = require('better-sqlite3');
      const db = new Database(dbPath, { readonly: true });
      recentJobs = db.prepare(`
        SELECT job_id, topic, status, priority, failure_reason, retry_count, last_failed_stage, created_at, updated_at
        FROM video_jobs ORDER BY updated_at DESC LIMIT 20
      `).all();
      db.close();
    }
  } catch {}

  res.json({ agents: report, recentJobs });
});

// Serve a specific media file from a job directory
app.get('/content-media/:jobId/:filename', validateJobId, (req, res) => {
  const CLIENT_ROOT = process.env.CLIENT_ROOT || '/opt/AIWH/client';
  // Sanitize filename to prevent path traversal
  const safeFilename = path.basename(req.params.filename);
  const filePath = path.resolve(path.join(CLIENT_ROOT, 'content', 'jobs', req.params.jobId, safeFilename));
  const allowedPrefix = path.resolve(path.join(CLIENT_ROOT, 'content', 'jobs'));
  if (!filePath.startsWith(allowedPrefix + '/')) return res.status(403).send('Forbidden');
  if (!fs.existsSync(filePath)) return res.status(404).send('Not found');
  res.sendFile(filePath);
});

// ─── Unified Pipeline Status ─────────────────────────────────
app.get('/api/pipeline/status', (req, res) => {
  const CLIENT_ROOT = process.env.CLIENT_ROOT || '/opt/AIWH/client';
  const dbPath = path.join(CLIENT_ROOT, 'data', 'video-jobs.db');
  try {
    const pipeDb = require('better-sqlite3')(dbPath, { readonly: true });
    // Standard pipeline counts
    const standard = {};
    const rows = pipeDb.prepare("SELECT status, COUNT(*) as c FROM video_jobs GROUP BY status").all();
    for (const r of rows) standard[r.status] = r.c;
    // Today's standard jobs
    const todayStd = pipeDb.prepare("SELECT job_id, topic, status, pillar FROM video_jobs WHERE updated_at >= date('now') ORDER BY updated_at DESC LIMIT 5").all();
    // Cinematic counts
    const cinematic = {};
    const cRows = pipeDb.prepare("SELECT phase, COUNT(*) as c FROM cinematic_jobs WHERE phase NOT IN ('approved','published','failed') GROUP BY phase").all();
    for (const r of cRows) cinematic[r.phase] = r.c;
    const reviewCount = pipeDb.prepare("SELECT COUNT(*) as c FROM cinematic_jobs WHERE phase LIKE '%_review'").get()?.c || 0;
    const activeCount = pipeDb.prepare("SELECT COUNT(*) as c FROM cinematic_jobs WHERE phase NOT IN ('approved','published','failed')").get()?.c || 0;
    const totalCinematic = pipeDb.prepare("SELECT COUNT(*) as c FROM cinematic_jobs").get()?.c || 0;
    pipeDb.close();
    res.json({
      standard: { counts: standard, today: todayStd },
      cinematic: { counts: cinematic, active: activeCount, awaiting_review: reviewCount, total: totalCinematic }
    });
  } catch (e) {
    res.json({ standard: { counts: {}, today: [] }, cinematic: { counts: {}, active: 0, awaiting_review: 0, total: 0 }, error: e.message });
  }
});

};
