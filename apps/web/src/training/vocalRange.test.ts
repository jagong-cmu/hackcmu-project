/**
 * Vocal range text from melody.json.
 *
 * Run: npx tsx --test apps/web/src/training/vocalRange.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { MelodyFile } from "@karaoke/shared";
import { vocalRange } from "./vocalRange.ts";

const mel = (hz: (number | null)[]): MelodyFile => ({ sampleRateHz: 50, startSec: 0, hz });
const hold = (hz: number, sec: number) => Array<number>(Math.round(sec * 50)).fill(hz);

test("lowest and highest held note, as names", () => {
  assert.equal(vocalRange(mel([...hold(130.81, 1), null, ...hold(392, 1)])), "C3–G4");
});

test("a one-frame blip is not a note", () => {
  assert.equal(vocalRange(mel([...hold(130.81, 1), null, 880, null, ...hold(392, 1)])), "C3–G4");
});

test("no notes, no range", () => {
  assert.equal(vocalRange(mel([null, null])), null);
});
