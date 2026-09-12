/** One-decimal countdown, e.g. 10.0 → 0.1. */
export function formatCountdown(ms: number): string {
  return (Math.max(0, ms) / 1000).toFixed(1);
}
