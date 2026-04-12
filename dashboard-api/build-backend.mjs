#!/usr/bin/env node
/**
 * AIWH Dashboard Backend Build — Compilation + Catalogue Embedding (Theme AB.2)
 *
 * Step 1: Read catalogue JSONs, generate catalogue-data.js module
 * Step 2: Per-file Terser minification of all backend JS
 * Output to core/dashboard/ (same paths, minified)
 *
 * Mirrors the frontend build pattern in ui-aiwh/build.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { minify } from 'terser';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORE_DIR = path.resolve(HERE, '../../core');
const DASHBOARD_OUT = path.join(CORE_DIR, 'dashboard');
const CATALOGUES_DIR = path.join(HERE, 'catalogues');

// ── Critical configs to embed (tamper-proof on client) ───────
// These are read from core/ at build time and embedded into catalogue-data.js.
// On client machines, the embedded version is the DEFAULT — per-client overrides
// (e.g. license.json with their client_id) are in client/config/.
const CRITICAL_CONFIGS = {
  license:        path.join(CORE_DIR, 'config/license.json'),
  landlockPolicy: path.join(CORE_DIR, 'config/landlock-policy.json'),
  execApprovals:  path.join(CORE_DIR, 'config/exec-approvals-defaults.json'),
  orgChart:       path.join(DASHBOARD_OUT, 'org-chart.json'),
};

// ── Catalogues to embed ──────────────────────────────────────
const CATALOGUES = {
  commandCentres:       'command-centres.json',
  departmentTemplates:  'department-templates.json',
  capabilitiesCatalogue:'capabilities-catalogue.json',
  mcporterCatalogue:    'mcporter-catalogue.json',
  industryPacks:        'industry-packs.json',
  cronTemplates:        'cron-templates.json',
  workflowTemplates:    'workflow-templates.json',
};

// ── Backend JS files to minify: source name → output path (relative to DASHBOARD_OUT) ──
const ROOT_FILES = [
  'server.js',
  'db.js',
  'openclaw-adapter.js',
  'chat-proxy.js',
  'cinematic-sync.js',
  'cost-sync.js',
  'content-sync.js',
  'gateway-ws.js',
  'script-scheduler.js',
  'log-streamer.js',
  'notification-engine.js',
  'onboarding.js',
  'onboarding-test-server.js',
  'reset-password.js',
];

const TERSER_OPTIONS = {
  compress: {
    dead_code: true,
    drop_console: false,
    passes: 2,
  },
  mangle: {
    toplevel: false, // preserve require() exports and module.exports
  },
  format: {
    comments: false,
  },
  sourceMap: false,
};

async function minifyFile(srcPath, outPath, name) {
  const code = fs.readFileSync(srcPath, 'utf8');
  const result = await minify(code, TERSER_OPTIONS);
  if (!result.code) throw new Error(`Terser produced empty output for ${name}`);
  if (result.code.includes('//# sourceMappingURL')) {
    throw new Error(`Source map reference found in ${name}`);
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, result.code, 'utf8');
  const rawKB = (code.length / 1024).toFixed(1);
  const minKB = (result.code.length / 1024).toFixed(1);
  const pct = ((1 - result.code.length / code.length) * 100).toFixed(0);
  console.log(`  ${name.padEnd(40)} ${rawKB.padStart(7)} KB → ${minKB.padStart(7)} KB  (${pct}% smaller)`);
}

async function build() {
  const t0 = Date.now();
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  AIWH Dashboard Backend Build (Theme AB.2)      ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  // ── Step 1: Generate catalogue-data.js ──
  console.log('[1/3] Embedding catalogue data...');
  const catalogueLines = ['// Generated at build time by build-backend.mjs — DO NOT EDIT'];
  for (const [key, filename] of Object.entries(CATALOGUES)) {
    const filePath = path.join(CATALOGUES_DIR, filename);
    if (!fs.existsSync(filePath)) {
      console.error(`  WARN: Missing catalogue: ${filename} — skipping`);
      catalogueLines.push(`module.exports.${key} = {};`);
      continue;
    }
    const data = fs.readFileSync(filePath, 'utf8');
    // Validate JSON
    try { JSON.parse(data); } catch (e) {
      throw new Error(`Invalid JSON in ${filename}: ${e.message}`);
    }
    catalogueLines.push(`module.exports.${key} = ${data.trim()};`);
    console.log(`  ${filename.padEnd(40)} ${(data.length / 1024).toFixed(1).padStart(7)} KB embedded`);
  }
  // Embed critical configs (tamper-proof defaults)
  console.log('\n  Critical configs:');
  for (const [key, filePath] of Object.entries(CRITICAL_CONFIGS)) {
    if (!fs.existsSync(filePath)) {
      console.error(`  WARN: Missing config: ${path.basename(filePath)} — skipping`);
      catalogueLines.push(`module.exports.${key} = {};`);
      continue;
    }
    const data = fs.readFileSync(filePath, 'utf8');
    try { JSON.parse(data); } catch (e) {
      throw new Error(`Invalid JSON in ${path.basename(filePath)}: ${e.message}`);
    }
    catalogueLines.push(`module.exports.${key} = ${data.trim()};`);
    console.log(`  ${path.basename(filePath).padEnd(40)} ${(data.length / 1024).toFixed(1).padStart(7)} KB embedded`);
  }

  const catalogueCode = catalogueLines.join('\n');
  // Write unminified first (for Terser input)
  const catSrcPath = path.join(HERE, '_catalogue-data.js');
  fs.writeFileSync(catSrcPath, catalogueCode, 'utf8');
  console.log();

  // ── Step 2: Minify catalogue-data.js ──
  console.log('[2/3] Minifying catalogue module...');
  await minifyFile(catSrcPath, path.join(DASHBOARD_OUT, 'catalogue-data.js'), 'catalogue-data.js');
  fs.unlinkSync(catSrcPath); // cleanup temp
  console.log();

  // ── Step 3: Minify all backend JS ──
  // Root files
  const allFiles = ROOT_FILES.map(f => ({ src: f, out: f, dir: '' }));

  // Routes
  const routeFiles = fs.readdirSync(path.join(HERE, 'routes')).filter(f => f.endsWith('.js'));
  for (const f of routeFiles) allFiles.push({ src: `routes/${f}`, out: `routes/${f}`, dir: 'routes' });

  // Helpers
  const helperFiles = fs.readdirSync(path.join(HERE, 'helpers')).filter(f => f.endsWith('.js'));
  for (const f of helperFiles) allFiles.push({ src: `helpers/${f}`, out: `helpers/${f}`, dir: 'helpers' });

  console.log(`[3/3] Minifying ${allFiles.length} backend JS files (Terser)...`);
  let errors = 0;
  for (const file of allFiles) {
    const srcPath = path.join(HERE, file.src);
    const outPath = path.join(DASHBOARD_OUT, file.out);
    if (!fs.existsSync(srcPath)) {
      console.error(`  SKIP: Missing source: ${file.src}`);
      continue;
    }
    try {
      await minifyFile(srcPath, outPath, file.src);
    } catch (e) {
      console.error(`  FAIL: ${file.src}: ${e.message}`);
      errors++;
    }
  }

  if (errors > 0) {
    console.error(`\n${errors} file(s) failed to minify. Aborting.`);
    process.exit(1);
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const totalFiles = allFiles.length + 1; // +1 for catalogue-data.js
  console.log(`\n✓ Backend build complete in ${elapsed}s — ${Object.keys(CATALOGUES).length} catalogues + ${Object.keys(CRITICAL_CONFIGS).length} configs embedded, ${totalFiles} JS files minified`);
}

build().catch(err => {
  console.error('Backend build failed:', err);
  process.exit(1);
});
