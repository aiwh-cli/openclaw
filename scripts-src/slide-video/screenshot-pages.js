#!/usr/bin/env node
/**
 * screenshot-pages.js — Multi-mode slide extractor.
 *
 * Accepts HTML (with PAGE markers), PDF, or a directory of images.
 * Screenshots each page/slide at the specified viewport size.
 *
 * Usage:
 *   node screenshot-pages.js <input> --output-dir <dir> [--width 1920] [--height 1080]
 *
 * Input auto-detection:
 *   .html  → split on <!-- PAGE --> or <div class="slide">, screenshot each
 *   .pdf   → render each page as PNG
 *   dir/   → copy PNG/JPG files sorted alphabetically
 */

const fs = require('fs');
const path = require('path');

// Playwright is installed globally — resolve from global node_modules
const PLAYWRIGHT_PATH = '/opt/homebrew/lib/node_modules/playwright';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input || !args.outputDir) {
    console.error('Usage: node screenshot-pages.js <input> --output-dir <dir> [--width N] [--height N]');
    process.exit(1);
  }

  const width = args.width || 1920;
  const height = args.height || 1080;

  // Validate output directory is in a safe location (P1 fix)
  const CLIENT_ROOT = process.env.CLIENT_ROOT || '/opt/AIWH/client';
  const SAFE_DIRS = [path.join(CLIENT_ROOT, 'content'), '/tmp'];
  const resolvedOut = path.resolve(args.outputDir);
  if (!SAFE_DIRS.some(d => resolvedOut.startsWith(d))) {
    console.error(`[screenshot] Output dir must be under ${SAFE_DIRS.join(' or ')}`);
    process.exit(1);
  }
  fs.mkdirSync(args.outputDir, { recursive: true });

  const ext = path.extname(args.input).toLowerCase();
  const isDir = fs.existsSync(args.input) && fs.statSync(args.input).isDirectory();

  let slideCount;
  if (isDir) {
    slideCount = await handleImages(args.input, args.outputDir, width, height);
  } else if (ext === '.pdf') {
    slideCount = await handlePdf(args.input, args.outputDir, width, height);
  } else if (ext === '.html' || ext === '.htm') {
    slideCount = await handleHtml(args.input, args.outputDir, width, height);
  } else {
    console.error(`Unsupported input: ${ext}. Use .html, .pdf, or a directory of images.`);
    process.exit(1);
  }

  const manifest = { slides: slideCount, width, height, outputDir: args.outputDir };
  fs.writeFileSync(path.join(args.outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify(manifest));
}

async function handleHtml(htmlPath, outputDir, width, height) {
  const { chromium } = require(PLAYWRIGHT_PATH);
  const raw = fs.readFileSync(htmlPath, 'utf-8');

  const headMatch = raw.match(/<head>([\s\S]*?)<\/head>/i);
  let headContent = headMatch ? headMatch[1] : '';
  const bodyMatch = raw.match(/<body>([\s\S]*?)<\/body>/i);
  const bodyContent = bodyMatch ? bodyMatch[1] : raw;

  // Inline local CSS <link> tags — only from allowed engine directories (P0 fix)
  const CSS_ALLOWED = ['/opt/AIWH/core/scripts/slide-video/'];
  headContent = headContent.replace(
    /<link\s+rel="stylesheet"\s+href="(\/[^"]+\.css)"\s*\/?>/gi,
    (_, cssPath) => {
      const resolved = path.resolve(cssPath);
      if (!CSS_ALLOWED.some(d => resolved.startsWith(d))) return '';
      if (fs.existsSync(resolved)) {
        return `<style>${fs.readFileSync(resolved, 'utf-8')}</style>`;
      }
      return '';
    }
  );

  let sections;
  if (bodyContent.includes('<!-- PAGE -->')) {
    sections = bodyContent.split('<!-- PAGE -->').map(s => s.trim()).filter(Boolean);
  } else if (/<div\s+class="slide"/.test(bodyContent)) {
    sections = bodyContent.split(/(?=<div\s+class="slide")/).map(s => s.trim()).filter(Boolean);
  } else {
    // Fallback: split on <div class="cover"> / <div class="page"> boundaries
    sections = bodyContent.split(/(?=<div\s+class="(?:cover|page)")/).map(s => s.trim()).filter(Boolean);
  }

  if (sections.length === 0) {
    console.error('No slides found. Use <!-- PAGE --> markers or <div class="slide"> elements.');
    process.exit(1);
  }

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width, height });

  for (let i = 0; i < sections.length; i++) {
    const html = `<!DOCTYPE html><html><head>${headContent}</head><body>${sections[i]}</body></html>`;
    await page.setContent(html, { waitUntil: 'networkidle' });
    const outPath = path.join(outputDir, `slide-${String(i + 1).padStart(3, '0')}.png`);
    await page.screenshot({ path: outPath, type: 'png' });
    const size = fs.statSync(outPath).size;
    console.error(`  slide-${String(i + 1).padStart(3, '0')}.png (${Math.round(size / 1024)}KB)`);
  }

  await browser.close();
  return sections.length;
}

async function handlePdf(pdfPath, outputDir, width, height) {
  const { chromium } = require(PLAYWRIGHT_PATH);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width, height });

  await page.goto(`file://${path.resolve(pdfPath)}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const pageCount = await page.evaluate(() => {
    const container = document.querySelector('.pdfViewer');
    return container ? container.querySelectorAll('.page').length : 1;
  });

  let count = 0;
  for (let i = 0; i < pageCount; i++) {
    await page.evaluate((idx) => {
      const pages = document.querySelectorAll('.pdfViewer .page');
      if (pages[idx]) pages[idx].scrollIntoView();
    }, i);
    await page.waitForTimeout(500);
    const outPath = path.join(outputDir, `slide-${String(i + 1).padStart(3, '0')}.png`);
    await page.screenshot({ path: outPath, type: 'png' });
    console.error(`  slide-${String(i + 1).padStart(3, '0')}.png`);
    count++;
  }

  await browser.close();
  return count;
}

async function handleImages(dirPath, outputDir, width, height) {
  const files = fs.readdirSync(dirPath)
    .filter(f => /\.(png|jpe?g|webp)$/i.test(f))
    .sort();

  let count = 0;
  for (const file of files) {
    const src = path.join(dirPath, file);
    const dest = path.join(outputDir, `slide-${String(count + 1).padStart(3, '0')}.png`);
    fs.copyFileSync(src, dest);
    console.error(`  ${file} → slide-${String(count + 1).padStart(3, '0')}.png`);
    count++;
  }
  return count;
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--output-dir' && argv[i + 1]) result.outputDir = argv[++i];
    else if (argv[i] === '--width' && argv[i + 1]) result.width = parseInt(argv[++i], 10);
    else if (argv[i] === '--height' && argv[i + 1]) result.height = parseInt(argv[++i], 10);
    else if (!argv[i].startsWith('--')) result.input = argv[i];
  }
  return result;
}

main().catch(err => { console.error(`[screenshot] Fatal: ${err.message}`); process.exit(1); });
