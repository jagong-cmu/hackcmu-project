import type { LrcLine } from "./parseLrc.ts";

/** A line stays on screen for its own span, but never longer than this. */
export const MAX_LINE_SEC = 7;
/**
 * The fill finishes this far through a line's span, so the last word is full
 * a beat before the next line takes over instead of still sweeping.
 */
export const SweepFraction = 0.9;

export type WipeWord = { text: string; fill: number };
export type Wipe = {
  words: WipeWord[];
  /** The word being filled now; -1 before the line starts. */
  wordIndex: number;
  /** 0..1 across the whole line. */
  progress: number;
};

/** How long a line is on stage: until the next line, capped. */
export function lineSpan(line: LrcLine, next: LrcLine | null): number {
  return Math.min(next ? next.timeSec - line.timeSec : MAX_LINE_SEC, MAX_LINE_SEC);
}

/**
 * Playback time to per-word fill. The source lyrics are line-timed, so words
 * share the line's sweep in proportion to their letters (a long word takes
 * longer than "I"). Pure: the caller supplies the audio-clock time.
 */
export function lineWipe(text: string, startSec: number, spanSec: number, t: number): Wipe {
  const raw = text.split(/\s+/).filter(Boolean);
  const weights = raw.map((w) => Math.max(1, Array.from(w).length));
  const total = weights.reduce((a, b) => a + b, 0);

  const sweep = spanSec * SweepFraction;
  let progress = 0;
  if (Number.isFinite(t)) {
    progress = sweep > 0 ? Math.min(1, Math.max(0, (t - startSec) / sweep)) : t >= startSec ? 1 : 0;
    // Snap float noise so a finished line reads exactly 1, not 0.9999999.
    progress = Math.round(progress * 1e6) / 1e6;
  }

  const sung = progress * total;
  let before = 0;
  let wordIndex = -1;
  const words = raw.map((word, i) => {
    const fill = Math.min(1, Math.max(0, (sung - before) / weights[i]));
    before += weights[i];
    if (progress > 0 && wordIndex < 0 && fill < 1) wordIndex = i;
    return { text: word, fill };
  });
  if (progress >= 1 && words.length) wordIndex = words.length - 1;
  return { words, wordIndex, progress };
}
