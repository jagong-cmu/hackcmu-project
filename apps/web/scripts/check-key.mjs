#!/usr/bin/env node
/**
 * Checks whether a karaoke cover is in the same key as the studio original.
 *
 * Melodies are extracted from the original's isolated vocal but sung against
 * the karaoke instrumental. If the cover is transposed, every extracted note
 * is wrong by that interval no matter how well the timing aligns — and it
 * looks like a tracking failure rather than a key problem.
 *
 * Compares average chroma across all 12 rotations and reports the best fit.
 *
 *   node check-key.mjs <original.mp3> <karaoke.mp3>
 */
import { A_SR, chroma, decodeMono } from "./lib/align.mjs";

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const [A, B] = process.argv.slice(2);
if (!A || !B) throw new Error("usage: check-key.mjs <original.mp3> <karaoke.mp3>");

function profile(file) {
  const frames = chroma(decodeMono(file, A_SR));
  const v = new Float64Array(12);
  for (const f of frames) for (let k = 0; k < 12; k++) v[k] += f[k];
  let norm = 0;
  for (let k = 0; k < 12; k++) norm += v[k] * v[k];
  norm = Math.sqrt(norm) || 1;
  for (let k = 0; k < 12; k++) v[k] /= norm;
  return v;
}

const pa = profile(A);
const pb = profile(B);

const scores = [];
for (let shift = 0; shift < 12; shift++) {
  let dot = 0;
  for (let k = 0; k < 12; k++) dot += pa[k] * pb[(k + shift) % 12];
  scores.push({ shift, dot });
}
scores.sort((x, y) => y.dot - x.dot);
const best = scores[0];
const unison = scores.find((s) => s.shift === 0);

// Semitones the karaoke sits above the original, folded to -5..+6.
const semis = best.shift > 6 ? best.shift - 12 : best.shift;
console.log(
  `best shift ${semis >= 0 ? "+" : ""}${semis} semitones  (fit ${best.dot.toFixed(3)})   ` +
  `unison fit ${unison.dot.toFixed(3)}   ` +
  `runner-up ${scores[1].shift > 6 ? scores[1].shift - 12 : scores[1].shift} (${scores[1].dot.toFixed(3)})`,
);
if (semis !== 0) {
  console.log(
    `  ! karaoke is transposed ${semis > 0 ? "up" : "down"} ${Math.abs(semis)} semitone(s).\n` +
    `    Melodies extracted from the original's vocal must be shifted by ${semis >= 0 ? "+" : ""}${semis} to match.`,
  );
}
