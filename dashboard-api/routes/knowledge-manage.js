// ─── Knowledge Management Routes ─────────────────────────────
// Search, add, edit, promote, delete, stats, paginated listing
const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { getSecret, loadSecrets } = require('../helpers/secret-loader');

const aiwhPaths = require('../../scripts/lib/paths');
const KNOWLEDGE_DB = aiwhPaths.KNOWLEDGE_DB;
const PYTHON = aiwhPaths.PYTHON;

function getIngestEnv() {
  const env = { ...process.env, PATH: `/opt/homebrew/bin:/opt/homebrew/sbin:${process.env.PATH || '/usr/bin:/bin'}` };
  try {
    const { buildScriptEnv } = require('../helpers/secret-loader');
    return buildScriptEnv();
  } catch { return env; }
}

module.exports = (app, deps) => {
  const { dashLog } = deps;

  // ─── Capabilities + agent display names ────────────────────────
  app.get('/api/knowledge/capabilities', (req, res) => {
    const secrets = loadSecrets('SUPABASE_URL', 'SUPABASE_SERVICE_KEY');
    // Build agent display name map from org-chart
    const agentNames = { all: 'All Agents' };
    try {
      const chart = JSON.parse(fs.readFileSync(path.join(__dirname, '../org-chart.json'), 'utf8'));
      const walk = (node) => {
        if (node.id && node.displayName) agentNames[node.id] = node.displayName;
        (node.reports || []).forEach(walk);
      };
      walk(chart.hierarchy);
    } catch {}
    res.json({ canWriteBase: !!(secrets.SUPABASE_URL && secrets.SUPABASE_SERVICE_KEY), agentNames });
  });

  // ─── Search ───────────────────────────────────────────────────
  app.get('/api/knowledge/search', (req, res) => {
    const q = req.query.q;
    if (!q || q.length < 3) return res.status(400).json({ error: 'Query must be at least 3 characters' });
    const env = getIngestEnv();
    try {
      const result = execSync(
        `bash /opt/AIWH/core/scripts/knowledge-search-unified.sh --query "${q.replace(/"/g, '')}" --agent all --count 10`,
        { encoding: 'utf8', timeout: 30000, env, maxBuffer: 1024 * 1024 }
      );
      res.json({ results: JSON.parse(result), query: q });
    } catch (e) {
      try { res.json({ results: JSON.parse(e.stdout || '[]'), query: q }); }
      catch { res.status(500).json({ error: 'Search failed: ' + (e.message || '').substring(0, 200) }); }
    }
  });

  // ─── Get full entry ───────────────────────────────────────────
  app.get('/api/knowledge/entry/:id', (req, res) => {
    const id = parseInt(req.params.id);
    const source = req.query.source || 'client';
    if (!id) return res.status(400).json({ error: 'Invalid ID' });
    try {
      const sqlite = require('better-sqlite3');
      if (source === 'base') {
        const basePath = (process.env.CLIENT_ROOT || '/opt/AIWH/client') + '/data/base_knowledge_cache.db';
        if (!fs.existsSync(basePath)) return res.status(404).json({ error: 'Base DB not found' });
        const db = sqlite(basePath, { readonly: true });
        const row = db.prepare('SELECT * FROM base_knowledge WHERE id=?').get(id);
        db.close();
        return row ? res.json(row) : res.status(404).json({ error: 'Not found' });
      }
      if (!fs.existsSync(KNOWLEDGE_DB)) return res.status(404).json({ error: 'Client DB not found' });
      const db = sqlite(KNOWLEDGE_DB, { readonly: true });
      const row = db.prepare('SELECT * FROM client_knowledge WHERE id=?').get(id);
      db.close();
      row ? res.json(row) : res.status(404).json({ error: 'Not found' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── Edit client entry ────────────────────────────────────────
  app.put('/api/knowledge/entry/:id', (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid ID' });
    const { content, category, knowledge_type } = req.body;
    if (!content) return res.status(400).json({ error: 'content required' });
    try {
      const sqlite = require('better-sqlite3');
      const db = sqlite(KNOWLEDGE_DB);
      // Clear embedding so it gets re-embedded on next pipeline run
      const result = db.prepare("UPDATE client_knowledge SET content=?, category=?, knowledge_type=?, embedding=NULL, updated_at=datetime('now') WHERE id=?")
        .run(content, category || 'general', knowledge_type || 'fact', id);
      db.close();
      if (result.changes === 0) return res.status(404).json({ error: 'Entry not found' });
      dashLog('knowledge', `Edited client knowledge #${id}`);
      // Trigger async re-embedding
      const env = getIngestEnv();
      spawn(PYTHON, ['/opt/AIWH/core/scripts/embed-client-knowledge.py'], { env, stdio: 'ignore', detached: true }).unref();
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── Add entry (manual) ───────────────────────────────────────
  app.post('/api/knowledge/add', async (req, res) => {
    const { content, category, knowledge_type, target_agents, target } = req.body;
    if (!content || !category) return res.status(400).json({ error: 'content and category required' });

    const entry = {
      content: content.trim(), category: category.trim(),
      knowledge_type: knowledge_type || 'fact',
      target_agents: target_agents || ['all'],
      status: 'draft', source: target === 'base' ? 'manual:admin' : 'manual:client', version: 1,
    };

    if (target === 'base') {
      const secrets = loadSecrets('SUPABASE_URL', 'SUPABASE_SERVICE_KEY');
      if (!secrets.SUPABASE_URL || !secrets.SUPABASE_SERVICE_KEY) {
        return res.status(500).json({ error: 'Supabase credentials not configured' });
      }
      try {
        const url = new URL(`${secrets.SUPABASE_URL}/rest/v1/base_knowledge`);
        const result = await new Promise((resolve, reject) => {
          const r = https.request(url, {
            method: 'POST',
            headers: { 'apikey': secrets.SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${secrets.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
            timeout: 15000,
          }, (response) => { let data = ''; response.on('data', c => data += c); response.on('end', () => resolve({ status: response.statusCode, data })); });
          r.on('error', reject);
          r.end(JSON.stringify(entry));
        });
        if (result.status >= 200 && result.status < 300) {
          const created = JSON.parse(result.data);
          const id = Array.isArray(created) ? created[0]?.id : created?.id;
          dashLog('knowledge', `Added base knowledge: ${category}/${knowledge_type}`);
          const env = getIngestEnv();
          spawn('bash', ['/opt/AIWH/core/scripts/batch-embed.sh', '--limit', '5'], { env, stdio: 'ignore', detached: true }).unref();
          res.json({ ok: true, id, target: 'base', status: 'draft' });
        } else {
          res.status(500).json({ error: `Supabase error: ${result.data}` });
        }
      } catch (e) { res.status(500).json({ error: e.message }); }
    } else {
      try {
        const sqlite = require('better-sqlite3');
        const db = sqlite(KNOWLEDGE_DB);
        const hash = require('crypto').createHash('sha256').update(content.trim()).digest('hex').slice(0, 16);
        const r = db.prepare(`INSERT OR IGNORE INTO client_knowledge (content, category, knowledge_type, target_agents, status, source, content_hash) VALUES (?, ?, ?, ?, 'draft', ?, ?)`)
          .run(content.trim(), category.trim(), knowledge_type || 'fact', JSON.stringify(target_agents || ['all']), 'manual:client', hash);
        db.close();
        if (r.changes > 0) {
          dashLog('knowledge', `Added client knowledge: ${category}/${knowledge_type}`);
          const env = getIngestEnv();
          spawn(PYTHON, ['/opt/AIWH/core/scripts/embed-client-knowledge.py'], { env, stdio: 'ignore', detached: true }).unref();
          res.json({ ok: true, id: r.lastInsertRowid, target: 'client', status: 'draft' });
        } else { res.json({ ok: false, error: 'Duplicate content (already exists)' }); }
      } catch (e) { res.status(500).json({ error: e.message }); }
    }
  });

  // ─── Market Signals ──────────────────────────────────────────────
  app.get('/api/knowledge/market-signals', (req, res) => {
    try {
      const sqlite = require('better-sqlite3');
      if (!fs.existsSync(KNOWLEDGE_DB)) return res.json({ signals: [] });
      const db = sqlite(KNOWLEDGE_DB, { readonly: true });
      const signals = db.prepare(
        `SELECT id, content, created_at FROM client_knowledge
         WHERE category='market-signal' AND is_archived=0
         ORDER BY created_at DESC LIMIT 20`
      ).all();
      db.close();
      res.json({ signals });
    } catch (e) { res.json({ signals: [] }); }
  });

  // ─── Stats ────────────────────────────────────────────────────
  app.get('/api/knowledge/stats', (req, res) => {
    try {
      const sqlite = require('better-sqlite3');
      const stats = { base: {}, client: {} };
      const basePath = (process.env.CLIENT_ROOT || '/opt/AIWH/client') + '/data/base_knowledge_cache.db';
      if (fs.existsSync(basePath)) {
        const db = sqlite(basePath, { readonly: true });
        stats.base = { total: db.prepare('SELECT COUNT(*) as c FROM base_knowledge WHERE is_archived=0').get()?.c || 0,
          categories: db.prepare("SELECT category, COUNT(*) as c FROM base_knowledge WHERE is_archived=0 AND status='published' GROUP BY category ORDER BY c DESC").all(),
          latestUpdate: db.prepare('SELECT MAX(updated_at) as d FROM base_knowledge').get()?.d || 'unknown' };
        db.close();
      }
      if (fs.existsSync(KNOWLEDGE_DB)) {
        const db = sqlite(KNOWLEDGE_DB, { readonly: true });
        stats.client = { total: db.prepare('SELECT COUNT(*) as c FROM client_knowledge WHERE is_archived=0').get()?.c || 0,
          published: db.prepare("SELECT COUNT(*) as c FROM client_knowledge WHERE status='published'").get()?.c || 0,
          drafts: db.prepare("SELECT COUNT(*) as c FROM client_knowledge WHERE status='draft'").get()?.c || 0,
          categories: db.prepare('SELECT category, COUNT(*) as c FROM client_knowledge WHERE is_archived=0 GROUP BY category ORDER BY c DESC').all(),
          sources: db.prepare('SELECT source, COUNT(*) as c FROM client_knowledge WHERE is_archived=0 GROUP BY source ORDER BY c DESC').all(),
          latestEntry: db.prepare('SELECT MAX(created_at) as d FROM client_knowledge').get()?.d || 'unknown' };
        // Dreaming-sourced entries (from .openclaw/agents/*/MEMORY.md via LLM extraction)
        stats.dreaming = {
          total: db.prepare("SELECT COUNT(*) as c FROM client_knowledge WHERE source LIKE '%/.openclaw/agents/%' OR source LIKE 'llm-extract:%.openclaw%'").get()?.c || 0,
        };
        db.close();
      }
      res.json(stats);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── Paginated entries ────────────────────────────────────────
  app.get('/api/knowledge/recent', (req, res) => {
    try {
      const sqlite = require('better-sqlite3');
      const source = req.query.source || 'all';
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = Math.min(100, Math.max(10, parseInt(req.query.limit) || 50));
      const statusFilter = req.query.status || 'all';
      const textSearch = (req.query.q || '').trim();
      const offset = (page - 1) * limit;
      const entries = [];
      let totalBase = 0, totalClient = 0;
      const basePath = (process.env.CLIENT_ROOT || '/opt/AIWH/client') + '/data/base_knowledge_cache.db';
      const statusWhere = (s) => {
        let w = s === 'all' ? 'is_archived=0' : `is_archived=0 AND status='${s === 'draft' ? 'draft' : 'published'}'`;
        if (textSearch) w += ` AND content LIKE '%' || ? || '%'`;
        return w;
      };
      const params = textSearch ? [textSearch] : [];

      if (source !== 'client' && fs.existsSync(basePath)) {
        const db = sqlite(basePath, { readonly: true });
        const w = statusWhere(statusFilter);
        totalBase = db.prepare(`SELECT COUNT(*) as c FROM base_knowledge WHERE ${w}`).get(...params)?.c || 0;
        db.prepare(`SELECT id, content, category, knowledge_type, status, source, target_agents, created_at FROM base_knowledge WHERE ${w} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
          .all(...params, limit, offset).forEach(r => entries.push({ ...r, target: 'base', content: r.content?.substring(0, 200) }));
        db.close();
      }
      if (source !== 'base' && fs.existsSync(KNOWLEDGE_DB)) {
        const db = sqlite(KNOWLEDGE_DB, { readonly: true });
        const w = statusWhere(statusFilter);
        totalClient = db.prepare(`SELECT COUNT(*) as c FROM client_knowledge WHERE ${w}`).get(...params)?.c || 0;
        db.prepare(`SELECT id, content, category, knowledge_type, status, source, target_agents, created_at FROM client_knowledge WHERE ${w} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
          .all(...params, limit, offset).forEach(r => entries.push({ ...r, target: 'client', content: r.content?.substring(0, 200) }));
        db.close();
      }
      entries.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
      const total = source === 'base' ? totalBase : source === 'client' ? totalClient : totalBase + totalClient;
      res.json({ entries: entries.slice(0, limit), total, page, limit, totalPages: Math.ceil(total / limit) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── Delete client entries ────────────────────────────────────
  app.post('/api/knowledge/delete', (req, res) => {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids array required' });
    try {
      const sqlite = require('better-sqlite3');
      const db = sqlite(KNOWLEDGE_DB);
      const result = db.prepare(`DELETE FROM client_knowledge WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);
      db.close();
      dashLog('knowledge', `Deleted ${result.changes} client knowledge entries`);
      res.json({ ok: true, deleted: result.changes });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── Promote client → base ────────────────────────────────────
  app.post('/api/knowledge/promote', async (req, res) => {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids array required' });
    if (ids.length > 50) return res.status(400).json({ error: 'Max 50 at a time' });
    const secrets = loadSecrets('SUPABASE_URL', 'SUPABASE_SERVICE_KEY');
    if (!secrets.SUPABASE_URL || !secrets.SUPABASE_SERVICE_KEY) {
      return res.status(403).json({ error: 'Supabase credentials not available' });
    }
    try {
      const sqlite = require('better-sqlite3');
      const db = sqlite(KNOWLEDGE_DB, { readonly: true });
      const rows = db.prepare(`SELECT content, category, knowledge_type, target_agents, source FROM client_knowledge WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
      db.close();
      if (rows.length === 0) return res.json({ ok: true, promoted: 0 });
      let promoted = 0;
      for (const row of rows) {
        const entry = { content: row.content, category: row.category, knowledge_type: row.knowledge_type || 'fact',
          target_agents: row.target_agents ? JSON.parse(row.target_agents) : ['all'],
          status: 'draft', source: `promoted:${row.source || 'client'}`, version: 1 };
        const url = new URL(`${secrets.SUPABASE_URL}/rest/v1/base_knowledge`);
        const result = await new Promise((resolve, reject) => {
          const r = https.request(url, { method: 'POST',
            headers: { 'apikey': secrets.SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${secrets.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
            timeout: 15000 }, (response) => { let data = ''; response.on('data', c => data += c); response.on('end', () => resolve({ status: response.statusCode })); });
          r.on('error', reject); r.end(JSON.stringify(entry));
        });
        if (result.status >= 200 && result.status < 300) promoted++;
      }
      dashLog('knowledge', `Promoted ${promoted}/${rows.length} entries client → base`);
      const env = getIngestEnv();
      spawn('bash', ['/opt/AIWH/core/scripts/batch-embed.sh', '--limit', '50'], { env, stdio: 'ignore', detached: true }).unref();
      res.json({ ok: true, promoted });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── Knowledge Freshness ──────────────────────────────────────
  app.get('/api/knowledge/freshness', (req, res) => {
    try {
      const sqlite = require('better-sqlite3');
      const basePath = (process.env.CLIENT_ROOT || '/opt/AIWH/client') + '/data/base_knowledge_cache.db';
      if (!fs.existsSync(basePath)) return res.json({ overall: 'unknown', categories: [] });
      const db = sqlite(basePath, { readonly: true });
      const rows = db.prepare(`
        SELECT category, MAX(updated_at) as last_updated, COUNT(*) as entry_count
        FROM base_knowledge
        WHERE is_archived=0 AND status='published'
        GROUP BY category ORDER BY last_updated DESC
      `).all();
      db.close();
      const now = Date.now();
      const STALE_30 = 30 * 24 * 60 * 60 * 1000;
      const STALE_60 = 60 * 24 * 60 * 60 * 1000;
      const categories = rows.map(r => {
        const age = r.last_updated ? now - new Date(r.last_updated).getTime() : Infinity;
        return {
          name: r.category, lastUpdated: r.last_updated, entryCount: r.entry_count,
          status: age > STALE_60 ? 'critical' : age > STALE_30 ? 'stale' : 'healthy',
        };
      });
      const worst = categories.reduce((w, c) => {
        if (c.status === 'critical') return 'critical';
        if (c.status === 'stale' && w !== 'critical') return 'stale';
        return w;
      }, 'healthy');
      res.json({ overall: worst, categories });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
};
