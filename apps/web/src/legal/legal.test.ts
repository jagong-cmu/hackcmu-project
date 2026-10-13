/**
 * Privacy Policy / Terms: the static HTML copies carry the full text, and the
 * renderer escapes content and only links safe hrefs.
 *
 * Run: npx tsx --test apps/web/src/legal/legal.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { privacyPolicy, termsOfService } from "./content.ts";
import { LEGAL_CONTACT_EMAIL, LEGAL_LAST_UPDATED } from "./contact.ts";
import { formatLegalDate, inlineHtml, legalStaticHtml } from "./render.ts";

const INDEX = `<!doctype html><html><head><title>Aria</title>
<meta name="description" content="1v1 karaoke." />
<meta property="og:title" content="Aria" />
<meta property="og:url" content="https://karaoke-arena.vercel.app/" />
</head><body><div id="root"></div><script type="module" src="/assets/x.js"></script></body></html>`;

test("inline markup: escapes HTML, bold, safe links only", () => {
  assert.equal(inlineHtml("a <b> & c"), "a &lt;b&gt; &amp; c");
  assert.equal(inlineHtml("**hi**"), "<strong>hi</strong>");
  assert.equal(inlineHtml("[Terms](/terms)"), `<a href="/terms">Terms</a>`);
  assert.equal(inlineHtml("[m](mailto:a@b.c)"), `<a href="mailto:a@b.c">m</a>`);
  assert.equal(inlineHtml("[x](javascript:alert(1))"), "[x](javascript:alert(1))");
  assert.equal(inlineHtml("[x](//evil.example)"), "[x](//evil.example)");
});

test("last updated date renders without a timezone shift", () => {
  assert.equal(formatLegalDate("2026-10-13"), "October 13, 2026");
  assert.equal(LEGAL_LAST_UPDATED, "2026-10-13");
});

test("static copies put the whole document in #root, with page meta", () => {
  for (const doc of [privacyPolicy, termsOfService]) {
    const html = legalStaticHtml(INDEX, doc);
    assert.match(html, new RegExp(`<title>${doc.title} · Aria</title>`));
    assert.match(html, new RegExp(`<link rel="canonical" href="https://karaoke-arena.vercel.app/${doc.slug}" />`));
    assert.match(html, /<div id="root"><main class="page bloom-page shell legal-page">/);
    assert.ok(html.includes("October 13, 2026"));
    for (const s of doc.sections) assert.ok(html.includes(`id="${s.id}"`), s.id);
    assert.ok(html.includes(LEGAL_CONTACT_EMAIL));
    // The SPA still boots from it.
    assert.ok(html.includes(`<script type="module" src="/assets/x.js"></script>`));
  }
});

test("privacy policy covers what Google's review looks for", () => {
  const text = JSON.stringify(privacyPolicy);
  for (const needle of ["Google", "Supabase", "LiveKit", "MongoDB", "PostHog", "Vercel", "Gemini", "13", "delete"]) {
    assert.ok(text.includes(needle), needle);
  }
});
