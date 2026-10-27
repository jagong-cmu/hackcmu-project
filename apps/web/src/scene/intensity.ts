import type { HitGrade } from "../scoring/hitGrade.ts";

/**
 * The reactive room's brain, pure so it can be tested without a browser.
 * Accuracy goes in; a smoothed 0..1 intensity comes out that
 *  - starts moving within a frame and is past halfway by 150ms (attack),
 *  - settles slowly (release), so it swells and sags instead of flickering,
 *  - and cannot flash: after any change of direction it will not reverse again
 *    for MinReverseMs, so brightness makes at most four transitions a second
 *    (two flashes), inside WCAG 2.3.1's limit of three.
 * Read-only: nothing here touches scoring.
 */

export const AttackMs = 90;
export const ReleaseMs = 700;
export const MinReverseMs = 250;
/** Movement smaller than this does not count as a direction. */
const Deadband = 0.002;

/** Where the room sits when nobody is being scored (idle, opponent's turn, between takes). */
export const IdleLevel = 0.3;

export type FilterState = { value: number; dir: -1 | 0 | 1; sinceTurnMs: number };

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

export function initialFilter(value = IdleLevel): FilterState {
  return { value: Number.isFinite(value) ? clamp01(value) : IdleLevel, dir: 0, sinceTurnMs: Infinity };
}

export function stepIntensity(s: FilterState, target: number, dtMs: number): FilterState {
  const since = s.sinceTurnMs + dtMs;
  if (!Number.isFinite(target) || !(dtMs > 0)) return { ...s, sinceTurnMs: since };
  const t = clamp01(target);
  const delta = t - s.value;
  const want: -1 | 0 | 1 = Math.abs(delta) <= Deadband ? 0 : delta > 0 ? 1 : -1;
  if (want !== 0 && s.dir !== 0 && want !== s.dir && since < MinReverseMs) {
    return { ...s, sinceTurnMs: since }; // too soon to reverse: hold
  }
  const tau = delta > 0 ? AttackMs : ReleaseMs;
  const value = clamp01(s.value + delta * (1 - Math.exp(-dtMs / tau)));
  if (want !== 0 && want !== s.dir) return { value, dir: want, sinceTurnMs: 0 };
  return { value, dir: s.dir, sinceTurnMs: since };
}

/** A live hit grade as an accuracy. No grade (silence, off pitch) is low, not zero. */
export function accuracyOf(grade: HitGrade | null): number {
  switch (grade) {
    case "perfect":
      return 1;
    case "great":
      return 0.82;
    case "good":
      return 0.6;
    case "okay":
      return 0.38;
    default:
      return 0.12;
  }
}

export type LightParams = {
  /** How many disco spots are lit. */
  spotCount: number;
  /** Spot drift speed, radians per second. */
  spotSpeed: number;
  /** Edge light level, 0..1. */
  brightness: number;
  /** The TV's glow, 0..1. */
  tvGlow: number;
};

/** Low accuracy: dim, slow, sparse. High accuracy: bright, lively, full party. */
export function lightParams(intensity: number): LightParams {
  const i = clamp01(Number.isFinite(intensity) ? intensity : 0);
  return {
    spotCount: Math.round(2 + 6 * i),
    spotSpeed: 0.15 + 0.9 * i,
    brightness: 0.35 + 0.65 * i,
    tvGlow: 0.15 + 0.85 * i,
  };
}
