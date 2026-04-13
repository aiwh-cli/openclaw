"""
AIWH Branded PDF Builder — Light Theme
Generates styled HTML then converts to PDF via Playwright.
Uses the aiwh-website light theme: warm gold accents, Inter font, cards.

Usage:
    from pdf_brand import BrandPDF
    doc = BrandPDF("Document Title", "Subtitle here")
    doc.h1("Section Heading")
    doc.body("Paragraph with **bold** and *italic*.")
    doc.bullet(["First point", "Second point"])
    doc.callout("Important note", label="TIP")
    doc.table([["Col A","Col B"],["val1","val2"]])
    doc.code("echo hello")
    doc.save("/path/to/output.pdf")
"""

import re
import json
import os
from datetime import date
from html import escape as esc

MANIFEST_PATH = '/opt/AIWH/core/docs/user-guide/manifest.json'


# ── CSS (full brand styling) ────────────────────────────────────
CSS = """
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500&display=swap');

:root {
    --accent: #9B7D2E;
    --accent-hot: #C9A84C;
    --accent-light: rgba(155,125,46,0.08);
    --accent-border: rgba(155,125,46,0.25);
    --bg: #FFFFFF;
    --bg-warm: #FAF8F3;
    --text: #1A1815;
    --text-muted: #6B6560;
    --text-dim: #A09A90;
    --border: rgba(0,0,0,0.08);
    --code-bg: #1A1815;
    --code-text: #F5EDD6;
}

@page {
    size: A4;
    margin: 2.2cm 2.5cm 2.5cm 2.5cm;

    @bottom-center {
        content: counter(page);
        font-family: 'Inter', sans-serif;
        font-size: 9px;
        color: var(--text-dim);
    }
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
    font-family: 'Inter', -apple-system, sans-serif;
    font-size: 11pt;
    line-height: 1.6;
    color: var(--text);
    background: var(--bg);
}

/* ── Title Block ─────────────────────────── */
.title-block {
    margin-bottom: 32px;
    padding-bottom: 24px;
    border-bottom: 2px solid var(--accent);
    page-break-after: avoid;
}
.title-block .hex-icon {
    width: 48px;
    height: 48px;
    margin-bottom: 14px;
}
.title-block .hex-icon svg { width: 48px; height: 48px; }
.title-block h1 {
    font-size: 28pt;
    font-weight: 800;
    color: var(--text);
    letter-spacing: -0.02em;
    line-height: 1.1;
    margin-bottom: 8px;
}
.title-block .subtitle {
    font-size: 13pt;
    color: var(--text-muted);
    font-weight: 400;
    margin-top: 4px;
}
.title-block .brand-tag {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-top: 12px;
    font-size: 8pt;
    font-family: 'JetBrains Mono', monospace;
    text-transform: uppercase;
    letter-spacing: 0.2em;
    color: var(--accent);
    background: var(--accent-light);
    padding: 4px 12px;
    border-radius: 4px;
}
.brand-tag .mini-hex { font-size: 10px; }

/* ── Headings ────────────────────────────── */
h2 {
    font-size: 18pt;
    font-weight: 700;
    color: var(--text);
    margin-top: 28px;
    margin-bottom: 10px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--border);
    page-break-after: avoid;
}
h2 .hex-marker {
    display: inline-block;
    width: 14px;
    height: 14px;
    margin-right: 10px;
    vertical-align: -1px;
    position: relative;
    top: -1px;
}
h2 .hex-marker svg { width: 14px; height: 14px; display: block; }
h3 {
    font-size: 13pt;
    font-weight: 600;
    color: var(--accent);
    margin-top: 20px;
    margin-bottom: 6px;
    page-break-after: avoid;
}
h4 {
    font-size: 11pt;
    font-weight: 600;
    color: var(--text-muted);
    margin-top: 14px;
    margin-bottom: 4px;
    page-break-after: avoid;
}

/* ── Body text ───────────────────────────── */
p {
    margin-bottom: 8px;
    orphans: 3;
    widows: 3;
}
strong { font-weight: 600; }
em { font-style: italic; color: var(--text-muted); }

/* ── Lists ───────────────────────────────── */
ul, ol {
    margin: 6px 0 12px 0;
    padding-left: 0;
    list-style: none;
}
ul li, ol li {
    position: relative;
    padding-left: 20px;
    margin-bottom: 5px;
    line-height: 1.5;
}
ul li::before {
    content: '⬡';
    position: absolute;
    left: 0;
    top: -1px;
    font-size: 11px;
    color: var(--accent);
    line-height: 1.5;
}
ol { counter-reset: item; }
ol li { counter-increment: item; }
ol li::before {
    content: counter(item);
    position: absolute;
    left: 0;
    top: 0;
    font-size: 10pt;
    font-weight: 700;
    color: var(--accent);
    font-family: 'JetBrains Mono', monospace;
}

/* ── Tables ──────────────────────────────── */
table {
    width: 100%;
    border-collapse: collapse;
    margin: 12px 0 16px 0;
    font-size: 10pt;
    page-break-inside: avoid;
}
thead th {
    background: linear-gradient(135deg, var(--accent), var(--accent-hot));
    color: #FFFFFF;
    font-weight: 600;
    text-align: left;
    padding: 10px 14px;
    font-size: 9.5pt;
    text-transform: uppercase;
    letter-spacing: 0.04em;
}
thead th:first-child { border-radius: 6px 0 0 0; }
thead th:last-child { border-radius: 0 6px 0 0; }
tbody td {
    padding: 8px 14px;
    border-bottom: 1px solid var(--border);
    vertical-align: top;
}
tbody tr:nth-child(even) td {
    background: var(--bg-warm);
}
tbody tr:last-child td:first-child { border-radius: 0 0 0 6px; }
tbody tr:last-child td:last-child { border-radius: 0 0 6px 0; }

/* ── Callout boxes ───────────────────────── */
.callout {
    background: var(--bg-warm);
    border-left: 4px solid var(--accent);
    border-radius: 0 8px 8px 0;
    padding: 14px 18px;
    margin: 14px 0;
    page-break-inside: avoid;
}
.callout .callout-label {
    font-size: 9pt;
    font-weight: 700;
    color: var(--accent);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-family: 'JetBrains Mono', monospace;
    margin-bottom: 4px;
}
.callout p { margin-bottom: 0; font-size: 10.5pt; }

.callout-tip { border-left-color: #2D8A56; }
.callout-tip .callout-label { color: #2D8A56; }

.callout-cost { border-left-color: #C9A84C; }
.callout-cost .callout-label { color: #C9A84C; }

.callout-security { border-left-color: #B54E4E; }
.callout-security .callout-label { color: #B54E4E; }

.callout-warning { border-left-color: #D4782F; }
.callout-warning .callout-label { color: #D4782F; }

/* ── Code blocks ─────────────────────────── */
.code-block {
    background: var(--code-bg);
    color: var(--code-text);
    font-family: 'JetBrains Mono', monospace;
    font-size: 9.5pt;
    line-height: 1.5;
    padding: 14px 18px;
    border-radius: 8px;
    margin: 10px 0 14px 0;
    page-break-inside: avoid;
    white-space: pre-wrap;
    word-break: break-all;
}
code {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9.5pt;
    background: var(--accent-light);
    padding: 2px 6px;
    border-radius: 4px;
    color: var(--accent);
}

/* ── Divider (hex pattern) ────────────────── */
.divider {
    border: none;
    text-align: center;
    margin: 28px 0;
    font-size: 10px;
    letter-spacing: 6px;
    color: var(--accent-border);
    line-height: 1;
}
.divider::before {
    content: '⬡ ⬡ ⬡ ⬡ ⬡ ⬡ ⬡ ⬡ ⬡ ⬡ ⬡ ⬡ ⬡';
}

/* ── Page break ──────────────────────────── */
.page-break { page-break-before: always; }

/* ── Feature card grid ───────────────────── */
.card-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin: 12px 0 16px 0;
}
.card {
    background: var(--bg-warm);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 14px 16px;
    page-break-inside: avoid;
}
.card .card-title {
    font-weight: 700;
    font-size: 10.5pt;
    color: var(--accent);
    margin-bottom: 4px;
    display: flex;
    align-items: center;
    gap: 6px;
}
.card .card-title::before {
    content: '⬢';
    font-size: 12px;
    color: var(--accent);
}
.card p {
    font-size: 10pt;
    color: var(--text-muted);
    margin-bottom: 0;
}

/* ── Footer ──────────────────────────────── */
.footer {
    margin-top: 40px;
    padding-top: 16px;
    border-top: 1px solid var(--border);
    text-align: center;
    font-size: 8pt;
    color: var(--text-dim);
    font-family: 'JetBrains Mono', monospace;
    text-transform: uppercase;
    letter-spacing: 0.15em;
}
"""


class BrandPDF:
    def __init__(self, title, subtitle=None):
        self._parts = []
        self._add_title_block(title, subtitle)

    # SVG hexagon for title block
    HEX_ICON = (
        '<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">'
        '<path d="M24 2 L44 14 L44 34 L24 46 L4 34 L4 14 Z" '
        'fill="url(#hg)" stroke="#9B7D2E" stroke-width="1.5"/>'
        '<defs><linearGradient id="hg" x1="0" y1="0" x2="48" y2="48">'
        '<stop offset="0%" stop-color="rgba(155,125,46,0.12)"/>'
        '<stop offset="100%" stop-color="rgba(201,168,76,0.08)"/>'
        '</linearGradient></defs>'
        '<text x="24" y="29" text-anchor="middle" fill="#9B7D2E" '
        'font-family="Inter,sans-serif" font-weight="800" font-size="16">A</text>'
        '</svg>'
    )
    # Small hex marker for h2
    HEX_SM = (
        '<svg viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">'
        '<path d="M7 0.5 L13 3.5 L13 10.5 L7 13.5 L1 10.5 L1 3.5 Z" '
        'fill="#9B7D2E"/></svg>'
    )

    def _add_title_block(self, title, subtitle):
        html = '<div class="title-block">'
        html += f'<div class="hex-icon">{self.HEX_ICON}</div>'
        html += f'<h1>{esc(title)}</h1>'
        if subtitle:
            html += f'<div class="subtitle">{esc(subtitle)}</div>'
        html += '<div class="brand-tag"><span class="mini-hex">⬢</span> AI Wealth Hub</div>'
        html += '</div>'
        self._parts.append(html)

    def h1(self, text):
        self._parts.append(
            f'<h2><span class="hex-marker">{self.HEX_SM}</span>{self._fmt(text)}</h2>'
        )

    def h2(self, text):
        self._parts.append(f'<h3>{self._fmt(text)}</h3>')

    def h3(self, text):
        self._parts.append(f'<h4>{self._fmt(text)}</h4>')

    def body(self, text):
        self._parts.append(f'<p>{self._fmt(text)}</p>')

    def bold_body(self, text):
        self._parts.append(f'<p><strong>{esc(text)}</strong></p>')

    def bullet(self, items):
        """Accept a single string or list of strings."""
        if isinstance(items, str):
            items = [items]
        html = '<ul>'
        for item in items:
            html += f'<li>{self._fmt(item)}</li>'
        html += '</ul>'
        self._parts.append(html)

    def numbered(self, items):
        """Accept a single string or list of strings."""
        if isinstance(items, str):
            items = [items]
        html = '<ol>'
        for item in items:
            html += f'<li>{self._fmt(item)}</li>'
        html += '</ol>'
        self._parts.append(html)

    def callout(self, text, label="NOTE"):
        cls_map = {
            'TIP': 'callout-tip', 'COST': 'callout-cost',
            'SECURITY': 'callout-security', 'WARNING': 'callout-warning',
        }
        extra_cls = cls_map.get(label.upper(), '')
        self._parts.append(
            f'<div class="callout {extra_cls}">'
            f'<div class="callout-label">⬢ {esc(label)}</div>'
            f'<p>{self._fmt(text)}</p>'
            f'</div>'
        )

    def table(self, rows):
        if not rows or len(rows) < 2:
            return
        html = '<table><thead><tr>'
        for cell in rows[0]:
            html += f'<th>{esc(str(cell))}</th>'
        html += '</tr></thead><tbody>'
        for row in rows[1:]:
            html += '<tr>'
            for cell in row:
                html += f'<td>{self._fmt(str(cell))}</td>'
            html += '</tr>'
        html += '</tbody></table>'
        self._parts.append(html)

    def code(self, text):
        self._parts.append(
            f'<div class="code-block">{esc(text.strip())}</div>'
        )

    def card_grid(self, cards):
        """Cards: list of (title, description) tuples."""
        html = '<div class="card-grid">'
        for title, desc in cards:
            html += (
                f'<div class="card">'
                f'<div class="card-title">{esc(title)}</div>'
                f'<p>{self._fmt(desc)}</p>'
                f'</div>'
            )
        html += '</div>'
        self._parts.append(html)

    def divider(self):
        self._parts.append('<hr class="divider">')

    def page_break(self):
        self._parts.append('<div class="page-break"></div>')

    def spacer(self):
        self._parts.append('<div style="height:16px"></div>')

    def _fmt(self, text):
        """Convert **bold** and *italic* markers, preserve HTML safety."""
        t = esc(text)
        t = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', t)
        t = re.sub(r'\*([^*]+)\*', r'<em>\1</em>', t)
        t = re.sub(r'`([^`]+)`', r'<code>\1</code>', t)
        return t

    def _build_html(self):
        today = date.today().strftime('%d %B %Y')
        body = '\n'.join(self._parts)
        footer = (
            '<div class="footer">'
            f'⬢ AI Wealth Hub &mdash; Confidential &mdash; Last updated {today} ⬢'
            '</div>'
        )
        return (
            '<!DOCTYPE html><html lang="en"><head>'
            '<meta charset="utf-8">'
            f'<style>{CSS}</style>'
            f'</head><body>{body}{footer}</body></html>'
        )

    def save(self, path):
        """Save as PDF via Playwright Chromium. Updates manifest.json."""
        from playwright.sync_api import sync_playwright

        html_content = self._build_html()

        # Also save the HTML for debugging / browser preview
        html_path = path.replace('.pdf', '.html')
        with open(html_path, 'w') as f:
            f.write(html_content)

        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page()
            page.set_content(html_content, wait_until='networkidle')
            page.pdf(
                path=path,
                format='A4',
                print_background=True,
                margin={
                    'top': '2.2cm',
                    'bottom': '2.5cm',
                    'left': '2.5cm',
                    'right': '2.5cm',
                },
            )
            browser.close()

        # Auto-update manifest.json
        self._update_manifest(path)

        return path

    @staticmethod
    def _update_manifest(pdf_path):
        """Update manifest.json entry for this doc (last_edited, version, status)."""
        if not os.path.exists(MANIFEST_PATH):
            return

        try:
            with open(MANIFEST_PATH) as f:
                manifest = json.load(f)
        except (json.JSONDecodeError, IOError):
            return

        # Compute relative path from user-guide root
        guide_root = os.path.dirname(MANIFEST_PATH)
        try:
            rel_path = os.path.relpath(pdf_path, guide_root)
        except ValueError:
            return

        today = date.today().isoformat()

        for doc in manifest.get('documents', []):
            if doc['file'] == rel_path:
                doc['last_edited'] = today
                doc['version'] = doc.get('version', 0) + 1
                doc['status'] = 'current'
                break

        manifest['meta']['last_checked'] = today

        with open(MANIFEST_PATH, 'w') as f:
            json.dump(manifest, f, indent=2)
            f.write('\n')
