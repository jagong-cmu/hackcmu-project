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
import { MaxLeftLuminance } from "../scene/assetBrief.ts";

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
  ["gold-200", 4.5],
  ["positive", 4.5],
  ["warning", 4.5],
  ["danger", 4.5],
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
  for (const fill of ["accent-fill", "accent-fill-hi"]) {
    const r = ratio(colour("on-accent"), colour(fill));
    assert.ok(r >= 4.5, `--on-accent on --${fill} is ${r.toFixed(2)}:1`);
  }
});

/**
 * Menu text over the room. The scrim darkens the left side, but what is under it
 * is the owner's image, so the asset brief carries a requirement: the left 45%
 * of every room image must be no brighter than MaxLeftLuminance. This proves the
 * scrim plus that requirement meets AA at every x the menu text can reach; the
 * /scene-check dev page measures the real images against the same number.
 */

function scrimAlpha(x: number): number {
  // Mirrors --scrim-left: 0.94 at 0%, 0.78 at 24%, 0.28 at 58%, 0 at 100%.
  const stops: [number, number][] = [[0, 0.94], [0.24, 0.78], [0.58, 0.28], [1, 0]];
  for (let i = 1; i < stops.length; i++) {
    if (x <= stops[i][0]) {
      const [x0, a0] = stops[i - 1];
      const [x1, a1] = stops[i];
      return a0 + ((a1 - a0) * (x - x0)) / (x1 - x0);
    }
  }
  return 0;
}
const grayForLuminance = (l: number): RGB => {
  const c = l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055;
  return [c * 255, c * 255, c * 255];
};

test("menu text over the brightest allowed room pixel, across the scrim", () => {
  const ink = channels("ink-rgb");
  const worst = grayForLuminance(MaxLeftLuminance);
  const check = (name: string, upTo: number) => {
    for (let x = 0.04; x <= upTo; x += 0.02) {
      const a = scrimAlpha(x);
      const bg = ink.map((c, i) => c * a + worst[i] * (1 - a)) as RGB;
      const r = ratio(colour(name, bg), bg);
      assert.ok(r >= 4.5, `--${name} at ${(x * 100).toFixed(0)}% is ${r.toFixed(2)}:1`);
    }
  };
  check("fg", 0.5);
  check("fg-dim", 0.5); // menu items and their description line reach about 45%
  check("fg-faint", 0.3); // legal links sit bottom-left
});
