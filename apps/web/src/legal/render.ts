/**
 * LegalDoc -> HTML. Used by the React pages (LegalPage.tsx) and by the build
 * step that writes static copies (vite.config.ts), so both show the same text.
 * Pure string work: no DOM, no React, no `import.meta`.
 */
import type { LegalBlock, LegalDoc } from "./content.ts";
import { LEGAL_SITE_ORIGIN } from "./contact.ts";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const SAFE_HREF = /^(\/(?!\/)|https:\/\/|mailto:)/;

/** Escape, then apply `**bold**` and `[label](href)`. */
export function inlineHtml(text: string): string {
  let out = escapeHtml(text);
  out = out.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (whole, label: string, href: string) => {
    // href is already entity-escaped; check the raw form.
    const raw = href.replace(/&amp;/g, "&");
    return SAFE_HREF.test(raw) ? `<a href="${href}">${label}</a>` : whole;
  });
  return out;
}

function blockHtml(block: LegalBlock): string {
  if (typeof block === "string") return `<p>${inlineHtml(block)}</p>`;
  return `<ul>${block.list.map((item) => `<li>${inlineHtml(item)}</li>`).join("")}</ul>`;
}

/** "2026-10-13" -> "October 13, 2026" (UTC, so it never shifts a day). */
export function formatLegalDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** The document itself: updated line, intro, contents, sections. */
export function legalBodyHtml(doc: LegalDoc): string {
  const toc = doc.sections
    .map((s) => `<li><a href="#${s.id}">${escapeHtml(s.heading)}</a></li>`)
    .join("");
  const sections = doc.sections
    .map(
      (s) =>
        `<section id="${s.id}"><h2>${escapeHtml(s.heading)}</h2>${s.body.map(blockHtml).join("")}</section>`,
    )
    .join("");
  return [
    `<p class="legal-updated">Last updated <time datetime="${doc.updated}">${formatLegalDate(doc.updated)}</time></p>`,
    doc.intro.map(blockHtml).join(""),
    `<nav class="legal-toc" aria-label="Contents"><ol>${toc}</ol></nav>`,
    sections,
  ].join("");
}

/** Links between the two documents, shown at the foot of each. */
export function legalFootHtml(doc: LegalDoc): string {
  const other =
    doc.slug === "privacy"
      ? `<a href="/terms">Terms of Service</a>`
      : `<a href="/privacy">Privacy Policy</a>`;
  return `<p class="legal-foot">${other} · <a href="/">Aria home</a></p>`;
}

/**
 * Full page markup for #root in the static copy. Mirrors PageShell's classes
 * so the built CSS styles it before (or without) JavaScript; React replaces it
 * on load with the same content.
 */
export function legalStaticRoot(doc: LegalDoc): string {
  return (
    `<main class="page bloom-page shell legal-page">` +
    `<header class="page-head"><h1>${escapeHtml(doc.title)}</h1><a href="/" class="back">Home</a></header>` +
    `<div class="shell-inner wide"><article class="legal-doc">${legalBodyHtml(doc)}${legalFootHtml(doc)}</article></div>` +
    `</main>`
  );
}

/**
 * Turn the built index.html into the static page for `doc`: page-specific
 * title, description, canonical and Open Graph URL, and the text in #root.
 */
export function legalStaticHtml(indexHtml: string, doc: LegalDoc): string {
  const title = `${doc.title} · Aria`;
  const url = `${LEGAL_SITE_ORIGIN}/${doc.slug}`;
  let html = indexHtml;
  if (!/<div id="root"><\/div>/.test(html)) {
    throw new Error("legal pages: index.html has no empty <div id=\"root\"></div>");
  }
  html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(title)}</title>`);
  html = html.replace(
    /<meta name="description" content="[^"]*"\s*\/?>/,
    `<meta name="description" content="${escapeHtml(doc.summary)}" />`,
  );
  html = html.replace(
    /<meta property="og:title" content="[^"]*"\s*\/?>/,
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
  );
  html = html.replace(
    /<meta property="og:url" content="[^"]*"\s*\/?>/,
    `<meta property="og:url" content="${url}" />`,
  );
  html = html.replace("</head>", `  <link rel="canonical" href="${url}" />\n  </head>`);
  return html.replace(
    /<div id="root"><\/div>/,
    () => `<div id="root">${legalStaticRoot(doc)}</div>`,
  );
}
