/**
 * PITCH LOCK follows the last moment of singing, on the score's own rules.
 *
 * Run: npx tsx --test apps/web/src/scoring/pitchLock.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { MelodyFile } from "@karaoke/shared";
import { LockWindowSec, PitchLock } from "./pitchLock.ts";

const A4 = 440;
const rate = 100;
/** 0–10s: A4 held, except a rest from 4s to 6s. */
const melody: MelodyFile = {
  sampleRateHz: rate,
  startSec: 0,
  hz: Array.from({ length: 10 * rate }, (_, i) => (i >= 4 * rate && i < 6 * rate ? null : A4)),
};
const cents = (hz: number, c: number) => hz * 2 ** (c / 1200);

function sing(lock: PitchLock, from: number, to: number, hz: (t: number) => number | null, clarity = 0.9) {
  let v: number | null = null;
  for (let t = from; t < to; t += 1 / 60) v = lock.push(melody, t, hz(t), clarity);
  return v;
}

test("on the note reads high, a semitone off reads low", () => {
  const on = new PitchLock();
  assert.ok((sing(on, 0, 2, () => A4) ?? 0) >= 95);
  const off = new PitchLock();
  assert.ok((sing(off, 0, 2, () => cents(A4, 100)) ?? 100) <= 50);
});

test("an octave off is still locked, like the score", () => {
  const lock = new PitchLock();
  assert.ok((sing(lock, 0, 2, () => A4 / 2) ?? 0) >= 95);
});

test("it is a rolling window: a rough start does not hold it down", () => {
  const lock = new PitchLock();
  sing(lock, 0, 2, () => cents(A4, 150));
  const v = sing(lock, 2, 2 + LockWindowSec + 0.1, () => A4);
  assert.ok((v ?? 0) >= 95, `got ${v}`);
});

test("holds through a rest instead of falling to zero", () => {
  const lock = new PitchLock();
  const before = sing(lock, 2, 4, () => A4);
  const during = sing(lock, 4, 6, () => null);
  assert.equal(during, before);
});

test("silence on a running note lets the lock go", () => {
  const lock = new PitchLock();
  sing(lock, 0, 2, () => A4);
  assert.equal(sing(lock, 2, 4, () => null), 0);
});

test("unclear frames do not count, by the score's clarity gate", () => {
  const lock = new PitchLock();
  assert.equal(sing(lock, 0, 1, () => A4, 0.3), 0);
});

test("a seek back starts a fresh window", () => {
  const lock = new PitchLock();
  sing(lock, 6, 8, () => A4);
  lock.push(melody, 0.5, null, 0);
  assert.equal(lock.current, null);
});
