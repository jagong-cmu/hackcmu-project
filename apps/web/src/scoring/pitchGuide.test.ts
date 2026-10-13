/**
 * Run: npx tsx --test apps/web/src/scoring/pitchGuide.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createPitchSmoothState, rejectFrame, smoothLivePitch } from "./pitchGuide.ts";

const FRAME_MS = 1000 / 60;

/** Feed `hz` for `frames` frames at 60fps; returns the last result. */
function sing(
  state: ReturnType<typeof createPitchSmoothState>,
  hz: number,
  frames: number,
  opts: { rms?: number; clarity?: number } = {},
) {
  const start = state.lastPitchedMs + FRAME_MS;
  let out: ReturnType<typeof smoothLivePitch> | null = null;
  for (let i = 0; i < frames; i++) {
    out = smoothLivePitch(state, {
      hz,
      clarity: opts.clarity ?? 0.97,
      rms: opts.rms ?? 0.05,
      targetMidi: 69,
      playheadSec: i / 60,
      nowMs: start + i * FRAME_MS,
    });
  }
  return out!;
}

test("loudness does not move the pitch", () => {
  const quiet = sing(createPitchSmoothState(), 220, 20, { rms: 0.011 });
  const loud = sing(createPitchSmoothState(), 220, 20, { rms: 0.6 });
  assert.equal(quiet.midi?.toFixed(3), "57.000");
  assert.equal(loud.midi, quiet.midi);
});

test("extremes are not folded toward the tune", () => {
  // C2 and C6 against an A4 target: shown where sung, not an octave nearer.
  assert.ok(Math.abs(sing(createPitchSmoothState(), 65.41, 20).midi! - 36) < 0.01);
  assert.ok(Math.abs(sing(createPitchSmoothState(), 1046.5, 20).midi! - 84) < 0.01);
});

test("below the gate the indicator hides instead of sticking", () => {
  const s = createPitchSmoothState();
  sing(s, 220, 20);
  assert.equal(sing(s, 220, 12, { rms: 0.002 }).midi, null);
  const s2 = createPitchSmoothState();
  sing(s2, 220, 20);
  assert.equal(sing(s2, 220, 12, { clarity: 0.6 }).midi, null);
});

test("hum and sub-C2 readings never reach the display", () => {
  // 60 Hz mains hum reads as a clean, loud 60 Hz pitch; it used to pin the floor.
  assert.equal(sing(createPitchSmoothState(), 60, 20, { rms: 0.05 }).midi, null);
  assert.equal(rejectFrame(60, 0.99, 0.05), "range");
  assert.equal(rejectFrame(NaN, 0.99, 0.05), "no pitch");
  assert.equal(rejectFrame(0, 0, 0.05), "no pitch");
});

test("low notes get the low clarity bar and the low RMS gate", () => {
  // E2 through a laptop mic: clarity ~0.85, rms ~0.006.
  const e2 = sing(createPitchSmoothState(), 82.41, 20, { clarity: 0.85, rms: 0.006 });
  assert.ok(Math.abs(e2.midi! - 40) < 0.01);
  assert.equal(rejectFrame(220, 0.85, 0.05), "clarity");
});

test("rejected frames hold briefly, then hide; never fall to the floor", () => {
  const s = createPitchSmoothState();
  sing(s, 98, 20);
  // ~133ms of rejects: still holding the last pitch.
  assert.equal(sing(s, 98, 8, { clarity: 0.1 }).midi?.toFixed(2), "43.00");
  const s2 = createPitchSmoothState();
  sing(s2, 98, 20);
  // ~200ms of rejects: hidden, not 36.
  assert.equal(sing(s2, 98, 12, { clarity: 0.1 }).midi, null);
});

test("a one-frame octave slip is ignored, a held leap lands", () => {
  const s = createPitchSmoothState();
  sing(s, 220, 20);
  assert.equal(sing(s, 440, 1).midi?.toFixed(2), "57.00");
  assert.equal(sing(s, 220, 1).midi?.toFixed(2), "57.00");
  assert.equal(sing(s, 440, 3).midi?.toFixed(2), "69.00");
});
