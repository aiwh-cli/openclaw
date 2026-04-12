/**
 * media-upload.js — Upload media to R2 for social publishing.
 *
 * Buffer requires direct public HTTPS URLs for media assets.
 * GDrive links don't work (auth redirects). R2 provides clean CDN URLs.
 *
 * Uses CF_R2_* credentials from secrets.enc (loaded via aiwh_load_secrets).
 * Reuses the same R2 pattern as cinematic-assets.js publish flow.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const CLIENT_ROOT = process.env.CLIENT_ROOT || '/opt/AIWH/client';
const PY_PATH = `/opt/homebrew/bin:/opt/homebrew/sbin:${process.env.PATH || '/usr/bin:/bin'}`;

/**
 * Upload a local file to Cloudflare R2 and return a public URL.
 * @param {string} localPath — Absolute path to the file
 * @returns {{ ok: boolean, url?: string, error?: string }}
 */
function uploadMedia(localPath) {
  if (!localPath || !fs.existsSync(localPath)) {
    return { ok: false, error: 'File not found' };
  }

  // Load R2 credentials via env.sh + aiwh_load_secrets (same pattern as cinematic-assets.js)
  let envVars = {};
  try {
    const raw = execFileSync('bash', ['-c',
      '. /opt/AIWH/core/scripts/lib/env.sh && aiwh_load_secrets CF_R2_PUBLIC_URL CF_R2_BUCKET CF_R2_ACCOUNT_ID CF_R2_ACCESS_KEY_ID CF_R2_SECRET_ACCESS_KEY && ' +
      'echo "CF_R2_PUBLIC_URL=$CF_R2_PUBLIC_URL" && echo "CF_R2_BUCKET=$CF_R2_BUCKET" && echo "CF_R2_ACCOUNT_ID=$CF_R2_ACCOUNT_ID" && ' +
      'echo "CF_R2_ACCESS_KEY_ID=$CF_R2_ACCESS_KEY_ID" && echo "CF_R2_SECRET_ACCESS_KEY=$CF_R2_SECRET_ACCESS_KEY"'
    ], { timeout: 10000, env: { ...process.env, PATH: PY_PATH } }).toString().trim();
    for (const line of raw.split('\n')) {
      const eq = line.indexOf('=');
      if (eq > 0) envVars[line.slice(0, eq)] = line.slice(eq + 1);
    }
  } catch (e) {
    return { ok: false, error: 'Could not load R2 credentials — check Settings → Providers' };
  }

  if (!envVars.CF_R2_PUBLIC_URL || !envVars.CF_R2_BUCKET) {
    return { ok: false, error: 'Cloudflare R2 not configured — media publishing requires R2 for public URLs. GDrive links are not supported by Buffer.' };
  }

  // Determine content type and R2 key
  const ext = path.extname(localPath).toLowerCase();
  const contentType = ext === '.mp4' ? 'video/mp4' : ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'application/octet-stream';
  const basename = path.basename(localPath, ext);
  const uniqueSuffix = path.basename(path.dirname(path.dirname(localPath))) || Date.now().toString();
  const r2Key = `social/${uniqueSuffix}-${basename}${ext}`;
  const publicUrl = `${envVars.CF_R2_PUBLIC_URL}/${r2Key}`;

  try {
    execFileSync('python3', ['-c', `
import boto3, sys, os
s3 = boto3.client('s3',
    endpoint_url='https://' + os.environ['CF_R2_ACCOUNT_ID'] + '.r2.cloudflarestorage.com',
    aws_access_key_id=os.environ['CF_R2_ACCESS_KEY_ID'],
    aws_secret_access_key=os.environ['CF_R2_SECRET_ACCESS_KEY'],
    region_name='auto')
s3.upload_file(sys.argv[1], sys.argv[2], sys.argv[3], ExtraArgs={'ContentType': sys.argv[4]})
`, localPath, envVars.CF_R2_BUCKET, r2Key, contentType], {
      timeout: 120000,
      env: {
        ...process.env,
        CF_R2_ACCOUNT_ID: envVars.CF_R2_ACCOUNT_ID,
        CF_R2_ACCESS_KEY_ID: envVars.CF_R2_ACCESS_KEY_ID,
        CF_R2_SECRET_ACCESS_KEY: envVars.CF_R2_SECRET_ACCESS_KEY,
        PATH: PY_PATH,
      },
    });
    console.log(`[media-upload] R2 upload OK: ${publicUrl}`);
    return { ok: true, url: publicUrl };
  } catch (e) {
    console.error('[media-upload] R2 upload failed:', e.message?.slice(0, 200));
    return { ok: false, error: `R2 upload failed: ${e.message?.slice(0, 100)}` };
  }
}

module.exports = { uploadMedia };
