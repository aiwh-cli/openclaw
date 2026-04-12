// ─── Workflow Auto-Provisioner ──────────────────────────────────
// Theme AA — Provisions workflow trigger crons based on client preferences.
// Mirrors cron-provisioner.js pattern: templates → feature selection → provision.
//
// Called from /api/onboarding/complete and /api/workflows/provision.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const OPENCLAW_BIN = '/opt/homebrew/bin/openclaw';
const CLIENT_ROOT = process.env.CLIENT_ROOT || '/opt/AIWH/client';
const OC_ENV = {
  ...process.env,
  OPENCLAW_STATE_DIR: '/opt/AIWH/.openclaw',
  PATH: `/opt/homebrew/bin:/opt/homebrew/sbin:${process.env.PATH || '/usr/bin:/bin'}`,
};

function loadWorkflowTemplates() {
  const P = require('./paths');
  return P.getCatalogues().workflowTemplates;
}
function loadClientPrefs() {
  try {
    return JSON.parse(fs.readFileSync(path.join(CLIENT_ROOT, 'config', 'client-preferences.json'), 'utf8'));
  } catch {
    return {};
  }
}

// Determine which workflow templates to activate for this client
function selectWorkflows(prefs, features, integrations) {
  const selected = new Set();
  const { workflows } = loadWorkflowTemplates();

  for (const wf of workflows) {
    // Always-on workflows
    if (wf.enabled_by_default && wf.category === 'reporting') {
      selected.add(wf.id);
    }

    // Content workflows — if video/content feature enabled
    const hasContent = features.includes('content') || features.includes('video') || (prefs.videosPerDay || 0) >= 1;
    if (hasContent && wf.category === 'content') {
      if (wf.id === 'video-production-afternoon' && (prefs.videosPerDay || 0) < 2) continue;
      selected.add(wf.id);
    }

    // Social workflows — if social growth enabled
    if (features.includes('social_growth') && wf.category === 'social') {
      selected.add(wf.id);
    }

    // Knowledge workflows — if research not disabled
    if (prefs.researchFrequency !== 'off' && wf.category === 'knowledge') {
      selected.add(wf.id);
    }
  }

  return selected;
}

// Adjust schedule hour based on client's work start hour (same as cron-provisioner)
function adjustScheduleHour(cronExpr, clientStartHour) {
  if (!cronExpr) return cronExpr;
  const defaultStartHour = 8;
  const offset = (clientStartHour || 8) - defaultStartHour;
  if (offset === 0) return cronExpr;
  const parts = cronExpr.split(' ');
  if (parts.length < 5) return cronExpr;
  const hr = parseInt(parts[1], 10);
  if (isNaN(hr)) return cronExpr;
  parts[1] = String(((hr + offset) % 24 + 24) % 24);
  return parts.join(' ');
}

/**
 * Provision workflow trigger crons for a client.
 * Creates a single trigger cron per workflow — the cron calls
 * POST /api/workflows/:templateId/trigger on the dashboard.
 */
function provisionWorkflowsForClient(db, prefs, opts = {}) {
  const features = prefs.selectedFeatures || [];
  const integrations = prefs.selectedIntegrations || [];
  const tz = prefs.timezone || 'Australia/Brisbane';
  const startHour = prefs.workStartHour ?? 8;
  const { workflows } = loadWorkflowTemplates();
  const selectedIds = selectWorkflows(prefs, features, integrations);

  const result = { activated: [], skipped: [], errors: [] };

  for (const wf of workflows) {
    if (!selectedIds.has(wf.id)) continue;

    // Check if workflow already exists (active or queued)
    const existing = db.prepare(`
      SELECT id FROM workflows WHERE template_id = ? AND status NOT IN ('succeeded','failed','cancelled')
    `).get(wf.id);
    if (existing) {
      result.skipped.push(`${wf.id} (already active)`);
      continue;
    }

    try {
      // Create the workflow record (but don't trigger yet — the cron will do that)
      const workflowEngine = require('./workflow-engine');
      const { workflowId } = workflowEngine.createWorkflow(db, wf.id);

      // Create a script cron to trigger this workflow on schedule
      if (wf.trigger?.schedule) {
        const schedule = adjustScheduleHour(wf.trigger.schedule, startHour);
        const cronName = `com.aiwh.workflow.${wf.id}`;
        const scriptPath = path.join(__dirname, '../../scripts/workflow-trigger.sh');
        const args = [
          'cron', 'add', '--name', cronName,
          '--cron', schedule, '--tz', tz,
          '--session', 'isolated', '--light-context',
          '--message', `Trigger workflow: ${wf.name}. Call dashboard API: curl -s -X POST http://localhost:3001/api/workflows/${wf.id}/trigger`,
          '--agent', 'scheduler',
          '--description', `Trigger: ${wf.name}`,
        ];
        try {
          execFileSync(OPENCLAW_BIN, args, { timeout: 15000, env: OC_ENV });
        } catch (e) {
          // Non-fatal — workflow exists but cron trigger failed
          console.warn(`[workflow-provisioner] cron trigger for ${wf.id} failed:`, e.message);
        }
      }

      // Store the workflow id for reference
      db.prepare(`UPDATE workflows SET trigger_cron_id = ? WHERE id = ?`)
        .run(`com.aiwh.workflow.${wf.id}`, workflowId);

      result.activated.push(wf.id);
    } catch (e) {
      result.errors.push(`${wf.id}: ${e.message}`);
    }
  }

  return result;
}

module.exports = { provisionWorkflowsForClient, selectWorkflows, loadWorkflowTemplates };
