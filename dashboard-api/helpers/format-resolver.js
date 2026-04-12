/**
 * format-resolver.js — Platform format resolver for dashboard routes.
 * Returns the correct aspect ratio for (platform, contentType).
 * Handles both legacy flat and hierarchical platform_formats.
 */

const fs = require('fs');
const path = require('path');

const CLIENT_ROOT = process.env.CLIENT_ROOT || '/opt/AIWH/client';
const PILLARS_PATH = path.join(CLIENT_ROOT, 'config', 'content-pillars.json');

// Default format matrix. Uses the IDEAL ratio per platform.
// generate-social-image.sh handles provider limitations (generates closest + crops).
const DEFAULTS = {
  instagram: { video_reel: '9:16', image_post: '4:5', text_post: null },
  x:         { video_reel: '16:9', image_post: '16:9', text_post: null },
  linkedin:  { video_reel: '16:9', image_post: '16:9', text_post: null },
  tiktok:    { video_reel: '9:16', image_post: null, text_post: null },
  facebook:  { video_reel: '16:9', image_post: '4:5', text_post: null },
};

function loadFormats(pillarsPath) {
  try {
    const cfg = JSON.parse(fs.readFileSync(pillarsPath || PILLARS_PATH, 'utf8'));
    return cfg.platform_formats || {};
  } catch { return {}; }
}

function isLegacy(formats) {
  return Object.values(formats).some(v => typeof v === 'string');
}

function migrateLegacy(formats) {
  const result = {};
  for (const [platform, value] of Object.entries(formats)) {
    if (typeof value === 'string') {
      const defaults = DEFAULTS[platform] || {};
      result[platform] = {
        video_reel: value,
        image_post: defaults.image_post || null,
        text_post: null,
      };
    } else {
      result[platform] = value;
    }
  }
  for (const [platform, defaults] of Object.entries(DEFAULTS)) {
    if (!result[platform]) result[platform] = { ...defaults };
  }
  return result;
}

function resolveFormat(platform, contentType, pillarsPath) {
  let formats = loadFormats(pillarsPath);
  if (isLegacy(formats)) formats = migrateLegacy(formats);
  const cfg = formats[platform];
  if (cfg && typeof cfg === 'object') return cfg[contentType] || null;
  if (typeof cfg === 'string' && contentType === 'video_reel') return cfg;
  return (DEFAULTS[platform] || {})[contentType] || null;
}

function getAllFormats(pillarsPath) {
  let formats = loadFormats(pillarsPath);
  if (isLegacy(formats)) formats = migrateLegacy(formats);
  return { ...DEFAULTS, ...formats };
}

module.exports = { resolveFormat, getAllFormats, migrateLegacy, isLegacy, DEFAULTS };
