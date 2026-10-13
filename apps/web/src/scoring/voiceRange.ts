/**
 * Voice range profile: what the onboarding voice check measures, and the pure
 * helpers the live pitch visualizer uses it for.
 *
 * DISPLAY ONLY. Nothing here is read by scoreClip / cents / the server; ranked
 * scoring must stay identical for every singer whether or not they ran the
 * voice check. Everything in this file is pure (no DOM, no storage) so it can
 * be unit-tested with `npx tsx --test`.
 */

export type VoiceProfile = {
  /** Lowest comfortable note, fractional MIDI. */
  lowMidi: number;
  /** Highest comfortable note, fractional MIDI. */
  highMidi: number;
  /** A comfortable held "ahh", fractional MIDI. */
  centerMidi: number;
  /** Epoch ms. */
  measuredAt: number;
};

/**
 * Every tuning number for the voice check and for how the visualizer uses the
 * profile lives here.
 */
export const VoiceTuning = {
  // ---- capture ----
  /** How long each guided capture records once the voice is first heard. */
  captureMs: 3500,
  /** Give up waiting for a voice after this long and offer a retry. */
  captureTimeoutMs: 12000,
  /** Frame gate: detector confidence (CREPE confidence / pitchy clarity). */
  minConfidence: 0.5,
  /** Frame gate: RMS, a little above the live guide's MIN_RMS (0.012). */
  minRms: 0.015,
  /** Frame gate: plausible sung MIDI (A1 .. C7). Matches the live 55 Hz floor. */
  minMidi: 33,
  maxMidi: 96,

  // ---- estimator ----
  /** Fewer confident frames than this → "we didn't hear enough, try again". */
  minFrames: 20,
  /**
   * Octave-glitch rejection. A frame this far from the first-pass median that
   * lands within `octaveGlitchTol` of it after a ±12 shift is a detector
   * octave error (subharmonic / 2nd harmonic lock) and is dropped.
   */
  octaveGlitchMinDist: 9,
  octaveGlitchTol: 1.5,
  /** Outlier band around the median: max(outlierMinSt, outlierMadK × MAD). */
  outlierMinSt: 1.5,
  outlierMadK: 3,
  /** If fewer than this fraction of confident frames survive, the hum was too wobbly. */
  minKeptFraction: 0.5,
  /**
   * Median absolute deviation (st) above which the "note" was really a glide
   * or a wander, not a held pitch. A steady hum sits around 0.1–0.3 st.
   */
  maxSpreadSt: 1,

  // ---- profile sanity ----
  /** high − low must be at least this many semitones. */
  minRangeSt: 5,
  /** The held "ahh" may sit this far outside [low, high] before we ask to redo it. */
  centerSlackSt: 2,

  // ---- live visualizer ----
  /**
   * Range-guided octave correction: a raw reading further than this outside
   * [lowMidi, highMidi] is treated as a possible detector octave error.
   */
  rangeMarginSt: 5,
} as const;

export type VoiceFrame = {
  /** Detected pitch as fractional MIDI, or null when unvoiced. */
  midi: number | null;
  /** CREPE confidence or pitchy clarity, 0..1. */
  confidence: number;
  rms: number;
};

export type PitchEstimate =
  | { ok: true; midi: number; used: number; total: number; spread: number }
  | { ok: false; reason: "too-few" | "unstable"; used: number; total: number };

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  if (s.length === 0) return NaN;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** True when a frame passes the capture gates. */
export function isConfidentFrame(f: VoiceFrame): f is VoiceFrame & { midi: number } {
  return (
    f.midi != null &&
    Number.isFinite(f.midi) &&
    f.confidence >= VoiceTuning.minConfidence &&
    f.rms >= VoiceTuning.minRms &&
    f.midi >= VoiceTuning.minMidi &&
    f.midi <= VoiceTuning.maxMidi
  );
}

/**
 * Robust single-note estimate from a few seconds of frames:
 *   1. keep confident, loud, in-bounds frames;
 *   2. drop octave glitches (≈ ±12 st from the first-pass median);
 *   3. drop outliers outside max(outlierMinSt, k·MAD) of the new median;
 *   4. median of what is left, provided it is a held note (MAD ≤ maxSpreadSt).
 */
export function estimateHeldPitch(frames: VoiceFrame[]): PitchEstimate {
  const T = VoiceTuning;
  const total = frames.length;
  const voiced = frames.filter(isConfidentFrame).map((f) => f.midi);
  if (voiced.length < T.minFrames) return { ok: false, reason: "too-few", used: voiced.length, total };

  const m0 = median(voiced);
  const noGlitch = voiced.filter((x) => {
    const d = x - m0;
    if (Math.abs(d) < T.octaveGlitchMinDist) return true;
    const isOctaveOff =
      Math.abs(d - 12) <= T.octaveGlitchTol ||
      Math.abs(d + 12) <= T.octaveGlitchTol ||
      Math.abs(d - 24) <= T.octaveGlitchTol ||
      Math.abs(d + 24) <= T.octaveGlitchTol;
    return !isOctaveOff;
  });

  const m1 = median(noGlitch);
  const mad = median(noGlitch.map((x) => Math.abs(x - m1)));
  const band = Math.max(T.outlierMinSt, T.outlierMadK * mad);
  const kept = noGlitch.filter((x) => Math.abs(x - m1) <= band);

  if (kept.length < T.minFrames || kept.length < voiced.length * T.minKeptFraction) {
    return { ok: false, reason: "unstable", used: kept.length, total };
  }
  const midi = median(kept);
  const spread = median(kept.map((x) => Math.abs(x - midi)));
  if (spread > T.maxSpreadSt) return { ok: false, reason: "unstable", used: kept.length, total };
  return { ok: true, midi, used: kept.length, total, spread };
}

export type ProfileStep = "low" | "high" | "center";

export type ProfileCheck =
  | { ok: true; profile: VoiceProfile }
  | { ok: false; redo: ProfileStep[]; message: string };

/** Sanity-check three estimates and assemble the profile. */
export function buildVoiceProfile(
  lowMidi: number,
  highMidi: number,
  centerMidi: number,
  measuredAt: number,
): ProfileCheck {
  const T = VoiceTuning;
  if (!(lowMidi < highMidi)) {
    return {
      ok: false,
      redo: ["low", "high"],
      message: "Your low note came out higher than your high note. Let’s redo both.",
    };
  }
  if (highMidi - lowMidi < T.minRangeSt) {
    return {
      ok: false,
      redo: ["low", "high"],
      message: `That’s only ${Math.round(highMidi - lowMidi)} semitones apart. Go a bit lower, then a bit higher.`,
    };
  }
  if (centerMidi < lowMidi - T.centerSlackSt || centerMidi > highMidi + T.centerSlackSt) {
    return {
      ok: false,
      redo: ["center"],
      message: "Your “ahh” landed outside your range. Hold a relaxed, easy note.",
    };
  }
  return { ok: true, profile: { lowMidi, highMidi, centerMidi, measuredAt } };
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function midiNoteName(midi: number): string {
  const n = Math.round(midi);
  return `${NOTE_NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`;
}

/** "A2–E4, centre C3" */
export function formatVoiceProfile(p: Pick<VoiceProfile, "lowMidi" | "highMidi" | "centerMidi">): string {
  return `${midiNoteName(p.lowMidi)}–${midiNoteName(p.highMidi)}, centre ${midiNoteName(p.centerMidi)}`;
}

/** Validate something read back from storage. */
export function parseVoiceProfile(raw: unknown): VoiceProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const nums = [r.lowMidi, r.highMidi, r.centerMidi, r.measuredAt];
  if (!nums.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  const p = r as unknown as VoiceProfile;
  if (!(p.lowMidi < p.highMidi)) return null;
  return { lowMidi: p.lowMidi, highMidi: p.highMidi, centerMidi: p.centerMidi, measuredAt: p.measuredAt };
}

// ---------------------------------------------------------------------------
// Visualizer helpers (used by pitchGuide.smoothLivePitch via PitchSmoothState)
// ---------------------------------------------------------------------------

/**
 * Range-guided octave correction for a raw detector reading.
 *
 * Mirrors pitchGuide's fixOctave: it only ever moves a reading by exactly one
 * octave, and only when that is clearly better. If the reading is more than
 * `rangeMarginSt` outside the singer's measured [low, high] and a ±12 shift
 * puts it back inside that widened window, the shifted value is returned.
 * Readings inside the window, and readings that no single octave can rescue
 * (someone else singing, whistling), are returned unchanged. The 5 st margin
 * is deliberately wide: a singer stretching past their comfortable range is
 * shown faithfully; only a reading an octave-ish off is touched.
 */
export function fixOctaveByRange(
  raw: number,
  range: Pick<VoiceProfile, "lowMidi" | "highMidi">,
): number {
  const lo = range.lowMidi - VoiceTuning.rangeMarginSt;
  const hi = range.highMidi + VoiceTuning.rangeMarginSt;
  if (raw >= lo && raw <= hi) return raw;
  const shifted = raw < lo ? raw + 12 : raw - 12;
  return shifted >= lo && shifted <= hi ? shifted : raw;
}
