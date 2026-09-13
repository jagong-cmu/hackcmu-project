import type { SongMeta } from "./types.ts";

/**
 * Ranked clips are the recognizable chorus hook, 15–20 seconds.
 * Duet clips start at 0:00 and run the whole instrumental.
 */
export const SONGS: SongMeta[] = [
  {
    id: "viva-la-vida",
    title: "Viva La Vida",
    artist: "Coldplay",
    clipStartSec: 65.2,
    clipDurationSec: 20,
    duetClipStartSec: 0,
    duetClipDurationSec: 255.1,
    chaosDurationSec: 60,
  },
  {
    id: "creep",
    title: "Creep",
    artist: "Radiohead",
    clipStartSec: 64.3,
    clipDurationSec: 20,
    duetClipStartSec: 0,
    duetClipDurationSec: 252.9,
    chaosDurationSec: 60,
  },
  {
    id: "perfect",
    title: "Perfect",
    artist: "Ed Sheeran",
    clipStartSec: 66.3,
    clipDurationSec: 20,
    duetClipStartSec: 0,
    duetClipDurationSec: 290.6,
    chaosDurationSec: 60,
  },
  {
    id: "im-not-the-only-one",
    title: "I'm Not The Only One",
    artist: "Sam Smith",
    clipStartSec: 64.9,
    clipDurationSec: 18,
    duetClipStartSec: 0,
    duetClipDurationSec: 244.2,
    chaosDurationSec: 60,
  },
  {
    id: "from-the-start",
    title: "From The Start",
    artist: "Laufey",
    clipStartSec: 51.2,
    clipDurationSec: 20,
    duetClipStartSec: 0,
    duetClipDurationSec: 179.4,
    chaosDurationSec: 60,
  },
  {
    id: "cupid",
    title: "Cupid (Twin Ver.)",
    artist: "FIFTY FIFTY",
    // Ranked hook: "I gave a second chance to Cupid" through "Cupid is so dumb".
    clipStartSec: 42.3,
    clipDurationSec: 18,
    duetClipStartSec: 0,
    duetClipDurationSec: 191.6,
    chaosDurationSec: 60,
  },
  {
    id: "beauty-and-a-beat",
    title: "Beauty And A Beat",
    artist: "Justin Bieber",
    clipStartSec: 45.2,
    clipDurationSec: 20,
    duetClipStartSec: 0,
    duetClipDurationSec: 238.7,
    chaosDurationSec: 60,
  },
];

export function songById(id: string): SongMeta | undefined {
  return SONGS.find((s) => s.id === id);
}
