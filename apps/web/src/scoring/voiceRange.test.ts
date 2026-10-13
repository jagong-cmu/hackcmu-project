/**
 * Voice range profile: estimator, profile sanity checks, and how the live
 * visualizer uses the profile (range-guided octave correction). Also pins
 * that no profile → smoothLivePitch behaves exactly as the plain default.
 *
 * Run: npx tsx --test apps/web/src/scoring/voiceRange.test.ts
 */
/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  VoiceTuning,
  buildVoiceProfile,
  estimateHeldPitch,
  fixOctaveByRange,
  formatVoiceProfile,
  parseVoiceProfile,
  type VoiceFrame,
  type VoiceProfile,
} from "./voiceRange.ts";
import { createPitchSmoothState, smoothLivePitch, type PitchSmoothState } from "./pitchGuide.ts";

const hzOf = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** Deterministic wobble so tests don't depend on Math.random. */
function held(midi: number, n: number, wobble = 0.15): VoiceFrame[] {
  return Array.from({ length: n }, (_, i) => ({
    midi: midi + wobble * Math.sin(i * 1.7),
    confidence: 0.9,
    rms: 0.05,
  }));
}

// ---------------------------------------------------------------- estimator

test("estimator: clean hum → median of the frames", () => {
  const r = estimateHeldPitch(held(45, 80));
  assert.ok(r.ok);
  assert.ok(Math.abs(r.midi - 45) < 0.1, `got ${r.midi}`);
});

test("estimator: ignores quiet / unconfident / unvoiced frames", () => {
  const frames = [
    ...held(50, 40),
    ...Array.from({ length: 30 }, () => ({ midi: 70, confidence: 0.2, rms: 0.05 })),
    ...Array.from({ length: 30 }, () => ({ midi: 30 + 40, confidence: 0.9, rms: 0.001 })),
    ...Array.from({ length: 30 }, () => ({ midi: null, confidence: 0, rms: 0 })),
  ];
  const r = estimateHeldPitch(frames);
  assert.ok(r.ok);
  assert.ok(Math.abs(r.midi - 50) < 0.1);
  assert.equal(r.used, 40);
});

test("estimator: rejects octave glitches even when they are a large minority", () => {
  // 40% of frames locked an octave up (2nd harmonic) and some an octave down.
  const frames = [...held(48, 50), ...held(60, 30), ...held(36, 6)];
  const r = estimateHeldPitch(frames);
  assert.ok(r.ok);
  assert.ok(Math.abs(r.midi - 48) < 0.1, `got ${r.midi}`);
  assert.equal(r.used, 50);
});

test("estimator: rejects non-octave outliers (scoops, clicks)", () => {
  const frames = [...held(55, 60), { midi: 62, confidence: 0.9, rms: 0.05 }, { midi: 51, confidence: 0.9, rms: 0.05 }];
  const r = estimateHeldPitch(frames);
  assert.ok(r.ok);
  assert.equal(r.used, 60);
  assert.ok(Math.abs(r.midi - 55) < 0.1);
});

test("estimator: too few confident frames → too-few", () => {
  const r = estimateHeldPitch(held(50, VoiceTuning.minFrames - 1));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "too-few");
});

test("estimator: a glide / wandering pitch → unstable", () => {
  const frames = Array.from({ length: 60 }, (_, i) => ({ midi: 45 + i * 0.25, confidence: 0.9, rms: 0.05 }));
  const r = estimateHeldPitch(frames);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "unstable");
});

// ---------------------------------------------------------------- profile

test("profile: valid range builds and formats as note names", () => {
  const r = buildVoiceProfile(45, 64, 48, 123);
  assert.ok(r.ok);
  assert.deepEqual(r.profile, { lowMidi: 45, highMidi: 64, centerMidi: 48, measuredAt: 123 });
  assert.equal(formatVoiceProfile(r.profile), "A2–E4, centre C3");
});

test("profile: low above high → redo both", () => {
  const r = buildVoiceProfile(60, 50, 55, 0);
  assert.equal(r.ok, false);
  if (!r.ok) assert.deepEqual(r.redo, ["low", "high"]);
});

test("profile: range under minRangeSt → redo both", () => {
  const r = buildVoiceProfile(50, 50 + VoiceTuning.minRangeSt - 0.5, 52, 0);
  assert.equal(r.ok, false);
  if (!r.ok) assert.deepEqual(r.redo, ["low", "high"]);
  assert.ok(buildVoiceProfile(50, 50 + VoiceTuning.minRangeSt, 52, 0).ok);
});

test("profile: centre far outside range → redo centre", () => {
  const r = buildVoiceProfile(45, 60, 70, 0);
  assert.equal(r.ok, false);
  if (!r.ok) assert.deepEqual(r.redo, ["center"]);
});

test("profile: parse rejects junk, accepts a stored profile", () => {
  assert.equal(parseVoiceProfile(null), null);
  assert.equal(parseVoiceProfile({ lowMidi: "a" }), null);
  assert.equal(parseVoiceProfile({ lowMidi: 60, highMidi: 50, centerMidi: 55, measuredAt: 1 }), null);
  assert.deepEqual(parseVoiceProfile({ lowMidi: 45, highMidi: 64, centerMidi: 48, measuredAt: 1, x: 1 }), {
    lowMidi: 45,
    highMidi: 64,
    centerMidi: 48,
    measuredAt: 1,
  });
});

// ---------------------------------------------------------------- visualizer helpers

const bass: VoiceProfile = { lowMidi: 40, highMidi: 57, centerMidi: 48, measuredAt: 0 };

test("fixOctaveByRange: readings inside range ± margin are untouched", () => {
  for (const raw of [35, 40, 48, 57, 62]) assert.equal(fixOctaveByRange(raw, bass), raw);
});

test("fixOctaveByRange: an octave-high glitch is pulled back in", () => {
  // 69 is 12 above the bass's top note: 2nd-harmonic lock.
  assert.equal(fixOctaveByRange(69, bass), 57);
  assert.equal(fixOctaveByRange(63.5, bass), 51.5);
});

test("fixOctaveByRange: an octave-low glitch is pushed back up", () => {
  const tenor: VoiceProfile = { lowMidi: 50, highMidi: 67, centerMidi: 57, measuredAt: 0 };
  assert.equal(fixOctaveByRange(40, tenor), 52);
});

test("fixOctaveByRange: leaves readings that one octave cannot rescue", () => {
  assert.equal(fixOctaveByRange(90, bass), 90);
  assert.equal(fixOctaveByRange(20, bass), 20);
});

// ---------------------------------------------------------------- smoothLivePitch

type Frame = { midi: number | null; target: number | null };

function run(state: PitchSmoothState, frames: Frame[]) {
  return frames.map((f, i) =>
    smoothLivePitch(state, {
      hz: f.midi == null ? null : hzOf(f.midi),
      clarity: 0.9,
      rms: 0.05,
      targetMidi: f.target,
      playheadSec: i / 60,
      nowMs: 1000 + i * (1000 / 60),
    }),
  );
}

test("no profile: state and output identical to the plain default", () => {
  const a = createPitchSmoothState();
  const b = createPitchSmoothState({});
  const c = createPitchSmoothState({ profile: null });
  for (const st of [a, b, c]) assert.equal(st.voiceRange, null);

  // A melody-agnostic trace with octave jumps, glitches and silence.
  const trace: Frame[] = [];
  for (let i = 0; i < 200; i++) {
    const target = i < 100 ? 60 : 64;
    let midi: number | null = 47.6 + Math.sin(i / 9);
    if (i % 37 === 0) midi = midi + 12;
    if (i >= 140 && i < 150) midi = null;
    if (i >= 170) midi = 71.2;
    trace.push({ midi, target });
  }
  const outA = run(a, trace);
  assert.deepEqual(run(b, trace), outA);
  assert.deepEqual(run(c, trace), outA);
});

test("no fold: a bass an octave under the tune is drawn where sung, and still in tune", () => {
  const trace: Frame[] = Array.from({ length: 30 }, () => ({ midi: 48, target: 60 }));
  const out = run(createPitchSmoothState({ profile: bass }), trace);
  for (const [i, f] of out.entries()) {
    assert.ok(f.midi != null && Math.abs(f.midi - 48) < 0.01, `frame ${i} = ${f.midi}`);
    assert.ok(f.inTune, `frame ${i} should count as in tune (octave-independent)`);
  }
});

test("range-guided correction: a 2nd-harmonic glitch doesn't throw the line an octave", () => {
  // Bass sings 52. The detector then locks onto the 2nd harmonic (64) for 6
  // frames -- long enough for the jump filter to accept it as a real leap.
  // 64 is above the bass's range + margin (57+5), so the range guard maps it
  // back to 52 before the jump filter ever sees it.
  const trace: Frame[] = [
    ...Array.from({ length: 30 }, () => ({ midi: 52, target: 64 })),
    ...Array.from({ length: 6 }, () => ({ midi: 64, target: 64 })),
    ...Array.from({ length: 10 }, () => ({ midi: 52, target: 64 })),
  ];
  const plain = run(createPitchSmoothState(), trace).slice(30);
  const guided = run(createPitchSmoothState({ profile: bass }), trace).slice(30);
  const peak = (xs: { midi: number | null }[]) => Math.max(...xs.map((x) => x.midi ?? -Infinity));
  assert.ok(peak(guided) < 52.6, `guided peak ${peak(guided)}`);
  assert.ok(peak(plain) > 63, `plain peak ${peak(plain)}`);
  for (const f of guided) assert.ok(f.rawMidi != null && Math.abs(f.rawMidi - 52) < 0.01);
});
