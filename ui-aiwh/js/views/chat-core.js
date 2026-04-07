// ─── Chat View: Core State & Messaging ──────────────────────────────
// Global state, init, sessions, send/abort, model badges, connection status.
// Agent sidebar → chat-agents.js | Commands panel → chat-commands.js

let _chatAgentId = 'main';
let _chatSessionId = 'agent:main:main';
let _chatPendingText = '';
let _chatAgentsLoaded = false;
let _chatCurrentModel = {}; // { agentId: modelId }
let _chatIsStreaming = false;
let _chatAbortController = null;
let _chatHistorySeq = 0;

async function initChat() {
  // Theme Z: <aiwh-chat-host> handles messages + streaming.
  // Sidebar (agents + sessions) is still vanilla JS — always load.
  if (!_chatAgentsLoaded) {await loadChatAgentList();}
  if (typeof _chatSttInit === 'function') {_chatSttInit();}
  if (typeof _chatTtsInit === 'function') {_chatTtsInit();}
  // Sessions sidebar is outside Lit host — always populate
  loadChatSessions();
}

// ─── Sessions Panel ─────────────────────────────────────────

async function loadChatSessions() {
  const sessions = await api(`/chat/sessions?agentId=${_chatAgentId}`);
  const list = document.getElementById('chat-session-list');
  if (!list || !Array.isArray(sessions)) {return;}

  const agentSessions = sessions.filter(s => s.agent_id === _chatAgentId);

  if (!agentSessions.length) {
    list.innerHTML = '<div class="chat-session-empty">No sessions yet</div>';
    return;
  }

  list.innerHTML = agentSessions.map(s => {
    const isActive = s.session_id === _chatSessionId;
    const label = s.label || (s.session_id === 'default' ? 'Default Session' : s.session_id);
    const shortLabel = label.length > 24 ? label.substring(0, 22) + '...' : label;
    const preview = s.last_message ? s.last_message.substring(0, 60) + (s.last_message.length > 60 ? '...' : '') : '';
    const when = s.last_message_at ? timeAgo(s.last_message_at) : '';
    const kind = s.kind && s.kind !== 'session' ? `<span class="session-kind">${escHtml(s.kind)}</span>` : '';
    const modelInfo = s.model ? `<span class="session-model">${escHtml(s.model.replace('claude-','').split('-')[0])}</span>` : '';
    const sessId = escHtml(s.session_id);
    return `<div class="chat-session-item ${isActive ? 'active' : ''}" data-session-id="${sessId}">
      <div class="chat-session-item-main" onclick="selectChatSession('${sessId}')">
        <div class="chat-session-item-top">
          <span class="chat-session-item-name">${escHtml(shortLabel)}</span>
          <span class="chat-session-item-meta">${kind}${modelInfo}</span>
        </div>
        ${preview ? `<div class="chat-session-item-preview">${escHtml(preview)}</div>` : ''}
        <div class="chat-session-item-time">${when}</div>
      </div>
      <div class="chat-session-actions">
        <button class="chat-session-action" onclick="renameSession('${sessId}')" title="Rename">✎</button>
        <button class="chat-session-action danger" onclick="deleteSession('${sessId}')" title="Delete">✕</button>
      </div>
    </div>`;
  }).join('');

  _updateSessionDropdown(sessions);
}

function _updateSessionDropdown(sessions) {
  const dropdown = document.getElementById('chat-session-dropdown');
  if (!dropdown) {return;}
  const filtered = sessions.filter(s => s.agent_id === _chatAgentId);
  dropdown.innerHTML = filtered.map(s => {
    const label = s.label || s.session_id;
    const shortLabel = label.length > 35 ? label.substring(0, 33) + '...' : label;
    return `<option value="${escHtml(s.session_id)}" ${s.session_id === _chatSessionId ? 'selected' : ''}>${escHtml(shortLabel)}</option>`;
  }).join('');
}

function refreshChatSession() {
  loadChatHistory();
  loadChatSessions();
}

async function deleteSession(sessionId) {
  if (typeof dashConfirm === 'function') {
    const ok = await dashConfirm('Delete this session?');
    if (!ok) {return;}
  }
  try {
    const resp = await fetch(`/api/chat/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
    const data = await resp.json();
    if (data.ok) {
      showToast('Session deleted');
      if (sessionId === _chatSessionId) {
        _chatSessionId = `agent:${_chatAgentId}:main`;
        loadChatHistory();
      }
      loadChatSessions();
    } else {
      showToast('Delete failed: ' + (data.error || 'unknown'), 'error');
    }
  } catch (e) {
    showToast('Delete failed: ' + e.message, 'error');
  }
}

async function renameSession(sessionId) {
  let newLabel;
  if (typeof dashPrompt === 'function') {
    newLabel = await dashPrompt('Session label:', sessionId);
  } else {
    newLabel = prompt('Session label:', sessionId);
  }
  if (!newLabel || newLabel === sessionId) {return;}
  try {
    await fetch(`/api/chat/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: newLabel }),
    });
    loadChatSessions();
  } catch {}
}

function selectChatSession(sessionId) {
  _chatSessionId = sessionId;
  document.querySelectorAll('.chat-session-item').forEach(el => {
    el.classList.toggle('active', el.dataset.sessionId === sessionId);
  });
  // Notify Lit chat host about session switch
  document.dispatchEvent(new CustomEvent('aiwh-session-switch', { detail: { sessionKey: sessionId } }));
}

// ─── Chat History ───────────────────────────────────────────

function updateChatHeader() {
  const nameEl = document.getElementById('chat-view-agent-name');
  const displayName = _chatGetAgentName(_chatAgentId);
  if (nameEl) {nameEl.textContent = displayName;}
}

// _updateContextBadge is in chat-render.js

async function loadChatHistory() {
  updateChatHeader();
  const seq = ++_chatHistorySeq;
  const data = await api(`/chat/history?agentId=${_chatAgentId}&sessionId=${_chatSessionId}`);
  if (seq !== _chatHistorySeq) {return;}
  const msgs = Array.isArray(data) ? data : (data?.messages || []);
  const context = data?.context || null;
  renderChatMessages(msgs);
  _updateContextBadge(context);
  api(`/chat/model/${_chatAgentId}`).then(r => {
    if (r?.model) {updateModelBadge(_chatAgentId, r.model);}
  }).catch(() => {});
}

// ─── Send Message ───────────────────────────────────────────

async function sendChatMessage() {
  const input = document.getElementById('chat-input');
  if (!input) {return;}
  const message = input.value.trim();
  const attachments = typeof _chatGetAttachmentsForSend === 'function' ? _chatGetAttachmentsForSend() : [];
  if (!message && attachments.length === 0) {return;}

  input.value = '';
  if (typeof _chatClearAttachments === 'function') {_chatClearAttachments();}

  // Intercept /model command
  const modelMatch = message.match(/^\/model\s+(\S+)/i);
  if (modelMatch) {
    const model = modelMatch[1];
    try {
      const r = await fetch(`/api/chat/model/${_chatAgentId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
      });
      const data = await r.json();
      if (data.ok) {
        updateModelBadge(_chatAgentId, data.model);
        _appendGroupToThread({ role: 'assistant', messages: [{ content: `Model switched to **${data.model}**` }], lastTimestamp: new Date().toISOString(), agentId: _chatAgentId });
      } else {
        _appendGroupToThread({ role: 'assistant', messages: [{ content: `Failed to switch model: ${data.error || 'unknown error'}` }], lastTimestamp: new Date().toISOString(), agentId: _chatAgentId });
      }
    } catch (e) {
      _appendGroupToThread({ role: 'assistant', messages: [{ content: `Error: ${e.message}` }], lastTimestamp: new Date().toISOString(), agentId: _chatAgentId });
    }
    input.focus();
    return;
  }

  input.disabled = true;
  _chatIsStreaming = true;
  _updateSendButton();

  _appendGroupToThread({ role: 'user', messages: [{ content: message }], lastTimestamp: new Date().toISOString(), agentId: 'you' });

  const msgId = 'streaming-' + Date.now();
  _appendStreamingPlaceholder(msgId);

  _chatPendingText = '';
  _chatAbortController = new AbortController();

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, agentId: _chatAgentId, sessionId: _chatSessionId, attachments }),
      signal: _chatAbortController.signal,
    });

    if (!res.ok || !res.body) {
      // Handle 401 — redirect to login
      if (res.status === 401) {
        try {
          const err = await res.json();
          if (err?.redirect) { window.location.href = err.redirect; return; }
        } catch {}
        window.location.href = '/login.html';
        return;
      }
      _updateStreamingBubble(msgId, '[Error: could not connect to gateway]');
      _finishStreaming(input);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) {break;}
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) {continue;}
        try {
          const event = JSON.parse(line.slice(6));
          if (event.type === 'delta') {
            // Delta may be full accumulated text (from poll) or incremental
            // If it's longer than what we have, it's the full text — replace
            if (event.delta.length >= _chatPendingText.length) {
              _chatPendingText = event.delta;
            } else {
              _chatPendingText += event.delta;
            }
            _updateStreamingBubble(msgId, _chatPendingText);
          } else if (event.type === 'tool_start') {
            _showToolIndicator(msgId, event.name);
          } else if (event.type === 'tool_end') {
            _hideToolIndicator(msgId);
          } else if (event.type === 'model_change' || event.type === 'model') {
            updateModelBadge(_chatAgentId, event.modelId || event.model || '');
          } else if (event.type === 'done') {
            _hideToolIndicator(msgId);
            if (_chatPendingText) {
              _updateStreamingBubble(msgId, _chatPendingText);
              // Add Listen button to finalized streaming bubble
              if (typeof _chatTtsEnabled !== 'undefined' && _chatTtsEnabled) {
                const group = document.getElementById(msgId);
                const footer = group?.querySelector('.chat-group-footer');
                if (footer && !group.querySelector('.chat-listen-btn')) {
                  const cost = typeof _chatTtsCostEstimate === 'function' && _chatPendingText.length > 10 ? ' (' + _chatTtsCostEstimate(_chatPendingText.length) + ')' : '';
                  const btn = document.createElement('button');
                  btn.className = 'chat-listen-btn';
                  btn.onclick = function() { _chatRequestTts(this); };
                  btn.title = 'Listen to reply';
                  btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 2l10 6-10 6V2z" fill="currentColor"/></svg> Listen' + cost;
                  footer.parentNode.insertBefore(btn, footer);
                }
              }
            } else {
              const placeholder = document.getElementById(msgId);
              if (placeholder) {placeholder.remove();}
              loadChatHistory();
            }
            loadChatSessions();
          } else if (event.type === 'error') {
            if (event.error) {_updateStreamingBubble(msgId, `[Error: ${event.error}]`);}
          }
        } catch {}
      }
    }

    // Stream ended without 'done' event — finalize
    if (_chatPendingText) {
      _updateStreamingBubble(msgId, _chatPendingText);
    } else {
      const placeholder = document.getElementById(msgId);
      if (placeholder) {placeholder.remove();}
      loadChatHistory();
    }
  } catch (e) {
    if (e.name === 'AbortError') {
      // User clicked Stop
    } else {
      _updateStreamingBubble(msgId, `[Error: ${e.message}]`);
    }
  }

  _chatAbortController = null;
  _finishStreaming(input);
}

function _finishStreaming(input) {
  _chatIsStreaming = false;
  _updateSendButton();
  if (input) { input.disabled = false; input.focus(); }
}

function _updateSendButton() {
  const btn = document.querySelector('.chat-send');
  if (!btn) {return;}
  if (_chatIsStreaming) {
    btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="3" y="3" width="10" height="10" rx="2" fill="currentColor"/></svg><span>Stop</span>`;
    btn.title = 'Stop generation';
  } else {
    btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2 8h12M9 3l5 5-5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Send</span>`;
    btn.title = 'Send message';
  }
}

function appendChatMessage(msg, id) { if (id) { _appendStreamingPlaceholder(id); return; } _appendGroupToThread({ role: msg.role, messages: [msg], lastTimestamp: msg.created_at || new Date().toISOString(), agentId: msg.agent_id || _chatAgentId }); }
function updateStreamingMsg(id, text) { _updateStreamingBubble(id, text); }

async function abortChatStream() {
  if (_chatAbortController) { _chatAbortController.abort(); _chatAbortController = null; }
  try { await fetch('/api/chat/abort', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agentId: _chatAgentId, sessionId: _chatSessionId }) }); } catch {}
  _finishStreaming(document.getElementById('chat-input'));
  loadChatHistory();
}

async function newChatSession() {
  const displayName = _chatGetAgentName(_chatAgentId);
  const el = document.getElementById('chat-messages');
  if (el) {el.innerHTML = `<div class="chat-empty">Starting fresh session with ${escHtml(displayName)}...</div>`;}
  _updateContextBadge(null);
  try {
    const r = await fetch('/api/chat/new', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: _chatAgentId, sessionId: _chatSessionId }),
    });
    const data = await r.json();
    if (!data.ok) {console.log('[chat] /new error:', data.error);}
  } catch (e) {
    console.log('[chat] /new failed:', e.message);
  }
  loadChatHistory();
  loadChatSessions();
}

// ─── Model Badges ───────────────────────────────────────────

function modelBadgeInfo(modelStr) {
  const info = modelTierInfo(modelStr);
  return { cls: info.cls, label: info.label };
}

function updateModelBadge(agentId, modelId) {
  _chatCurrentModel[agentId] = modelId;
  const badge = document.getElementById(`model-badge-${agentId}`);
  if (!badge) {return;}
  const { cls, label } = modelBadgeInfo(modelId);
  badge.className = `agent-model-badge ${cls}`;
  badge.textContent = label;
}

// ─── Input Handling ─────────────────────────────────────────

function handleChatSendClick() {
  if (_chatIsStreaming) { abortChatStream(); } else { sendChatMessage(); }
}

function chatKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (!_chatIsStreaming) {sendChatMessage();}
  }
  requestAnimationFrame(() => _chatAutoResize(e.target));
}

function _chatAutoResize(textarea) {
  if (!textarea) {return;}
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 150) + 'px';
}

// ─── Connection Status ──────────────────────────────────────

let _chatGatewayConnected = true;

async function _chatCheckConnection() {
  try {
    const r = await fetch('/api/gateway/status');
    const data = await r.json();
    _chatGatewayConnected = data?.connected === true;
  } catch {
    _chatGatewayConnected = false;
  }
  _chatUpdateConnectionUI();
}

function _chatUpdateConnectionUI() {
  const indicator = document.getElementById('chat-connection-status');
  if (indicator) {
    indicator.className = `chat-connection-dot ${_chatGatewayConnected ? 'connected' : 'disconnected'}`;
    indicator.title = _chatGatewayConnected ? 'Connected to gateway' : 'Disconnected from gateway';
  }
  const input = document.getElementById('chat-input');
  if (input && !_chatIsStreaming) {
    input.disabled = !_chatGatewayConnected;
    if (!_chatGatewayConnected) {
      input.placeholder = 'Disconnected from gateway...';
    } else {
      const displayName = _chatGetAgentName(_chatAgentId);
      input.placeholder = `Message ${displayName}...`;
    }
  }
}

setInterval(_chatCheckConnection, 15000);
setTimeout(_chatCheckConnection, 2000);
