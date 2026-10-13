import { ClipLeadInMs, RankedHookMaxSec } from "./protocol.ts";
import type { ClipAnchor, SongMeta } from "./types.ts";

/**
 * Where a clip may start. Every Ranked / Duet / Training clip opens on one of
 * two lyric anchors, `ClipLeadInMs` early, never at a random point mid-song:
 *  - "firstLyric": the first sung line in lyrics.lrc
 *  - "chorus":     the chorus hook's first line (the old ranked clipStartSec)
 */
export const ClipAnchors: readonly ClipAnchor[] = ["firstLyric", "chorus"];

/** Anchors closer than this collapse into one (the earlier, firstLyric). */
export const ClipAnchorMergeSec = ClipLeadInMs / 1000;

export type ClipKind = "ranked" | "duet" | "training";

export type ClipWindow = {
  anchor: ClipAnchor;
  /** Song time the anchor line starts at: singing (and scoring) begins here. */
  anchorSec: number;
  /** Song time the audio starts at: anchorSec − lead-in, never below 0. */
  startSec: number;
  /** anchorSec − startSec. Shorter than ClipLeadInMs only when the anchor is < 5s in. */
  leadInSec: number;
  /** Whole clip, lead-in included. */
  durationSec: number;
};

const valid = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;

/** Seconds for an anchor, or undefined if this song doesn't define it. */
export function anchorSecFor(song: SongMeta, anchor: ClipAnchor): number | undefined {
  if (anchor === "firstLyric") return valid(song.firstLyricSec) ? song.firstLyricSec : undefined;
  if (valid(song.chorusSec)) return song.chorusSec;
  // Pre-anchor meta.json: the ranked hook start was the chorus line.
  return valid(song.clipStartSec) ? song.clipStartSec : undefined;
}

/**
 * The anchors a match may pick from. A missing anchor falls back to the
 * other; two anchors within ClipAnchorMergeSec count as one.
 */
export function availableAnchors(song: SongMeta): ClipAnchor[] {
  const first = anchorSecFor(song, "firstLyric");
  const chorus = anchorSecFor(song, "chorus");
  if (first === undefined && chorus === undefined) return [];
  if (first === undefined) return ["chorus"];
  if (chorus === undefined) return ["firstLyric"];
  if (Math.abs(chorus - first) < ClipAnchorMergeSec) return ["firstLyric"];
  return ["firstLyric", "chorus"];
}

/** 50/50 between the song's anchors. `rng` is injectable for tests. */
export function pickClipAnchor(song: SongMeta, rng: () => number = Math.random): ClipAnchor {
  const options = availableAnchors(song);
  if (options.length === 0) return "chorus";
  const i = Math.min(options.length - 1, Math.floor(rng() * options.length));
  return options[i] ?? options[0]!;
}

/** End of the instrumental in song seconds. */
export function trackEndSec(song: SongMeta): number {
  return Math.max(0, song.duetClipStartSec) + Math.max(1, song.duetClipDurationSec);
}

/**
 * The clip for a match. Audio starts `ClipLeadInMs` before the anchor (or at
 * 0:00 if the anchor is earlier than that).
 *  - ranked:   lead-in + the song's 15–20s hook length (sung after the lead-in)
 *  - duet / training: lead-in, then to the end of the track
 */
export function clipWindowFor(song: SongMeta, kind: ClipKind, anchor: ClipAnchor): ClipWindow {
  const options = availableAnchors(song);
  const use: ClipAnchor = options.includes(anchor) ? anchor : (options[0] ?? anchor);
  const end = trackEndSec(song);
  const anchorSec = Math.min(anchorSecFor(song, use) ?? 0, Math.max(0, end - 1));
  const startSec = Math.max(0, +(anchorSec - ClipLeadInMs / 1000).toFixed(2));
  const leadInSec = +(anchorSec - startSec).toFixed(2);
  if (kind === "ranked") {
    const hookSec = Math.min(RankedHookMaxSec, Math.max(1, song.clipDurationSec));
    const durationSec = Math.min(leadInSec + hookSec, end - startSec);
    return { anchor: use, anchorSec, startSec, leadInSec, durationSec: +durationSec.toFixed(2) };
  }
  return {
    anchor: use,
    anchorSec,
    startSec,
    leadInSec,
    durationSec: +Math.max(1, end - startSec).toFixed(2),
  };
}

/**
 * The part of a clip that is sung and scored: from the anchor to the clip's
 * end. The lead-in is never scored (it is instrumental, or the tail of the
 * line before the chorus).
 */
export function singWindow(clip: {
  startSec: number;
  durationSec: number;
  leadInSec?: number;
}): { startSec: number; durationSec: number } {
  const lead = Math.max(0, Math.min(clip.leadInSec ?? 0, clip.durationSec));
  return { startSec: clip.startSec + lead, durationSec: clip.durationSec - lead };
}
