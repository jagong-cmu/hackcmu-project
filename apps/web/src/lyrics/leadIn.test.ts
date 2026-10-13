/**
 * The clip lead-in is never scored, and the guide shows the anchor line
 * during it.
 *
 * Run: npx tsx --test apps/web/src/lyrics/leadIn.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { singWindow, type MelodyFile } from "@karaoke/shared";
import { scoreContour, type PitchFrame } from "../scoring/scoreClip.ts";
import { anchorLine, inLeadIn, melodyFrom, singFromOf } from "./leadIn.ts";
import { parseLrc } from "./parseLrc.ts";

const SR = 50;

/** Melody voiced across the whole span, like a chorus start whose lead-in overlaps the previous line. */
function melody(fromSec: number, toSec: number, hz = 220): MelodyFile {
  const out: Array<number | null> = new Array(Math.round(toSec * SR)).fill(null);
  for (let i = Math.round(fromSec * SR); i < out.length; i++) out[i] = hz;
  return { sampleRateHz: SR, startSec: 0, hz: out };
}

/** In-tune singing from `fromSec` to `toSec`, silence before. */
function take(clipStart: number, fromSec: number, toSec: number, hz = 220): PitchFrame[] {
  const frames: PitchFrame[] = [];
  for (let t = clipStart; t < toSec; t += 1 / 60) {
    frames.push(t < fromSec ? { timeSec: t, hz: null, clarity: 0 } : { timeSec: t, hz, clarity: 0.95 });
  }
  return frames;
}

// A ranked chorus clip: 5s lead-in from 59.35, sing 64.35 → 84.35.
const clip = { startSec: 59.35, durationSec: 25, leadInSec: 5 };

test("a silent lead-in does not lower the score", () => {
  const mel = melody(55, 90); // previous line's notes run through the lead-in
  const frames = take(clip.startSec, 64.35, 84.35);
  const scored = scoreContour(frames, mel, singWindow(clip));
  const perfectFromAnchor = scoreContour(
    take(64.35, 64.35, 84.35),
    mel,
    { startSec: 64.35, durationSec: 20 },
  );
  assert.equal(scored.silence, false);
  assert.equal(scored.pitch, perfectFromAnchor.pitch);
  assert.equal(scored.overall, perfectFromAnchor.overall);

  // Scoring the whole clip would have counted the lead-in's notes as missed.
  const naive = scoreContour(frames, mel, clip);
  assert.ok(naive.pitch <= scored.pitch);
});

test("singing over the lead-in earns nothing extra", () => {
  const mel = melody(55, 90);
  const quietLead = scoreContour(take(clip.startSec, 64.35, 84.35), mel, singWindow(clip));
  const loudLead = scoreContour(take(clip.startSec, clip.startSec, 84.35), mel, singWindow(clip));
  assert.equal(loudLead.overall, quietLead.overall);
});

test("lead-in helpers", () => {
  assert.equal(singFromOf(clip), 64.35);
  assert.equal(singFromOf({ startSec: 0, leadInSec: 0 }), null);
  assert.equal(singFromOf(null), null);
  assert.equal(inLeadIn(60, 64.35), true);
  assert.equal(inLeadIn(64.35, 64.35), false);
  assert.equal(inLeadIn(60, null), false);

  const lines = parseLrc("[00:59.02]AB: You're so special\n[01:04.35]AB: But I'm a creep\n");
  assert.equal(anchorLine(lines, 64.35)?.text, "But I'm a creep");
});

test("melodyFrom hides notes before the anchor only", () => {
  const mel = melody(55, 90);
  const cut = melodyFrom(mel, 64.35);
  assert.equal(cut.hz[Math.round(62 * SR)], null);
  assert.equal(cut.hz[Math.round(65 * SR)], 220);
  assert.equal(mel.hz[Math.round(62 * SR)], 220, "original untouched");
  assert.equal(melodyFrom(mel, null), mel);
});
