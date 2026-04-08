// Config Providers — AI provider card management, key storage, Codex OAuth.
// Called from config-view.ts. Exposed on window.

const api = (window as any).api as (url: string, opts?: any) => Promise<any>;
const showToast = (window as any).showToast as (msg: string, type?: string) => void;
const showModal = (window as any).showModal as (html: string, cls?: string) => void;
const closeModal = (window as any).closeModal as () => void;
const escHtml = (window as any).escHtml as (s: string) => string;

const LLM_PROVIDERS = [
  { id: 'ANTHROPIC_API_KEY', name: 'Anthropic', desc: 'Direct access to Claude models', color: '#D4A574',
    logo: '<svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M13.827 3.52h3.603L24 20.48h-3.603l-6.57-16.96zm-7.258 0H10.172L16.74 20.48H13.14L11.06 15.1H5.56l-2.07 5.38H0L6.569 3.52zm4.132 8.9L8.24 6.38 5.78 12.42h4.92z"/></svg>',
    helpUrl: 'https://console.anthropic.com/settings/keys' },
  { id: 'OPENROUTER_API_KEY', name: 'OpenRouter', desc: 'Hundreds of models via one API key', color: '#6466F1',
    logo: '<svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>',
    helpUrl: 'https://openrouter.ai/settings/keys' },
  { id: 'OPENAI_API_KEY', name: 'OpenAI', desc: 'Text embeddings for knowledge search', color: '#10A37F',
    logo: '<svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.998 5.998 0 0 0-3.998 2.9 6.042 6.042 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073z"/></svg>',
    helpUrl: 'https://platform.openai.com/api-keys' },
];

export async function renderAIProviders() {
  const el = document.getElementById('config-providers');
  if (!el) { return; }
  let storedKeys: string[] = [];
  try { const status = await api('/providers/status'); storedKeys = status?.stored || []; } catch {}
  const LLM_KEY_IDS = new Set(['ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY']);
  let codexStatus: any = { connected: false };
  try { codexStatus = await api('/providers/oauth/codex/status') || { connected: false }; } catch {}

  el.innerHTML = `
    <div class="config-section">
      <h3 class="config-section-title">AI Providers</h3>
      <div class="config-note" style="margin-bottom:12px">You manage your own accounts with each provider. API keys are stored locally on this machine only.</div>
      <div class="provider-list">
        ${LLM_PROVIDERS.map(p => {
          const stored = storedKeys.includes(p.id);
          const isActive = stored && (LLM_KEY_IDS.has(p.id) || p.id === 'OPENAI_API_KEY');
          return `<div class="provider-card ${stored ? 'provider-connected' : ''}">
            <div class="provider-logo" style="background:${p.color}">${p.logo}</div>
            <div class="provider-info"><div class="provider-name">${escHtml(p.name)}${isActive ? ' <span class="provider-active-badge">active</span>' : ''}</div><div class="provider-desc">${escHtml(p.desc)}</div></div>
            <div class="provider-actions">${stored
              ? `<span class="provider-status connected">Connected</span><button class="btn btn-ghost btn-xs" onclick="updateProviderKey('${p.id}', '${escHtml(p.name)}')">Update Key</button>`
              : `<button class="btn btn-primary btn-xs" onclick="addProviderKey('${p.id}', '${escHtml(p.name)}', '${p.helpUrl}')">Add Key</button>`
            }</div></div>`;
        }).join('')}
        <div class="provider-card ${codexStatus.connected ? 'provider-connected' : ''}">
          <div class="provider-logo" style="background:#10A37F"><svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.998 5.998 0 0 0-3.998 2.9 6.042 6.042 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073z"/></svg></div>
          <div class="provider-info"><div class="provider-name">ChatGPT / Codex${codexStatus.connected ? ' <span class="provider-active-badge">connected</span>' : ''}</div><div class="provider-desc">Use your ChatGPT Pro subscription for Codex models — no API key needed</div></div>
          <div class="provider-actions">${codexStatus.connected
            ? `<span class="provider-status connected">${codexStatus.expired ? 'Expired — reconnect' : 'Connected'}</span><button class="btn btn-ghost btn-xs" onclick="connectCodex()">Reconnect</button>`
            : '<button class="btn btn-primary btn-xs" onclick="connectCodex()">Connect ChatGPT</button>'
          }</div></div>
      </div>
    </div>
  `;
}

function showProviderKeyModal(serviceId: string, serviceName: string, helpUrl: string, isUpdate: boolean) {
  const title = isUpdate ? `Update ${serviceName} Key` : `Add ${serviceName} Key`;
  const helpLink = helpUrl ? `<a href="${escHtml(helpUrl)}" target="_blank" rel="noopener" class="provider-help-link">Get your API key here &rarr;</a>` : '';
  showModal(`<div class="provider-key-modal">
    <h2>${title}</h2>
    <p class="provider-key-desc">Paste your ${escHtml(serviceName)} API key below. This key is stored locally on this machine only — we never see it.</p>
    ${helpLink}
    <input type="password" id="provider-key-input" class="provider-key-input" placeholder="Paste API key here..." autocomplete="off" spellcheck="false">
    <div class="provider-key-toggle"><button type="button" class="btn btn-ghost btn-xs" onclick="toggleProviderKeyVis()">Show key</button></div>
    <div id="provider-key-error" class="provider-key-error"></div>
    <div class="provider-key-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="provider-key-save" onclick="saveProviderKey('${serviceId}', '${escHtml(serviceName)}')">Save Key</button>
    </div>
  </div>`);
  setTimeout(() => (document.getElementById('provider-key-input') as HTMLInputElement)?.focus(), 50);
}

function toggleProviderKeyVis() {
  const inp = document.getElementById('provider-key-input') as HTMLInputElement;
  if (!inp) { return; }
  inp.type = inp.type === 'password' ? 'text' : 'password';
}

async function saveProviderKey(serviceId: string, serviceName: string) {
  const inp = document.getElementById('provider-key-input') as HTMLInputElement;
  const errEl = document.getElementById('provider-key-error');
  const btn = document.getElementById('provider-key-save') as HTMLButtonElement;
  if (!inp) { return; }
  const key = inp.value.trim();
  if (!key) { if (errEl) { errEl.textContent = 'Please paste an API key'; } return; }
  if (btn) { btn.textContent = 'Saving...'; btn.disabled = true; }
  const res = await api('/providers/store-key', { method: 'POST', body: { serviceId, key } });
  if (res?.success) {
    await api('/providers/sync-credentials', { method: 'POST' });
    closeModal();
    showToast(`${serviceName} key saved`);
    renderAIProviders();
  } else {
    if (errEl) { errEl.textContent = res?.error || 'Failed to save key'; }
    if (btn) { btn.textContent = 'Save Key'; btn.disabled = false; }
  }
}

async function connectCodex() {
  showToast('Starting ChatGPT login — a browser window will open...');
  const res = await api('/providers/oauth/codex/start', { method: 'POST' });
  if (res?.authUrl) {
    window.open(res.authUrl, '_blank', 'width=500,height=700');
    showToast('Complete login in the browser window, then come back here');
    let attempts = 0;
    const poll = setInterval(async () => {
      attempts++;
      const status = await api('/providers/oauth/codex/status');
      if (status?.connected) { clearInterval(poll); showToast('ChatGPT/Codex connected'); renderAIProviders(); }
      if (attempts > 40) { clearInterval(poll); }
    }, 3000);
  } else { showToast('Login started — check if a browser window opened automatically'); }
}

// Expose on window
(window as any).renderAIProviders = renderAIProviders;
(window as any).addProviderKey = (id: string, name: string, url: string) => showProviderKeyModal(id, name, url, false);
(window as any).updateProviderKey = (id: string, name: string) => showProviderKeyModal(id, name, '', true);
(window as any).toggleProviderKeyVis = toggleProviderKeyVis;
(window as any).saveProviderKey = saveProviderKey;
(window as any).connectCodex = connectCodex;
