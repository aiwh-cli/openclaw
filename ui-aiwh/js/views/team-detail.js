// ─── Team Detail Panel + File Editor ─────────────────────────
// Extracted from team.js for code size compliance.
// Contains: agent detail panel, model picker, file editor, avatar upload.

// Friendly labels for agent runtime files
const _FILE_META = {
  'CORE.md':       { label: 'Engine (Product Core)',             desc: 'Core product instructions — read-only, updated automatically', readOnly: true },
  'SOUL.md':       { label: 'Your Vision',                      desc: 'Your custom instructions, voice, and behavior — safe to edit' },
  'MEMORY.md':     { label: 'Long-term Memory', desc: 'Curated knowledge that persists across sessions' },
  'AGENTS.md':     { label: 'Instructions',   desc: 'Operating rules, workflows, and delegation patterns' },
  'IDENTITY.md':   { label: 'Identity',       desc: 'Name, role, and how the agent presents itself' },
  'USER.md':       { label: 'User Profile',   desc: 'Who the agent is talking to — your preferences' },
  'TOOLS.md':      { label: 'Tools & Skills', desc: 'Available tools, scripts, and API access notes' },
  'BOOTSTRAP.md':  { label: 'Startup Rules',  desc: 'First-run checklist executed on every new session' },
  'HEARTBEAT.md':  { label: 'Heartbeat',      desc: 'Periodic check-in tasks the agent runs automatically' },
  'HARD-LIMITS.md':{ label: 'Safety Rules',   desc: 'Non-negotiable boundaries and restrictions' },
  'CONTEXT.md':    { label: 'Context Guide',  desc: 'What the agent should know about the current project' },
};

// ─── Model Picker ────────────────────────────────────────────

let _availableModels = null;

async function loadAvailableModels() {
  if (_availableModels) {return _availableModels;}
  try {
    const data = await api('/agents/models/available');
    _availableModels = data;
    // Invalidate cache after 5 min
    setTimeout(() => { _availableModels = null; }, 300000);
    return data;
  } catch { return { models: [], providers: [] }; }
}

function renderModelPicker(agentId, currentModel) {
  return `<div class="detail-model-picker" id="model-picker-${agentId}">
    <select class="model-select" id="model-select-${agentId}" onchange="setAgentModel('${agentId}', this.value)">
      <option value="">Loading models...</option>
    </select>
  </div>`;
}

async function populateModelPicker(agentId, currentModel) {
  const select = document.getElementById(`model-select-${agentId}`);
  if (!select) {return;}

  const data = await loadAvailableModels();
  const models = data?.models || [];

  // Group by provider
  const groups = {};
  for (const m of models) {
    const prov = m.provider || 'other';
    if (!groups[prov]) {groups[prov] = [];}
    groups[prov].push(m);
  }

  // Sort providers: direct providers first, then openrouter
  const provOrder = ['anthropic', 'openai', 'openrouter'];
  const sortedProvs = Object.keys(groups).toSorted((a, b) => {
    const ai = provOrder.indexOf(a);
    const bi = provOrder.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  let html = '';
  for (const prov of sortedProvs) {
    const provModels = groups[prov];
    // For OpenRouter, show only curated top models (not 349 alphabetical)
    // Top models by OpenRouter leaderboard (updated 2026-03-25)
    const OR_TOP_IDS = [
      'xiaomi/mimo-v2-pro',               // #1 this week
      'stepfun/step-3.5-flash',           // #2 free tier
      'minimax/minimax-m2.5',             // #3
      'deepseek/deepseek-v3.2',           // #4
      'z-ai/glm-5-turbo',                 // #5
      'anthropic/claude-sonnet-4',         // #6
      'anthropic/claude-opus-4',           // #7
      'google/gemini-3-flash',             // #8
      'openrouter/hunter-alpha',           // #9
      'google/gemini-2.5-flash',           // #10
    ];
    let display;
    if (prov === 'openrouter') {
      // Match by prefix so versioned IDs (e.g. claude-opus-4-6) still match
      display = provModels.filter(m => {
        const bare = m.id.replace('openrouter/', '');
        return OR_TOP_IDS.some(top => bare.startsWith(top));
      });
      // If filtering yields nothing (API IDs changed), fall back to first 15
      if (!display.length) {display = provModels.slice(0, 15);}
    } else {
      display = provModels;
    }
    const label = prov === 'anthropic' ? 'Anthropic (Direct)'
      : prov === 'openai' ? 'OpenAI (Direct)'
      : prov === 'openrouter' ? 'OpenRouter'
      : prov;

    html += `<optgroup label="${escHtml(label)}">`;
    for (const m of display) {
      const cost = m.inputCost > 0 ? ` — $${m.inputCost.toFixed(2)}/$${m.outputCost.toFixed(2)} per M` : '';
      const selected = m.id === currentModel ? ' selected' : '';
      html += `<option value="${escHtml(m.id)}"${selected}>${escHtml(m.name)}${cost}</option>`;
    }
    html += `</optgroup>`;
  }

  // If current model not in list, add it as first option
  const allIds = models.map(m => m.id);
  if (currentModel && !allIds.includes(currentModel)) {
    html = `<option value="${escHtml(currentModel)}" selected>${escHtml(currentModel)} (current)</option>` + html;
  }

  select.innerHTML = html;
}

async function setAgentModel(agentId, modelId) {
  if (!modelId) {return;}
  const res = await api(`/agents/${agentId}/model`, {
    method: 'POST',
    body: { model: modelId },
  });
  if (res?.ok) {
    const info = modelTierInfo(modelId);
    showToast(`Model set to ${info.label}`, 'success');
    // Update the card badge in org chart immediately
    const card = document.querySelector(`.tc-card[data-agent-id="${agentId}"]`);
    if (card) {
      const tierEl = card.querySelector('.tc-tier');
      if (tierEl) {
        tierEl.className = `tc-tier ${info.cls}`;
        tierEl.textContent = info.label;
      }
    }
    // Update chat badge if visible
    if (typeof updateModelBadge === 'function') {updateModelBadge(agentId, modelId);}
  } else {
    showToast(res?.error || 'Failed to set model', 'error');
  }
}

// ─── Agent Detail Panel ──────────────────────────────────────

async function openAgentDetail(agentId) {
  const agent = await api(`/agents/${agentId}`);
  if (!agent || agent.error) {return;}

  let orgNode = null;
  function findNode(n, id) {
    if (n.id === id) {return n;}
    for (const c of (n.reports || [])) {
      const found = findNode(c, id);
      if (found) {return found;}
    }
    return null;
  }
  if (_orgData?.hierarchy) {orgNode = findNode(_orgData.hierarchy, agentId);}

  const panel = document.getElementById('team-detail-panel');
  const overlay = document.getElementById('team-detail-overlay');
  if (!panel || !overlay) {return;}

  const recentRuns = agent.runs?.slice(0, 5) || [];
  const files = agent.workspaceFiles || [];
  const avatarUrl = agent.avatar_url || '';
  const avatarInner = avatarUrl
    ? `<img src="${escHtml(avatarUrl)}" alt="" class="detail-avatar-img">`
    : `<svg width="28" height="28" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="6" r="3" stroke="currentColor" stroke-width="1.2" opacity="0.4"/><path d="M2.5 14c0-3 2.5-5.5 5.5-5.5s5.5 2.5 5.5 5.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity="0.4"/></svg>`;

  panel.innerHTML = `
    <input type="file" id="avatar-file-input" accept="image/*" style="display:none" onchange="handleAvatarUpload('${agentId}', this)">
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
      ${renderModelPicker(agentId, agent.model || '')}
    </div>

    ${orgNode?.description ? `<p class="detail-desc">${escHtml(orgNode.description)}</p>` : ''}

    <div class="detail-section">
      <div class="detail-label">Last Active</div>
      <div>${timeAgo(agent.last_active_at)}</div>
    </div>

    ${agent.last_task ? `<div class="detail-section">
      <div class="detail-label">Last Task</div>
      <div class="detail-last-task">${escHtml(agent.last_task)}</div>
    </div>` : ''}

    ${files.length ? `<div class="detail-section">
      <div class="detail-label">Agent Configuration</div>
      <div class="detail-config-list">
        ${files.filter(f => !f.isDir && !(_FILE_META[f.name]?.hidden)).map(f => {
          const meta = _FILE_META[f.name] || { label: f.name, desc: 'Agent file' };
          const isReadOnly = meta.readOnly;
          const lockIcon = isReadOnly ? '<span class="config-file-lock" title="Read-only — updated automatically">&#128274;</span>' : '';
          return `<button class="config-file-row ${isReadOnly ? 'config-file-readonly' : ''}" onclick="openFileEditor('${escHtml(f.path)}', '${escHtml(f.name)}')">
            <div class="config-file-icon">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 2h6l4 4v8a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" stroke-width="1.2"/><path d="M10 2v4h4" stroke="currentColor" stroke-width="1.2"/></svg>
            </div>
            <div class="config-file-info">
              <div class="config-file-name">${escHtml(meta.label)}${lockIcon}</div>
              <div class="config-file-desc">${escHtml(meta.desc)}</div>
            </div>
            <div class="config-file-arrow">
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </div>
          </button>`;
        }).join('')}
      </div>
    </div>` : ''}

    ${recentRuns.length ? `<div class="detail-section">
      <div class="detail-label">Recent Runs</div>
      ${recentRuns.map(r => `<div class="run-item">
        <span class="run-status ${r.status}">${r.status}</span>
        <span class="run-cmd">${escHtml((r.command || '').substring(0, 60))}</span>
        <span class="run-time">${timeAgo(r.started_at)}</span>
      </div>`).join('')}
    </div>` : ''}

    <div class="detail-actions">
      <button class="btn btn-ghost btn-sm" onclick="renameAgent('${agentId}')">Rename</button>
      <button class="btn btn-ghost btn-sm" onclick="document.getElementById('avatar-file-input').click()">Avatar</button>
      <button class="btn btn-ghost btn-sm" onclick="openChatWith('${agentId}')">Chat</button>
    </div>
  `;

  overlay.classList.remove('hidden');
  panel.classList.remove('hidden');

  // Populate model picker asynchronously
  populateModelPicker(agentId, agent.model || '');
}

// ─── File Editor ─────────────────────────────────────────────

function _confirmFileChange(label) {
  return new Promise(resolve => {
    const content = document.getElementById('modal-content');
    window._dashDialogPrev = content ? content.innerHTML : null;
    window._dashDialogPrevClass = content?.parentElement?.className || '';
    showModal(`
      <div class="dash-dialog">
        <div class="file-confirm-danger">
          <svg width="20" height="20" viewBox="0 0 16 16" fill="none"><path d="M8 1L1 14h14L8 1z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 6v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="8" cy="12" r="0.8" fill="currentColor"/></svg>
          <div>
            <strong>You are about to change "${label}"</strong>
            <p>This will directly affect how this agent thinks, responds, and operates. Incorrect changes could break the agent's behaviour.</p>
          </div>
        </div>
        <div class="file-confirm-input-wrap">
          <label>Type <strong>CONFIRM</strong> to save changes</label>
          <input type="text" id="file-confirm-input" class="file-confirm-input" placeholder="Type CONFIRM here" autocomplete="off" spellcheck="false">
        </div>
        <div class="dash-dialog-btns">
          <button class="btn btn-ghost" onclick="closeDashDialog(false)">Cancel</button>
          <button class="btn btn-danger" id="file-confirm-btn" disabled onclick="closeDashDialog(true)">Save Changes</button>
        </div>
      </div>
    `);
    window._dashDialogResolve = resolve;
    const inp = document.getElementById('file-confirm-input');
    const btn = document.getElementById('file-confirm-btn');
    if (inp && btn) {
      inp.addEventListener('input', () => {
        btn.disabled = inp.value.trim() !== 'CONFIRM';
      });
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter' && inp.value.trim() === 'CONFIRM') {closeDashDialog(true);}
      });
      setTimeout(() => inp.focus(), 50);
    }
  });
}

async function openFileEditor(filePath, fileName) {
  const meta = _FILE_META[fileName] || { label: fileName, desc: '' };
  const isReadOnly = meta.readOnly;
  const modal = document.getElementById('modal-content');
  const overlay = document.getElementById('modal-overlay');
  if (!modal || !overlay) {return;}

  modal.innerHTML = `<div class="file-editor-loading">Loading...</div>`;
  overlay.classList.remove('hidden');
  overlay.querySelector('.modal')?.classList.add('modal-fullscreen');

  try {
    const data = await api('/files/read?path=' + encodeURIComponent(filePath));
    if (data?.error) {throw new Error(data.error);}

    const hintText = isReadOnly
      ? 'This file contains product instructions and is updated automatically. You can view it but changes are not saved. To customize this agent, edit "Personality (Your Customizations)" instead.'
      : 'Editing this file will change how this agent thinks and behaves. Changes take effect on the agent\'s very next message. If you\'re unsure, ask your AI team lead first.';

    modal.innerHTML = `
      <div class="file-editor">
        <div class="file-editor-header">
          <div>
            <h2>${escHtml(meta.label)}${isReadOnly ? ' &#128274;' : ''}</h2>
            <p class="file-editor-desc">${escHtml(meta.desc)}</p>
          </div>
          <button class="btn-icon" onclick="closeModal()">&#10005;</button>
        </div>
        <div class="file-editor-hint${isReadOnly ? ' file-editor-hint-readonly' : ''}">
          ${hintText}
        </div>
        <textarea id="file-editor-textarea" class="file-editor-textarea" spellcheck="false" ${isReadOnly ? 'readonly' : ''}>${escHtml(data.content || '')}</textarea>
        <div class="file-editor-footer">
          <span class="file-editor-size" id="file-editor-size">${(data.content || '').length.toLocaleString()} chars</span>
          <div class="file-editor-actions">
            <button class="btn btn-ghost" onclick="closeModal()">${isReadOnly ? 'Close' : 'Cancel'}</button>
            ${isReadOnly ? '' : `<button class="btn btn-primary" onclick="saveFileEditor('${escHtml(filePath)}')">Save Changes</button>`}
          </div>
        </div>
      </div>
    `;

    const ta = document.getElementById('file-editor-textarea');
    const sizeEl = document.getElementById('file-editor-size');
    if (ta && sizeEl) {
      ta.addEventListener('input', () => {
        const len = ta.value.length;
        sizeEl.textContent = len.toLocaleString() + ' chars';
        sizeEl.style.color = len > 18000 ? 'var(--red)' : len > 15000 ? 'var(--yellow)' : '';
      });
    }
  } catch (e) {
    modal.innerHTML = `<p style="color:var(--red)">Failed to load file: ${escHtml(e.message)}</p>`;
  }
}

async function saveFileEditor(filePath) {
  const ta = document.getElementById('file-editor-textarea');
  if (!ta) {return;}

  const fileName = filePath.split('/').pop();
  const meta = _FILE_META[fileName] || { label: fileName };
  const confirmed = await _confirmFileChange(meta.label);
  if (!confirmed) {return;}

  const content = ta.value;
  const btn = ta.closest('.file-editor')?.querySelector('.btn-primary');
  if (btn) { btn.textContent = 'Saving...'; btn.disabled = true; }

  try {
    const result = await api('/files/save', {
      method: 'PUT',
      body: { path: filePath, content },
    });
    if (result?.ok) {
      showToast('Saved — changes apply on next message', 'success');
      closeModal();
    } else {
      showToast(result?.error || 'Save failed', 'error');
      if (btn) { btn.textContent = 'Save Changes'; btn.disabled = false; }
    }
  } catch (e) {
    showToast('Save failed: ' + e.message, 'error');
    if (btn) { btn.textContent = 'Save Changes'; btn.disabled = false; }
  }
}

// ─── Avatar + Actions ────────────────────────────────────────

async function handleAvatarUpload(agentId, input) {
  const file = input.files?.[0];
  if (!file) {return;}
  if (!file.type.startsWith('image/')) { showToast('Please select an image file', 'error'); return; }
  if (file.size > 10 * 1024 * 1024) { showToast('Image too large (max 10MB)', 'error'); return; }

  const SIZE = 200;
  const img = new Image();
  img.onload = async () => {
    const canvas = document.createElement('canvas');
    canvas.width = SIZE; canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    const min = Math.min(img.width, img.height);
    const sx = (img.width - min) / 2;
    const sy = (img.height - min) / 2;
    ctx.drawImage(img, sx, sy, min, min, 0, 0, SIZE, SIZE);

    const dataUrl = canvas.toDataURL('image/png');
    const result = await api(`/agents/${agentId}/avatar`, {
      method: 'POST',
      body: { image: dataUrl },
    });
    if (result?.ok) {
      showToast('Avatar updated', 'success');
      const wrap = document.querySelector('.detail-avatar-wrap');
      if (wrap) {
        const imgEl = wrap.querySelector('.detail-avatar-img');
        if (imgEl) { imgEl.src = result.avatar_url; }
        else { wrap.insertAdjacentHTML('afterbegin', `<img src="${result.avatar_url}" alt="" class="detail-avatar-img">`); }
      }
      const orgEl = document.querySelector('team-org-chart'); if (orgEl) {orgEl.load();}
    } else {
      showToast(result?.error || 'Upload failed', 'error');
    }
  };
  img.onerror = () => showToast('Could not read image', 'error');
  img.src = URL.createObjectURL(file);
  input.value = '';
}

function closeAgentDetail() {
  document.getElementById('team-detail-panel')?.classList.add('hidden');
  document.getElementById('team-detail-overlay')?.classList.add('hidden');
}

function openChatWith(agentId) {
  closeAgentDetail();
  openChat(agentId);
}

async function renameAgent(agentId) {
  const current = document.querySelector('.detail-name')?.textContent || agentId;
  const newName = typeof dashPrompt === 'function'
    ? await dashPrompt('Rename agent:', current)
    : prompt('Rename agent:', current);
  if (!newName?.trim() || newName.trim() === current) {return;}
  const result = await api(`/agents/${agentId}/rename`, {
    method: 'PATCH',
    body: { name: newName.trim() },
  });
  if (result?.ok) {
    showToast(`Renamed to "${newName.trim()}"`, 'success');
    closeAgentDetail();
    loadTeam();
  } else {
    showToast(result?.error || 'Rename failed', 'error');
  }
}
