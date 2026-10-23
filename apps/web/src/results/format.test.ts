/**
 * Score and Elo display strings: positive, negative, zero, unrated, silent.
 *
 * Run: npx tsx --test apps/web/src/results/format.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { formatEloDelta, formatScore } from "./format.ts";

test("a gain shows a plus sign and reads as up", () => {
  assert.deepEqual(formatEloDelta(18, false), { text: "+18 Elo", tone: "up" });
});

test("a loss shows a real minus sign and reads as down", () => {
  assert.deepEqual(formatEloDelta(-12, false), { text: "−12 Elo", tone: "down" });
});

test("zero is said in words, with no sign", () => {
  assert.deepEqual(formatEloDelta(0, false), { text: "Elo unchanged", tone: "flat" });
});

test("an unrated room never shows a number, even a real one", () => {
  assert.deepEqual(formatEloDelta(18, true), { text: "Unrated · friendly match", tone: "unrated" });
  assert.deepEqual(formatEloDelta(0, true), { text: "Unrated · friendly match", tone: "unrated" });
  assert.deepEqual(formatEloDelta(null, true), { text: "Unrated · friendly match", tone: "unrated" });
});

test("no delta (training, duet, still settling) shows nothing", () => {
  assert.equal(formatEloDelta(null, false), null);
  assert.equal(formatEloDelta(undefined, false), null);
  assert.equal(formatEloDelta(Number.NaN, false), null);
});

test("fractional deltas round to whole points", () => {
  assert.equal(formatEloDelta(17.6, false)?.text, "+18 Elo");
  assert.equal(formatEloDelta(-0.4, false)?.text, "Elo unchanged");
});

test("scores are whole numbers clamped to 0..100; silence is dashes", () => {
  assert.equal(formatScore(87.4, false), "87");
  assert.equal(formatScore(100.2, false), "100");
  assert.equal(formatScore(-3, false), "0");
  assert.equal(formatScore(Number.NaN, false), "--");
  assert.equal(formatScore(55, true), "--");
});
