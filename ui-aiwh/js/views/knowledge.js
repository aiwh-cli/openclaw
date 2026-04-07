// ─── Knowledge View ──────────────────────────────────────────
// Dashboard UI for knowledge management: stats, add entries, recent items, upload.

let _kbCanWriteBase = false;
let _kbPage = 1;
let _kbSource = 'all';
let _kbStatus = 'all';
let _kbSelectedIds = new Set();
let _kbAgentNames = {}; // id → display name from org-chart

async function loadKnowledge() {
  const root = document.getElementById('knowledge-root');
  if (!root) {return;}

  root.innerHTML = '<p style="color:var(--text-muted)">Loading knowledge stats...</p>';

  try {
    const [stats, caps, freshness, dreams] = await Promise.all([
      api('/knowledge/stats'),
      api('/knowledge/capabilities'),
      api('/knowledge/freshness').catch(() => ({ overall: 'unknown', categories: [] })),
      api('/knowledge/dreams/status').catch(() => ({ ok: false })),
    ]);
    _kbCanWriteBase = caps?.canWriteBase || false;
    _kbAgentNames = caps?.agentNames || {};
    stats._freshness = freshness;
    stats._dreams = dreams?.dreaming || null;

    root.innerHTML = `
      ${_renderStats(stats)}
      ${_renderAddForm()}
      ${_renderSearchBar()}
      <div id="kb-entries-root"></div>
      <div id="kb-market-signals" style="margin-top:24px"></div>
      <div style="margin-top:24px">
        <h3 style="font-size:14px;margin-bottom:12px;color:var(--text-secondary)">Document Upload</h3>
        <knowledge-upload></knowledge-upload>
      </div>
    `;

    _wireAddForm();
    _wireSearch();
    _wireDreamsCard();
    await _loadEntries();
    _loadMarketSignals();
  } catch (e) {
    root.innerHTML = `<p style="color:var(--danger)">Failed to load knowledge: ${escHtml(e.message)}</p>`;
  }
}

function _renderStats(stats) {
  const b = stats.base || {};
  const c = stats.client || {};
  const f = stats._freshness || {};
  const topCats = (b.categories || []).slice(0, 6).map(
    cat => `<span class="chip">${escHtml(cat.category)} <b>${cat.c}</b></span>`
  ).join(' ');

  const healthColor = { healthy: 'var(--success, #22c55e)', stale: 'var(--warning, #eab308)', critical: 'var(--danger, #ef4444)', unknown: 'var(--text-muted)' };
  const healthLabel = { healthy: 'Healthy', stale: 'Some Stale', critical: 'Needs Update', unknown: 'Unknown' };
  const hc = healthColor[f.overall] || healthColor.unknown;
  const hl = healthLabel[f.overall] || 'Unknown';
  const freshCats = (f.categories || []).slice(0, 5).map(cat =>
    `<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);padding:2px 0">` +
    `<span>${escHtml(cat.name)}</span><span style="color:${healthColor[cat.status]}">${_timeAgo(cat.lastUpdated)}</span></div>`
  ).join('');

  return `
    <div class="knowledge-stats">
      <div class="stat-card">
        <div class="stat-label">Base Knowledge</div>
        <div class="stat-value">${b.total || 0}</div>
        <div class="stat-sub">Shared across all clients</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Client Knowledge</div>
        <div class="stat-value">${c.total || 0}</div>
        <div class="stat-sub">${c.published || 0} published · ${c.drafts || 0} drafts</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Last Updated</div>
        <div class="stat-value" style="font-size:14px">${_timeAgo(b.latestUpdate || c.latestEntry)}</div>
        <div class="stat-sub">Most recent entry</div>
      </div>
      <div class="stat-card" id="kb-freshness-card" style="cursor:pointer" onclick="document.getElementById('kb-freshness-detail').style.display=document.getElementById('kb-freshness-detail').style.display==='none'?'block':'none'">
        <div class="stat-label">Knowledge Health</div>
        <div class="stat-value" style="font-size:16px;display:flex;align-items:center;gap:8px">
          <span style="width:10px;height:10px;border-radius:50%;background:${hc};display:inline-block"></span> ${hl}
        </div>
        <div class="stat-sub">Click to expand</div>
        <div id="kb-freshness-detail" style="display:none;margin-top:8px;border-top:1px solid var(--border);padding-top:6px">${freshCats || '<span style="font-size:11px;color:var(--text-muted)">No data</span>'}</div>
      </div>
      ${_renderDreamsCard(stats._dreams)}
    </div>
    <div style="margin:12px 0;display:flex;flex-wrap:wrap;gap:6px">${topCats}</div>
  `;
}

function _renderDreamsCard(dreams) {
  if (!dreams) {
    return `<div class="stat-card">
      <div class="stat-label">Learned Overnight</div>
      <div class="stat-value" style="font-size:14px;color:var(--text-muted)">—</div>
      <div class="stat-sub">Could not reach gateway</div>
    </div>`;
  }
  if (!dreams.enabled) {
    return `<div class="stat-card" id="kb-dreams-card" style="cursor:pointer">
      <div class="stat-label">Learned Overnight</div>
      <div class="stat-value" style="font-size:14px;color:var(--text-muted)">Off</div>
      <div class="stat-sub">Your AI team can learn from conversations overnight</div>
      <div id="kb-dreams-toggle" style="margin-top:6px"><button class="btn btn-xs btn-ghost" data-action="enable">Turn on</button></div>
    </div>`;
  }
  const promoted = dreams.promotedToday || 0;
  const total = dreams.promotedTotal || 0;
  const buf = dreams.shortTermCount || 0;
  return `<div class="stat-card" id="kb-dreams-card" style="cursor:pointer">
    <div class="stat-label">Learned Overnight</div>
    <div class="stat-value" style="color:#4CAF7A">${promoted}</div>
    <div class="stat-sub">${total} total promoted · ${buf} signals buffered</div>
    <div class="stat-sub" style="margin-top:2px;font-size:10px;color:var(--text-muted)">Click to see diary</div>
    <div id="kb-dreams-detail" style="display:none;margin-top:8px;border-top:1px solid var(--border);padding-top:6px">
      <dreams-diary></dreams-diary>
    </div>
  </div>`;
}

function _wireDreamsCard() {
  const card = document.getElementById('kb-dreams-card');
  if (!card) {return;}
  const toggle = card.querySelector('[data-action="enable"]');
  if (toggle) {
    toggle.onclick = async (e) => {
      e.stopPropagation();
      toggle.disabled = true; toggle.textContent = 'Enabling...';
      try {
        await api('/knowledge/dreams/toggle', { method: 'POST', body: { enabled: true } });
        loadKnowledge();
      } catch { toggle.textContent = 'Failed'; }
    };
    return;
  }
  card.onclick = () => {
    const detail = document.getElementById('kb-dreams-detail');
    if (detail) {detail.style.display = detail.style.display === 'none' ? 'block' : 'none';}
  };
}

function _renderAddForm() {
  const categories = ['coaching', 'copywriting', 'video-pipeline', 'gohighlevel', 'stripe', 'xero', 'meta-ads', 'n8n', 'makecom', 'seo', 'cinematic', 'system', 'operational', 'general'];
  const types = ['fact', 'pattern', 'framework', 'anti-pattern', 'lesson_learned'];
  const agents = ['all', 'copywriter', 'video', 'research', 'social', 'sales', 'funnel', 'crm-manager', 'cfo', 'calendar-manager', 'email-manager', 'systems', 'coach', 'trading', 'travel', 'builder-manager', 'security-manager', 'ai-council', 'scheduler', 'module-manager'];

  const catOpts = categories.map(c => `<option value="${c}">${_catLabel(c)}</option>`).join('');
  const typeOpts = types.map(t => `<option value="${t}">${_catLabel(t)}</option>`).join('');
  const agentChips = agents.map(a => {
    const checked = a === 'all' ? 'checked' : '';
    const label = _agentLabel(a);
    return `<label class="agent-chip" style="display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border:1px solid var(--border);border-radius:12px;font-size:11px;cursor:pointer;user-select:none">
      <input type="checkbox" class="kb-agent-cb" value="${a}" ${checked} style="width:12px;height:12px;cursor:pointer"> ${escHtml(label)}
    </label>`;
  }).join(' ');

  return `
    <div class="knowledge-add-form" style="margin-top:16px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:12px;padding:16px">
      <h3 style="font-size:14px;margin:0 0 12px;color:var(--text-secondary)">Add Knowledge</h3>
      <textarea id="kb-content" rows="4" placeholder="Enter knowledge content — a fact, pattern, framework, or lesson learned..."
        style="width:100%;background:var(--bg-secondary);color:var(--text-primary);border:1px solid var(--border);border-radius:8px;padding:10px;font-size:13px;resize:vertical"></textarea>
      <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;align-items:center">
        <select id="kb-category" style="background:var(--bg-secondary);color:var(--text-primary);border:1px solid var(--border);border-radius:6px;padding:6px 10px;font-size:13px">
          ${catOpts}
        </select>
        <select id="kb-type" style="background:var(--bg-secondary);color:var(--text-primary);border:1px solid var(--border);border-radius:6px;padding:6px 10px;font-size:13px">
          ${typeOpts}
        </select>
      </div>
      <div style="margin-top:8px">
        <span style="font-size:12px;color:var(--text-muted)">Target agents:</span>
        <div id="kb-agents-wrap" style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px">${agentChips}</div>
      </div>
      <div style="display:flex;gap:8px;margin-top:10px;align-items:center">
        ${_kbCanWriteBase ? '<button class="btn btn-primary btn-sm" id="kb-add-base" title="Adds to product knowledge — syncs to all clients overnight">+ Product Knowledge</button>' : ''}
        <button class="btn ${_kbCanWriteBase ? 'btn-ghost' : 'btn-primary'} btn-sm" id="kb-add-client" title="Adds to your local knowledge — stays on this system only">+ My Knowledge</button>
        <span id="kb-status" style="font-size:12px;color:var(--text-muted)"></span>
      </div>
    </div>
  `;
}

function _wireAddForm() {
  const addBase = document.getElementById('kb-add-base');
  const addClient = document.getElementById('kb-add-client');
  if (addBase) {addBase.onclick = () => _submitKnowledge('base');}
  if (addClient) {addClient.onclick = () => _submitKnowledge('client');}

  // Agent chip toggle: "all" unchecks specifics, specifics uncheck "all"
  document.querySelectorAll('.kb-agent-cb').forEach(cb => {
    cb.onchange = () => {
      if (cb.value === 'all' && cb.checked) {
        document.querySelectorAll('.kb-agent-cb').forEach(c => { if (c.value !== 'all') {c.checked = false;} });
      } else if (cb.value !== 'all' && cb.checked) {
        const allCb = document.querySelector('.kb-agent-cb[value="all"]');
        if (allCb) {allCb.checked = false;}
      }
    };
  });

  // Wire select-all checkbox
  const selectAll = document.getElementById('kb-select-all');
  if (selectAll) {
    selectAll.onchange = () => {
      document.querySelectorAll('.kb-select').forEach(cb => { cb.checked = selectAll.checked; });
      _updatePromoteBtn();
    };
  }

  // Wire individual checkboxes
  document.querySelectorAll('.kb-select').forEach(cb => {
    cb.onchange = _updatePromoteBtn;
  });

  // Wire promote button
  const promoteBtn = document.getElementById('kb-promote-btn');
  if (promoteBtn) {promoteBtn.onclick = _promoteSelected;}
}

async function _promoteSelected() {
  const clientIds = Array.from(_kbSelectedIds)
    .filter(k => k.startsWith('client:'))
    .map(k => parseInt(k.split(':')[1]));
  if (clientIds.length === 0) {return;}

  const status = document.getElementById('kb-promote-status');
  const btn = document.getElementById('kb-promote-btn');
  if (btn) {btn.disabled = true;}
  if (status) {status.textContent = `Promoting ${clientIds.length} entries...`;}

  try {
    const res = await api('/knowledge/promote', { method: 'POST', body: { ids: clientIds } });
    if (res.ok) {
      clientIds.forEach(id => _kbSelectedIds.delete(`client:${id}`));
      if (status) {status.innerHTML = `<span style="color:var(--success)">Promoted ${res.promoted} entries to Supabase (will appear as Product after tonight's sync)</span>`;}
      setTimeout(() => loadKnowledge(), 1500);
    } else {
      if (status) {status.innerHTML = `<span style="color:var(--danger)">${escHtml(res.error || 'Failed')}</span>`;}
    }
  } catch (e) {
    if (status) {status.innerHTML = `<span style="color:var(--danger)">${escHtml(e.message)}</span>`;}
  }
  if (btn) {btn.disabled = false;}
}

async function _submitKnowledge(target) {
  const content = document.getElementById('kb-content')?.value?.trim();
  const category = document.getElementById('kb-category')?.value;
  const type = document.getElementById('kb-type')?.value;
  const status = document.getElementById('kb-status');

  // Read selected agents
  const agentCbs = document.querySelectorAll('.kb-agent-cb:checked');
  const selectedAgents = Array.from(agentCbs).map(cb => cb.value);
  const target_agents = selectedAgents.includes('all') ? ['all'] : selectedAgents;

  if (!content) { if (status) {status.textContent = 'Content is required';} return; }
  if (target_agents.length === 0) { if (status) {status.textContent = 'Select at least one agent';} return; }
  if (status) {status.textContent = 'Adding...';}

  try {
    const res = await api('/knowledge/add', {
      method: 'POST',
      body: { content, category, knowledge_type: type, target_agents, target },
    });
    if (res.ok) {
      const label = target === 'base' ? 'product knowledge (syncs to all clients overnight)' : 'your knowledge (local to this system)';
      if (status) {status.innerHTML = `<span style="color:var(--success)">Added to ${label} as draft</span>`;}
      document.getElementById('kb-content').value = '';
      setTimeout(() => loadKnowledge(), 1500);
    } else {
      if (status) {status.innerHTML = `<span style="color:var(--danger)">${escHtml(res.error || 'Failed')}</span>`;}
    }
  } catch (e) {
    if (status) {status.innerHTML = `<span style="color:var(--danger)">${escHtml(e.message)}</span>`;}
  }
}

async function _loadEntries() {
  const root = document.getElementById('kb-entries-root');
  if (!root) {return;}

  const qParam = _kbSearchQuery ? `&q=${encodeURIComponent(_kbSearchQuery)}` : '';
  const data = await api(`/knowledge/recent?source=${_kbSource}&page=${_kbPage}&limit=30&status=${_kbStatus}${qParam}`);
  if (!data || !data.entries) { root.innerHTML = '<p style="color:var(--text-muted)">No entries</p>'; return; }

  const { entries, total, page, totalPages } = data;

  const _p = 'padding:6px 8px';
  const rows = entries.map(e => {
    const badge = e.target === 'base' ? '<span class="chip chip-sm" style="background:var(--accent-glow);color:#fff">Product</span>' : '<span class="chip chip-sm">Local</span>';
    const stB = e.status === 'published' ? '<span style="color:var(--success)">&#9679;</span>' : '<span style="color:var(--warning)">&#9675;</span>';
    const src = e.source ? `<span style="color:var(--text-muted);font-size:11px">${escHtml(e.source)}</span>` : '';
    const iC = e.target === 'client', chk = _kbSelectedIds.has(`${e.target}:${e.id}`) ? 'checked' : '';
    const cb = iC ? `<input type="checkbox" class="kb-select" data-id="${e.id}" data-target="${e.target}" ${chk} style="cursor:pointer">` : '';
    const ed = iC ? `<button class="btn btn-xs btn-ghost kb-edit-btn" data-id="${e.id}">Edit</button>` : '';
    // Parse target_agents with display names
    let agents = 'All Agents';
    try { const a = typeof e.target_agents === 'string' ? JSON.parse(e.target_agents) : e.target_agents; agents = Array.isArray(a) ? a.map(id => _agentLabel(id)).join(', ') : 'All Agents'; } catch {}
    const agentBadge = `<span style="font-size:10px;color:var(--text-muted)">${escHtml(agents)}</span>`;
    return `<tr style="border-bottom:1px solid var(--border-subtle,rgba(255,255,255,0.04))"><td style="${_p}">${cb}</td><td style="${_p}">${stB}</td><td style="${_p}">${badge}</td><td style="${_p}"><span class="chip chip-sm">${escHtml(_catLabel(e.category))}</span></td><td style="${_p};max-width:350px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;cursor:${iC?'pointer':'default'}" ${iC?`onclick="_editEntry(${e.id})"`:''}>${escHtml(e.content||'')}</td><td style="${_p}">${agentBadge}</td><td style="${_p};font-size:12px;color:var(--text-muted)">${_timeAgo(e.created_at)}</td><td style="${_p}">${src} ${ed}</td></tr>`;
  }).join('');

  const _srcL = { all: 'All', client: 'My Knowledge', base: 'Product' };
  const srcBtns = ['all','client','base'].map(s => `<button class="btn btn-xs ${_kbSource===s?'btn-primary':'btn-ghost'}" onclick="_kbSource='${s}';_kbPage=1;_loadEntries()">${_srcL[s]}</button>`).join('');
  const statusBtns = ['all','published','draft'].map(s => `<button class="btn btn-xs ${_kbStatus===s?'btn-primary':'btn-ghost'}" onclick="_kbStatus='${s}';_kbPage=1;_loadEntries()">${s[0].toUpperCase()+s.slice(1)}</button>`).join('');
  const actionBar = `<div style="display:flex;align-items:center;gap:8px;margin:8px 0">
    <label style="font-size:12px;color:var(--text-muted);cursor:pointer"><input type="checkbox" id="kb-select-all" style="cursor:pointer"> Select all</label>
    ${_kbCanWriteBase ? '<button class="btn btn-primary btn-sm" id="kb-promote-btn" style="display:none">Promote to Product</button>' : ''}
    <button class="btn btn-ghost btn-sm" id="kb-delete-btn" style="display:none;color:var(--danger)">Delete Selected</button>
    <span id="kb-promote-status" style="font-size:12px;color:var(--text-muted)"></span></div>`;

  // Pagination
  const pageInfo = `<span style="font-size:12px;color:var(--text-muted)">${total} entries · Page ${page}/${totalPages || 1}</span>`;
  const prevBtn = page > 1 ? `<button class="btn btn-xs btn-ghost" onclick="_kbPage--;_loadEntries()">← Prev</button>` : '';
  const nextBtn = page < totalPages ? `<button class="btn btn-xs btn-ghost" onclick="_kbPage++;_loadEntries()">Next →</button>` : '';
  const selCount = _kbSelectedIds.size;
  const selInfo = selCount > 0 ? `<span class="chip chip-sm" style="background:var(--accent-glow);color:#fff">${selCount} selected</span>` : '';

  root.innerHTML = `
    <div style="margin-top:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <h3 style="font-size:14px;color:var(--text-secondary);margin:0">Knowledge Entries</h3>
        <div style="display:flex;gap:4px">${srcBtns} <span style="margin:0 4px;color:var(--border)">|</span> ${statusBtns}</div>
      </div>
      ${actionBar}
      <table style="width:100%;border-collapse:collapse">
        <thead><tr style="border-bottom:1px solid var(--border);font-size:12px;color:var(--text-muted)">
          <th style="padding:4px 8px;width:30px"></th><th style="padding:4px 8px;text-align:left">St</th><th style="padding:4px 8px;text-align:left">Source</th><th style="padding:4px 8px;text-align:left">Category</th><th style="padding:4px 8px;text-align:left">Content</th><th style="padding:4px 8px;text-align:left">Agents</th><th style="padding:4px 8px;text-align:left">When</th><th style="padding:4px 8px;text-align:left">Via</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
        <div style="display:flex;gap:6px;align-items:center">${prevBtn} ${pageInfo} ${nextBtn}</div>
        ${selInfo}
      </div>
    </div>
  `;

  // Wire checkboxes
  document.querySelectorAll('.kb-select').forEach(cb => {
    cb.onchange = () => {
      const key = `${cb.dataset.target}:${cb.dataset.id}`;
      if (cb.checked) {_kbSelectedIds.add(key);} else {_kbSelectedIds.delete(key);}
      _updateActionBtns();
    };
  });
  const selectAll = document.getElementById('kb-select-all');
  if (selectAll) {selectAll.onchange = () => {
    document.querySelectorAll('.kb-select').forEach(cb => {
      cb.checked = selectAll.checked;
      const key = `${cb.dataset.target}:${cb.dataset.id}`;
      if (selectAll.checked) _kbSelectedIds.add(key); else _kbSelectedIds.delete(key);
    });
    _updateActionBtns();
  };}
  const promoteBtn = document.getElementById('kb-promote-btn');
  if (promoteBtn) {promoteBtn.onclick = _promoteSelected;}
  const deleteBtn = document.getElementById('kb-delete-btn');
  if (deleteBtn) {deleteBtn.onclick = _deleteSelected;}
  document.querySelectorAll('.kb-edit-btn').forEach(b => { b.onclick = () => _editEntry(parseInt(b.dataset.id)); });
  _updateActionBtns();
}

function _updateActionBtns() {
  const count = _kbSelectedIds.size;
  const promoteBtn = document.getElementById('kb-promote-btn');
  const deleteBtn = document.getElementById('kb-delete-btn');
  if (promoteBtn) { promoteBtn.style.display = count > 0 ? '' : 'none'; promoteBtn.textContent = `Promote ${count} to Product`; }
  if (deleteBtn) { deleteBtn.style.display = count > 0 ? '' : 'none'; deleteBtn.textContent = `Delete ${count} Selected`; }
}

async function _deleteSelected() {
  const clientIds = Array.from(_kbSelectedIds)
    .filter(k => k.startsWith('client:'))
    .map(k => parseInt(k.split(':')[1]));
  if (clientIds.length === 0) {return;}

  const status = document.getElementById('kb-promote-status');
  const deleteBtn = document.getElementById('kb-delete-btn');

  // Dashboard-style inline confirmation
  if (deleteBtn && !deleteBtn.dataset.confirmed) {
    deleteBtn.dataset.confirmed = 'pending';
    deleteBtn.textContent = `Confirm Delete ${clientIds.length}?`;
    deleteBtn.style.background = 'var(--danger)';
    deleteBtn.style.color = '#fff';
    if (status) {status.textContent = 'Click again to confirm, or click elsewhere to cancel';}
    // Auto-cancel after 3s
    setTimeout(() => {
      if (deleteBtn.dataset.confirmed === 'pending') {
        delete deleteBtn.dataset.confirmed;
        _updateActionBtns();
        if (status) {status.textContent = '';}
      }
    }, 3000);
    return;
  }
  delete deleteBtn?.dataset.confirmed;

  if (status) {status.textContent = 'Deleting...';}
  try {
    const res = await api('/knowledge/delete', { method: 'POST', body: { ids: clientIds } });
    if (res.ok) {
      clientIds.forEach(id => _kbSelectedIds.delete(`client:${id}`));
      if (status) {status.innerHTML = `<span style="color:var(--success)">Deleted ${res.deleted} entries</span>`;}
      setTimeout(() => loadKnowledge(), 1000);
    } else {
      if (status) {status.innerHTML = `<span style="color:var(--danger)">${escHtml(res.error || 'Failed')}</span>`;}
    }
  } catch (e) {
    if (status) {status.innerHTML = `<span style="color:var(--danger)">${escHtml(e.message)}</span>`;}
  }
}

let _kbSearchQuery = '';

function _agentLabel(id) { return _kbAgentNames[id] || id.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' '); }
function _catLabel(cat) { if (!cat) {return '?';} return cat.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' '); }

function _renderSearchBar() {
  return `<div style="margin:16px 0"><div style="display:flex;gap:8px;align-items:center">
    <input id="kb-search" type="text" placeholder="Filter entries by text..." value="${escHtml(_kbSearchQuery)}"
      style="flex:1;background:var(--bg-secondary);color:var(--text-primary);border:1px solid var(--border);border-radius:8px;padding:8px 12px;font-size:13px">
    <button class="btn btn-ghost btn-sm" id="kb-search-btn">Filter</button>
    ${_kbSearchQuery ? '<button class="btn btn-xs btn-ghost" id="kb-search-clear">Clear</button>' : ''}
  </div></div>`;
}

function _wireSearch() {
  const input = document.getElementById('kb-search'), btn = document.getElementById('kb-search-btn');
  if (!input || !btn) {return;}
  const doFilter = () => {
    _kbSearchQuery = input.value.trim();
    _kbPage = 1;
    _loadEntries();
  };
  btn.onclick = doFilter;
  input.onkeydown = (e) => { if (e.key === 'Enter') {doFilter();} };
  const clearBtn = document.getElementById('kb-search-clear');
  if (clearBtn) {clearBtn.onclick = () => { _kbSearchQuery = ''; input.value = ''; _kbPage = 1; _loadEntries(); };}
}

const _kbCats = ['coaching','copywriting','video-pipeline','gohighlevel','stripe','xero','meta-ads','n8n','makecom','seo','cinematic','system','operational','general'];
const _kbTypes = ['fact','pattern','framework','anti-pattern','lesson_learned'];
const _inputS = 'background:var(--bg-secondary);color:var(--text-primary);border:1px solid var(--border);border-radius:';

async function _editEntry(id) {
  const data = await api(`/knowledge/entry/${id}?source=client`);
  if (!data || data.error) {return alert(data?.error || 'Failed to load entry');}
  const catOpts = _kbCats.map(c => `<option value="${c}" ${c===data.category?'selected':''}>${_catLabel(c)}</option>`).join('');
  const typeOpts = _kbTypes.map(t => `<option value="${t}" ${t===data.knowledge_type?'selected':''}>${_catLabel(t)}</option>`).join('');
  const modal = document.createElement('div');
  modal.id = 'kb-edit-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:1000';
  modal.innerHTML = `<div style="background:var(--surface-solid, #0D0D10);border:1px solid var(--border);border-radius:12px;padding:20px;width:90%;max-width:600px;max-height:80vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,0.7)">
    <h3 style="margin:0 0 12px;font-size:14px;color:var(--text-secondary)">Edit Entry #${id}</h3>
    <textarea id="kb-edit-content" rows="8" style="width:100%;background:var(--surface-hi, #141418);color:var(--text-primary);border:1px solid var(--border);border-radius:8px;padding:10px;font-size:13px;resize:vertical">${escHtml(data.content)}</textarea>
    <div style="display:flex;gap:8px;margin-top:8px">
      <select id="kb-edit-cat" style="background:var(--surface-hi, #141418);color:var(--text-primary);border:1px solid var(--border);border-radius:6px;padding:6px 10px;font-size:13px">${catOpts}</select>
      <select id="kb-edit-type" style="background:var(--surface-hi, #141418);color:var(--text-primary);border:1px solid var(--border);border-radius:6px;padding:6px 10px;font-size:13px">${typeOpts}</select>
    </div>
    <div style="display:flex;gap:8px;margin-top:12px;justify-content:flex-end">
      <span id="kb-edit-status" style="font-size:12px;color:var(--text-muted);flex:1;align-self:center"></span>
      <button class="btn btn-ghost btn-sm" id="kb-edit-cancel">Cancel</button>
      <button class="btn btn-primary btn-sm" id="kb-edit-save">Save</button>
    </div></div>`;
  document.body.appendChild(modal);
  modal.querySelector('#kb-edit-cancel').onclick = () => modal.remove();
  modal.onclick = (e) => { if (e.target === modal) {modal.remove();} };
  modal.querySelector('#kb-edit-save').onclick = async () => {
    const st = modal.querySelector('#kb-edit-status');
    st.textContent = 'Saving...';
    const res = await api(`/knowledge/entry/${id}`, { method: 'PUT', body: { content: modal.querySelector('#kb-edit-content').value, category: modal.querySelector('#kb-edit-cat').value, knowledge_type: modal.querySelector('#kb-edit-type').value }});
    if (res?.ok) { modal.remove(); _loadEntries(); }
    else {st.innerHTML = `<span style="color:var(--danger)">${escHtml(res?.error||'Save failed')}</span>`;}
  };
}

async function _loadMarketSignals() {
  const root = document.getElementById('kb-market-signals');
  if (!root) {return;}
  try {
    const data = await api('/knowledge/market-signals');
    const signals = data?.signals || [];
    const rows = signals.map(s => `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;padding:10px 0;border-bottom:1px solid var(--border)">
        <div style="flex:1">
          <div style="font-size:13px;color:var(--text-primary)">${escHtml(s.content)}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:4px">${_timeAgo(s.created_at)}</div>
        </div>
        <button onclick="_dismissSignal(${s.id})" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:16px;padding:4px 8px" title="Dismiss">x</button>
      </div>
    `).join('');
    const scanBtn = `<button onclick="_triggerMarketScan(this)" style="background:var(--accent);color:#fff;border:none;border-radius:6px;padding:6px 14px;font-size:12px;cursor:pointer">Scan Now</button>`;
    root.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <h3 style="font-size:14px;color:var(--text-secondary);margin:0">Market Signals</h3>
        ${scanBtn}
      </div>
      ${rows ? `<div style="background:var(--card-bg);border:1px solid var(--border);border-radius:8px;padding:0 12px">${rows}</div>` : '<p style="font-size:13px;color:var(--text-muted)">No signals yet. Click "Scan Now" to run your first scan.</p>'}
    `;
  } catch { root.innerHTML = ''; }
}

async function _triggerMarketScan(btn) {
  btn.disabled = true; btn.textContent = 'Scanning...';
  try {
    // Find or create the market-signals script cron
    const data = await api('/script-crons');
    const crons = data?.jobs || data || [];
    let job = crons.find(c => c.script_path && c.script_path.endsWith('/cron-market-signals.sh'));
    if (!job) {
      const created = await api('/script-crons', { method: 'POST', body: {
        name: 'Market Signal Scanner', description: 'Weekly industry trend scan',
        script_path: '/opt/AIWH/core/scripts/cron-market-signals.sh', cron_expr: '0 10 * * 0',
      }});
      job = created?.job;
    }
    if (job?.id) {
      await api(`/script-crons/${job.id}/trigger`, { method: 'POST' });
      btn.textContent = 'Scan started';
      setTimeout(() => { btn.disabled = false; btn.textContent = 'Scan Now'; _loadMarketSignals(); }, 15000);
    } else {
      btn.textContent = 'Failed'; setTimeout(() => { btn.disabled = false; btn.textContent = 'Scan Now'; }, 3000);
    }
  } catch { btn.textContent = 'Failed'; setTimeout(() => { btn.disabled = false; btn.textContent = 'Scan Now'; }, 3000); }
}

async function _dismissSignal(id) {
  await api('/knowledge/delete', { method: 'POST', body: { ids: [id] } });
  _loadMarketSignals();
}

function _timeAgo(dateStr) {
  if (!dateStr || dateStr === 'unknown') {return 'unknown';}
  try {
    // SQLite datetime('now') returns UTC without Z suffix — add it
    const normalized = dateStr.endsWith('Z') || dateStr.includes('+') ? dateStr : dateStr + 'Z';
    const d = new Date(normalized);
    const now = new Date();
    const diff = Math.floor((now - d) / 1000);
    if (diff < 60) {return 'just now';}
    if (diff < 3600) {return Math.floor(diff / 60) + 'm ago';}
    if (diff < 86400) {return Math.floor(diff / 3600) + 'h ago';}
    return Math.floor(diff / 86400) + 'd ago';
  } catch { return dateStr; }
}
