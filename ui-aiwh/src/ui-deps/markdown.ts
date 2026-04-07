/**
 * Lightweight markdown-to-HTML for the AIWH chat UI.
 * Zero npm deps — replaces marked + DOMPurify to avoid Vite lib-mode
 * externalization issues. Handles the subset needed for chat messages:
 * code blocks, inline code, bold, italic, links, lists, headings, tables.
 *
 * Original: openclaw/ui/src/ui/markdown.ts (286 lines, marked + DOMPurify)
 */

import { truncateText } from "./format.ts";

const MARKDOWN_CHAR_LIMIT = 140_000;
const MARKDOWN_CACHE_LIMIT = 200;
const MARKDOWN_CACHE_MAX_CHARS = 50_000;
const markdownCache = new Map<string, string>();

function getCached(key: string): string | null {
  const v = markdownCache.get(key);
  if (v === undefined) {
    return null;
  }
  markdownCache.delete(key);
  markdownCache.set(key, v);
  return v;
}

function setCache(key: string, value: string) {
  markdownCache.set(key, value);
  if (markdownCache.size > MARKDOWN_CACHE_LIMIT) {
    const oldest = markdownCache.keys().next().value;
    if (oldest) {
      markdownCache.delete(oldest);
    }
  }
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const SAFE_HREF_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

function isSafeHref(href: string): boolean {
  // Decode HTML entities that esc() may have introduced (e.g. &#58; for :)
  const decoded = href
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  const trimmed = decoded.trim();
  // Relative URLs and fragment-only are safe
  if (trimmed.startsWith("/") || trimmed.startsWith("#") || trimmed.startsWith("?")) {
    return true;
  }
  // Check protocol
  const colonIdx = trimmed.indexOf(":");
  if (colonIdx < 0) {
    return true;
  } // no protocol = relative
  const protocol = trimmed.slice(0, colonIdx + 1).toLowerCase();
  return SAFE_HREF_PROTOCOLS.has(protocol);
}

/** Parse markdown to sanitized HTML */
export function toSanitizedMarkdownHtml(markdown: string): string {
  const input = markdown.trim();
  if (!input) {
    return "";
  }
  if (input.length <= MARKDOWN_CACHE_MAX_CHARS) {
    const cached = getCached(input);
    if (cached !== null) {
      return cached;
    }
  }
  const { text } = truncateText(input, MARKDOWN_CHAR_LIMIT);
  const result = renderMarkdown(text);
  if (input.length <= MARKDOWN_CACHE_MAX_CHARS) {
    setCache(input, result);
  }
  return result;
}

function renderMarkdown(src: string): string {
  // Split into code blocks and non-code sections
  const parts: string[] = [];
  let rest = src;

  while (rest.length > 0) {
    const codeStart = rest.indexOf("```");
    if (codeStart === -1) {
      parts.push(renderInlineMarkdown(rest));
      break;
    }
    // Render text before code block
    if (codeStart > 0) {
      parts.push(renderInlineMarkdown(rest.slice(0, codeStart)));
    }
    // Find code block end
    const afterOpen = rest.indexOf("\n", codeStart);
    if (afterOpen === -1) {
      parts.push(renderInlineMarkdown(rest.slice(codeStart)));
      break;
    }
    const lang = rest.slice(codeStart + 3, afterOpen).trim();
    const codeEnd = rest.indexOf("\n```", afterOpen);
    if (codeEnd === -1) {
      // Unclosed code block — render as code anyway
      const code = rest.slice(afterOpen + 1);
      parts.push(renderCodeBlock(code, lang));
      break;
    }
    const code = rest.slice(afterOpen + 1, codeEnd);
    parts.push(renderCodeBlock(code, lang));
    rest = rest.slice(codeEnd + 4);
  }

  return parts.join("");
}

function renderCodeBlock(code: string, lang: string): string {
  const escaped = esc(code);
  const langClass = lang ? ` class="language-${esc(lang)}"` : "";
  const langLabel = lang ? `<span class="code-block-lang">${esc(lang)}</span>` : "";
  const attrSafe = code
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const copyBtn = `<button type="button" class="code-block-copy" data-code="${attrSafe}" aria-label="Copy code"><span class="code-block-copy__idle">Copy</span><span class="code-block-copy__done">Copied!</span></button>`;
  const header = `<div class="code-block-header">${langLabel}${copyBtn}</div>`;

  const trimmed = code.trim();
  const isJson =
    lang === "json" ||
    (!lang &&
      ((trimmed.startsWith("{") && trimmed.endsWith("}")) ||
        (trimmed.startsWith("[") && trimmed.endsWith("]"))));
  if (isJson) {
    const lines = code.split("\n").length;
    const label = lines > 1 ? `JSON &middot; ${lines} lines` : "JSON";
    return `<details class="json-collapse"><summary>${label}</summary><div class="code-block-wrapper">${header}<pre><code${langClass}>${escaped}</code></pre></div></details>`;
  }
  return `<div class="code-block-wrapper">${header}<pre><code${langClass}>${escaped}</code></pre></div>`;
}

function renderInlineMarkdown(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let inList: "ul" | "ol" | null = null;
  let inTable = false;
  let tableRows: string[][] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Table detection (| col | col |)
    if (trimmed.startsWith("|") && trimmed.endsWith("|") && trimmed.includes("|")) {
      if (!inTable) {
        closeList();
        inTable = true;
        tableRows = [];
      }
      // Skip separator rows (|---|---|)
      if (/^\|[\s\-:|]+\|$/.test(trimmed)) {
        continue;
      }
      const cells = trimmed
        .slice(1, -1)
        .split("|")
        .map((c) => c.trim());
      tableRows.push(cells);
      continue;
    } else if (inTable) {
      flushTable();
    }

    // Headings
    const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      closeList();
      const level = headingMatch[1].length;
      out.push(`<h${level}>${inlineFormat(headingMatch[2])}</h${level}>`);
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      closeList();
      out.push("<hr>");
      continue;
    }

    // Unordered list
    if (/^[-*+]\s+/.test(trimmed)) {
      if (inList !== "ul") {
        closeList();
        inList = "ul";
        out.push("<ul>");
      }
      out.push(`<li>${inlineFormat(trimmed.replace(/^[-*+]\s+/, ""))}</li>`);
      continue;
    }

    // Ordered list
    const olMatch = trimmed.match(/^(\d+)[.)]\s+(.+)/);
    if (olMatch) {
      if (inList !== "ol") {
        closeList();
        inList = "ol";
        out.push("<ol>");
      }
      out.push(`<li>${inlineFormat(olMatch[2])}</li>`);
      continue;
    }

    // Blockquote
    if (trimmed.startsWith("> ")) {
      closeList();
      out.push(`<blockquote>${inlineFormat(trimmed.slice(2))}</blockquote>`);
      continue;
    }

    // Empty line = paragraph break
    if (!trimmed) {
      closeList();
      out.push("<br>");
      continue;
    }

    // Regular paragraph
    closeList();
    out.push(`<p>${inlineFormat(trimmed)}</p>`);
  }

  closeList();
  if (inTable) {
    flushTable();
  }
  return out.join("\n");

  function closeList() {
    if (inList) {
      out.push(inList === "ul" ? "</ul>" : "</ol>");
      inList = null;
    }
  }

  function flushTable() {
    if (!tableRows.length) {
      inTable = false;
      return;
    }
    let html = "<table><thead><tr>";
    const header = tableRows[0];
    for (const cell of header) {
      html += `<th>${inlineFormat(cell)}</th>`;
    }
    html += "</tr></thead>";
    if (tableRows.length > 1) {
      html += "<tbody>";
      for (let r = 1; r < tableRows.length; r++) {
        html += "<tr>";
        for (const cell of tableRows[r]) {
          html += `<td>${inlineFormat(cell)}</td>`;
        }
        html += "</tr>";
      }
      html += "</tbody>";
    }
    html += "</table>";
    out.push(html);
    inTable = false;
    tableRows = [];
  }
}

function inlineFormat(text: string): string {
  let s = esc(text);
  // Inline code
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  // Bold
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  // Italic
  s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  s = s.replace(/_([^_]+)_/g, "<em>$1</em>");
  // Strikethrough
  s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  // Links [text](url) — validate protocol to prevent javascript: XSS
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, linkText, href) => {
    return isSafeHref(href)
      ? `<a href="${href}" rel="noreferrer noopener" target="_blank">${linkText}</a>`
      : linkText;
  });
  // Auto-link URLs
  s = s.replace(
    /(^|[^"=])(https?:\/\/[^\s<]+[^\s<.,:;"')\]])/g,
    '$1<a href="$2" rel="noreferrer noopener" target="_blank">$2</a>',
  );
  return s;
}
