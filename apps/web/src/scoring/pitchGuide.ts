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
  /** Smoothed display pitch. null = nothing pitched, indicator hidden. */
  midi: number | null;
  rawMidi: number | null;
  lastPitchedMs: number;
  /** A big jump waiting to prove it is real, and how many frames it has held. */
  jumpMidi: number | null;
  jumpCount: number;
  buf: number[];
  trail: Array<{ t: number; midi: number | null; inTune: boolean }>;
};

export function createPitchSmoothState(): PitchSmoothState {
  return {
    midi: null,
    rawMidi: null,
    lastPitchedMs: 0,
    jumpMidi: null,
    jumpCount: 0,
    buf: [],
    trail: [],
  };
}

// Outside this the reading is noise, not a voice. The floor matters: with
// mains hum in the window pitchy locks onto voice+hum common periods (20-55
// Hz), and anything let through below C2 pinned the indicator to the floor.
// 63, not 60: bare 60 Hz mains hum reads as a clean 60.0 Hz pitch. C2 (65.4)
// still clears it.
const MIN_HZ = 63;
const MAX_HZ = 1200;
// Pitchy (McLeod) clarity. Under this the frame is mostly noise or breath, and
// those frames are where the octave errors and wander come from -- which is
// why quiet or far-from-the-mic singing used to read differently.
export const MIN_CLARITY = 0.9;
// Laptop and headset mics roll off the fundamental of a low voice, so clarity
// runs lower down there for a perfectly good note.
export const MIN_CLARITY_LOW = 0.8;
const LOW_HZ = 150;
// Noise gate. Only decides whether the indicator is shown; loudness never
// touches the pitch value itself. Kept low: the same mic roll-off leaves a
// quiet low note with a fraction of the energy of a quiet high one.
export const MIN_RMS = 0.005;
// Ride over a consonant or one missed frame before hiding the indicator.
const HOLD_MS = 150;
/**
 * High-pass in front of the pitch analyser: strips DC offset (which zeroes
 * pitchy's clarity), handling rumble and most mains hum. Below C2 (65 Hz), so
 * no sung note is lost.
 */
export const PITCH_HIGHPASS_HZ = 70;

/**
 * mic -> high-pass x2 -> analyser, for pitch tracking. Two stages (24 dB/oct):
 * one still left enough 60 Hz hum to lock pitchy onto voice+hum common periods
 * on low notes.
 */
export function pitchAnalyser(ctx: AudioContext, src: AudioNode, fftSize: number): AnalyserNode {
  const highpass = () => {
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = PITCH_HIGHPASS_HZ;
    return hp;
  };
  const analyser = ctx.createAnalyser();
  analyser.fftSize = fftSize;
  analyser.smoothingTimeConstant = 0;
  src.connect(highpass()).connect(highpass()).connect(analyser);
  return analyser;
}

export type PitchReject = "no pitch" | "range" | "clarity" | "rms" | "jump";

/** Why a frame would not be drawn, or null if it is a usable pitch. */
export function rejectFrame(hz: number | null, clarity: number, rms: number): PitchReject | null {
  if (hz == null || !Number.isFinite(hz) || hz <= 0) return "no pitch";
  if (hz < MIN_HZ || hz > MAX_HZ) return "range";
  if (clarity < (hz < LOW_HZ ? MIN_CLARITY_LOW : MIN_CLARITY)) return "clarity";
  if (rms < MIN_RMS) return "rms";
  return null;
}
const MEDIAN_N = 5;
const EMA = 0.5;
// A move this big between frames is suspect: pitch detectors slip by an octave
// (or a fifth) for a frame or two. It must persist JUMP_CONFIRM frames to be
// believed, so real leaps still land, ~50ms late.
const JUMP_ST = 7;
const JUMP_CONFIRM = 3;
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

/**
 * Display-only smoother. Scoring still uses raw frames.
 *
 * Returns the pitch actually sung, in fractional MIDI, never folded or
 * clamped, so the meter can map it straight onto a fixed range. `inTune` is
 * octave-independent: a bass singing the tune an octave down still lights up.
 */
export function smoothLivePitch(
  state: PitchSmoothState,
  input: {
    hz: number | null;
    clarity: number;
    rms: number;
    targetMidi: number | null;
    playheadSec: number;
    nowMs: number;
  },
): {
  midi: number | null;
  rawMidi: number | null;
  inTune: boolean;
  tracking: boolean;
  reject: PitchReject | null;
} {
  // Rejected frames never reach midiFromHz or the smoother: they only let the
  // hold run out.
  let reject = rejectFrame(input.hz, input.clarity, input.rms);

  if (reject == null && input.hz != null) {
    const raw = midiFromHz(input.hz);
    state.rawMidi = raw;
    if (state.midi != null && Math.abs(raw - state.midi) >= JUMP_ST) {
      reject = "jump";
      if (state.jumpMidi != null && Math.abs(raw - state.jumpMidi) < 1) state.jumpCount++;
      else {
        state.jumpMidi = raw;
        state.jumpCount = 1;
      }
      if (state.jumpCount >= JUMP_CONFIRM) {
        reject = null;
        state.midi = raw;
        state.buf = [raw];
        state.jumpMidi = null;
        state.lastPitchedMs = input.nowMs;
      }
    } else {
      state.jumpMidi = null;
      state.buf.push(raw);
      if (state.buf.length > MEDIAN_N) state.buf.shift();
      const m = median(state.buf);
      state.midi = state.midi == null ? m : state.midi + (m - state.midi) * EMA;
      state.lastPitchedMs = input.nowMs;
    }
  }

  const tracking = state.midi != null && input.nowMs - state.lastPitchedMs <= HOLD_MS;
  if (!tracking) {
    state.midi = null;
    state.buf = [];
    state.jumpMidi = null;
  }

  const inTune =
    tracking &&
    state.midi != null &&
    input.targetMidi != null &&
    Math.abs(wrapMidi(state.midi, input.targetMidi) - input.targetMidi) * 100 < ATTRACT_CENTS;

  state.trail.push({ t: input.playheadSec, midi: state.midi, inTune });
  const oldest = input.playheadSec - TRAIL_SEC;
  while (state.trail.length && (state.trail[0]?.t ?? 0) < oldest) state.trail.shift();
  if (state.trail.length > 90) state.trail.splice(0, state.trail.length - 90);

  return { midi: state.midi, rawMidi: state.rawMidi, inTune, tracking, reject };
}

export { TRAIL_SEC };

export function melodyRange(runs: NoteRun[]): { min: number; max: number } {
  if (runs.length === 0) return { min: 52, max: 62 };
  let min = Infinity;
  let max = -Infinity;
  for (const run of runs) {
    if (run.midi < min) min = run.midi;
    if (run.midi > max) max = run.midi;
  }
  min = Math.floor(min) - 2;
  max = Math.ceil(max) + 2;
  if (max - min < 8) {
    const mid = (min + max) / 2;
    min = mid - 4;
    max = mid + 4;
  }
  return { min, max };
}
