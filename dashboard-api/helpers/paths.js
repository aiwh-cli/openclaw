// ─── Centralized Path Constants ──────────────────────────────
// All path references in the dashboard should use these constants.
// Override with env vars for testing or cloud deployment.

const path = require('path');

const CORE_ROOT = process.env.AIWH_CORE_ROOT || '/opt/AIWH/core';
const CLIENT_ROOT = process.env.CLIENT_ROOT || '/opt/AIWH/client';
const OPENCLAW_STATE_DIR = process.env.OPENCLAW_STATE_DIR || '/opt/AIWH/.openclaw';

// Derived paths — product code (ships via git pull)
const CONFIG_DIR = path.join(CORE_ROOT, 'config');
const SCRIPTS_DIR = path.join(CORE_ROOT, 'scripts');
const MODULES_DIR = path.join(CORE_ROOT, 'modules');
const DASHBOARD_DIR = path.join(CORE_ROOT, 'dashboard');
const DOCS_DIR = path.join(CORE_ROOT, 'docs');
const MEMORY_DIR = path.join(CORE_ROOT, 'memory');

// Derived paths — client data (never overwritten by updates)
const CLIENT_CONFIG_DIR = path.join(CLIENT_ROOT, 'config');
const CLIENT_DATA_DIR = path.join(CLIENT_ROOT, 'data');
const CLIENT_CONTENT_DIR = path.join(CLIENT_ROOT, 'content');
const CLIENT_LOGS_DIR = path.join(CLIENT_ROOT, 'logs');
const CLIENT_AGENTS_DIR = path.join(CLIENT_ROOT, 'agents');
const CLIENT_SCRIPTS_DIR = path.join(CLIENT_ROOT, 'scripts');
const CLIENT_EXTENSIONS_DIR = path.join(CLIENT_ROOT, 'dashboard', 'extensions');

// Derived paths — OpenClaw gateway state
const OPENCLAW_CONFIG = path.join(OPENCLAW_STATE_DIR, 'openclaw.json');
const OPENCLAW_AGENTS_DIR = path.join(OPENCLAW_STATE_DIR, 'agents');
const OPENCLAW_CREDENTIALS_DIR = path.join(OPENCLAW_STATE_DIR, 'credentials');

// Product config files (on disk — mutable at runtime)
const LICENSE_CONFIG = path.join(CONFIG_DIR, 'license.json');
const LANDLOCK_POLICY = path.join(CONFIG_DIR, 'landlock-policy.json');
const EXEC_APPROVALS_DEFAULTS = path.join(CONFIG_DIR, 'exec-approvals-defaults.json');

// Embedded catalogues + critical configs — loaded from catalogue-data.js (compiled at build time)
// Falls back to reading JSON files directly for dev mode
let _catalogues;
function getCatalogues() {
  if (_catalogues) return _catalogues;
  try {
    _catalogues = require('../catalogue-data');
  } catch {
    // Dev mode: read JSON files directly
    const readJson = (f) => { try { return JSON.parse(require('fs').readFileSync(path.join(CONFIG_DIR, f), 'utf8')); } catch { return {}; } };
    _catalogues = {
      commandCentres: readJson('command-centres.json'),
      departmentTemplates: readJson('department-templates.json'),
      capabilitiesCatalogue: readJson('capabilities-catalogue.json'),
      mcporterCatalogue: readJson('mcporter-catalogue.json'),
      industryPacks: readJson('industry-packs.json'),
      cronTemplates: readJson('cron-templates.json'),
      workflowTemplates: readJson('workflow-templates.json'),
    };
  }
  return _catalogues;
}

/**
 * Read a critical config with embedded fallback.
 * Priority: file on disk (live state) → embedded in catalogue-data.js (tamper-proof default).
 * For configs that are mutable at runtime (org-chart.json), always read from disk.
 * For configs that are product-owned defaults (license, landlock, exec-approvals),
 * the embedded version protects against accidental deletion or corruption on client machines.
 */
function getConfigWithFallback(filePath, embeddedKey) {
  try {
    if (require('fs').existsSync(filePath)) {
      return JSON.parse(require('fs').readFileSync(filePath, 'utf8'));
    }
  } catch { /* file missing or corrupted — fall through to embedded */ }
  const cats = getCatalogues();
  return cats[embeddedKey] || {};
}

// Legacy path constants (for files that stay on disk)
const COMMAND_CENTRES_CONFIG = path.join(CONFIG_DIR, 'command-centres.json');
const DEPARTMENT_TEMPLATES_CONFIG = path.join(CONFIG_DIR, 'department-templates.json');
const CAPABILITIES_CATALOGUE = path.join(CONFIG_DIR, 'capabilities-catalogue.json');
const CRON_TEMPLATES = path.join(CONFIG_DIR, 'cron-templates.json');
const WORKFLOW_TEMPLATES = path.join(CONFIG_DIR, 'workflow-templates.json');
const INDUSTRY_PACKS = path.join(CONFIG_DIR, 'industry-packs.json');

// Client config files
const AUTH_FILE = path.join(CLIENT_CONFIG_DIR, 'auth.json');
const CLIENT_PROFILE = path.join(CLIENT_CONFIG_DIR, 'client-profile.md');
const CLIENT_POLICY = path.join(CLIENT_CONFIG_DIR, 'client-policy.json');
const CONTENT_PILLARS = path.join(CLIENT_CONFIG_DIR, 'content-pillars.json');
const SECRETS_ENC = path.join(CLIENT_CONFIG_DIR, 'secrets.enc');
const DEPARTMENTS_CONFIG = path.join(CLIENT_CONFIG_DIR, 'departments.json');
const SUBSCRIPTION_CONFIG = path.join(CLIENT_CONFIG_DIR, 'subscription.json');
const MCPORTER_ACTIVE = path.join(CLIENT_CONFIG_DIR, 'mcporter-active.json');

// Shell env for subprocesses (CRITICAL — see CLAUDE.md "PATH in subprocesses")
const SUBPROCESS_ENV = {
  ...process.env,
  OPENCLAW_STATE_DIR,
  CLIENT_ROOT,
  AIWH_CORE_ROOT: CORE_ROOT,
  PATH: `/opt/homebrew/bin:/opt/homebrew/sbin:${process.env.PATH || '/usr/bin:/bin'}`,
};

// ─── Gateway Plist Secret Injection (AC.5) ──────────────────
// Injects secret env vars into the gateway LaunchAgent plist (macOS only).
// On Docker, openclaw-container.sh handles this via -e flags.
const GATEWAY_PLIST = path.join(process.env.HOME || '/Users/roboai', 'Library/LaunchAgents/ai.openclaw.gateway.plist');
const fs = require('fs');
const { execFileSync } = require('child_process');

function injectSecretsIntoGatewayPlist(secrets) {
  if (!fs.existsSync(GATEWAY_PLIST)) return;
  try {
    for (const [key, value] of Object.entries(secrets)) {
      try {
        execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :EnvironmentVariables:${key} ${value}`, GATEWAY_PLIST],
          { timeout: 5000, stdio: 'pipe' });
      } catch {
        execFileSync('/usr/libexec/PlistBuddy', ['-c', `Add :EnvironmentVariables:${key} string ${value}`, GATEWAY_PLIST],
          { timeout: 5000, stdio: 'pipe' });
      }
    }
    fs.chmodSync(GATEWAY_PLIST, 0o600);
  } catch (e) {
    console.error('[credential-bridge] Failed to inject secrets into gateway plist:', e.message);
  }
}

module.exports = {
  getCatalogues,
  getConfigWithFallback,
  CORE_ROOT,
  CLIENT_ROOT,
  OPENCLAW_STATE_DIR,
  CONFIG_DIR,
  SCRIPTS_DIR,
  MODULES_DIR,
  DASHBOARD_DIR,
  DOCS_DIR,
  MEMORY_DIR,
  CLIENT_CONFIG_DIR,
  CLIENT_DATA_DIR,
  CLIENT_CONTENT_DIR,
  CLIENT_LOGS_DIR,
  CLIENT_AGENTS_DIR,
  CLIENT_SCRIPTS_DIR,
  CLIENT_EXTENSIONS_DIR,
  OPENCLAW_CONFIG,
  OPENCLAW_AGENTS_DIR,
  OPENCLAW_CREDENTIALS_DIR,
  COMMAND_CENTRES_CONFIG,
  DEPARTMENT_TEMPLATES_CONFIG,
  LICENSE_CONFIG,
  LANDLOCK_POLICY,
  EXEC_APPROVALS_DEFAULTS,
  CAPABILITIES_CATALOGUE,
  CRON_TEMPLATES,
  WORKFLOW_TEMPLATES,
  INDUSTRY_PACKS,
  AUTH_FILE,
  CLIENT_PROFILE,
  CLIENT_POLICY,
  CONTENT_PILLARS,
  SECRETS_ENC,
  DEPARTMENTS_CONFIG,
  SUBSCRIPTION_CONFIG,
  MCPORTER_ACTIVE,
  SUBPROCESS_ENV,
  GATEWAY_PLIST,
  injectSecretsIntoGatewayPlist,
};
