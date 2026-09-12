#!/usr/bin/env node
/**
 * Extracts a vocal melody contour from a studio original and writes it into a
 * pack's melody.json, shifted onto the karaoke track by that pack's offsetSec.
 *
 * The original is a full mix, so pitch tracking is gated by the pack's
 * lyrics.lrc: frames outside a sung line are discarded. That removes most
 * instrumental interference, since we only trust f0 where we know a voice is.
 *
 *   node extract-melody.mjs <original.mp3> <packDir> <offsetSec>
 *
 * offsetSec is the same figure build-song-packs.mjs uses: original time + off
 * = karaoke time.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const SR = 16000;
const W = 2048; // analysis window
const HALF = W / 2;
const MELODY_SR = 50;
const HOP = SR / MELODY_SR; // 320 samples = 20ms
// Vocal fundamentals, not bass. A full mix's strongest periodic component is
// usually the bass line, so the search floor sits above it and the signal is
// high-passed first.
const FMIN = 140;
const FMAX = 800;
const HP_HZ = 200;
const YIN_THRESH = 0.15;

function decodeMono(file) {
  const raw = execFileSync(
    "ffmpeg",
    ["-v", "error", "-i", file, "-ac", "1", "-ar", String(SR), "-f", "f32le", "-"],
    { maxBuffer: 1 << 30 },
  );
  return new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 4));
}

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

const NFFT = 4096; // >= 2*W
const fre = new Float64Array(NFFT), fim = new Float64Array(NFFT);

/** YIN with FFT-based autocorrelation. Returns the CMND curve for the frame. */
function yinCurve(frame) {
  fre.fill(0); fim.fill(0);
  for (let i = 0; i < W; i++) fre[i] = frame[i];
  fft(fre, fim);
  for (let i = 0; i < NFFT; i++) {
    const r = fre[i], m = fim[i];
    fre[i] = r * r + m * m;
    fim[i] = 0;
  }
  fft(fre, fim); // real, even -> inverse up to scale
  const acf = new Float64Array(HALF + 1);
  for (let t = 0; t <= HALF; t++) acf[t] = fre[t] / NFFT;

  // sliding power for the lagged window
  const pow = new Float64Array(HALF + 1);
  let running = 0;
  for (let j = 0; j < HALF; j++) running += frame[j] * frame[j];
  pow[0] = running;
  for (let t = 1; t <= HALF; t++) {
    running += frame[t + HALF - 1] * frame[t + HALF - 1] - frame[t - 1] * frame[t - 1];
    pow[t] = running;
  }

  const d = new Float64Array(HALF + 1);
  for (let t = 1; t <= HALF; t++) d[t] = pow[0] + pow[t] - 2 * acf[t];

  // cumulative mean normalised difference
  const cmnd = new Float64Array(HALF + 1);
  cmnd[0] = 1;
  let sum = 0;
  for (let t = 1; t <= HALF; t++) {
    sum += d[t];
    cmnd[t] = sum > 0 ? (d[t] * t) / sum : 1;
  }

  return cmnd;
}

function parseLrc(src) {
  const out = [];
  for (const raw of src.split(/\r?\n/)) {
    const m = raw.match(/\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\](.*)/);
    if (!m || !m[4].trim()) continue;
    const frac = m[3] ? Number(m[3].padEnd(3, "0")) / 1000 : 0;
    out.push(Number(m[1]) * 60 + Number(m[2]) + frac);
  }
  return out.sort((a, b) => a - b);
}

const [ORIG, PACK_DIR, OFFSET_STR] = process.argv.slice(2);
if (!ORIG || !PACK_DIR || OFFSET_STR === undefined) {
  throw new Error("usage: extract-melody.mjs <original.mp3> <packDir> <offsetSec>");
}
const offsetSec = Number(OFFSET_STR);

const sigRaw = decodeMono(ORIG);

/** 2nd-order Butterworth high-pass, applied forward then backward (zero phase) */
function highpass(x, fc) {
  const c = Math.tan((Math.PI * fc) / SR);
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

const sig = highpass(sigRaw, HP_HZ);
const nFrames = Math.max(0, Math.floor((sig.length - W) / HOP) + 1);

// Viterbi over semitone states. Picking the best tau per frame independently
// lets YIN hop octaves whenever another instrument wins a frame; forcing the
// path to pay for every jump keeps it on one line.
const MIDI_LO = 48; // C3
const MIDI_HI = 84; // C6
const NSTATE = MIDI_HI - MIDI_LO + 1;
const UNVOICED = NSTATE; // one extra state
const JUMP_COST = 0.22; // per semitone
const MAX_JUMP = 14;
const UNVOICED_COST = 0.34; // observation cost of being silent
const SWITCH_COST = 0.28; // entering or leaving voiced

const obs = new Float32Array(nFrames * (NSTATE + 1));
const frame = new Float32Array(W);
for (let i = 0; i < nFrames; i++) {
  frame.set(sig.subarray(i * HOP, i * HOP + W));
  let rms = 0;
  for (let j = 0; j < W; j++) rms += frame[j] * frame[j];
  const base = i * (NSTATE + 1);
  if (Math.sqrt(rms / W) < 0.005) {
    for (let s = 0; s < NSTATE; s++) obs[base + s] = 1.2;
    obs[base + UNVOICED] = 0;
    continue;
  }
  const cmnd = yinCurve(frame);
  for (let s = 0; s < NSTATE; s++) {
    const f = 440 * 2 ** ((MIDI_LO + s - 69) / 12);
    if (f < FMIN || f > FMAX) { obs[base + s] = 1.2; continue; }
    const tau = SR / f;
    const t0 = Math.floor(tau);
    const frac = tau - t0;
    const c = t0 + 1 <= HALF ? cmnd[t0] * (1 - frac) + cmnd[t0 + 1] * frac : cmnd[Math.min(t0, HALF)];
    obs[base + s] = c;
  }
  obs[base + UNVOICED] = UNVOICED_COST;
}

// forward pass
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
  const swap = prev; prev = cur; cur = swap;
}

let bestEnd = 0;
for (let s = 1; s < NS; s++) if (prev[s] < prev[bestEnd]) bestEnd = s;
const statePath = new Int16Array(nFrames);
let st = bestEnd;
for (let i = nFrames - 1; i >= 0; i--) {
  statePath[i] = st;
  st = back[i * NS + st];
}
const hz = new Array(nFrames).fill(null);
for (let i = 0; i < nFrames; i++) {
  if (statePath[i] === UNVOICED) continue;
  hz[i] = 440 * 2 ** ((MIDI_LO + statePath[i] - 69) / 12);
}

// Gate to sung lines: karaoke-time line starts shifted back into original time.
const lrcPath = path.join(PACK_DIR, "lyrics.lrc");
const lineStartsKaraoke = parseLrc(fs.readFileSync(lrcPath, "utf8"));
const gate = new Uint8Array(nFrames);
lineStartsKaraoke.forEach((tK, i) => {
  const tOrig = tK - offsetSec;
  const nextK = lineStartsKaraoke[i + 1] ?? tK + 4;
  const endOrig = Math.min(nextK - offsetSec, tOrig + 8);
  const from = Math.max(0, Math.round(tOrig * MELODY_SR));
  const to = Math.min(nFrames, Math.round(endOrig * MELODY_SR));
  for (let j = from; j < to; j++) gate[j] = 1;
});
for (let i = 0; i < nFrames; i++) if (!gate[i]) hz[i] = null;

// median filter in the log domain, then snap to semitones
const midi = hz.map((f) => (f == null ? null : 69 + 12 * Math.log2(f / 440)));
const smooth = midi.slice();
const K = 3;
for (let i = 0; i < nFrames; i++) {
  if (midi[i] == null) continue;
  const win = [];
  for (let j = Math.max(0, i - K); j <= Math.min(nFrames - 1, i + K); j++) {
    if (midi[j] != null) win.push(midi[j]);
  }
  if (!win.length) continue;
  win.sort((a, b) => a - b);
  smooth[i] = win[win.length >> 1];
}
const snapped = smooth.map((m) => (m == null ? null : Math.round(m)));

// drop runs shorter than 120ms; they are almost always tracking errors
const MIN_RUN = 6;
let i = 0;
while (i < nFrames) {
  if (snapped[i] == null) { i++; continue; }
  let j = i;
  while (j < nFrames && snapped[j] === snapped[i]) j++;
  if (j - i < MIN_RUN) for (let k = i; k < j; k++) snapped[k] = null;
  i = j;
}

// shift onto the karaoke timeline
const outLen = Math.round((nFrames / MELODY_SR + offsetSec + 8) * MELODY_SR);
const out = new Array(Math.max(outLen, 1)).fill(null);
const shiftFrames = Math.round(offsetSec * MELODY_SR);
for (let k = 0; k < nFrames; k++) {
  const dst = k + shiftFrames;
  if (dst < 0 || dst >= out.length) continue;
  out[dst] = snapped[k] == null ? null : +(440 * 2 ** ((snapped[k] - 69) / 12)).toFixed(2);
}

fs.writeFileSync(
  path.join(PACK_DIR, "melody.json"),
  JSON.stringify({ sampleRateHz: MELODY_SR, startSec: 0, hz: out }),
);

const voiced = out.filter((v) => v != null);
const pcs = new Array(12).fill(0);
for (const v of voiced) pcs[((Math.round(69 + 12 * Math.log2(v / 440)) % 12) + 12) % 12]++;
const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const top = pcs.map((n, k) => [names[k], n]).sort((a, b) => b[1] - a[1]).slice(0, 7);
const ms = voiced.map((v) => 69 + 12 * Math.log2(v / 440)).sort((a, b) => a - b);
console.log(
  `${path.basename(PACK_DIR).padEnd(22)} voiced ${((voiced.length / out.length) * 100).toFixed(0)}%  ` +
  `range ${ms.length ? ms[0].toFixed(0) : "-"}..${ms.length ? ms[ms.length - 1].toFixed(0) : "-"} midi  ` +
  `median ${ms.length ? ms[ms.length >> 1].toFixed(0) : "-"}  top pcs ${top.map(([n, c]) => `${n}:${c}`).join(" ")}`,
);
