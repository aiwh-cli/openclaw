/**
 * platform-formats.js — API routes for per-content-type platform format settings.
 * GET/PUT /api/social-hub/settings/platform-formats
 */

const fs = require('fs');
const path = require('path');
const { resolveFormat, getAllFormats, migrateLegacy, isLegacy, DEFAULTS } = require('../helpers/format-resolver');

const CLIENT_ROOT = process.env.CLIENT_ROOT || '/opt/AIWH/client';
const PILLARS_PATH = path.join(CLIENT_ROOT, 'config', 'content-pillars.json');

module.exports = function registerPlatformFormatRoutes(app) {

  app.get('/api/social-hub/settings/platform-formats', (req, res) => {
    try {
      const formats = getAllFormats(PILLARS_PATH);
      res.json({ formats, defaults: DEFAULTS });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put('/api/social-hub/settings/platform-formats', (req, res) => {
    const { platform_formats } = req.body;
    if (!platform_formats || typeof platform_formats !== 'object') {
      return res.status(400).json({ error: 'platform_formats object required' });
    }

    // Validate ratios
    const validRatios = new Set(['9:16', '16:9', '3:4', '4:3', '1:1', '1.91:1', '4:5', null]);
    for (const [platform, types] of Object.entries(platform_formats)) {
      if (typeof types !== 'object' || types === null) {
        return res.status(400).json({ error: `Invalid format for platform "${platform}"` });
      }
      for (const [ct, ratio] of Object.entries(types)) {
        if (ratio !== null && !validRatios.has(ratio)) {
          return res.status(400).json({ error: `Invalid ratio "${ratio}" for ${platform}.${ct}` });
        }
      }
    }

    try {
      const cfg = JSON.parse(fs.readFileSync(PILLARS_PATH, 'utf8'));
      cfg.platform_formats = platform_formats;
      fs.writeFileSync(PILLARS_PATH, JSON.stringify(cfg, null, 2));
      res.json({ ok: true, formats: platform_formats });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
};
