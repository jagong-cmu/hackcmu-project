import type { MelodyFile } from "@karaoke/shared";
import type { LrcLine } from "./parseLrc.ts";

/** Anchor seconds are 2-decimal; tolerate float noise when matching its line. */
const ANCHOR_EPS = 0.05;

/** The first line at or after the anchor: what the singer opens on. */
export function anchorLine(lines: LrcLine[], singFromSec: number): LrcLine | null {
  return lines.find((l) => l.timeSec >= singFromSec - ANCHOR_EPS) ?? null;
}

/** True while the clip is still in its instrumental lead-in. */
export function inLeadIn(currentTime: number, singFromSec: number | null | undefined): boolean {
  return singFromSec != null && currentTime < singFromSec - ANCHOR_EPS;
}

/**
 * Song time singing starts for a clip with a lead-in, or null when there is
 * none (Chaos, or an anchor at 0:00).
 */
export function singFromOf(
  clip: { startSec: number; leadInSec?: number } | null | undefined,
): number | null {
  if (!clip || !clip.leadInSec || clip.leadInSec <= 0) return null;
  return clip.startSec + clip.leadInSec;
}

/**
 * The melody with every note before `fromSec` silenced, so the pitch guide
 * and hit callouts stay quiet through the lead-in (which on a chorus start can
 * overlap the tail of the previous line) and the first notes still scroll in
 * from the right ahead of the anchor.
 */
export function melodyFrom(melody: MelodyFile, fromSec: number | null): MelodyFile {
  if (fromSec == null || fromSec <= melody.startSec) return melody;
  const cut = Math.min(
    melody.hz.length,
    Math.max(0, Math.round((fromSec - ANCHOR_EPS - melody.startSec) * melody.sampleRateHz)),
  );
  if (cut === 0) return melody;
  const hz = melody.hz.slice();
  for (let i = 0; i < cut; i++) hz[i] = null;
  return { ...melody, hz };
}
