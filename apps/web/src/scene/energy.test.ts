/**
 * Chaos has no score, so the room follows how busy the song is: the share of
 * the melody that is sounding around the playhead. Read from data we already
 * have; nothing is added to the audio graph.
 *
 * Run: npx tsx --test apps/web/src/scene/energy.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { melodyEnergy } from "./energy.ts";

const SR = 50; // samples per second
const melody = (pattern: (t: number) => boolean, seconds = 20) => ({
  startSec: 10,
  sampleRateHz: SR,
  hz: Array.from({ length: seconds * SR }, (_, i) => (pattern(i / SR) ? 220 : null)),
});

test("a busy passage is higher than a sparse one", () => {
  const m = melody((t) => t < 10); // sounding for the first 10s, then silence
  assert.ok(melodyEnergy(m, 10 + 5) > melodyEnergy(m, 10 + 15));
});

test("always within 0.35..1 so the room never goes dark just because the singer rests", () => {
  const silent = melody(() => false);
  const full = melody(() => true);
  assert.ok(melodyEnergy(silent, 15) >= 0.35);
  assert.ok(melodyEnergy(full, 15) <= 1);
  assert.ok(melodyEnergy(full, 15) > melodyEnergy(silent, 15));
});

test("playheads outside the melody, and bad input, are safe", () => {
  const m = melody(() => true);
  for (const t of [-5, 0, 9, 40, 1e9, Number.NaN]) {
    const e = melodyEnergy(m, t);
    assert.ok(Number.isFinite(e) && e >= 0.35 && e <= 1, `${t} -> ${e}`);
  }
  assert.ok(melodyEnergy({ startSec: 0, sampleRateHz: SR, hz: [] }, 3) >= 0.35);
});
