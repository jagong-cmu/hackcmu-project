#!/usr/bin/env node
/**
 * Original stand-in karaoke beds for the hackathon (not commercial rips).
 * Writes melody.json, lyrics.lrc, meta.json, instrumental.mp3.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SONGS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public/songs");
const AUDIO_SR = 44100;
const MELODY_SR = 50;
const DURATION = 60;

function midiToHz(m) {
  return +(440 * 2 ** ((m - 69) / 12)).toFixed(2);
}

function fillNotes(pattern, bpm) {
  const totalBeats = (DURATION * bpm) / 60;
  const out = [];
  let beats = 0;
  while (beats < totalBeats) {
    for (const n of pattern) {
      out.push(n);
      beats += n.beats;
      if (beats >= totalBeats) break;
    }
  }
  return out;
}

function notesToHz(notes, bpm) {
  const secPerBeat = 60 / bpm;
  const hz = [];
  for (const n of notes) {
    const samples = Math.max(1, Math.round(n.beats * secPerBeat * MELODY_SR));
    const val = n.midi == null ? null : midiToHz(n.midi);
    for (let i = 0; i < samples; i++) hz.push(val);
  }
  const need = DURATION * MELODY_SR;
  while (hz.length < need) hz.push(null);
  return hz.slice(0, need);
}

function writeWav(file, samples) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(AUDIO_SR, 24);
  buf.writeUInt32LE(AUDIO_SR * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(s < 0 ? s * 0x8000 : s * 0x7fff, 44 + i * 2);
  }
  fs.writeFileSync(file, buf);
}

function synth(melodyHz, bpm) {
  const n = AUDIO_SR * DURATION;
  const out = new Float32Array(n);
  const secPerBeat = 60 / bpm;
  let phaseM = 0;
  let phaseB = 0;
  let phaseP = 0;
  for (let i = 0; i < n; i++) {
    const t = i / AUDIO_SR;
    const idx = Math.min(melodyHz.length - 1, Math.round(t * MELODY_SR));
    const hz = melodyHz[idx];
    const beat = t / secPerBeat;
    const beatPos = beat % 1;
    const barPos = beat % 4;

    if (hz) {
      const omega = (2 * Math.PI * hz) / AUDIO_SR;
      phaseM += omega;
      const sq = Math.sign(Math.sin(phaseM)) * 0.16;
      const sn = Math.sin(phaseM) * 0.1;
      const bassHz = hz / 4;
      phaseB += (2 * Math.PI * bassHz) / AUDIO_SR;
      const tri = (2 / Math.PI) * Math.asin(Math.sin(phaseB)) * 0.12;
      out[i] += sq + sn + tri;
    } else {
      phaseM *= 0.99;
      phaseB *= 0.99;
    }

    phaseP += (2 * Math.PI * 196) / AUDIO_SR;
    out[i] += Math.sin(phaseP) * 0.03;

    if (beatPos < 0.06) {
      const env = Math.exp(-beatPos * 70);
      out[i] += Math.sin(2 * Math.PI * 58 * t) * 0.35 * env;
    }
    if ((barPos > 1.98 && barPos < 2.08) || (barPos > 3.98 || barPos < 0.08)) {
      const env = Math.exp(-((barPos % 2) < 0.1 ? barPos % 2 : 0) * 40);
      const noise = (Math.random() * 2 - 1) * 0.12 * Math.max(env, 0.02);
      if (barPos > 1.98 && barPos < 2.12) out[i] += noise;
    }
    if (beatPos > 0.48 && beatPos < 0.52) {
      out[i] += (Math.random() * 2 - 1) * 0.04;
    }
  }
  let peak = 0.001;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  const g = 0.92 / peak;
  for (let i = 0; i < n; i++) out[i] *= g;
  return out;
}

function lrcBlock(lines) {
  return lines
    .map(([sec, text]) => {
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      const whole = Math.floor(s);
      const cs = Math.round((s - whole) * 100)
        .toString()
        .padStart(2, "0");
      return `[${String(m).padStart(2, "0")}:${String(whole).padStart(2, "0")}.${cs}]${text}`;
    })
    .join("\n") + "\n";
}

const tracks = [
  {
    id: "viva-la-vida",
    title: "Viva La Vida",
    artist: "Coldplay",
    bpm: 138,
    pattern: [
      { midi: 63, beats: 1 },
      { midi: 63, beats: 1 },
      { midi: 65, beats: 1 },
      { midi: 67, beats: 1 },
      { midi: 68, beats: 1.5 },
      { midi: 67, beats: 0.5 },
      { midi: 65, beats: 1 },
      { midi: 63, beats: 1 },
      { midi: 60, beats: 2 },
      { midi: 58, beats: 1 },
      { midi: 60, beats: 1 },
      { midi: 63, beats: 1.5 },
      { midi: null, beats: 0.5 },
      { midi: 63, beats: 1 },
      { midi: 65, beats: 1 },
    ],
    lyrics: [
      [0, "I built a kingdom out of paper"],
      [4, "Every streetlight knew my name"],
      [8, "Now the bells keep time without me"],
      [12, "And the choir sings it anyway"],
      [16, "Gold on the walls, dust on the crown"],
      [20, "I hear the march but not the crowd"],
      [24, "If this is glory, keep the ending"],
      [28, "Let the drums say it out loud"],
      [32, "I used to call the morning mine"],
      [36, "I used to walk like I belonged"],
      [40, "The gates are open, no one waiting"],
      [44, "Still I try to hit that song"],
      [48, "Hold the note, hold the line"],
      [52, "Sing it like the room is yours"],
      [56, "One more chorus in the paper kingdom"],
    ],
  },
  {
    id: "payphone",
    title: "Payphone",
    artist: "Maroon 5",
    bpm: 110,
    pattern: [
      { midi: 59, beats: 1 },
      { midi: 64, beats: 1 },
      { midi: 66, beats: 1 },
      { midi: 68, beats: 1 },
      { midi: 66, beats: 0.5 },
      { midi: 64, beats: 0.5 },
      { midi: 61, beats: 1 },
      { midi: 59, beats: 2 },
      { midi: 56, beats: 1 },
      { midi: 59, beats: 1 },
      { midi: 64, beats: 2 },
      { midi: null, beats: 0.5 },
      { midi: 64, beats: 0.5 },
      { midi: 66, beats: 1 },
      { midi: 68, beats: 1 },
    ],
    lyrics: [
      [0, "Coin in the slot, city on the line"],
      [4, "I talk to nobody, it still feels fine"],
      [8, "Rain on the booth, neon on my shoes"],
      [12, "I hum the hook I always lose"],
      [16, "If you pick up I will keep singing"],
      [20, "If you don't I will sing it twice"],
      [24, "This is the part with the big chorus"],
      [28, "Stay on the pitch, ignore the noise"],
      [32, "Late night corners, borrowed time"],
      [36, "I spend a dollar on a rhyme"],
      [40, "Tell the static I am ready"],
      [44, "Count me in on two and four"],
      [48, "Hold that high note if you have it"],
      [52, "Drop back down and hit the door"],
      [56, "Pay the tone and take the ride"],
    ],
  },
  {
    id: "take-on-me",
    title: "Take On Me",
    artist: "a-ha",
    bpm: 169,
    pattern: [
      { midi: 69, beats: 0.5 },
      { midi: 73, beats: 0.5 },
      { midi: 76, beats: 0.5 },
      { midi: 81, beats: 0.5 },
      { midi: 76, beats: 0.5 },
      { midi: 73, beats: 0.5 },
      { midi: 69, beats: 1 },
      { midi: 64, beats: 1 },
      { midi: 66, beats: 0.5 },
      { midi: 68, beats: 0.5 },
      { midi: 69, beats: 1 },
      { midi: 73, beats: 1 },
      { midi: 76, beats: 2 },
      { midi: null, beats: 0.5 },
      { midi: 69, beats: 1.5 },
    ],
    lyrics: [
      [0, "Synth in the blood, night on the run"],
      [4, "Leap for the high one, don't look down"],
      [8, "Comic-book lightning, neon rain"],
      [12, "Take the riff and throw it around"],
      [16, "I will meet you in the chorus"],
      [20, "Where the octaves start to climb"],
      [24, "If the note is too far, jump anyway"],
      [28, "This is the fun of wasting time"],
      [32, "Keys like a staircase, kick like a heart"],
      [36, "We only get one shot at the hook"],
      [40, "Leave the safety, grab the melody"],
      [44, "Let the room hear how it shook"],
      [48, "Hold, then fall, then hold again"],
      [52, "Bright and ridiculous and true"],
      [56, "Last fifteen, give it everything"],
    ],
  },
];

fs.mkdirSync(SONGS_DIR, { recursive: true });

for (const t of tracks) {
  const dir = path.join(SONGS_DIR, t.id);
  fs.mkdirSync(dir, { recursive: true });
  const hz = notesToHz(fillNotes(t.pattern, t.bpm), t.bpm);
  const melody = { sampleRateHz: MELODY_SR, startSec: 0, hz };
  fs.writeFileSync(path.join(dir, "melody.json"), JSON.stringify(melody));
  fs.writeFileSync(
    path.join(dir, "meta.json"),
    JSON.stringify(
      {
        id: t.id,
        title: t.title,
        artist: t.artist,
        clipStartSec: 0,
        clipDurationSec: 15,
        duetClipStartSec: 0,
        duetClipDurationSec: 45,
        chaosDurationSec: 60,
      },
      null,
      2,
    ) + "\n",
  );
  fs.writeFileSync(path.join(dir, "lyrics.lrc"), lrcBlock(t.lyrics));
  const wav = path.join(dir, "instrumental.wav");
  const mp3 = path.join(dir, "instrumental.mp3");
  writeWav(wav, synth(hz, t.bpm));
  const ff = spawnSync(
    "ffmpeg",
    ["-y", "-i", wav, "-codec:a", "libmp3lame", "-b:a", "128k", mp3],
    { stdio: "inherit" },
  );
  fs.unlinkSync(wav);
  if (ff.status !== 0) throw new Error(`ffmpeg failed for ${t.id}`);
  console.log("wrote", t.id, "frames", hz.length);
}
