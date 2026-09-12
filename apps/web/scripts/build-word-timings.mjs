#!/usr/bin/env node
/**
 * Derives per-word timings for a pack and writes words.json.
 *
 * LRC gives one timestamp per line, so a wipe across the line can only be
 * linear -- which drifts badly, because singing is not linear. Held notes,
 * bunched syllables and mid-line rests all break it.
 *
 * The extracted melody knows when the voice is actually sounding, so words are
 * distributed across VOICED time only, weighted by syllable count. A rest in
 * the middle of a line costs no words, and a held note spends its whole
 * duration on the syllable being held.
 *
 *   node build-word-timings.mjs <packDir>
 */
import fs from "node:fs";
import path from "node:path";

const MAX_LINE_SEC = 7;

const PACK_DIR = process.argv[2];
if (!PACK_DIR) throw new Error("usage: build-word-timings.mjs <packDir>");

const mel = JSON.parse(fs.readFileSync(path.join(PACK_DIR, "melody.json"), "utf8"));
const sr = mel.sampleRateHz;

const lines = [];
for (const raw of fs.readFileSync(path.join(PACK_DIR, "lyrics.lrc"), "utf8").split(/\r?\n/)) {
  const m = raw.match(/\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\](.*)/);
  if (!m || !m[4].trim()) continue;
  const frac = m[3] ? Number(m[3].padEnd(3, "0")) / 1000 : 0;
  lines.push({ t: Number(m[1]) * 60 + Number(m[2]) + frac, text: m[4].trim() });
}
lines.sort((a, b) => a.t - b.t);

/** Rough syllable count; good enough to share a line out between words. */
function syllables(word) {
  const w = word.toLowerCase().replace(/[^a-z']/g, "");
  if (!w) return 1;
  const groups = w.match(/[aeiouy]+/g);
  let n = groups ? groups.length : 1;
  // trailing silent e, as in "phone"
  if (w.length > 2 && w.endsWith("e") && !/[aeiouy]e$/.test(w)) n -= 1;
  return Math.max(1, n);
}

const out = [];
let linesWithVoice = 0;

lines.forEach((line, i) => {
  const next = lines[i + 1]?.t ?? line.t + MAX_LINE_SEC;
  const endSec = Math.min(next, line.t + MAX_LINE_SEC);
  const from = Math.round(line.t * sr);
  const to = Math.min(mel.hz.length, Math.round(endSec * sr));

  const words = line.text.split(/\s+/).filter(Boolean);
  const syl = words.map(syllables);
  const totalSyl = syl.reduce((a, b) => a + b, 0) || 1;

  // frames where the voice is actually sounding inside this line
  const voiced = [];
  for (let k = from; k < to; k++) if (mel.hz[k] != null) voiced.push(k);

  let starts;
  // Where the voice actually stops inside this line. The fill must complete
  // there, not at the line boundary -- otherwise it crawls through the final
  // word for the whole rest that follows the phrase.
  let sungEnd = endSec;
  if (voiced.length) sungEnd = +((voiced[voiced.length - 1] + 1) / sr).toFixed(3);

  if (voiced.length >= words.length) {
    linesWithVoice++;
    // walk the voiced frames, cutting at cumulative syllable fractions
    starts = [];
    let acc = 0;
    for (let w = 0; w < words.length; w++) {
      const idx = Math.min(voiced.length - 1, Math.floor((acc / totalSyl) * voiced.length));
      starts.push(+(voiced[idx] / sr).toFixed(3));
      acc += syl[w];
    }
  } else {
    // no usable vocal here: fall back to an even share of the line
    const span = Math.max(0.001, endSec - line.t);
    starts = [];
    let acc = 0;
    for (let w = 0; w < words.length; w++) {
      starts.push(+(line.t + (acc / totalSyl) * span).toFixed(3));
      acc += syl[w];
    }
  }

  // keep it monotonic; identical starts would make a word zero-width
  for (let w = 1; w < starts.length; w++) {
    if (starts[w] <= starts[w - 1]) starts[w] = +(starts[w - 1] + 0.04).toFixed(3);
  }

  out.push({
    t: +line.t.toFixed(3),
    endSec: +endSec.toFixed(3),
    sungEndSec: Math.max(sungEnd, starts[starts.length - 1] + 0.2),
    text: line.text,
    words: words.map((w, k) => ({ w, t: starts[k] })),
  });
});

fs.writeFileSync(path.join(PACK_DIR, "words.json"), JSON.stringify(out));

const totalWords = out.reduce((a, l) => a + l.words.length, 0);
console.log(
  `${path.basename(PACK_DIR).padEnd(22)} ${out.length} lines  ${totalWords} words  ` +
  `voice-timed ${linesWithVoice}/${out.length} lines`,
);
