// ─── Routes: Projects ────────────────────────────────────────
const fs = require('fs');
const path = require('path');

module.exports = function(app, deps) {
  const { db, io, logActivity } = deps;

app.get('/api/projects', (req, res) => {
  const projects = db.prepare(`
    SELECT p.*,
      (SELECT COUNT(*) FROM tasks WHERE project_id=p.id AND status != 'done') as active_tasks,
      (SELECT COUNT(*) FROM tasks WHERE project_id=p.id AND status = 'done') as done_tasks,
      (SELECT COUNT(*) FROM tasks WHERE project_id=p.id) as total_tasks
    FROM projects p WHERE p.archived = 0 ORDER BY p.created_at
  `).all();
  res.json(projects);
});

app.post('/api/projects', (req, res) => {
  const { name, slug, description, workspace_paths, linked_agents, color, icon, status } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const s = slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  // Validate workspace paths exist (must be real directories, no folder creation)
  const paths = Array.isArray(workspace_paths) ? workspace_paths : [];
  for (const p of paths) {
    const resolved = path.resolve(p);
    if (!resolved.startsWith('/opt/AIWH/')) return res.status(400).json({ error: `Path outside allowed scope: ${p}` });
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      return res.status(400).json({ error: `Directory does not exist: ${p}` });
    }
  }
  const agents = Array.isArray(linked_agents) ? linked_agents : [];
  try {
    const r = db.prepare(
      'INSERT INTO projects (slug, name, description, workspace_paths, linked_agents, status, color, icon) VALUES (?,?,?,?,?,?,?,?)'
    ).run(s, name, description || '', JSON.stringify(paths), JSON.stringify(agents), status || 'active', color || '#6366f1', icon || '📁');
    logActivity(r.lastInsertRowid, '', 'project_created', name);
    res.json({ id: r.lastInsertRowid, slug: s });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/projects/:id', (req, res) => {
  const { name, description, workspace_paths, linked_agents, status, color, icon } = req.body;
  // Validate workspace paths if provided
  if (workspace_paths !== undefined) {
    const paths = Array.isArray(workspace_paths) ? workspace_paths : [];
    for (const p of paths) {
      const resolved = path.resolve(p);
      if (!resolved.startsWith('/opt/AIWH/')) return res.status(400).json({ error: `Path outside allowed scope: ${p}` });
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
        return res.status(400).json({ error: `Directory does not exist: ${p}` });
      }
    }
  }
  const fields = [];
  const vals = [];
  if (name !== undefined) { fields.push('name=?'); vals.push(name); }
  if (description !== undefined) { fields.push('description=?'); vals.push(description); }
  if (workspace_paths !== undefined) { fields.push('workspace_paths=?'); vals.push(JSON.stringify(workspace_paths)); }
  if (linked_agents !== undefined) { fields.push('linked_agents=?'); vals.push(JSON.stringify(linked_agents)); }
  if (status !== undefined) { fields.push('status=?'); vals.push(status); }
  if (color !== undefined) { fields.push('color=?'); vals.push(color); }
  if (icon !== undefined) { fields.push('icon=?'); vals.push(icon); }
  if (fields.length === 0) return res.json({ ok: true });
  fields.push("updated_at=datetime('now')");
  vals.push(req.params.id);
  db.prepare(`UPDATE projects SET ${fields.join(',')} WHERE id=?`).run(...vals);
  res.json({ ok: true });
});

app.get('/api/projects/:id', (req, res) => {
  const project = db.prepare(`
    SELECT p.*,
      (SELECT COUNT(*) FROM tasks WHERE project_id=p.id AND status != 'done') as active_tasks,
      (SELECT COUNT(*) FROM tasks WHERE project_id=p.id AND status = 'done') as done_tasks,
      (SELECT COUNT(*) FROM tasks WHERE project_id=p.id) as total_tasks
    FROM projects p WHERE p.id=?
  `).get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Not found' });
  // Parse JSON fields
  try { project.workspace_paths = JSON.parse(project.workspace_paths || '[]'); } catch { project.workspace_paths = []; }
  try { project.linked_agents = JSON.parse(project.linked_agents || '[]'); } catch { project.linked_agents = []; }
  // Get assigned agents from project_agents table too
  const assignedAgents = db.prepare('SELECT agent_id FROM project_agents WHERE project_id=?').all(req.params.id);
  project.assigned_agents = assignedAgents.map(a => a.agent_id);
  res.json(project);
});

// Project-scoped file browsing — only from linked workspace paths
app.get('/api/projects/:id/files', (req, res) => {
  const project = db.prepare('SELECT workspace_paths FROM projects WHERE id=?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  let workspacePaths;
  try { workspacePaths = JSON.parse(project.workspace_paths || '[]'); } catch { workspacePaths = []; }

  const browsePath = req.query.path;
  if (browsePath) {
    // Validate the path is within one of the workspace paths (canonicalize to prevent traversal)
    const resolvedBrowse = path.resolve(browsePath);
    if (!resolvedBrowse.startsWith('/opt/AIWH/')) return res.status(403).json({ error: 'Path outside allowed scope' });
    const allowed = workspacePaths.some(wp => resolvedBrowse === wp || resolvedBrowse.startsWith(wp + '/'));
    if (!allowed) return res.status(403).json({ error: 'Path not within project workspace' });
    try {
      const entries = fs.readdirSync(resolvedBrowse, { withFileTypes: true });
      const items = entries
        .filter(e => !e.name.startsWith('.') || e.name === '.openclaw')
        .map(e => {
          const full = path.join(resolvedBrowse, e.name);
          let size = 0;
          try { size = fs.statSync(full).size; } catch {}
          return { name: e.name, path: full, isDir: e.isDirectory(), size };
        })
        .sort((a, b) => { if (a.isDir !== b.isDir) return a.isDir ? -1 : 1; return a.name.localeCompare(b.name); });
      res.json({ path: resolvedBrowse, items });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  } else {
    // Return top-level listing of all workspace roots
    const roots = workspacePaths.map(wp => {
      let exists = false;
      try { exists = fs.existsSync(wp) && fs.statSync(wp).isDirectory(); } catch {}
      return { name: path.basename(wp), path: wp, isDir: true, exists };
    });
    res.json({ path: null, workspace_roots: roots, items: roots });
  }
});

app.delete('/api/projects/:id', (req, res) => {
  // Logical delete only — NEVER touches filesystem
  db.prepare('UPDATE projects SET archived=1 WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

};
