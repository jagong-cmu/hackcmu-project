/**
 * The Stage's leave label mirrors the server's forfeitWouldRate: a forfeit
 * only once a rated Ranked match is ForfeitSkipMs in.
 *
 * Run: npx tsx --test apps/web/src/stage/leaveEffect.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { ForfeitSkipMs } from "@karaoke/shared";
import {
  ForfeitWarnSlackMs,
  leaveEffectOf,
  leaveSuffix,
  msUntilForfeit,
} from "./leaveEffect.ts";

const start = 1_000_000;
const rated = { mode: "ranked" as const, status: "turnA" as const, matchId: start };

test("countdown and the first ForfeitSkipMs of turn A change no rating", () => {
  assert.equal(leaveEffectOf({ ...rated, status: "countdown" }, false, start - 2000), "free");
  assert.equal(leaveEffectOf(rated, false, start), "free");
  assert.equal(leaveEffectOf(rated, false, start + ForfeitSkipMs - ForfeitWarnSlackMs - 1), "free");
});

test("a rated match past ForfeitSkipMs is a forfeit through turn B", () => {
  for (const status of ["turnA", "swap", "turnB"] as const) {
    assert.equal(leaveEffectOf({ ...rated, status }, false, start + ForfeitSkipMs), "forfeit");
  }
  // Warns slightly early, never late (clock-sync error).
  assert.equal(leaveEffectOf(rated, false, start + ForfeitSkipMs - ForfeitWarnSlackMs), "forfeit");
});

test("results still count until settled", () => {
  assert.equal(leaveEffectOf({ ...rated, status: "results" }, false, start + 60_000), "scored");
  assert.equal(leaveEffectOf({ ...rated, status: "results" }, true, start + 60_000), "free");
});

test("lobby, Duet, friendly rooms and a missing matchId change no rating", () => {
  const late = start + 60_000;
  assert.equal(leaveEffectOf({ ...rated, status: "lobby" }, false, late), "free");
  assert.equal(leaveEffectOf({ ...rated, mode: "duet", status: "live" }, false, late), "free");
  assert.equal(leaveEffectOf({ ...rated, rated: false }, false, late), "free");
  assert.equal(leaveEffectOf({ ...rated, rated: false, status: "results" }, false, late), "free");
  assert.equal(leaveEffectOf({ ...rated, matchId: null }, false, late), "free");
  assert.equal(leaveEffectOf(null, false, late), "free");
  // Absent `rated` means rated.
  assert.equal(leaveEffectOf({ ...rated, rated: true }, false, late), "forfeit");
});

test("the label re-renders when the forfeit window opens", () => {
  assert.equal(msUntilForfeit(rated, start), ForfeitSkipMs - ForfeitWarnSlackMs);
  assert.equal(msUntilForfeit({ ...rated, status: "countdown" }, start - 3000), ForfeitSkipMs - ForfeitWarnSlackMs + 3000);
  assert.equal(msUntilForfeit(rated, start + ForfeitSkipMs), null);
  assert.equal(msUntilForfeit({ ...rated, rated: false }, start), null);
  assert.equal(msUntilForfeit({ ...rated, status: "results" }, start), null);
});

test("one suffix per effect", () => {
  assert.equal(leaveSuffix("forfeit"), "counts as a forfeit");
  assert.equal(leaveSuffix("scored"), "result still counts");
  assert.equal(leaveSuffix("free"), "no rating change");
});
