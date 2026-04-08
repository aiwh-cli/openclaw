// Knowledge Entries — table rendering, selection, bulk actions, inline edit modal.
// Called from knowledge-view.ts. Exposed on window for onclick handlers.

const api = (window as any).api as (url: string, opts?: any) => Promise<any>;
const escHtml = (window as any).escHtml as (s: string) => string;

// Shared state (accessed from knowledge-view.ts via window)
export let kbPage = 1;
export let kbSource = 'all';
export let kbStatus = 'all';
export let kbSearchQuery = '';
export const kbSelectedIds = new Set<string>();
export let kbCanWriteBase = false;
export let kbAgentNames: Record<string, string> = {};

export function setKbState(opts: { canWriteBase?: boolean; agentNames?: Record<string, string>; page?: number; source?: string; status?: string; searchQuery?: string }) {
  if (opts.canWriteBase !== undefined) { kbCanWriteBase = opts.canWriteBase; }
  if (opts.agentNames) { kbAgentNames = opts.agentNames; }
  if (opts.page !== undefined) { kbPage = opts.page; }
  if (opts.source !== undefined) { kbSource = opts.source; }
  if (opts.status !== undefined) { kbStatus = opts.status; }
  if (opts.searchQuery !== undefined) { kbSearchQuery = opts.searchQuery; }
}

export function agentLabel(id: string) { return kbAgentNames[id] || id.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' '); }
export function catLabel(cat: string) { if (!cat) { return '?'; } return cat.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' '); }

export function kbTimeAgo(dateStr: string) {
  if (!dateStr || dateStr === 'unknown') { return 'unknown'; }
  try {
    const normalized = dateStr.endsWith('Z') || dateStr.includes('+') ? dateStr : dateStr + 'Z';
    const d = new Date(normalized);
    const diff = Math.floor((Date.now() - d.getTime()) / 1000);
    if (diff < 60) { return 'just now'; }
    if (diff < 3600) { return Math.floor(diff / 60) + 'm ago'; }
    if (diff < 86400) { return Math.floor(diff / 3600) + 'h ago'; }
    return Math.floor(diff / 86400) + 'd ago';
  } catch { return dateStr; }
}

function _updateActionBtns() {
  const count = kbSelectedIds.size;
  const promoteBtn = document.getElementById('kb-promote-btn') as HTMLButtonElement;
  const deleteBtn = document.getElementById('kb-delete-btn') as HTMLButtonElement;
  if (promoteBtn) { promoteBtn.style.display = count > 0 ? '' : 'none'; promoteBtn.textContent = `Promote ${count} to Product`; }
  if (deleteBtn) { deleteBtn.style.display = count > 0 ? '' : 'none'; deleteBtn.textContent = `Delete ${count} Selected`; }
}

async function _promoteSelected() {
  const clientIds = Array.from(kbSelectedIds).filter(k => k.startsWith('client:')).map(k => parseInt(k.split(':')[1]));
  if (!clientIds.length) { return; }
  const status = document.getElementById('kb-promote-status');
  const btn = document.getElementById('kb-promote-btn') as HTMLButtonElement;
  if (btn) { btn.disabled = true; }
  if (status) { status.textContent = `Promoting ${clientIds.length} entries...`; }
  try {
    const res = await api('/knowledge/promote', { method: 'POST', body: { ids: clientIds } });
    if (res.ok) {
      clientIds.forEach(id => kbSelectedIds.delete(`client:${id}`));
      if (status) { status.innerHTML = `<span style="color:var(--success)">Promoted ${res.promoted} entries</span>`; }
      setTimeout(() => (window as any).loadKnowledge(), 1500);
    } else { if (status) { status.innerHTML = `<span style="color:var(--danger)">${escHtml(res.error || 'Failed')}</span>`; } }
  } catch (e: any) { if (status) { status.innerHTML = `<span style="color:var(--danger)">${escHtml(e.message)}</span>`; } }
  if (btn) { btn.disabled = false; }
}

async function _deleteSelected() {
  const clientIds = Array.from(kbSelectedIds).filter(k => k.startsWith('client:')).map(k => parseInt(k.split(':')[1]));
  if (!clientIds.length) { return; }
  const status = document.getElementById('kb-promote-status');
  const deleteBtn = document.getElementById('kb-delete-btn') as HTMLButtonElement;
  if (deleteBtn && !deleteBtn.dataset.confirmed) {
    deleteBtn.dataset.confirmed = 'pending';
    deleteBtn.textContent = `Confirm Delete ${clientIds.length}?`;
    deleteBtn.style.background = 'var(--danger)'; deleteBtn.style.color = '#fff';
    if (status) { status.textContent = 'Click again to confirm'; }
    setTimeout(() => { if (deleteBtn.dataset.confirmed === 'pending') { delete deleteBtn.dataset.confirmed; _updateActionBtns(); if (status) { status.textContent = ''; } } }, 3000);
    return;
  }
  delete deleteBtn?.dataset.confirmed;
  if (status) { status.textContent = 'Deleting...'; }
  try {
    const res = await api('/knowledge/delete', { method: 'POST', body: { ids: clientIds } });
    if (res.ok) { clientIds.forEach(id => kbSelectedIds.delete(`client:${id}`)); if (status) { status.innerHTML = `<span style="color:var(--success)">Deleted ${res.deleted} entries</span>`; } setTimeout(() => (window as any).loadKnowledge(), 1000); }
    else { if (status) { status.innerHTML = `<span style="color:var(--danger)">${escHtml(res.error || 'Failed')}</span>`; } }
  } catch (e: any) { if (status) { status.innerHTML = `<span style="color:var(--danger)">${escHtml(e.message)}</span>`; } }
}

const KB_CATS = ['coaching','copywriting','video-pipeline','gohighlevel','stripe','xero','meta-ads','n8n','makecom','seo','cinematic','system','operational','general'];
const KB_TYPES = ['fact','pattern','framework','anti-pattern','lesson_learned'];

export async function editEntry(id: number) {
  const data = await api(`/knowledge/entry/${id}?source=client`);
  if (!data || data.error) { return alert(data?.error || 'Failed to load entry'); }
  const catOpts = KB_CATS.map(c => `<option value="${c}" ${c === data.category ? 'selected' : ''}>${catLabel(c)}</option>`).join('');
  const typeOpts = KB_TYPES.map(t => `<option value="${t}" ${t === data.knowledge_type ? 'selected' : ''}>${catLabel(t)}</option>`).join('');
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
  modal.querySelector('#kb-edit-cancel')!.addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => { if (e.target === modal) { modal.remove(); } });
  modal.querySelector('#kb-edit-save')!.addEventListener('click', async () => {
    const st = modal.querySelector('#kb-edit-status') as HTMLElement;
    st.textContent = 'Saving...';
    const res = await api(`/knowledge/entry/${id}`, { method: 'PUT', body: { content: (modal.querySelector('#kb-edit-content') as HTMLTextAreaElement).value, category: (modal.querySelector('#kb-edit-cat') as HTMLSelectElement).value, knowledge_type: (modal.querySelector('#kb-edit-type') as HTMLSelectElement).value } });
    if (res?.ok) { modal.remove(); loadEntries(); }
    else { st.innerHTML = `<span style="color:var(--danger)">${escHtml(res?.error || 'Save failed')}</span>`; }
  });
}

export async function loadEntries() {
  const root = document.getElementById('kb-entries-root');
  if (!root) { return; }
  const qParam = kbSearchQuery ? `&q=${encodeURIComponent(kbSearchQuery)}` : '';
  const data = await api(`/knowledge/recent?source=${kbSource}&page=${kbPage}&limit=30&status=${kbStatus}${qParam}`);
  if (!data?.entries) { root.innerHTML = '<p style="color:var(--text-muted)">No entries</p>'; return; }

  const { entries, total, page, totalPages } = data;
  const p = 'padding:6px 8px';
  const rows = entries.map((e: any) => {
    const badge = e.target === 'base' ? '<span class="chip chip-sm" style="background:var(--accent-glow);color:#fff">Product</span>' : '<span class="chip chip-sm">Local</span>';
    const stB = e.status === 'published' ? '<span style="color:var(--success)">&#9679;</span>' : '<span style="color:var(--warning)">&#9675;</span>';
    const src = e.source ? `<span style="color:var(--text-muted);font-size:11px">${escHtml(e.source)}</span>` : '';
    const iC = e.target === 'client';
    const chk = kbSelectedIds.has(`${e.target}:${e.id}`) ? 'checked' : '';
    const cb = iC ? `<input type="checkbox" class="kb-select" data-id="${e.id}" data-target="${e.target}" ${chk} style="cursor:pointer">` : '';
    const ed = iC ? `<button class="btn btn-xs btn-ghost kb-edit-btn" data-id="${e.id}">Edit</button>` : '';
    let agents = 'All Agents';
    try { const a = typeof e.target_agents === 'string' ? JSON.parse(e.target_agents) : e.target_agents; agents = Array.isArray(a) ? a.map(agentLabel).join(', ') : 'All Agents'; } catch {}
    return `<tr style="border-bottom:1px solid var(--border-subtle,rgba(255,255,255,0.04))"><td style="${p}">${cb}</td><td style="${p}">${stB}</td><td style="${p}">${badge}</td><td style="${p}"><span class="chip chip-sm">${escHtml(catLabel(e.category))}</span></td><td style="${p};max-width:350px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;cursor:${iC ? 'pointer' : 'default'}" ${iC ? `onclick="_editEntry(${e.id})"` : ''}>${escHtml(e.content || '')}</td><td style="${p}"><span style="font-size:10px;color:var(--text-muted)">${escHtml(agents)}</span></td><td style="${p};font-size:12px;color:var(--text-muted)">${kbTimeAgo(e.created_at)}</td><td style="${p}">${src} ${ed}</td></tr>`;
  }).join('');

  const srcL: Record<string, string> = { all: 'All', client: 'My Knowledge', base: 'Product' };
  const srcBtns = (['all', 'client', 'base'] as const).map(s => `<button class="btn btn-xs ${kbSource === s ? 'btn-primary' : 'btn-ghost'}" onclick="_kbSource='${s}';_kbPage=1;_loadEntries()">${srcL[s]}</button>`).join('');
  const statusBtns = (['all', 'published', 'draft'] as const).map(s => `<button class="btn btn-xs ${kbStatus === s ? 'btn-primary' : 'btn-ghost'}" onclick="_kbStatus='${s}';_kbPage=1;_loadEntries()">${s[0].toUpperCase() + s.slice(1)}</button>`).join('');
  const actionBar = `<div style="display:flex;align-items:center;gap:8px;margin:8px 0">
    <label style="font-size:12px;color:var(--text-muted);cursor:pointer"><input type="checkbox" id="kb-select-all" style="cursor:pointer"> Select all</label>
    ${kbCanWriteBase ? '<button class="btn btn-primary btn-sm" id="kb-promote-btn" style="display:none">Promote to Product</button>' : ''}
    <button class="btn btn-ghost btn-sm" id="kb-delete-btn" style="display:none;color:var(--danger)">Delete Selected</button>
    <span id="kb-promote-status" style="font-size:12px;color:var(--text-muted)"></span></div>`;

  const pageInfo = `<span style="font-size:12px;color:var(--text-muted)">${total} entries · Page ${page}/${totalPages || 1}</span>`;
  const prevBtn = page > 1 ? `<button class="btn btn-xs btn-ghost" onclick="_kbPage--;_loadEntries()">← Prev</button>` : '';
  const nextBtn = page < totalPages ? `<button class="btn btn-xs btn-ghost" onclick="_kbPage++;_loadEntries()">Next →</button>` : '';

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
      </div>
    </div>
  `;

  // Wire checkboxes
  document.querySelectorAll('.kb-select').forEach(cb => {
    (cb as HTMLInputElement).onchange = () => {
      const el = cb as HTMLInputElement;
      const key = `${el.dataset.target}:${el.dataset.id}`;
      if (el.checked) { kbSelectedIds.add(key); } else { kbSelectedIds.delete(key); }
      _updateActionBtns();
    };
  });
  const selectAll = document.getElementById('kb-select-all') as HTMLInputElement;
  if (selectAll) {
    selectAll.onchange = () => {
      document.querySelectorAll('.kb-select').forEach(cb => {
        const el = cb as HTMLInputElement;
        el.checked = selectAll.checked;
        const key = `${el.dataset.target}:${el.dataset.id}`;
        if (selectAll.checked) { kbSelectedIds.add(key); } else { kbSelectedIds.delete(key); }
      });
      _updateActionBtns();
    };
  }
  const promoteBtn = document.getElementById('kb-promote-btn');
  if (promoteBtn) { promoteBtn.onclick = _promoteSelected; }
  const deleteBtn = document.getElementById('kb-delete-btn');
  if (deleteBtn) { deleteBtn.onclick = _deleteSelected; }
  document.querySelectorAll('.kb-edit-btn').forEach(b => {
    (b as HTMLElement).onclick = () => editEntry(parseInt((b as HTMLElement).dataset.id!));
  });
  _updateActionBtns();
}

// Expose on window for onclick handlers in HTML strings
(window as any)._loadEntries = loadEntries;
(window as any)._editEntry = editEntry;
// Expose state setters for filter buttons
Object.defineProperty(window, '_kbPage', { get: () => kbPage, set: (v: number) => { kbPage = v; } });
Object.defineProperty(window, '_kbSource', { get: () => kbSource, set: (v: string) => { kbSource = v; } });
Object.defineProperty(window, '_kbStatus', { get: () => kbStatus, set: (v: string) => { kbStatus = v; } });
