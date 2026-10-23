import { MatchCountdownMs, SwapMs } from "@karaoke/shared";

/** One-decimal countdown, e.g. 5.0 → 0.1. */
export function formatCountdown(ms: number): string {
  return (Math.max(0, ms) / 1000).toFixed(1);
}

/**
 * The opening veil lifts with this much left, so the last beat shows the clear
 * stage (lyrics, cameras, turn guide, compact timer) before the GO callout.
 */
export const OverlayHideMs = 1_000;
/** How long the veil is up: the whole MatchCountdownMs minus the clear final beat. */
export const OverlaySpanMs = MatchCountdownMs - OverlayHideMs;

/** Full-screen countdown veil: up from the start of the countdown until OverlayHideMs. */
export function showCountdownOverlay(msUntilStart: number): boolean {
  return msUntilStart > OverlayHideMs;
}

/** The versus card owns the first stretch of the countdown. Never longer than 2s. */
export const MatchIntroMs = 2_000;

/** True while the versus card should be up: the first MatchIntroMs of the countdown. */
export function showMatchIntro(msUntilStart: number): boolean {
  return (
    Number.isFinite(msUntilStart) &&
    msUntilStart > MatchCountdownMs - MatchIntroMs &&
    msUntilStart <= MatchCountdownMs
  );
}

/** Ranked swap is only 5s, so the veil stays up until GO. */
export function showSwapOverlay(msUntilStart: number): boolean {
  return msUntilStart > 0;
}

/** Darkest when the countdown arms, clearer toward OverlayHideMs so the stage shows through. */
export function countdownVeilOpacity(msUntilStart: number): number {
  const t = Math.min(1, Math.max(0, (msUntilStart - OverlayHideMs) / OverlaySpanMs));
  return 0.28 + t * 0.42;
}

/** Same fade as the opening veil, compressed into the 5s swap. */
export function swapVeilOpacity(msUntilStart: number): number {
  const t = Math.min(1, Math.max(0, msUntilStart / SwapMs));
  return 0.28 + t * 0.42;
}
