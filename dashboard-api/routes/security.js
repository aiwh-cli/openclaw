// ─── Routes: Security (Landlock policy, audit log, trash management) ──
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const { LANDLOCK_POLICY, getConfigWithFallback, CLIENT_ROOT: _CR } = require('../helpers/paths');
const CLIENT_ROOT = _CR;
const AUDIT_LOG = path.join(CLIENT_ROOT, 'logs', 'security-audit.jsonl');
const POLICY_PATH = LANDLOCK_POLICY;
const OVERRIDES_PATH = path.join(CLIENT_ROOT, 'config', 'security-overrides.json');
const TRASH_DIR = path.join(CLIENT_ROOT, 'trash');

module.exports = function(app) {

// ─── Policy ──────────────────────────────────────────────────
app.get('/api/security/policy', (req, res) => {
  try {
    const policy = getConfigWithFallback(POLICY_PATH, 'landlockPolicy');
    const overrides = fs.existsSync(OVERRIDES_PATH)
      ? JSON.parse(fs.readFileSync(OVERRIDES_PATH, 'utf8'))
      : { custom_rules: [] };
    // Check security layers available
    const guardExists = fs.existsSync('/opt/AIWH/bin/landlock-guard');
    const safeBashExists = fs.existsSync('/opt/AIWH/core/scripts/safe-bash.sh');
    res.json({ policy, overrides, guardAvailable: guardExists, safeBashActive: safeBashExists });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Audit Log ───────────────────────────────────────────────
app.get('/api/security/audit', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const outcome = req.query.outcome || null; // filter by outcome
  const agent = req.query.agent || null;     // filter by agent_id
  const entries = [];

  try {
    if (!fs.existsSync(AUDIT_LOG)) {
      return res.json({ entries: [], total: 0 });
    }
    // Read last N lines efficiently (read backwards)
    const content = fs.readFileSync(AUDIT_LOG, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    // Process from newest to oldest
    for (let i = lines.length - 1; i >= 0 && entries.length < limit; i--) {
      try {
        const entry = JSON.parse(lines[i]);
        if (outcome && entry.outcome !== outcome) continue;
        if (agent && entry.agent_id !== agent) continue;
        entries.push(entry);
      } catch { /* skip malformed lines */ }
    }
    // Summary stats
    const allEntries = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const today = new Date().toISOString().slice(0, 10);
    const todayEntries = allEntries.filter(e => e.timestamp?.startsWith(today));
    const stats = {
      total: allEntries.length,
      today: {
        allowed: todayEntries.filter(e => e.outcome === 'allowed').length,
        redirected: todayEntries.filter(e => e.outcome === 'redirected_to_trash').length,
        blocked: todayEntries.filter(e => e.outcome === 'kernel_blocked').length,
        policy: todayEntries.filter(e => e.outcome === 'policy_applied').length,
      },
    };
    res.json({ entries, stats });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Trash Management ────────────────────────────────────────
app.get('/api/security/trash', (req, res) => {
  try {
    if (!fs.existsSync(TRASH_DIR)) {
      return res.json({ items: [], totalSize: 0 });
    }
    const items = [];
    let totalSize = 0;
    // List date directories
    const dateDirs = fs.readdirSync(TRASH_DIR).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse();
    for (const dateDir of dateDirs) {
      const dirPath = path.join(TRASH_DIR, dateDir);
      const stat = fs.statSync(dirPath);
      if (!stat.isDirectory()) continue;
      const files = fs.readdirSync(dirPath);
      for (const file of files) {
        // Skip .origin metadata files — they're read alongside their parent
        if (file.endsWith('.origin')) continue;
        const filePath = path.join(dirPath, file);
        try {
          const fileStat = fs.statSync(filePath);
          const trashedAt = new Date(dateDir + 'T00:00:00Z');
          const expiresAt = new Date(trashedAt.getTime() + 48 * 60 * 60 * 1000);
          // Read origin path from .origin metadata file
          let originPath = '';
          try {
            const originFile = filePath + '.origin';
            if (fs.existsSync(originFile)) {
              originPath = fs.readFileSync(originFile, 'utf8').trim();
            }
          } catch {}
          items.push({
            name: file,
            date: dateDir,
            path: filePath,
            size: fileStat.size,
            originPath: originPath || '',
            trashedAt: trashedAt.toISOString(),
            expiresAt: expiresAt.toISOString(),
            expired: new Date() > expiresAt,
          });
          totalSize += fileStat.size;
        } catch { /* skip unreadable files */ }
      }
    }
    res.json({ items, totalSize });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Restore a trashed file
app.post('/api/security/trash/restore', (req, res) => {
  const { trashPath, restorePath } = req.body;
  if (!trashPath || !restorePath) return res.status(400).json({ error: 'trashPath and restorePath required' });
  // Validate paths
  if (!trashPath.startsWith(TRASH_DIR)) return res.status(400).json({ error: 'Invalid trash path' });
  if (!restorePath.startsWith('/opt/AIWH/')) return res.status(400).json({ error: 'Invalid restore path' });
  try {
    if (!fs.existsSync(trashPath)) return res.status(404).json({ error: 'File not found in trash' });
    const restoreDir = path.dirname(restorePath);
    fs.mkdirSync(restoreDir, { recursive: true });
    fs.renameSync(trashPath, restorePath);
    // Log the restore
    const ts = new Date().toISOString();
    const logEntry = JSON.stringify({
      timestamp: ts, agent_id: 'dashboard', tool: 'dashboard',
      action: 'restore', target_path: restorePath,
      outcome: 'trash_restored', detail: `restored from ${trashPath}`
    });
    fs.appendFileSync(AUDIT_LOG, logEntry + '\n');
    res.json({ ok: true, restored: restorePath });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Client Security Overrides ───────────────────────────────
app.get('/api/security/overrides', (req, res) => {
  try {
    const overrides = fs.existsSync(OVERRIDES_PATH)
      ? JSON.parse(fs.readFileSync(OVERRIDES_PATH, 'utf8'))
      : { custom_rules: [] };
    res.json(overrides);
  } catch (e) {
    res.json({ custom_rules: [] });
  }
});

app.put('/api/security/overrides', (req, res) => {
  const { custom_rules, _audit_detail } = req.body;
  if (!Array.isArray(custom_rules)) return res.status(400).json({ error: 'custom_rules must be array' });
  try {
    const overrides = { custom_rules, updatedAt: new Date().toISOString() };
    fs.writeFileSync(OVERRIDES_PATH, JSON.stringify(overrides, null, 2), { mode: 0o600 });
    // Log with specific detail about what changed
    const detail = _audit_detail || `${custom_rules.length} custom rules — paths: ${custom_rules.map(r => r.path?.replace('/opt/AIWH/', '')).join(', ') || 'none'}`;
    const logEntry = JSON.stringify({
      timestamp: new Date().toISOString(), agent_id: 'dashboard', tool: 'dashboard',
      action: 'policy_change', target_path: OVERRIDES_PATH,
      outcome: 'policy_changed', detail,
    });
    fs.appendFileSync(AUDIT_LOG, logEntry + '\n');
    res.json({ ok: true, note: 'Trash-redirect overrides take effect immediately. Kernel protection is immutable.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

}; // end module.exports
