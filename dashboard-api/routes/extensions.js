// ─── Client Dashboard Extensions ────────────────────────────
// Auto-discovery of Web Component extensions in client/dashboard/extensions/{name}/
// Each extension has: manifest.json + index.js + optional styles.css
// No build step — raw JS served directly. Branson creates these via builder-manager.

const fs = require('fs');
const path = require('path');
const { CLIENT_EXTENSIONS_DIR } = require('../helpers/paths');

let _extensions = []; // populated at startup

// Validate extension name (prevent traversal)
function isValidName(name) { return /^[a-z0-9][a-z0-9-]*$/.test(name); }

function discoverExtensions() {
  _extensions = [];
  if (!fs.existsSync(CLIENT_EXTENSIONS_DIR)) return;
  for (const entry of fs.readdirSync(CLIENT_EXTENSIONS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory() || !isValidName(entry.name)) continue;
    const manifestPath = path.join(CLIENT_EXTENSIONS_DIR, entry.name, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      _extensions.push({
        name: entry.name,
        label: manifest.label || entry.name,
        icon: manifest.icon || 'puzzle-piece',
        position: manifest.position || 'sidebar',
        description: manifest.description || '',
        hasStyles: fs.existsSync(path.join(CLIENT_EXTENSIONS_DIR, entry.name, 'styles.css')),
      });
    } catch (e) {
      console.warn(`Extension "${entry.name}": invalid manifest — ${e.message}`);
    }
  }
  return _extensions;
}

function register(app) {
  // List discovered extensions
  app.get('/api/extensions', (_req, res) => {
    res.json({ extensions: _extensions });
  });

  // Refresh extension list (e.g., after Branson creates one)
  app.post('/api/extensions/refresh', (_req, res) => {
    discoverExtensions();
    res.json({ ok: true, count: _extensions.length });
  });

  // Serve extension assets (index.js, styles.css) with traversal protection
  app.get('/extensions/:name/:file', (req, res) => {
    const { name, file } = req.params;
    if (!isValidName(name)) return res.status(400).json({ error: 'Invalid extension name' });
    if (!['index.js', 'styles.css'].includes(file)) return res.status(404).json({ error: 'Not found' });

    const filePath = path.join(CLIENT_EXTENSIONS_DIR, name, file);
    const resolved = path.resolve(filePath);
    // Traversal guard: ensure resolved path is under extensions dir
    if (!resolved.startsWith(path.resolve(CLIENT_EXTENSIONS_DIR))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (!fs.existsSync(resolved)) return res.status(404).json({ error: 'Not found' });

    const contentType = file.endsWith('.js') ? 'application/javascript' : 'text/css';
    res.setHeader('Content-Type', contentType);
    res.sendFile(resolved);
  });
}

module.exports = { register, discoverExtensions };
