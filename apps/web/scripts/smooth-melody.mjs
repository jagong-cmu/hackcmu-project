#!/usr/bin/env node
/**
 * Cleans octave errors and tracking flecks out of an extracted melody.json.
 *
 * Pitch trackers occasionally lock onto a harmonic or a subharmonic, which
 * shows up as a note sitting an exact octave away from everything around it.
 * Those fold back. Short stray notes far from the local line are tracking
 * noise and are dropped. A long leap that is NOT close to an octave is left
 * alone -- it is probably real (falsetto, an octave jump the singer actually
 * sang), and silently flattening those would rewrite the tune.
 *
 *   node smooth-melody.mjs <packDir> [--dry]
 */
import fs from "node:fs";
import path from "node:path";

const LOCAL_WINDOW_SEC = 6; // context for "what is normal around here"
const OUTLIER_ST = 9; // semitones from local median before we intervene
const OCTAVE_TOL = 2.5; // how close to an exact octave a fold has to land
const FLECK_SEC = 0.22; // short strays get dropped rather than folded
const MIN_RUN_SEC = 0.1; // anything shorter is never a sung note

const [PACK_DIR, ...flags] = process.argv.slice(2);
if (!PACK_DIR) throw new Error("usage: smooth-melody.mjs <packDir> [--dry]");
const dry = flags.includes("--dry");

const file = path.join(PACK_DIR, "melody.json");
const mel = JSON.parse(fs.readFileSync(file, "utf8"));
const sr = mel.sampleRateHz;
const hzToMidi = (hz) => Math.round(69 + 12 * Math.log2(hz / 440));
const midiToHz = (m) => +(440 * 2 ** ((m - 69) / 12)).toFixed(2);

const midi = mel.hz.map((v) => (v == null ? null : hzToMidi(v)));
const n = midi.length;

// contiguous same-note runs
const runs = [];
{
  let cur = null;
  let start = 0;
  for (let i = 0; i <= n; i++) {
    const v = i < n ? midi[i] : null;
    if (v !== cur) {
      if (cur != null) runs.push({ from: start, to: i, midi: cur });
      cur = v;
      start = i;
    }
  }
}

/** median voiced note within +/- LOCAL_WINDOW_SEC of a frame */
const half = Math.round(LOCAL_WINDOW_SEC * sr);
function localMedian(centre) {
  const vals = [];
  for (let i = Math.max(0, centre - half); i < Math.min(n, centre + half); i++) {
    if (midi[i] != null) vals.push(midi[i]);
  }
  if (!vals.length) return null;
  vals.sort((a, b) => a - b);
  return vals[vals.length >> 1];
}

let folded = 0;
let dropped = 0;
let kept = 0;

for (const run of runs) {
  const durSec = (run.to - run.from) / sr;
  if (durSec < MIN_RUN_SEC) {
    run.drop = true;
    dropped++;
    continue;
  }
  const centre = (run.from + run.to) >> 1;
  const med = localMedian(centre);
  if (med == null) continue;
  const delta = run.midi - med;
  if (Math.abs(delta) < OUTLIER_ST) continue;

  // an exact-octave error folds back toward the local line
  let bestShift = 0;
  let bestDist = Math.abs(delta);
  for (const shift of [-24, -12, 12, 24]) {
    const d = Math.abs(delta + shift);
    if (d < bestDist && Math.abs(Math.abs(shift) - Math.abs(delta)) <= OCTAVE_TOL) {
      bestDist = d;
      bestShift = shift;
    }
  }
  if (bestShift !== 0 && bestDist < OUTLIER_ST) {
    run.midi += bestShift;
    folded++;
  } else if (durSec < FLECK_SEC) {
    run.drop = true;
    dropped++;
  } else {
    kept++;
  }
}

const out = new Array(n).fill(null);
for (const run of runs) {
  if (run.drop) continue;
  const hz = midiToHz(run.midi);
  for (let i = run.from; i < run.to; i++) out[i] = hz;
}

const before = mel.hz.filter((v) => v != null).length;
const after = out.filter((v) => v != null).length;
console.log(
  `${path.basename(PACK_DIR).padEnd(22)} runs ${runs.length}  ` +
  `folded ${folded}  dropped ${dropped}  kept-as-real ${kept}  ` +
  `voiced ${((before / n) * 100).toFixed(0)}% -> ${((after / n) * 100).toFixed(0)}%${dry ? "  (dry run)" : ""}`,
);

if (!dry) {
  fs.writeFileSync(file, JSON.stringify({ ...mel, hz: out }));
}
