#!/usr/bin/env node
/**
 * Measures how far a karaoke cover sits from the studio original it shares an
 * arrangement with, so lyrics timed to the original land on our track.
 *
 * Chroma/DTW-aligns the two recordings and reports the median inlier drift:
 *   karaoke_t = original_t + offsetSec
 * which is exactly the offsetSec build-song-packs.mjs and extract-melody-stem
 * take.
 *
 * The median is over the middle of the song only. Sparse intros and outros
 * give chroma almost nothing to lock onto, so DTW's path wanders there and
 * those frames would drag a plain mean well off.
 *
 *   node measure-offset.mjs <original.mp3> <karaoke.mp3>
 */
import { A_FPS, A_SR, chroma, decodeMono, dtw } from "./lib/align.mjs";

const [ORIG, KARAOKE] = process.argv.slice(2);
if (!ORIG || !KARAOKE) {
  throw new Error("usage: measure-offset.mjs <original.mp3> <karaoke.mp3>");
}

/** Ignore this fraction at each end, where chroma has little to work with. */
const EDGE_TRIM = 0.12;

const cOrig = chroma(decodeMono(ORIG, A_SR));
const cKar = chroma(decodeMono(KARAOKE, A_SR));
const map = dtw(cOrig, cKar);

const drift = [];
for (let i = 0; i < map.length; i++) drift.push(map[i] / A_FPS - i / A_FPS);

const lo = Math.floor(drift.length * EDGE_TRIM);
const hi = Math.ceil(drift.length * (1 - EDGE_TRIM));
const core = drift.slice(lo, hi).sort((a, b) => a - b);
const median = core[core.length >> 1];

// Spread over the middle says whether this is a clean constant offset or the
// two recordings actually run at different tempos.
const q = (f) => core[Math.min(core.length - 1, Math.floor(core.length * f))];
const iqr = q(0.75) - q(0.25);

console.log(
  `offsetSec ${median >= 0 ? "+" : ""}${median.toFixed(2)}s   ` +
  `IQR ${iqr.toFixed(2)}s   ` +
  `p10 ${q(0.1).toFixed(2)}  p90 ${q(0.9).toFixed(2)}   ` +
  `(${(drift.length / A_FPS).toFixed(0)}s analysed)`,
);
if (iqr > 1.5) {
  console.log("  ! wide IQR — the cover may not track the original's tempo; check by ear.");
}
