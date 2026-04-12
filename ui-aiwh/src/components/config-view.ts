// Config View — budget, view toggles, notification routing, subscriptions, security/password.
// Fills #config-settings, #config-notifications, #config-subs, #config-security. Exposed on window.

import { renderAIProviders } from './config-providers.js';

const api = (window as any).api as (url: string, opts?: any) => Promise<any>;
const showToast = (window as any).showToast as (msg: string, type?: string) => void;
const escHtml = (window as any).escHtml as (s: string) => string;

const NOTIF_CATEGORIES = [
  { id: 'general', label: 'General', desc: 'Briefings, task updates, knowledge' },
  { id: 'publish', label: 'Content & Publishing', desc: 'Video pipeline, social posts, media' },
  { id: 'spend', label: 'Cost & Budget', desc: 'Spend alerts, budget warnings' },
  { id: 'systems', label: 'System Alerts', desc: 'Backups, errors, security' },
  { id: 'security', label: 'Security', desc: 'Access alerts, audit events' },
];

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

function renderSettings(settings: any) {
  const el = document.getElementById('config-settings');
  if (!el) { return; }
  el.innerHTML = `
    <div class="config-section">
      <h3 class="config-section-title">Budget Limits</h3>
      <div class="config-row"><label>Daily Budget ($)</label><input type="number" id="cfg-daily-budget" value="${settings.daily_budget || 5}" step="0.5" min="0"></div>
      <div class="config-row"><label>Monthly Budget ($)</label><input type="number" id="cfg-monthly-budget" value="${settings.monthly_budget || 100}" step="5" min="0"></div>
      <button class="btn btn-primary btn-sm" onclick="saveBudget()">Save Budget</button>
    </div>
    <div class="config-section">
      <h3 class="config-section-title">Views</h3>
      <div class="config-row"><label>Show Logs view</label><input type="checkbox" id="cfg-logs" ${settings.view_logs_enabled !== 'false' ? 'checked' : ''}></div>
      <div class="config-row"><label>Show Debug view</label><input type="checkbox" id="cfg-debug" ${settings.view_debug_enabled !== 'false' ? 'checked' : ''}></div>
      <div class="config-row"><label>Show Knowledge view</label><input type="checkbox" id="cfg-knowledge" ${settings.view_knowledge_enabled === 'true' ? 'checked' : ''}></div>
      <button class="btn btn-ghost btn-sm" onclick="saveViewSettings()">Save Views</button>
    </div>
  `;
}

function renderNotificationRouting(routing: any, chStatus: any) {
  const el = document.getElementById('config-notifications');
  if (!el) { return; }
  let channels = Object.keys(chStatus.chat || {});
  if (!channels.length) { channels = ['discord', 'slack', 'telegram', 'whatsapp']; }

  const selStyle = 'width:120px;padding:4px 8px;border-radius:6px;border:1px solid var(--border);background:var(--bg-secondary);color:var(--text-primary)';
  const inputStyle = 'width:170px;padding:4px 8px;border-radius:6px;border:1px solid var(--border);background:var(--bg-secondary);color:var(--text-primary)';
  const btnTestStyle = 'padding:2px 8px;font-size:11px;border-radius:4px;border:1px solid var(--border);background:var(--bg-secondary);color:var(--text-secondary);cursor:pointer';

  const rows = NOTIF_CATEGORIES.map(cat => {
    const r = routing[cat.id] || {};
    const opts = channels.map(ch => `<option value="${escHtml(ch)}" ${r.channel === ch ? 'selected' : ''}>${ch.charAt(0).toUpperCase() + ch.slice(1)}</option>`).join('');
    return `<div class="config-row" style="display:flex;gap:10px;align-items:center">
      <div style="flex:1"><label style="font-weight:500">${cat.label}</label><small style="display:block;color:var(--text-muted)">${cat.desc}</small></div>
      <select class="notif-channel" data-cat="${cat.id}" style="${selStyle}"><option value="">None</option>${opts}</select>
      <input class="notif-target" data-cat="${cat.id}" type="text" placeholder="Channel/group ID" value="${escHtml(r.target || '')}" style="${inputStyle}">
      <button style="${btnTestStyle}" onclick="testNotification('${cat.id}')" title="Send a test message">Test</button>
    </div>`;
  }).join('');

  // Failover row
  const fo = routing.failover || {};
  const foOpts = channels.map(ch => `<option value="${escHtml(ch)}" ${fo.channel === ch ? 'selected' : ''}>${ch.charAt(0).toUpperCase() + ch.slice(1)}</option>`).join('');
  const failoverRow = `<div class="config-row" style="display:flex;gap:10px;align-items:center;margin-top:8px;padding-top:8px;border-top:1px solid var(--border)">
    <div style="flex:1"><label style="font-weight:500">Failover Channel</label><small style="display:block;color:var(--text-muted)">Backup if primary channel is unreachable</small></div>
    <select class="notif-channel" data-cat="failover" style="${selStyle}"><option value="">None</option>${foOpts}</select>
    <input class="notif-target" data-cat="failover" type="text" placeholder="Backup channel/group ID" value="${escHtml(fo.target || '')}" style="${inputStyle}">
    <button style="${btnTestStyle}" onclick="testNotification('failover')" title="Test failover delivery">Test</button>
  </div>
  <div style="margin-top:6px;padding:8px 12px;background:var(--bg-muted, rgba(201,168,76,0.04));border-radius:6px;font-size:12px;color:var(--text-muted)">
    <strong style="color:var(--text-secondary)">Where do I find the channel ID?</strong>
    <ul style="margin:4px 0 0 16px;padding:0;line-height:1.7">
      <li><strong>Discord:</strong> Open Settings &rarr; App Settings &rarr; Advanced &rarr; turn on Developer Mode. Then right-click any channel &rarr; Copy Channel ID.</li>
      <li><strong>Telegram:</strong> Add <em>@raw_data_bot</em> to your group, it will show the group ID. Or ask Branson to look it up for you.</li>
      <li><strong>Slack:</strong> Click the channel name at the top &rarr; scroll to the bottom of the popup &rarr; copy the Channel ID.</li>
      <li><strong>WhatsApp:</strong> Use your phone number in international format (e.g. +61451932232).</li>
    </ul>
    <p style="margin:4px 0 0;font-style:italic">Tip: Click "Test" next to any row to check it&rsquo;s working before you save.</p>
  </div>`;

  el.innerHTML = `<div class="config-section">
    <h3 class="config-section-title">Notification Routing</h3>
    <p style="color:var(--text-muted);font-size:13px;margin-bottom:12px">Where your AI team sends alerts and reports. Click "Test" to verify each channel works.</p>
    ${rows}
    ${failoverRow}
    <div id="delivery-health" style="margin-top:10px;font-size:12px;color:var(--text-muted)"></div>
    <button class="btn btn-primary btn-sm" style="margin-top:12px" onclick="saveNotificationRouting()">Save Routing</button>
    <span id="notif-save-status" style="margin-left:8px;font-size:13px"></span>
  </div>`;

  // Load delivery queue health
  loadDeliveryHealth();
}

function renderConfigSubs(subs: any[]) {
  const el = document.getElementById('config-subs');
  if (!el) { return; }
  const total = subs.reduce((s, sub) => s + (sub.cost || 0), 0);
  el.innerHTML = `<div class="config-section">
    <h3 class="config-section-title">Subscriptions (Total: $${total}/mo)</h3>
    <div class="sub-list">${subs.map(sub => `<div class="sub-row config-sub-row">
      <span class="sub-name">${escHtml(sub.name)}</span>
      <input type="number" class="sub-cost-input" value="${sub.cost || 0}" step="1" data-sub-id="${sub.id}" onchange="updateSubCost('${sub.id}', this.value)">
      <span class="sub-cycle">/${sub.cycle}</span>
    </div>`).join('')}</div>
    <div class="config-note">Update costs to keep total subscription spend accurate.</div>
  </div>`;
}

function renderSecuritySection() {
  const el = document.getElementById('config-security');
  if (!el) { return; }
  el.innerHTML = `<div class="config-section">
    <h3 class="config-section-title">Security</h3>
    <div class="config-row"><label>Current Password</label><div class="pw-input-wrap"><input type="password" id="cfg-current-pw" placeholder="Enter current password" autocomplete="current-password"><button type="button" class="pw-toggle" onclick="togglePwVis(this)" title="Show/hide">&#128065;</button></div></div>
    <div class="config-row"><label>New Password</label><div class="pw-input-wrap"><input type="password" id="cfg-new-pw" placeholder="Min 8 characters" autocomplete="new-password" oninput="updatePwStrength();updatePwMatch()"><button type="button" class="pw-toggle" onclick="togglePwVis(this)" title="Show/hide">&#128065;</button></div></div>
    <div id="pw-requirements" style="font-size:12px;color:var(--text-dim);margin:-4px 0 8px;padding-left:2px"><span id="pw-req-len">8+ characters</span> &middot; <span id="pw-req-upper">uppercase</span> &middot; <span id="pw-req-lower">lowercase</span> &middot; <span id="pw-req-num">number</span></div>
    <div class="config-row"><label>Confirm New Password</label><div class="pw-input-wrap"><input type="password" id="cfg-confirm-pw" placeholder="Repeat new password" autocomplete="new-password" oninput="updatePwMatch()"><button type="button" class="pw-toggle" onclick="togglePwVis(this)" title="Show/hide">&#128065;</button></div></div>
    <div id="pw-match-msg" style="font-size:12px;min-height:16px;margin:-4px 0 4px;padding-left:2px"></div>
    <div id="pw-change-msg" style="min-height:20px;font-size:13px;margin-bottom:8px"></div>
    <button class="btn btn-primary btn-sm" onclick="changePassword()">Change Password</button>
    <button class="btn btn-ghost btn-sm" style="margin-left:8px" onclick="doLogout()">Log Out</button>
  </div>`;
}

async function saveBudget() {
  const daily = parseFloat((document.getElementById('cfg-daily-budget') as HTMLInputElement)?.value || '5');
  const monthly = parseFloat((document.getElementById('cfg-monthly-budget') as HTMLInputElement)?.value || '100');
  await api('/costs/budget', { method: 'PUT', body: { daily, monthly } });
  showToast('Budget saved');
}

async function saveViewSettings() {
  const settings = {
    view_logs_enabled: (document.getElementById('cfg-logs') as HTMLInputElement)?.checked ? 'true' : 'false',
    view_debug_enabled: (document.getElementById('cfg-debug') as HTMLInputElement)?.checked ? 'true' : 'false',
    view_knowledge_enabled: (document.getElementById('cfg-knowledge') as HTMLInputElement)?.checked ? 'true' : 'false',
  };
  await api('/settings', { method: 'PUT', body: settings });
  showToast('View settings saved — reload to apply');
}

async function updateSubCost(subId: string, cost: string) {
  await api(`/costs/subscriptions/${subId}`, { method: 'PUT', body: { cost: parseFloat(cost) || 0 } });
}

async function saveNotificationRouting() {
  const config: Record<string, any> = {};
  document.querySelectorAll('.notif-channel').forEach(sel => {
    const cat = (sel as HTMLElement).dataset.cat!;
    const channel = (sel as HTMLSelectElement).value;
    const target = (document.querySelector(`.notif-target[data-cat="${cat}"]`) as HTMLInputElement)?.value?.trim() || '';
    if (channel && target) { config[cat] = { channel, target }; }
  });
  const status = document.getElementById('notif-save-status');
  try {
    const res = await api('/notification-routing', { method: 'PUT', body: JSON.stringify(config), headers: { 'Content-Type': 'application/json' } });
    if (status) { status.textContent = `Saved — ${res.repaired || 0} crons updated`; status.style.color = 'var(--accent-green)'; }
  } catch (e: any) { if (status) { status.textContent = `Error: ${e.message}`; status.style.color = 'var(--accent-red)'; } }
  setTimeout(() => { if (status) { status.textContent = ''; } }, 5000);
}

async function testNotification(category: string) {
  try {
    await api('/notification-routing/test', { method: 'POST', body: { category } });
    showToast(`Test notification sent to ${category}`);
  } catch (e: any) {
    showToast(`Test failed: ${e.message}`, 'error');
  }
}

async function loadDeliveryHealth() {
  const el = document.getElementById('delivery-health');
  if (!el) { return; }
  try {
    const status = await api('/delivery-queue/status');
    const parts: string[] = [];
    if (status.pending > 0) { parts.push(`${status.pending} pending`); }
    if (status.failed > 0) { parts.push(`<span style="color:var(--critical)">${status.failed} failed</span>`); }
    el.innerHTML = parts.length
      ? `Delivery Queue: ${parts.join(', ')}`
      : '<span style="color:var(--success)">Delivery Queue: all clear</span>';
  } catch {
    el.textContent = '';
  }
}

function togglePwVis(btn: HTMLButtonElement) {
  const input = btn.previousElementSibling as HTMLInputElement;
  if (!input) { return; }
  input.type = input.type === 'password' ? 'text' : 'password';
  btn.style.opacity = input.type === 'text' ? '1' : '0.4';
}

function updatePwMatch() {
  const newPw = (document.getElementById('cfg-new-pw') as HTMLInputElement)?.value || '';
  const confirm = (document.getElementById('cfg-confirm-pw') as HTMLInputElement)?.value || '';
  const el = document.getElementById('pw-match-msg');
  if (!el || !confirm) { if (el) { el.innerHTML = ''; } return; }
  el.innerHTML = newPw === confirm ? '<span style="color:var(--success)">Passwords match</span>' : '<span style="color:var(--critical)">Passwords do not match</span>';
}

function updatePwStrength() {
  const pw = (document.getElementById('cfg-new-pw') as HTMLInputElement)?.value || '';
  const check = (id: string, ok: boolean) => { const el = document.getElementById(id); if (el) { el.style.color = ok ? 'var(--success)' : 'var(--text-dim)'; } };
  check('pw-req-len', pw.length >= 8);
  check('pw-req-upper', /[A-Z]/.test(pw));
  check('pw-req-lower', /[a-z]/.test(pw));
  check('pw-req-num', /[0-9]/.test(pw));
}

async function changePassword() {
  const current = (document.getElementById('cfg-current-pw') as HTMLInputElement)?.value;
  const newPw = (document.getElementById('cfg-new-pw') as HTMLInputElement)?.value;
  const confirm = (document.getElementById('cfg-confirm-pw') as HTMLInputElement)?.value;
  const msg = document.getElementById('pw-change-msg')!;
  if (!current || !newPw) { msg.innerHTML = '<span style="color:var(--critical)">All fields required</span>'; return; }
  if (newPw.length < 8) { msg.innerHTML = '<span style="color:var(--critical)">New password must be at least 8 characters</span>'; return; }
  if (newPw !== confirm) { msg.innerHTML = '<span style="color:var(--critical)">New passwords do not match</span>'; return; }
  const res = await api('/auth/change-password', { method: 'POST', body: { currentPassword: current, newPassword: newPw } });
  if (res?.success) { msg.innerHTML = '<span style="color:var(--success)">Password changed. Redirecting to login...</span>'; setTimeout(() => { window.location.href = '/login.html'; }, 1500); }
  else { msg.innerHTML = `<span style="color:var(--critical)">${escHtml(res?.error || 'Failed to change password')}</span>`; }
}

async function doLogout() {
  await api('/auth/logout', { method: 'POST' });
  window.location.href = '/login.html';
}

// Expose on window
(window as any).initConfig = initConfig;
(window as any).loadConfig = loadConfig;
(window as any).saveBudget = saveBudget;
(window as any).saveViewSettings = saveViewSettings;
(window as any).updateSubCost = updateSubCost;
(window as any).saveNotificationRouting = saveNotificationRouting;
(window as any).testNotification = testNotification;
(window as any).loadDeliveryHealth = loadDeliveryHealth;
(window as any).togglePwVis = togglePwVis;
(window as any).updatePwMatch = updatePwMatch;
(window as any).updatePwStrength = updatePwStrength;
(window as any).changePassword = changePassword;
(window as any).doLogout = doLogout;
