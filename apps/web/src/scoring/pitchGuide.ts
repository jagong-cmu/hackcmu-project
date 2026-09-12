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
  rawMidi: number | null;
  octaveShift: number;
  pendingShift: number;
  pendingCount: number;
  lastTs: number;
  buf: number[];
  trail: Array<{ t: number; midi: number; inTune: boolean }>;
};

export function createPitchSmoothState(): PitchSmoothState {
  return {
    midi: null,
    rawMidi: null,
    octaveShift: 0,
    pendingShift: 0,
    pendingCount: 0,
    lastTs: 0,
    buf: [],
    trail: [],
  };
}

// A bass singing two octaves under the tune is still singing it correctly, so
// the indicator is drawn folded into the melody's octave. Scoring already
// compares octave-independently via wrapMidi. The fold only changes after it
// has been wanted for SHIFT_HOLD consecutive frames, so the indicator cannot
// flicker between octaves at a boundary.
const SHIFT_HOLD = 12;

const MIN_HZ = 55;
const MAX_HZ = 1400;
const MIN_RMS = 0.012;
const BLEED_RMS = 0.009;
const MEDIAN_N = 5;
const EMA = 0.36;
const MAX_ST_PER_SEC = 34;
// Absolute singable bounds. The live indicator must never be clamped to the
// melody's range: doing that makes singing above the tune look identical to
// singing exactly at the top of it.
const SING_MIN_MIDI = 36;
const SING_MAX_MIDI = 96;
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

/**
 * Correct a detector octave error, in either direction.
 *
 * Only fires when the reading is within OCTAVE_TOL of an exact octave away
 * from where we were AND that reading is a big jump. A genuine slide is
 * continuous and never lands on 12.00 semitones, so this leaves real singing
 * alone. An earlier version shifted up unconditionally whenever +12 landed
 * nearer the previous note, which turned every genuine downward interval into
 * a jump up and ratcheted the display to the ceiling.
 */
const OCTAVE_TOL = 0.45;
const OCTAVE_MIN_JUMP = 7;

function fixOctave(raw: number, previous: number): number {
  const delta = raw - previous;
  if (Math.abs(delta) < OCTAVE_MIN_JUMP) return raw;
  for (const shift of [12, -12, 24, -24]) {
    if (Math.abs(delta + shift) <= OCTAVE_TOL) return raw + shift;
  }
  return raw;
}

/**
 * Display-only smoother. Scoring still uses raw frames.
 *
 * Direction is always true: higher Hz moves up the staff. The returned `midi`
 * is folded into the melody's octave so a low voice singing the tune correctly
 * two octaves down still reads as on the line; `rawMidi` carries the pitch
 * actually sung, for labelling.
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
): { midi: number; rawMidi: number | null; inTune: boolean; tracking: boolean } {
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
    raw = fixOctave(raw, state.midi);

    const looksLikeBleed =
      input.rms < BLEED_RMS &&
      input.targetMidi != null &&
      Math.abs(wrapMidi(raw, input.targetMidi) - input.targetMidi) < 0.3;
    if (!looksLikeBleed) {
      tracking = true;
      state.rawMidi = raw;

      // Fold into the melody's octave, with hysteresis so it cannot flicker.
      const anchor = input.targetMidi ?? input.restMidi;
      const want = 12 * Math.round((anchor - raw) / 12);
      if (want === state.octaveShift) {
        state.pendingCount = 0;
      } else if (want === state.pendingShift) {
        if (++state.pendingCount >= SHIFT_HOLD) {
          state.octaveShift = want;
          state.pendingCount = 0;
          state.buf = [];
          if (state.midi != null) state.midi = raw + want;
        }
      } else {
        state.pendingShift = want;
        state.pendingCount = 1;
      }

      const folded = raw + state.octaveShift;
      state.buf.push(folded);
      if (state.buf.length > MEDIAN_N) state.buf.shift();
      let next = median(state.buf);
      next = state.midi + (next - state.midi) * EMA;
      const maxStep = MAX_ST_PER_SEC * dt;
      const delta = next - state.midi;
      if (Math.abs(delta) > maxStep) next = state.midi + Math.sign(delta) * maxStep;
      state.midi = clamp(next, SING_MIN_MIDI, SING_MAX_MIDI);
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

  return { midi: state.midi, rawMidi: state.rawMidi, inTune, tracking };
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

/** Zoom the staff to notes actually on screen instead of the whole song. */
export function windowedMelodyRange(
  runs: NoteRun[],
  tNow: number,
  lookbehind: number,
  lookahead: number,
  liveMidi?: number | null,
): { min: number; max: number } {
  const visible = runs.filter(
    (run) => run.endSec >= tNow - lookbehind && run.startSec <= tNow + lookahead,
  );
  const base = melodyRange(visible.length ? visible : runs);
  if (liveMidi == null || !Number.isFinite(liveMidi)) return base;
  return {
    min: Math.min(base.min, liveMidi - 1.5),
    max: Math.max(base.max, liveMidi + 1.5),
  };
}
