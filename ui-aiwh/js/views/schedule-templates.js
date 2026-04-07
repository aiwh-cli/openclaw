// ─── Schedule Templates: Pre-built cron catalogue ─────────────
// Phase 48.14 — Template picker shown before manual cron creation.
// Selecting a template pre-fills the add cron form.
// Depends on: schedule-crons.js (showAddCron, showAddScriptCron globals)

const _TPL_MODULE_META = {
  system:    { label: 'System',    icon: '⚙️', color: 'var(--cyan, #00e5ff)' },
  frontend:  { label: 'Frontend',  icon: '🎬', color: 'var(--magenta, #ff00e5)' },
  backend:   { label: 'Backend',   icon: '📊', color: 'var(--accent, #C9A84C)' },
  lifestyle: { label: 'Lifestyle', icon: '🏃', color: 'var(--green, #00ff88)' },
};

let _templateCache = null;

async function loadTemplates() {
  if (_templateCache) {return _templateCache;}
  const data = await api('/cron/templates');
  _templateCache = data;
  return data;
}

function _scheduleToHuman(expr) {
  if (!expr) {return '';}
  const parts = expr.split(' ');
  if (parts.length < 5) {return expr;}
  const [min, hr, dom, mon, dow] = parts;

  let time = '';
  if (hr !== '*' && min !== '*') {
    time = `${hr.padStart(2, '0')}:${min.padStart(2, '0')}`;
  } else if (hr.includes('/')) {
    time = `every ${hr.split('/')[1]}h`;
  } else if (min.includes('/')) {
    time = `every ${min.split('/')[1]}min`;
  }

  let days = '';
  if (dow === '*' && dom === '*') {days = 'daily';}
  else if (dow === '1-5') {days = 'weekdays';}
  else if (dow === '0') {days = 'Sundays';}
  else if (dow === '1') {days = 'Mondays';}
  else if (dow === '0,6') {days = 'weekends';}
  else if (dom !== '*') {days = `day ${dom}`;}
  else {days = `dow ${dow}`;}

  if (hr === '*' && min.includes('/')) {return time;}
  return `${time}, ${days}`;
}

function _isTemplateActive(tpl) {
  const all = [..._schedCache.openclaw, ..._schedCache.scripts];
  const tId = (tpl.id || '').toLowerCase();
  const tIdFlat = tId.replace(/-/g, '');
  const tName = (tpl.name || '').toLowerCase();
  // Extract the core concept (e.g. "video-copywriter" from "video-copywriter-morning")
  const tIdParts = tId.split('-');
  const tAgent = (tpl.agent || '').toLowerCase();
  return all.some(j => {
    const jName = (j.name || '').toLowerCase();
    const jNameFlat = jName.replace(/-/g, '').replace(/\./g, '');
    const jDesc = (j.description || '').toLowerCase();
    const jAgent = (j.agentId || '').toLowerCase();
    // Direct name match
    if (jName.includes(tId) || jNameFlat.includes(tIdFlat)) {return true;}
    if (jName.includes(tName) || jDesc.includes(tName)) {return true;}
    // Same agent + similar schedule concept (e.g. both are "copywriter" crons)
    if (tAgent && jAgent === tAgent && tIdParts.length >= 2) {
      const concept = tIdParts.slice(0, 2).join('-'); // "video-copywriter"
      if (jName.includes(concept) || jNameFlat.includes(concept.replace(/-/g, ''))) {return true;}
    }
    return false;
  });
}

async function showTemplatePicker() {
  let data;
  try {
    data = await loadTemplates();
  } catch (e) {
    console.error('[templates] Failed to load:', e);
    showAddCron();
    return;
  }
  if (!data?.templates?.length) {
    showAddCron();
    return;
  }

  const grouped = {};
  for (const tpl of data.templates) {
    const mod = tpl.module || 'system';
    if (!grouped[mod]) {grouped[mod] = [];}
    grouped[mod].push(tpl);
  }

  let html = `
    <h3 style="margin:0 0 4px;font-size:14px;">Add Automation</h3>
    <p style="margin:0 0 12px;color:var(--text-muted);font-size:12px;">
      Choose a template to get started, or create from scratch.
    </p>
  `;

  const moduleOrder = ['frontend', 'backend', 'system', 'lifestyle'];
  for (const mod of moduleOrder) {
    const templates = grouped[mod];
    if (!templates?.length) {continue;}
    const meta = _TPL_MODULE_META[mod] || { label: mod, icon: '📦', color: '#888' };

    html += `
      <div style="margin-bottom:14px;">
        <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:${meta.color};margin-bottom:6px;">
          ${meta.label}
        </div>
        <div class="tpl-grid">
    `;

    for (const tpl of templates) {
      const active = _isTemplateActive(tpl);
      const badge = active
        ? '<span class="tpl-badge tpl-badge-active">Active</span>'
        : tpl.enabled_by_default
          ? '<span class="tpl-badge tpl-badge-rec">Recommended</span>'
          : '';
      const tierLabel = tpl.tier ? `${tpl.tier}` : '';
      const modelLabel = tpl.resolvedModel || tpl.model || '';
      const costLabel = tpl.is_script ? '$0 (script)' : (tierLabel ? `${tierLabel} (${modelLabel})` : modelLabel || 'haiku');
      const schedLabel = _scheduleToHuman(tpl.schedule);

      html += `
        <button class="tpl-card ${active ? 'tpl-card-active' : ''}"
                onclick="selectTemplate('${escHtml(tpl.id)}')"
                title="${escHtml(tpl.description)}">
          <div class="tpl-card-header">
            <span class="tpl-card-name">${escHtml(tpl.name)}</span>
            ${badge}
          </div>
          <div class="tpl-card-desc">${escHtml(tpl.description)}</div>
          <div class="tpl-card-meta">
            <span>${schedLabel}</span>
            <span>${costLabel}</span>
          </div>
        </button>
      `;
    }

    html += '</div></div>';
  }

  html += `
    <div style="display:flex;gap:8px;justify-content:space-between;margin-top:8px;border-top:1px solid var(--border);padding-top:10px;">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-outline" onclick="showAddCron()">Create from scratch</button>
    </div>
  `;

  showModal(html, 'modal-md');
}

async function selectTemplate(tplId) {
  const data = await loadTemplates();
  const tpl = data?.templates?.find(t => t.id === tplId);
  if (!tpl) {return showToast('Template not found', 'error');}

  if (tpl.is_script) {
    selectScriptTemplate(tpl);
    return;
  }

  // Open the regular addCron form, pre-filled with template data
  const state = { freq: 'once', times: ['09:00'], days: [0,1,2,3,4,5,6] };

  // Parse schedule into picker state
  const parts = (tpl.schedule || '').split(' ');
  if (parts.length >= 5) {
    const [min, hr, , , dow] = parts;
    if (hr !== '*' && min !== '*') {
      const times = hr.split(',').flatMap(h =>
        min.split(',').map(m => `${h.padStart(2, '0')}:${m.padStart(2, '0')}`)
      );
      state.times = times;
    }
    if (dow === '*') {
      state.freq = 'daily';
      state.days = [0,1,2,3,4,5,6];
    } else if (dow === '1-5') {
      state.freq = 'weekdays';
      state.days = [0,1,2,3,4];
    } else {
      state.freq = 'custom';
      state.days = dow.split(',').map(d => (parseInt(d) + 6) % 7);
    }
  }

  const agentsData = await api('/agents');
  const agents = (agentsData?.agents || []).filter(a => a.inConfig).toSorted((a, b) => {
    if (a.id === 'main') {return -1;}
    if (b.id === 'main') {return 1;}
    return a.id.localeCompare(b.id);
  });
  const agentOptions = agents.map(a =>
    `<option value="${escHtml(a.id)}" ${a.id === (tpl.agent || 'main') ? 'selected' : ''}>${escHtml(a.displayName || a.id)}</option>`
  ).join('');

  const tz = data.clientTimezone || 'Australia/Brisbane';

  const html = `
    <div style="display:flex;align-items:center;gap:8px;margin:0 0 12px;">
      <button class="btn btn-ghost" onclick="showTemplatePicker()" style="padding:4px 8px;" title="Back to templates">←</button>
      <h3 style="margin:0;font-size:14px;">Add: ${escHtml(tpl.name)}</h3>
    </div>
    <p style="margin:0 0 10px;color:var(--text-muted);font-size:12px;">${escHtml(tpl.description)}</p>
    <div class="cp-form">
      <div class="cp-field">
        <label class="cp-label">Name</label>
        <input id="cron-add-name" class="cp-input" value="com.aiwh.${escHtml(tpl.id)}">
      </div>
      <div class="cp-field">
        <label class="cp-label">Agent</label>
        <select id="cron-add-agent" class="cp-input">${agentOptions}</select>
      </div>
      ${_cpPickerHTML(state)}
      <div class="cp-field">
        <label class="cp-label">Timezone</label>
        <input id="cron-add-tz" class="cp-input" value="${escHtml(tz)}">
      </div>
      <div class="cp-field">
        <label class="cp-label">Message (what the agent does each run)</label>
        <textarea id="cron-add-message" class="cp-input cp-textarea" rows="6">${escHtml(tpl.message || '')}</textarea>
      </div>
      <div class="cp-field">
        <label class="cp-label">Description</label>
        <input id="cron-add-desc" class="cp-input" value="${escHtml(tpl.description || '')}">
      </div>
      <div style="display:flex;gap:12px;">
        <div class="cp-field" style="flex:1">
          <label class="cp-label">Session mode</label>
          <select id="cron-add-session" class="cp-input">
            <option value="isolated" ${(tpl.session || 'isolated') === 'isolated' ? 'selected' : ''}>Isolated (fresh each run)</option>
            <option value="main" ${tpl.session === 'main' ? 'selected' : ''}>Main (shared context)</option>
          </select>
        </div>
        <div class="cp-field" style="flex:1">
          <label class="cp-label">Model</label>
          <select id="cron-add-model" class="cp-input">
            <option value="" ${!tpl.model ? 'selected' : ''}>Agent default</option>
            <option value="${tpl.resolvedModel || 'haiku'}" ${tpl.tier === 'fast' ? 'selected' : ''}>Fast — ${tpl.resolvedModel || 'haiku'}</option>
            <option value="${(_templateCache?.tierMap?.balanced || {})[_templateCache?.defaultProvider || 'anthropic'] || 'sonnet'}" ${tpl.tier === 'balanced' ? 'selected' : ''}>Balanced — ${(_templateCache?.tierMap?.balanced || {})[_templateCache?.defaultProvider || 'anthropic'] || 'sonnet'}</option>
            <option value="${(_templateCache?.tierMap?.quality || {})[_templateCache?.defaultProvider || 'anthropic'] || 'opus'}" ${tpl.tier === 'quality' ? 'selected' : ''}>Quality — ${(_templateCache?.tierMap?.quality || {})[_templateCache?.defaultProvider || 'anthropic'] || 'opus'}</option>
          </select>
        </div>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:4px;">
        <button class="btn btn-ghost" onclick="showTemplatePicker()">Back</button>
        <button class="btn btn-success" onclick="addCron()">Create</button>
      </div>
    </div>
  `;
  showModal(html, 'modal-md');
}

async function selectScriptTemplate(tpl) {
  const data = await loadTemplates();
  const tz = data?.clientTimezone || 'Australia/Brisbane';

  // Parse template schedule into picker state
  const state = typeof _cpParseCron === 'function'
    ? _cpParseCron(tpl.schedule || '0 9 * * *')
    : { freq: 'daily', times: ['09:00'], days: [0,1,2,3,4,5,6] };

  const html = `
    <div style="display:flex;align-items:center;gap:8px;margin:0 0 12px;">
      <button class="btn btn-ghost" onclick="showTemplatePicker()" style="padding:4px 8px;" title="Back to templates">←</button>
      <h3 style="margin:0;font-size:14px;">Add: ${escHtml(tpl.name)}</h3>
    </div>
    <p style="margin:0 0 10px;color:var(--text-muted);font-size:12px;">${escHtml(tpl.description)}</p>
    <p style="margin:0 0 10px;font-size:11px;color:var(--green);">This is a script cron — runs a shell script directly, no AI cost.</p>
    <div class="cp-form">
      <div class="cp-field">
        <label class="cp-label">Name</label>
        <input id="sc-add-name" class="cp-input" value="${escHtml(tpl.name)}">
      </div>
      <div class="cp-field">
        <label class="cp-label">Script path</label>
        <input id="sc-add-path" class="cp-input" value="${escHtml(tpl.script_path || '')}">
      </div>
      ${_cpPickerHTML(state)}
      <div class="cp-field">
        <label class="cp-label">Timezone</label>
        <input id="sc-add-tz" class="cp-input" value="${escHtml(tz)}">
      </div>
      <div class="cp-field">
        <label class="cp-label">Description</label>
        <input id="sc-add-desc" class="cp-input" value="${escHtml(tpl.description || '')}">
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:4px;">
        <button class="btn btn-ghost" onclick="showTemplatePicker()">Back</button>
        <button class="btn btn-success" onclick="addScriptCron()">Create</button>
      </div>
    </div>
  `;
  showModal(html, 'modal-md');
}
