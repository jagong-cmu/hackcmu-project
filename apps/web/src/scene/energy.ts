import type { MelodyFile } from "@karaoke/shared";

/** The window either side of the playhead, in seconds. */
const Window = 1.5;
/** Floor: a rest in the melody must not turn the party room off. */
const Floor = 0.35;

/**
 * How busy the song is around the playhead, 0.35..1: the share of the melody
 * that is sounding in a short window. Used by Chaos, which has no score.
 */
export function melodyEnergy(
  melody: Pick<MelodyFile, "hz" | "sampleRateHz" | "startSec">,
  playheadSec: number,
): number {
  const { hz, sampleRateHz, startSec } = melody;
  if (!Number.isFinite(playheadSec) || !hz.length || !(sampleRateHz > 0)) return Floor;
  const from = Math.max(0, Math.round((playheadSec - Window - startSec) * sampleRateHz));
  const to = Math.min(hz.length, Math.round((playheadSec + Window - startSec) * sampleRateHz));
  if (to <= from) return Floor;
  let voiced = 0;
  for (let i = from; i < to; i++) if (hz[i] != null) voiced++;
  return Floor + (1 - Floor) * (voiced / (to - from));
}
