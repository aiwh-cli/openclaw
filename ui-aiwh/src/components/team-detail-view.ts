// Team Detail — agent detail side panel, model picker, avatar upload, rename.
// Called from team-org-chart.ts via window.openAgentDetail(). Exposed on window.

import { FILE_META } from './team-file-editor.js';

const api = (window as any).api as (url: string, opts?: any) => Promise<any>;
const showToast = (window as any).showToast as (msg: string, type?: string) => void;
const dashPrompt = (window as any).dashPrompt as (msg: string, def?: string) => Promise<string | null>;
const escHtml = (window as any).escHtml as (s: string) => string;
const timeAgo = (window as any).timeAgo as (d: string) => string;
const modelTierInfo = (window as any).modelTierInfo as (m: string) => { tier: string; cls: string; label: string };

let _availableModels: any = null;
let _modelCacheTimer = 0;

async function loadAvailableModels() {
  if (_availableModels) { return _availableModels; }
  try {
    const data = await api('/agents/models/available');
    _availableModels = data;
    _modelCacheTimer = window.setTimeout(() => { _availableModels = null; }, 300000);
    return data;
  } catch { return { models: [], providers: [] }; }
}

async function populateModelPicker(agentId: string, currentModel: string) {
  const select = document.getElementById(`model-select-${agentId}`) as HTMLSelectElement;
  if (!select) { return; }
  const data = await loadAvailableModels();
  const models = data?.models || [];

  const groups: Record<string, any[]> = {};
  for (const m of models) {
    const prov = m.provider || 'other';
    if (!groups[prov]) { groups[prov] = []; }
    groups[prov].push(m);
  }

  const provOrder = ['anthropic', 'openai', 'openrouter'];
  const sortedProvs = Object.keys(groups).toSorted((a, b) => {
    const ai = provOrder.indexOf(a);
    const bi = provOrder.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  const OR_TOP_IDS = [
    'xiaomi/mimo-v2-pro', 'stepfun/step-3.5-flash', 'minimax/minimax-m2.5',
    'deepseek/deepseek-v3.2', 'z-ai/glm-5-turbo', 'anthropic/claude-sonnet-4',
    'anthropic/claude-opus-4', 'google/gemini-3-flash', 'openrouter/hunter-alpha', 'google/gemini-2.5-flash',
  ];

  let html = '';
  for (const prov of sortedProvs) {
    const provModels = groups[prov];
    let display: any[];
    if (prov === 'openrouter') {
      display = provModels.filter(m => {
        const bare = m.id.replace('openrouter/', '');
        return OR_TOP_IDS.some(top => bare.startsWith(top));
      });
      if (!display.length) { display = provModels.slice(0, 15); }
    } else { display = provModels; }
    const label = prov === 'anthropic' ? 'Anthropic (Direct)' : prov === 'openai' ? 'OpenAI (Direct)' : prov === 'openrouter' ? 'OpenRouter' : prov;
    html += `<optgroup label="${escHtml(label)}">`;
    for (const m of display) {
      const cost = m.inputCost > 0 ? ` — $${m.inputCost.toFixed(2)}/$${m.outputCost.toFixed(2)} per M` : '';
      const selected = m.id === currentModel ? ' selected' : '';
      html += `<option value="${escHtml(m.id)}"${selected}>${escHtml(m.name)}${cost}</option>`;
    }
    html += '</optgroup>';
  }

  const allIds = models.map((m: any) => m.id);
  if (currentModel && !allIds.includes(currentModel)) {
    html = `<option value="${escHtml(currentModel)}" selected>${escHtml(currentModel)} (current)</option>` + html;
  }
  select.innerHTML = html;
}

async function setAgentModel(agentId: string, modelId: string) {
  if (!modelId) { return; }
  const res = await api(`/agents/${agentId}/model`, { method: 'POST', body: { model: modelId } });
  if (res?.ok) {
    const info = modelTierInfo(modelId);
    showToast(`Model set to ${info.label}`, 'success');
    const card = document.querySelector(`.tc-card[data-agent-id="${agentId}"]`);
    if (card) {
      const tierEl = card.querySelector('.tc-tier');
      if (tierEl) { tierEl.className = `tc-tier ${info.cls}`; tierEl.textContent = info.label; }
    }
    if (typeof (window as any).updateModelBadge === 'function') { (window as any).updateModelBadge(agentId, modelId); }
  } else { showToast(res?.error || 'Failed to set model', 'error'); }
}

async function openAgentDetail(agentId: string) {
  const agent = await api(`/agents/${agentId}`);
  if (!agent || agent.error) { return; }

  let orgNode: any = null;
  function findNode(n: any, id: string): any {
    if (n.id === id) { return n; }
    for (const c of (n.reports || [])) { const found = findNode(c, id); if (found) { return found; } }
    return null;
  }
  const orgData = (window as any)._orgData;
  if (orgData?.hierarchy) { orgNode = findNode(orgData.hierarchy, agentId); }

  const panel = document.getElementById('team-detail-panel');
  const overlay = document.getElementById('team-detail-overlay');
  if (!panel || !overlay) { return; }

  const recentRuns = agent.runs?.slice(0, 5) || [];
  const files = agent.workspaceFiles || [];
  const avatarUrl = agent.avatar_url || '';
  const avatarInner = avatarUrl
    ? `<img src="${escHtml(avatarUrl)}" alt="" class="detail-avatar-img">`
    : '<svg width="28" height="28" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="6" r="3" stroke="currentColor" stroke-width="1.2" opacity="0.4"/><path d="M2.5 14c0-3 2.5-5.5 5.5-5.5s5.5 2.5 5.5 5.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity="0.4"/></svg>';

  panel.innerHTML = `
    <input type="file" id="avatar-file-input" accept="image/*" style="display:none" onchange="handleAvatarUpload('${escHtml(agentId)}', this)">
    <div class="detail-header">
      <div class="detail-title">
        <div class="detail-avatar-wrap" onclick="document.getElementById('avatar-file-input').click()" title="Click to change avatar">
          ${avatarInner}
          <div class="detail-avatar-edit">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          </div>
        </div>
        <div>
          <div class="detail-name">${escHtml(agent.display_name || agentId)}</div>
          <div class="detail-subtitle">${escHtml(orgNode?.title || agent.module || '')}</div>
        </div>
      </div>
      <button class="btn-icon" onclick="closeAgentDetail()">&#10005;</button>
    </div>
    <div class="detail-status-row">
      <span class="status-badge status-${agent.status || 'idle'}">${agent.status || 'idle'}</span>
      <span class="detail-module">${escHtml(agent.module || '')}</span>
    </div>
    <div class="detail-section">
      <div class="detail-label">Model</div>
      <div class="detail-model-picker" id="model-picker-${agentId}">
        <select class="model-select" id="model-select-${escHtml(agentId)}" onchange="setAgentModel('${escHtml(agentId)}', this.value)">
          <option value="">Loading models...</option>
        </select>
      </div>
    </div>
    ${orgNode?.description ? `<p class="detail-desc">${escHtml(orgNode.description)}</p>` : ''}
    <div class="detail-section"><div class="detail-label">Last Active</div><div>${timeAgo(agent.last_active_at)}</div></div>
    ${agent.last_task ? `<div class="detail-section"><div class="detail-label">Last Task</div><div class="detail-last-task">${escHtml(agent.last_task)}</div></div>` : ''}
    ${files.length ? `<div class="detail-section">
      <div class="detail-label">Agent Configuration</div>
      <div class="detail-config-list">
        ${files.filter((f: any) => !f.isDir && !(FILE_META[f.name] as any)?.hidden).map((f: any) => {
          const meta = FILE_META[f.name] || { label: f.name, desc: 'Agent file' };
          const isRO = (meta as any).readOnly;
          const lock = isRO ? '<span class="config-file-lock" title="Read-only — updated automatically">&#128274;</span>' : '';
          return `<button class="config-file-row ${isRO ? 'config-file-readonly' : ''}" onclick="openFileEditor('${escHtml(f.path)}', '${escHtml(f.name)}')">
            <div class="config-file-icon"><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 2h6l4 4v8a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" stroke-width="1.2"/><path d="M10 2v4h4" stroke="currentColor" stroke-width="1.2"/></svg></div>
            <div class="config-file-info"><div class="config-file-name">${escHtml(meta.label)}${lock}</div><div class="config-file-desc">${escHtml(meta.desc)}</div></div>
            <div class="config-file-arrow"><svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
          </button>`;
        }).join('')}
      </div>
    </div>` : ''}
    ${recentRuns.length ? `<div class="detail-section"><div class="detail-label">Recent Runs</div>
      ${recentRuns.map((r: any) => `<div class="run-item"><span class="run-status ${r.status}">${r.status}</span><span class="run-cmd">${escHtml((r.command || '').substring(0, 60))}</span><span class="run-time">${timeAgo(r.started_at)}</span></div>`).join('')}
    </div>` : ''}
    <div class="detail-actions">
      <button class="btn btn-ghost btn-sm" onclick="renameAgent('${escHtml(agentId)}')">Rename</button>
      <button class="btn btn-ghost btn-sm" onclick="document.getElementById('avatar-file-input').click()">Avatar</button>
      <button class="btn btn-ghost btn-sm" onclick="openChatWith('${escHtml(agentId)}')">Chat</button>
    </div>
  `;

  overlay.classList.remove('hidden');
  panel.classList.remove('hidden');
  populateModelPicker(agentId, agent.model || '');
}

async function handleAvatarUpload(agentId: string, input: HTMLInputElement) {
  const file = input.files?.[0];
  if (!file) { return; }
  if (!file.type.startsWith('image/')) { showToast('Please select an image file', 'error'); return; }
  if (file.size > 10 * 1024 * 1024) { showToast('Image too large (max 10MB)', 'error'); return; }

  const SIZE = 200;
  const img = new Image();
  img.onload = async () => {
    const canvas = document.createElement('canvas');
    canvas.width = SIZE; canvas.height = SIZE;
    const ctx = canvas.getContext('2d')!;
    const min = Math.min(img.width, img.height);
    ctx.drawImage(img, (img.width - min) / 2, (img.height - min) / 2, min, min, 0, 0, SIZE, SIZE);
    const dataUrl = canvas.toDataURL('image/png');
    const result = await api(`/agents/${agentId}/avatar`, { method: 'POST', body: { image: dataUrl } });
    if (result?.ok) {
      showToast('Avatar updated', 'success');
      const wrap = document.querySelector('.detail-avatar-wrap');
      if (wrap) {
        const imgEl = wrap.querySelector('.detail-avatar-img') as HTMLImageElement;
        if (imgEl) { imgEl.src = result.avatar_url; }
        else { wrap.insertAdjacentHTML('afterbegin', `<img src="${escHtml(result.avatar_url)}" alt="" class="detail-avatar-img">`); }
      }
      const orgEl = document.querySelector('team-org-chart') as any;
      if (orgEl) { orgEl.load(); }
    } else { showToast(result?.error || 'Upload failed', 'error'); }
  };
  img.onerror = () => showToast('Could not read image', 'error');
  img.src = URL.createObjectURL(file);
  input.value = '';
}

function closeAgentDetail() {
  document.getElementById('team-detail-panel')?.classList.add('hidden');
  document.getElementById('team-detail-overlay')?.classList.add('hidden');
}

function openChatWith(agentId: string) {
  closeAgentDetail();
  if (typeof (window as any).openChat === 'function') { (window as any).openChat(agentId); }
}

async function renameAgent(agentId: string) {
  const current = document.querySelector('.detail-name')?.textContent || agentId;
  const newName = await dashPrompt('Rename agent:', current);
  if (!newName?.trim() || newName.trim() === current) { return; }
  const result = await api(`/agents/${agentId}/rename`, { method: 'PATCH', body: { name: newName.trim() } });
  if (result?.ok) {
    showToast(`Renamed to "${newName.trim()}"`, 'success');
    closeAgentDetail();
    if (typeof (window as any).loadTeam === 'function') { (window as any).loadTeam(); }
  } else { showToast(result?.error || 'Rename failed', 'error'); }
}

// Expose on window
(window as any).openAgentDetail = openAgentDetail;
(window as any).closeAgentDetail = closeAgentDetail;
(window as any).setAgentModel = setAgentModel;
(window as any).handleAvatarUpload = handleAvatarUpload;
(window as any).renameAgent = renameAgent;
(window as any).openChatWith = openChatWith;
