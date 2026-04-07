// ─── Chat View: Agent Sidebar & Selection ───────────────────────────
// Extracted from chat-core.js. Manages agent list, selection, display names.
// Globals used: _chatAgentId, _chatSessionId, _chatCurrentModel (from chat-core.js)
// Globals provided: loadChatAgentList, selectChatAgent, _chatGetAgentName, openChat, closeChat, switchChatAgent

// ─── Agent Sidebar ──────────────────────────────────────────

async function loadChatAgentList() {
  const data = await api('/agents');
  const agents = Array.isArray(data) ? data : (data?.agents || []);
  if (!agents.length) {return;}

  const list = document.getElementById('chat-agent-list');
  if (!list) {return;}

  const sorted = [...agents].toSorted((a, b) => {
    if (a.id === 'main') {return -1;}
    if (b.id === 'main') {return 1;}
    return (a.name || a.id).localeCompare(b.name || b.id);
  });

  let html = '';

  const branson = sorted.find(a => a.id === 'main');
  if (branson) {
    const isActive = _chatAgentId === 'main';
    const currentModel = _chatCurrentModel['main'] || branson.model || 'claude-opus-4-6';
    const { cls: bCls, label: bLabel } = modelBadgeInfo(currentModel);
    html += `<button class="chat-agent-item chat-agent-recommended ${isActive ? 'active' : ''}" onclick="selectChatAgent('main')" title="CEO — main orchestrator, can delegate to all other agents" data-agent-id="main">
      <span class="agent-orb orb-idle"></span>
      <span class="chat-agent-item-name">Branson</span>
      <span class="agent-model-badge ${bCls}" id="model-badge-main">${bLabel}</span>
    </button>`;
  }

  html += `<div class="chat-agent-notice">Branson is the main orchestrator. He can delegate to all agents. Talk to him first unless you need a specific agent directly.</div>`;
  html += `<div class="chat-agent-divider">Other Agents</div>`;

  sorted.filter(a => a.id !== 'main').forEach(a => {
    const isActive = a.id === _chatAgentId;
    const currentModel = _chatCurrentModel[a.id] || a.model || a.model_tier || a.modelTier || '';
    const { cls, label } = modelBadgeInfo(currentModel);
    html += `<button class="chat-agent-item ${isActive ? 'active' : ''}" onclick="selectChatAgent('${a.id}')" title="${escHtml(a.description || a.role || '')}" data-agent-id="${a.id}">
      <span class="agent-orb orb-idle"></span>
      <span class="chat-agent-item-name">${escHtml(a.displayName || a.name || a.id)}</span>
      <span class="agent-model-badge ${cls}" id="model-badge-${a.id}">${escHtml(label)}</span>
    </button>`;
  });

  list.innerHTML = html;
  _chatAgentsLoaded = true;
}

// ─── Agent Selection ────────────────────────────────────────

function selectChatAgent(agentId) {
  _chatAgentId = agentId;
  _chatSessionId = `agent:${agentId}:main`;

  document.querySelectorAll('.chat-agent-item').forEach(el => {
    el.classList.toggle('active', el.getAttribute('onclick')?.includes(`'${agentId}'`));
  });

  const displayName = _chatGetAgentName(agentId);
  const nameEl = document.getElementById('chat-view-agent-name');
  if (nameEl) {nameEl.textContent = displayName;}

  // Notify Lit chat host via custom event (Theme Z)
  document.dispatchEvent(new CustomEvent('aiwh-agent-switch', { detail: { agentId } }));

  // Fallback: call old globals if Lit host not yet mounted
  if (typeof loadChatSessions === 'function') {loadChatSessions();}
  if (typeof loadChatHistory === 'function') {loadChatHistory();}

  api(`/chat/model/${agentId}`).then(r => {
    if (r?.model) {updateModelBadge(agentId, r.model);}
  }).catch(() => {});
}

// ─── Agent Display Name Helper ──────────────────────────────

function _chatGetAgentName(agentId) {
  if (agentId === 'main') {return 'Branson';}
  const btn = document.querySelector(`.chat-agent-item[data-agent-id="${agentId}"] .chat-agent-item-name`);
  if (btn) {return btn.textContent.trim();}
  return agentId;
}

// ─── Legacy Compat ──────────────────────────────────────────

function openChat(agentId, sessionId) {
  _chatAgentId = agentId || 'main';
  _chatSessionId = sessionId || 'default';
  switchView('chat');
}

function closeChat() {}

function switchChatAgent(agentId) {
  selectChatAgent(agentId);
}
