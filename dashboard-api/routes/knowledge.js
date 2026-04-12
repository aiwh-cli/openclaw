// ─── Knowledge Routes — Document Upload & Ingestion ──────────
// Upload documents → run ingest-document.py (chunk-by-chunk Haiku distillation)
const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const aiwhPaths = require('../../scripts/lib/paths');
const UPLOAD_DIR = aiwhPaths.UPLOAD_DIR;
const INGEST_SCRIPT = aiwhPaths.INGEST_SCRIPT;
const KNOWLEDGE_DB = aiwhPaths.KNOWLEDGE_DB;
const PYTHON = aiwhPaths.PYTHON;

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.docx', '.pptx', '.md', '.txt', '.json', '.jsonl', '.csv'];
    cb(null, allowed.includes(path.extname(file.originalname).toLowerCase()));
  },
});

function getIngestEnv() {
  try {
    const { buildScriptEnv } = require('../helpers/secret-loader');
    return buildScriptEnv();
  } catch {
    return { ...process.env, PATH: `/opt/homebrew/bin:/opt/homebrew/sbin:${process.env.PATH || '/usr/bin:/bin'}` };
  }
}

const _activeJobs = new Map();

module.exports = (app, deps) => {
  // Register management routes (search, add, edit, promote, delete, stats)
  require('./knowledge-manage')(app, deps);
  // Register dreams routes (status, diary, toggle via gateway RPC)
  require('./knowledge-dreams')(app, deps);

  const { dashLog } = deps;

  // ─── Upload and ingest ────────────────────────────────────────
  app.post('/api/knowledge/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded or unsupported type' });
    const origName = req.file.originalname;
    const filePath = req.file.path;
    const destPath = path.join(UPLOAD_DIR, origName);
    try { fs.renameSync(filePath, destPath); } catch {}
    const ingestPath = fs.existsSync(destPath) ? destPath : filePath;

    _activeJobs.set(origName, { status: 'processing', progress: 'Starting...', entries: 0, error: null });
    dashLog('knowledge', `Starting ingestion: ${origName}`);

    const env = getIngestEnv();
    if (!env.ANTHROPIC_API_KEY) {
      _activeJobs.set(origName, { status: 'error', progress: '', entries: 0, error: 'ANTHROPIC_API_KEY not found' });
      return res.json({ ok: false, filename: origName, error: 'API key not configured' });
    }
    res.json({ ok: true, filename: origName, status: 'processing' });

    const child = spawn(PYTHON, [INGEST_SCRIPT, ingestPath], { env, timeout: 600000 });
    let output = '';
    child.stdout.on('data', (d) => {
      output += d.toString();
      const lines = output.split('\n');
      const last = lines.filter(l => l.includes('Progress:')).pop();
      if (last) _activeJobs.set(origName, { ..._activeJobs.get(origName), progress: last.trim() });
    });
    child.stderr.on('data', (d) => {
      const line = d.toString().trim();
      if (line && (line.includes('✓') || line.includes('Progress:') || line.includes('chunks')))
        _activeJobs.set(origName, { ..._activeJobs.get(origName), status: 'processing', progress: line });
    });
    child.on('close', (code) => {
      const match = output.match(/(\d+)\s*new/);
      const entries = match ? parseInt(match[1]) : 0;
      _activeJobs.set(origName, { status: code === 0 ? 'done' : 'error', progress: '', entries, error: code !== 0 ? `Exit code ${code}` : null });
      dashLog('knowledge', code === 0 ? `Ingested ${origName}: ${entries} entries` : `Ingest failed: ${origName}`);
    });
  });

  // ─── Poll progress ────────────────────────────────────────────
  app.get('/api/knowledge/progress/:filename', (req, res) => {
    const job = _activeJobs.get(req.params.filename);
    res.json(job || { status: 'unknown' });
  });

  // ─── List documents ───────────────────────────────────────────
  app.get('/api/knowledge/documents', (req, res) => {
    try {
      if (!fs.existsSync(KNOWLEDGE_DB)) return res.json([]);
      const sqlite = require('better-sqlite3');
      const db = sqlite(KNOWLEDGE_DB, { readonly: true });
      const docs = db.prepare(`
        SELECT REPLACE(REPLACE(source, 'document-ingest:', ''), 'document:', '') as filename,
               COUNT(*) as entries, MAX(created_at) as uploadedAt
        FROM client_knowledge
        WHERE source LIKE 'document:%' OR source LIKE 'document-ingest:%'
        GROUP BY filename ORDER BY MAX(created_at) DESC
      `).all();
      db.close();
      const result = docs.map(d => ({ filename: d.filename, entries: d.entries, uploadedAt: d.uploadedAt || 'unknown', status: 'done' }));
      for (const [name, job] of _activeJobs) {
        if (!result.find(d => d.filename === name))
          result.unshift({ filename: name, entries: job.entries, uploadedAt: 'now', status: job.status, progress: job.progress, error: job.error });
      }
      res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── Re-process ───────────────────────────────────────────────
  app.post('/api/knowledge/reprocess', (req, res) => {
    const { filename } = req.body;
    if (!filename) return res.status(400).json({ error: 'filename required' });
    const filePath = path.join(UPLOAD_DIR, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found. Upload again.' });
    try {
      if (fs.existsSync(KNOWLEDGE_DB)) {
        const sqlite = require('better-sqlite3');
        const db = sqlite(KNOWLEDGE_DB);
        const base = filename.replace(/\.[^.]+$/, '');
        db.prepare('DELETE FROM client_knowledge WHERE source IN (?, ?, ?, ?)').run(`document:${filename}`, `document-ingest:${filename}`, `document:${base}`, `document-ingest:${base}`);
        db.close();
      }
    } catch {}
    _activeJobs.set(filename, { status: 'processing', progress: 'Re-processing...', entries: 0, error: null });
    res.json({ ok: true, status: 'processing' });
    const env = getIngestEnv();
    const child = spawn(PYTHON, [INGEST_SCRIPT, filePath], { env, timeout: 600000 });
    let output = '';
    child.stdout.on('data', (d) => { output += d.toString(); });
    child.stderr.on('data', (d) => {
      const line = d.toString().trim();
      if (line.includes('✓') || line.includes('Progress:') || line.includes('chunks'))
        _activeJobs.set(filename, { ..._activeJobs.get(filename), progress: line });
    });
    child.on('close', (code) => {
      const match = output.match(/(\d+)\s*new/);
      _activeJobs.set(filename, { status: code === 0 ? 'done' : 'error', progress: '', entries: match ? parseInt(match[1]) : 0, error: code !== 0 ? `Exit code ${code}` : null });
      dashLog('knowledge', `Re-processed ${filename}`);
    });
  });

  // ─── Delete document ──────────────────────────────────────────
  app.delete('/api/knowledge/document', (req, res) => {
    const { filename } = req.body;
    if (!filename) return res.status(400).json({ error: 'filename required' });
    try {
      if (fs.existsSync(KNOWLEDGE_DB)) {
        const sqlite = require('better-sqlite3');
        const db = sqlite(KNOWLEDGE_DB);
        const base = filename.replace(/\.[^.]+$/, '');
        db.prepare('DELETE FROM client_knowledge WHERE source IN (?, ?, ?, ?)').run(`document:${filename}`, `document-ingest:${filename}`, `document:${base}`, `document-ingest:${base}`);
        db.close();
      }
      const filePath = path.join(UPLOAD_DIR, filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      _activeJobs.delete(filename);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
};
