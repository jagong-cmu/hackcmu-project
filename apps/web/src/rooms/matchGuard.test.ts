/**
 * A rematch must never be pulled back into the previous match by a late update.
 *
 * Run: npx tsx --test apps/web/src/rooms/matchGuard.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { advanceMark, isNewerMatch, isOlderMatch, isStaleClock } from "./matchGuard.ts";

const old = 1_000_000;
const next = 1_060_000;

test("a late snapshot of the previous match is older", () => {
  const mark = { code: "1234", matchId: next };
  assert.equal(isOlderMatch(mark, "1234", old), true);
  assert.equal(isOlderMatch(mark, "1234", next), false);
  assert.equal(isOlderMatch(mark, "1234", null), false);
  assert.equal(isOlderMatch(mark, "9999", old), false);
});

test("the rematch is newer, and only then", () => {
  const mark = { code: "1234", matchId: old };
  assert.equal(isNewerMatch(mark, "1234", next), true);
  assert.equal(isNewerMatch(mark, "1234", old), false);
  assert.equal(isNewerMatch(null, "1234", next), false);
});

test("the mark only moves forward", () => {
  let mark = advanceMark(null, "1234", old);
  mark = advanceMark(mark, "1234", next);
  assert.equal(mark.matchId, next);
  assert.equal(advanceMark(mark, "1234", old).matchId, next);
  assert.equal(advanceMark(mark, "1234", null).matchId, next);
  assert.deepEqual(advanceMark(mark, "5678", null), { code: "5678", matchId: null });
});

test("the previous match's clock is stale; turn B of this match is not", () => {
  const room = { mode: "ranked" as const, matchId: next };
  assert.equal(isStaleClock(room, null, { playAtUnixMs: old }), true);
  assert.equal(isStaleClock(room, null, { playAtUnixMs: next }), false);
  assert.equal(isStaleClock(room, null, { playAtUnixMs: next + 25_000 }), false);
});

test("the room state may lag the clock: the mark still catches an old clock", () => {
  const room = { mode: "ranked" as const, matchId: old };
  const mark = { code: "1234", matchId: next };
  assert.equal(isStaleClock(room, mark, { playAtUnixMs: old }), true);
  // The new match's clock arrives before its room:state: not stale.
  assert.equal(isStaleClock(room, { code: "1234", matchId: old }, { playAtUnixMs: next }), false);
});

test("Chaos clocks are never judged by match", () => {
  assert.equal(isStaleClock({ mode: "chaos", matchId: null }, null, { playAtUnixMs: 1 }), false);
});
