#!/usr/bin/env node
/**
 * AIWH Dashboard Build — IP Protection (Theme U, Attempt 2)
 *
 * Per-file minification. Each JS/CSS file minified individually with battle-tested tools.
 * Output to same file paths in core/dashboard/public/. No concatenation, no HTML changes.
 *
 * Tools: Terser (JS), LightningCSS (CSS), Vite (Lit components)
 */

import fs from 'node:fs';
import path from 'node:path';
import { minify } from 'terser';
import { transform } from 'lightningcss';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD_PUBLIC = path.resolve(HERE, '../../core/dashboard/public');

// ── JS files: source path (relative to js/) → output path (relative to DASHBOARD_PUBLIC) ──
// EXCLUDES: wealth.js (WCC, rebrandable), onboarding.js (separate page), chart.min.js (external)
const JS_MAP = {
  'app.js':                     'app.js',
  'canvas-bg.js':               'canvas-bg.js',
  'sidebar.js':                 'components/sidebar.js',
  'views/overview.js':          'views/overview.js',
  // 'views/team.js' — removed, migrated to <team-org-chart> Lit component
  'views/team-detail.js':       'views/team-detail.js',
  'views/tasks.js':             'views/tasks.js',
  'views/schedule-crons.js':    'views/schedule-crons.js',
  'views/schedule-scripts.js':  'views/schedule-scripts.js',
  'views/schedule-templates.js':'views/schedule-templates.js',
  'views/knowledge.js':         'views/knowledge.js',
  'views/costs.js':             'views/costs.js',
  // 'views/logs.js' — removed, migrated to <aiwh-logs> Lit component
  'views/debug.js':             'views/debug.js',
  'views/trash.js':             'views/trash.js',
  // 'views/channels.js' — removed, migrated to <channel-panel> Lit component
  'views/channels-setup.js':    'views/channels-setup.js',
  'views/channels-config.js':   'views/channels-config.js',
  'views/config.js':            'views/config.js',
  // chat-*.js files removed — migrated to <aiwh-chat-host> + <aiwh-chat-sidebar> Lit components (Phase 1)
  // 'views/notifications.js' — removed, migrated to <notif-dropdown> Lit component
  // security.js uses top-level await (ES module) — it's a Lit component loaded dynamically,
  // already compiled into lit/components.js. Not loaded via <script> tag. Skip minification.
};

// ── CSS files: source path (relative to css/) → output path (relative to DASHBOARD_PUBLIC) ──
// EXCLUDES: onboarding.css (separate page), wealth.css (WCC, rebrandable)
const CSS_MAP = {
  'style.css':              'style.css',
  'shell.css':              'shell.css',
  'buttons.css':            'buttons.css',
  'panels.css':             'panels.css',
  'activity.css':           'activity.css',
  'overview.css':           'overview.css',
  'team.css':               'team.css',
  'editor.css':             'editor.css',
  'kanban.css':             'kanban.css',
  'schedule.css':           'schedule.css',
  'chat.css':               'chat.css',
  'chat-view.css':          'chat-view.css',
  'chat-openclaw.css':      'chat-openclaw.css',
  'content.css':            'content.css',
  'views-misc.css':         'views-misc.css',
  'modals.css':             'modals.css',
  'channels.css':           'channels.css',
  'sidebar.css':            'sidebar.css',
  'openclaw-theme-map.css': 'openclaw-theme-map.css',
  'production.css':         'production.css',
  'chat-media.css':         'chat-media.css',
};

const TERSER_OPTIONS = {
  compress: {
    dead_code: true,
    drop_console: false,
    passes: 2,
  },
  mangle: {
    toplevel: false, // CRITICAL: preserve window globals for onclick handlers
  },
  format: {
    comments: false,
  },
  sourceMap: false,
};

async function minifyJs(srcPath, outPath, name) {
  const code = fs.readFileSync(srcPath, 'utf8');
  const result = await minify(code, TERSER_OPTIONS);
  if (!result.code) {throw new Error(`Terser produced empty output for ${name}`);}
  if (result.code.includes('//# sourceMappingURL')) {
    throw new Error(`Source map reference found in ${name}`);
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, result.code, 'utf8');
  const rawKB = (code.length / 1024).toFixed(1);
  const minKB = (result.code.length / 1024).toFixed(1);
  const pct = ((1 - result.code.length / code.length) * 100).toFixed(0);
  console.log(`  ${name.padEnd(35)} ${rawKB.padStart(6)} KB → ${minKB.padStart(6)} KB  (${pct}% smaller)`);
}

function minifyCss(srcPath, outPath, name) {
  const code = fs.readFileSync(srcPath, 'utf8');
  const result = transform({
    filename: name,
    code: Buffer.from(code),
    minify: true,
    sourceMap: false,
  });
  const minified = result.code.toString();
  if (minified.includes('/*# sourceMappingURL')) {
    throw new Error(`Source map reference found in ${name}`);
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, minified, 'utf8');
  const rawKB = (code.length / 1024).toFixed(1);
  const minKB = (minified.length / 1024).toFixed(1);
  const pct = ((1 - minified.length / code.length) * 100).toFixed(0);
  console.log(`  ${name.padEnd(35)} ${rawKB.padStart(6)} KB → ${minKB.padStart(6)} KB  (${pct}% smaller)`);
}

async function build() {
  const t0 = Date.now();
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  AIWH Dashboard Build — IP Protection (v2)      ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  // ── Step 1: Build Lit components via Vite ──
  console.log('[1/3] Building Lit components (Vite)...');
  try {
    execSync('npx vite build', { cwd: HERE, stdio: 'pipe' });
    const litSize = fs.statSync(path.join(DASHBOARD_PUBLIC, 'lit/components.js')).size;
    console.log(`  Lit bundle: ${(litSize / 1024).toFixed(1)} KB\n`);
  } catch (e) {
    console.error('  FAIL: Vite build failed:', e.stderr?.toString() || e.message);
    process.exit(1);
  }

  // ── Step 2: Minify JS files individually ──
  console.log(`[2/3] Minifying ${Object.keys(JS_MAP).length} JS files (Terser)...`);
  const jsDir = path.join(HERE, 'js');
  let jsErrors = 0;
  for (const [src, out] of Object.entries(JS_MAP)) {
    const srcPath = path.join(jsDir, src);
    const outPath = path.join(DASHBOARD_PUBLIC, out);
    if (!fs.existsSync(srcPath)) {
      console.error(`  FAIL: Missing source: ${srcPath}`);
      jsErrors++;
      continue;
    }
    try {
      await minifyJs(srcPath, outPath, src);
    } catch (e) {
      console.error(`  FAIL: ${src}: ${e.message}`);
      jsErrors++;
    }
  }
  if (jsErrors > 0) {
    console.error(`\n${jsErrors} JS file(s) failed to minify. Aborting.`);
    process.exit(1);
  }
  console.log();

  // ── Step 3: Minify CSS files individually ──
  console.log(`[3/3] Minifying ${Object.keys(CSS_MAP).length} CSS files (LightningCSS)...`);
  const cssDir = path.join(HERE, 'css');
  let cssErrors = 0;
  for (const [src, out] of Object.entries(CSS_MAP)) {
    const srcPath = path.join(cssDir, src);
    const outPath = path.join(DASHBOARD_PUBLIC, out);
    if (!fs.existsSync(srcPath)) {
      console.error(`  FAIL: Missing source: ${srcPath}`);
      cssErrors++;
      continue;
    }
    try {
      minifyCss(srcPath, outPath, src);
    } catch (e) {
      console.error(`  FAIL: ${src}: ${e.message}`);
      cssErrors++;
    }
  }
  if (cssErrors > 0) {
    console.error(`\n${cssErrors} CSS file(s) failed to minify. Aborting.`);
    process.exit(1);
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n✓ Build complete in ${elapsed}s — ${Object.keys(JS_MAP).length} JS + ${Object.keys(CSS_MAP).length} CSS files minified`);
}

build().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});
