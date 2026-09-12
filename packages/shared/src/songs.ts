import type { SongMeta } from "./types.ts";

/** Ranked/duet clips start ~5s before the first lyric so GO is not on the downbeat. */
export const SONGS: SongMeta[] = [
  {
    id: "viva-la-vida",
    title: "Viva La Vida",
    artist: "Coldplay",
    clipStartSec: 4.0,
    clipDurationSec: 15,
    duetClipStartSec: 4.0,
    duetClipDurationSec: 45,
    chaosDurationSec: 60,
  },
  {
    id: "creep",
    title: "Creep",
    artist: "Radiohead",
    clipStartSec: 18.1,
    clipDurationSec: 15,
    duetClipStartSec: 18.1,
    duetClipDurationSec: 45,
    chaosDurationSec: 60,
  },
  {
    id: "perfect",
    title: "Perfect",
    artist: "Ed Sheeran",
    clipStartSec: 1.9,
    clipDurationSec: 15,
    duetClipStartSec: 1.9,
    duetClipDurationSec: 45,
    chaosDurationSec: 60,
  },
  {
    id: "im-not-the-only-one",
    title: "I'm Not The Only One",
    artist: "Sam Smith",
    clipStartSec: 15.3,
    clipDurationSec: 15,
    duetClipStartSec: 15.3,
    duetClipDurationSec: 45,
    chaosDurationSec: 60,
  },
];

export function songById(id: string): SongMeta | undefined {
  return SONGS.find((s) => s.id === id);
}
