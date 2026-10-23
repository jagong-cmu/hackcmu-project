/**
 * The lyric wipe: playback time in, per-word fill out. Pure, so the on-screen
 * fill can be checked without a browser.
 *
 * Run: npx tsx --test apps/web/src/lyrics/wipe.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { SweepFraction, lineSpan, lineWipe } from "./wipe.ts";
import { parseLrc } from "./parseLrc.ts";

const fills = (w: ReturnType<typeof lineWipe>) => w.words.map((x) => Number(x.fill.toFixed(3)));

test("before the line starts nothing is sung", () => {
  const w = lineWipe("hold me tight", 10, 4, 9.9);
  assert.deepEqual(fills(w), [0, 0, 0]);
  assert.equal(w.wordIndex, -1);
  assert.equal(w.progress, 0);
});

test("once the sweep is done every word is full", () => {
  const w = lineWipe("hold me tight", 10, 4, 10 + 4 * SweepFraction);
  assert.deepEqual(fills(w), [1, 1, 1]);
  assert.equal(w.progress, 1);
  assert.deepEqual(fills(lineWipe("hold me tight", 10, 4, 99)), [1, 1, 1]);
});

test("fill is weighted by word length, so long words take longer", () => {
  // "aa bbbb": 2 + 4 letters. Halfway through the sweep = 3 letters sung.
  const t = 10 + (4 * SweepFraction) / 2;
  const w = lineWipe("aa bbbb", 10, 4, t);
  assert.deepEqual(fills(w), [1, 0.25]);
  assert.equal(w.wordIndex, 1);
  assert.equal(w.progress, 0.5);
});

test("the current word is the one mid-fill, and is -1 only before the start", () => {
  const w = lineWipe("one two three", 0, 6, 0.0001);
  assert.equal(w.wordIndex, 0);
  assert.ok(w.words[0].fill > 0 && w.words[0].fill < 1);
  assert.equal(w.words[1].fill, 0);
});

test("fill never moves backwards as time advances", () => {
  let last = -1;
  for (let t = 9; t <= 15; t += 0.05) {
    const p = lineWipe("a hopeless romantic all my life", 10, 4, t).progress;
    assert.ok(p >= last);
    last = p;
  }
});

test("a single word, extra spaces, and empty text do not break", () => {
  assert.deepEqual(fills(lineWipe("La", 0, 2, 0.9)), [0.5]);
  assert.deepEqual(lineWipe("  spaced   out ", 0, 2, 5).words.map((x) => x.text), ["spaced", "out"]);
  const empty = lineWipe("", 0, 2, 1);
  assert.deepEqual(empty.words, []);
  assert.equal(empty.wordIndex, -1);
});

test("a zero or negative span fills as soon as the line starts; NaN is inert", () => {
  assert.deepEqual(fills(lineWipe("go now", 5, 0, 5)), [1, 1]);
  assert.deepEqual(fills(lineWipe("go now", 5, -3, 4.99)), [0, 0]);
  assert.deepEqual(fills(lineWipe("go now", 5, 2, Number.NaN)), [0, 0]);
});

test("lineSpan: next line bounds it, capped, and the last line gets the cap", () => {
  const lines = parseLrc("[00:10.00]one\n[00:13.00]two\n[00:30.00]three");
  assert.equal(lineSpan(lines[0], lines[1]), 3);
  assert.equal(lineSpan(lines[1], lines[2]), 7); // MAX_LINE_SEC
  assert.equal(lineSpan(lines[2], null), 7);
});
