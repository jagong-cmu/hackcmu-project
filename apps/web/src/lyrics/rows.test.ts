/**
 * Noraebang-style lyric rows: two lines on screen, alternating. Even-numbered
 * lines sit in the top row and odd-numbered lines in the bottom row, so a line
 * is replaced in its own row only once it has been sung. Playback time in,
 * which line is active, which is upcoming, and the count-in out.
 *
 * Run: npx tsx --test apps/web/src/lyrics/rows.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { lyricRows, upcomingRows } from "./rows.ts";
import { parseLrc } from "./parseLrc.ts";

const lines = parseLrc(
  ["[00:10.00]zero", "[00:14.00]one", "[00:18.00]two", "[00:22.00]three", "[00:50.00]four"].join("\n"),
);
const texts = (r: ReturnType<typeof lyricRows>) => r.rows.map((x) => x && `${x.line.text}:${x.state}`);

test("before the first line, the first two lines are upcoming, in their own rows", () => {
  const r = lyricRows(lines, 5);
  assert.deepEqual(texts(r), ["zero:upcoming", "one:upcoming"]);
  assert.equal(r.activeRow, null);
});

test("the active line fills in its row; the other row previews the next line", () => {
  const r = lyricRows(lines, 11);
  assert.deepEqual(texts(r), ["zero:active", "one:upcoming"]);
  assert.equal(r.activeRow, 0);
});

test("lines alternate rows: the odd line is active in the bottom row, the even one after it queues above", () => {
  const r = lyricRows(lines, 15);
  assert.deepEqual(texts(r), ["two:upcoming", "one:active"]);
  assert.equal(r.activeRow, 1);
  assert.deepEqual(texts(lyricRows(lines, 19)), ["two:active", "three:upcoming"]);
});

test("the last line has nothing to preview in the other row", () => {
  const r = lyricRows(lines, 51);
  assert.deepEqual(texts(r), ["four:active", null]);
});

test("after a line's own span in a long gap, both rows show what is coming, with a count-in at the end", () => {
  // "three" starts at 22s; "four" at 50s. Its span is capped, so by 40s it is spent.
  const r = lyricRows(lines, 40);
  assert.deepEqual(texts(r), ["four:upcoming", null]);
  assert.equal(r.activeRow, null);
  assert.equal(r.countIn, null);
  const near = lyricRows(lines, 47);
  assert.equal(near.activeRow, null);
  assert.ok(near.countIn != null && near.countIn > 2.9 && near.countIn <= 3.1);
});

test("no count-in while a line is being sung", () => {
  assert.equal(lyricRows(lines, 11).countIn, null);
  assert.equal(lyricRows(lines, 15).countIn, null);
});

test("empty lyrics and bad time are safe", () => {
  assert.deepEqual(lyricRows([], 3).rows, [null, null]);
  assert.deepEqual(lyricRows(lines, Number.NaN).rows.map((x) => x?.line.text ?? null), ["zero", "one"]);
});

test("upcomingRows lays out a start line and its successor by parity (lead-in)", () => {
  const r = upcomingRows(lines, 1);
  assert.deepEqual(r.rows.map((x) => x && x.line.text), ["two", "one"]);
  assert.deepEqual(upcomingRows(lines, 4).rows.map((x) => x && x.line.text), ["four", null]);
  assert.deepEqual(upcomingRows(lines, 99).rows, [null, null]);
});
