import type { MelodyFile } from "@karaoke/shared";
import { midiFromHz } from "./cents.ts";

export type NoteRun = {
  startSec: number;
  endSec: number;
  hz: number;
  midi: number;
};

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** Collapse the 50 Hz contour into held notes. */
export function segmentMelody(melody: MelodyFile): NoteRun[] {
  const step = 1 / melody.sampleRateHz;
  const runs: NoteRun[] = [];
  let open: NoteRun | null = null;

  for (let i = 0; i < melody.hz.length; i++) {
    const hz = melody.hz[i];
    const t = melody.startSec + i * step;
    if (hz == null || hz <= 0) {
      if (open) {
        open.endSec = t;
        runs.push(open);
        open = null;
      }
      continue;
    }
    const midi = midiFromHz(hz);
    if (open && Math.abs(midi - open.midi) < 0.4) {
      open.endSec = t + step;
      continue;
    }
    if (open) runs.push(open);
    open = { startSec: t, endSec: t + step, hz, midi };
  }
  if (open) runs.push(open);
  return runs;
}

export function noteName(midi: number): string {
  const n = Math.round(midi);
  const name = NOTE_NAMES[(n % 12 + 12) % 12];
  const octave = Math.floor(n / 12) - 1;
  return `${name}${octave}`;
}

/** Fold a sung MIDI note into the nearest octave of `around`. */
export function wrapMidi(sung: number, around: number): number {
  let diff = sung - around;
  diff -= 12 * Math.round(diff / 12);
  return around + diff;
}

export type PitchSmoothState = {
  midi: number | null;
  lastTs: number;
  buf: number[];
  trail: Array<{ t: number; midi: number; inTune: boolean }>;
};

export function createPitchSmoothState(): PitchSmoothState {
  return { midi: null, lastTs: 0, buf: [], trail: [] };
}

const MIN_HZ = 55;
const MAX_HZ = 1400;
const MIN_RMS = 0.02;
const BLEED_RMS = 0.014;
const MEDIAN_N = 9;
const EMA = 0.28;
const MAX_ST_PER_SEC = 28;
const ATTRACT_CENTS = 40;
const TRAIL_SEC = 1.35;

export function rmsOf(buf: Float32Array): number {
  let s = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i] ?? 0;
    s += v * v;
  }
  return Math.sqrt(s / Math.max(1, buf.length));
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const a = s[mid];
  if (a == null) return 0;
  if (s.length % 2) return a;
  const b = s[mid - 1];
  return ((b ?? a) + a) / 2;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Lift a subharmonic octave drop. Never fold a high note down into the staff. */
function liftSubharmonic(raw: number, previous: number): number {
  const up = raw + 12;
  if (Math.abs(up - previous) + 0.5 < Math.abs(raw - previous)) return up;
  return raw;
}

/**
 * Display-only smoother. Scoring still uses raw frames.
 * True pitch direction (higher Hz → higher on the staff). No octave wrap for Y.
 */
export function smoothLivePitch(
  state: PitchSmoothState,
  input: {
    hz: number | null;
    clarity: number;
    rms: number;
    targetMidi: number | null;
    restMidi: number;
    minMidi: number;
    maxMidi: number;
    playheadSec: number;
    nowMs: number;
  },
): { midi: number; inTune: boolean; tracking: boolean } {
  const dt = state.lastTs ? Math.min(0.08, (input.nowMs - state.lastTs) / 1000) : 1 / 60;
  state.lastTs = input.nowMs;
  if (state.midi == null) state.midi = input.restMidi;

  const pitched =
    input.hz != null &&
    Number.isFinite(input.hz) &&
    input.clarity >= 0.35 &&
    input.hz >= MIN_HZ &&
    input.hz <= MAX_HZ &&
    input.rms >= MIN_RMS;

  let tracking = false;
  if (pitched && input.hz != null) {
    let raw = midiFromHz(input.hz);
    raw = liftSubharmonic(raw, state.midi);

    const looksLikeBleed =
      input.rms < BLEED_RMS &&
      input.targetMidi != null &&
      Math.abs(wrapMidi(raw, input.targetMidi) - input.targetMidi) < 0.3;
    if (!looksLikeBleed) {
      tracking = true;
      state.buf.push(raw);
      if (state.buf.length > MEDIAN_N) state.buf.shift();
      let next = median(state.buf);
      next = state.midi + (next - state.midi) * EMA;
      const maxStep = MAX_ST_PER_SEC * dt;
      const delta = next - state.midi;
      if (Math.abs(delta) > maxStep) next = state.midi + Math.sign(delta) * maxStep;
      state.midi = clamp(next, input.minMidi, input.maxMidi);
    }
  } else {
    state.buf = [];
  }

  const inTune =
    tracking &&
    input.targetMidi != null &&
    Math.abs(wrapMidi(state.midi, input.targetMidi) - input.targetMidi) * 100 < ATTRACT_CENTS;

  state.trail.push({ t: input.playheadSec, midi: state.midi, inTune });
  const oldest = input.playheadSec - TRAIL_SEC;
  while (state.trail.length && (state.trail[0]?.t ?? 0) < oldest) state.trail.shift();
  if (state.trail.length > 90) state.trail.splice(0, state.trail.length - 90);

  return { midi: state.midi, inTune, tracking };
}

export { TRAIL_SEC };

export function melodyRange(runs: NoteRun[]): { min: number; max: number } {
  if (runs.length === 0) return { min: 52, max: 76 };
  let min = Infinity;
  let max = -Infinity;
  for (const run of runs) {
    if (run.midi < min) min = run.midi;
    if (run.midi > max) max = run.midi;
  }
  min = Math.floor(min) - 4;
  max = Math.ceil(max) + 12;
  if (max - min < 20) max = min + 20;
  return { min, max };
}
