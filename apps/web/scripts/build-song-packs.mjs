#!/usr/bin/env node
/**
 * Builds song packs from karaoke instrumentals staged outside the repo.
 *
 * Lyrics come from LRCLIB (free, no key) as synced LRC for the ORIGINAL
 * recording. Our audio is a karaoke cover with a longer count-in, so each song
 * carries an offsetSec that shifts every line onto our track. Tap the first
 * line in /sync to measure it: offsetSec = tapped - first LRCLIB timestamp.
 *
 * melody.json is derived from those same line times: one authored phrase per
 * lyric line, stretched to fill the gap to the next line. The note choices are
 * approximate; the TIMING follows the real structure.
 *
 * Usage: build-song-packs.mjs <dir-with-staged-mp3s> <dir-with-lrclib-json>
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SONGS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public/songs");
const [SRC, LRC_DIR, ONLY] = process.argv.slice(2);
if (!SRC || !LRC_DIR) throw new Error("usage: build-song-packs.mjs <mp3-dir> <lrclib-json-dir> [songId]");

const MELODY_SR = 50;
// Ranked/duet clips open slightly before the first lyric so GO does not land on
// the downbeat the singer is meant to hit.
const CLIP_LEAD_SEC = 5;

/**
 * offsetSec: maps ORIGINAL time onto our karaoke track, measured by chroma/DTW
 *   between the two recordings. This is a property of the audio and is what
 *   melody extraction uses.
 * lyricLeadSec: correction applied to lyrics ONLY -- folding it into offsetSec
 *   would drag the melody off the audio with it.
 *
 *   Set by ear, per song. Only viva-la-vida wants one (+0.90); the other
 *   three sit right untouched. So this is a per-song property of how each
 *   karaoke cover phrases its entry against the original the LRC was timed
 *   to -- not playback latency, which would affect all four equally.
 *
 *   An earlier attempt measured voiced onsets in the isolated vocals and moved
 *   lyrics EARLIER by 0.25-0.36s. That was worse: an onset detector fires on
 *   breath and consonants, while a singer cues from the pitched note after
 *   them. Ears beat that measurement; do not re-derive it.
 * phrases: authored note shapes, cycled across lyric lines. midi or null, with
 *   relative weights; each phrase is stretched to the real line duration.
 */
const PACKS = [
  {
    // offsetSec values below are measured by chroma/DTW against each studio
    // original (scripts note in README); the figure is the median of inlier
    // per-line drifts, outliers being sparse intros and outros.
    id: "viva-la-vida", title: "Viva La Vida", artist: "Coldplay", offsetSec: -4.95, lyricLeadSec: 0.9,
    phrases: [
      [68, 68, 67, 65, 63], [65, 65, 67, 68, 67, 65, 63],
      [63, 65, 67, 68, 70, 68, 67], [67, 67, 65, 63, 62, 63],
    ],
  },
  {
    id: "creep", title: "Creep", artist: "Radiohead", offsetSec: 3.9, lyricLeadSec: 0,
    phrases: [
      [59, 59, 59, 62, 59, 57], [59, 59, 62, 64, 62, 59],
      [64, 64, 62, 59, 57], [67, 66, 64, 62],
    ],
  },
  {
    id: "perfect", title: "Perfect", artist: "Ed Sheeran", offsetSec: 3.88, lyricLeadSec: 0,
    phrases: [
      [63, 63, 65, 67, 65, 63], [63, 65, 67, 68, 67, 65],
      [65, 67, 65, 63], [68, 68, 70, 72, 70, 68],
    ],
  },
  {
    id: "im-not-the-only-one", title: "I'm Not The Only One", artist: "Sam Smith", offsetSec: -4.62, lyricLeadSec: 0,
    phrases: [
      [60, 60, 62, 64, 62, 60], [64, 64, 65, 64, 62, 60],
      [65, 65, 64, 62, 60], [67, 65, 64, 62, 60],
    ],
  },
  {
    id: "from-the-start", title: "From The Start", artist: "Laufey", offsetSec: -0.74, lyricLeadSec: 0,
    phrases: [
      [64, 64, 62, 60, 62], [62, 64, 65, 67, 65, 64],
      [67, 67, 65, 64, 62, 60], [60, 62, 64, 65, 64, 62],
    ],
  },
  {
    // Karaoke is trimmed 10s, not the usual 5: this cover opens on a long
    // synth intro the original does not have.
    id: "beauty-and-a-beat", title: "Beauty And A Beat", artist: "Justin Bieber", offsetSec: 0.19, lyricLeadSec: 0,
    phrases: [
      [69, 69, 67, 64, 67], [67, 69, 71, 72, 71, 69],
      [72, 72, 71, 69, 67], [64, 67, 69, 71, 69, 67],
    ],
  },
  {
    // Staged WITHOUT the usual 5s trim -- this cover opens straight on the song,
    // so trimming cut the first "La, la, la" line. It carries 3s of prepended
    // silence instead, which is the count-in, and offsetSec is that silence.
    id: "cupid", title: "Cupid (Twin Ver.)", artist: "FIFTY FIFTY", offsetSec: 2.97, lyricLeadSec: 0,
    phrases: [
      [71, 71, 69, 67, 69], [69, 71, 72, 74, 72, 71],
      [74, 74, 72, 71, 69], [67, 69, 71, 72, 71, 69],
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

function parseSynced(src) {
  const out = [];
  for (const raw of src.split("\n")) {
    const m = raw.match(/\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\](.*)/);
    if (!m) continue;
    const text = m[4].trim();
    if (!text) continue; // LRCLIB uses bare stamps as section breaks
    const frac = m[3] ? Number(m[3].padEnd(3, "0")) / 1000 : 0;
    out.push({ t: Number(m[1]) * 60 + Number(m[2]) + frac, text });
  }
  return out.sort((a, b) => a.t - b.t);
}

for (const p of PACKS) {
  if (ONLY && p.id !== ONLY) continue;
  const dir = path.join(SONGS_DIR, p.id);
  fs.mkdirSync(dir, { recursive: true });

  const srcMp3 = path.join(SRC, `${p.id}.mp3`);
  if (!fs.existsSync(srcMp3)) throw new Error(`missing staged audio: ${srcMp3}`);
  fs.copyFileSync(srcMp3, path.join(dir, "instrumental.mp3"));

  const raw = JSON.parse(fs.readFileSync(path.join(LRC_DIR, `${p.id}.json`), "utf8"));
  const lines = parseSynced(raw.syncedLyrics || "");
  if (!lines.length) throw new Error(`no synced lyrics for ${p.id}`);

  const lead = p.lyricLeadSec ?? 0;
  const shifted = lines
    .map((l) => ({ ...l, t: +(l.t + p.offsetSec + lead).toFixed(2) }))
    .filter((l) => l.t >= 0);
  const clipStartSec = +Math.max(0, shifted[0].t - CLIP_LEAD_SEC).toFixed(1);
  const lastT = shifted[shifted.length - 1].t;
  const hz = new Array(Math.round((lastT + 8) * MELODY_SR)).fill(null);

  shifted.forEach((line, i) => {
    const next = shifted[i + 1]?.t ?? line.t + 3;
    // leave a breath at the end of each line rather than running into the next
    const span = Math.min(next - line.t, 6) * 0.85;
    if (span <= 0) return;
    const notes = p.phrases[i % p.phrases.length];
    const per = span / notes.length;
    notes.forEach((midi, k) => {
      const from = Math.round((line.t + k * per) * MELODY_SR);
      const to = Math.round((line.t + (k + 1) * per) * MELODY_SR);
      const v = midiToHz(midi);
      for (let j = from; j < to && j < hz.length; j++) hz[j] = v;
    });
  });

  // The authored phrases are a placeholder for a song that has no real melody
  // yet. Once rebuild-melodies.mjs has extracted one from the isolated vocal,
  // overwriting it here would silently throw that away -- this script gets
  // re-run whenever lyric timing is retuned.
  const melodyPath = path.join(dir, "melody.json");
  const hadMelody = fs.existsSync(melodyPath);
  if (!hadMelody) {
    fs.writeFileSync(melodyPath, JSON.stringify({ sampleRateHz: MELODY_SR, startSec: 0, hz }));
  }
  fs.writeFileSync(
    path.join(dir, "lyrics.lrc"),
    shifted.map((l) => `${lrcStamp(l.t)}${l.text}`).join("\n") + "\n",
  );
  // Clip windows are hand-set per song (first chorus line -> last chorus line
  // plus a hold), so they are kept if they already exist. The lyric-derived
  // default below is only a starting point for a brand-new song.
  const metaPath = path.join(dir, "meta.json");
  const prevMeta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, "utf8")) : null;
  fs.writeFileSync(
    metaPath,
    JSON.stringify(
      {
        id: p.id, title: p.title, artist: p.artist,
        clipStartSec: prevMeta?.clipStartSec ?? clipStartSec,
        clipDurationSec: prevMeta?.clipDurationSec ?? 15,
        duetClipStartSec: prevMeta?.duetClipStartSec ?? clipStartSec,
        duetClipDurationSec: prevMeta?.duetClipDurationSec ?? 45,
        chaosDurationSec: prevMeta?.chaosDurationSec ?? 60,
      },
      null, 2,
    ) + "\n",
  );

  const voiced = hz.filter((v) => v != null).length;
  console.log(
    `${p.id.padEnd(18)} ${String(shifted.length).padStart(3)} lines  ` +
    `first ${shifted[0].t.toFixed(2)}s  last ${lastT.toFixed(2)}s  ` +
    `offset ${p.offsetSec >= 0 ? "+" : ""}${p.offsetSec}s lead ${lead}s  clipStart ${clipStartSec}s  ` +
    `melody ${hadMelody ? "kept (extracted)" : `${(hz.length / MELODY_SR).toFixed(0)}s placeholder, ${((voiced / hz.length) * 100).toFixed(0)}% voiced`}`,
  );
}
