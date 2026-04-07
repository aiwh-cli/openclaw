// ─── Chat View: Commands Panel ──────────────────────────────────────
// Extracted from chat-core.js. Slash command reference panel.
// Globals used: escHtml, sendChatMessage, _chatAutoResize (from chat-core.js)
// Globals provided: toggleChatCommandsPanel, toggleChatCommands, _filterCommands

const _chatCommands = [
  // Session Management
  { cat: 'Session', cmd: '/new', desc: 'Start a fresh session. Archives current conversation and resets context.', level: 'caution' },
  { cat: 'Session', cmd: '/compact', desc: 'Compress conversation context via summarization. Keeps same session, reduces token usage.' },
  { cat: 'Session', cmd: '/clear', desc: 'Clear conversation history for this session.', level: 'danger' },
  { cat: 'Session', cmd: '/reset', desc: 'Reset session (same as /new). Archives transcript and starts fresh.', level: 'caution' },
  { cat: 'Session', cmd: '/resume <id>', desc: 'Restore a previous archived session by its ID.' },

  // Model Control
  { cat: 'Model', cmd: '/model opus', desc: 'Switch to Claude Opus 4.6 — most capable, highest cost.' },
  { cat: 'Model', cmd: '/model sonnet', desc: 'Switch to Claude Sonnet 4.5 — balanced capability and speed.' },
  { cat: 'Model', cmd: '/model haiku', desc: 'Switch to Claude Haiku 4.5 — fastest, lowest cost.' },
  { cat: 'Model', cmd: '/model gemini-flash', desc: 'Gemini 2.5 Flash via OpenRouter — fast and cheap.' },
  { cat: 'Model', cmd: '/model auto', desc: 'Let OpenRouter pick the best model for your message.' },
  { cat: 'Model', cmd: '/model <id>', desc: 'Any model by full ID (e.g. openrouter/anthropic/claude-opus-4-6).' },

  // Reasoning
  { cat: 'Reasoning', cmd: '/reasoning on', desc: 'Enable extended thinking mode. Uses more tokens but improves complex reasoning.' },
  { cat: 'Reasoning', cmd: '/reasoning off', desc: 'Disable extended thinking (default mode).' },
  { cat: 'Reasoning', cmd: '/reasoning stream', desc: 'Show the thinking process in output while reasoning.' },

  // Information
  { cat: 'Info', cmd: '/status', desc: 'Show agent status, session info, and current context size.' },
  { cat: 'Info', cmd: '/cost', desc: 'Display current session token usage and estimated cost.' },
  { cat: 'Info', cmd: '/memory', desc: 'Access memory search — find stored knowledge and past context.' },
  { cat: 'Info', cmd: '/help', desc: 'List all available commands and system capabilities.' },

  // Agent Control
  { cat: 'Agent', cmd: '/spawn <agent>', desc: 'Spawn a sub-agent for a specific task. Agent runs in its own session.' },
  { cat: 'Agent', cmd: '/abort', desc: 'Stop the current message generation mid-stream.' },
];

function _buildCommandsPanel() {
  const list = document.getElementById('chat-commands-list');
  if (!list) {return;}

  let html = '';
  let lastCat = '';
  for (const c of _chatCommands) {
    if (c.cat !== lastCat) {
      html += `<div class="chat-cmd-category">${escHtml(c.cat)}</div>`;
      lastCat = c.cat;
    }
    const levelClass = c.level || '';
    const badge = c.level === 'danger'
      ? '<span class="chat-cmd-item-badge chat-cmd-badge-danger">Destructive</span>'
      : c.level === 'caution'
      ? '<span class="chat-cmd-item-badge chat-cmd-badge-caution">Caution</span>'
      : '';
    const cmdText = c.cmd.split(' ')[0];
    html += `<div class="chat-cmd-item ${levelClass}" onclick="_insertCommand('${escHtml(cmdText)}')" data-cmd="${escHtml(c.cmd.toLowerCase())}" data-desc="${escHtml(c.desc.toLowerCase())}">
      <div class="chat-cmd-item-top">
        <span class="chat-cmd-item-name">${escHtml(c.cmd)}</span>
        ${badge}
      </div>
      <div class="chat-cmd-item-desc">${escHtml(c.desc)}</div>
    </div>`;
  }
  list.innerHTML = html;
}

function _insertCommand(cmd) {
  const input = document.getElementById('chat-input');
  if (!input) {return;}

  const autoSendCmds = ['/new', '/compact', '/clear', '/reset', '/status', '/cost', '/memory', '/help', '/abort'];
  if (autoSendCmds.includes(cmd)) {
    input.value = cmd;
    toggleChatCommandsPanel();
    sendChatMessage();
    return;
  }

  input.value = cmd + ' ';
  input.focus();
  _chatAutoResize(input);
  toggleChatCommandsPanel();
}

function _filterCommands(query) {
  const q = (query || '').toLowerCase().trim();
  const items = document.querySelectorAll('#chat-commands-list .chat-cmd-item');
  const cats = document.querySelectorAll('#chat-commands-list .chat-cmd-category');

  const visibleCats = new Set();

  items.forEach(el => {
    const cmd = el.dataset.cmd || '';
    const desc = el.dataset.desc || '';
    const match = !q || cmd.includes(q) || desc.includes(q);
    el.style.display = match ? '' : 'none';
    if (match) {
      let prev = el.previousElementSibling;
      while (prev && !prev.classList.contains('chat-cmd-category')) {prev = prev.previousElementSibling;}
      if (prev) {visibleCats.add(prev);}
    }
  });

  cats.forEach(el => {
    el.style.display = visibleCats.has(el) ? '' : 'none';
  });
}

function toggleChatCommandsPanel() {
  const panel = document.getElementById('chat-commands-panel');
  const toggle = document.querySelector('.chat-commands-toggle');
  if (!panel) {return;}

  const isHidden = panel.classList.contains('hidden');
  panel.classList.toggle('hidden');
  if (toggle) {toggle.classList.toggle('active', isHidden);}

  if (isHidden && !panel.dataset.built) {
    _buildCommandsPanel();
    panel.dataset.built = '1';
  }

  if (isHidden) {
    const search = document.getElementById('chat-commands-search');
    if (search) { search.value = ''; _filterCommands(''); setTimeout(() => search.focus(), 100); }
  }
}

// Legacy compat
function toggleChatCommands() { toggleChatCommandsPanel(); }
