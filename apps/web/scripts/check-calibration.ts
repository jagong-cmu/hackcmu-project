import { readFileSync } from "node:fs";
import { centsToPitch } from "../src/scoring/cents.ts";
import { scoreContour, type PitchFrame } from "../src/scoring/scoreClip.ts";
import type { MelodyFile } from "../../../packages/shared/src/index.ts";

const melody = JSON.parse(
  readFileSync(new URL("../public/songs/viva-la-vida/melody.json", import.meta.url), "utf8"),
) as MelodyFile;

function framesFromMelody(centsOff: number, jitter = 0, octave = 1): PitchFrame[] {
  const ratio = 2 ** (centsOff / 1200);
  const out: PitchFrame[] = [];
  for (let i = 0; i < melody.sampleRateHz * 15; i++) {
    const t = melody.startSec + i / melody.sampleRateHz;
    const hz = melody.hz[i];
    if (hz == null) {
      out.push({ timeSec: t, hz: null, clarity: 0.2 });
      continue;
    }
    const wobble = 1 + jitter * Math.sin(i / 3);
    out.push({ timeSec: t, hz: hz * ratio * wobble * octave, clarity: 0.88 });
  }
  return out;
}

const clip = { startSec: 0, durationSec: 15 };
const decent = scoreContour(framesFromMelody(28, 0.008), melody, clip);
const tight = scoreContour(framesFromMelody(8, 0.003), melody, clip);
const octave = scoreContour(framesFromMelody(20, 0.01, 0.5), melody, clip);
const mute = scoreContour([], melody, clip);

console.log({
  centsCurve: { 0: centsToPitch(0), 25: centsToPitch(25), 40: centsToPitch(40) },
  decent,
  tight,
  octaveDown: octave,
  silence: mute,
});

if (decent.overall < 70 || decent.overall > 85) {
  console.error("decent take should land 70-85, got", decent.overall);
  process.exit(1);
}
if (mute.silence !== true || mute.overall !== 0) {
  console.error("silence failed");
  process.exit(1);
}
if (octave.overall < 70) {
  console.error("octave wrap too harsh", octave);
  process.exit(1);
}
console.log("calibration ok");
