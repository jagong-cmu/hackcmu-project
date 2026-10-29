import { trackEndSec, type ClipWindow, type MelodyFile, type SongMeta } from "@karaoke/shared";

/**
 * Training sings the whole song: audio from 0:00 to the end. Singing (the
 * guide notes and the score) starts at the first sung note or lyric line,
 * whichever comes first; the intro before it is the lead-in.
 */
export function wholeSongClip(meta: SongMeta, melody: MelodyFile): ClipWindow {
  const firstNote = melody.hz.findIndex((hz) => hz != null);
  const noteSec = firstNote >= 0 ? melody.startSec + firstNote / melody.sampleRateHz : Infinity;
  const lyricSec = meta.firstLyricSec ?? Infinity;
  const end = trackEndSec(meta);
  const first = Math.min(noteSec, lyricSec);
  const anchorSec = Number.isFinite(first) ? Math.max(0, Math.min(first, end - 1)) : 0;
  return {
    anchor: "firstLyric",
    anchorSec: +anchorSec.toFixed(2),
    startSec: 0,
    leadInSec: +anchorSec.toFixed(2),
    durationSec: +Math.max(1, end).toFixed(2),
  };
}
