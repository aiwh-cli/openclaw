// ─── AIWH Mission Control v7 ── Frontend Orchestrator ─────────
// Vanilla JS, no build step. Delegates to /views/*.js modules.

const socket = io();
let currentView = 'chat';

// ─── Shared Helpers ──────────────────────────────────────────

// GET request cache — deduplicates identical calls during page load burst
const _apiCache = new Map();
const API_CACHE_TTL = 5000; // 5 seconds

async function api(path, opts) {
  const method = opts?.method?.toUpperCase() || 'GET';

  // Invalidate cache on any mutation
  if (method !== 'GET') {_apiCache.clear();}

  // Return cached response for GET requests within TTL
  if (method === 'GET') {
    const cached = _apiCache.get(path);
    if (cached && Date.now() - cached.ts < API_CACHE_TTL) {return cached.data;}
  }

  try {
    const res = await fetch('/api' + path, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
      body: opts?.body ? JSON.stringify(opts.body) : undefined,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      // Session expired or not logged in — redirect to login
      if (res.status === 401 && err?.redirect) {
        window.location.href = err.redirect;
        return null;
      }
      return err;
    }
    const data = await res.json();
    if (method === 'GET') {_apiCache.set(path, { data, ts: Date.now() });}
    return data;
  } catch (e) {
    console.error('API error:', path, e);
    return null;
  }
}

function escHtml(str) {
  if (!str) {return '';}
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Shared model → tier/label resolution (used by team, chat, overview)
function modelTierInfo(modelStr) {
  const ml = (modelStr || '').toLowerCase();
  // Anthropic
  if (ml.includes('opus'))   {return { tier: 'opus',   cls: 'tier-opus',   label: 'Opus' };}
  if (ml.includes('sonnet')) {return { tier: 'sonnet', cls: 'tier-sonnet', label: 'Sonnet' };}
  if (ml.includes('haiku'))  {return { tier: 'haiku',  cls: 'tier-haiku',  label: 'Haiku' };}
  // OpenAI
  if (ml.includes('codex') || ml.includes('gpt-5'))  {return { tier: 'powerful', cls: 'tier-opus', label: ml.includes('spark') ? 'Codex Spark' : 'Codex' };}
  if (ml.includes('gpt-4o-mini')) {return { tier: 'fast', cls: 'tier-haiku',  label: 'GPT-4o Mini' };}
  if (ml.includes('gpt-4o'))   {return { tier: 'balanced', cls: 'tier-sonnet', label: 'GPT-4o' };}
  // Google
  if (ml.includes('gemini') && ml.includes('flash')) {return { tier: 'fast', cls: 'tier-haiku', label: 'Gemini Flash' };}
  if (ml.includes('gemini') && ml.includes('pro'))   {return { tier: 'balanced', cls: 'tier-sonnet', label: 'Gemini Pro' };}
  if (ml.includes('gemini'))   {return { tier: 'balanced', cls: 'tier-sonnet', label: 'Gemini' };}
  // Meta
  if (ml.includes('llama'))    {return { tier: 'balanced', cls: 'tier-local', label: 'Llama' };}
  // DeepSeek
  if (ml.includes('deepseek')) {return { tier: 'balanced', cls: 'tier-sonnet', label: 'DeepSeek' };}
  // Minimax
  if (ml.includes('minimax')) {return { tier: 'balanced', cls: 'tier-sonnet', label: 'Minimax' };}
  // Qwen
  if (ml.includes('qwen'))     {return { tier: 'balanced', cls: 'tier-sonnet', label: 'Qwen' };}
  // Local/Ollama
  if (ml.includes('local') || ml.includes('ollama')) {return { tier: 'local', cls: 'tier-local', label: 'Local' };}
  // OpenRouter auto
  if (ml.includes('auto'))     {return { tier: 'balanced', cls: 'tier-sonnet', label: 'Auto' };}
  // Fallback: extract readable name from model ID
  const parts = ml.split('/');
  const last = parts[parts.length - 1] || '?';
  const shortLabel = last.replace(/^claude-/, '').split('-')[0] || '?';
  return { tier: 'other', cls: 'tier-haiku', label: shortLabel };
}

function timeAgo(dateStr) {
  if (!dateStr) {return 'never';}
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 0) {return 'just now';}
  if (diff < 60000)    {return 'just now';}
  if (diff < 3600000)  {return Math.floor(diff / 60000) + 'm ago';}
  if (diff < 86400000) {return Math.floor(diff / 3600000) + 'h ago';}
  return Math.floor(diff / 86400000) + 'd ago';
}

function shortTime(dateStr) {
  if (!dateStr) {return '';}
  return new Date(dateStr).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatBytes(b) {
  if (!b) {return '0 B';}
  if (b < 1024) {return b + ' B';}
  if (b < 1048576) {return (b / 1024).toFixed(1) + ' KB';}
  return (b / 1048576).toFixed(1) + ' MB';
}

// ─── Theme Toggle ────────────────────────────────────────────

function toggleTheme() {
  const html = document.documentElement;
  const current = html.getAttribute('data-theme');
  const next = current === 'light' ? 'dark' : 'light';
  html.setAttribute('data-theme', next);
  localStorage.setItem('mc-theme', next);

  // Update toggle icon
  const btn = document.getElementById('theme-toggle');
  if (btn) {
    btn.innerHTML = next === 'light'
      ? '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M13.5 8.5a5.5 5.5 0 01-6-6 5.5 5.5 0 106 6z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>'
      : '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="3.5" stroke="currentColor" stroke-width="1.4"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';
  }
}

// Restore saved theme on load
(function() {
  const saved = localStorage.getItem('mc-theme');
  if (saved) {document.documentElement.setAttribute('data-theme', saved);}
})();

// ─── Top Bar — Live Clock ────────────────────────────────────

function updateTopBarClock() {
  const el = document.getElementById('tb-time');
  if (!el) {return;}
  const now = new Date();
  el.textContent = now.toLocaleTimeString('en-AU', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  });
}

// ─── Top Bar — Stats ─────────────────────────────────────────

async function updateTopBarStats() {
  const dash = await api('/dashboard');
  if (!dash) {return;}

  const costEl = document.getElementById('tb-cost-val');
  if (costEl) {costEl.textContent = '$' + (dash.costs?.daily?.spend ?? 0).toFixed(2);}

  const taskEl = document.getElementById('tb-tasks-val');
  if (taskEl) {taskEl.textContent = String(dash.tasks?.in_progress ?? 0);}
}

// ─── Bottom Ticker ───────────────────────────────────────────

let tickerItems = [];

function initTicker() {
  const track = document.getElementById('ticker-track');
  if (!track) {return;}

  // Fetch initial activity
  api('/dashboard').then(dash => {
    if (!dash?.activity?.length) {return;}
    tickerItems = dash.activity.slice(0, 30);
    renderTicker();
  });
}

function renderTicker() {
  const track = document.getElementById('ticker-track');
  if (!track || !tickerItems.length) {return;}

  // Double the items for seamless loop
  const html = tickerItems.map(a =>
    `<span class="ticker-event">` +
    `<span class="ticker-event-time">${shortTime(a.created_at)}</span>` +
    `<span class="ticker-event-agent">${escHtml(a.agent_id || 'sys')}</span>` +
    `<span class="ticker-event-text">${escHtml(a.action)}</span>` +
    `</span>`
  ).join('');

  track.innerHTML = html + html; // duplicate for seamless scroll
}

function addTickerItem(item) {
  tickerItems.unshift(item);
  if (tickerItems.length > 30) {tickerItems.pop();}
  renderTicker();
}

// Pause ticker on hover
document.addEventListener('DOMContentLoaded', () => {
  const ticker = document.getElementById('bottom-ticker');
  if (ticker) {
    ticker.addEventListener('mouseenter', () => {
      const track = document.getElementById('ticker-track');
      if (track) {track.style.animationPlayState = 'paused';}
    });
    ticker.addEventListener('mouseleave', () => {
      const track = document.getElementById('ticker-track');
      if (track) {track.style.animationPlayState = 'running';}
    });
  }
});

// ─── Navigation ──────────────────────────────────────────────

const VIEW_INIT = {
  overview: initOverview,
  team:     () => { /* <team-org-chart> Lit component self-initializes via connectedCallback */ },
  tasks:    initTasks,
  schedule: initSchedule,
  social:   () => { /* social-hub manages its own loading */ },
  costs:    initCosts,
  chat:     () => { /* Lit sidebar + chat-host self-initialize via connectedCallback */ },
  wealth:   initWealth,
  logs:     () => { /* <aiwh-logs> Lit component self-initializes via connectedCallback */ },
  debug:    initDebug,
  trash:    initTrash,
  channels: () => { /* <channel-panel> Lit component self-initializes via connectedCallback */ },
  security: () => { const el = document.querySelector('security-panel'); if (el) {el.load();} },
  config:   initConfig,
  knowledge: loadKnowledge,
};

function switchView(view) {
  if (currentView === view) {return;}
  currentView = view;

  // Update sections
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));

  // Update hex nav active state
  if (typeof updateSidebarActive === 'function') {updateSidebarActive(view);}

  // Init view
  if (VIEW_INIT[view]) {VIEW_INIT[view]();}
}

// ─── Right Panel ─────────────────────────────────────────────

function openRightPanel(pane) {
  const overlay = document.getElementById('right-panel-overlay');
  const panel = document.getElementById('right-panel');
  if (overlay) {overlay.classList.remove('hidden');}
  if (panel) {panel.classList.add('open');}

  // Show correct pane
  document.querySelectorAll('.rp-pane').forEach(p => p.classList.add('hidden'));
  const target = document.getElementById('rp-' + pane);
  if (target) {target.classList.remove('hidden');}
}

function closeRightPanel() {
  const overlay = document.getElementById('right-panel-overlay');
  const panel = document.getElementById('right-panel');
  if (overlay) {overlay.classList.add('hidden');}
  if (panel) {panel.classList.remove('open');}
}

// Aliases used in keyboard handler and view files
function closeChat() { closeRightPanel(); }
function closeNotifications() { closeRightPanel(); }
function closeAgentDetail() {
  document.getElementById('team-detail-overlay')?.classList.add('hidden');
  document.getElementById('team-detail-panel')?.classList.add('hidden');
}

function toggleNotifications() {
  const panel = document.getElementById('right-panel');
  if (panel?.classList.contains('open')) {
    const notifPane = document.getElementById('rp-notifications');
    if (notifPane && !notifPane.classList.contains('hidden')) {
      closeRightPanel();
      return;
    }
  }
  openRightPanel('notifications');
  const notifEl = document.querySelector('notif-dropdown');
  if (notifEl) {notifEl.load();}
}

function updateNotifBadge(count) {
  const badge = document.getElementById('notif-badge');
  if (!badge) {return;}
  badge.textContent = count > 9 ? '9+' : count;
  badge.classList.toggle('hidden', count === 0);
}

// ─── Toast Notifications ─────────────────────────────────────

function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) {return;}
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ─── Modal ───────────────────────────────────────────────────

function showModal(html, extraClass) {
  const overlay = document.getElementById('modal-overlay');
  const content = document.getElementById('modal-content');
  if (!overlay || !content) {return;}
  content.className = 'modal-inner' + (extraClass ? ' ' + extraClass : '');
  content.innerHTML = html;
  // Apply size classes to the outer modal container
  const outer = content.parentElement;
  if (outer) {
    outer.className = 'modal glass' + (extraClass ? ' ' + extraClass : '');
  }
  overlay.classList.remove('hidden');
  setTimeout(() => content.querySelector('input, textarea, select')?.focus(), 50);
}

function closeModal() {
  const overlay = document.getElementById('modal-overlay');
  overlay?.classList.add('hidden');
  const m = overlay?.querySelector('.modal');
  if (m) { m.classList.remove('modal-wide', 'modal-fullscreen'); }
}

// Close modal on overlay click
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('modal-overlay')?.addEventListener('click', function(e) {
    if (e.target === this) {closeModal();}
  });
});

// ─── Custom Dialogs (replaces native prompt/confirm) ─────────
// These save/restore previous modal content so they can overlay on existing modals

function dashPrompt(message, placeholder = '') {
  return new Promise(resolve => {
    const overlay = document.getElementById('modal-overlay');
    const wasOpen = overlay && !overlay.classList.contains('hidden');
    const content = document.getElementById('modal-content');
    window._dashDialogPrev = wasOpen && content ? content.innerHTML : null;
    window._dashDialogPrevClass = wasOpen && content?.parentElement ? content.parentElement.className : '';
    window._dashDialogWasOpen = wasOpen;
    showModal(`
      <div class="dash-dialog">
        <p class="dash-dialog-msg">${message}</p>
        <textarea id="dash-dialog-input" class="dash-dialog-textarea" placeholder="${placeholder}" rows="3"></textarea>
        <div class="dash-dialog-btns">
          <button class="btn btn-ghost" onclick="closeDashDialog(null)">Cancel</button>
          <button class="btn btn-primary" onclick="closeDashDialog(document.getElementById('dash-dialog-input').value)">Submit</button>
        </div>
      </div>
    `);
    window._dashDialogResolve = resolve;
    document.getElementById('dash-dialog-input')?.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        closeDashDialog(document.getElementById('dash-dialog-input').value);
      }
    });
  });
}

function dashConfirm(message) {
  return new Promise(resolve => {
    const overlay = document.getElementById('modal-overlay');
    const wasOpen = overlay && !overlay.classList.contains('hidden');
    const content = document.getElementById('modal-content');
    window._dashDialogPrev = wasOpen && content ? content.innerHTML : null;
    window._dashDialogPrevClass = wasOpen && content?.parentElement ? content.parentElement.className : '';
    window._dashDialogWasOpen = wasOpen;
    showModal(`
      <div class="dash-dialog">
        <p class="dash-dialog-msg">${message}</p>
        <div class="dash-dialog-btns">
          <button class="btn btn-ghost" onclick="closeDashDialog(false)">Cancel</button>
          <button class="btn btn-primary" onclick="closeDashDialog(true)">Continue</button>
        </div>
      </div>
    `);
    window._dashDialogResolve = resolve;
  });
}

function closeDashDialog(value) {
  // If the dialog was opened from within an existing modal, restore that modal
  if (window._dashDialogWasOpen && window._dashDialogPrev !== null) {
    const content = document.getElementById('modal-content');
    if (content) {
      content.innerHTML = window._dashDialogPrev;
      content.className = 'modal-inner';
      if (content.parentElement && window._dashDialogPrevClass) {
        content.parentElement.className = window._dashDialogPrevClass;
      }
    }
    window._dashDialogPrev = null;
    window._dashDialogPrevClass = '';
  } else {
    // Dialog was opened from the main page — just close the modal
    closeModal();
  }
  window._dashDialogWasOpen = false;
  if (window._dashDialogResolve) {
    window._dashDialogResolve(value);
    window._dashDialogResolve = null;
  }
}

// ─── Socket.io Events ────────────────────────────────────────

socket.on('refresh', () => {
  // Skip auto-refresh for views that manage their own state (channels, chat, production)
  const skipAutoRefresh = ['channels', 'chat', 'config', 'knowledge', 'social-strategy', 'social'];
  if (!skipAutoRefresh.includes(currentView) && VIEW_INIT[currentView]) {VIEW_INIT[currentView]();}
  updateTopBarStats();
});

socket.on('task_updated', () => {
  if (currentView === 'tasks') {loadTasks();}
  if (currentView === 'overview') {refreshOverview();}
  updateTopBarStats();
});

socket.on('cinematic_updated', () => {
  if (currentView === 'production') {loadProduction();}
  if (currentView === 'social') { const el = document.querySelector('social-hub'); if (el) {el.refresh();} }
});

socket.on('agent_status', (data) => {
  document.querySelectorAll(`.status-dot[data-agent="${data.id}"]`).forEach(el => {
    el.className = `status-dot status-${data.status}`;
  });
});

socket.on('activity', (data) => {
  // Add to bottom ticker
  addTickerItem(data);

  if (currentView === 'overview') {
    const feed = document.getElementById('ov-activity');
    if (feed) {
      const div = document.createElement('div');
      div.className = 'feed-item fade-in';
      div.innerHTML = `
        <span class="feed-time">${shortTime(data.created_at)}</span>
        <span class="feed-agent">${escHtml(data.agentId || 'sys')}</span>
        <span class="feed-text">${escHtml(data.action)}: ${escHtml(data.detail || '')}</span>
      `;
      feed.prepend(div);
      while (feed.children.length > 15) {feed.removeChild(feed.lastChild);}
    }
  }
});

socket.on('log_line', ({ logId, line }) => {
  if (currentView === 'logs') {appendLogLine(line);}
});

// ─── Keyboard Shortcuts ──────────────────────────────────────

document.addEventListener('keydown', e => {
  // Skip shortcuts when typing in inputs (including inside Lit Shadow DOM)
  const actual = e.composedPath()[0];
  if (actual?.tagName === 'INPUT' || actual?.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {return;}

  if (e.key === 'Escape') {
    closeModal();
    closeRightPanel();
    closeAgentDetail();
    return;
  }

  if (e.key === '1') {switchView('overview');}
  if (e.key === '2') {switchView('team');}
  if (e.key === '3') {switchView('tasks');}
  if (e.key === '4') {switchView('schedule');}
  if (e.key === '5') {switchView('costs');}
});

// ─── Init ────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Sidebar — data-driven hex rail
  if (typeof initSidebar === 'function') {initSidebar();}

  // Log streaming — handled by <aiwh-logs> Lit component (creates own socket)
  // if (typeof setupLogSocket === 'function') {setupLogSocket(socket);}

  // Top bar clock — update every second
  updateTopBarClock();
  setInterval(updateTopBarClock, 1000);

  // Top bar stats
  updateTopBarStats();
  setInterval(updateTopBarStats, 60000);

  // Bottom ticker
  initTicker();

  // Apply saved theme icon
  if (document.documentElement.getAttribute('data-theme') === 'light') {
    const btn = document.getElementById('theme-toggle');
    if (btn) {btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M13.5 8.5a5.5 5.5 0 01-6-6 5.5 5.5 0 106 6z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';}
  }

  // Load initial view — initChat directly since currentView already === 'chat'
  if (typeof initChat === 'function') {initChat();}

  // Periodic notifications refresh
  setInterval(async () => {
    const n = await api('/notifications/unread-count');
    if (typeof updateNotifBadge === 'function') {updateNotifBadge(n?.count || 0);}
  }, 30000);
});
