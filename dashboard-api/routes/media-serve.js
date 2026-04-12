// ─── Routes: Media File Serving ─────────────────────────────────────
// Serves media files from allowed directories for inline chat preview.
// Path traversal protection: only serves from whitelisted roots.
// Supports Range requests for video seeking.

const fs = require('fs');
const path = require('path');

const CLIENT_ROOT = process.env.CLIENT_ROOT || '/opt/AIWH/client';

// Allowed directory roots — only files under these paths can be served
const ALLOWED_ROOTS = [
  path.resolve(CLIENT_ROOT, 'content'),
  path.resolve(CLIENT_ROOT, 'data'),
  path.resolve('/opt/AIWH/core/content'),
  '/tmp',
];

const MIME_TYPES = {
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4', '.flac': 'audio/flac', '.aac': 'audio/aac',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
};

function isUnderAllowedRoot(filePath) {
  const resolved = path.resolve(filePath);
  return ALLOWED_ROOTS.some(root => resolved.startsWith(root + path.sep) || resolved === root);
}

module.exports = function(app) {
  app.get('/api/media/file', (req, res) => {
    const filePath = req.query.path;
    if (!filePath || typeof filePath !== 'string') {
      return res.status(400).json({ error: 'path parameter required' });
    }

    // Resolve to absolute, preventing traversal
    const resolved = path.resolve(filePath);

    // Security: must be under allowed roots
    if (!isUnderAllowedRoot(resolved)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Must exist and be a file
    if (!fs.existsSync(resolved)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const stat = fs.statSync(resolved);
    if (!stat.isFile()) {
      return res.status(400).json({ error: 'Not a file' });
    }

    const ext = path.extname(resolved).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    // SVG sandbox: block script execution on direct browser navigation
    const svgHeaders = ext === '.svg'
      ? { 'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'" }
      : {};

    // Range request support for video/audio seeking
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
      const chunkSize = end - start + 1;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=3600',
        ...svgHeaders,
      });
      fs.createReadStream(resolved, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': stat.size,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, max-age=3600',
        ...svgHeaders,
      });
      fs.createReadStream(resolved).pipe(res);
    }
  });
};
