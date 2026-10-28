/**
 * Canvas painters cannot read CSS variables, so cardPaint.ts mirrors a few
 * tokens as literals. This fails if they drift from theme/tokens.css.
 *
 * Run: npx tsx --test apps/web/src/results/canvasPalette.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { BG, BLUE, BLUE_TEXT, FG, ICE, MUTED, PANEL, RED, RED_TEXT } from "./cardPaint.ts";

const css = readFileSync(new URL("../theme/tokens.css", import.meta.url), "utf8");
const token = (name: string): string => {
  const m = css.match(new RegExp(`--${name}:\\s*([^;]+);`));
  assert.ok(m, `token --${name} exists`);
  return m[1].trim();
};
const hex = (rgb: string): string =>
  "#" + rgb.split(/\s+/).map((n) => Number(n).toString(16).padStart(2, "0")).join("");

/** A token's final colour as #rrggbb, following var() aliases. */
const hexOf = (name: string): string => {
  const v = token(name);
  const alias = v.match(/^var\(--([\w-]+)\)$/);
  if (alias) return hexOf(alias[1]);
  assert.ok(v.startsWith("#"), `--${name} is a #hex`);
  return v.toLowerCase();
};

test("canvas colours mirror the design tokens", () => {
  assert.equal(BG, hexOf("bg"));
  assert.equal(PANEL, hexOf("surface"));
  assert.equal(FG, hexOf("text"));
  assert.equal(MUTED, hexOf("muted"));
  assert.equal(RED, hexOf("red"));
  assert.equal(RED_TEXT, hexOf("red-text"));
  assert.equal(BLUE, hexOf("blue"));
  assert.equal(BLUE_TEXT, hexOf("blue-text"));
  assert.equal(ICE, hexOf("ice"));
  // The rgb channels used for alpha variants match the hex values.
  for (const [name, h] of [["bg", BG], ["surface", PANEL], ["text", FG], ["red", RED], ["blue", BLUE], ["ice", ICE]] as const) {
    assert.equal(hex(token(`${name}-rgb`)), h, `--${name}-rgb`);
  }
});
