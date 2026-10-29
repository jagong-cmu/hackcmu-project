#!/usr/bin/env node
/**
 * How far the lyric highlight sits from where the words are actually sung.
 *
 * Reference: the song's words.json (word starts force-aligned to the vocal
 * stem by tools/note_extraction `./ne align`). Songs without one fall back to
 * line starts read off melody.json (the pitch track of the same stem): the
 * first note onset after a rest, nearest the LRC line time.
 *
 *   before  the old display: each LRC line's span spread over its words by
 *           character share
 *   after   the word-timed display: each word lights at its own start
 *
 * Errors are display minus reference, in ms (positive = highlight late). The
 * fit splits them into a constant offset, a drift (ms per minute of song) and
 * the per-word scatter left over. "vs pitch" is each reference word start's
 * distance to the nearest melody.json note onset, an independent check on
 * the alignment itself.
 *
 *   node apps/web/scripts/measure-lyric-sync.mjs creep perfect beauty-and-a-beat
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseLrc } from "../src/lyrics/parseLrc.ts";
import { wordsByLine } from "../src/lyrics/words.ts";

const SONGS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public/songs");
/** Same cap the old SungLine used. */
const MAX_LINE_SEC = 7;
const REST_SEC = 0.3;

function oldWordStarts(lines) {
  return lines.map((line, i) => {
    const next = lines[i + 1];
    const end = Math.min(next?.timeSec ?? line.timeSec + MAX_LINE_SEC, line.timeSec + MAX_LINE_SEC);
    const span = Math.max(0.1, end - line.timeSec);
    const words = line.text.split(/\s+/).filter(Boolean);
    const total = words.reduce((n, w) => n + w.length, 0) || 1;
    let before = 0;
    return words.map((w) => {
      const t = line.timeSec + (span * before) / total;
      before += w.length;
      return t;
    });
  });
}

function onsets(melody) {
  const out = [];
  const phrase = [];
  let rest = Infinity;
  melody.hz.forEach((hz, i) => {
    const t = melody.startSec + i / melody.sampleRateHz;
    if (hz == null) {
      rest += 1 / melody.sampleRateHz;
      return;
    }
    const prev = melody.hz[i - 1];
    if (prev == null || prev !== hz) out.push(t);
    if (rest >= REST_SEC) phrase.push(t);
    rest = 0;
  });
  return { notes: out, phrases: phrase };
}

const nearest = (xs, t) => xs.reduce((b, x) => (Math.abs(x - t) < Math.abs(b - t) ? x : b), Infinity);

function stats(pairs) {
  if (!pairs.length) return null;
  const e = pairs.map((p) => (p.shown - p.ref) * 1000);
  const abs = e.map(Math.abs).sort((a, b) => a - b);
  const n = pairs.length;
  const mx = pairs.reduce((s, p) => s + p.ref, 0) / n;
  const my = e.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  pairs.forEach((p, i) => {
    sxy += (p.ref - mx) * (e[i] - my);
    sxx += (p.ref - mx) ** 2;
  });
  const slope = sxx ? sxy / sxx : 0;
  const resid = pairs.map((p, i) => e[i] - (my + slope * (p.ref - mx)));
  const worst = pairs[e.reduce((b, v, i) => (Math.abs(v) > Math.abs(e[b]) ? i : b), 0)];
  return {
    n,
    medianAbs: abs[Math.floor(n / 2)],
    p90Abs: abs[Math.floor(n * 0.9)],
    worst: `${Math.round((worst.shown - worst.ref) * 1000)} ms "${worst.text}" @${worst.ref.toFixed(2)}s`,
    offset: my,
    driftPerMin: slope * 60,
    scatterSd: Math.sqrt(resid.reduce((s, v) => s + v * v, 0) / n),
  };
}

function fmt(label, s) {
  if (!s) return `  ${label}: no data`;
  const r = Math.round;
  return (
    `  ${label} (${s.n}): median |err| ${r(s.medianAbs)} ms, p90 ${r(s.p90Abs)} ms, worst ${s.worst}\n` +
    `      offset ${r(s.offset)} ms, drift ${r(s.driftPerMin)} ms/min, scatter sd ${r(s.scatterSd)} ms`
  );
}

for (const id of process.argv.slice(2)) {
  const dir = path.join(SONGS, id);
  const lines = parseLrc(readFileSync(path.join(dir, "lyrics.lrc"), "utf8"));
  const melody = JSON.parse(readFileSync(path.join(dir, "melody.json"), "utf8"));
  const on = onsets(melody);
  const old = oldWordStarts(lines);
  const wordsFile = existsSync(path.join(dir, "words.json"))
    ? JSON.parse(readFileSync(path.join(dir, "words.json"), "utf8"))
    : null;
  const byLine = wordsByLine(lines, wordsFile);
  console.log(`\n${id}${byLine ? "  (reference: words.json)" : "  (no words.json: line starts vs pitch-track phrase onsets)"}`);

  if (byLine) {
    const before = [];
    const after = [];
    const lineBefore = [];
    const vsPitch = [];
    byLine.forEach((words, li) => {
      if (!words) return;
      lineBefore.push({ shown: lines[li].timeSec, ref: words[0].start, text: words[0].text });
      words.forEach((w, wi) => {
        before.push({ shown: old[li][wi], ref: w.start, text: w.text });
        after.push({ shown: w.start, ref: w.start, text: w.text });
        vsPitch.push({ shown: w.start, ref: nearest(on.notes, w.start), text: w.text });
      });
    });
    console.log(fmt("before, line start", stats(lineBefore)));
    console.log(fmt("before, word", stats(before)));
    console.log(fmt("after,  word", stats(after)));
    console.log(fmt("reference vs pitch onset", stats(vsPitch)));
  } else {
    const pairs = lines
      .map((l) => ({ shown: l.timeSec, ref: nearest(on.phrases, l.timeSec), text: l.text.split(/\s+/)[0] }))
      .filter((p) => Math.abs(p.shown - p.ref) <= 1.5);
    console.log(fmt("before, line start", stats(pairs)));
    console.log(`  (${lines.length - pairs.length} of ${lines.length} lines had no phrase onset within 1.5 s)`);
  }
}
