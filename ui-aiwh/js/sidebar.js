// ─── Sidebar Navigation — Data-Driven Hex Rail ─────────────
// Renders nav items from config, supports collapse, module gating.
// Designed for easy future port to Lit component (39.2+).

const SIDEBAR_NAV = [
  { view: 'chat', label: 'Chat', module: null, accent: true, icon: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 3a1 1 0 011-1h10a1 1 0 011 1v7a1 1 0 01-1 1H7.5L3 14v-3H3a1 1 0 01-1-1V3z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M5 6.5h6M5 9h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity=".7"/></svg>` },

  { divider: true, category: 'Command', module: null },
  { view: 'overview', label: 'Overview', module: null, icon: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="6" height="6" rx="1" fill="currentColor" opacity=".7"/><rect x="9" y="1" width="6" height="6" rx="1" fill="currentColor" opacity=".7"/><rect x="1" y="9" width="6" height="6" rx="1" fill="currentColor" opacity=".7"/><rect x="9" y="9" width="6" height="6" rx="1" fill="currentColor" opacity=".7"/></svg>` },
  { view: 'team', label: 'Team', module: null, icon: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="6" cy="5" r="2.5" fill="currentColor" opacity=".7"/><path d="M1 13c0-2.76 2.24-5 5-5s5 2.24 5 5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/><circle cx="12" cy="5.5" r="1.75" fill="currentColor" opacity=".4"/><path d="M10.5 12.8c.16-.9.88-1.8 1.75-1.8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" fill="none"/></svg>` },
  { view: 'tasks', label: 'Tasks', module: null, icon: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1.5" y="1.5" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.5"/><path d="M3 4l1.5 1.5L8 2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 4.5h4.5M10 8h4.5M10 11.5h4.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" opacity=".7"/><rect x="1.5" y="9.5" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.5" opacity=".4"/></svg>` },
  { view: 'schedule', label: 'Schedule', module: null, icon: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.5"/><path d="M8 4.5V8l2.5 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="8" cy="8" r="1" fill="currentColor"/></svg>` },
  { view: 'knowledge', label: 'Knowledge', module: null, icon: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 2.5h4.5a1.5 1.5 0 011.5 1.5v10a1 1 0 00-1-1H2V2.5z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M14 2.5H9.5A1.5 1.5 0 008 4v10a1 1 0 011-1h5V2.5z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>` },

  { divider: true, category: 'Frontend', module: 'frontend' },
  { view: 'social', label: 'Social', module: 'frontend', icon: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1C4.13 1 1 4.13 1 8s3.13 7 7 7 7-3.13 7-7-3.13-7-7-7z" stroke="currentColor" stroke-width="1.4"/><path d="M5.5 6.5a1 1 0 110-2 1 1 0 010 2zM10.5 6a1 1 0 110-2 1 1 0 010 2z" fill="currentColor" opacity=".7"/><path d="M5 10c.6 1.2 1.6 2 3 2s2.4-.8 3-2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>` },

  { divider: true, category: 'Backend', module: 'backend' },
  { view: 'costs', label: 'Costs', module: 'backend', icon: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 13V7l2.5-3 3 3.5 3-6 3.5 4.5V13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M1 13h14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>` },
  { view: 'channels', label: 'Channels', module: 'backend', small: true, icon: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="5" cy="4" r="1.5" fill="currentColor"/><circle cx="11" cy="8" r="1.5" fill="currentColor"/><circle cx="7" cy="12" r="1.5" fill="currentColor"/></svg>` },

  { divider: true, category: 'Lifestyle', module: 'lifestyle' },
  { view: 'wealth', label: 'Wealth', module: 'lifestyle', gold: true, icon: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1l2.5 3.5H14l-2 3.5 2 3.5h-3.5L8 15l-2.5-3.5H2l2-3.5-2-3.5h3.5L8 1z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" fill="currentColor" fill-opacity=".15"/></svg>` },

  { spacer: true },

  { divider: true, category: 'System', module: null },
  { view: 'logs', label: 'Logs', module: null, small: true, icon: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 5h12M2 8h12M2 11h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>` },
  { view: 'debug', label: 'Debug', module: null, small: true, icon: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M6 2a2 2 0 00-2 2v4a4 4 0 008 0V4a2 2 0 00-2-2H6z" stroke="currentColor" stroke-width="1.4"/><path d="M4 6H2m10 0h2M4 9H2m10 0h2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>` },
  { view: 'trash', label: 'Trash', module: null, small: true, icon: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M5.5 4V3a1 1 0 011-1h3a1 1 0 011 1v1M6 7v5M10 7v5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M3.5 4l.7 9a1.5 1.5 0 001.5 1.4h4.6a1.5 1.5 0 001.5-1.4l.7-9" stroke="currentColor" stroke-width="1.3"/></svg>` },
  { view: 'security', label: 'Security', module: null, small: true, icon: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 1L2.5 3.5v4c0 3.5 2.3 6.2 5.5 7.5 3.2-1.3 5.5-4 5.5-7.5v-4L8 1z" stroke="currentColor" stroke-width="1.3" fill="currentColor" opacity=".15"/><path d="M6 8l1.5 1.5L10.5 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>` },
  { view: 'team-access', label: 'Access', module: null, small: true, icon: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="6" cy="4.5" r="2" stroke="currentColor" stroke-width="1.3"/><path d="M2 13c0-2.2 1.8-4 4-4s4 1.8 4 4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M12.5 7v4m-2-2h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>` },
  { view: 'config', label: 'Config', module: null, small: true, icon: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="2" fill="currentColor" opacity=".6"/><path d="M8 1.5v2m0 9v2M1.5 8h2m9 0h2M3.6 3.6l1.4 1.4m6 6l1.4 1.4M3.6 12.4l1.4-1.4M11 5l1.4-1.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>` },
];

// Collapse icon SVGs
const ICON_COLLAPSE = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M11 4L5 8l6 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_EXPAND = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M5 4l6 4-6 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

let _sidebarCollapsed = false;
let _sidebarModules = ['frontend', 'backend', 'lifestyle']; // default all active

// ─── Init ─────────────────────────────────────────────────────

function initSidebar() {
  try { _sidebarCollapsed = localStorage.getItem('mc-sidebar-collapsed') === 'true'; } catch (e) { /* private browsing */ }
  // Render immediately with defaults, then update after module fetch
  renderSidebar();
  _fetchModules().then(() => renderSidebar()).catch(() => {});
}

async function _fetchModules() {
  try {
    const lic = await api('/license');
    if (lic && lic.modules_active) {_sidebarModules = lic.modules_active;}
  } catch (e) { console.warn('Sidebar: module fetch failed', e); }
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
    // Module gating — hide entire section if module inactive
    if (item.module && !_sidebarModules.includes(item.module)) {
      // Skip divider+category and all items in this module
      continue;
    }

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
      if (item.category === 'Lifestyle') {cat.classList.add('hex-category-lifestyle');}
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
    btn.onclick = () => switchView(item.view);

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
