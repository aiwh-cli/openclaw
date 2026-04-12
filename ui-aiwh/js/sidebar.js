// ─── Sidebar Navigation — Data-Driven Hex Rail ─────────────
// Renders nav items from config, supports collapse, CC gating.
// Designed for easy future port to Lit component (39.2+).

// Icon definitions (reusable SVGs)
const _i = {
  chat: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 3a1 1 0 011-1h10a1 1 0 011 1v7a1 1 0 01-1 1H7.5L3 14v-3H3a1 1 0 01-1-1V3z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M5 6.5h6M5 9h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity=".7"/></svg>`,
  overview: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="6" height="6" rx="1" fill="currentColor" opacity=".7"/><rect x="9" y="1" width="6" height="6" rx="1" fill="currentColor" opacity=".7"/><rect x="1" y="9" width="6" height="6" rx="1" fill="currentColor" opacity=".7"/><rect x="9" y="9" width="6" height="6" rx="1" fill="currentColor" opacity=".7"/></svg>`,
  team: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="6" cy="5" r="2.5" fill="currentColor" opacity=".7"/><path d="M1 13c0-2.76 2.24-5 5-5s5 2.24 5 5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/><circle cx="12" cy="5.5" r="1.75" fill="currentColor" opacity=".4"/><path d="M10.5 12.8c.16-.9.88-1.8 1.75-1.8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" fill="none"/></svg>`,
  tasks: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1.5" y="1.5" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.5"/><path d="M3 4l1.5 1.5L8 2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 4.5h4.5M10 8h4.5M10 11.5h4.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" opacity=".7"/><rect x="1.5" y="9.5" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.5" opacity=".4"/></svg>`,
  schedule: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.5"/><path d="M8 4.5V8l2.5 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="8" cy="8" r="1" fill="currentColor"/></svg>`,
  workflows: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 4h3v3H2V4z" stroke="currentColor" stroke-width="1.3"/><path d="M6.5 5.5h3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M11 4h3v3h-3V4z" stroke="currentColor" stroke-width="1.3"/><path d="M6.5 10.5h3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M2 9h3v3H2V9z" stroke="currentColor" stroke-width="1.3"/><path d="M11 9h3v3h-3V9z" stroke="currentColor" stroke-width="1.3"/><path d="M3.5 7v2M12.5 7v2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" opacity=".5"/></svg>`,
  knowledge: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 2.5h4.5a1.5 1.5 0 011.5 1.5v10a1 1 0 00-1-1H2V2.5z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M14 2.5H9.5A1.5 1.5 0 008 4v10a1 1 0 011-1h5V2.5z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>`,
  social: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1C4.13 1 1 4.13 1 8s3.13 7 7 7 7-3.13 7-7-3.13-7-7-7z" stroke="currentColor" stroke-width="1.4"/><path d="M5.5 6.5a1 1 0 110-2 1 1 0 010 2zM10.5 6a1 1 0 110-2 1 1 0 010 2z" fill="currentColor" opacity=".7"/><path d="M5 10c.6 1.2 1.6 2 3 2s2.4-.8 3-2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`,
  costs: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 13V7l2.5-3 3 3.5 3-6 3.5 4.5V13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M1 13h14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  channels: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="5" cy="4" r="1.5" fill="currentColor"/><circle cx="11" cy="8" r="1.5" fill="currentColor"/><circle cx="7" cy="12" r="1.5" fill="currentColor"/></svg>`,
  wealth: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1l2.5 3.5H14l-2 3.5 2 3.5h-3.5L8 15l-2.5-3.5H2l2-3.5-2-3.5h3.5L8 1z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" fill="currentColor" fill-opacity=".15"/></svg>`,
  logs: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 5h12M2 8h12M2 11h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  activity: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.4"/><path d="M8 4.5V8l2.5 2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  debug: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M6 2a2 2 0 00-2 2v4a4 4 0 008 0V4a2 2 0 00-2-2H6z" stroke="currentColor" stroke-width="1.4"/><path d="M4 6H2m10 0h2M4 9H2m10 0h2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`,
  trash: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M5.5 4V3a1 1 0 011-1h3a1 1 0 011 1v1M6 7v5M10 7v5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M3.5 4l.7 9a1.5 1.5 0 001.5 1.4h4.6a1.5 1.5 0 001.5-1.4l.7-9" stroke="currentColor" stroke-width="1.3"/></svg>`,
  security: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 1L2.5 3.5v4c0 3.5 2.3 6.2 5.5 7.5 3.2-1.3 5.5-4 5.5-7.5v-4L8 1z" stroke="currentColor" stroke-width="1.3" fill="currentColor" opacity=".15"/><path d="M6 8l1.5 1.5L10.5 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  access: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="6" cy="4.5" r="2" stroke="currentColor" stroke-width="1.3"/><path d="M2 13c0-2.2 1.8-4 4-4s4 1.8 4 4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M12.5 7v4m-2-2h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`,
  config: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="2" fill="currentColor" opacity=".6"/><path d="M8 1.5v2m0 9v2M1.5 8h2m9 0h2M3.6 3.6l1.4 1.4m6 6l1.4 1.4M3.6 12.4l1.4-1.4M11 5l1.4-1.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`,
  connectors: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 4a2 2 0 110-4 2 2 0 010 4zm8 4a2 2 0 110-4 2 2 0 010 4zm-8 8a2 2 0 110-4 2 2 0 010 4z" fill="currentColor" opacity=".5"/><path d="M6 3h4M6 13h4m2-3V6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`,
};

// cc: which command centre gates this item (null = always visible)
// perm: which permission key gates this item (from /api/auth/status permissions)
const SIDEBAR_NAV = [
  { view: 'chat', label: 'Chat', cc: null, accent: true, icon: _i.chat },

  { divider: true, category: 'Command', cc: null },
  { view: 'overview', label: 'Overview', cc: null, icon: _i.overview },
  { view: 'team', label: 'Team', cc: null, icon: _i.team },
  { view: 'tasks', label: 'Tasks', cc: null, icon: _i.tasks },
  { view: 'schedule', label: 'Schedule', cc: null, icon: _i.schedule },
  { view: 'workflows', label: 'Workflows', cc: null, perm: 'canViewWorkflows', icon: _i.workflows },
  { view: 'knowledge', label: 'Knowledge', cc: null, perm: 'canViewKnowledge', icon: _i.knowledge },

  { divider: true, category: 'Business', cc: 'business' },
  { view: 'social', label: 'Social', cc: 'business', icon: _i.social },
  { view: 'costs', label: 'Costs', cc: 'business', perm: 'canViewCosts', icon: _i.costs },
  { view: 'channels', label: 'Channels', cc: 'business', perm: 'canViewConnectors', small: true, icon: _i.channels },

  { divider: true, category: 'Wealth', cc: 'wealth' },
  { view: 'wealth', label: 'Wealth', cc: 'wealth', gold: true, icon: _i.wealth },

  { spacer: true },

  { divider: true, category: 'System', cc: null, perm: 'canViewSystem' },
  { view: 'connectors', label: 'Connectors', cc: null, perm: 'canViewConnectors', small: true, icon: _i.connectors },
  { view: 'logs', label: 'Logs', cc: null, perm: 'canViewSystem', small: true, icon: _i.logs },
  { view: 'activity', label: 'Activity', cc: null, small: true, icon: _i.activity },
  { view: 'debug', label: 'Debug', cc: null, perm: 'canViewSystem', small: true, icon: _i.debug },
  { view: 'trash', label: 'Trash', cc: null, perm: 'canViewSystem', small: true, icon: _i.trash },
  { view: 'security', label: 'Security', cc: null, perm: 'canViewSecurity', small: true, icon: _i.security },
  { view: 'team-access', label: 'Access', cc: null, perm: 'canManageUsers', small: true, icon: _i.access },
  { view: 'config', label: 'Config', cc: null, perm: 'canViewSystem', small: true, icon: _i.config },
];

// Collapse icon SVGs
const ICON_COLLAPSE = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M11 4L5 8l6 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_EXPAND = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M5 4l6 4-6 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

let _sidebarCollapsed = false;
let _activeCCs = ['business', 'wealth', 'life']; // default all active
let _permissions = null; // null = no restrictions (owner/legacy)
let _views = null; // null = all views (owner). Object = per-view booleans from policy
let _userRole = 'owner'; // default until auth status fetched
let _pinRequired = false; // true if PIN is set but session not verified
let _pinExists = false; // true if user has a PIN set at all
let _userCCs = []; // CCs assigned to this user (from auth status)
const PIN_GATED_CCS = ['wealth', 'life'];

// ─── Init ─────────────────────────────────────────────────────

function initSidebar() {
  try { _sidebarCollapsed = localStorage.getItem('mc-sidebar-collapsed') === 'true'; } catch (e) { /* private browsing */ }
  renderSidebar();
  Promise.all([_fetchCommandCentres(), _fetchPermissions(), _fetchPinStatus()])
    .then(() => renderSidebar()).catch(() => {});
  window.addEventListener('pin-changed', (e) => {
    _pinExists = !!e.detail?.hasPin;
    _pinRequired = _pinExists; // just set — not yet verified this session
  });
}

async function _fetchPinStatus() {
  try {
    const data = await api('/auth/pin/status');
    _pinExists = !!data.hasPin;
    _pinRequired = data.hasPin && !data.verified;
  } catch { /* not logged in or no PIN */ }
}

async function _fetchPermissions() {
  try {
    const status = await api('/auth/status');
    if (status?.permissions) { _permissions = status.permissions; }
    if (status?.user?.role) { _userRole = status.user.role; }
    if (status?.user?.commandCentres) { _userCCs = status.user.commandCentres; }
    if (status?.views !== undefined) { _views = status.views; } // null for owner, object for admin/team
  } catch (e) { console.warn('Sidebar: permissions fetch failed', e); }
}

async function _fetchCommandCentres() {
  try {
    const lic = await api('/license');
    if (lic && lic.command_centres_active) { _activeCCs = lic.command_centres_active; }
    // Legacy fallback: if only modules_active exists, map to CCs
    else if (lic && lic.modules_active) {
      _activeCCs = [];
      if (lic.modules_active.includes('frontend') || lic.modules_active.includes('backend')) _activeCCs.push('business');
      if (lic.modules_active.includes('lifestyle')) { _activeCCs.push('wealth', 'life'); }
    }
  } catch (e) { console.warn('Sidebar: CC fetch failed', e); }
}

// ─── Render ───────────────────────────────────────────────────

function renderSidebar() {
  const rail = document.getElementById('hex-rail');
  if (!rail) {return;}

  // Apply collapsed state
  rail.classList.toggle('collapsed', _sidebarCollapsed);
  document.documentElement.style.setProperty(
    '--hex-rail-w', _sidebarCollapsed ? '72px' : '200px'
  );

  const inner = rail.querySelector('.hex-rail-inner');
  if (!inner) {return;}
  inner.innerHTML = '';

  for (const item of SIDEBAR_NAV) {
    // CC gating — hide entire section if command centre inactive
    if (item.cc && !_activeCCs.includes(item.cc)) {
      continue;
    }
    // RBAC gating — user's assigned CCs override policy for CC-gated views
    const ccOverride = item.cc && _userCCs.includes(item.cc);
    if (!ccOverride && _views && item.view && _views[item.view] === false) { continue; }
    if (!ccOverride && !_views && item.perm && _permissions && !_permissions[item.perm]) { continue; }

    if (item.spacer) {
      const sp = document.createElement('div');
      sp.className = 'hex-spacer';
      inner.appendChild(sp);
      continue;
    }

    if (item.divider) {
      const div = document.createElement('div');
      div.className = 'hex-divider';
      inner.appendChild(div);

      const cat = document.createElement('span');
      cat.className = 'hex-category';
      if (item.category === 'Wealth') {cat.classList.add('hex-category-lifestyle');}
      cat.textContent = item.category;
      inner.appendChild(cat);
      continue;
    }

    // Nav button
    const btn = document.createElement('button');
    const classes = ['hex-btn'];
    if (item.accent) {classes.push('hex-chat-btn');}
    if (item.small) {classes.push('hex-btn-sm');}
    if (item.view === currentView) {classes.push('active');}
    btn.className = classes.join(' ');
    btn.dataset.view = item.view;
    btn.setAttribute('aria-label', item.label);
    btn.onclick = () => {
      if (item.cc && PIN_GATED_CCS.includes(item.cc)) {
        if (!_pinExists) { _showPinSetupPrompt(); return; }
        if (_pinRequired) { _showPinModal(item.view); return; }
      }
      switchView(item.view);
    };

    // Hex background polygon
    const fillClasses = ['hex-fill'];
    if (item.accent) {fillClasses.push('hex-fill-accent');}
    if (item.gold) {fillClasses.push('hex-fill-gold');}

    btn.innerHTML =
      `<svg class="hex-bg" viewBox="0 0 44 50" fill="none">` +
        `<polygon points="22,2 42,13 42,37 22,48 2,37 2,13" class="${fillClasses.join(' ')}" stroke-width="1"/>` +
      `</svg>` +
      `<span class="hex-icon">${item.icon}</span>` +
      `<span class="hex-label">${item.label}</span>` +
      (item.badgeId ? `<span id="${item.badgeId}" class="hex-badge hidden">0</span>` : '');

    inner.appendChild(btn);
  }

  // Collapse toggle button at very bottom
  const toggle = document.createElement('button');
  toggle.className = 'hex-collapse-toggle';
  toggle.setAttribute('aria-label', _sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar');
  toggle.title = _sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar';
  toggle.innerHTML = _sidebarCollapsed ? ICON_EXPAND : ICON_COLLAPSE;
  toggle.onclick = toggleSidebarCollapse;
  inner.appendChild(toggle);
}

// ─── Collapse Toggle ─────────────────────────────────────────

function toggleSidebarCollapse() {
  _sidebarCollapsed = !_sidebarCollapsed;
  try { localStorage.setItem('mc-sidebar-collapsed', _sidebarCollapsed); } catch (e) { /* private browsing */ }
  renderSidebar();
}

// ─── Update active state (called from switchView in app.js) ──

function updateSidebarActive(view) {
  document.querySelectorAll('#hex-rail .hex-btn[data-view]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });
}

// ─── PIN Gate Modal ──────────────────────────────────────────

function _showPinSetupPrompt() {
  let overlay = document.getElementById('pin-gate-overlay');
  if (overlay) overlay.remove();
  overlay = document.createElement('div');
  overlay.id = 'pin-gate-overlay';
  Object.assign(overlay.style, {
    position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.7)', zIndex: '9999',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  });
  const box = document.createElement('div');
  Object.assign(box.style, {
    background: 'var(--surface, #14141A)', border: '1px solid var(--border-dim)', borderRadius: '8px',
    padding: '24px', width: '300px', textAlign: 'center', color: 'var(--text-primary, #F5EDD6)',
  });
  box.innerHTML = `
    <div style="font-size:14px;font-weight:600;color:var(--magenta,#C9A84C);margin-bottom:12px">PIN Setup Required</div>
    <p style="font-size:13px;color:var(--text-muted);margin-bottom:16px;line-height:1.5">
      Set up a PIN to protect your Wealth & Life sections. Go to <strong>Access</strong> to create one.</p>
    <div style="display:flex;gap:8px;justify-content:center">
      <button onclick="document.getElementById('pin-gate-overlay').remove();switchView('team-access')"
        style="padding:8px 20px;background:var(--magenta,#C9A84C);color:var(--void,#0A0A0C);border:none;
        border-radius:4px;font-weight:600;cursor:pointer;font-size:13px">Go to Access</button>
      <button onclick="document.getElementById('pin-gate-overlay').remove()"
        style="padding:8px 16px;background:none;border:1px solid var(--border-dim);
        border-radius:4px;color:var(--text-muted);cursor:pointer;font-size:13px">Cancel</button>
    </div>`;
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
}

function _showPinModal(targetView) {
  let overlay = document.getElementById('pin-gate-overlay');
  if (overlay) overlay.remove();
  overlay = document.createElement('div');
  overlay.id = 'pin-gate-overlay';
  Object.assign(overlay.style, {
    position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.7)', zIndex: '9999',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  });
  const box = document.createElement('div');
  Object.assign(box.style, {
    background: 'var(--surface, #14141A)', border: '1px solid var(--border-dim)', borderRadius: '8px',
    padding: '24px', width: '300px', textAlign: 'center', color: 'var(--text-primary, #F5EDD6)',
  });
  box.innerHTML = `
    <div style="font-size:14px;font-weight:600;color:var(--magenta,#C9A84C);margin-bottom:12px">PIN Required</div>
    <p style="font-size:13px;color:var(--text-muted);margin-bottom:16px">Enter your PIN to access Wealth & Life sections.</p>
    <input id="pin-gate-input" type="password" maxlength="6" placeholder="••••" autocomplete="off"
      style="width:120px;padding:10px;background:var(--void,#0A0A0C);border:1px solid var(--border-dim);border-radius:4px;
      color:var(--text-primary);font-size:18px;font-family:'JetBrains Mono',monospace;letter-spacing:6px;text-align:center;outline:none" />
    <div id="pin-gate-err" style="font-size:12px;color:var(--critical,#E05252);margin-top:8px;min-height:18px"></div>
    <div style="display:flex;gap:8px;justify-content:center;margin-top:12px">
      <button id="pin-gate-ok" style="padding:8px 20px;background:var(--magenta,#C9A84C);color:var(--void,#0A0A0C);border:none;
        border-radius:4px;font-weight:600;cursor:pointer;font-size:13px">Unlock</button>
      <button id="pin-gate-cancel" style="padding:8px 16px;background:none;border:1px solid var(--border-dim);
        border-radius:4px;color:var(--text-muted);cursor:pointer;font-size:13px">Cancel</button>
    </div>`;
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  const input = document.getElementById('pin-gate-input');
  const err = document.getElementById('pin-gate-err');
  input.focus();

  async function submit() {
    const pin = input.value;
    if (!/^\d{4,6}$/.test(pin)) { err.textContent = 'Enter 4-6 digits'; return; }
    try {
      const res = await fetch('/api/auth/pin/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin }),
      });
      if (!res.ok) { const d = await res.json(); err.textContent = d.error || 'Incorrect PIN'; return; }
      _pinRequired = false;
      overlay.remove();
      switchView(targetView);
    } catch { err.textContent = 'Verification failed'; }
  }

  document.getElementById('pin-gate-ok').onclick = submit;
  input.onkeydown = (e) => { if (e.key === 'Enter') submit(); };
  document.getElementById('pin-gate-cancel').onclick = () => overlay.remove();
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
}
