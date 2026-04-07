// ─── Config View ──────────────────────────────────────────────
// Dashboard settings: budgets, view toggles, subscriptions.

async function initConfig() {
  await loadConfig();
}

async function loadConfig() {
  const [settings, subs, notifRouting, chStatus] = await Promise.all([
    api('/settings'),
    api('/costs/subscriptions'),
    api('/notification-routing').catch(() => ({})),
    api('/channels/list').catch(() => ({})),
  ]);
  renderSettings(settings || {});
  renderNotificationRouting(notifRouting || {}, chStatus || {});
  renderAIProviders();
  renderConfigSubs(subs || []);
  renderSecuritySection();
}

function renderSettings(settings) {
  const el = document.getElementById('config-settings');
  if (!el) {return;}

  el.innerHTML = `
    <div class="config-section">
      <h3 class="config-section-title">Budget Limits</h3>
      <div class="config-row">
        <label>Daily Budget ($)</label>
        <input type="number" id="cfg-daily-budget" value="${settings.daily_budget || 5}" step="0.5" min="0">
      </div>
      <div class="config-row">
        <label>Monthly Budget ($)</label>
        <input type="number" id="cfg-monthly-budget" value="${settings.monthly_budget || 100}" step="5" min="0">
      </div>
      <button class="btn btn-primary btn-sm" onclick="saveBudget()">Save Budget</button>
    </div>

    <div class="config-section">
      <h3 class="config-section-title">Views</h3>
      <div class="config-row">
        <label>Show Logs view</label>
        <input type="checkbox" id="cfg-logs" ${settings.view_logs_enabled !== 'false' ? 'checked' : ''}>
      </div>
      <div class="config-row">
        <label>Show Debug view</label>
        <input type="checkbox" id="cfg-debug" ${settings.view_debug_enabled !== 'false' ? 'checked' : ''}>
      </div>
      <div class="config-row">
        <label>Show Knowledge view</label>
        <input type="checkbox" id="cfg-knowledge" ${settings.view_knowledge_enabled === 'true' ? 'checked' : ''}>
      </div>
      <button class="btn btn-ghost btn-sm" onclick="saveViewSettings()">Save Views</button>
    </div>
  `;
}

// ─── Notification Routing ─────────────────────────────────────

const NOTIF_CATEGORIES = [
  { id: 'general', label: 'General', desc: 'Briefings, task updates, knowledge' },
  { id: 'publish', label: 'Content & Publishing', desc: 'Video pipeline, social posts, media' },
  { id: 'spend', label: 'Cost & Budget', desc: 'Spend alerts, budget warnings' },
  { id: 'systems', label: 'System Alerts', desc: 'Backups, errors, security' },
  { id: 'security', label: 'Security', desc: 'Access alerts, audit events' },
];

function renderNotificationRouting(routing, chStatus) {
  const el = document.getElementById('config-notifications');
  if (!el) {return;}

  let channels = Object.keys(chStatus.chat || {});
  if (!channels.length) {channels = ['discord', 'slack', 'telegram', 'whatsapp'];}

  const rows = NOTIF_CATEGORIES.map(cat => {
    const r = routing[cat.id] || {};
    const opts = channels.map(ch =>
      `<option value="${ch}" ${r.channel === ch ? 'selected' : ''}>${ch.charAt(0).toUpperCase() + ch.slice(1)}</option>`
    ).join('');
    return `
      <div class="config-row" style="display:flex;gap:12px;align-items:center">
        <div style="flex:1">
          <label style="font-weight:500">${cat.label}</label>
          <small style="display:block;color:var(--text-muted)">${cat.desc}</small>
        </div>
        <select class="notif-channel" data-cat="${cat.id}" style="width:120px;padding:4px 8px;border-radius:6px;border:1px solid var(--border);background:var(--bg-secondary);color:var(--text-primary)">
          <option value="">None</option>
          ${opts}
        </select>
        <input class="notif-target" data-cat="${cat.id}" type="text" placeholder="Channel/group ID" value="${r.target || ''}"
          style="width:200px;padding:4px 8px;border-radius:6px;border:1px solid var(--border);background:var(--bg-secondary);color:var(--text-primary)">
      </div>`;
  }).join('');

  const helpByChannel = {
    discord: 'Right-click a Discord channel &rarr; Copy Channel ID (enable Developer Mode in Discord Settings &rarr; Advanced)',
    slack: 'Open a Slack channel &rarr; click the channel name at top &rarr; scroll to the bottom of the popup &rarr; copy the Channel ID',
    telegram: 'Send a message in your group, then visit api.telegram.org/bot&lt;TOKEN&gt;/getUpdates &mdash; the chat.id is your target',
    whatsapp: 'Use your phone number in international format, e.g. +61451932232',
  };
  const helpHtml = channels.map(ch => {
    const tip = helpByChannel[ch] || 'Check your platform docs for the channel/group ID';
    return `<li><strong>${ch.charAt(0).toUpperCase() + ch.slice(1)}:</strong> ${tip}</li>`;
  }).join('');

  el.innerHTML = `
    <div class="config-section">
      <h3 class="config-section-title">Notification Routing</h3>
      <p style="color:var(--text-muted);font-size:13px;margin-bottom:12px">Where your AI team sends alerts and reports. Changes apply to all scheduled jobs automatically.</p>
      ${rows}
      <details style="margin-top:12px;font-size:12px;color:var(--text-muted)">
        <summary style="cursor:pointer;font-weight:500;color:var(--text-secondary)">How do I find the channel/group ID?</summary>
        <ul style="margin:8px 0 0 16px;line-height:1.8">${helpHtml}</ul>
      </details>
      <button class="btn btn-primary btn-sm" style="margin-top:12px" onclick="saveNotificationRouting()">Save Routing</button>
      <span id="notif-save-status" style="margin-left:8px;font-size:13px"></span>
    </div>
  `;
}

async function saveNotificationRouting() {
  const config = {};
  document.querySelectorAll('.notif-channel').forEach(sel => {
    const cat = sel.dataset.cat;
    const channel = sel.value;
    const target = document.querySelector(`.notif-target[data-cat="${cat}"]`)?.value?.trim() || '';
    if (channel && target) {config[cat] = { channel, target };}
  });

  const status = document.getElementById('notif-save-status');
  try {
    const res = await api('/notification-routing', { method: 'PUT', body: JSON.stringify(config), headers: { 'Content-Type': 'application/json' } });
    status.textContent = `Saved — ${res.repaired || 0} crons updated`;
    status.style.color = 'var(--accent-green)';
  } catch (e) {
    status.textContent = `Error: ${e.message}`;
    status.style.color = 'var(--accent-red)';
  }
  setTimeout(() => { status.textContent = ''; }, 5000);
}

// ─── AI Providers ────────────────────────────────────────────

const LLM_PROVIDERS = [
  { id: 'ANTHROPIC_API_KEY', name: 'Anthropic', desc: 'Direct access to Claude models', color: '#D4A574',
    logo: `<svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M13.827 3.52h3.603L24 20.48h-3.603l-6.57-16.96zm-7.258 0H10.172L16.74 20.48H13.14L11.06 15.1H5.56l-2.07 5.38H0L6.569 3.52zm4.132 8.9L8.24 6.38 5.78 12.42h4.92z"/></svg>`,
    helpUrl: 'https://console.anthropic.com/settings/keys' },
  { id: 'OPENROUTER_API_KEY', name: 'OpenRouter', desc: 'Hundreds of models via one API key', color: '#6466F1',
    logo: `<svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>`,
    helpUrl: 'https://openrouter.ai/settings/keys' },
  { id: 'OPENAI_API_KEY', name: 'OpenAI', desc: 'Text embeddings for knowledge search', color: '#10A37F',
    logo: `<svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.998 5.998 0 0 0-3.998 2.9 6.042 6.042 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"/></svg>`,
    helpUrl: 'https://platform.openai.com/api-keys' },
];

async function renderAIProviders() {
  const el = document.getElementById('config-providers');
  if (!el) {return;}

  // Check which keys are stored (uses authenticated endpoint, not onboarding)
  let storedKeys = [];
  try {
    const status = await api('/providers/status');
    storedKeys = status?.stored || [];
  } catch {}

  // All connected LLM providers are active (clients can use multiple simultaneously)
  const LLM_KEY_IDS = new Set(['ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY']);

  // Check Codex OAuth status
  let codexStatus = { connected: false };
  try {
    codexStatus = await api('/providers/oauth/codex/status') || { connected: false };
  } catch {}

  el.innerHTML = `
    <div class="config-section">
      <h3 class="config-section-title">AI Providers</h3>
      <div class="config-note" style="margin-bottom:12px">
        You manage your own accounts with each provider. API keys are stored locally on this machine only.
      </div>
      <div class="provider-list">
        ${LLM_PROVIDERS.map(p => {
          const stored = storedKeys.includes(p.id);
          const isActive = stored && (LLM_KEY_IDS.has(p.id) || p.id === 'OPENAI_API_KEY');
          return `
          <div class="provider-card ${stored ? 'provider-connected' : ''}">
            <div class="provider-logo" style="background:${p.color}">${p.logo}</div>
            <div class="provider-info">
              <div class="provider-name">${escHtml(p.name)}${isActive ? ' <span class="provider-active-badge">active</span>' : ''}</div>
              <div class="provider-desc">${escHtml(p.desc)}</div>
            </div>
            <div class="provider-actions">
              ${stored
                ? `<span class="provider-status connected">Connected</span>
                   <button class="btn btn-ghost btn-xs" onclick="updateProviderKey('${p.id}', '${escHtml(p.name)}')">Update Key</button>`
                : `<button class="btn btn-primary btn-xs" onclick="addProviderKey('${p.id}', '${escHtml(p.name)}', '${p.helpUrl}')">Add Key</button>`
              }
            </div>
          </div>`;
        }).join('')}
        <div class="provider-card ${codexStatus.connected ? 'provider-connected' : ''}">
          <div class="provider-logo" style="background:#10A37F"><svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.998 5.998 0 0 0-3.998 2.9 6.042 6.042 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073z"/></svg></div>
          <div class="provider-info">
            <div class="provider-name">ChatGPT / Codex${codexStatus.connected ? ' <span class="provider-active-badge">connected</span>' : ''}</div>
            <div class="provider-desc">Use your ChatGPT Pro subscription for Codex models — no API key needed</div>
          </div>
          <div class="provider-actions">
            ${codexStatus.connected
              ? `<span class="provider-status connected">${codexStatus.expired ? 'Expired — reconnect' : 'Connected'}</span>
                 <button class="btn btn-ghost btn-xs" onclick="connectCodex()">Reconnect</button>`
              : `<button class="btn btn-primary btn-xs" onclick="connectCodex()">Connect ChatGPT</button>`
            }
          </div>
        </div>
      </div>
    </div>
  `;
}

function showProviderKeyModal(serviceId, serviceName, helpUrl, isUpdate) {
  const title = isUpdate ? `Update ${serviceName} Key` : `Add ${serviceName} Key`;
  const helpLink = helpUrl ? `<a href="${escHtml(helpUrl)}" target="_blank" rel="noopener" class="provider-help-link">Get your API key here &rarr;</a>` : '';

  showModal(`
    <div class="provider-key-modal">
      <h2>${title}</h2>
      <p class="provider-key-desc">Paste your ${escHtml(serviceName)} API key below. This key is stored locally on this machine only — we never see it.</p>
      ${helpLink}
      <input type="password" id="provider-key-input" class="provider-key-input" placeholder="Paste API key here..." autocomplete="off" spellcheck="false">
      <div class="provider-key-toggle">
        <button type="button" class="btn btn-ghost btn-xs" onclick="toggleProviderKeyVis()">Show key</button>
      </div>
      <div id="provider-key-error" class="provider-key-error"></div>
      <div class="provider-key-actions">
        <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" id="provider-key-save" onclick="saveProviderKey('${serviceId}', '${escHtml(serviceName)}')">Save Key</button>
      </div>
    </div>
  `);
  setTimeout(() => document.getElementById('provider-key-input')?.focus(), 50);
}

function toggleProviderKeyVis() {
  const inp = document.getElementById('provider-key-input');
  if (!inp) {return;}
  inp.type = inp.type === 'password' ? 'text' : 'password';
}

async function saveProviderKey(serviceId, serviceName) {
  const inp = document.getElementById('provider-key-input');
  const errEl = document.getElementById('provider-key-error');
  const btn = document.getElementById('provider-key-save');
  if (!inp) {return;}

  const key = inp.value.trim();
  if (!key) {
    if (errEl) {errEl.textContent = 'Please paste an API key';}
    return;
  }

  if (btn) { btn.textContent = 'Saving...'; btn.disabled = true; }

  const res = await api('/providers/store-key', {
    method: 'POST',
    body: { serviceId, key },
  });

  if (res?.success) {
    await api('/providers/sync-credentials', { method: 'POST' });
    closeModal();
    showToast(`${serviceName} key saved`);
    renderAIProviders();
  } else {
    if (errEl) {errEl.textContent = res?.error || 'Failed to save key';}
    if (btn) { btn.textContent = 'Save Key'; btn.disabled = false; }
  }
}

async function connectCodex() {
  showToast('Starting ChatGPT login — a browser window will open...');
  const res = await api('/providers/oauth/codex/start', { method: 'POST' });
  if (res?.authUrl) {
    window.open(res.authUrl, '_blank', 'width=500,height=700');
    showToast('Complete login in the browser window, then come back here');
    // Poll status every 3s for up to 2 minutes
    let attempts = 0;
    const poll = setInterval(async () => {
      attempts++;
      const status = await api('/providers/oauth/codex/status');
      if (status?.connected) {
        clearInterval(poll);
        showToast('ChatGPT/Codex connected');
        renderAIProviders();
      }
      if (attempts > 40) {clearInterval(poll);}
    }, 3000);
  } else {
    showToast('Login started — check if a browser window opened automatically');
  }
}

function addProviderKey(serviceId, serviceName, helpUrl) {
  showProviderKeyModal(serviceId, serviceName, helpUrl, false);
}

function updateProviderKey(serviceId, serviceName) {
  showProviderKeyModal(serviceId, serviceName, '', true);
}

// ─── Subscriptions ───────────────────────────────────────────

function renderConfigSubs(subs) {
  const el = document.getElementById('config-subs');
  if (!el) {return;}

  const total = subs.reduce((s, sub) => s + (sub.cost || 0), 0);
  el.innerHTML = `
    <div class="config-section">
      <h3 class="config-section-title">Subscriptions (Total: $${total}/mo)</h3>
      <div class="sub-list">
        ${subs.map(sub => `
          <div class="sub-row config-sub-row">
            <span class="sub-name">${escHtml(sub.name)}</span>
            <input type="number" class="sub-cost-input" value="${sub.cost || 0}" step="1" data-sub-id="${sub.id}"
                   onchange="updateSubCost('${sub.id}', this.value)">
            <span class="sub-cycle">/${sub.cycle}</span>
          </div>
        `).join('')}
      </div>
      <div class="config-note">Update costs to keep total subscription spend accurate.</div>
    </div>
  `;
}

async function saveBudget() {
  const daily = parseFloat(document.getElementById('cfg-daily-budget')?.value || '5');
  const monthly = parseFloat(document.getElementById('cfg-monthly-budget')?.value || '100');
  await api('/costs/budget', { method: 'PUT', body: { daily, monthly } });
  showToast('Budget saved');
}

async function saveViewSettings() {
  const settings = {
    view_logs_enabled: document.getElementById('cfg-logs')?.checked ? 'true' : 'false',
    view_debug_enabled: document.getElementById('cfg-debug')?.checked ? 'true' : 'false',
    view_knowledge_enabled: document.getElementById('cfg-knowledge')?.checked ? 'true' : 'false',
  };
  await api('/settings', { method: 'PUT', body: settings });
  showToast('View settings saved — reload to apply');
}

async function updateSubCost(subId, cost) {
  await api(`/costs/subscriptions/${subId}`, { method: 'PUT', body: { cost: parseFloat(cost) || 0 } });
}

function renderSecuritySection() {
  const el = document.getElementById('config-security');
  if (!el) {return;}

  el.innerHTML = `
    <div class="config-section">
      <h3 class="config-section-title">Security</h3>
      <div class="config-row">
        <label>Current Password</label>
        <div class="pw-input-wrap">
          <input type="password" id="cfg-current-pw" placeholder="Enter current password" autocomplete="current-password">
          <button type="button" class="pw-toggle" onclick="togglePwVis(this)" title="Show/hide">&#128065;</button>
        </div>
      </div>
      <div class="config-row">
        <label>New Password</label>
        <div class="pw-input-wrap">
          <input type="password" id="cfg-new-pw" placeholder="Min 8 characters" autocomplete="new-password" oninput="updatePwStrength();updatePwMatch()">
          <button type="button" class="pw-toggle" onclick="togglePwVis(this)" title="Show/hide">&#128065;</button>
        </div>
      </div>
      <div id="pw-requirements" style="font-size:12px;color:var(--text-dim);margin:-4px 0 8px;padding-left:2px">
        <span id="pw-req-len">8+ characters</span> &middot;
        <span id="pw-req-upper">uppercase</span> &middot;
        <span id="pw-req-lower">lowercase</span> &middot;
        <span id="pw-req-num">number</span>
      </div>
      <div class="config-row">
        <label>Confirm New Password</label>
        <div class="pw-input-wrap">
          <input type="password" id="cfg-confirm-pw" placeholder="Repeat new password" autocomplete="new-password" oninput="updatePwMatch()">
          <button type="button" class="pw-toggle" onclick="togglePwVis(this)" title="Show/hide">&#128065;</button>
        </div>
      </div>
      <div id="pw-match-msg" style="font-size:12px;min-height:16px;margin:-4px 0 4px;padding-left:2px"></div>
      <div id="pw-change-msg" style="min-height:20px;font-size:13px;margin-bottom:8px"></div>
      <button class="btn btn-primary btn-sm" onclick="changePassword()">Change Password</button>
      <button class="btn btn-ghost btn-sm" style="margin-left:8px" onclick="doLogout()">Log Out</button>
    </div>
  `;
}

function togglePwVis(btn) {
  const input = btn.previousElementSibling;
  if (!input) {return;}
  input.type = input.type === 'password' ? 'text' : 'password';
  btn.style.opacity = input.type === 'text' ? '1' : '0.4';
}

function updatePwMatch() {
  const newPw = document.getElementById('cfg-new-pw')?.value || '';
  const confirm = document.getElementById('cfg-confirm-pw')?.value || '';
  const el = document.getElementById('pw-match-msg');
  if (!el || !confirm) { if (el) {el.innerHTML = '';} return; }
  if (newPw === confirm) {
    el.innerHTML = '<span style="color:var(--success)">Passwords match</span>';
  } else {
    el.innerHTML = '<span style="color:var(--critical)">Passwords do not match</span>';
  }
}

function updatePwStrength() {
  const pw = document.getElementById('cfg-new-pw')?.value || '';
  const check = (id, ok) => {
    const el = document.getElementById(id);
    if (el) { el.style.color = ok ? 'var(--success)' : 'var(--text-dim)'; }
  };
  check('pw-req-len', pw.length >= 8);
  check('pw-req-upper', /[A-Z]/.test(pw));
  check('pw-req-lower', /[a-z]/.test(pw));
  check('pw-req-num', /[0-9]/.test(pw));
}

async function changePassword() {
  const current = document.getElementById('cfg-current-pw')?.value;
  const newPw = document.getElementById('cfg-new-pw')?.value;
  const confirm = document.getElementById('cfg-confirm-pw')?.value;
  const msg = document.getElementById('pw-change-msg');

  if (!current || !newPw) { msg.innerHTML = '<span style="color:var(--critical)">All fields required</span>'; return; }
  if (newPw.length < 8) { msg.innerHTML = '<span style="color:var(--critical)">New password must be at least 8 characters</span>'; return; }
  if (newPw !== confirm) { msg.innerHTML = '<span style="color:var(--critical)">New passwords do not match</span>'; return; }

  const res = await api('/auth/change-password', {
    method: 'POST',
    body: { currentPassword: current, newPassword: newPw },
  });

  if (res?.success) {
    msg.innerHTML = '<span style="color:var(--success)">Password changed. Redirecting to login...</span>';
    setTimeout(() => { window.location.href = '/login.html'; }, 1500);
  } else {
    msg.innerHTML = `<span style="color:var(--critical)">${escHtml(res?.error || 'Failed to change password')}</span>`;
  }
}

async function doLogout() {
  await api('/auth/logout', { method: 'POST' });
  window.location.href = '/login.html';
}
