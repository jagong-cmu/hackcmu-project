import type { SongMeta } from "./types.ts";

/**
 * Ranked clips are the first chorus of each song (downbeat → last chorus line),
 * not a global 15s cut. The clock adds a short preroll and holds the last line
 * so a turn never dies mid-phrase. Duet starts at the same chorus and runs longer.
 */
export const SONGS: SongMeta[] = [
  {
    id: "viva-la-vida",
    title: "Viva La Vida",
    artist: "Coldplay",
    clipStartSec: 65.2,
    clipDurationSec: 30.0,
    duetClipStartSec: 65.2,
    duetClipDurationSec: 45,
    chaosDurationSec: 60,
  },
  {
    id: "creep",
    title: "Creep",
    artist: "Radiohead",
    clipStartSec: 53.9,
    clipDurationSec: 31.3,
    duetClipStartSec: 53.9,
    duetClipDurationSec: 45,
    chaosDurationSec: 60,
  },
  {
    id: "perfect",
    title: "Perfect",
    artist: "Ed Sheeran",
    clipStartSec: 66.3,
    clipDurationSec: 34.1,
    duetClipStartSec: 66.3,
    duetClipDurationSec: 45,
    chaosDurationSec: 60,
  },
  {
    id: "im-not-the-only-one",
    title: "I'm Not The Only One",
    artist: "Sam Smith",
    clipStartSec: 64.9,
    clipDurationSec: 23.9,
    duetClipStartSec: 64.9,
    duetClipDurationSec: 45,
    chaosDurationSec: 60,
  },
  {
    id: "from-the-start",
    title: "From The Start",
    artist: "Laufey",
    // "That when I talk to you" through "from the start".
    clipStartSec: 51.2,
    clipDurationSec: 26.4,
    duetClipStartSec: 51.2,
    duetClipDurationSec: 45,
    chaosDurationSec: 60,
  },
  {
    id: "beauty-and-a-beat",
    title: "Beauty And A Beat",
    artist: "Justin Bieber",
    // "'Cause all I need" through "Baby, do it like you do".
    clipStartSec: 45.2,
    clipDurationSec: 30.4,
    duetClipStartSec: 45.2,
    duetClipDurationSec: 45,
    chaosDurationSec: 60,
  },
];

export function songById(id: string): SongMeta | undefined {
  return SONGS.find((s) => s.id === id);
}
