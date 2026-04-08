// Channel Setup Wizards — per-channel guided setup flows (modal-based).
// Custom AIWH code (not from OpenClaw). Exposed on window.

import { chIcon } from './channel-icons.js';

const api = (window as any).api as (url: string, opts?: any) => Promise<any>;
const showToast = (window as any).showToast as (msg: string, type?: string) => void;
const showModal = (window as any).showModal as (html: string, cls?: string) => void;
const closeModal = (window as any).closeModal as () => void;
const escHtml = (window as any).escHtml as (s: string) => string;

function loadChannels() { if (typeof (window as any).loadChannels === 'function') { (window as any).loadChannels(); } }

function showChannelPicker() {
  const channels = [
    { id: 'discord',  name: 'Discord',  desc: 'Talk to your AI team in Discord. Best for teams with existing servers.', color: '#5865F2' },
    { id: 'telegram', name: 'Telegram', desc: 'Chat with your AI via Telegram. Quick setup — just create a bot.', color: '#26A5E4' },
    { id: 'slack',    name: 'Slack',    desc: 'Integrate your AI into Slack workspaces. Ideal for business teams.', color: '#4A154B' },
    { id: 'whatsapp', name: 'WhatsApp', desc: 'Chat with your AI from WhatsApp. Links to your phone — no extra app.', color: '#25D366' },
  ];
  showModal(`
    <div class="ch-wizard">
      <h3>Add a Channel</h3>
      <p class="ch-wizard-sub">Choose a platform to connect</p>
      <div class="ch-picker-grid">
        ${channels.map(ch => `
          <button class="ch-picker-card" onclick="startSetup_${ch.id}()" style="--ch-accent:${ch.color}">
            <span class="ch-picker-icon">${chIcon(ch.id)}</span>
            <strong>${ch.name}</strong>
            <span class="ch-picker-desc">${ch.desc}</span>
          </button>
        `).join('')}
      </div>
    </div>
  `);
}

// ── DISCORD ──
function startSetup_discord() {
  showModal(`<div class="ch-wizard">
    <div class="ch-wizard-steps"><span class="ch-step active">1. Create Bot</span><span class="ch-step">2. Token</span><span class="ch-step">3. Done</span></div>
    <h3>Discord Bot Setup</h3>
    <div class="ch-instructions">
      <div class="ch-step-block"><p><strong>Step 1:</strong> Create a Discord Application</p><ol>
        <li>Go to <a href="https://discord.com/developers/applications" target="_blank">Discord Developer Portal</a></li>
        <li>Click <strong>"New Application"</strong>, give it a name</li><li>Go to <strong>Bot</strong> tab, click <strong>"Add Bot"</strong></li></ol></div>
      <div class="ch-step-block"><p><strong>Step 2:</strong> Enable Privileged Intents</p><ol>
        <li>In the Bot tab, scroll to <strong>Privileged Gateway Intents</strong></li>
        <li>Enable <strong>Message Content Intent</strong> (required)</li><li>Enable <strong>Server Members Intent</strong> (recommended)</li></ol></div>
      <div class="ch-step-block"><p><strong>Step 3:</strong> Invite the Bot</p><ol>
        <li>Go to <strong>OAuth2 → URL Generator</strong></li><li>Select scopes: <code>bot</code>, <code>applications.commands</code></li>
        <li>Select permissions: View Channels, Send Messages, Read Message History, Embed Links, Attach Files, Add Reactions</li>
        <li>Copy the URL and open it to invite the bot to your server</li></ol></div>
    </div>
    <div class="ch-form-actions"><button class="btn btn-ghost" onclick="showChannelPicker()">Back</button>
      <button class="btn btn-primary" onclick="discordStep2()">Next: Enter Token</button></div>
  </div>`);
}

function discordStep2() {
  showModal(`<div class="ch-wizard">
    <div class="ch-wizard-steps"><span class="ch-step done">1. Create Bot</span><span class="ch-step active">2. Token</span><span class="ch-step">3. Done</span></div>
    <h3>Enter Bot Token</h3>
    <div class="ch-instructions"><p>In the <a href="https://discord.com/developers/applications" target="_blank">Developer Portal</a>, go to your app → <strong>Bot</strong> → click <strong>"Reset Token"</strong> and copy it.</p></div>
    <div class="ch-form-group"><label>Bot Token</label><input type="password" id="ch-discord-token" class="input" placeholder="Paste your Discord bot token"></div>
    <div class="ch-form-group"><label>Account ID <span class="ch-hint">(optional, defaults to "default")</span></label><input type="text" id="ch-discord-account" class="input" placeholder="default"></div>
    <div class="ch-form-actions"><button class="btn btn-ghost" onclick="startSetup_discord()">Back</button>
      <button class="btn btn-primary" onclick="discordSubmit()">Connect Discord</button></div>
  </div>`);
}

async function discordSubmit() {
  const token = (document.getElementById('ch-discord-token') as HTMLInputElement)?.value?.trim();
  const account = (document.getElementById('ch-discord-account') as HTMLInputElement)?.value?.trim() || undefined;
  if (!token) {return showToast('Please enter the bot token', 'error');}
  showModal('<div class="ch-wizard"><div class="ch-wizard-loading">Connecting to Discord…</div></div>');
  const r = await api('/channels/add', { method: 'POST', body: { channel: 'discord', token, account } });
  if (r?.ok) {
    await api('/channels/bind', { method: 'POST', body: { agentId: 'main', channel: 'discord', accountId: account || 'default' } }).catch(() => {});
    showModal(`<div class="ch-wizard"><div class="ch-wizard-steps"><span class="ch-step done">1. Create Bot</span><span class="ch-step done">2. Token</span><span class="ch-step active">3. Done</span></div>
      <div class="ch-wizard-success"><span class="ch-success-icon">&#10003;</span><h3>Discord Connected</h3>
        <p>Your bot is now configured and linked to Branson.</p><p class="ch-hint">You can add more agent bindings in Channel Settings.</p></div>
      <div class="ch-form-actions"><button class="btn btn-primary" onclick="closeModal(); loadChannels();">Done</button></div></div>`);
  } else {
    showModal(`<div class="ch-wizard"><div class="ch-wizard-error">Failed: ${escHtml(r?.error || 'Unknown error')}</div>
      <div class="ch-form-actions"><button class="btn btn-ghost" onclick="discordStep2()">Try Again</button></div></div>`);
  }
}

// ── TELEGRAM ──
function startSetup_telegram() {
  showModal(`<div class="ch-wizard">
    <div class="ch-wizard-steps"><span class="ch-step active">1. Create Bot</span><span class="ch-step">2. Token</span><span class="ch-step">3. Done</span></div>
    <h3>Telegram Bot Setup</h3>
    <div class="ch-instructions">
      <div class="ch-step-block"><p><strong>Step 1:</strong> Create a Bot via BotFather</p><ol>
        <li>Open Telegram and message <a href="https://t.me/BotFather" target="_blank">@BotFather</a></li>
        <li>Send <code>/newbot</code></li><li>Follow the prompts to choose a name and username</li>
        <li>BotFather will give you a <strong>bot token</strong> — copy it</li></ol></div>
      <div class="ch-step-block"><p><strong>Step 2:</strong> (Optional) Enable Group Message Access</p><ol>
        <li>Message @BotFather: <code>/setprivacy</code></li><li>Select your bot, then choose <strong>Disable</strong></li></ol></div>
    </div>
    <div class="ch-form-actions"><button class="btn btn-ghost" onclick="showChannelPicker()">Back</button>
      <button class="btn btn-primary" onclick="telegramStep2()">Next: Enter Token</button></div>
  </div>`);
}

function telegramStep2() {
  showModal(`<div class="ch-wizard">
    <div class="ch-wizard-steps"><span class="ch-step done">1. Create Bot</span><span class="ch-step active">2. Token</span><span class="ch-step">3. Done</span></div>
    <h3>Enter Bot Token</h3>
    <div class="ch-instructions"><p>Paste the token from <strong>@BotFather</strong>. Looks like: <code>123456789:ABCdefGHI...</code></p></div>
    <div class="ch-form-group"><label>Bot Token</label><input type="password" id="ch-telegram-token" class="input" placeholder="123456789:ABCdefGHIjklmNOPqrs"></div>
    <div class="ch-form-actions"><button class="btn btn-ghost" onclick="startSetup_telegram()">Back</button>
      <button class="btn btn-primary" onclick="telegramSubmit()">Connect Telegram</button></div>
  </div>`);
}

async function telegramSubmit() {
  const token = (document.getElementById('ch-telegram-token') as HTMLInputElement)?.value?.trim();
  if (!token) {return showToast('Please enter the bot token', 'error');}
  if (!token.includes(':')) {return showToast('Invalid token format. Should be like 123456:ABC...', 'error');}
  showModal('<div class="ch-wizard"><div class="ch-wizard-loading">Connecting to Telegram…</div></div>');
  const r = await api('/channels/add', { method: 'POST', body: { channel: 'telegram', token } });
  if (r?.ok) {
    await api('/channels/bind', { method: 'POST', body: { agentId: 'main', channel: 'telegram' } });
    showModal(`<div class="ch-wizard"><div class="ch-wizard-steps"><span class="ch-step done">1. Create Bot</span><span class="ch-step done">2. Token</span><span class="ch-step active">3. Done</span></div>
      <div class="ch-wizard-success"><span class="ch-success-icon">&#10003;</span><h3>Telegram Connected</h3>
        <p>Your bot is online and bound to the <strong>main</strong> agent.</p><p class="ch-hint">DM your bot on Telegram to test.</p></div>
      <div class="ch-form-actions"><button class="btn btn-primary" onclick="closeModal(); loadChannels();">Done</button></div></div>`);
  } else {
    showModal(`<div class="ch-wizard"><div class="ch-wizard-error">Failed: ${escHtml(r?.error || 'Unknown error')}</div>
      <div class="ch-form-actions"><button class="btn btn-ghost" onclick="telegramStep2()">Try Again</button></div></div>`);
  }
}

// ── SLACK ──
function startSetup_slack() {
  showModal(`<div class="ch-wizard ch-wizard-wide">
    <div class="ch-wizard-steps"><span class="ch-step active">1. Create App</span><span class="ch-step">2. Tokens</span><span class="ch-step">3. Done</span></div>
    <h3>Slack App Setup</h3>
    <div class="ch-instructions">
      <div class="ch-step-block"><p><strong>Step 1:</strong> Create a Slack App</p><ol>
        <li>Go to <a href="https://api.slack.com/apps" target="_blank">Slack API → Your Apps</a></li>
        <li>Click <strong>"Create New App"</strong> → <strong>"From scratch"</strong></li><li>Name it and pick your workspace</li></ol></div>
      <div class="ch-step-block"><p><strong>Step 2:</strong> Enable Socket Mode</p><ol>
        <li>In the sidebar, go to <strong>Socket Mode</strong> and enable it</li>
        <li>Generate an <strong>App Token</strong> (<code>xapp-...</code>) with <code>connections:write</code> scope</li></ol></div>
      <div class="ch-step-block"><p><strong>Step 3:</strong> Add Bot Scopes & Install</p><ol>
        <li>Go to <strong>OAuth & Permissions</strong></li>
        <li>Add Bot Token Scopes: <code>chat:write</code>, <code>channels:history</code>, <code>channels:read</code>, <code>groups:history</code>, <code>im:history</code>, <code>im:read</code>, <code>im:write</code>, <code>app_mentions:read</code>, <code>reactions:read</code>, <code>reactions:write</code>, <code>users:read</code></li>
        <li>Subscribe to events: <code>app_mention</code>, <code>message.channels</code>, <code>message.groups</code>, <code>message.im</code></li>
        <li>Enable <strong>Messages Tab</strong> in App Home</li>
        <li><strong>Install to Workspace</strong> and copy the <strong>Bot Token</strong> (<code>xoxb-...</code>)</li></ol></div>
    </div>
    <div class="ch-form-actions"><button class="btn btn-ghost" onclick="showChannelPicker()">Back</button>
      <button class="btn btn-primary" onclick="slackStep2()">Next: Enter Tokens</button></div>
  </div>`);
}

function slackStep2() {
  showModal(`<div class="ch-wizard">
    <div class="ch-wizard-steps"><span class="ch-step done">1. Create App</span><span class="ch-step active">2. Tokens</span><span class="ch-step">3. Done</span></div>
    <h3>Enter Slack Tokens</h3>
    <div class="ch-form-group"><label>Bot Token <span class="ch-hint">(starts with xoxb-)</span></label><input type="password" id="ch-slack-bot" class="input" placeholder="xoxb-..."></div>
    <div class="ch-form-group"><label>App Token <span class="ch-hint">(starts with xapp-)</span></label><input type="password" id="ch-slack-app" class="input" placeholder="xapp-..."></div>
    <div class="ch-form-actions"><button class="btn btn-ghost" onclick="startSetup_slack()">Back</button>
      <button class="btn btn-primary" onclick="slackSubmit()">Connect Slack</button></div>
  </div>`);
}

async function slackSubmit() {
  const bot = (document.getElementById('ch-slack-bot') as HTMLInputElement)?.value?.trim();
  const app = (document.getElementById('ch-slack-app') as HTMLInputElement)?.value?.trim();
  if (!bot || !app) {return showToast('Both tokens are required', 'error');}
  if (!bot.startsWith('xoxb-')) {return showToast('Bot token should start with xoxb-', 'error');}
  if (!app.startsWith('xapp-')) {return showToast('App token should start with xapp-', 'error');}
  showModal('<div class="ch-wizard"><div class="ch-wizard-loading">Connecting to Slack…</div></div>');
  const r = await api('/channels/add', { method: 'POST', body: { channel: 'slack', options: { 'bot-token': bot, 'app-token': app } }});
  if (r?.ok) {
    await api('/channels/bind', { method: 'POST', body: { agentId: 'main', channel: 'slack' } });
    showModal(`<div class="ch-wizard"><div class="ch-wizard-steps"><span class="ch-step done">1. Create App</span><span class="ch-step done">2. Tokens</span><span class="ch-step active">3. Done</span></div>
      <div class="ch-wizard-success"><span class="ch-success-icon">&#10003;</span><h3>Slack Connected</h3>
        <p>Your Slack app is configured and bound to the <strong>main</strong> agent.</p><p class="ch-hint">DM your bot in Slack or @mention it in a channel to test.</p></div>
      <div class="ch-form-actions"><button class="btn btn-primary" onclick="closeModal(); loadChannels();">Done</button></div></div>`);
  } else {
    showModal(`<div class="ch-wizard"><div class="ch-wizard-error">Failed: ${escHtml(r?.error || 'Unknown error')}</div>
      <div class="ch-form-actions"><button class="btn btn-ghost" onclick="slackStep2()">Try Again</button></div></div>`);
  }
}

// ── WHATSAPP ──
function startSetup_whatsapp() {
  showModal(`<div class="ch-wizard">
    <div class="ch-wizard-steps"><span class="ch-step active">1. Add Config</span><span class="ch-step">2. Scan QR</span><span class="ch-step">3. Done</span></div>
    <h3>WhatsApp Setup</h3>
    <div class="ch-instructions"><div class="ch-step-block">
      <p>WhatsApp connects by linking as a <strong>companion device</strong> — like WhatsApp Web.</p>
      <p>You'll scan a QR code with your phone in the next step.</p>
      <p class="ch-hint">Make sure WhatsApp is installed and logged in on your phone.</p>
    </div></div>
    <div class="ch-form-actions"><button class="btn btn-ghost" onclick="showChannelPicker()">Back</button>
      <button class="btn btn-primary" onclick="whatsappAddAndLink()">Continue</button></div>
  </div>`);
}

async function whatsappAddAndLink() {
  showModal('<div class="ch-wizard"><div class="ch-wizard-loading">Preparing WhatsApp…</div></div>');
  const addResult = await api('/channels/add', { method: 'POST', body: { channel: 'whatsapp' } });
  if (!addResult?.ok && addResult?.error && !addResult.error.includes('already')) {
    return showModal(`<div class="ch-wizard"><div class="ch-wizard-error">Failed: ${escHtml(addResult.error)}</div>
      <div class="ch-form-actions"><button class="btn btn-ghost" onclick="startSetup_whatsapp()">Back</button></div></div>`);
  }
  showModal('<div class="ch-wizard"><div class="ch-wizard-loading">Generating QR code…</div></div>');
  const qr = await api('/channels/whatsapp/login-start', { method: 'POST', body: { force: true } });
  if (qr?.qrDataUrl) { whatsappShowQR(qr.qrDataUrl, qr.message); }
  else if (qr?.connected) { whatsappDone(); }
  else {
    showModal(`<div class="ch-wizard"><div class="ch-wizard-error">Could not generate QR code. ${escHtml(qr?.error || qr?.message || 'Gateway may not be running.')}</div>
      <div class="ch-form-actions"><button class="btn btn-ghost" onclick="startSetup_whatsapp()">Back</button>
        <button class="btn btn-primary" onclick="whatsappAddAndLink()">Retry</button></div></div>`);
  }
}

function whatsappShowQR(dataUrl: string, message: string) {
  showModal(`<div class="ch-wizard">
    <div class="ch-wizard-steps"><span class="ch-step done">1. Add Config</span><span class="ch-step active">2. Scan QR</span><span class="ch-step">3. Done</span></div>
    <h3>Scan QR Code</h3>
    <div class="ch-qr-container"><img src="${dataUrl}" alt="WhatsApp QR Code" class="ch-qr-img"></div>
    <div class="ch-instructions"><ol><li>Open <strong>WhatsApp</strong> on your phone</li><li>Go to <strong>Settings → Linked Devices</strong></li>
      <li>Tap <strong>"Link a Device"</strong></li><li>Point your camera at this QR code</li></ol>
      <p class="ch-hint">${escHtml(message || 'QR expires in 2 minutes.')}</p></div>
    <div id="ch-wa-status" class="ch-wizard-loading">Waiting for scan…</div>
    <div class="ch-form-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-ghost" onclick="whatsappAddAndLink()">New QR</button></div>
  </div>`);
  whatsappWaitForScan();
}

async function whatsappWaitForScan() {
  const statusEl = document.getElementById('ch-wa-status');
  try {
    const result = await api('/channels/whatsapp/login-wait', { method: 'POST', body: { timeoutMs: 120000 } });
    if (result?.connected) {
      await api('/channels/bind', { method: 'POST', body: { agentId: 'main', channel: 'whatsapp' } }).catch(() => {});
      await api('/channels/config-set', { method: 'POST', body: { path: 'channels.whatsapp.dmPolicy', value: 'allowlist' } }).catch(() => {});
      whatsappDone();
    } else {
      if (statusEl) {statusEl.innerHTML = `<span class="ch-error">Scan timed out or failed. <a href="#" onclick="whatsappAddAndLink(); return false;">Try again</a></span>`;}
    }
  } catch {
    if (statusEl) {statusEl.innerHTML = `<span class="ch-error">Connection error. <a href="#" onclick="whatsappAddAndLink(); return false;">Retry</a></span>`;}
  }
}

function whatsappDone() {
  showModal(`<div class="ch-wizard">
    <div class="ch-wizard-steps"><span class="ch-step done">1. Add Config</span><span class="ch-step done">2. Scan QR</span><span class="ch-step active">3. Done</span></div>
    <div class="ch-wizard-success"><span class="ch-success-icon">&#10003;</span><h3>WhatsApp Linked</h3>
      <p>Your WhatsApp is connected and bound to Branson.</p>
      <p class="ch-hint">Only phone numbers you add to the allowlist can chat. Go to Channel Settings to add your number.</p></div>
    <div class="ch-form-actions"><button class="btn btn-primary" onclick="closeModal(); loadChannels();">Done</button></div>
  </div>`);
}

// Expose on window
(window as any).showChannelPicker = showChannelPicker;
(window as any).startSetup_discord = startSetup_discord;
(window as any).discordStep2 = discordStep2;
(window as any).discordSubmit = discordSubmit;
(window as any).startSetup_telegram = startSetup_telegram;
(window as any).telegramStep2 = telegramStep2;
(window as any).telegramSubmit = telegramSubmit;
(window as any).startSetup_slack = startSetup_slack;
(window as any).slackStep2 = slackStep2;
(window as any).slackSubmit = slackSubmit;
(window as any).startSetup_whatsapp = startSetup_whatsapp;
(window as any).whatsappAddAndLink = whatsappAddAndLink;
(window as any).whatsappDone = whatsappDone;
