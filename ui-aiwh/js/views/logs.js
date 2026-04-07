// ─── Logs View ────────────────────────────────────────────────
// Live log tail with ANSI stripping, auto-scroll, log selector.

let _activeLogId = null;
let _logAutoScroll = true;
let _logLines = [];
const MAX_LOG_LINES = 500;

async function initLogs() {
  await loadLogList();
}

async function loadLogList() {
  const logs = await api('/logs/list');
  renderLogSelector(logs || []);
}

function renderLogSelector(logs) {
  const el = document.getElementById('log-selector');
  if (!el) {return;}

  el.innerHTML = logs.map(l => `
    <button class="log-tab ${!l.exists ? 'disabled' : ''} ${_activeLogId === l.id ? 'active' : ''}"
            onclick="selectLog('${l.id}')"
            ${!l.exists ? 'disabled title="Log file not found"' : ''}>
      <span class="log-tab-name">${escHtml(l.label)}</span>
      ${l.size ? `<span class="log-tab-size">${formatBytes(l.size)}</span>` : ''}
    </button>
  `).join('');

  // Auto-select first available log
  if (!_activeLogId) {
    const first = logs.find(l => l.exists);
    if (first) {selectLog(first.id);}
  }
}

async function selectLog(logId) {
  _activeLogId = logId;
  _logLines = [];
  _logAutoScroll = true;

  // Update active tab
  document.querySelectorAll('.log-tab').forEach(t => {
    t.classList.toggle('active', t.textContent.trim().startsWith(logId));
  });

  // Re-render selector to update active
  await loadLogList();

  const el = document.getElementById('log-output');
  if (el) {el.innerHTML = '<div class="log-loading">Loading...</div>';}

  const data = await api(`/logs/${logId}?lines=300`);
  if (!data || data.error) {
    if (el) {el.innerHTML = `<div class="log-error">${escHtml(data?.error || 'Failed to load log')}</div>`;}
    return;
  }

  _logLines = data.lines || [];
  renderLogOutput();
}

function renderLogOutput() {
  const el = document.getElementById('log-output');
  if (!el) {return;}

  const html = _logLines.map(line => _formatLogLine(stripAnsi(line))).join('');
  el.innerHTML = html || '<div class="log-empty">Log is empty</div>';

  if (_logAutoScroll) {el.scrollTop = el.scrollHeight;}
}

function _formatLogLine(raw) {
  // Try to parse JSON log lines into human-readable format
  try {
    const trimmed = raw.trim();
    if (trimmed.startsWith('{')) {
      const obj = JSON.parse(trimmed);
      const ts = obj.timestamp || obj.time || obj.ts || '';
      const level = (obj.level || obj.severity || 'info').toLowerCase();
      const msg = obj.message || obj.msg || obj.event || '';
      const extra = [];
      if (obj.agentId || obj.agent_id) {extra.push(obj.agentId || obj.agent_id);}
      if (obj.sessionId || obj.session_id) {extra.push(obj.sessionId || obj.session_id);}
      if (obj.error) {extra.push(obj.error);}
      const lvlClass = level === 'error' ? 'log-error' : level === 'warn' || level === 'warning' ? 'log-warn' : '';
      const shortTs = ts ? ts.replace(/T/, ' ').replace(/\.\d+Z?$/, '') : '';
      const extraStr = extra.length ? ` <span class="log-extra">${escHtml(extra.join(' · '))}</span>` : '';
      return `<div class="log-line ${lvlClass}"><span class="log-ts">${escHtml(shortTs)}</span> <span class="log-level">[${escHtml(level)}]</span> ${escHtml(msg)}${extraStr}</div>`;
    }
  } catch {}
  // Fallback: render as plain text with level detection
  const lower = raw.toLowerCase();
  const cls = lower.includes('error') ? 'log-error' : lower.includes('warn') ? 'log-warn' : '';
  return `<div class="log-line ${cls}">${escHtml(raw)}</div>`;
}

function appendLogLine(line) {
  _logLines.push(line);
  if (_logLines.length > MAX_LOG_LINES) {_logLines.shift();}

  const el = document.getElementById('log-output');
  if (!el) {return;}

  // Check if user is near bottom before appending (within 50px)
  const wasAtBottom = (el.scrollHeight - el.scrollTop - el.clientHeight) < 50;

  const wrapper = document.createElement('div');
  wrapper.innerHTML = _formatLogLine(stripAnsi(line));
  const div = wrapper.firstElementChild;
  el.appendChild(div);

  // Trim old lines from DOM
  while (el.children.length > MAX_LOG_LINES) {el.removeChild(el.firstChild);}

  // Only auto-scroll if user was already at bottom AND auto-scroll is enabled
  if (_logAutoScroll && wasAtBottom) {el.scrollTop = el.scrollHeight;}
}

// Listen for live log lines from server
function setupLogSocket(socket) {
  socket.on('log_line', ({ logId, line }) => {
    if (logId === _activeLogId) {appendLogLine(line);}
  });
}

// Strip ANSI escape codes
function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
}

function toggleLogAutoScroll() {
  _logAutoScroll = !_logAutoScroll;
  const btn = document.getElementById('log-autoscroll-btn');
  if (btn) {btn.textContent = _logAutoScroll ? 'Auto-scroll: ON' : 'Auto-scroll: OFF';}
}

/** Clears the log display only (visual). Does NOT delete log files on disk. */
function clearLogDisplay() {
  _logLines = [];
  const el = document.getElementById('log-output');
  if (el) {el.innerHTML = '';}
  showToast('Log display cleared (files on disk are unchanged)', 'info');
}
