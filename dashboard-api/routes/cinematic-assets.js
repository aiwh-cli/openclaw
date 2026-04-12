// ─── Routes: Cinematic Pipeline — Assets (retry, logs, costs, publish, static serving) ────
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { CJOB_ID_RE, sanitizeForPrompt, spawnProducer } = require('../helpers/cinematic');

module.exports = function(app, deps) {
  const { db, io, cinematicSync, dashLog } = deps;

app.post('/api/cinematic/jobs/:id/retry-failed', (req, res) => {
  spawnProducer('retry-failed', req.params.id);

  if (io) io.emit('cinematic_updated');
  res.json({ ok: true, message: 'Retrying failed assets in background' });
});

// Producer log for a cinematic job
app.get('/api/cinematic/jobs/:id/log', (req, res) => {
  if (!CJOB_ID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid job ID' });
  const CLIENT_ROOT = process.env.CLIENT_ROOT || '/opt/AIWH/client';
  const logPath = path.join(CLIENT_ROOT, 'content', 'cinematic', req.params.id, 'producer.log');
  try {
    if (!fs.existsSync(logPath)) return res.json({ log: 'No logs yet.' });
    const content = fs.readFileSync(logPath, 'utf8');
    // Return last 200 lines
    const lines = content.split('\n');
    const tail = lines.slice(-200).join('\n');
    res.json({ log: tail });
  } catch { res.json({ log: 'Error reading log.' }); }
});

// Progress for a cinematic job during generation phases
app.get('/api/cinematic/jobs/:id/progress', (req, res) => {
  const job = cinematicSync.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Not found' });
  const assets = cinematicSync.getAssets(req.params.id);

  const phase = job.phase;
  let progress = null;

  // Calculate expected counts based on phase and clip_count
  const clipCount = job.clip_count || 0;
  const plan = (() => { try { return JSON.parse(job.production_plan || '{}'); } catch { return {}; } })();
  const cinematicClips = (plan.clips || []).filter(c => c.type === 'cinematic').length;
  const presenterClips = clipCount - cinematicClips;

  if (phase === 'ref_images') {
    const done = assets.filter(a => a.asset_type === 'ref_image' && a.status !== 'failed').length;
    const expected = clipCount; // roughly 1 ref per clip
    progress = { step: 'Generating reference images', done, expected, pct: expected > 0 ? Math.round(done / expected * 100) : 0 };
  } else if (phase === 'keyframes') {
    const done = assets.filter(a => (a.asset_type === 'keyframe_first' || a.asset_type === 'keyframe_last') && a.status !== 'failed').length;
    const expected = cinematicClips * 2; // first + last per cinematic clip
    progress = { step: 'Generating keyframes', done, expected, pct: expected > 0 ? Math.round(done / expected * 100) : 0 };
  } else if (phase === 'video_clips') {
    const done = assets.filter(a => a.asset_type === 'video_clip' && a.status !== 'failed').length;
    const expected = cinematicClips;
    progress = { step: 'Generating video clips', done, expected, pct: expected > 0 ? Math.round(done / expected * 100) : 0 };
  } else if (phase === 'narration') {
    const narrationAssets = assets.filter(a => a.asset_type === 'narration' || a.asset_type === 'narration_clip');
    const done = narrationAssets.length;
    const expected = clipCount + 1; // full narration + per-clip
    progress = { step: 'Generating narration', done, expected, pct: expected > 0 ? Math.round(done / expected * 100) : 0 };
  } else if (phase === 'assembly') {
    progress = { step: 'Assembling final video', done: 0, expected: 1, pct: 50 };
  } else if (phase === 'analyzing') {
    progress = { step: 'Analyzing brief', done: 0, expected: 1, pct: 50 };
  }

  res.json({ phase, progress });
});

// Cost breakdown for a cinematic job (parsed from cinematic-costs.jsonl)
app.get('/api/cinematic/jobs/:id/costs', (req, res) => {
  const cjobId = req.params.id;
  const CLIENT_ROOT = process.env.CLIENT_ROOT || '/opt/AIWH/client';
  const costFile = path.join(CLIENT_ROOT, 'logs', 'cinematic-costs.jsonl');
  try {
    if (!fs.existsSync(costFile)) return res.json({ costs: {}, total: 0 });
    const lines = fs.readFileSync(costFile, 'utf8').split('\n').filter(Boolean);
    const byService = {};
    let total = 0;
    for (const line of lines) {
      try {
        const e = JSON.parse(line);
        if (e.detail && e.detail.includes(cjobId)) {
          const svc = e.service || 'other';
          if (!byService[svc]) byService[svc] = { cost: 0, items: [] };
          byService[svc].cost += e.cost_usd || 0;
          byService[svc].items.push({ model: e.model, cost: e.cost_usd, detail: e.detail, timestamp: e.timestamp });
          total += e.cost_usd || 0;
        }
      } catch {}
    }
    // Round costs
    for (const svc of Object.keys(byService)) byService[svc].cost = Math.round(byService[svc].cost * 100) / 100;
    res.json({ costs: byService, total: Math.round(total * 100) / 100 });
  } catch (e) {
    res.json({ costs: {}, total: 0 });
  }
});

// Complete a cinematic job (mark done, no platform publishing)
app.post('/api/cinematic/jobs/:id/complete', (req, res) => {
  const result = cinematicSync.completeJob(req.params.id);
  if (result.error) return res.status(400).json(result);
  if (io) io.emit('cinematic_updated');
  dashLog('cinematic_completed', `Job ${req.params.id} marked complete`);
  res.json(result);
});

// Send caption request to copywriter agent (fire-and-forget — copywriter writes to DB)
app.post('/api/cinematic/jobs/:id/generate-caption', async (req, res) => {
  const cjobId = req.params.id;
  const job = cinematicSync.getJob(cjobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const CLIENT_ROOT = process.env.CLIENT_ROOT || '/opt/AIWH/client';
  const dbPath = path.join(CLIENT_ROOT, 'data', 'video-jobs.db');

  // Load analysis data for context
  let styleBible = '', narration = '', brief = '';
  try {
    const jobDir = path.join(CLIENT_ROOT, 'content', 'cinematic', cjobId);
    if (fs.existsSync(path.join(jobDir, 'style-bible.json')))
      styleBible = fs.readFileSync(path.join(jobDir, 'style-bible.json'), 'utf8');
    if (fs.existsSync(path.join(jobDir, 'narration-script.txt')))
      narration = fs.readFileSync(path.join(jobDir, 'narration-script.txt'), 'utf8');
    if (fs.existsSync(path.join(jobDir, 'brief.md')))
      brief = fs.readFileSync(path.join(jobDir, 'brief.md'), 'utf8');
  } catch {}

  const platforms = req.body.platforms || ['instagram'];
  const platformStr = platforms.join(', ');

  const prompt = `You have a cinematic video ready for publishing. Write a social media caption for it.

VIDEO TITLE: ${sanitizeForPrompt(job.title)}
JOB ID: ${cjobId}
BRIEF: ${sanitizeForPrompt(brief)}
NARRATION SCRIPT: ${sanitizeForPrompt(narration)}
STYLE/TONE: ${styleBible ? (JSON.parse(styleBible).tone || '') : ''}
FORMAT: ${job.output_format || '16:9'}
TARGET PLATFORMS: ${platformStr}

Write TWO captions and save them both in a single sqlite3 update (combined with a separator):

1. INSTAGRAM CAPTION (max 2200 chars):
   - Hook in the first line (before "...see more")
   - Brand voice from the style/tone above
   - Include 5-8 relevant hashtags (mix of broad + niche)
   - Clear CTA (call to action)
   - Can be longer and more descriptive

2. X/TWITTER CAPTION (max 270 chars including hashtags):
   - Punchy, concise — every word counts
   - Max 2-3 hashtags
   - Must be under 270 characters TOTAL (leave room for the video link)

Combine them with "---X---" as separator, like:
Instagram caption here...

---X---

X caption here...

IMPORTANT: After writing the caption, you MUST save it to the database by running this exact command:
sqlite3 ${dbPath} "UPDATE cinematic_jobs SET caption='<YOUR_CAPTION_HERE>' WHERE cjob_id='${cjobId}'"

Make sure to escape any single quotes in the caption by doubling them (e.g. it's → it''s).
Confirm once saved.`;

  // Send to copywriter agent via gateway — fire and forget
  const { client: gateway } = require('../gateway-ws');
  const sessionKey = `agent:copywriter:cinematic`;

  try {
    await gateway.ensureConnected();
    gateway.request('chat.send', {
      sessionKey,
      message: prompt,
      deliver: false,
      idempotencyKey: `caption-${cjobId}-${Date.now()}`,
      attachments: [],
    }, 120000).catch(e => console.log('[caption] chat.send error:', e.message));

    dashLog('caption_requested', `${cjobId} — sent to copywriter`);
    res.json({ ok: true, message: 'Caption request sent to copywriter. Refresh in ~30s to see the result.' });
  } catch (e) {
    console.error('[caption] Error:', e.message);
    res.json({ ok: false, error: e.message });
  }
});

// Save caption manually (from publish modal edit)
app.patch('/api/cinematic/jobs/:id/caption', (req, res) => {
  const { caption } = req.body;
  if (caption === undefined) return res.status(400).json({ error: 'caption required' });
  const CLIENT_ROOT = process.env.CLIENT_ROOT || '/opt/AIWH/client';
  try {
    const pipeDb = require('better-sqlite3')(path.join(CLIENT_ROOT, 'data', 'video-jobs.db'));
    pipeDb.prepare('UPDATE cinematic_jobs SET caption=?, updated_at=? WHERE cjob_id=?')
      .run(caption, new Date().toISOString(), req.params.id);
    pipeDb.close();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/cinematic/jobs/:id/publish', async (req, res) => {
  const cjobId = req.params.id;
  const { platforms, captionIg, captionX, caption, scheduledAt } = req.body;

  const CLIENT_ROOT = process.env.CLIENT_ROOT || '/opt/AIWH/client';
  const dbPath = path.join(CLIENT_ROOT, 'data', 'video-jobs.db');

  try {
    const pipeDb = require('better-sqlite3')(dbPath);
    const job = pipeDb.prepare('SELECT * FROM cinematic_jobs WHERE cjob_id=?').get(cjobId);
    if (!job) { pipeDb.close(); return res.status(404).json({ error: 'Job not found' }); }
    if (job.phase !== 'approved') { pipeDb.close(); return res.status(400).json({ error: `Job phase is '${job.phase}', must be 'approved'` }); }

    const finalPath = cinematicSync.getFinalVideoPath(cjobId);
    if (!finalPath || !fs.existsSync(finalPath)) {
      pipeDb.close();
      return res.status(400).json({ error: 'Final video not found — assembly may not have completed' });
    }

    const ENV_FILE = '/opt/AIWH/.openclaw/.env';
    let envVars = {};
    if (fs.existsSync(ENV_FILE)) {
      for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
        const match = line.match(/^([A-Z0-9_]+)=(.+)$/);
        if (match) envVars[match[1]] = match[2].replace(/^["']|["']$/g, '');
      }
    }

    const platformSet = Array.isArray(platforms) ? new Set(platforms) : new Set(Object.keys(platforms || {}).filter(k => platforms[k]));
    const results = [];

    // Step 1: Upload video to R2 (shared across platforms)
    let r2Url = null;
    if (envVars.CF_R2_PUBLIC_URL && envVars.CF_R2_BUCKET) {
      try {
        const slug = (job.title || cjobId).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const r2Key = `cinematic-${slug}.mp4`;
        r2Url = `${envVars.CF_R2_PUBLIC_URL}/${r2Key}`;

        // Validate finalPath is within expected content directory
        const resolvedFinal = path.resolve(finalPath);
        const expectedPrefix = path.resolve((process.env.CLIENT_ROOT || '/opt/AIWH/client') + '/content/cinematic');
        if (!resolvedFinal.startsWith(expectedPrefix + '/')) {
          throw new Error('Final video path outside expected directory');
        }

        execFileSync('python3', ['-c', `
import boto3, sys, os
s3 = boto3.client('s3',
    endpoint_url='https://' + os.environ['CF_R2_ACCOUNT_ID'] + '.r2.cloudflarestorage.com',
    aws_access_key_id=os.environ['CF_R2_ACCESS_KEY_ID'],
    aws_secret_access_key=os.environ['CF_R2_SECRET_ACCESS_KEY'],
    region_name='auto')
s3.upload_file(sys.argv[1], sys.argv[2], sys.argv[3], ExtraArgs={'ContentType': 'video/mp4'})
`, resolvedFinal, envVars.CF_R2_BUCKET, r2Key], {
          timeout: 120000,
          env: { ...process.env, CF_R2_ACCOUNT_ID: envVars.CF_R2_ACCOUNT_ID, CF_R2_ACCESS_KEY_ID: envVars.CF_R2_ACCESS_KEY_ID, CF_R2_SECRET_ACCESS_KEY: envVars.CF_R2_SECRET_ACCESS_KEY },
        });
        console.log(`[publish] R2 upload OK: ${r2Url}`);
      } catch (e) {
        console.error('[publish] R2 upload failed:', e.message);
        pipeDb.close();
        return res.status(500).json({ error: 'Video upload to R2 failed: ' + e.message.slice(0, 200) });
      }
    }

    if (!r2Url) {
      pipeDb.close();
      return res.status(500).json({ error: 'R2 not configured — cannot publish without video hosting' });
    }

    // Per-platform captions
    const igCap = captionIg || caption || job.caption?.split('---X---')?.[0]?.trim() || job.title || '';
    const xCap = captionX || (job.caption?.includes('---X---') ? job.caption.split('---X---')[1].trim() : '') || igCap.slice(0, 270);

    // Step 2: Schedule on each platform via Buffer GraphQL
    const dueAt = scheduledAt || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().replace(/\.\d+Z$/, 'Z');

    const bufferMutation = `mutation CreatePost($input: CreatePostInput!) {
  createPost(input: $input) {
    ... on PostActionSuccess { post { id dueAt status } }
    ... on MutationError { message }
    ... on UnexpectedError { message }
  }
}`;

    async function bufferSchedule(channelId, platform, platformCaption, metadata) {
      const variables = {
        input: {
          channelId,
          schedulingType: 'automatic',
          mode: 'customScheduled',
          dueAt,
          text: platformCaption,
          assets: { videos: [{ url: r2Url }] },
          ...(metadata ? { metadata } : {}),
        }
      };

      const payload = JSON.stringify({ query: bufferMutation, variables });
      const https = require('https');
      return new Promise((resolve) => {
        const req = https.request('https://api.buffer.com/graphql', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${envVars.BUFFER_API_TOKEN}`,
            'Content-Type': 'application/json',
            'User-Agent': 'AIWH/1.0',
          },
        }, (resp) => {
          let data = '';
          resp.on('data', chunk => data += chunk);
          resp.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              const post = parsed?.data?.createPost?.post;
              const errMsg = parsed?.data?.createPost?.message || parsed?.errors?.[0]?.message;
              if (post?.id) {
                resolve({ platform, ok: true, postId: post.id, dueAt: post.dueAt, status: post.status });
              } else {
                resolve({ platform, ok: false, error: errMsg || 'Unknown Buffer error' });
              }
            } catch {
              resolve({ platform, ok: false, error: 'Buffer response parse error' });
            }
          });
        });
        req.on('error', (e) => resolve({ platform, ok: false, error: e.message }));
        req.write(payload);
        req.end();
      });
    }

    // Instagram
    if (platformSet.has('instagram') && envVars.BUFFER_IG_CHANNEL_ID) {
      const r = await bufferSchedule(envVars.BUFFER_IG_CHANNEL_ID, 'instagram', igCap, {
        instagram: { type: 'reel', shouldShareToFeed: true }
      });
      results.push(r);
    }

    // X/Twitter
    if ((platformSet.has('x') || platformSet.has('twitter')) && envVars.BUFFER_X_CHANNEL_ID) {
      const r = await bufferSchedule(envVars.BUFFER_X_CHANNEL_ID, 'x', xCap, null);
      results.push(r);
    }

    // YouTube — not yet integrated
    if (platformSet.has('youtube')) {
      results.push({ platform: 'youtube', ok: false, error: 'YouTube API not yet integrated' });
    }

    // TikTok — not yet integrated
    if (platformSet.has('tiktok')) {
      results.push({ platform: 'tiktok', ok: false, error: 'TikTok API not yet integrated' });
    }

    // Only mark as published if at least one platform succeeded
    const anySuccess = results.some(r => r.ok);
    if (anySuccess) {
      const now = new Date().toISOString();
      const platformTargets = {};
      for (const r of results.filter(r => r.ok)) {
        platformTargets[r.platform] = { post_id: r.postId, scheduled_at: dueAt };
      }
      pipeDb.prepare('UPDATE cinematic_jobs SET phase=?, updated_at=?, completed_at=? WHERE cjob_id=?')
        .run('published', now, now, cjobId);
      dashLog('cinematic_published', `Job ${cjobId} scheduled for ${dueAt} on: ${results.filter(r => r.ok).map(r => r.platform).join(', ')}`);
    }
    pipeDb.close();

    if (io) io.emit('cinematic_updated');
    res.json({ ok: anySuccess, results });
  } catch (e) {
    console.error('[publish] Error:', e);
    res.status(500).json({ error: e.message });
  }
});

};
