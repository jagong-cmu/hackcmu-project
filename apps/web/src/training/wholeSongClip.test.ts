/**
 * Training plays the whole song from 0:00; singing starts at the first note or lyric.
 *
 * Run: npx tsx --test apps/web/src/training/wholeSongClip.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { MelodyFile, SongMeta } from "@karaoke/shared";
import { wholeSongClip } from "./wholeSongClip.ts";

const meta: SongMeta = {
  id: "t",
  title: "T",
  artist: "A",
  clipStartSec: 45,
  clipDurationSec: 20,
  firstLyricSec: 15.81,
  chorusSec: 45.17,
  duetClipStartSec: 0,
  duetClipDurationSec: 200,
  chaosDurationSec: 60,
};
/** 100 Hz melody, first note at 16s. */
const melody: MelodyFile = {
  sampleRateHz: 100,
  startSec: 0,
  hz: Array.from({ length: 200 * 100 }, (_, i) => (i >= 1600 ? 440 : null)),
};

test("starts at 0:00 and runs to the end of the track", () => {
  const clip = wholeSongClip(meta, melody);
  assert.equal(clip.startSec, 0);
  assert.equal(clip.durationSec, 200);
});

test("singing starts at the first lyric, never at the chorus", () => {
  for (let i = 0; i < 50; i++) assert.equal(wholeSongClip(meta, melody).anchorSec, 15.81);
});

test("a note before the first lyric line moves the start of singing earlier", () => {
  const early = { ...melody, hz: melody.hz.map((hz, i) => (i >= 900 ? 440 : hz)) };
  assert.equal(wholeSongClip(meta, early).anchorSec, 9);
});

test("no anchors at all: singing starts at 0:00", () => {
  const blank = { ...melody, hz: melody.hz.map(() => null) };
  const clip = wholeSongClip({ ...meta, firstLyricSec: undefined }, blank);
  assert.equal(clip.anchorSec, 0);
  assert.equal(clip.leadInSec, 0);
});
