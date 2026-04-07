// ─── Channel Settings Modal ────────────────────────────────────
// Per-channel config editors. Compact layout with tooltips & chip allowlists.

async function openChannelSettings(channelId) {
  showModal('<div class="ch-wizard"><div class="ch-wizard-loading">Loading settings…</div></div>');
  const [config, bindings, agentsData] = await Promise.all([
    api('/channels/config'), api('/channels/bindings'), api('/agents'),
  ]);
  const chConfig = config?.channels?.[channelId] || {};
  const allBindings = Array.isArray(bindings) ? bindings : [];
  const chBindings = allBindings.filter(b => b.match?.channel === channelId);
  const agents = agentsData?.agents || [];
  const label = channelId.charAt(0).toUpperCase() + channelId.slice(1);

  const renderer = {
    whatsapp: renderWhatsAppSettings,
    discord: renderDiscordSettings,
    telegram: renderTelegramSettings,
    slack: renderSlackSettings,
  }[channelId] || renderGenericSettings;

  renderer(channelId, label, chConfig, chBindings, agents);
}

// ═══════════════════════════════════════════════════════════════
// WHATSAPP
// ═══════════════════════════════════════════════════════════════
function renderWhatsAppSettings(id, label, cfg, bindings, agents) {
  const boundAgents = [...new Set(bindings.map(b => b.agentId))];
  showModal(`
    <div class="ch-settings">
      <div class="ch-settings-header"><span class="ch-card-icon">${chIcon(id)}</span><h3>${label} Settings</h3></div>

      <div class="ch-settings-grid">
        ${policySelect('DM Policy', 'ch-dm-policy', cfg.dmPolicy || 'pairing', [
          ['pairing', 'Pairing', 'New contacts get a one-time code you approve'],
          ['open', 'Open', 'Anyone can message (adds wildcard)'],
          ['allowlist', 'Allowlist', 'Only phone numbers in allow list'],
          ['disabled', 'Disabled', 'All DMs blocked']])}
        ${policySelect('Group Policy', 'ch-group-policy', cfg.groupPolicy || 'allowlist', [
          ['open', 'Open', 'Bot responds in all groups'],
          ['allowlist', 'Allowlist', 'Only groups with allowed senders'],
          ['disabled', 'Disabled', 'Ignore all group messages']])}
      </div>

      ${chipList('DM Allow List', 'ch-allow-from', cfg.allowFrom || [], '+61412345678', 'Phone numbers (E.164) allowed to DM the bot')}
      ${chipList('Group Allow List', 'ch-group-allow-from', cfg.groupAllowFrom || [], '+61412345678', 'Phone numbers allowed to trigger bot in groups')}

      <div class="ch-settings-section ch-settings-opts">
        <div class="ch-settings-title">Options</div>
        <div class="ch-opts-row">
          <label class="ch-checkbox" title="Send read receipts (blue ticks) when messages are processed">
            <input type="checkbox" id="ch-read-receipts" ${cfg.sendReadReceipts ? 'checked' : ''}><span>Read receipts</span></label>
          <label class="ch-opt-field" title="Wait time (ms) before processing — groups multiple rapid messages into one">
            <span>Debounce</span><input type="number" id="ch-debounce" class="input input-sm ch-input-num" value="${cfg.debounceMs || 0}" min="0" step="100"></label>
          <label class="ch-opt-field" title="Maximum media file size the bot will download (MB)">
            <span>Media max</span><input type="number" id="ch-media-max" class="input input-sm ch-input-num" value="${cfg.mediaMaxMb || 50}" min="1"></label>
          <label class="ch-opt-field" title="Number of past messages loaded as conversation context">
            <span>History</span><input type="number" id="ch-history" class="input input-sm ch-input-num" value="${cfg.historyLimit || 50}" min="1"></label>
        </div>
      </div>

      ${agentBindingsSection(id, agents, boundAgents)}
      ${settingsActions(id)}
    </div>
  `, 'modal-wide');
}

// ═══════════════════════════════════════════════════════════════
// DISCORD
// ═══════════════════════════════════════════════════════════════
function renderDiscordSettings(id, label, cfg, bindings, agents) {
  const boundAgents = [...new Set(bindings.map(b => b.agentId))];
  const guilds = cfg.guilds || {};
  const guildEntries = Object.entries(guilds);

  showModal(`
    <div class="ch-settings">
      <div class="ch-settings-header"><span class="ch-card-icon">${chIcon(id)}</span><h3>${label} Settings</h3></div>

      <div class="ch-settings-grid">
        ${policySelect('DM Policy', 'ch-dm-policy', cfg.dmPolicy || 'pairing', [
          ['pairing', 'Pairing', 'Unknown users get a pairing code'],
          ['open', 'Open', 'Any Discord user can DM the bot'],
          ['allowlist', 'Allowlist', 'Only user IDs in allowFrom'],
          ['disabled', 'Disabled', 'All DMs blocked']])}
        ${policySelect('Server Policy', 'ch-group-policy', cfg.groupPolicy || 'allowlist', [
          ['allowlist', 'Allowlist', 'Only listed guilds/channels respond'],
          ['open', 'Open', 'Bot responds everywhere (mention gating applies)'],
          ['disabled', 'Disabled', 'All server messages ignored']])}
      </div>

      ${chipList('DM Allow List', 'ch-allow-from', cfg.allowFrom || [], '714693362833293412', 'Discord user IDs allowed to DM the bot')}

      <div class="ch-settings-section ch-settings-opts">
        <div class="ch-settings-title">Options</div>
        <div class="ch-opts-row">
          <label class="ch-opt-field" title="How response text is streamed to Discord">
            <span>Streaming</span>
            <select id="ch-streaming" class="input input-sm">
              ${['off', 'partial', 'block', 'progress'].map(s =>
                `<option value="${s}" ${(cfg.streaming||'off') === s ? 'selected' : ''}>${s}</option>`
              ).join('')}
            </select></label>
          <label class="ch-checkbox" title="Allow other Discord bots to trigger this bot">
            <input type="checkbox" id="ch-allow-bots" ${cfg.allowBots ? 'checked' : ''}><span>Allow bots</span></label>
        </div>
      </div>

      <div class="ch-settings-section">
        <div class="ch-settings-title">Server Allowlist <span class="ch-count">${guildEntries.length} server(s)</span></div>
        ${guildEntries.map(([gid, guild]) => {
          const users = guild.users || [];
          const channels = Object.entries(guild.channels || {});
          const allowed = channels.filter(([,c]) => c.allow).length;
          return `<div class="ch-guild-settings" data-guild-id="${gid}">
            <div class="ch-guild-header">
              <span class="mono ch-guild-id">${escHtml(gid)}</span>
              <span class="ch-badge">${allowed}/${channels.length} ch</span>
              <label class="ch-checkbox ch-checkbox-inline" title="Bot only responds when @mentioned in this server">
                <input type="checkbox" data-guild="${gid}" class="ch-guild-mention" ${guild.requireMention !== false ? 'checked' : ''}><span>@mention</span></label>
            </div>
            <details class="ch-guild-details">
              <summary>${channels.length} channel(s) &middot; ${users.length} user(s)</summary>
              <div class="ch-guild-channels">${channels.map(([cId, c]) =>
                `<span class="ch-channel-chip ${c.allow ? 'ch-chip-allow' : 'ch-chip-deny'}" title="${cId}">${c.allow ? '&#10003;' : '&#10007;'} …${cId.slice(-6)}</span>`
              ).join('')}</div>
              <div class="ch-guild-users-section">
                <span class="ch-label">Allowed Users</span>
                <div class="ch-chip-container" id="ch-guild-users-${gid}">${users.map(u =>
                  `<span class="ch-chip" data-list="ch-guild-users-${gid}">${escHtml(u)}<button class="ch-chip-x" onclick="this.parentElement.remove()" title="Remove">&times;</button></span>`
                ).join('')}</div>
                <div class="ch-chip-add">
                  <input type="text" id="ch-guild-users-${gid}-input" class="input input-sm ch-chip-input" placeholder="User ID">
                  <button class="btn btn-xs btn-ghost" onclick="addChip('ch-guild-users-${gid}')" title="Add user ID">+ Add</button>
                </div>
              </div>
            </details>
          </div>`;
        }).join('')}
      </div>

      ${agentBindingsSection(id, agents, boundAgents)}
      ${settingsActions(id)}
    </div>
  `, 'modal-wide');
}

// ═══════════════════════════════════════════════════════════════
// TELEGRAM
// ═══════════════════════════════════════════════════════════════
function renderTelegramSettings(id, label, cfg, bindings, agents) {
  const boundAgents = [...new Set(bindings.map(b => b.agentId))];
  showModal(`
    <div class="ch-settings">
      <div class="ch-settings-header"><span class="ch-card-icon">${chIcon(id)}</span><h3>${label} Settings</h3></div>

      <div class="ch-settings-grid">
        ${policySelect('DM Policy', 'ch-dm-policy', cfg.dmPolicy || 'pairing', [
          ['pairing', 'Pairing', 'New users get a one-time pairing code'],
          ['open', 'Open', 'Anyone can DM the bot'],
          ['allowlist', 'Allowlist', 'Only Telegram user IDs in allow list'],
          ['disabled', 'Disabled', 'All DMs blocked']])}
        ${policySelect('Group Policy', 'ch-group-policy', cfg.groupPolicy || 'allowlist', [
          ['open', 'Open', 'Bot responds in all groups (mention gating applies)'],
          ['allowlist', 'Allowlist', 'Only groups with allowed senders'],
          ['disabled', 'Disabled', 'All group messages ignored']])}
      </div>

      ${chipList('DM Allow List', 'ch-allow-from', cfg.allowFrom || [], '123456789', 'Numeric Telegram user IDs allowed to DM')}

      <div class="ch-settings-section ch-settings-opts">
        <div class="ch-settings-title">Options</div>
        <div class="ch-opts-row">
          <label class="ch-checkbox" title="Require @botname mention in group chats before responding">
            <input type="checkbox" id="ch-require-mention" ${cfg.requireMention !== false ? 'checked' : ''}><span>Require @mention</span></label>
          <label class="ch-checkbox" title="Show URL previews in bot replies">
            <input type="checkbox" id="ch-link-preview" ${cfg.linkPreview !== false ? 'checked' : ''}><span>Link previews</span></label>
          <label class="ch-opt-field" title="How response text is streamed to Telegram">
            <span>Streaming</span>
            <select id="ch-streaming" class="input input-sm">
              ${['off', 'partial', 'block', 'progress'].map(s =>
                `<option value="${s}" ${(cfg.streaming||'partial') === s ? 'selected' : ''}>${s}</option>`
              ).join('')}
            </select></label>
          <label class="ch-opt-field" title="Number of past messages loaded as conversation context">
            <span>History</span><input type="number" id="ch-history" class="input input-sm ch-input-num" value="${cfg.historyLimit || 50}" min="1"></label>
        </div>
      </div>

      ${agentBindingsSection(id, agents, boundAgents)}
      ${settingsActions(id)}
    </div>
  `, 'modal-wide');
}

// ═══════════════════════════════════════════════════════════════
// SLACK
// ═══════════════════════════════════════════════════════════════
function renderSlackSettings(id, label, cfg, bindings, agents) {
  const boundAgents = [...new Set(bindings.map(b => b.agentId))];
  showModal(`
    <div class="ch-settings">
      <div class="ch-settings-header"><span class="ch-card-icon">${chIcon(id)}</span><h3>${label} Settings</h3></div>

      <div class="ch-settings-grid">
        ${policySelect('DM Policy', 'ch-dm-policy', cfg.dmPolicy || 'pairing', [
          ['pairing', 'Pairing', 'New users get a pairing code'],
          ['open', 'Open', 'Anyone in workspace can DM'],
          ['allowlist', 'Allowlist', 'Only Slack user IDs in allow list'],
          ['disabled', 'Disabled', 'All DMs blocked']])}
        ${policySelect('Channel Policy', 'ch-group-policy', cfg.groupPolicy || 'allowlist', [
          ['open', 'Open', 'Bot responds in all channels (mention gating applies)'],
          ['allowlist', 'Allowlist', 'Only configured channels'],
          ['disabled', 'Disabled', 'All channel messages ignored']])}
      </div>

      ${chipList('DM Allow List', 'ch-allow-from', cfg.allowFrom || [], 'U012ABCDEF', 'Slack user IDs or usernames allowed to DM')}

      <div class="ch-settings-section ch-settings-opts">
        <div class="ch-settings-title">Options</div>
        <div class="ch-opts-row">
          <label class="ch-checkbox" title="Require @botname mention in channels before responding">
            <input type="checkbox" id="ch-require-mention" ${cfg.requireMention !== false ? 'checked' : ''}><span>Require @mention</span></label>
          <label class="ch-checkbox" title="Use Slack's native streaming API for real-time responses">
            <input type="checkbox" id="ch-native-streaming" ${cfg.nativeStreaming !== false ? 'checked' : ''}><span>Native streaming</span></label>
          <label class="ch-opt-field" title="Socket Mode (WebSocket) or HTTP Events API connection">
            <span>Mode</span>
            <select id="ch-mode" class="input input-sm">
              <option value="socket" ${(cfg.mode||'socket') === 'socket' ? 'selected' : ''}>Socket</option>
              <option value="http" ${cfg.mode === 'http' ? 'selected' : ''}>HTTP</option>
            </select></label>
          <label class="ch-opt-field" title="How response text is streamed to Slack">
            <span>Streaming</span>
            <select id="ch-streaming" class="input input-sm">
              ${['off', 'partial', 'block', 'progress'].map(s =>
                `<option value="${s}" ${(cfg.streaming||'partial') === s ? 'selected' : ''}>${s}</option>`
              ).join('')}
            </select></label>
        </div>
      </div>

      ${agentBindingsSection(id, agents, boundAgents)}
      ${settingsActions(id)}
    </div>
  `, 'modal-wide');
}

// ═══════════════════════════════════════════════════════════════
// GENERIC (fallback)
// ═══════════════════════════════════════════════════════════════
function renderGenericSettings(id, label, cfg, bindings, agents) {
  const boundAgents = [...new Set(bindings.map(b => b.agentId))];
  showModal(`
    <div class="ch-settings">
      <div class="ch-settings-header"><span class="ch-card-icon">${chIcon(id)}</span><h3>${label} Settings</h3></div>
      <div class="ch-settings-grid">
        ${policySelect('DM Policy', 'ch-dm-policy', cfg.dmPolicy || 'pairing', [
          ['pairing','Pairing','Pairing code for new contacts'],['open','Open','Anyone can message'],
          ['allowlist','Allowlist','Only allow-listed IDs'],['disabled','Disabled','Block all DMs']])}
        ${policySelect('Group Policy', 'ch-group-policy', cfg.groupPolicy || 'allowlist', [
          ['open','Open','Respond everywhere'],['allowlist','Allowlist','Only allowed groups'],
          ['disabled','Disabled','Ignore groups']])}
      </div>
      ${agentBindingsSection(id, agents, boundAgents)}
      ${settingsActions(id)}
    </div>
  `, 'modal-wide');
}

// ═══════════════════════════════════════════════════════════════
// SHARED COMPONENTS
// ═══════════════════════════════════════════════════════════════

// Compact dropdown policy selector with tooltip
function policySelect(title, name, current, options) {
  const currentOpt = options.find(([v]) => v === current);
  const tooltip = currentOpt ? currentOpt[2] : '';
  return `<div class="ch-policy-field">
    <label class="ch-policy-label" title="${escHtml(tooltip)}">${title}
      <select name="${name}" class="input input-sm ch-policy-select" title="${escHtml(tooltip)}"
        onchange="this.closest('.ch-policy-field').querySelector('.ch-policy-hint').textContent=this.selectedOptions[0]?.title||''">
        ${options.map(([val, lbl, desc]) =>
          `<option value="${val}" ${current === val ? 'selected' : ''} title="${escHtml(desc)}">${lbl}</option>`
        ).join('')}
      </select>
    </label>
    <span class="ch-policy-hint">${escHtml(tooltip)}</span>
  </div>`;
}

// Interactive chip list for allowlists
function chipList(title, inputId, items, example, tooltip) {
  const chips = items.filter(i => i !== '*').map(i =>
    `<span class="ch-chip" data-list="${inputId}">${escHtml(i)}<button class="ch-chip-x" onclick="this.parentElement.remove()" title="Remove">&times;</button></span>`
  ).join('');
  return `<div class="ch-settings-section" title="${escHtml(tooltip)}">
    <div class="ch-settings-title">${title}</div>
    <div class="ch-chip-container" id="${inputId}-chips">${chips}</div>
    <div class="ch-chip-add">
      <input type="text" id="${inputId}-input" class="input input-sm ch-chip-input" placeholder="${escHtml(example)}"
        onkeydown="if(event.key==='Enter'){event.preventDefault();addChip('${inputId}')}">
      <button class="btn btn-xs btn-ghost" onclick="addChip('${inputId}')">+ Add</button>
    </div>
  </div>`;
}

function addChip(inputId) {
  const input = document.getElementById(inputId + '-input');
  const container = document.getElementById(inputId + '-chips');
  if (!input || !container) {return;}
  const val = input.value.trim();
  if (!val) {return;}
  const existing = [...container.querySelectorAll('.ch-chip')];
  for (const c of existing) {
    const txt = c.firstChild?.textContent?.trim();
    if (txt === val) {return;}
  }
  const chip = document.createElement('span');
  chip.className = 'ch-chip';
  chip.dataset.list = inputId;
  chip.innerHTML = `${escHtml(val)}<button class="ch-chip-x" onclick="this.parentElement.remove()" title="Remove">&times;</button>`;
  container.appendChild(chip);
  input.value = '';
  input.focus();
}

function getChipValues(inputId) {
  const container = document.getElementById(inputId + '-chips');
  if (!container) {return [];}
  return [...container.querySelectorAll('.ch-chip')].map(c => {
    const txt = c.firstChild?.textContent?.trim();
    return txt || '';
  }).filter(Boolean);
}

// Agent bindings — tracks original state so save only adds/removes changes
function agentBindingsSection(channelId, agents, boundAgents) {
  return `<div class="ch-settings-section">
    <div class="ch-settings-title">Agent Bindings</div>
    <div class="ch-agent-bindings" data-channel="${channelId}" data-original="${escHtml(JSON.stringify(boundAgents))}">${agents.map(a => `
      <label class="ch-agent-bind ${boundAgents.includes(a.id) ? 'ch-agent-bound' : ''}" title="Route messages to ${escHtml(a.id)}">
        <input type="checkbox" value="${a.id}" ${boundAgents.includes(a.id) ? 'checked' : ''} class="ch-bind-check">
        <span>${escHtml(a.id)}</span>
      </label>`).join('')}
    </div></div>`;
}

function settingsActions(channelId) {
  return `<div class="ch-settings-actions">
    <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="saveChannelSettings('${channelId}')">Save Settings</button>
  </div>`;
}

// ═══════════════════════════════════════════════════════════════
// SAVE (channel-aware) — only saves changed values
// ═══════════════════════════════════════════════════════════════
async function saveChannelSettings(channelId) {
  const get = id => document.getElementById(id);
  const val = id => get(id)?.value;
  const checked = id => get(id)?.checked;
  const selectVal = name => document.querySelector(`select[name="${name}"]`)?.value;

  const saves = [];
  const set = (path, value) => saves.push(
    api('/channels/config-set', { method: 'POST', body: { path: `channels.${channelId}.${path}`, value } })
  );

  // Shared: policies
  const dmPolicy = selectVal('ch-dm-policy');
  const groupPolicy = selectVal('ch-group-policy');
  if (dmPolicy) {set('dmPolicy', dmPolicy);}
  if (groupPolicy) {set('groupPolicy', groupPolicy);}

  // Allow lists (chip-based)
  const allowFrom = getChipValues('ch-allow-from');
  if (dmPolicy === 'open') {set('allowFrom', ['*']);}
  else {set('allowFrom', allowFrom);}

  // Channel-specific fields
  if (channelId === 'whatsapp') {
    set('groupAllowFrom', getChipValues('ch-group-allow-from'));
    if (get('ch-read-receipts')) {set('sendReadReceipts', checked('ch-read-receipts'));}
    if (get('ch-debounce')) {set('debounceMs', parseInt(val('ch-debounce')) || 0);}
    if (get('ch-media-max')) {set('mediaMaxMb', parseInt(val('ch-media-max')) || 50);}
    if (get('ch-history')) {set('historyLimit', parseInt(val('ch-history')) || 50);}
  }

  if (channelId === 'discord') {
    if (get('ch-streaming')) {set('streaming', val('ch-streaming'));}
    if (get('ch-allow-bots')) {set('allowBots', checked('ch-allow-bots'));}
    // Save guild-level settings (requireMention + users)
    document.querySelectorAll('.ch-guild-settings[data-guild-id]').forEach(guildEl => {
      const gid = guildEl.dataset.guildId;
      const mentionCb = guildEl.querySelector('.ch-guild-mention');
      if (mentionCb) {
        saves.push(api('/channels/config-set', { method: 'POST', body: {
          path: `channels.discord.guilds["${gid}"].requireMention`, value: mentionCb.checked
        }}));
      }
      const guildUsers = getChipValues('ch-guild-users-' + gid);
      saves.push(api('/channels/config-set', { method: 'POST', body: {
        path: `channels.discord.guilds["${gid}"].users`, value: guildUsers
      }}));
    });
  }

  if (channelId === 'telegram') {
    if (get('ch-streaming')) {set('streaming', val('ch-streaming'));}
    if (get('ch-require-mention')) {set('requireMention', checked('ch-require-mention'));}
    if (get('ch-link-preview')) {set('linkPreview', checked('ch-link-preview'));}
    if (get('ch-history')) {set('historyLimit', parseInt(val('ch-history')) || 50);}
  }

  if (channelId === 'slack') {
    if (get('ch-streaming')) {set('streaming', val('ch-streaming'));}
    if (get('ch-mode')) {set('mode', val('ch-mode'));}
    if (get('ch-require-mention')) {set('requireMention', checked('ch-require-mention'));}
    if (get('ch-native-streaming')) {set('nativeStreaming', checked('ch-native-streaming'));}
  }

  // Agent bindings — diff against original to only add/remove changes
  const bindingsDiv = document.querySelector('.ch-agent-bindings[data-channel]');
  if (bindingsDiv) {
    const original = JSON.parse(bindingsDiv.dataset.original || '[]');
    const nowChecked = [...document.querySelectorAll('.ch-bind-check:checked')].map(cb => cb.value);
    const nowUnchecked = [...document.querySelectorAll('.ch-bind-check:not(:checked)')].map(cb => cb.value);
    // Bind newly checked agents
    for (const agentId of nowChecked) {
      if (!original.includes(agentId)) {
        saves.push(api('/channels/bind', { method: 'POST', body: { agentId, channel: channelId } }));
      }
    }
    // Unbind newly unchecked agents
    for (const agentId of nowUnchecked) {
      if (original.includes(agentId)) {
        saves.push(api('/channels/unbind', { method: 'POST', body: { agentId, channel: channelId } }));
      }
    }
  }

  showModal('<div class="ch-wizard"><div class="ch-wizard-loading">Saving…</div></div>');
  const results = await Promise.all(saves);
  const failed = results.filter(r => r?.error);

  if (failed.length) {
    const errors = failed.map(r => r.error).join('; ');
    showToast(`${failed.length} setting(s) failed: ${errors}`, 'error');
  } else {
    showToast('Settings saved. Restart gateway to apply.', 'success');
  }

  closeModal();
  loadChannels();
}
