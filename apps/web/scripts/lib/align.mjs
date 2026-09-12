/**
 * Shared audio alignment: decode, FFT, chroma features, and DTW.
 *
 * Used to map one recording's timebase onto another's — a studio original onto
 * a karaoke cover (measure-offset.mjs), or an edited vocal stem back onto the
 * original it was cut from (extract-melody-stem.mjs).
 */
import { execFileSync } from "node:child_process";

/** Analysis rate for chroma. Alignment needs harmony, not fidelity. */
export const A_SR = 22050;
export const A_N = 4096;
export const A_HOP = 2048;
/** Chroma frames per second. */
export const A_FPS = A_SR / A_HOP;

export function decodeMono(file, sr) {
  const raw = execFileSync(
    "ffmpeg",
    ["-v", "error", "-i", file, "-ac", "1", "-ar", String(sr), "-f", "f32le", "-"],
    { maxBuffer: 1 << 30 },
  );
  return new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 4));
}

export function fft(re, im) {
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

export function chroma(sig) {
  const frames = Math.max(0, Math.floor((sig.length - A_N) / A_HOP) + 1);
  const win = new Float32Array(A_N);
  for (let i = 0; i < A_N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (A_N - 1));
  const pc = new Int8Array(A_N / 2).fill(-1);
  for (let k = 1; k < A_N / 2; k++) {
    const f = (k * A_SR) / A_N;
    if (f < 55 || f > 4000) continue;
    pc[k] = ((Math.round(12 * Math.log2(f / 440)) % 12) + 12) % 12;
  }
  const out = [];
  const re = new Float64Array(A_N), im = new Float64Array(A_N);
  for (let t = 0; t < frames; t++) {
    const off = t * A_HOP;
    for (let i = 0; i < A_N; i++) { re[i] = sig[off + i] * win[i]; im[i] = 0; }
    fft(re, im);
    const v = new Float64Array(12);
    for (let k = 1; k < A_N / 2; k++) {
      if (pc[k] < 0) continue;
      v[pc[k]] += Math.sqrt(re[k] * re[k] + im[k] * im[k]);
    }
    let norm = 0;
    for (let i = 0; i < 12; i++) norm += v[i] * v[i];
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < 12; i++) v[i] /= norm;
    out.push(v);
  }
  return out;
}

export function dtw(A, B) {
  const n = A.length, m = B.length;
  const INF = 1e18;
  let prev = new Float64Array(m + 1).fill(INF);
  const ptr = new Uint8Array(n * m);
  prev[0] = 0;
  const cur = new Float64Array(m + 1);
  for (let i = 1; i <= n; i++) {
    cur.fill(INF);
    const a = A[i - 1];
    for (let j = 1; j <= m; j++) {
      let dot = 0;
      const b = B[j - 1];
      for (let k = 0; k < 12; k++) dot += a[k] * b[k];
      const cost = 1 - dot;
      const d = prev[j - 1], u = prev[j], l = cur[j - 1];
      let best = d, dir = 0;
      if (u < best) { best = u; dir = 1; }
      if (l < best) { best = l; dir = 2; }
      cur[j] = cost + best;
      ptr[(i - 1) * m + (j - 1)] = dir;
    }
    prev = Float64Array.from(cur);
  }
  const map = new Int32Array(n).fill(-1);
  let i = n, j = m;
  while (i > 0 && j > 0) {
    map[i - 1] = j - 1;
    const dir = ptr[(i - 1) * m + (j - 1)];
    if (dir === 0) { i--; j--; }
    else if (dir === 1) { i--; }
    else { j--; }
  }
  for (let k = 1; k < n; k++) if (map[k] < 0) map[k] = map[k - 1];
  return map;
}
