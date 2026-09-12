#!/usr/bin/env node
/**
 * Extracts a vocal melody from an isolated-vocal recording and writes it into a
 * pack's melody.json.
 *
 * Handles "vocals only" edits that have had the instrumental gaps cut out: the
 * vocal is chroma/DTW-aligned back onto the studio original first, which
 * recovers a piecewise offset, and only then sampled. A true full-length stem
 * works too — its offset curve is simply flat.
 *
 *   node extract-melody-stem.mjs <original.mp3> <vocals.mp3> <packDir> <offsetSec>
 *
 * offsetSec maps original time onto the karaoke track (karaoke = original + off)
 * and is the same figure build-song-packs.mjs uses.
 */
import fs from "node:fs";
import path from "node:path";
import { A_FPS, A_SR, chroma, decodeMono, dtw, fft } from "./lib/align.mjs";

const MELODY_SR = 50;

// --- chroma / DTW alignment (original -> vocals) lives in lib/align.mjs ---

// --- pitch tracking on the isolated vocal ---
const P_SR = 16000;
const P_W = 2048;
const P_HALF = P_W / 2;
const P_HOP = P_SR / MELODY_SR;
const FMIN = 70; // no bass line to dodge, so open the floor back up
const FMAX = 900;
const HP_HZ = 60; // rumble only
const MIDI_LO = 45;
const MIDI_HI = 84;
const NSTATE = MIDI_HI - MIDI_LO + 1;
const UNVOICED = NSTATE;
const JUMP_COST = 0.2;
const MAX_JUMP = 14;
const UNVOICED_COST = 0.42;
const SWITCH_COST = 0.25;
const SILENCE_RMS = 0.004;
const MIN_RUN = 5;


function highpass(x, fc, sr) {
  const c = Math.tan((Math.PI * fc) / sr);
  const a0 = 1 + Math.SQRT2 * c + c * c;
  const b0 = 1 / a0, b1 = -2 / a0, b2 = 1 / a0;
  const a1 = (2 * (c * c - 1)) / a0;
  const a2 = (1 - Math.SQRT2 * c + c * c) / a0;
  const run = (src, dst) => {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < src.length; i++) {
      const xi = src[i];
      const yi = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = xi; y2 = y1; y1 = yi;
      dst[i] = yi;
    }
  };
  const fwd = new Float32Array(x.length);
  run(x, fwd);
  const rev = Float32Array.from(fwd).reverse();
  const back = new Float32Array(x.length);
  run(rev, back);
  return back.reverse();
}

const NFFT = 4096;
const fre = new Float64Array(NFFT), fim = new Float64Array(NFFT);

function yinCurve(frame) {
  fre.fill(0); fim.fill(0);
  for (let i = 0; i < P_W; i++) fre[i] = frame[i];
  fft(fre, fim);
  for (let i = 0; i < NFFT; i++) {
    const r = fre[i], m = fim[i];
    fre[i] = r * r + m * m;
    fim[i] = 0;
  }
  fft(fre, fim);
  const acf = new Float64Array(P_HALF + 1);
  for (let t = 0; t <= P_HALF; t++) acf[t] = fre[t] / NFFT;
  const pow = new Float64Array(P_HALF + 1);
  let running = 0;
  for (let j = 0; j < P_HALF; j++) running += frame[j] * frame[j];
  pow[0] = running;
  for (let t = 1; t <= P_HALF; t++) {
    running += frame[t + P_HALF - 1] * frame[t + P_HALF - 1] - frame[t - 1] * frame[t - 1];
    pow[t] = running;
  }
  const d = new Float64Array(P_HALF + 1);
  for (let t = 1; t <= P_HALF; t++) d[t] = pow[0] + pow[t] - 2 * acf[t];
  const cmnd = new Float64Array(P_HALF + 1);
  cmnd[0] = 1;
  let sum = 0;
  for (let t = 1; t <= P_HALF; t++) {
    sum += d[t];
    cmnd[t] = sum > 0 ? (d[t] * t) / sum : 1;
  }
  return cmnd;
}

function parseLrcTimes(src) {
  const out = [];
  for (const raw of src.split(/\r?\n/)) {
    const m = raw.match(/\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\](.*)/);
    if (!m || !m[4].trim()) continue;
    const frac = m[3] ? Number(m[3].padEnd(3, "0")) / 1000 : 0;
    out.push(Number(m[1]) * 60 + Number(m[2]) + frac);
  }
  return out.sort((a, b) => a - b);
}

// ---------------------------------------------------------------- main

const [ORIG, VOX, PACK_DIR, OFFSET_STR, FIXED_STR] = process.argv.slice(2);
if (!ORIG || !VOX || !PACK_DIR || OFFSET_STR === undefined) {
  throw new Error(
    "usage: extract-melody-stem.mjs <original.mp3> <vocals.mp3> <packDir> <offsetSec> [fixedVocalOffsetSec]",
  );
}
const offsetSec = Number(OFFSET_STR);
const fixedVox = FIXED_STR === undefined ? null : Number(FIXED_STR);

// 1. alignment: original time -> vocals time
//
// DTW earns its keep when the vocal source has been edited. For a full-length
// stem already in the original's timebase it only adds risk: a sparse vocal
// over a dense mix gives chroma little to lock onto, and the path wanders. Pass
// a fixed offset in that case.
let origToVox;
let driftDesc;
if (fixedVox != null) {
  origToVox = (tOrig) => tOrig + fixedVox;
  driftDesc = `fixed ${fixedVox >= 0 ? "+" : ""}${fixedVox}s`;
} else {
  const cOrig = chroma(decodeMono(ORIG, A_SR));
  const cVox = chroma(decodeMono(VOX, A_SR));
  const map = dtw(cOrig, cVox);
  const aFps = A_FPS;
  // Smooth the drift so DTW's frame quantisation does not wobble inside a
  // plateau; the steps at real cuts survive a short median.
  const drift = new Float64Array(map.length);
  for (let i = 0; i < map.length; i++) drift[i] = map[i] / aFps - i / aFps;
  const driftSm = new Float64Array(map.length);
  const DW = 8;
  for (let i = 0; i < map.length; i++) {
    const w = [];
    for (let j = Math.max(0, i - DW); j <= Math.min(map.length - 1, i + DW); j++) w.push(drift[j]);
    w.sort((a, b) => a - b);
    driftSm[i] = w[w.length >> 1];
  }
  origToVox = (tOrig) => {
    const i = Math.min(map.length - 1, Math.max(0, Math.round(tOrig * aFps)));
    return tOrig + driftSm[i];
  };
  driftDesc = `dtw ${driftSm[0].toFixed(1)}s..${driftSm[driftSm.length - 1].toFixed(1)}s`;
}

// 2. pitch track the isolated vocal
const sig = highpass(decodeMono(VOX, P_SR), HP_HZ, P_SR);
const nFrames = Math.max(0, Math.floor((sig.length - P_W) / P_HOP) + 1);
const obs = new Float32Array(nFrames * (NSTATE + 1));
const frame = new Float32Array(P_W);
for (let i = 0; i < nFrames; i++) {
  frame.set(sig.subarray(i * P_HOP, i * P_HOP + P_W));
  let r = 0;
  for (let j = 0; j < P_W; j++) r += frame[j] * frame[j];
  const base = i * (NSTATE + 1);
  if (Math.sqrt(r / P_W) < SILENCE_RMS) {
    for (let s = 0; s < NSTATE; s++) obs[base + s] = 1.2;
    obs[base + UNVOICED] = 0;
    continue;
  }
  const cmnd = yinCurve(frame);
  for (let s = 0; s < NSTATE; s++) {
    const f = 440 * 2 ** ((MIDI_LO + s - 69) / 12);
    if (f < FMIN || f > FMAX) { obs[base + s] = 1.2; continue; }
    const tau = P_SR / f;
    const t0 = Math.floor(tau);
    const fr = tau - t0;
    obs[base + s] = t0 + 1 <= P_HALF ? cmnd[t0] * (1 - fr) + cmnd[t0 + 1] * fr : cmnd[Math.min(t0, P_HALF)];
  }
  obs[base + UNVOICED] = UNVOICED_COST;
}

const NS = NSTATE + 1;
const back = new Int16Array(nFrames * NS);
let prev = new Float32Array(NS);
let cur = new Float32Array(NS);
for (let s = 0; s < NS; s++) prev[s] = obs[s];
for (let i = 1; i < nFrames; i++) {
  const base = i * NS;
  for (let s = 0; s < NS; s++) {
    let bestCost = Infinity, bestFrom = 0;
    if (s === UNVOICED) {
      for (let p = 0; p < NS; p++) {
        const c = prev[p] + (p === UNVOICED ? 0 : SWITCH_COST);
        if (c < bestCost) { bestCost = c; bestFrom = p; }
      }
    } else {
      const lo = Math.max(0, s - MAX_JUMP), hi = Math.min(NSTATE - 1, s + MAX_JUMP);
      for (let p = lo; p <= hi; p++) {
        const c = prev[p] + Math.abs(p - s) * JUMP_COST;
        if (c < bestCost) { bestCost = c; bestFrom = p; }
      }
      const cu = prev[UNVOICED] + SWITCH_COST;
      if (cu < bestCost) { bestCost = cu; bestFrom = UNVOICED; }
    }
    cur[s] = bestCost + obs[base + s];
    back[base + s] = bestFrom;
  }
  const sw = prev; prev = cur; cur = sw;
}
let bestEnd = 0;
for (let s = 1; s < NS; s++) if (prev[s] < prev[bestEnd]) bestEnd = s;
const statePath = new Int16Array(nFrames);
let st = bestEnd;
for (let i = nFrames - 1; i >= 0; i--) {
  statePath[i] = st;
  st = back[i * NS + st];
}
const voxMidi = new Array(nFrames).fill(null);
for (let i = 0; i < nFrames; i++) {
  if (statePath[i] !== UNVOICED) voxMidi[i] = MIDI_LO + statePath[i];
}

// 3. resample onto the karaoke timeline, gated to sung lines
const lineStarts = parseLrcTimes(fs.readFileSync(path.join(PACK_DIR, "lyrics.lrc"), "utf8"));
const lastLine = lineStarts[lineStarts.length - 1] ?? 0;
const outLen = Math.round((lastLine + 8) * MELODY_SR);
const out = new Array(outLen).fill(null);

const gate = new Uint8Array(outLen);
lineStarts.forEach((tK, i) => {
  const next = lineStarts[i + 1] ?? tK + 4;
  const from = Math.max(0, Math.round(tK * MELODY_SR));
  const to = Math.min(outLen, Math.round(Math.min(next, tK + 8) * MELODY_SR));
  for (let j = from; j < to; j++) gate[j] = 1;
});

for (let k = 0; k < outLen; k++) {
  if (!gate[k]) continue;
  const tK = k / MELODY_SR;
  const tOrig = tK - offsetSec;
  if (tOrig < 0) continue;
  const tVox = origToVox(tOrig);
  const idx = Math.round(tVox * MELODY_SR);
  if (idx < 0 || idx >= nFrames) continue;
  const m = voxMidi[idx];
  if (m == null) continue;
  out[k] = +(440 * 2 ** ((m - 69) / 12)).toFixed(2);
}

// drop flecks too short to be sung notes
let i2 = 0;
while (i2 < outLen) {
  if (out[i2] == null) { i2++; continue; }
  let j = i2;
  while (j < outLen && out[j] === out[i2]) j++;
  if (j - i2 < MIN_RUN) for (let k = i2; k < j; k++) out[k] = null;
  i2 = j;
}

fs.writeFileSync(
  path.join(PACK_DIR, "melody.json"),
  JSON.stringify({ sampleRateHz: MELODY_SR, startSec: 0, hz: out }),
);

const voiced = out.filter((v) => v != null);
const ms = voiced.map((v) => Math.round(69 + 12 * Math.log2(v / 440))).sort((a, b) => a - b);
const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const pcs = new Array(12).fill(0);
for (const m of ms) pcs[((m % 12) + 12) % 12]++;
const top = pcs.map((n, k) => [names[k], n]).sort((a, b) => b[1] - a[1]).slice(0, 7);
console.log(
  `${path.basename(PACK_DIR).padEnd(20)} voiced ${((voiced.length / outLen) * 100).toFixed(0)}%  ` +
  `range ${ms[0]}..${ms[ms.length - 1]} midi  median ${ms[ms.length >> 1]}  ` +
  `${driftDesc}  ` +
  `top pcs ${top.map(([n, c]) => `${n}:${c}`).join(" ")}`,
);
