/** One-decimal countdown, e.g. 10.0 → 0.1. */
export function formatCountdown(ms: number): string {
  return (Math.max(0, ms) / 1000).toFixed(1);
}

/** Overlay covers the stage from ~10s remaining down to this mark, then lifts. */
export const OverlayHideMs = 5_000;
/** How long the veil is up (10s → 5s). */
export const OverlaySpanMs = 5_000;

/** Full-screen countdown veil: visible from 10s remaining until it hits 5s. */
export function showCountdownOverlay(msUntilStart: number): boolean {
  return msUntilStart > OverlayHideMs;
}

/** Darker at 10s, clearer as it approaches 5s so the stage shows through. */
export function countdownVeilOpacity(msUntilStart: number): number {
  const t = Math.min(1, Math.max(0, (msUntilStart - OverlayHideMs) / OverlaySpanMs));
  return 0.28 + t * 0.42;
}
