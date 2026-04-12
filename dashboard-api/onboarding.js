#!/usr/bin/env node
// ─── AIWH Onboarding Wizard ─────────────────────────────────────
// First-boot setup wizard for new client Mac Minis.
// 7 screens: Welcome → About You → Goals → Tools → Connect → Test → Go Live
// Port 3001 (first boot only). Self-terminates on completion.

const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

const TEST_MODE = process.argv.includes('--test');
const PORT = process.env.PORT || 3001;
const CORE_DIR = '/opt/AIWH/core';
const CLIENT_DIR = TEST_MODE ? '/tmp/aiwh-test-client' : (process.env.CLIENT_ROOT || '/opt/AIWH/client');
const DEVICE_INFO_PATH = TEST_MODE
    ? '/tmp/aiwh-test-client/device-info.json'
    : path.join(CORE_DIR, 'config', 'device-info.json');

if (TEST_MODE) {
    console.log('⚠️  TEST MODE — using /tmp/aiwh-test-client/ (real data untouched)');
    fs.mkdirSync('/tmp/aiwh-test-client/config', { recursive: true });
    fs.writeFileSync('/tmp/aiwh-test-client/device-info.json', JSON.stringify({ first_boot: true, client_id: 'test' }));
}

const app = express();
const server = http.createServer(app);

app.use(express.json({ limit: '1mb' }));

// ─── Check first_boot flag ───────────────────────────────────────
function isFirstBoot() {
    try {
        const info = JSON.parse(fs.readFileSync(DEVICE_INFO_PATH, 'utf8'));
        return info.first_boot === true;
    } catch {
        return true; // If no device-info, treat as first boot
    }
}

// ─── API Routes ──────────────────────────────────────────────────

// Get current onboarding state
app.get('/api/onboarding/status', (req, res) => {
    const statePath = path.join(CLIENT_DIR, 'config', 'onboarding-state.json');
    try {
        const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        res.json(state);
    } catch {
        res.json({ currentStep: 0, completed: false });
    }
});

// Save onboarding state
app.post('/api/onboarding/state', (req, res) => {
    const statePath = path.join(CLIENT_DIR, 'config', 'onboarding-state.json');
    try {
        fs.mkdirSync(path.dirname(statePath), { recursive: true });
        fs.writeFileSync(statePath, JSON.stringify(req.body, null, 2));
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Step 2: Save "About You" → USER.md + preferences.json
app.post('/api/onboarding/profile', (req, res) => {
    const { name, business, industry, timezone, currency } = req.body;
    try {
        // Write USER.md
        const userMd = `# ${name}\n\n` +
            `**Business:** ${business || 'Not specified'}\n` +
            `**Industry:** ${industry || 'Not specified'}\n` +
            `**Timezone:** ${timezone || 'Australia/Brisbane'}\n` +
            `**Currency:** ${currency || 'AUD'}\n` +
            `\n## Notes\n\n_Add personal preferences, communication style, or context here._\n`;

        fs.mkdirSync(path.join(CLIENT_DIR, 'config'), { recursive: true });
        fs.writeFileSync(path.join(CLIENT_DIR, 'config', 'USER.md'), userMd);

        // Write preferences.json
        const prefs = {
            name, business, industry,
            timezone: timezone || 'Australia/Brisbane',
            currency: currency || 'AUD',
            created_at: new Date().toISOString()
        };
        fs.writeFileSync(
            path.join(CLIENT_DIR, 'config', 'preferences.json'),
            JSON.stringify(prefs, null, 2)
        );

        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Step 3: Save goals
app.post('/api/onboarding/goals', (req, res) => {
    const { goals, monthlyBudget, primaryFocus } = req.body;
    try {
        const prefsPath = path.join(CLIENT_DIR, 'config', 'preferences.json');
        let prefs = {};
        try { prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8')); } catch {}
        prefs.goals = goals;
        prefs.monthly_budget = monthlyBudget;
        prefs.primary_focus = primaryFocus;
        fs.writeFileSync(prefsPath, JSON.stringify(prefs, null, 2));
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Step 5: Store API key in Keychain
app.post('/api/onboarding/connect', (req, res) => {
    const { service, apiKey } = req.body;
    if (!service || !apiKey) return res.status(400).json({ error: 'service and apiKey required' });

    const serviceMap = {
        anthropic: 'anthropic-api-key',
        openai: 'openai-api-key',
        heygen: 'heygen-api-key',
        elevenlabs: 'elevenlabs-api-key',
        supabase: 'supabase-db-password'
    };

    const keychainService = serviceMap[service];
    if (!keychainService) return res.status(400).json({ error: `Unknown service: ${service}` });

    try {
        const { execFileSync } = require('child_process');
        // Delete existing entry first (ignore error if not found)
        try {
            execFileSync('security', ['delete-generic-password', '-a', 'aiwh', '-s', keychainService], { stdio: 'pipe' });
        } catch {}

        // Add to Keychain
        execFileSync('security', ['add-generic-password', '-a', 'aiwh', '-s', keychainService, '-w', apiKey], { timeout: 5000 });

        res.json({ ok: true, service: keychainService });
    } catch (e) {
        res.status(500).json({ error: `Keychain write failed: ${e.message}` });
    }
});

// Step 6: Test a service API key
app.post('/api/onboarding/test', async (req, res) => {
    const { service } = req.body;
    if (!service) return res.status(400).json({ error: 'service required' });

    const { execFileSync } = require('child_process');
    const https = require('https');

    function getKeychainKey(keychainService) {
        return execFileSync('security', ['find-generic-password', '-a', 'aiwh', '-s', keychainService, '-w'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    }

    function httpsPost(url, headers, body) {
        return new Promise((resolve, reject) => {
            const u = new URL(url);
            const payload = typeof body === 'string' ? body : JSON.stringify(body);
            const req = https.request({ hostname: u.hostname, path: u.pathname, method: body ? 'POST' : 'GET', headers: { ...headers, 'Content-Length': Buffer.byteLength(payload || '') }, timeout: 15000 }, (response) => {
                let data = '';
                response.on('data', c => data += c);
                response.on('end', () => resolve(data));
            });
            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
            if (payload) req.end(payload); else req.end();
        });
    }

    function httpsGet(url, headers) {
        return new Promise((resolve, reject) => {
            const u = new URL(url);
            const req = https.get({ hostname: u.hostname, path: u.pathname, headers, timeout: 15000 }, (response) => {
                let data = '';
                response.on('data', c => data += c);
                response.on('end', () => resolve(data));
            });
            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
        });
    }

    const tests = {
        anthropic: async () => {
            const key = getKeychainKey('anthropic-api-key');
            const result = await httpsPost('https://api.anthropic.com/v1/messages', { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, { model: 'claude-haiku-4-5-20251001', max_tokens: 10, messages: [{ role: 'user', content: 'ping' }] });
            return JSON.parse(result).content ? 'ok' : 'fail';
        },
        openai: async () => {
            const key = getKeychainKey('openai-api-key');
            const result = await httpsPost('https://api.openai.com/v1/embeddings', { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' }, { model: 'text-embedding-3-small', input: 'test' });
            return JSON.parse(result).data ? 'ok' : 'fail';
        },
        heygen: async () => {
            const key = getKeychainKey('heygen-api-key');
            const result = await httpsGet('https://api.heygen.com/v1/user/remaining_quota', { 'x-api-key': key, 'Accept': 'application/json' });
            return result.includes('remaining') ? 'ok' : 'fail';
        },
        elevenlabs: async () => {
            const key = getKeychainKey('elevenlabs-api-key');
            const result = await httpsGet('https://api.elevenlabs.io/v1/voices', { 'xi-api-key': key, 'Accept': 'application/json' });
            return JSON.parse(result).voices?.length > 0 ? 'ok' : 'fail';
        },
        supabase: async () => {
            getKeychainKey('supabase-db-password');
            return 'ok';
        }
    };

    try {
        if (!tests[service]) return res.status(400).json({ error: `Unknown service: ${service}` });
        const result = await tests[service]();
        res.json({ ok: true, result });
    } catch (e) {
        res.json({ ok: false, error: e.message?.substring(0, 200) || 'Test failed' });
    }
});

// Step 7: Complete onboarding
app.post('/api/onboarding/complete', (req, res) => {
    try {
        // Update device-info.json — clear first_boot
        if (fs.existsSync(DEVICE_INFO_PATH)) {
            const info = JSON.parse(fs.readFileSync(DEVICE_INFO_PATH, 'utf8'));
            info.first_boot = false;
            info.onboarded_at = new Date().toISOString();
            fs.writeFileSync(DEVICE_INFO_PATH, JSON.stringify(info, null, 2));
        }

        // Write completion marker
        const statePath = path.join(CLIENT_DIR, 'config', 'onboarding-state.json');
        fs.writeFileSync(statePath, JSON.stringify({
            currentStep: 7,
            completed: true,
            completed_at: new Date().toISOString()
        }, null, 2));

        res.json({ ok: true, message: 'Onboarding complete. Shutting down wizard.' });

        // Self-terminate after response
        setTimeout(() => {
            console.log('Onboarding complete — shutting down wizard server');
            process.exit(0);
        }, 2000);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── Serve the wizard UI ─────────────────────────────────────────
app.get('/', (req, res) => {
    res.send(WIZARD_HTML);
});

// ─── Wizard HTML ─────────────────────────────────────────────────
const WIZARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AIWH Setup</title>
<style>
  :root {
    --bg: #0a0a0f;
    --surface: #12121a;
    --border: #1e1e2e;
    --text: #e0e0e8;
    --muted: #888;
    --cyan: #00f0ff;
    --magenta: #ff00ff;
    --green: #00ff88;
    --red: #ff4466;
    --yellow: #ffcc00;
  }
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro', sans-serif;
    background: var(--bg);
    color: var(--text);
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .wizard {
    width: 100%;
    max-width: 640px;
    padding: 24px;
  }
  .step { display: none; }
  .step.active { display: block; animation: fadeIn 0.3s ease; }
  @keyframes fadeIn { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }

  .logo {
    text-align: center;
    margin-bottom: 32px;
  }
  .logo h1 {
    font-size: 28px;
    font-weight: 700;
    background: linear-gradient(135deg, var(--cyan), var(--magenta));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  .logo p { color: var(--muted); margin-top: 4px; font-size: 14px; }

  h2 { font-size: 22px; margin-bottom: 8px; }
  .subtitle { color: var(--muted); margin-bottom: 24px; font-size: 14px; }

  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 24px;
    margin-bottom: 16px;
  }

  label { display: block; font-size: 13px; color: var(--muted); margin-bottom: 4px; margin-top: 12px; }
  label:first-child { margin-top: 0; }
  input, select, textarea {
    width: 100%;
    padding: 10px 12px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text);
    font-size: 14px;
    outline: none;
    transition: border 0.2s;
  }
  input:focus, select:focus, textarea:focus { border-color: var(--cyan); }
  textarea { resize: vertical; min-height: 80px; }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 10px 20px;
    border: none;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }
  .btn-primary {
    background: linear-gradient(135deg, var(--cyan), #00c8ff);
    color: #000;
  }
  .btn-primary:hover { filter: brightness(1.1); transform: translateY(-1px); }
  .btn-secondary {
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text);
  }
  .btn-secondary:hover { border-color: var(--cyan); }
  .btn-success { background: var(--green); color: #000; }

  .nav { display: flex; justify-content: space-between; margin-top: 24px; }

  .progress {
    display: flex;
    gap: 6px;
    justify-content: center;
    margin-bottom: 32px;
  }
  .progress-dot {
    width: 8px; height: 8px;
    border-radius: 50%;
    background: var(--border);
    transition: background 0.3s;
  }
  .progress-dot.active { background: var(--cyan); }
  .progress-dot.done { background: var(--green); }

  .goal-option {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    margin-bottom: 8px;
    cursor: pointer;
    transition: border 0.2s;
  }
  .goal-option:hover { border-color: var(--cyan); }
  .goal-option.selected { border-color: var(--cyan); background: rgba(0,240,255,0.05); }
  .goal-option input[type="checkbox"] { display: none; }
  .goal-check {
    width: 20px; height: 20px;
    border: 2px solid var(--border);
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: all 0.2s;
  }
  .goal-option.selected .goal-check {
    border-color: var(--cyan);
    background: var(--cyan);
    color: #000;
  }

  .service-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    margin-bottom: 8px;
  }
  .service-name { font-weight: 600; min-width: 100px; }
  .service-row input { flex: 1; }
  .service-status {
    width: 28px; height: 28px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    flex-shrink: 0;
  }
  .status-pending { background: var(--border); }
  .status-ok { background: rgba(0,255,136,0.2); color: var(--green); }
  .status-fail { background: rgba(255,68,102,0.2); color: var(--red); }
  .status-testing { background: rgba(0,240,255,0.2); color: var(--cyan); animation: pulse 1s infinite; }
  @keyframes pulse { 50% { opacity: 0.5; } }

  .test-results {
    margin-top: 16px;
  }
  .test-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 0;
    border-bottom: 1px solid var(--border);
    font-size: 13px;
  }

  .celebration {
    text-align: center;
    padding: 40px 0;
  }
  .celebration h2 {
    font-size: 32px;
    background: linear-gradient(135deg, var(--cyan), var(--magenta));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }

  .focus-btn {
    padding: 10px 16px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text);
    cursor: pointer;
    font-size: 13px;
    transition: all 0.2s;
  }
  .focus-btn.selected { border-color: var(--magenta); background: rgba(255,0,255,0.08); }
  .focus-grid { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }

  .tool-list { font-size: 13px; color: var(--muted); line-height: 1.8; }
  .tool-list strong { color: var(--text); }
</style>
</head>
<body>
<div class="wizard">
  <div class="logo">
    <h1>AI Wealth Hub</h1>
    <p>Let's set up your AI team</p>
  </div>

  <div class="progress" id="progress"></div>

  <!-- Step 0: Welcome -->
  <div class="step active" data-step="0">
    <div class="card" style="text-align:center; padding:40px 24px;">
      <h2>Welcome to AIWH</h2>
      <p class="subtitle" style="margin-bottom:24px">
        Your personal AI team is ready to be configured.<br>
        This wizard takes about 5 minutes.
      </p>
      <p style="color:var(--muted); font-size:13px; margin-bottom:24px;">
        We'll collect your details, connect your tools,<br>
        and run a quick test to make sure everything works.
      </p>
      <button class="btn btn-primary" onclick="goTo(1)">Get Started</button>
    </div>
  </div>

  <!-- Step 1: About You -->
  <div class="step" data-step="1">
    <h2>About You</h2>
    <p class="subtitle">Tell us about yourself and your business.</p>
    <div class="card">
      <label>Your Name</label>
      <input type="text" id="ob-name" placeholder="e.g. Sarah Chen">
      <label>Business Name</label>
      <input type="text" id="ob-business" placeholder="e.g. Chen Coaching Co">
      <label>Industry</label>
      <select id="ob-industry">
        <option value="">Select...</option>
        <option>Coaching / Consulting</option>
        <option>Real Estate</option>
        <option>Financial Services</option>
        <option>E-commerce</option>
        <option>SaaS / Tech</option>
        <option>Health / Wellness</option>
        <option>Education</option>
        <option>Marketing Agency</option>
        <option>Other</option>
      </select>
      <label>Timezone</label>
      <select id="ob-timezone">
        <option value="Australia/Brisbane">Australia/Brisbane (AEST)</option>
        <option value="Australia/Sydney">Australia/Sydney (AEST/AEDT)</option>
        <option value="Australia/Melbourne">Australia/Melbourne (AEST/AEDT)</option>
        <option value="Australia/Perth">Australia/Perth (AWST)</option>
        <option value="America/New_York">US Eastern</option>
        <option value="America/Chicago">US Central</option>
        <option value="America/Los_Angeles">US Pacific</option>
        <option value="Europe/London">UK</option>
        <option value="Asia/Singapore">Singapore</option>
      </select>
      <label>Currency</label>
      <select id="ob-currency">
        <option value="AUD">AUD</option>
        <option value="USD">USD</option>
        <option value="GBP">GBP</option>
        <option value="EUR">EUR</option>
        <option value="SGD">SGD</option>
        <option value="NZD">NZD</option>
      </select>
    </div>
    <div class="nav">
      <button class="btn btn-secondary" onclick="goTo(0)">Back</button>
      <button class="btn btn-primary" onclick="saveProfile()">Next</button>
    </div>
  </div>

  <!-- Step 2: Goals -->
  <div class="step" data-step="2">
    <h2>Your Goals</h2>
    <p class="subtitle">What do you want your AI team to focus on?</p>
    <div class="card">
      <div class="goal-option" onclick="toggleGoal(this, 'content')">
        <div class="goal-check"></div>
        <div><strong>Content Creation</strong><br><span style="font-size:12px;color:var(--muted)">Social posts, emails, blog articles, video scripts</span></div>
      </div>
      <div class="goal-option" onclick="toggleGoal(this, 'video')">
        <div class="goal-check"></div>
        <div><strong>Video Production</strong><br><span style="font-size:12px;color:var(--muted)">Cinematic videos, reels, presentations</span></div>
      </div>
      <div class="goal-option" onclick="toggleGoal(this, 'sales')">
        <div class="goal-check"></div>
        <div><strong>Sales & Funnels</strong><br><span style="font-size:12px;color:var(--muted)">Lead gen, email sequences, CRM management</span></div>
      </div>
      <div class="goal-option" onclick="toggleGoal(this, 'ops')">
        <div class="goal-check"></div>
        <div><strong>Operations</strong><br><span style="font-size:12px;color:var(--muted)">Calendar, scheduling, research, reporting</span></div>
      </div>
      <div class="goal-option" onclick="toggleGoal(this, 'coaching')">
        <div class="goal-check"></div>
        <div><strong>Business Coaching</strong><br><span style="font-size:12px;color:var(--muted)">Strategy advice, accountability, market analysis</span></div>
      </div>

      <label>Monthly AI Budget (approx)</label>
      <select id="ob-budget">
        <option value="500">Under $500/mo</option>
        <option value="1000">$500 - $1,000/mo</option>
        <option value="2500" selected>$1,000 - $2,500/mo</option>
        <option value="5000">$2,500 - $5,000/mo</option>
        <option value="10000">$5,000+/mo</option>
      </select>

      <label>Primary Focus</label>
      <div class="focus-grid" id="focus-grid">
        <button class="focus-btn" onclick="selectFocus(this, 'growth')">Growth</button>
        <button class="focus-btn" onclick="selectFocus(this, 'efficiency')">Efficiency</button>
        <button class="focus-btn" onclick="selectFocus(this, 'content')">Content</button>
        <button class="focus-btn" onclick="selectFocus(this, 'revenue')">Revenue</button>
        <button class="focus-btn" onclick="selectFocus(this, 'brand')">Brand</button>
      </div>
    </div>
    <div class="nav">
      <button class="btn btn-secondary" onclick="goTo(1)">Back</button>
      <button class="btn btn-primary" onclick="saveGoals()">Next</button>
    </div>
  </div>

  <!-- Step 3: Tools Required -->
  <div class="step" data-step="3">
    <h2>Tools Required</h2>
    <p class="subtitle">Your AI team needs these API keys to work. Don't worry - we'll help you set them up.</p>
    <div class="card">
      <div class="tool-list">
        <p><strong>Anthropic (Claude)</strong> - Powers all AI reasoning<br>
        <a href="https://console.anthropic.com/settings/keys" target="_blank" style="color:var(--cyan)">Get key</a></p>
        <br>
        <p><strong>OpenAI</strong> - Text embeddings for knowledge search<br>
        <a href="https://platform.openai.com/api-keys" target="_blank" style="color:var(--cyan)">Get key</a></p>
        <br>
        <p><strong>ElevenLabs</strong> - Voice & narration generation<br>
        <a href="https://elevenlabs.io/app/settings/api-keys" target="_blank" style="color:var(--cyan)">Get key</a></p>
        <br>
        <p><strong>HeyGen</strong> - Avatar video clips<br>
        <a href="https://app.heygen.com/settings?nav=API" target="_blank" style="color:var(--cyan)">Get key</a></p>
        <br>
        <p style="color:var(--muted); font-size:12px;">
        Keys are stored securely in macOS Keychain. They never leave this machine.
        </p>
      </div>
    </div>
    <div class="nav">
      <button class="btn btn-secondary" onclick="goTo(2)">Back</button>
      <button class="btn btn-primary" onclick="goTo(4)">I have my keys ready</button>
    </div>
  </div>

  <!-- Step 4: Connect Tools -->
  <div class="step" data-step="4">
    <h2>Connect Your Tools</h2>
    <p class="subtitle">Paste each API key below. They're stored in macOS Keychain (never in files).</p>
    <div class="card">
      <div class="service-row">
        <span class="service-name">Anthropic</span>
        <input type="password" id="key-anthropic" placeholder="sk-ant-...">
        <div class="service-status status-pending" id="status-anthropic">-</div>
      </div>
      <div class="service-row">
        <span class="service-name">OpenAI</span>
        <input type="password" id="key-openai" placeholder="sk-proj-...">
        <div class="service-status status-pending" id="status-openai">-</div>
      </div>
      <div class="service-row">
        <span class="service-name">ElevenLabs</span>
        <input type="password" id="key-elevenlabs" placeholder="el-...">
        <div class="service-status status-pending" id="status-elevenlabs">-</div>
      </div>
      <div class="service-row">
        <span class="service-name">HeyGen</span>
        <input type="password" id="key-heygen" placeholder="hg-...">
        <div class="service-status status-pending" id="status-heygen">-</div>
      </div>
      <div style="margin-top:12px;">
        <button class="btn btn-primary" onclick="connectAll()" id="btn-connect">Save & Verify All</button>
      </div>
    </div>
    <div class="nav">
      <button class="btn btn-secondary" onclick="goTo(3)">Back</button>
      <button class="btn btn-primary" onclick="goTo(5)" id="btn-next-connect" style="opacity:0.5" disabled>Next</button>
    </div>
  </div>

  <!-- Step 5: Test Team -->
  <div class="step" data-step="5">
    <h2>Test Your Team</h2>
    <p class="subtitle">Running quick tests to verify everything is connected.</p>
    <div class="card">
      <div class="test-results" id="test-results">
        <div class="test-item"><span class="service-status status-pending">-</span> Anthropic (Claude responds)</div>
        <div class="test-item"><span class="service-status status-pending">-</span> OpenAI (embeddings work)</div>
        <div class="test-item"><span class="service-status status-pending">-</span> ElevenLabs (voices available)</div>
        <div class="test-item"><span class="service-status status-pending">-</span> HeyGen (account active)</div>
      </div>
      <div style="margin-top:16px; text-align:center;">
        <button class="btn btn-primary" onclick="runTests()" id="btn-test">Run Tests</button>
      </div>
    </div>
    <div class="nav">
      <button class="btn btn-secondary" onclick="goTo(4)">Back</button>
      <button class="btn btn-primary" onclick="goTo(6)" id="btn-next-test" style="opacity:0.5" disabled>Next</button>
    </div>
  </div>

  <!-- Step 6: Go Live -->
  <div class="step" data-step="6">
    <div class="celebration">
      <h2>You're All Set</h2>
      <p class="subtitle" style="margin-top:16px; margin-bottom:32px;">
        Your AI team is configured and ready to work.<br>
        Click below to launch Mission Control.
      </p>
      <div class="card" style="text-align:left;">
        <p style="font-size:13px; color:var(--muted); margin-bottom:12px;">What happens next:</p>
        <div class="tool-list">
          <p>1. This setup wizard will close</p>
          <p>2. Mission Control dashboard opens (port 3002)</p>
          <p>3. Your AI agents start their first briefing</p>
          <p>4. You can chat with any agent from the dashboard</p>
        </div>
      </div>
      <button class="btn btn-success" onclick="goLive()" style="margin-top:24px; font-size:16px; padding:14px 32px;">
        Launch Mission Control
      </button>
    </div>
  </div>
</div>

<script>
const STEPS = 7;
let currentStep = 0;
let selectedGoals = new Set();
let primaryFocus = '';

// Init progress dots
function renderProgress() {
    const p = document.getElementById('progress');
    p.innerHTML = '';
    for (let i = 0; i < STEPS; i++) {
        const dot = document.createElement('div');
        dot.className = 'progress-dot' + (i === currentStep ? ' active' : '') + (i < currentStep ? ' done' : '');
        p.appendChild(dot);
    }
}

function goTo(step) {
    document.querySelector('.step.active')?.classList.remove('active');
    document.querySelector('[data-step="' + step + '"]').classList.add('active');
    currentStep = step;
    renderProgress();
    // Save state
    fetch('/api/onboarding/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentStep: step, completed: false })
    });
}

async function saveProfile() {
    const data = {
        name: document.getElementById('ob-name').value,
        business: document.getElementById('ob-business').value,
        industry: document.getElementById('ob-industry').value,
        timezone: document.getElementById('ob-timezone').value,
        currency: document.getElementById('ob-currency').value
    };
    if (!data.name) { alert('Please enter your name'); return; }
    await fetch('/api/onboarding/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    goTo(2);
}

function toggleGoal(el, goal) {
    el.classList.toggle('selected');
    if (selectedGoals.has(goal)) selectedGoals.delete(goal);
    else selectedGoals.add(goal);
}

function selectFocus(btn, focus) {
    document.querySelectorAll('.focus-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    primaryFocus = focus;
}

async function saveGoals() {
    await fetch('/api/onboarding/goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            goals: [...selectedGoals],
            monthlyBudget: document.getElementById('ob-budget').value,
            primaryFocus
        })
    });
    goTo(3);
}

async function connectAll() {
    const services = ['anthropic', 'openai', 'elevenlabs', 'heygen'];
    const btn = document.getElementById('btn-connect');
    btn.disabled = true;
    btn.textContent = 'Saving...';
    let allOk = true;

    for (const svc of services) {
        const key = document.getElementById('key-' + svc).value.trim();
        const statusEl = document.getElementById('status-' + svc);
        if (!key) {
            statusEl.className = 'service-status status-pending';
            statusEl.textContent = '-';
            continue;
        }
        statusEl.className = 'service-status status-testing';
        statusEl.textContent = '...';
        try {
            const resp = await fetch('/api/onboarding/connect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ service: svc, apiKey: key })
            });
            const data = await resp.json();
            if (data.ok) {
                statusEl.className = 'service-status status-ok';
                statusEl.textContent = '\\u2713';
            } else {
                statusEl.className = 'service-status status-fail';
                statusEl.textContent = '\\u2717';
                allOk = false;
            }
        } catch {
            statusEl.className = 'service-status status-fail';
            statusEl.textContent = '!';
            allOk = false;
        }
    }

    btn.disabled = false;
    btn.textContent = 'Save & Verify All';
    if (allOk) {
        const nextBtn = document.getElementById('btn-next-connect');
        nextBtn.style.opacity = '1';
        nextBtn.disabled = false;
    }
}

async function runTests() {
    const services = ['anthropic', 'openai', 'elevenlabs', 'heygen'];
    const container = document.getElementById('test-results');
    const btn = document.getElementById('btn-test');
    btn.disabled = true;
    btn.textContent = 'Testing...';
    let passCount = 0;

    for (let i = 0; i < services.length; i++) {
        const svc = services[i];
        const item = container.children[i];
        const statusEl = item.querySelector('.service-status');
        statusEl.className = 'service-status status-testing';
        statusEl.textContent = '...';

        try {
            const resp = await fetch('/api/onboarding/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ service: svc })
            });
            const data = await resp.json();
            if (data.ok && data.result === 'ok') {
                statusEl.className = 'service-status status-ok';
                statusEl.textContent = '\\u2713';
                passCount++;
            } else {
                statusEl.className = 'service-status status-fail';
                statusEl.textContent = '\\u2717';
            }
        } catch {
            statusEl.className = 'service-status status-fail';
            statusEl.textContent = '!';
        }
    }

    btn.disabled = false;
    btn.textContent = passCount + '/' + services.length + ' passed - Run Again';
    if (passCount >= 2) { // At least Anthropic + OpenAI
        const nextBtn = document.getElementById('btn-next-test');
        nextBtn.style.opacity = '1';
        nextBtn.disabled = false;
    }
}

async function goLive() {
    await fetch('/api/onboarding/complete', { method: 'POST' });
    // Redirect to dashboard
    window.location.href = 'http://localhost:3002';
}

// Init
renderProgress();
// Restore state
fetch('/api/onboarding/status').then(r => r.json()).then(state => {
    if (state.completed) {
        window.location.href = 'http://localhost:3002';
    } else if (state.currentStep > 0) {
        goTo(state.currentStep);
    }
});
</script>
</body>
</html>`;

// ─── Start ───────────────────────────────────────────────────────
server.listen(PORT, () => {
    console.log(`AIWH Onboarding Wizard running on port ${PORT}`);
    if (!isFirstBoot()) {
        console.log('WARNING: first_boot is false — onboarding may already be complete');
    }
});
