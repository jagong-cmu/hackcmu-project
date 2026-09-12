#!/usr/bin/env node
/**
 * Re-extracts every pack's melody from its isolated vocal, with the right
 * alignment mode per song.
 *
 * THE MODE MATTERS. extract-melody-stem can either DTW-align the vocal onto
 * the original or take a fixed offset. DTW is only for stems that have been
 * edited — gaps cut out, sections removed. For a full-length stem already in
 * the original's timebase, DTW is actively harmful: a sparse solo vocal over a
 * dense mix gives chroma little to lock onto and the path wanders, smearing
 * notes onto the wrong lyrics. Perfect was extracted that way and its path ran
 * to -11.6s; switching to a fixed offset took lyric alignment 73% -> 79%.
 *
 * Decide with measure-offset.mjs <original> <vocals>: a near-zero IQR means a
 * clean stem, so pass its median as `vocalSec`. A wide IQR means a real edit,
 * so leave `vocalSec` null and let DTW do its job (viva-la-vida's stem is
 * missing ~49s and steps through four plateaus).
 *
 *   node rebuild-melodies.mjs <originals-dir> <vocals-dir> [songId]
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SONGS = path.resolve(HERE, "../public/songs");

/**
 * offsetSec: original time -> karaoke time, from measure-offset.mjs. Must match
 *            build-song-packs.mjs for the same id.
 * vocalSec:  original time -> vocal-stem time. null = the stem is edited, use DTW.
 */
const JOBS = [
  {
    id: "viva-la-vida", offsetSec: -4.95, vocalSec: null,
    original: "Coldplay - Viva La Vida (Official Video).mp3",
    vocals: "Coldplay - Viva La Vida Vocals Only.mp3",
  },
  {
    id: "creep", offsetSec: 3.9, vocalSec: 0.37,
    original: "Radiohead - Creep.mp3",
    vocals: "Radiohead - Creep (Vocals Only).mp3",
  },
  {
    id: "perfect", offsetSec: 3.88, vocalSec: 0,
    original: "Ed Sheeran - Perfect.mp3",
    vocals: "Ed Sheeran - Perfect (Studio Acapella).mp3",
  },
  {
    id: "im-not-the-only-one", offsetSec: -4.62, vocalSec: 0.09,
    original: "Sam Smith - I'm Not The Only One (Lyric Video).mp3",
    vocals: "Sam Smith - I'm Not The Only One (AcapellaVocals Only).mp3",
  },
  {
    id: "from-the-start", offsetSec: -0.74, vocalSec: -4.64,
    original: "@laufey - From The Start (Lyrics).mp3",
    vocals: "From The Start - Vocals Only (Acapella)  Laufey.mp3",
  },
  {
    id: "beauty-and-a-beat", offsetSec: 0.19, vocalSec: -0.09,
    original: "Justin Bieber, Nicki Minaj  Beauty And A Beat (Lyrics).mp3",
    vocals: "Justin Bieber, Nicki Minaj - Beauty And A Beat (Official Studio Acapella - Vocals Only).mp3",
  },
  {
    // Stem is ~10s shorter than the original with a 6.5s IQR: genuinely edited,
    // so DTW rather than a fixed offset.
    id: "cupid", offsetSec: 2.97, vocalSec: null,
    original: "FIFTY FIFTY - Cupid (Twin Version) (Lyrics).mp3",
    vocals: "Cupid (Twin Ver.) - Vocals Only (Acapella)  FIFTY FIFTY.mp3",
  },
];

const [ORIG_DIR, VOX_DIR, ONLY] = process.argv.slice(2);
if (!ORIG_DIR || !VOX_DIR) {
  throw new Error("usage: rebuild-melodies.mjs <originals-dir> <vocals-dir> [songId]");
}

for (const job of JOBS) {
  if (ONLY && job.id !== ONLY) continue;
  const packDir = path.join(SONGS, job.id);
  const args = [
    path.join(HERE, "extract-melody-stem.mjs"),
    path.join(ORIG_DIR, job.original),
    path.join(VOX_DIR, job.vocals),
    packDir,
    String(job.offsetSec),
  ];
  if (job.vocalSec != null) args.push(String(job.vocalSec));
  execFileSync("node", args, { stdio: "inherit" });
  execFileSync("node", [path.join(HERE, "smooth-melody.mjs"), packDir], { stdio: "inherit" });
}
