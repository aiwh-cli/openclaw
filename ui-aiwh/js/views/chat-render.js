// ─── Chat View: Message Rendering ───────────────────────────────────
// This file contains:
//   - Message grouping (_groupMessages)
//   - Date dividers (_getDateLabel)
//   - renderChatMessages, renderChatGroup
//   - Tool card rendering (_renderToolCard, _renderToolResult)
//   - Copy button
//   - Markdown rendering (formatChatContent, formatMarkdownInline, etc.)
//   - Scroll management (_chatHandleScroll, _chatScrollToBottom)
//   - Streaming placeholders and bubble updates
//   - Typing indicators
//
// Loaded AFTER chat-core.js — uses globals:
//   _chatAgentId, _chatGetAgentName, escHtml, formatChatContent

// ─── Message Grouping ───────────────────────────────────────
// Groups consecutive messages from the same role together.
// Each group gets one avatar, one footer with name + timestamp.

function _groupMessages(msgs) {
  const groups = [];
  let current = null;

  for (const msg of msgs) {
    let role = msg.role || 'assistant';
    // Tool results belong to the assistant's turn -- group them together
    if (role === 'tool') {role = 'assistant';}
    if (current && current.role === role) {
      current.messages.push(msg);
      current.lastTimestamp = msg.created_at;
    } else {
      current = {
        role,
        messages: [msg],
        firstTimestamp: msg.created_at,
        lastTimestamp: msg.created_at,
        agentId: msg.agent_id || _chatAgentId,
      };
      groups.push(current);
    }
  }
  return groups;
}

// ─── Date dividers ──────────────────────────────────────────

function _getDateLabel(dateStr) {
  if (!dateStr) {return null;}
  const d = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = (today - msgDay) / 86400000;
  if (diff === 0) {return 'Today';}
  if (diff === 1) {return 'Yesterday';}
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

// ─── Render Messages ────────────────────────────────────────

function renderChatMessages(msgs) {
  const el = document.getElementById('chat-messages');
  if (!el) {return;}

  const displayName = _chatGetAgentName(_chatAgentId);

  if (!msgs.length) {
    el.innerHTML = `<div class="chat-empty">Start a conversation with ${escHtml(displayName)}</div>`;
    return;
  }

  // Server-side filtering handles /new clears -- no client-side marker needed

  const groups = _groupMessages(msgs);
  let html = '';
  let lastDateLabel = null;

  for (const group of groups) {
    // Date divider
    const dateLabel = _getDateLabel(group.firstTimestamp);
    if (dateLabel && dateLabel !== lastDateLabel) {
      html += `<div class="chat-divider"><span class="chat-divider-line"></span><span class="chat-divider-label">${dateLabel}</span><span class="chat-divider-line"></span></div>`;
      lastDateLabel = dateLabel;
    }
    html += renderChatGroup(group);
  }

  el.innerHTML = html;
  el.scrollTop = el.scrollHeight;
}

function renderChatGroup(group) {
  const isUser = group.role === 'user';
  const agentName = isUser ? 'You' : _chatGetAgentName(group.agentId);
  const initial = isUser ? 'U' : agentName.charAt(0).toUpperCase();
  const avatarClass = isUser ? 'user' : 'assistant';
  const groupClass = isUser ? 'user' : 'assistant';
  const ts = group.lastTimestamp ? _formatTimestamp(group.lastTimestamp) : '';

  const bubblesHtml = group.messages.map(msg => {
    let html = '';
    // Render tool_use cards (assistant calling tools)
    if (msg.tool_uses?.length) {
      html += msg.tool_uses.map(tu => _renderToolCard(tu)).join('');
    }
    // Render tool_result cards (tool responses)
    if (msg.tool_results?.length) {
      html += msg.tool_results.map(tr => _renderToolResult(tr)).join('');
    }
    // Render inline images (from content blocks or attachments)
    if (typeof _renderChatImages === 'function' && Array.isArray(msg.content_blocks)) {
      html += _renderChatImages(msg.content_blocks);
    }
    if (typeof _renderUserAttachmentImages === 'function' && msg.attachments?.length) {
      html += _renderUserAttachmentImages(msg.attachments);
    }
    // Render text content bubble
    const textContent = typeof msg.content === 'string' ? msg.content.trim() : '';
    if (textContent) {
      const content = formatChatContent(textContent);
      const hasCopy = !isUser;
      html += `<div class="chat-bubble${hasCopy ? ' has-copy' : ''}">${hasCopy ? _renderCopyBtn(textContent) : ''}${content}</div>`;
    }
    return html;
  }).join('');

  return `<div class="chat-group ${groupClass}">
    <div class="chat-avatar ${avatarClass}">${initial}</div>
    <div class="chat-group-messages">
      ${bubblesHtml}
      ${!isUser && typeof _chatTtsEnabled !== 'undefined' && _chatTtsEnabled ? (() => { const t = group.messages.map(m => typeof m.content === 'string' ? m.content : '').join(' ').trim(); const c = t.length > 10 && typeof _chatTtsCostEstimate === 'function' ? ' (' + _chatTtsCostEstimate(t.length) + ')' : ''; return '<button class="chat-listen-btn" onclick="_chatRequestTts(this)" title="Listen to reply"><svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 2l10 6-10 6V2z" fill="currentColor"/></svg> Listen' + c + '</button>'; })() : ''}
      <div class="chat-group-footer">
        <span class="chat-sender-name">${escHtml(agentName)}</span>
        <span class="chat-group-timestamp">${ts}</span>
      </div>
    </div>
  </div>`;
}

function _formatTimestamp(dateStr) {
  if (!dateStr) {return '';}
  const d = new Date(dateStr);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// ─── Copy button ────────────────────────────────────────────

function _renderCopyBtn(text) {
  const escaped = escHtml(text).replace(/'/g, '&#39;');
  return `<button class="chat-copy-btn" onclick="_chatCopyText(this)" data-copy-text="${escaped}" title="Copy as markdown">
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="5" y="5" width="9" height="9" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M3 11V3a1.5 1.5 0 011.5-1.5H11" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
  </button>`;
}

async function _chatCopyText(btn) {
  const text = btn.getAttribute('data-copy-text')
    ?.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
  if (!text) {return;}
  try {
    await navigator.clipboard.writeText(text);
    btn.classList.add('copied');
    setTimeout(() => btn.classList.remove('copied'), 1500);
  } catch {
    btn.classList.add('copy-error');
    setTimeout(() => btn.classList.remove('copy-error'), 1500);
  }
}

// ─── Tool Cards ─────────────────────────────────────────────

const _toolIcons = {
  read: '📄', write: '✏️', edit: '✏️', bash: '⚡', exec: '⚡',
  glob: '🔍', grep: '🔍', search: '🔍', web_search: '🌐', web_fetch: '🌐',
  sessions_spawn: '🚀', subagents: '🚀', message: '💬', memory_search: '🧠',
  memory_get: '🧠', image: '🖼️', default: '⚙️',
};

function _getToolIcon(name) {
  if (!name) {return _toolIcons.default;}
  const lower = name.toLowerCase();
  for (const [key, icon] of Object.entries(_toolIcons)) {
    if (lower.includes(key)) {return icon;}
  }
  return _toolIcons.default;
}

function _getToolLabel(name) {
  if (!name) {return 'Tool';}
  // Clean up tool names: sessions_spawn -> Sessions Spawn
  return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function _renderToolCard(toolUse) {
  const icon = _getToolIcon(toolUse.name);
  const label = _getToolLabel(toolUse.name);
  // Extract the key parameter for the "with" line
  let withParam = '';
  if (toolUse.input) {
    if (toolUse.input.file_path || toolUse.input.path) {
      withParam = `from ${toolUse.input.file_path || toolUse.input.path}`;
    } else if (toolUse.input.command) {
      withParam = toolUse.input.command.substring(0, 80);
    } else if (toolUse.input.pattern) {
      withParam = toolUse.input.pattern;
    } else if (toolUse.input.query) {
      withParam = toolUse.input.query.substring(0, 80);
    } else if (toolUse.input.message) {
      withParam = toolUse.input.message.substring(0, 80);
    } else if (typeof toolUse.input === 'string') {
      withParam = toolUse.input.substring(0, 80);
    }
  }
  const withHtml = withParam ? `<div class="chat-tool-with"><code>with</code> ${escHtml(withParam)}</div>` : '';

  return `<div class="chat-tool-card">
    <div class="chat-tool-header">
      <span class="chat-tool-icon">${icon}</span>
      <span class="chat-tool-title">${escHtml(label)}</span>
    </div>
    ${withHtml}
  </div>`;
}

function _renderToolResult(toolResult) {
  const isError = toolResult.is_error;
  const content = (toolResult.content || '').trim();
  if (!content && !isError) {return '';}

  const statusClass = isError ? 'error' : 'ok';
  const statusIcon = isError ? '✗' : '✓';
  const uid = 'tr-' + Math.random().toString(36).slice(2, 8);

  // Compact card: just status + optional expandable output
  let expandHtml = '';
  if (content.length > 0) {
    const preview = content.length > 500 ? content.substring(0, 500) + '...' : content;
    expandHtml = `<div class="chat-tool-expand" id="${uid}" style="display:none"><pre class="chat-tool-output">${escHtml(preview)}</pre></div>`;
  }

  return `<div class="chat-tool-card chat-tool-card-result ${statusClass}">
    <div class="chat-tool-header" ${content.length > 0 ? `onclick="document.getElementById('${uid}').style.display=document.getElementById('${uid}').style.display==='none'?'block':'none'" style="cursor:pointer"` : ''}>
      <span class="chat-tool-status ${statusClass}">${statusIcon}</span>
      <span class="chat-tool-status-text">${isError ? 'Failed' : 'Completed'}</span>
      ${content.length > 0 ? '<span class="chat-tool-chevron">&#9656;</span>' : ''}
    </div>
    ${expandHtml}
  </div>`;
}

// ─── Markdown Rendering ─────────────────────────────────────

function formatChatContent(text) {
  if (!text) {return '';}
  const parts = text.split(/(```[\s\S]*?```)/g);
  let html = '';
  for (const part of parts) {
    if (part.startsWith('```')) {
      const match = part.match(/^```(\w*)\n?([\s\S]*?)```$/);
      const lang = match?.[1] || '';
      const code = match?.[2] || part.slice(3, -3);
      html += `<pre class="chat-code-block"><code class="lang-${escHtml(lang)}">${escHtml(code)}</code></pre>`;
    } else {
      html += formatMarkdownInline(part);
    }
  }
  return html;
}

function formatMarkdownInline(text) {
  const lines = text.split('\n');
  let html = '';
  let inList = false;
  let inTable = false;
  let tableRows = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      if (!inTable) { inTable = true; tableRows = []; }
      if (/^\|[\s\-:|]+\|$/.test(trimmed)) {continue;}
      tableRows.push(trimmed);
      const next = lines[i + 1]?.trim() || '';
      if (!next.startsWith('|') || !next.endsWith('|')) {
        html += renderTable(tableRows);
        inTable = false;
        tableRows = [];
      }
      continue;
    }

    if (inList && !trimmed.startsWith('- ') && !trimmed.startsWith('* ') && !/^\d+\.\s/.test(trimmed)) {
      html += '</ul>';
      inList = false;
    }

    if (trimmed.startsWith('### ')) { html += `<h4 class="chat-h">${formatInlineStyles(trimmed.slice(4))}</h4>`; continue; }
    if (trimmed.startsWith('## '))  { html += `<h3 class="chat-h">${formatInlineStyles(trimmed.slice(3))}</h3>`; continue; }
    if (trimmed.startsWith('# '))   { html += `<h2 class="chat-h">${formatInlineStyles(trimmed.slice(2))}</h2>`; continue; }

    if (/^[-*_]{3,}$/.test(trimmed)) { html += '<hr class="chat-hr">'; continue; }

    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      if (!inList) { html += '<ul class="chat-list">'; inList = true; }
      html += `<li>${formatInlineStyles(trimmed.slice(2))}</li>`;
      continue;
    }

    const olMatch = trimmed.match(/^(\d+)\.\s(.+)/);
    if (olMatch) {
      if (!inList) { html += '<ul class="chat-list chat-ol">'; inList = true; }
      html += `<li>${formatInlineStyles(olMatch[2])}</li>`;
      continue;
    }

    if (trimmed.startsWith('> ')) {
      html += `<blockquote class="chat-quote">${formatInlineStyles(trimmed.slice(2))}</blockquote>`;
      continue;
    }

    if (!trimmed) { html += '<br>'; continue; }
    html += `<p class="chat-p">${formatInlineStyles(trimmed)}</p>`;
  }

  if (inList) {html += '</ul>';}
  return html;
}

function formatInlineStyles(text) {
  return escHtml(text)
    .replace(/`([^`]+)`/g, '<code class="chat-inline-code">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>');
}

function renderTable(rows) {
  if (!rows.length) {return '';}
  const parseRow = r => r.split('|').slice(1, -1).map(c => c.trim());
  const headers = parseRow(rows[0]);
  const body = rows.slice(1).map(parseRow);
  let html = '<table class="chat-table"><thead><tr>';
  for (const h of headers) {html += `<th>${formatInlineStyles(h)}</th>`;}
  html += '</tr></thead><tbody>';
  for (const row of body) {
    html += '<tr>';
    for (const cell of row) {html += `<td>${formatInlineStyles(cell)}</td>`;}
    html += '</tr>';
  }
  html += '</tbody></table>';
  return html;
}

// ─── Streaming Placeholders & Updates ────────────────────────

function _appendGroupToThread(group) {
  const el = document.getElementById('chat-messages');
  if (!el) {return;}
  el.querySelector('.chat-empty')?.remove();

  const div = document.createElement('div');
  div.innerHTML = renderChatGroup(group);
  const groupEl = div.firstElementChild;
  if (groupEl) {
    groupEl.classList.add('fade-in');
    el.appendChild(groupEl);
  }
  el.scrollTop = el.scrollHeight;
}

function _appendStreamingPlaceholder(id) {
  const el = document.getElementById('chat-messages');
  if (!el) {return;}

  const agentName = _chatGetAgentName(_chatAgentId);
  const initial = agentName.charAt(0).toUpperCase();

  const div = document.createElement('div');
  div.className = 'chat-group assistant fade-in';
  div.id = id;
  div.innerHTML = `
    <div class="chat-avatar assistant">${initial}</div>
    <div class="chat-group-messages">
      <div class="chat-bubble streaming">
        <span class="chat-reading-dots"><span></span><span></span><span></span></span>
      </div>
      <div class="chat-group-footer">
        <span class="chat-sender-name">${escHtml(agentName)}</span>
        <span class="chat-group-timestamp">now</span>
      </div>
    </div>
  `;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
}

function _updateStreamingBubble(id, text) {
  const group = document.getElementById(id);
  if (!group) {return;}
  const bubble = group.querySelector('.chat-bubble');
  if (!bubble) {return;}
  bubble.classList.remove('streaming');
  bubble.classList.add('has-copy');
  bubble.innerHTML = _renderCopyBtn(text) + formatChatContent(text || '...');
  // Auto-scroll if near bottom
  const thread = document.getElementById('chat-messages');
  if (thread) {
    const atBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 100;
    if (atBottom) {thread.scrollTo({ top: thread.scrollHeight, behavior: 'smooth' });}
  }
}

// ─── Context Badge ──────────────────────────────────────────

function _updateContextBadge(context) {
  const badge = document.getElementById('chat-context-badge');
  if (!badge) {return;}
  if (!context || !context.tokens) {
    badge.textContent = '';
    badge.className = 'chat-context-badge';
    return;
  }
  const total = context.tokens;
  const conv = context.conversationTokens || 0;
  const sys = context.systemOverhead || 0;
  const msgs = context.messageCount || 0;
  const k = (total / 1000).toFixed(1);
  badge.textContent = `~${k}k ctx`;
  badge.title = `Total: ~${total.toLocaleString()} tokens\nConversation: ~${conv.toLocaleString()} tokens (${msgs} msgs)\nSystem overhead: ~${sys.toLocaleString()} tokens (loaded every message)`;
  const level = total < 40000 ? 'low' : total < 80000 ? 'mid' : 'high';
  badge.className = `chat-context-badge ctx-${level}`;
}

// ─── Tool Use Indicators ────────────────────────────────────

const _TOOL_DISPLAY_NAMES = {
  Read: 'Reading file', Glob: 'Searching files', Grep: 'Searching code',
  Edit: 'Editing file', Write: 'Writing file', Bash: 'Running command',
  WebSearch: 'Searching web', WebFetch: 'Fetching page',
};

function _showToolIndicator(streamId, toolName) {
  const group = document.getElementById(streamId);
  if (!group) {return;}
  const msgs = group.querySelector('.chat-group-messages');
  if (!msgs) {return;}
  let indicator = group.querySelector('.chat-tool-indicator');
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.className = 'chat-tool-indicator';
    msgs.insertBefore(indicator, msgs.querySelector('.chat-group-footer'));
  }
  const label = _TOOL_DISPLAY_NAMES[toolName] || `Using ${toolName}`;
  indicator.innerHTML = `<span class="tool-indicator-dot"></span> ${escHtml(label)}...`;
  indicator.classList.remove('hidden');
  // Auto-scroll
  const thread = document.getElementById('chat-messages');
  if (thread) {
    const atBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 100;
    if (atBottom) {thread.scrollTo({ top: thread.scrollHeight, behavior: 'smooth' });}
  }
}

function _hideToolIndicator(streamId) {
  const group = document.getElementById(streamId);
  if (!group) {return;}
  const indicator = group.querySelector('.chat-tool-indicator');
  if (indicator) {indicator.classList.add('hidden');}
}

// ─── Scroll Management ──────────────────────────────────────

function _chatHandleScroll() {
  const el = document.getElementById('chat-messages');
  const btn = document.getElementById('chat-scroll-bottom');
  if (!el || !btn) {return;}
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
  btn.classList.toggle('hidden', atBottom);
}

function _chatScrollToBottom() {
  const el = document.getElementById('chat-messages');
  if (el) {el.scrollTop = el.scrollHeight;}
  const btn = document.getElementById('chat-scroll-bottom');
  if (btn) {btn.classList.add('hidden');}
}
