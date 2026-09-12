import type { SongMeta } from "./types.ts";

export const SONGS: SongMeta[] = [
  {
    id: "viva-la-vida",
    title: "Viva La Vida",
    artist: "Coldplay",
    clipStartSec: 0,
    clipDurationSec: 15,
    duetClipStartSec: 0,
    duetClipDurationSec: 45,
    chaosDurationSec: 60,
  },
  {
    id: "creep",
    title: "Creep",
    artist: "Radiohead",
    clipStartSec: 0,
    clipDurationSec: 15,
    duetClipStartSec: 0,
    duetClipDurationSec: 45,
    chaosDurationSec: 60,
  },
  {
    id: "california-gurls",
    title: "California Gurls",
    artist: "Katy Perry",
    clipStartSec: 0,
    clipDurationSec: 15,
    duetClipStartSec: 0,
    duetClipDurationSec: 45,
    chaosDurationSec: 60,
  },
  {
    id: "payphone",
    title: "Payphone",
    artist: "Maroon 5",
    clipStartSec: 0,
    clipDurationSec: 15,
    duetClipStartSec: 0,
    duetClipDurationSec: 45,
    chaosDurationSec: 60,
  },
  {
    id: "perfect",
    title: "Perfect",
    artist: "Ed Sheeran",
    clipStartSec: 0,
    clipDurationSec: 15,
    duetClipStartSec: 0,
    duetClipDurationSec: 45,
    chaosDurationSec: 60,
  },
  {
    id: "take-on-me",
    title: "Take On Me",
    artist: "a-ha",
    clipStartSec: 0,
    clipDurationSec: 15,
    duetClipStartSec: 0,
    duetClipDurationSec: 45,
    chaosDurationSec: 60,
  },
];

export function songById(id: string): SongMeta | undefined {
  return SONGS.find((s) => s.id === id);
}
