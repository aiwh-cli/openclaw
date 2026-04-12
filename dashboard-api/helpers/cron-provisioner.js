// ─── Cron Auto-Provisioner ──────────────────────────────────
// Phase 69.1.2.1 — Auto-creates crons from templates after onboarding.
// Called from /api/onboarding/complete and /api/cron/provision.
//
// Input: client-preferences.json (timezone, workStartHour, videosPerDay,
//        researchFrequency, selectedFeatures, selectedIntegrations)
// Output: Creates OpenClaw agent crons + script-scheduler crons

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const OPENCLAW_BIN = '/opt/homebrew/bin/openclaw';
const CLIENT_ROOT = process.env.CLIENT_ROOT || '/opt/AIWH/client';
const NOTIF_CONFIG_PATH = path.join(CLIENT_ROOT, 'config', 'notifications.json');
const OC_ENV = {
  ...process.env,
  OPENCLAW_STATE_DIR: '/opt/AIWH/.openclaw',
  PATH: `/opt/homebrew/bin:/opt/homebrew/sbin:${process.env.PATH || '/usr/bin:/bin'}`,
};

// Read client notification routing config (channel-agnostic)
function loadNotificationConfig() {
  try {
    return JSON.parse(fs.readFileSync(NOTIF_CONFIG_PATH, 'utf8'));
  } catch {
    return {};
  }
}

// Resolve delivery channel + target for a template's notification category
function resolveDelivery(notifConfig, category) {
  const routing = notifConfig[category] || notifConfig.general;
  if (!routing || !routing.channel || !routing.target) return null;
  return { channel: routing.channel, target: routing.target };
}

// Resolve failover destination from notifications.json
function resolveFailover(notifConfig) {
  const failover = notifConfig.failover;
  if (!failover || !failover.channel || !failover.target) return null;
  return { channel: failover.channel, to: `channel:${failover.target}` };
}

function loadTemplates() {
  const P = require('./paths');
  return P.getCatalogues().cronTemplates;
}
function detectDefaultProvider() {
  try {
    const ocPath = path.join(process.env.OPENCLAW_STATE_DIR || '/opt/AIWH/.openclaw', 'openclaw.json');
    const oc = JSON.parse(fs.readFileSync(ocPath, 'utf8'));
    const primary = oc?.agents?.defaults?.model?.primary || '';
    if (primary.startsWith('openai-codex/')) return 'openai-codex';
    if (primary.startsWith('openrouter/')) return 'openrouter';
    if (primary.startsWith('ollama/')) return 'ollama';
  } catch {}
  return 'anthropic';
}

function resolveModel(template, tierMap, provider) {
  if (template.is_script) return null;
  if (template.tier && tierMap[template.tier]) {
    return tierMap[template.tier][provider] || tierMap[template.tier].anthropic || template.model;
  }
  return template.model || null;
}

// Adjust cron schedule hour based on client's work start hour
function adjustScheduleHour(cronExpr, templateHour, clientStartHour) {
  if (!cronExpr || templateHour === undefined) return cronExpr;
  const defaultStartHour = 8; // templates assume 8 AM start
  const offset = clientStartHour - defaultStartHour;
  if (offset === 0) return cronExpr;

  const parts = cronExpr.split(' ');
  if (parts.length < 5) return cronExpr;
  const hr = parseInt(parts[1], 10);
  if (isNaN(hr)) return cronExpr; // wildcards, ranges — leave as-is

  const newHr = ((hr + offset) % 24 + 24) % 24;
  parts[1] = String(newHr);
  return parts.join(' ');
}

// Determine which template IDs should be provisioned
function selectTemplates(prefs, features, integrations) {
  const selected = new Set();

  // ALWAYS (system essentials — $0 script crons)
  ['system-backup', 'media-cleanup', 'daily-cost-monitor', 'knowledge-pipeline', 'log-rotation', 'delivery-queue-cleanup', 'license-heartbeat'].forEach(id => selected.add(id));

  // ALWAYS (agent crons — low cost briefings)
  ['morning-briefing', 'nightly-summary', 'knowledge-reconcile', 'cfo-daily-cost-briefing'].forEach(id => selected.add(id));

  // Content features
  const hasContent = features.includes('content') || features.includes('video') || (prefs.videosPerDay || 0) >= 1;
  if (hasContent) {
    selected.add('video-topic-generator');
    selected.add('video-copywriter-morning');
    selected.add('video-pipeline-morning');
    selected.add('weekly-video-report');
  }

  // 2 videos per day
  if ((prefs.videosPerDay || 0) >= 2) {
    selected.add('video-copywriter-afternoon');
    selected.add('video-pipeline-afternoon');
  }

  // Knowledge research
  if (prefs.researchFrequency !== 'off') {
    selected.add('knowledge-research');
  }

  // CRM features
  const hasCRM = features.includes('crm') || integrations.includes('gohighlevel') || integrations.includes('hubspot');
  if (hasCRM) {
    selected.add('crm-pipeline-review');
    selected.add('crm-weekly-report');
  }

  // Social growth features
  const hasSocial = features.includes('social_growth');
  if (hasSocial) {
    selected.add('social-content-creator');
    selected.add('social-daily-post');
    selected.add('social-engagement-monitor');
    selected.add('social-weekly-strategy');
  }

  return selected;
}

// Known aliases: template ID → possible existing names
const TEMPLATE_ALIASES = {
  'system-backup': ['backup-snapshot', 'backup', 'system-backup'],
  'daily-cost-monitor': ['daily-cost-monitor', 'spend-watchdog', 'cost-monitor'],
  'knowledge-pipeline': ['nightly-knowledge-pipeline', 'knowledge-pipeline', 'knowledge-extract'],
  'log-rotation': ['log-rotate', 'log-rotation'],
  'media-cleanup': ['media-cleanup', 'media-archive', 'media-archive-daily'],
  'knowledge-reconcile': ['knowledge-reconcile'],
  'social-content-creator': ['social-content-creator', 'social-content'],
  'social-daily-post': ['social-daily-post', 'social-post', 'social-scheduler'],
  'social-engagement-monitor': ['social-engagement-monitor', 'social-engagement', 'engagement-sweep'],
  'social-weekly-strategy': ['social-weekly-strategy', 'social-strategy', 'social-weekly'],
  'cfo-daily-cost-briefing': ['cfo-daily-cost-briefing', 'cfo-cost', 'cost-briefing', 'cfo-briefing'],
  'license-heartbeat': ['license-heartbeat', 'heartbeat-runner', 'heartbeat'],
};

// Check if a cron with similar name/id already exists
function cronExists(templateId, templateName, existingCrons) {
  const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const nId = norm(templateId);
  const nName = norm(templateName);
  const prefixed = norm('com.aiwh.' + templateId);
  // Build search terms from aliases
  const aliases = (TEMPLATE_ALIASES[templateId] || []).map(norm);
  return existingCrons.some(c => {
    const cName = norm(c.name || '');
    const cId = norm(c.id || '');
    const cScript = norm(c.script_path || '');
    // Direct matches
    if (cName === nId || cName === nName || cName === prefixed) return true;
    if (cId === nId || cId === prefixed) return true;
    // Substring matches
    if (cName.includes(nId) || nId.includes(cName)) return true;
    // Alias matches
    if (aliases.some(a => cName.includes(a) || a.includes(cName))) return true;
    // Script path match (for script crons)
    if (cScript && cScript.includes(nId.replace(/[^a-z]/g, ''))) return true;
    return false;
  });
}

/**
 * Provision crons for a client based on their preferences.
 * @param {object} prefs - From client-preferences.json
 * @param {object} opts - { scriptScheduler, adapter, existingCrons }
 * @returns {{ created: string[], skipped: string[], errors: string[] }}
 */
function provisionCronsForClient(prefs, opts) {
  const { scriptScheduler, adapter } = opts;
  const features = prefs.selectedFeatures || [];
  const integrations = prefs.selectedIntegrations || [];
  const tz = prefs.timezone || 'Australia/Brisbane';
  const startHour = prefs.workStartHour ?? 8;

  const { templates, tierMap } = loadTemplates();
  const provider = detectDefaultProvider();
  const selectedIds = selectTemplates(prefs, features, integrations);
  const notifConfig = loadNotificationConfig();

  // Get existing crons to avoid duplicates
  let existingAgent = [];
  try { existingAgent = adapter ? adapter.getCronJobs() : []; } catch {}
  let existingScript = [];
  try { existingScript = scriptScheduler ? scriptScheduler.list() : []; } catch {}
  let allExisting = [...existingAgent, ...existingScript];

  const result = { created: [], skipped: [], errors: [] };

  for (const tpl of templates) {
    if (!selectedIds.has(tpl.id)) continue;

    // Skip if already exists
    if (cronExists(tpl.id, tpl.name, allExisting)) {
      result.skipped.push(`${tpl.id} (already exists)`);
      continue;
    }

    if (tpl.is_script) {
      // Create script cron via scriptScheduler
      try {
        scriptScheduler.create({
          name: tpl.id,
          description: tpl.description,
          script_path: tpl.script_path,
          cron_expr: tpl.schedule,
          timezone: tz,
        });
        result.created.push(tpl.id);
      } catch (e) {
        result.errors.push(`${tpl.id}: ${e.message}`);
      }
    } else {
      // Create OpenClaw agent cron
      try {
        const model = resolveModel(tpl, tierMap || {}, provider);
        const schedule = adjustScheduleHour(tpl.schedule, parseInt((tpl.schedule || '').split(' ')[1], 10), startHour);
        const args = ['cron', 'add', '--name', `com.aiwh.${tpl.id}`, '--cron', schedule, '--message', tpl.message];
        if (tpl.agent) args.push('--agent', tpl.agent);
        args.push('--tz', tz);
        if (tpl.description) args.push('--description', tpl.description);
        if (tpl.session === 'isolated') args.push('--session', 'isolated');
        if (model) args.push('--model', model);
        if (tpl.lightContext) args.push('--light-context');
        // Inject delivery channel from client notification config
        const delivery = resolveDelivery(notifConfig, tpl.notificationCategory || 'general');
        if (delivery) {
          args.push('--channel', delivery.channel, '--to', delivery.target, '--announce');
        }
        execFileSync(OPENCLAW_BIN, args, { timeout: 15000, env: OC_ENV });
        result.created.push(tpl.id);
        // Refresh existing list to prevent duplicates within the same batch
        try { existingAgent = adapter ? adapter.getCronJobs() : []; } catch {}
        allExisting = [...existingAgent, ...existingScript];
      } catch (e) {
        result.errors.push(`${tpl.id}: ${e.message}`);
      }
    }
  }

  return result;
}

/**
 * Repair delivery channel on all existing com.aiwh.* agent crons.
 * Reads notifications.json, maps each cron to its template's category,
 * and calls `openclaw cron edit --channel <ch> --to <target>`.
 * @param {object} opts - { adapter }
 * @returns {{ repaired: string[], skipped: string[], errors: string[] }}
 */
function repairCronDelivery(opts) {
  const { adapter } = opts;
  const notifConfig = loadNotificationConfig();
  if (!Object.keys(notifConfig).length) {
    return { repaired: [], skipped: [], errors: ['No notifications.json config found'] };
  }

  const { templates } = loadTemplates();
  const templateMap = {};
  for (const tpl of templates) {
    if (!tpl.is_script) templateMap[tpl.id] = tpl;
  }

  const jobs = adapter ? adapter.getCronJobs() : [];
  const result = { repaired: [], skipped: [], errors: [] };

  for (const job of jobs) {
    const name = job.name || '';
    if (!name.startsWith('com.aiwh.')) { result.skipped.push(name); continue; }

    // Resolve template ID from cron name
    const tplId = name.replace('com.aiwh.', '').replace(/-\d+$/, '');
    const tpl = templateMap[tplId];
    const category = tpl?.notificationCategory || 'general';
    const delivery = resolveDelivery(notifConfig, category);

    if (!delivery) { result.skipped.push(`${name} (no config for ${category})`); continue; }

    try {
      const args = ['cron', 'edit', job.id, '--channel', delivery.channel, '--to', delivery.target];
      // Enable failure alerts with failover channel if configured
      const failover = resolveFailover(notifConfig);
      if (failover) {
        args.push('--failure-alert', '--failure-alert-channel', failover.channel, '--failure-alert-to', failover.to);
      }
      execFileSync(OPENCLAW_BIN, args, { timeout: 10000, env: OC_ENV });
      result.repaired.push(name);
    } catch (e) {
      result.errors.push(`${name}: ${e.message}`);
    }
  }

  return result;
}

module.exports = { provisionCronsForClient, repairCronDelivery, loadNotificationConfig, resolveFailover, selectTemplates, resolveModel, detectDefaultProvider };
