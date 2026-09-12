import type { SongMeta } from "./types.ts";

export const SONGS: SongMeta[] = [
  {
    id: "viva-la-vida",
    title: "Viva La Vida",
    artist: "Coldplay",
    clipStartSec: 26,
    clipDurationSec: 15,
    duetClipStartSec: 26,
    duetClipDurationSec: 45,
    chaosDurationSec: 60,
  },
  {
    id: "creep",
    title: "Creep",
    artist: "Radiohead",
    clipStartSec: 9,
    clipDurationSec: 15,
    duetClipStartSec: 9,
    duetClipDurationSec: 45,
    chaosDurationSec: 60,
  },
  {
    id: "california-gurls",
    title: "California Gurls",
    artist: "Katy Perry",
    clipStartSec: 13,
    clipDurationSec: 15,
    duetClipStartSec: 13,
    duetClipDurationSec: 45,
    chaosDurationSec: 60,
  },
  {
    id: "animals",
    title: "Animals",
    artist: "Maroon 5",
    clipStartSec: 10,
    clipDurationSec: 15,
    duetClipStartSec: 10,
    duetClipDurationSec: 45,
    chaosDurationSec: 60,
  },
  {
    id: "perfect",
    title: "Perfect",
    artist: "Ed Sheeran",
    clipStartSec: 13,
    clipDurationSec: 15,
    duetClipStartSec: 13,
    duetClipDurationSec: 45,
    chaosDurationSec: 60,
  },
];

export function songById(id: string): SongMeta | undefined {
  return SONGS.find((s) => s.id === id);
}
