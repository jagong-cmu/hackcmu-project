/**
 * Canvas painters cannot read CSS variables, so cardPaint.ts mirrors a few
 * tokens as literals. This fails if they drift from theme/tokens.css.
 *
 * Run: npx tsx --test apps/web/src/results/canvasPalette.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { ACCENT, ACCENT_DEEP, DANGER, FG, GOOD, INK, PANEL, WARN } from "./cardPaint.ts";

const css = readFileSync(new URL("../theme/tokens.css", import.meta.url), "utf8");
const token = (name: string): string => {
  const m = css.match(new RegExp(`--${name}:\\s*([^;]+);`));
  assert.ok(m, `token --${name} exists`);
  return m[1].trim();
};
const hex = (rgb: string): string =>
  "#" + rgb.split(/\s+/).map((n) => Number(n).toString(16).padStart(2, "0")).join("");

test("canvas colours mirror the design tokens", () => {
  assert.equal(INK, hex(token("ink-rgb")));
  assert.equal(PANEL, hex(token("surface-rgb")));
  assert.equal(FG, hex(token("fg-rgb")));
  assert.equal(ACCENT, token("amber-400"));
  assert.equal(ACCENT_DEEP, token("amber-600"));
  assert.equal(GOOD, token("positive"));
  assert.equal(WARN, token("warning"));
  assert.equal(DANGER, token("danger"));
});
