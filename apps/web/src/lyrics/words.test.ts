/**
 * Word-by-word highlight timing.
 *
 * Run: npx tsx --test apps/web/src/lyrics/words.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseLrc } from "./parseLrc.ts";
import { LINE_LEAD_SEC, retimeLines, wordProgress, wordsByLine, type WordsFile } from "./words.ts";

const lrc = parseLrc("[00:10.00]A: When you were\n[00:15.00]B: here before");
const file: WordsFile = {
  version: 1,
  lines: [
    {
      text: "When you were",
      words: [
        { text: "When", start: 10.3, end: 10.5 },
        { text: "you", start: 10.5, end: 10.8 },
        { text: "were", start: 10.8, end: 11 },
      ],
    },
    {
      text: "here before",
      words: [
        { text: "here", start: 15.2, end: 15.4 },
        // Held over three notes; the middle one is longer.
        { text: "before", start: 15.4, end: 17.4, notes: [[15.4, 15.6], [15.6, 17], [17.1, 17.4]] },
      ],
    },
  ],
};

test("a plain word fills linearly through its own time", () => {
  const w = file.lines[0].words[0];
  assert.equal(wordProgress(w, 10.2), 0);
  assert.equal(wordProgress(w, 10.4), 0.5);
  assert.equal(wordProgress(w, 10.5), 1);
});

test("a held word fills one note's share per note, and holds in a gap", () => {
  const w = file.lines[1].words[1];
  assert.ok(Math.abs(wordProgress(w, 15.5) - 1 / 6) < 1e-9);
  assert.ok(Math.abs(wordProgress(w, 16.3) - 1.5 / 3) < 1e-9);
  assert.ok(Math.abs(wordProgress(w, 17.05) - 2 / 3) < 1e-9);
  assert.equal(wordProgress(w, 17.4), 1);
});

test("lines switch LINE_LEAD_SEC before their first word and keep their voice", () => {
  const byLine = wordsByLine(lrc, file);
  const shown = retimeLines(lrc, byLine);
  assert.equal(shown[0].timeSec, 10.3 - LINE_LEAD_SEC);
  assert.equal(shown[1].timeSec, 15.2 - LINE_LEAD_SEC);
  assert.equal(shown[1].voice, "b");
});

test("words that don't spell the LRC line fall back to the line estimate", () => {
  const edited = parseLrc("[00:10.00]When you were\n[00:15.00]here, before");
  const byLine = wordsByLine(edited, file);
  assert.ok(byLine?.[0]);
  assert.equal(byLine?.[1], null);
  assert.equal(retimeLines(edited, byLine)[1].timeSec, 15);
  assert.equal(wordsByLine(parseLrc("[00:10.00]When you were"), file), null);
});
