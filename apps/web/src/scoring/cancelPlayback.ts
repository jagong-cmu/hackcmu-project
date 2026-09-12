import { rmsOf } from "./pitchGuide.ts";

const FFT = 4096;
const FILTER = 96;
const LAG_STEP = 8;
const LAG_MAX = 2400;
const CORR_N = 160;
const VOICE_RMS = 0.010;

type PlaybackTap = {
  ctx: AudioContext;
  analyser: AnalyserNode;
};

const taps = new WeakMap<HTMLAudioElement, PlaybackTap>();

/**
 * Route the instrumental through Web Audio (so Chrome AEC can hear it)
 * and give us a reference buffer to subtract from the mic.
 * The AudioContext is kept alive — closing it would mute the element forever.
 */
export function ensurePlaybackTap(audio: HTMLAudioElement): PlaybackTap | null {
  const existing = taps.get(audio);
  if (existing && existing.ctx.state !== "closed") return existing;

  try {
    const ctx = new AudioContext();
    const src = ctx.createMediaElementSource(audio);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = FFT;
    analyser.smoothingTimeConstant = 0;
    src.connect(ctx.destination);
    src.connect(analyser);
    const tap = { ctx, analyser };
    taps.set(audio, tap);
    return tap;
  } catch {
    return null;
  }
}

export type SpeakerCanceller = {
  lag: number;
  w: Float32Array;
  x: Float32Array;
  xi: number;
  frames: number;
};

export function createSpeakerCanceller(): SpeakerCanceller {
  return {
    lag: 0,
    w: new Float32Array(FILTER),
    x: new Float32Array(FILTER),
    xi: 0,
    frames: 0,
  };
}

function estimateLag(mic: Float32Array, ref: Float32Array): number {
  const start = Math.max(0, mic.length - CORR_N * LAG_STEP);
  let bestLag = 0;
  let best = 0;
  const maxLag = Math.min(LAG_MAX, start);
  for (let lag = 0; lag <= maxLag; lag += LAG_STEP) {
    let dot = 0;
    let r2 = 0;
    for (let k = 0; k < CORR_N; k++) {
      const mi = mic[start + k * LAG_STEP] ?? 0;
      const ri = ref[start + k * LAG_STEP - lag] ?? 0;
      dot += mi * ri;
      r2 += ri * ri;
    }
    const score = r2 > 1e-8 ? (dot * dot) / r2 : 0;
    if (score > best) {
      best = score;
      bestLag = lag;
    }
  }
  return bestLag;
}

/** Subtract the playing instrumental from a mic frame. Mutates `out`. */
export function cancelSpeaker(
  mic: Float32Array,
  ref: Float32Array,
  c: SpeakerCanceller,
  out: Float32Array,
): void {
  const refRms = rmsOf(ref);
  if (refRms < 0.003) {
    out.set(mic);
    return;
  }

  if (c.frames++ % 8 === 0) c.lag = estimateLag(mic, ref);
  const lag = c.lag;
  const n = c.w.length;

  for (let i = 0; i < mic.length; i++) {
    const r = i >= lag ? (ref[i - lag] ?? 0) : 0;
    c.x[c.xi] = r;
    let yhat = 0;
    let x2 = 0;
    for (let k = 0; k < n; k++) {
      const idx = (c.xi - k + n) % n;
      const xv = c.x[idx] ?? 0;
      yhat += (c.w[k] ?? 0) * xv;
      x2 += xv * xv;
    }
    const e = (mic[i] ?? 0) - yhat;
    const mu = 0.4 / (x2 + 1e-4);
    for (let k = 0; k < n; k++) {
      const idx = (c.xi - k + n) % n;
      c.w[k] = (c.w[k] ?? 0) + mu * e * (c.x[idx] ?? 0);
    }
    c.xi = (c.xi + 1) % n;
    out[i] = e;
  }

  // The reference comes from an AnalyserNode whose clock is not the mic's, so
  // when the true speaker-to-mic delay sits outside estimateLag's window the
  // filter adapts to noise and starts subtracting the singer. A diverged filter
  // adds energy rather than removing it; reset and pass the mic through.
  let bad = false;
  for (let i = 0; i < out.length; i++) {
    if (!Number.isFinite(out[i] ?? 0)) { bad = true; break; }
  }
  if (bad || rmsOf(out) > rmsOf(mic) * 1.05) {
    c.w.fill(0);
    c.x.fill(0);
    c.xi = 0;
    out.set(mic);
  }
}

/** True when leftover energy is just the bed, not a voice. */
export function isMusicOnly(mic: Float32Array, clean: Float32Array, ref: Float32Array): boolean {
  const micRms = rmsOf(mic);
  const cleanRms = rmsOf(clean);
  const refRms = rmsOf(ref);
  // A live mic with no playback reference (headphones, or LiveKit AEC already
  // on) is never "just the bed".
  if (refRms < 0.01) return micRms < VOICE_RMS;
  if (cleanRms >= VOICE_RMS) return false;
  // The adaptive filter sometimes subtracts the singer. If the raw mic still
  // has voice energy, keep the frame — false music-only is "We couldn't hear you."
  if (micRms >= VOICE_RMS) return false;
  return true;
}

export { FFT as PITCH_FFT, VOICE_RMS };
