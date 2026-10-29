import type { MelodyFile } from "@karaoke/shared";
import { noteName, segmentMelody } from "../scoring/pitchGuide.ts";

/** Shorter runs are pitch-tracker blips, not notes anyone sings. */
const MinNoteSec = 0.15;

/** "C3–G4": lowest and highest held note in the song's melody.json, or null with no notes. */
export function vocalRange(melody: MelodyFile): string | null {
  const midis = segmentMelody(melody)
    .filter((n) => n.endSec - n.startSec >= MinNoteSec)
    .map((n) => n.midi);
  if (!midis.length) return null;
  return `${noteName(Math.min(...midis))}–${noteName(Math.max(...midis))}`;
}
