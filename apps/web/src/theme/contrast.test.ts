/**
 * WCAG AA for the text/background pairs the UI actually uses, computed from
 * tokens.css so a palette edit that breaks contrast fails here, not in review.
 * Body text needs 4.5:1; large text 3:1.
 *
 * Run: npx tsx --test apps/web/src/theme/contrast.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const css = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");
const raw = (name: string): string => {
  const m = css.match(new RegExp(`--${name}:\\s*([^;]+);`));
  assert.ok(m, `token --${name} exists`);
  return m[1].trim();
};
type RGB = [number, number, number];
const channels = (name: string): RGB => raw(name).split(/\s+/).map(Number) as RGB;
const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;

/** A token's solid colour: a #hex, or `rgb(var(--x-rgb) / a)` composited over `under`. */
function colour(name: string, under?: RGB): RGB {
  const v = raw(name);
  const alias = v.match(/^var\(--([\w-]+)\)$/);
  if (alias) return colour(alias[1], under);
  if (v.startsWith("#")) return hex(v);
  const m = v.match(/^rgb\(var\(--([\w-]+)\)(?:\s*\/\s*([\d.]+))?\)$/);
  assert.ok(m, `--${name} is #hex or rgb(var(--*-rgb) / a)`);
  const c = channels(m[1]);
  const a = m[2] ? Number(m[2]) : 1;
  if (a === 1) return c;
  assert.ok(under, `--${name} has alpha, so it needs a background to sit on`);
  return c.map((x, i) => x * a + under[i] * (1 - a)) as RGB;
}

const lum = ([r, g, b]: RGB): number => {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a: RGB, b: RGB): number => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const GROUNDS = ["ink", "surface", "surface-2", "surface-3"];
const bg = (n: string): RGB => (n === "ink" ? channels("ink-rgb") : n === "surface" ? channels("surface-rgb") : colour(n));
const grounds = GROUNDS.map((n) => [n, bg(n)] as const);

for (const [text, min] of [
  ["fg", 4.5],
  ["fg-dim", 4.5],
  ["accent", 4.5],
  ["amber-200", 4.5],
  ["positive", 4.5],
  ["warning", 4.5],
  ["danger", 4.5],
  ["neon", 4.5],
] as const) {
  test(`--${text} on every ground`, () => {
    for (const [name, g] of grounds) {
      const r = ratio(colour(text, g), g);
      assert.ok(r >= min, `--${text} on --${name} is ${r.toFixed(2)}:1, needs ${min}`);
    }
  });
}

// Hints and placeholders are the faintest text we allow: still 4.5:1, on the
// grounds they appear on (not the hover-only surface-3).
test("--fg-faint on ink, surface and surface-2", () => {
  for (const [name, g] of grounds.filter(([n]) => n !== "surface-3")) {
    const r = ratio(colour("fg-faint", g), g);
    assert.ok(r >= 4.5, `--fg-faint on --${name} is ${r.toFixed(2)}:1`);
  }
});

test("button text on the amber fills", () => {
  for (const fill of ["accent", "accent-hi"]) {
    const r = ratio(colour("on-accent"), colour(fill));
    assert.ok(r >= 4.5, `--on-accent on --${fill} is ${r.toFixed(2)}:1`);
  }
});
