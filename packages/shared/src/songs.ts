import type { SongMeta } from "./types.ts";

/**
 * Ranked clips start at 0:00 and run through the first chorus.
 * Duet clips start at 0:00 and run the whole instrumental.
 */
export const SONGS: SongMeta[] = [
  {
    id: "viva-la-vida",
    title: "Viva La Vida",
    artist: "Coldplay",
    clipStartSec: 0,
    clipDurationSec: 95.2,
    duetClipStartSec: 0,
    duetClipDurationSec: 255.1,
    chaosDurationSec: 60,
  },
  {
    id: "creep",
    title: "Creep",
    artist: "Radiohead",
    clipStartSec: 0,
    clipDurationSec: 85.2,
    duetClipStartSec: 0,
    duetClipDurationSec: 252.9,
    chaosDurationSec: 60,
  },
  {
    id: "perfect",
    title: "Perfect",
    artist: "Ed Sheeran",
    clipStartSec: 0,
    clipDurationSec: 100.4,
    duetClipStartSec: 0,
    duetClipDurationSec: 290.6,
    chaosDurationSec: 60,
  },
  {
    id: "im-not-the-only-one",
    title: "I'm Not The Only One",
    artist: "Sam Smith",
    clipStartSec: 0,
    clipDurationSec: 88.8,
    duetClipStartSec: 0,
    duetClipDurationSec: 244.2,
    chaosDurationSec: 60,
  },
  {
    id: "from-the-start",
    title: "From The Start",
    artist: "Laufey",
    clipStartSec: 0,
    clipDurationSec: 77.6,
    duetClipStartSec: 0,
    duetClipDurationSec: 179.4,
    chaosDurationSec: 60,
  },
  {
    id: "cupid",
    title: "Cupid (Twin Ver.)",
    artist: "FIFTY FIFTY",
    // The instrumental carries 3s of prepended silence as a count-in: this cover
    // opens straight on the vocal, with no intro to breathe in.
    // 0:00 through the first chorus, ending on "Cupid is so dumb" plus the hold.
    clipStartSec: 0,
    clipDurationSec: 61.7,
    duetClipStartSec: 0,
    duetClipDurationSec: 191.6,
    chaosDurationSec: 60,
  },
  {
    id: "beauty-and-a-beat",
    title: "Beauty And A Beat",
    artist: "Justin Bieber",
    clipStartSec: 0,
    clipDurationSec: 75.6,
    duetClipStartSec: 0,
    duetClipDurationSec: 238.7,
    chaosDurationSec: 60,
  },
];

export function songById(id: string): SongMeta | undefined {
  return SONGS.find((s) => s.id === id);
}
