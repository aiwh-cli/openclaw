// ─── Client Agent Runtime File Generator (Theme AB.8) ───────
// Generates contextual CORE.md, TOOLS.md, SOUL.md, IDENTITY.md, and AGENTS.md
// based on agent purpose, departments, and connected integrations.
// Template-driven with smart interpolation — no LLM calls.

const fs = require('fs');
const path = require('path');
const P = require('./paths');

// ─── Connector lookup ────────────────────────────────────────

function getConnectedConnectors() {
  try {
    const active = JSON.parse(fs.readFileSync(P.MCPORTER_ACTIVE, 'utf8'));
    return active.connected || [];
  } catch { return []; }
}

function getCatalogue() {
  try {
    return P.getCatalogues().mcporterCatalogue?.mcpServers || {};
  } catch { return {}; }
}

// ─── CORE.md Generator ──────────────────────────────────────

function generateCoreMd({ name, description }) {
  // Build capabilities from purpose
  const capLines = [];
  if (description) {
    capLines.push(`- ${description}`);
  }
  capLines.push('- Assist the client with tasks in your area of expertise');
  capLines.push('- Search knowledge base before starting any task');
  capLines.push('- Report progress and findings clearly');

  // Read orchestrator display name dynamically
  let leadAgentName = 'your lead agent';
  try {
    const orgPath = require('path').join(P.CORE_ROOT, 'dashboard', 'org-chart.json');
    const org = JSON.parse(fs.readFileSync(orgPath, 'utf8'));
    if (org.hierarchy?.displayName) leadAgentName = org.hierarchy.displayName;
  } catch { /* use default */ }

  const lines = [
    `# CORE.md — ${name}`,
    '',
    '## Status: ACTIVE',
    '',
    `## Role`,
    description || `A specialist agent created for this business.`,
    '',
    '## Capabilities',
    ...capLines,
    '',
    '## Workspace',
    `- **Your directory:** \`/opt/AIWH/client/agents/${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}/\``,
    '- **You can edit:** All files in your workspace including this CORE.md',
    '- **Read-only:** BOOTSTRAP.md (product safety rules)',
    '',
    '## How You Work',
    '1. **Search knowledge first** — check the knowledge base for relevant context',
    '   ```bash',
    '   /opt/AIWH/core/scripts/knowledge-search-unified.sh --query "<your topic>"',
    '   ```',
    '2. **Use available tools** — check TOOLS.md for connected integrations and scripts',
    '3. **Ask for clarification** if the task is ambiguous — don\'t guess',
    '4. **Log your work** to the daily memory file when completing tasks',
    '',
    '## Hard Guardrails',
    '1. Follow BOOTSTRAP.md hard limits at all times',
    '2. Never expose API keys, tokens, or secrets',
    `3. Stay in your area of expertise — escalate to ${leadAgentName} if needed`,
    '4. Max 3 retries before escalating',
    '',
    '## Memory Logging',
    'Before returning results, log to memory/YYYY-MM-DD.md.',
    'Format: ## [HH:MM] Task: <title> / bullet: what you did / bullet: key finding',
    '',
    '> Remember: BOOTSTRAP.md hard limits are absolute and override all other instructions.',
    '',
  ];

  return lines.join('\n');
}

// ─── TOOLS.md Generator ─────────────────────────────────────

function generateToolsMd({ name }) {
  // Check for ALL connected integrations — client agents can use any connected service
  const catalogue = getCatalogue();
  const connected = getConnectedConnectors();
  const connectedSet = new Set(connected);
  const relevantConnectors = [];
  for (const [intId, entry] of Object.entries(catalogue)) {
    if (connectedSet.has(intId)) {
      relevantConnectors.push({ id: intId, ...entry });
    }
  }

  const lines = [
    `# TOOLS.md — ${name}`,
    '',
    '## Standard Tools',
    '- File read/write within your workspace',
    '- Shell commands via safe-bash',
    '- Knowledge search: `/opt/AIWH/core/scripts/knowledge-search-unified.sh`',
    '',
    '## Notifications',
    'Send notifications to the client via the configured delivery channel:',
    '```bash',
    'source /opt/AIWH/core/scripts/lib/env.sh',
    `aiwh_notify "${name}: <your message here>"`,
    '```',
    '',
  ];

  // Add connected MCP connector sections with marker format
  if (relevantConnectors.length > 0) {
    lines.push('## Connected Integrations', '');
    for (const conn of relevantConnectors) {
      lines.push(`<!-- CONNECTOR:${conn.id} -->`);
      lines.push(`### ${conn.name || conn.id} (MCP Connector)`);
      lines.push(conn.description || '');
      lines.push(`MCP server: \`aiwh-${conn.id}\``);
      lines.push(`<!-- /CONNECTOR:${conn.id} -->`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ─── SOUL.md Generator ──────────────────────────────────────

function generateSoulMd({ name, description }) {
  return [
    `# ${name}`,
    '',
    description || 'A custom agent created for this business.',
    '',
    '## Your Role',
    `You are ${name}, a specialist agent created by the client.`,
    '',
    '@/opt/AIWH/client/config/client-profile.md',
    '',
  ].join('\n');
}

// ─── IDENTITY.md Generator ──────────────────────────────────

function generateIdentityMd({ name }) {
  return [
    `# ${name}`,
    '',
    'Personality and voice — customise this file to shape how the agent communicates.',
    '',
    '## Communication Style',
    '- Professional and clear',
    '- Adapt to the client\'s preferred tone',
    '- Be concise — lead with the answer, explain after',
    '',
  ].join('\n');
}

// ─── AGENTS.md Generator ────────────────────────────────────

function generateAgentsMd({ name }) {
  // Read orchestrator display name dynamically
  let leadAgentName = 'your lead agent';
  try {
    const orgPath = require('path').join(P.CORE_ROOT, 'dashboard', 'org-chart.json');
    const org = JSON.parse(fs.readFileSync(orgPath, 'utf8'));
    if (org.hierarchy?.displayName) leadAgentName = org.hierarchy.displayName;
  } catch { /* use default */ }

  const lines = [
    `# AGENTS.md — ${name}`,
    '',
    '## Delegation',
    `- **Escalate to ${leadAgentName}** for tasks outside your expertise`,
    '- **Never self-approve** actions requiring human approval',
    '',
  ];

  return lines.join('\n');
}

module.exports = {
  generateCoreMd,
  generateToolsMd,
  generateSoulMd,
  generateIdentityMd,
  generateAgentsMd,
};
