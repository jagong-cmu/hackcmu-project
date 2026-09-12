import type { SongMeta } from "./types.ts";

/**
 * Ranked/duet clips always start at 0:00 and run through the first chorus
 * so a turn begins on the intro and ends on a complete lyric phrase.
 */
export const SONGS: SongMeta[] = [
  {
    id: "viva-la-vida",
    title: "Viva La Vida",
    artist: "Coldplay",
    clipStartSec: 0,
    clipDurationSec: 95.2,
    duetClipStartSec: 0,
    duetClipDurationSec: 95.2,
    chaosDurationSec: 60,
  },
  {
    id: "creep",
    title: "Creep",
    artist: "Radiohead",
    clipStartSec: 0,
    clipDurationSec: 85.2,
    duetClipStartSec: 0,
    duetClipDurationSec: 85.2,
    chaosDurationSec: 60,
  },
  {
    id: "perfect",
    title: "Perfect",
    artist: "Ed Sheeran",
    clipStartSec: 0,
    clipDurationSec: 100.4,
    duetClipStartSec: 0,
    duetClipDurationSec: 100.4,
    chaosDurationSec: 60,
  },
  {
    id: "im-not-the-only-one",
    title: "I'm Not The Only One",
    artist: "Sam Smith",
    clipStartSec: 0,
    clipDurationSec: 88.8,
    duetClipStartSec: 0,
    duetClipDurationSec: 88.8,
    chaosDurationSec: 60,
  },
  {
    id: "from-the-start",
    title: "From The Start",
    artist: "Laufey",
    clipStartSec: 0,
    clipDurationSec: 77.6,
    duetClipStartSec: 0,
    duetClipDurationSec: 77.6,
    chaosDurationSec: 60,
  },
  {
    id: "beauty-and-a-beat",
    title: "Beauty And A Beat",
    artist: "Justin Bieber",
    clipStartSec: 0,
    clipDurationSec: 75.6,
    duetClipStartSec: 0,
    duetClipDurationSec: 75.6,
    chaosDurationSec: 60,
  },
];

export function songById(id: string): SongMeta | undefined {
  return SONGS.find((s) => s.id === id);
}
