/**
 * The versus card shows for the first MatchIntroMs of the pre-match
 * countdown, then gets out of the way of the 3-2-1.
 *
 * Run: npx tsx --test apps/web/src/stage/matchIntro.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { MatchCountdownMs } from "@karaoke/shared";
import { MatchIntroMs, showMatchIntro } from "./formatCountdown.ts";

test("the intro is at most two seconds", () => {
  assert.ok(MatchIntroMs <= 2000);
});

test("up at the start of the countdown, gone once MatchIntroMs has passed", () => {
  assert.equal(showMatchIntro(MatchCountdownMs), true);
  assert.equal(showMatchIntro(MatchCountdownMs - MatchIntroMs + 1), true);
  assert.equal(showMatchIntro(MatchCountdownMs - MatchIntroMs), false);
  assert.equal(showMatchIntro(1000), false);
  assert.equal(showMatchIntro(0), false);
});

test("not shown before the countdown has armed, or for nonsense input", () => {
  assert.equal(showMatchIntro(MatchCountdownMs + 5000), false);
  assert.equal(showMatchIntro(Number.NaN), false);
  assert.equal(showMatchIntro(-100), false);
});
