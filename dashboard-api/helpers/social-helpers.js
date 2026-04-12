/**
 * social-helpers.js — Shared helpers for social route files.
 * Extracted from social.js to keep it under the 400-line limit.
 */
const fs = require('fs');
const path = require('path');

const CLIENT_ROOT = process.env.CLIENT_ROOT || '/opt/AIWH/client';
const PY_PATH = `/opt/homebrew/bin:/opt/homebrew/sbin:${process.env.PATH || '/usr/bin:/bin'}`;

function describeImage(imagePath) {
  if (!imagePath || !fs.existsSync(imagePath)) return '';
  try {
    const { execFileSync } = require('child_process');
    const desc = execFileSync('python3', ['-c', `
import sys, os, tempfile; sys.path.insert(0, '/opt/AIWH/core/scripts/lib')
from llm_provider import llm_call
img = sys.argv[1]
if os.path.getsize(img) > 4_000_000:
    try:
        from PIL import Image
        im = Image.open(img)
        im.thumbnail((1024, 1024), Image.LANCZOS)
        if im.mode in ('RGBA', 'P'): im = im.convert('RGB')
        tmp = tempfile.NamedTemporaryFile(suffix='.jpg', delete=False)
        im.save(tmp.name, 'JPEG', quality=80)
        img = tmp.name
    except: pass
print(llm_call("Describe this image in 2-3 sentences. What does it show? Be specific.", images=[img], max_tokens=300, temperature=0.3) or '')
`, imagePath], { timeout: 45000, env: { ...process.env, PATH: PY_PATH } }).toString().trim();
    return desc || '';
  } catch (e) { console.warn('[social] Vision failed:', e.message?.slice(0, 120)); return ''; }
}

function safeParseJson(str) {
  try { return JSON.parse(str); }
  catch { return str; }
}

function insertGrade(vdb, jobId, ct, grade, feedback, src) {
  try { vdb.prepare(`INSERT INTO social_grades (job_id,content_type,grade,feedback,review_source,created_at) VALUES (?,?,?,?,?,datetime('now'))`).run(jobId, ct, grade, feedback || null, src); }
  catch (e) { console.error('[social] Grade insert failed:', e.message); }
}

/** Job ID format validation regex — shared across route files */
const JOB_ID_RE = /^((job_|cjob_|social-|video-)[a-zA-Z0-9_-]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

function validateJobId(req, res, next) {
  if (!JOB_ID_RE.test(req.params.jobId)) {
    return res.status(400).json({ error: 'Invalid job ID format' });
  }
  next();
}

/** Platform name capitalization map */
const PLATFORM_LABELS = { instagram: 'Instagram', x: 'X', linkedin: 'LinkedIn', tiktok: 'TikTok', facebook: 'Facebook' };

/** Read default target platforms from content-pillars.json */
function getDefaultPlatforms() {
  try {
    const pillars = JSON.parse(fs.readFileSync(path.join(CLIENT_ROOT, 'config', 'content-pillars.json'), 'utf8'));
    return pillars.target_platforms || ['instagram', 'x'];
  } catch { return ['instagram', 'x']; }
}

module.exports = { describeImage, safeParseJson, insertGrade, JOB_ID_RE, validateJobId, PLATFORM_LABELS, getDefaultPlatforms };
