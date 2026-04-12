// ─── Routes: Provider Key Management + Credential Sync ──────
// Bridges secrets.enc → shared auth-profiles.json (merge, not overwrite).
// Does NOT touch openclaw.json model refs — only credential storage.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SECRETS_PY_PATH = path.join(__dirname, '../../scripts/lib/secrets.py');
const CANONICAL_AUTH = path.join(__dirname, '../../../.openclaw/agents/main/agent/auth-profiles.json');
const SYNC_SCRIPT = path.join(__dirname, '../../scripts/sync-auth-profiles.sh');

// Read a secret value via secrets.py load (outputs "export KEY='value'")
function loadSecretValue(secretId) {
  try {
    const out = execFileSync('python3', [SECRETS_PY_PATH, 'load', secretId], {
      encoding: 'utf8', timeout: 5000,
    }).trim();
    const match = out.match(/^export\s+\S+=(?:'([^']*)'|"([^"]*)"|(\S+))$/m);
    return match ? (match[1] ?? match[2] ?? match[3]) : null;
  } catch { return null; }
}

const SECRET_TO_PROFILE = {
  ANTHROPIC_API_KEY: { profileId: 'anthropic:default', provider: 'anthropic' },
  OPENROUTER_API_KEY: { profileId: 'openrouter:default', provider: 'openrouter' },
  OPENAI_API_KEY: { profileId: 'openai:default', provider: 'openai' },
  BRAVE_API_KEY: { profileId: 'brave:default', provider: 'brave' },
  DISCORD_BOT_TOKEN: { profileId: 'discord:default', provider: 'discord' },
};

module.exports = function(app) {

// List stored provider keys (names only, not values)
app.get('/api/providers/status', (req, res) => {
  try {
    const out = execFileSync('python3', [SECRETS_PY_PATH, 'list'], {
      encoding: 'utf8', timeout: 5000,
    });
    const stored = out.trim().split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.includes(' ') && l === l.toUpperCase());
    res.json({ stored });
  } catch {
    res.json({ stored: [] });
  }
});

// Store/update a provider API key (post-onboarding, requires auth session)
app.post('/api/providers/store-key', (req, res) => {
  const { serviceId, key } = req.body;
  if (!serviceId || !key) return res.status(400).json({ error: 'serviceId and key required' });

  const ALLOWED_SERVICES = Object.keys(SECRET_TO_PROFILE);
  if (!ALLOWED_SERVICES.includes(serviceId)) {
    return res.status(400).json({ error: 'Unknown service' });
  }

  try {
    execFileSync('python3', [SECRETS_PY_PATH, 'store', serviceId, key], { timeout: 10000 });
    res.json({ success: true, serviceId });
  } catch (err) {
    res.status(500).json({ error: 'Failed to store key', detail: err.message });
  }
});

// Sync secrets.enc → shared auth-profiles.json
app.post('/api/providers/sync-credentials', (req, res) => {
  try {
    // Load existing store — preserve everything we don't explicitly update
    let store = { version: 1, profiles: {}, lastGood: {}, usageStats: {} };
    try {
      if (fs.existsSync(CANONICAL_AUTH)) {
        store = JSON.parse(fs.readFileSync(CANONICAL_AUTH, 'utf8'));
      }
    } catch {}

    let updated = 0;
    for (const [secretId, { profileId, provider }] of Object.entries(SECRET_TO_PROFILE)) {
      const value = loadSecretValue(secretId);
      if (!value) continue;

      store.profiles[profileId] = { type: 'api_key', provider, key: value };
      if (!store.lastGood) store.lastGood = {};
      store.lastGood[provider] = profileId;
      updated++;
    }

    if (updated > 0) {
      fs.writeFileSync(CANONICAL_AUTH, JSON.stringify(store, null, 2), { mode: 0o600 });
    }

    // Ensure symlinks exist
    try {
      execFileSync('bash', [SYNC_SCRIPT], { timeout: 10000, encoding: 'utf8' });
    } catch {}

    // Ensure providers are registered in openclaw.json auth.profiles
    try {
      const ocPath = path.join(__dirname, '../../../.openclaw/openclaw.json');
      const oc = JSON.parse(fs.readFileSync(ocPath, 'utf8'));
      if (!oc.auth) oc.auth = {};
      if (!oc.auth.profiles) oc.auth.profiles = {};
      let ocChanged = false;
      for (const [, { profileId, provider }] of Object.entries(SECRET_TO_PROFILE)) {
        if (store.profiles[profileId] && !oc.auth.profiles[profileId]) {
          oc.auth.profiles[profileId] = { provider, mode: 'api_key' };
          ocChanged = true;
        }
      }

      // Write Brave API key to the config path the web search provider reads
      // (v2026.4.1 moved from tools.web.search.apiKey → plugins.entries.brave.config.webSearch.apiKey)
      const braveKey = store.profiles['brave:default']?.key;
      if (braveKey) {
        if (!oc.plugins) oc.plugins = {};
        if (!oc.plugins.entries) oc.plugins.entries = {};
        if (!oc.plugins.entries.brave) oc.plugins.entries.brave = { enabled: true };
        if (!oc.plugins.entries.brave.config) oc.plugins.entries.brave.config = {};
        if (!oc.plugins.entries.brave.config.webSearch) oc.plugins.entries.brave.config.webSearch = {};
        if (oc.plugins.entries.brave.config.webSearch.apiKey !== braveKey) {
          oc.plugins.entries.brave.config.webSearch.apiKey = braveKey;
          ocChanged = true;
        }
      }

      if (ocChanged) {
        fs.writeFileSync(ocPath, JSON.stringify(oc, null, 2));
      }
    } catch {}

    res.json({ success: true, profilesUpdated: updated });
  } catch (err) {
    res.status(500).json({ error: 'Credential sync failed', detail: err.message });
  }
});

// ─── Codex OAuth (delegates to OpenClaw CLI via expect PTY) ──
// CLI requires a TTY. We use /usr/bin/expect to provide one.

const { spawn } = require('child_process');
let _codexLoginProcess = null;

app.post('/api/providers/oauth/codex/start', (req, res) => {
  if (_codexLoginProcess) { try { _codexLoginProcess.kill(); } catch {} }

  const env = {
    ...process.env,
    PATH: `/opt/homebrew/bin:/opt/homebrew/sbin:${process.env.PATH || '/usr/bin:/bin'}`,
    OPENCLAW_STATE_DIR: '/opt/AIWH/.openclaw',
  };

  // expect script: spawn CLI, wait for URL, keep running for callback
  const expectScript = `
    spawn /opt/homebrew/bin/openclaw models auth login --provider openai-codex
    set timeout 120
    expect {
      -re {(https://auth\\.openai\\.com/oauth/authorize\\?[^ \\r\\n\\x1b]+)} {
        set url $expect_out(1,string)
        puts "AUTH_URL:$url"
        # Keep waiting for CLI to finish (callback will complete it)
        expect eof
      }
      timeout { puts "AUTH_URL:TIMEOUT"; exit 1 }
      eof { puts "AUTH_URL:EOF"; exit 1 }
    }
  `;

  _codexLoginProcess = spawn('/usr/bin/expect', ['-f', '-'], {
    env, stdio: ['pipe', 'pipe', 'pipe'],
  });
  _codexLoginProcess.stdin.write(expectScript);
  _codexLoginProcess.stdin.end();

  let output = '';
  let responded = false;

  const onData = (data) => {
    output += data.toString();
    if (!responded) {
      const match = output.match(/AUTH_URL:(https:\/\/auth\.openai\.com\/[^\s\r\n]+)/);
      if (match) {
        responded = true;
        res.json({ success: true, authUrl: match[1] });
      } else if (output.includes('AUTH_URL:TIMEOUT') || output.includes('AUTH_URL:EOF')) {
        responded = true;
        res.json({ success: false, error: 'CLI failed to produce auth URL' });
      }
    }
  };

  _codexLoginProcess.stdout.on('data', onData);
  _codexLoginProcess.stderr.on('data', onData);

  setTimeout(() => {
    if (!responded) {
      responded = true;
      res.json({ success: false, error: 'Timeout waiting for auth URL' });
    }
  }, 10000);

  _codexLoginProcess.on('close', (code) => {
    console.log(`[codex-oauth] CLI exited with code ${code}`);
    _codexLoginProcess = null;
  });
});

// Check Codex OAuth status (reads from credentials/oauth.json where OpenClaw CLI writes)
app.get('/api/providers/oauth/codex/status', (req, res) => {
  const oauthPath = path.join(__dirname, '../../../.openclaw/credentials/oauth.json');
  try {
    const oauthFile = JSON.parse(fs.readFileSync(oauthPath, 'utf8'));
    const codex = oauthFile['openai-codex'];
    if (codex?.access) {
      const expired = codex.expires && codex.expires < Date.now();
      res.json({ connected: true, expired, accountId: codex.accountId || null });
    } else {
      res.json({ connected: false });
    }
  } catch {
    res.json({ connected: false });
  }
});

};
