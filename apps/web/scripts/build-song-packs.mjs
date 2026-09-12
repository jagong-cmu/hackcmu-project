#!/usr/bin/env node
/**
 * Builds song packs from karaoke instrumentals staged outside the repo.
 * Audio is copied as-is; melody.json + lyrics.lrc are authored here on each
 * track's measured tempo grid.
 *
 * Melodies are FIRST-PASS: the source instrumentals have the lead vocal
 * stripped, so the contour cannot be extracted from the audio. Verify each in
 * Training mode and nudge clipStartSec / startBeat until the PitchMeter lines
 * up with the backing track.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SONGS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public/songs");
const SRC = process.argv[2];
if (!SRC) throw new Error("usage: build-song-packs.mjs <dir-with-staged-mp3s>");

const MELODY_SR = 50;
const TAIL_SEC = 70; // melody must cover clipStart + chaosDurationSec(60) + slack

/** phrase: [lyric, [[midi|null, beats], ...]] */
const PACKS = [
  {
    id: "viva-la-vida", title: "Viva La Vida", artist: "Coldplay",
    bpm: 137.0, clipStartSec: 26,
    phrases: [
      ["I used to rule the world", [[68,1],[68,1],[67,1],[65,1],[63,2],[null,2]]],
      ["Seas would rise when I gave the word", [[65,1],[65,1],[67,1],[68,1],[67,1],[65,1],[63,2],[null,2]]],
      ["Now in the morning I sleep alone", [[63,1],[65,1],[67,1],[68,1],[70,1],[68,1],[67,2],[null,2]]],
      ["Sweep the streets I used to own", [[67,1],[67,1],[65,1],[63,1],[62,1],[63,2],[null,3]]],
      ["I hear Jerusalem bells a-ringing", [[68,1],[68,1],[70,1],[72,1],[70,1],[68,1],[67,2],[null,2]]],
      ["Roman cavalry choirs are singing", [[67,1],[68,1],[70,1],[68,1],[67,1],[65,1],[63,2],[null,2]]],
      ["Be my mirror my sword and shield", [[63,1],[65,1],[67,1],[68,1],[67,1],[65,2],[null,3]]],
      ["Missionaries in a foreign field", [[65,1],[67,1],[68,1],[70,1],[68,1],[67,2],[null,3]]],
    ],
  },
  {
    id: "creep", title: "Creep", artist: "Radiohead",
    bpm: 91.5, clipStartSec: 9,
    phrases: [
      ["When you were here before", [[59,1],[59,1],[59,1],[62,1],[59,1],[57,2],[null,2]]],
      ["Couldn't look you in the eye", [[59,1],[59,1],[62,1],[64,1],[62,1],[59,2],[null,2]]],
      ["You're just like an angel", [[64,1],[64,1],[62,1],[59,1],[57,2],[null,3]]],
      ["Your skin makes me cry", [[59,1],[59,1],[57,1],[55,1],[54,2],[null,3]]],
      ["But I'm a creep", [[67,2],[66,1],[64,1],[62,2],[null,2]]],
      ["I'm a weirdo", [[64,1],[64,1],[62,1],[59,2],[null,3]]],
      ["What the hell am I doing here", [[59,1],[62,1],[64,1],[62,1],[59,1],[57,2],[null,2]]],
      ["I don't belong here", [[57,1],[59,1],[57,1],[55,2],[null,4]]],
    ],
  },
  {
    id: "california-gurls", title: "California Gurls", artist: "Katy Perry",
    bpm: 124.0, clipStartSec: 13,
    phrases: [
      ["I know a place", [[65,1],[65,1],[67,1],[69,1],[null,2]]],
      ["Where the grass is really greener", [[69,1],[69,1],[67,1],[69,1],[70,1],[69,1],[67,2],[null,2]]],
      ["Warm wet and wild", [[72,1],[72,1],[70,1],[69,2],[null,3]]],
      ["There must be something in the water", [[69,1],[69,1],[70,1],[72,1],[70,1],[69,1],[67,2],[null,2]]],
      ["California gurls", [[77,1],[76,1],[74,1],[72,2],[null,3]]],
      ["We're unforgettable", [[72,1],[74,1],[76,1],[74,1],[72,2],[null,2]]],
      ["Daisy dukes bikinis on top", [[72,1],[72,1],[70,1],[69,1],[70,1],[72,2],[null,2]]],
      ["Sun-kissed skin so hot we'll melt your popsicle", [[69,1],[70,1],[72,1],[74,1],[72,1],[70,1],[69,2],[null,2]]],
    ],
  },
  {
    id: "perfect", title: "Perfect", artist: "Ed Sheeran",
    bpm: 125.5, clipStartSec: 13,
    phrases: [
      ["I found a love for me", [[63,1],[63,1],[65,1],[67,1],[65,1],[63,2],[null,2]]],
      ["Darling just dive right in", [[63,1],[65,1],[67,1],[68,1],[67,1],[65,2],[null,2]]],
      ["And follow my lead", [[65,1],[67,1],[65,1],[63,2],[null,3]]],
      ["Well I found a girl beautiful and sweet", [[63,1],[63,1],[65,1],[67,1],[68,1],[67,1],[65,1],[63,2],[null,2]]],
      ["Baby I'm dancing in the dark", [[68,1],[68,1],[70,1],[72,1],[70,1],[68,2],[null,2]]],
      ["With you between my arms", [[68,1],[70,1],[68,1],[67,1],[65,2],[null,3]]],
      ["Barefoot on the grass", [[67,1],[68,1],[70,1],[68,2],[null,3]]],
      ["Listening to our favourite song", [[68,1],[70,1],[72,1],[70,1],[68,1],[67,2],[null,2]]],
    ],
  },
  {
    id: "animals", title: "Animals", artist: "Maroon 5",
    bpm: 124.8, clipStartSec: 10,
    phrases: [
      ["Baby I'm preying on you tonight", [[57,1],[57,1],[60,1],[62,1],[60,1],[57,2],[null,2]]],
      ["Hunt you down eat you alive", [[62,1],[62,1],[64,1],[62,1],[60,2],[null,3]]],
      ["Just like animals", [[64,1],[64,1],[62,1],[60,2],[null,3]]],
      ["Maybe you think that you can hide", [[60,1],[62,1],[64,1],[65,1],[64,1],[62,2],[null,2]]],
      ["I can smell your scent from miles", [[64,1],[64,1],[65,1],[67,1],[65,1],[64,2],[null,2]]],
      ["Just like animals", [[67,1],[67,1],[65,1],[64,2],[null,3]]],
      ["Baby I'm", [[62,1],[64,1],[65,2],[null,4]]],
      ["So what you trying to do to me", [[65,1],[64,1],[62,1],[60,1],[62,1],[64,2],[null,2]]],
    ],
  },
];

const midiToHz = (m) => +(440 * 2 ** ((m - 69) / 12)).toFixed(2);
const pad = (n, w = 2) => String(n).padStart(w, "0");
function lrcStamp(sec) {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `[${pad(m)}:${pad(s.toFixed(2), 5)}]`;
}

for (const p of PACKS) {
  const dir = path.join(SONGS_DIR, p.id);
  fs.mkdirSync(dir, { recursive: true });

  const src = path.join(SRC, `${p.id}.mp3`);
  if (!fs.existsSync(src)) throw new Error(`missing staged audio: ${src}`);
  fs.copyFileSync(src, path.join(dir, "instrumental.mp3"));

  const secPerBeat = 60 / p.bpm;
  const totalSec = p.clipStartSec + TAIL_SEC;
  const hz = new Array(Math.round(totalSec * MELODY_SR)).fill(null);
  const lrc = [];

  let t = p.clipStartSec;
  // loop phrases until melody window is covered
  let guard = 0;
  while (t < totalSec - 2 && guard++ < 200) {
    for (const [text, notes] of p.phrases) {
      if (t >= totalSec - 2) break;
      lrc.push(`${lrcStamp(t)}${text}`);
      for (const [midi, beats] of notes) {
        const dur = beats * secPerBeat;
        if (midi != null) {
          const from = Math.round(t * MELODY_SR);
          const to = Math.round((t + dur) * MELODY_SR);
          const v = midiToHz(midi);
          for (let i = from; i < to && i < hz.length; i++) hz[i] = v;
        }
        t += dur;
      }
    }
  }

  fs.writeFileSync(
    path.join(dir, "melody.json"),
    JSON.stringify({ sampleRateHz: MELODY_SR, startSec: 0, hz }),
  );
  fs.writeFileSync(path.join(dir, "lyrics.lrc"), lrc.join("\n") + "\n");
  fs.writeFileSync(
    path.join(dir, "meta.json"),
    JSON.stringify(
      {
        id: p.id, title: p.title, artist: p.artist,
        clipStartSec: p.clipStartSec, clipDurationSec: 15,
        duetClipStartSec: p.clipStartSec, duetClipDurationSec: 45,
        chaosDurationSec: 60,
      },
      null, 2,
    ) + "\n",
  );

  const voiced = hz.filter((v) => v != null).length;
  console.log(
    `${p.id.padEnd(18)} ${p.bpm.toFixed(1).padStart(6)}bpm  clipStart ${String(p.clipStartSec).padStart(3)}s  ` +
    `melody ${(hz.length / MELODY_SR).toFixed(0)}s (${((voiced / hz.length) * 100).toFixed(0)}% voiced)  ${lrc.length} lyric lines`,
  );
}
