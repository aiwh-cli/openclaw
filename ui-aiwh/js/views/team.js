// ─── Team View ────────────────────────────────────────────────
// Org chart hierarchy + per-agent detail panel.
// Uses /api/org-chart for hierarchy and /api/agents for live status.

let _orgData = null;
let _agentStatuses = {};

// Detail panel, file editor, model picker, avatar, rename → team-detail.js

async function initTeam() {
  await loadTeam();
}

let _activeModules = null;

async function loadTeam() {
  const [org, agents, license] = await Promise.all([
    api('/org-chart'),
    api('/agents'),
    api('/license'),
  ]);

  _orgData = org;
  _activeModules = license?.modules_active || ['frontend', 'backend', 'lifestyle'];

  _agentStatuses = {};
  for (const a of (agents?.agents || [])) {
    _agentStatuses[a.id] = a;
  }

  renderOrgChart(org?.hierarchy);
}

const MODULE_META = {
  frontend:  { label: 'Frontend',  color: 'var(--magenta)' },
  backend:   { label: 'Backend',   color: 'var(--cyan)' },
  system:    { label: 'System',    color: 'var(--text-muted)' },
  lifestyle: { label: 'Lifestyle', color: 'var(--green)' },
};

function renderOrgChart(node) {
  const el = document.getElementById('team-org-chart');
  if (!el || !node) {return;}

  // Render CEO at top
  let html = renderOrgNode(node, 0, true, /* skipChildren */ true);

  // Group CEO's direct reports by module
  const reports = node.reports || [];
  const groups = {};
  for (const r of reports) {
    const mod = (r.module || 'system').toLowerCase();
    if (!groups[mod]) {groups[mod] = [];}
    groups[mod].push(r);
  }

  html += `<div class="org-modules">`;
  for (const mod of ['system', 'frontend', 'backend', 'lifestyle']) {
    const agents = groups[mod];
    if (!agents?.length) {continue;}
    const meta = MODULE_META[mod] || { label: mod, color: 'var(--text-muted)' };
    const isLocked = mod !== 'system' && mod !== 'core' && !_activeModules?.includes(mod);

    html += `<div class="org-module-section${isLocked ? ' module-locked' : ''}">`;
    html += `<div class="org-module-label" style="--mod-color:${isLocked ? 'var(--text-dim)' : meta.color}">${meta.label}${isLocked ? ' <span class="module-lock-badge">LOCKED</span>' : ''}<span class="org-module-count">${agents.length}</span></div>`;
    if (isLocked) {
      html += `<div class="org-module-locked-msg">This module is not included in your plan. Contact support to upgrade.</div>`;
    } else {
      html += `<div class="org-module-cards">`;
      for (const child of agents) {
        html += renderOrgNode(child, 1);
      }
      html += `</div>`;
    }
    html += `</div>`;
  }
  html += `</div>`;

  el.innerHTML = html;
  el.querySelectorAll('[data-agent-id]').forEach(card => {
    card.addEventListener('click', () => openAgentDetail(card.dataset.agentId));
  });
}

function renderOrgNode(node, depth, isRoot = false, skipChildren = false) {
  const status = _agentStatuses[node.id];
  const agentStatus = status?.status || 'idle';
  // Prefer live model from agents API (DB-backed), fall back to org-chart static data
  const agentModel = status?.model || status?.modelTier || node.modelLabel || node.model || 'haiku';
  const mti = modelTierInfo(agentModel);
  const tierKey = mti.tier;
  const tierClass = mti.cls;
  const name = status?.display_name || node.displayName || node.id;
  const avatarUrl = status?.avatar_url || '';
  const desc = node.description || '';
  const shortDesc = desc.length > 65 ? desc.substring(0, 62) + '...' : desc;
  const hasReports = node.reports && node.reports.length > 0;

  // Check if this agent's reports are script-only sub-agents (video pipeline etc.)
  const hasScriptSubs = hasReports && node.reports.every(r => {
    const rMod = (r.module || '').toLowerCase();
    return r.model === 'haiku' && rMod === node.module?.toLowerCase();
  });

  const avatarHtml = avatarUrl
    ? `<img src="${escHtml(avatarUrl)}" alt="" class="tc-avatar-img">`
    : `<svg width="26" height="26" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="6" r="3" stroke="currentColor" stroke-width="1.2" opacity="0.4"/><path d="M2.5 14c0-3 2.5-5.5 5.5-5.5s5.5 2.5 5.5 5.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity="0.4"/></svg>`;

  let html = `
    <div class="org-node ${isRoot ? 'org-root' : ''}" data-depth="${depth}">
      <div class="tc-card ${isRoot ? 'tc-card-ceo' : ''} glass" data-agent-id="${node.id}" title="${escHtml(name)} — ${escHtml(node.title || '')}">
        <span class="tc-status-dot status-dot status-${agentStatus}"></span>
        <div class="tc-avatar">${avatarHtml}</div>
        <div class="tc-info">
          <div class="tc-name">${escHtml(name)}</div>
          <div class="tc-title">${escHtml(node.title || '')}</div>
          <span class="tc-tier ${tierClass}">${escHtml(node.modelLabel || mti.label)}</span>
        </div>
        ${shortDesc ? `<div class="tc-desc">${escHtml(shortDesc)}</div>` : ''}
      </div>
  `;

  if (hasReports && !skipChildren) {
    if (hasScriptSubs) {
      // Render script sub-agents as compact inline chips
      html += `<div class="org-subs-inline">`;
      for (const child of node.reports) {
        const cStatus = _agentStatuses[child.id]?.status || 'idle';
        const cName = _agentStatuses[child.id]?.display_name || child.displayName || child.id;
        html += `<div class="org-sub-chip" data-agent-id="${child.id}">
          <span class="status-dot status-${cStatus}"></span>
          <span class="org-sub-name">${escHtml(cName)}</span>
        </div>`;
      }
      html += `</div>`;
    } else {
      html += `<div class="org-children">`;
      for (const child of node.reports) {
        html += renderOrgNode(child, depth + 1);
      }
      html += `</div>`;
    }
  }

  html += `</div>`;
  return html;
}

// openAgentDetail, handleAvatarUpload, closeAgentDetail, openChatWith, renameAgent
// → moved to team-detail.js
