/**
 * The one overall formula (PRD: overall = 0.7·pitch + 0.3·tone, rounded).
 * The client's DSP and the server's score route both use it, so a posted
 * `overall` is never trusted: the server recomputes it from pitch and tone.
 */
export const OverallPitchWeight = 0.7;
export const OverallToneWeight = 0.3;

export function overallFrom(pitch: number, tone: number): number {
  return Math.round(OverallPitchWeight * pitch + OverallToneWeight * tone);
}
