// ─── Debug View ───────────────────────────────────────────────
// System health, gateway status, DB stats, agent session info.

async function initDebug() {
  await loadDebug();
}

async function loadDebug() {
  const [dash, agents] = await Promise.all([
    api('/dashboard'),
    api('/agents'),
  ]);
  renderDebugInfo(dash, agents);
}

function renderDebugInfo(dash, agents) {
  const el = document.getElementById('debug-content');
  if (!el) {return;}

  const gw = dash?.system?.gateway || {};
  const disk = dash?.system?.disk || {};
  const dbAgents = dash?.agents?.list || [];

  el.innerHTML = `
    <div class="debug-grid">
      <!-- Gateway -->
      <div class="debug-card">
        <div class="debug-card-title">OpenClaw Gateway</div>
        <div class="debug-row">
          <span class="debug-label">Status</span>
          <span class="debug-val ${gw.status === 'online' ? 'text-green' : 'text-red'}">${gw.status || 'unknown'}</span>
        </div>
        <div class="debug-row">
          <span class="debug-label">URL</span>
          <code class="debug-val">http://127.0.0.1:18789</code>
        </div>
        <div class="debug-row">
          <span class="debug-label">Detail</span>
          <span class="debug-val">${escHtml(gw.detail || '—')}</span>
        </div>
      </div>

      <!-- Disk -->
      <div class="debug-card">
        <div class="debug-card-title">Disk Usage</div>
        <div class="debug-row">
          <span class="debug-label">AIWH Used</span>
          <span class="debug-val">${disk.used || '?'}</span>
        </div>
        <div class="debug-row">
          <span class="debug-label">Available</span>
          <span class="debug-val">${disk.available || '?'}</span>
        </div>
      </div>

      <!-- Tasks summary -->
      <div class="debug-card">
        <div class="debug-card-title">Task Summary</div>
        ${Object.entries(dash?.tasks || {}).map(([k, v]) => `
          <div class="debug-row">
            <span class="debug-label">${k.replace('_', ' ')}</span>
            <span class="debug-val">${v}</span>
          </div>
        `).join('')}
      </div>

      <!-- Agents sessions -->
      <div class="debug-card">
        <div class="debug-card-title">Agent Status (${dbAgents.length})</div>
        <div class="debug-agent-list">
          ${dbAgents.map(a => `
            <div class="debug-row">
              <span class="debug-label">
                <span class="status-dot status-${a.status || 'idle'}"></span>
                ${escHtml(a.display_name || a.id)}
              </span>
              <span class="debug-val debug-val-sm">
                ${timeAgo(a.last_active_at)}
                ${a.cost_today > 0 ? ` · $${a.cost_today.toFixed(4)}` : ''}
              </span>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Cron -->
      <div class="debug-card">
        <div class="debug-card-title">Cron Jobs (${dash?.system?.cron || 0})</div>
        <div class="debug-row">
          <span class="debug-label">Cached jobs</span>
          <span class="debug-val">${dash?.system?.cron || 0}</span>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="api('/cron/sync').then(() => { showToast('Cron cache refreshed'); loadDebug(); })" title="Re-reads scheduled jobs from the gateway. Use this if you added or changed cron jobs and they don't appear in the Schedule view.">Sync Cron Cache</button>
      </div>

      <!-- System Info -->
      <div class="debug-card" id="debug-sysinfo">
        <div class="debug-card-title">System Info</div>
        <div class="debug-row"><span class="debug-label">Loading...</span></div>
      </div>

      <!-- Actions -->
      <div class="debug-card">
        <div class="debug-card-title">Actions</div>
        <div class="debug-actions">
          <button class="btn btn-ghost btn-sm" onclick="restartGateway()" title="Stops and restarts the AI gateway. Chat sessions are preserved but any running agent task will be interrupted.">Restart Gateway</button>
          <button class="btn btn-ghost btn-sm" onclick="runDoctor()" title="Runs a diagnostic check on the gateway. Read-only — does not change anything.">Run Doctor</button>
          <button class="btn btn-ghost btn-sm" onclick="syncCosts()" title="Re-reads cost data from the gateway. Read-only — just refreshes numbers.">Sync Costs</button>
          <button class="btn btn-ghost btn-sm" onclick="refreshAgents()" title="Re-reads the agent list from gateway config. Read-only — just refreshes the list.">Refresh Agents</button>
          <button class="btn btn-ghost btn-sm" onclick="loadDebug()">↻ Refresh</button>
        </div>
      </div>
    </div>
  `;

  // Load system info async
  loadSystemInfo();
}

async function loadSystemInfo() {
  const el = document.getElementById('debug-sysinfo');
  if (!el) {return;}
  try {
    const info = await api('/debug/system-info');
    const uptimeH = Math.floor(info.uptime / 3600);
    const uptimeM = Math.floor((info.uptime % 3600) / 60);
    const dashUpH = Math.floor(info.dashboardUptime / 3600);
    const dashUpM = Math.floor((info.dashboardUptime % 3600) / 60);
    const memPct = Math.round((1 - info.freeMem / info.totalMem) * 100);
    el.innerHTML = `
      <div class="debug-card-title">System Info</div>
      <div class="debug-row"><span class="debug-label">Host</span><span class="debug-val">${escHtml(info.hostname)}</span></div>
      <div class="debug-row"><span class="debug-label">OS Uptime</span><span class="debug-val">${uptimeH}h ${uptimeM}m</span></div>
      <div class="debug-row"><span class="debug-label">Dashboard Uptime</span><span class="debug-val">${dashUpH}h ${dashUpM}m</span></div>
      <div class="debug-row"><span class="debug-label">Memory</span><span class="debug-val">${memPct}% used</span></div>
      <div class="debug-row"><span class="debug-label">Load</span><span class="debug-val">${escHtml(info.loadavg.map(l => l.toFixed(2)).join(' / '))}</span></div>
      <div class="debug-row"><span class="debug-label">Node</span><span class="debug-val">${escHtml(info.nodeVersion)}</span></div>
    `;
  } catch (e) {
    el.innerHTML = `<div class="debug-card-title">System Info</div><div class="debug-row"><span class="debug-label text-red">Failed</span></div>`;
  }
}

async function restartGateway() {
  const ok = typeof dashConfirm === 'function'
    ? await dashConfirm('Restart the AI gateway?\n\nThis will briefly interrupt any running agent tasks. Chat history is preserved.')
    : confirm('Restart the AI gateway?');
  if (!ok) {return;}
  showToast('Restarting gateway...');
  const r = await api('/debug/gateway-restart', { method: 'POST' });
  if (r?.ok) {
    showToast('Gateway restart initiated', 'success');
    setTimeout(loadDebug, 3000);
  } else {
    showToast('Restart failed: ' + (r?.error || 'unknown'), 'error');
  }
}

async function syncCosts() {
  showToast('Syncing costs...');
  await api('/costs/sync', { method: 'POST' });
  showToast('Costs synced', 'success');
  loadDebug();
}

async function refreshAgents() {
  const d = await api('/agents');
  showToast((d?.agents?.length || 0) + ' agents loaded', 'success');
  loadDebug();
}

async function runDoctor() {
  showToast('Running doctor...');
  const r = await api('/debug/doctor');
  showModal(`
    <h3 style="margin:0 0 12px;font-size:14px;">OpenClaw Doctor</h3>
    <pre style="font-size:11px;white-space:pre-wrap;max-height:400px;overflow-y:auto;background:rgba(0,0,0,0.3);padding:12px;border-radius:6px;">${escHtml(r?.output || 'No output')}</pre>
    <div style="display:flex;justify-content:flex-end;margin-top:12px;">
      <button class="btn btn-ghost" onclick="closeModal()">Close</button>
    </div>
  `, 'modal-lg');
}
