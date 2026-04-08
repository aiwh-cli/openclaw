// Knowledge View — stats, add form, search, dreams, market signals, document upload.
// Fills #knowledge-root. Exposed on window as loadKnowledge().

import { setKbState, kbCanWriteBase, kbSearchQuery, loadEntries, agentLabel, catLabel, kbTimeAgo } from './knowledge-entries.js';

const api = (window as any).api as (url: string, opts?: any) => Promise<any>;
const escHtml = (window as any).escHtml as (s: string) => string;

async function loadKnowledge() {
  const root = document.getElementById('knowledge-root');
  if (!root) { return; }
  root.innerHTML = '<p style="color:var(--text-muted)">Loading knowledge stats...</p>';

  try {
    const [stats, caps, freshness, dreams] = await Promise.all([
      api('/knowledge/stats'),
      api('/knowledge/capabilities'),
      api('/knowledge/freshness').catch(() => ({ overall: 'unknown', categories: [] })),
      api('/knowledge/dreams/status').catch(() => ({ ok: false })),
    ]);
    setKbState({ canWriteBase: caps?.canWriteBase || false, agentNames: caps?.agentNames || {} });
    stats._freshness = freshness;
    stats._dreams = dreams?.dreaming || null;

    root.innerHTML = `
      ${_renderStats(stats)}
      ${_renderAddForm(caps?.canWriteBase || false)}
      ${_renderSearchBar()}
      <div id="kb-entries-root"></div>
      <div id="kb-market-signals" style="margin-top:24px"></div>
      <div style="margin-top:24px">
        <h3 style="font-size:14px;margin-bottom:12px;color:var(--text-secondary)">Document Upload</h3>
        <knowledge-upload></knowledge-upload>
      </div>
    `;
    _wireAddForm(caps?.canWriteBase || false);
    _wireSearch();
    _wireDreamsCard();
    await loadEntries();
    _loadMarketSignals();
  } catch (e: any) {
    root.innerHTML = `<p style="color:var(--danger)">Failed to load knowledge: ${escHtml(e.message)}</p>`;
  }
}

function _renderStats(stats: any) {
  const b = stats.base || {};
  const c = stats.client || {};
  const f = stats._freshness || {};
  const topCats = (b.categories || []).slice(0, 6).map(
    (cat: any) => `<span class="chip">${escHtml(cat.category)} <b>${cat.c}</b></span>`
  ).join(' ');

  const hColor: Record<string, string> = { healthy: 'var(--success, #22c55e)', stale: 'var(--warning, #eab308)', critical: 'var(--danger, #ef4444)', unknown: 'var(--text-muted)' };
  const hLabel: Record<string, string> = { healthy: 'Healthy', stale: 'Some Stale', critical: 'Needs Update', unknown: 'Unknown' };
  const hc = hColor[f.overall] || hColor.unknown;
  const hl = hLabel[f.overall] || 'Unknown';
  const freshCats = (f.categories || []).slice(0, 5).map((cat: any) =>
    `<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);padding:2px 0"><span>${escHtml(cat.name)}</span><span style="color:${hColor[cat.status]}">${kbTimeAgo(cat.lastUpdated)}</span></div>`
  ).join('');

  return `
    <div class="knowledge-stats">
      <div class="stat-card"><div class="stat-label">Base Knowledge</div><div class="stat-value">${b.total || 0}</div><div class="stat-sub">Shared across all clients</div></div>
      <div class="stat-card"><div class="stat-label">Client Knowledge</div><div class="stat-value">${c.total || 0}</div><div class="stat-sub">${c.published || 0} published · ${c.drafts || 0} drafts</div></div>
      <div class="stat-card"><div class="stat-label">Last Updated</div><div class="stat-value" style="font-size:14px">${kbTimeAgo(b.latestUpdate || c.latestEntry)}</div><div class="stat-sub">Most recent entry</div></div>
      <div class="stat-card" id="kb-freshness-card" style="cursor:pointer" onclick="document.getElementById('kb-freshness-detail').style.display=document.getElementById('kb-freshness-detail').style.display==='none'?'block':'none'">
        <div class="stat-label">Knowledge Health</div>
        <div class="stat-value" style="font-size:16px;display:flex;align-items:center;gap:8px"><span style="width:10px;height:10px;border-radius:50%;background:${hc};display:inline-block"></span> ${hl}</div>
        <div class="stat-sub">Click to expand</div>
        <div id="kb-freshness-detail" style="display:none;margin-top:8px;border-top:1px solid var(--border);padding-top:6px">${freshCats || '<span style="font-size:11px;color:var(--text-muted)">No data</span>'}</div>
      </div>
      ${_renderDreamsCard(stats._dreams)}
    </div>
    <div style="margin:12px 0;display:flex;flex-wrap:wrap;gap:6px">${topCats}</div>
  `;
}

function _renderDreamsCard(dreams: any) {
  if (!dreams) { return `<div class="stat-card"><div class="stat-label">Learned Overnight</div><div class="stat-value" style="font-size:14px;color:var(--text-muted)">—</div><div class="stat-sub">Could not reach gateway</div></div>`; }
  if (!dreams.enabled) { return `<div class="stat-card" id="kb-dreams-card" style="cursor:pointer"><div class="stat-label">Learned Overnight</div><div class="stat-value" style="font-size:14px;color:var(--text-muted)">Off</div><div class="stat-sub">Your AI team can learn from conversations overnight</div><div id="kb-dreams-toggle" style="margin-top:6px"><button class="btn btn-xs btn-ghost" data-action="enable">Turn on</button></div></div>`; }
  return `<div class="stat-card" id="kb-dreams-card" style="cursor:pointer"><div class="stat-label">Learned Overnight</div><div class="stat-value" style="color:#4CAF7A">${dreams.promotedToday || 0}</div><div class="stat-sub">${dreams.promotedTotal || 0} total promoted · ${dreams.shortTermCount || 0} signals buffered</div><div class="stat-sub" style="margin-top:2px;font-size:10px;color:var(--text-muted)">Click to see diary</div><div id="kb-dreams-detail" style="display:none;margin-top:8px;border-top:1px solid var(--border);padding-top:6px"><dreams-diary></dreams-diary></div></div>`;
}

function _wireDreamsCard() {
  const card = document.getElementById('kb-dreams-card');
  if (!card) { return; }
  const toggle = card.querySelector('[data-action="enable"]') as HTMLButtonElement;
  if (toggle) {
    toggle.onclick = async (e) => {
      e.stopPropagation();
      toggle.disabled = true; toggle.textContent = 'Enabling...';
      try { await api('/knowledge/dreams/toggle', { method: 'POST', body: { enabled: true } }); loadKnowledge(); }
      catch { toggle.textContent = 'Failed'; }
    };
    return;
  }
  card.onclick = () => { const d = document.getElementById('kb-dreams-detail'); if (d) { d.style.display = d.style.display === 'none' ? 'block' : 'none'; } };
}

function _renderAddForm(canWriteBase: boolean) {
  const categories = ['coaching','copywriting','video-pipeline','gohighlevel','stripe','xero','meta-ads','n8n','makecom','seo','cinematic','system','operational','general'];
  const types = ['fact','pattern','framework','anti-pattern','lesson_learned'];
  const agents = ['all','copywriter','video','research','social','sales','funnel','crm-manager','cfo','calendar-manager','email-manager','systems','coach','trading','travel','builder-manager','security-manager','ai-council','scheduler','module-manager'];
  const catOpts = categories.map(c => `<option value="${c}">${catLabel(c)}</option>`).join('');
  const typeOpts = types.map(t => `<option value="${t}">${catLabel(t)}</option>`).join('');
  const agentChips = agents.map(a => {
    const checked = a === 'all' ? 'checked' : '';
    return `<label class="agent-chip" style="display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border:1px solid var(--border);border-radius:12px;font-size:11px;cursor:pointer;user-select:none"><input type="checkbox" class="kb-agent-cb" value="${a}" ${checked} style="width:12px;height:12px;cursor:pointer"> ${escHtml(agentLabel(a))}</label>`;
  }).join(' ');

  return `<div class="knowledge-add-form" style="margin-top:16px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:12px;padding:16px">
    <h3 style="font-size:14px;margin:0 0 12px;color:var(--text-secondary)">Add Knowledge</h3>
    <textarea id="kb-content" rows="4" placeholder="Enter knowledge content…" style="width:100%;background:var(--bg-secondary);color:var(--text-primary);border:1px solid var(--border);border-radius:8px;padding:10px;font-size:13px;resize:vertical"></textarea>
    <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;align-items:center">
      <select id="kb-category" style="background:var(--bg-secondary);color:var(--text-primary);border:1px solid var(--border);border-radius:6px;padding:6px 10px;font-size:13px">${catOpts}</select>
      <select id="kb-type" style="background:var(--bg-secondary);color:var(--text-primary);border:1px solid var(--border);border-radius:6px;padding:6px 10px;font-size:13px">${typeOpts}</select>
    </div>
    <div style="margin-top:8px"><span style="font-size:12px;color:var(--text-muted)">Target agents:</span><div id="kb-agents-wrap" style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px">${agentChips}</div></div>
    <div style="display:flex;gap:8px;margin-top:10px;align-items:center">
      ${canWriteBase ? '<button class="btn btn-primary btn-sm" id="kb-add-base" title="Adds to product knowledge">+ Product Knowledge</button>' : ''}
      <button class="btn ${canWriteBase ? 'btn-ghost' : 'btn-primary'} btn-sm" id="kb-add-client" title="Adds to your local knowledge">+ My Knowledge</button>
      <span id="kb-status" style="font-size:12px;color:var(--text-muted)"></span>
    </div>
  </div>`;
}

function _wireAddForm(canWriteBase: boolean) {
  const addBase = document.getElementById('kb-add-base');
  const addClient = document.getElementById('kb-add-client');
  if (addBase) { addBase.onclick = () => _submitKnowledge('base'); }
  if (addClient) { addClient.onclick = () => _submitKnowledge('client'); }
  document.querySelectorAll('.kb-agent-cb').forEach(cb => {
    (cb as HTMLInputElement).onchange = () => {
      const el = cb as HTMLInputElement;
      if (el.value === 'all' && el.checked) { document.querySelectorAll('.kb-agent-cb').forEach(c => { if ((c as HTMLInputElement).value !== 'all') { (c as HTMLInputElement).checked = false; } }); }
      else if (el.value !== 'all' && el.checked) { const allCb = document.querySelector('.kb-agent-cb[value="all"]') as HTMLInputElement; if (allCb) { allCb.checked = false; } }
    };
  });
}

async function _submitKnowledge(target: string) {
  const content = (document.getElementById('kb-content') as HTMLTextAreaElement)?.value?.trim();
  const category = (document.getElementById('kb-category') as HTMLSelectElement)?.value;
  const type = (document.getElementById('kb-type') as HTMLSelectElement)?.value;
  const status = document.getElementById('kb-status');
  const agentCbs = document.querySelectorAll('.kb-agent-cb:checked');
  const selectedAgents = Array.from(agentCbs).map(cb => (cb as HTMLInputElement).value);
  const target_agents = selectedAgents.includes('all') ? ['all'] : selectedAgents;
  if (!content) { if (status) { status.textContent = 'Content is required'; } return; }
  if (!target_agents.length) { if (status) { status.textContent = 'Select at least one agent'; } return; }
  if (status) { status.textContent = 'Adding...'; }
  try {
    const res = await api('/knowledge/add', { method: 'POST', body: { content, category, knowledge_type: type, target_agents, target } });
    if (res.ok) {
      const label = target === 'base' ? 'product knowledge' : 'your knowledge';
      if (status) { status.innerHTML = `<span style="color:var(--success)">Added to ${label} as draft</span>`; }
      (document.getElementById('kb-content') as HTMLTextAreaElement).value = '';
      setTimeout(() => loadKnowledge(), 1500);
    } else { if (status) { status.innerHTML = `<span style="color:var(--danger)">${escHtml(res.error || 'Failed')}</span>`; } }
  } catch (e: any) { if (status) { status.innerHTML = `<span style="color:var(--danger)">${escHtml(e.message)}</span>`; } }
}

function _renderSearchBar() {
  return `<div style="margin:16px 0"><div style="display:flex;gap:8px;align-items:center">
    <input id="kb-search" type="text" placeholder="Filter entries by text..." value="${escHtml(kbSearchQuery)}" style="flex:1;background:var(--bg-secondary);color:var(--text-primary);border:1px solid var(--border);border-radius:8px;padding:8px 12px;font-size:13px">
    <button class="btn btn-ghost btn-sm" id="kb-search-btn">Filter</button>
    ${kbSearchQuery ? '<button class="btn btn-xs btn-ghost" id="kb-search-clear">Clear</button>' : ''}
  </div></div>`;
}

function _wireSearch() {
  const input = document.getElementById('kb-search') as HTMLInputElement;
  const btn = document.getElementById('kb-search-btn');
  if (!input || !btn) { return; }
  const doFilter = () => { setKbState({ searchQuery: input.value.trim(), page: 1 }); loadEntries(); };
  btn.onclick = doFilter;
  input.onkeydown = (e) => { if (e.key === 'Enter') { doFilter(); } };
  const clearBtn = document.getElementById('kb-search-clear');
  if (clearBtn) { clearBtn.onclick = () => { setKbState({ searchQuery: '', page: 1 }); input.value = ''; loadEntries(); }; }
}

async function _loadMarketSignals() {
  const root = document.getElementById('kb-market-signals');
  if (!root) { return; }
  try {
    const data = await api('/knowledge/market-signals');
    const signals = data?.signals || [];
    const rows = signals.map((s: any) => `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;padding:10px 0;border-bottom:1px solid var(--border)">
        <div style="flex:1"><div style="font-size:13px;color:var(--text-primary)">${escHtml(s.content)}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:4px">${kbTimeAgo(s.created_at)}</div></div>
        <button onclick="_dismissSignal(${s.id})" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:16px;padding:4px 8px" title="Dismiss">x</button>
      </div>
    `).join('');
    const scanBtn = `<button onclick="_triggerMarketScan(this)" style="background:var(--accent);color:#fff;border:none;border-radius:6px;padding:6px 14px;font-size:12px;cursor:pointer">Scan Now</button>`;
    root.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><h3 style="font-size:14px;color:var(--text-secondary);margin:0">Market Signals</h3>${scanBtn}</div>
      ${rows ? `<div style="background:var(--card-bg);border:1px solid var(--border);border-radius:8px;padding:0 12px">${rows}</div>` : '<p style="font-size:13px;color:var(--text-muted)">No signals yet. Click "Scan Now" to run your first scan.</p>'}
    `;
  } catch { root.innerHTML = ''; }
}

async function _triggerMarketScan(btn: HTMLButtonElement) {
  btn.disabled = true; btn.textContent = 'Scanning...';
  try {
    const data = await api('/script-crons');
    const crons = data?.jobs || data || [];
    let job = crons.find((c: any) => c.script_path?.endsWith('/cron-market-signals.sh'));
    if (!job) {
      const created = await api('/script-crons', { method: 'POST', body: { name: 'Market Signal Scanner', description: 'Weekly industry trend scan', script_path: '/opt/AIWH/core/scripts/cron-market-signals.sh', cron_expr: '0 10 * * 0' } });
      job = created?.job;
    }
    if (job?.id) { await api(`/script-crons/${job.id}/trigger`, { method: 'POST' }); btn.textContent = 'Scan started'; setTimeout(() => { btn.disabled = false; btn.textContent = 'Scan Now'; _loadMarketSignals(); }, 15000); }
    else { btn.textContent = 'Failed'; setTimeout(() => { btn.disabled = false; btn.textContent = 'Scan Now'; }, 3000); }
  } catch { btn.textContent = 'Failed'; setTimeout(() => { btn.disabled = false; btn.textContent = 'Scan Now'; }, 3000); }
}

async function _dismissSignal(id: number) {
  await api('/knowledge/delete', { method: 'POST', body: { ids: [id] } });
  _loadMarketSignals();
}

// Expose on window
(window as any).loadKnowledge = loadKnowledge;
(window as any)._triggerMarketScan = _triggerMarketScan;
(window as any)._dismissSignal = _dismissSignal;
