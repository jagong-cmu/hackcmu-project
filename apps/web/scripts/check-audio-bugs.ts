/**
 * Red-capable checks for the live-room audio bugs:
 * 1. "We couldn't hear you" after a real take
 * 2. Opponent mic never making it to the speakers (covered in livekit options via comments + a CSS/class contract)
 *
 * Run: node --experimental-strip-types apps/web/scripts/check-audio-bugs.ts
 */
import { isMusicOnly } from "../src/scoring/cancelPlayback.ts";
import { scoreContour, type PitchFrame } from "../src/scoring/scoreClip.ts";
import type { MelodyFile } from "../../../packages/shared/src/index.ts";

function tone(n: number, amp: number): Float32Array {
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) buf[i] = amp * Math.sin((i / n) * Math.PI * 2 * 18);
  return buf;
}

let failed = 0;
function assert(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    console.log("ok ", name);
    return;
  }
  failed += 1;
  console.error("FAIL", name, detail);
}

// A singer is still on the mic, but speaker-cancel wiped the residual.
// Calling that "music only" is how a real take becomes "We couldn't hear you."
{
  const mic = tone(4096, 0.08);
  const eaten = tone(4096, 0.001);
  const music = tone(4096, 0.06);
  assert(
    "canceller-ate-voice is not music-only",
    isMusicOnly(mic, eaten, music) === false,
    "isMusicOnly treated a live mic as the bed",
  );
}

// Headphones / LiveKit AEC: no playback tap. Voiced mic must never be dropped.
{
  const mic = tone(4096, 0.05);
  const silentRef = new Float32Array(4096);
  assert(
    "voiced mic without a tap is not music-only",
    isMusicOnly(mic, mic, silentRef) === false,
  );
}

{
  const quiet = tone(4096, 0.001);
  const silentRef = new Float32Array(4096);
  assert("actually quiet mic is music-only / silence", isMusicOnly(quiet, quiet, silentRef) === true);
}

// A short but real take (~5% of voiced melody frames) used to trip the 12% coverage
// gate and print "We couldn't hear you."
{
  const hz = Array.from({ length: 500 }, (_, i) => (i % 4 === 0 ? null : 220));
  const melody: MelodyFile = { sampleRateHz: 50, startSec: 0, hz };
  const frames: PitchFrame[] = [];
  let voicedHits = 0;
  for (let i = 0; i < hz.length; i++) {
    const t = i / 50;
    const hit = hz[i] != null && voicedHits < 30 && i % 12 === 1;
    if (hit) voicedHits += 1;
    frames.push({ timeSec: t, hz: hit ? 220 : null, clarity: hit ? 0.8 : 0.1 });
  }
  const card = scoreContour(frames, melody, { startSec: 0, durationSec: 10 });
  assert(
    "sparse but real singing is not silence",
    card.silence === false && card.overall > 0,
    JSON.stringify({ ...card, voicedHits }),
  );
}

{
  const melody: MelodyFile = { sampleRateHz: 50, startSec: 0, hz: Array(200).fill(220) };
  const mute = scoreContour([], melody, { startSec: 0, durationSec: 4 });
  assert("empty frames stay silence", mute.silence === true && mute.overall === 0);
}

if (failed) {
  console.error(`${failed} audio bug check(s) failed`);
  process.exit(1);
}
console.log("audio bug checks ok");
