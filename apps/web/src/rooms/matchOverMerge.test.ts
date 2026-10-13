/**
 * The GET poll must not wipe the socket's rated/forfeit for the same match.
 *
 * Run: npx tsx --test apps/web/src/rooms/matchOverMerge.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ScoreCard } from "@karaoke/shared";
import { mergeMatchOver, type MatchOver } from "./matchOverMerge.ts";

const card = { overall: 70, pitch: 70, tone: 70 } as unknown as ScoreCard;

const socket: MatchOver = {
  scores: { a: card },
  winnerId: "a",
  eloDelta: 0,
  forfeit: true,
  rated: false,
  matchId: 42,
};

test("a thrown-away forfeit keeps rated:false and forfeit:true after a poll", () => {
  const poll: MatchOver = { scores: { a: card }, winnerId: "a", eloDelta: 0, matchId: 42 };
  const merged = mergeMatchOver(socket, poll);
  assert.equal(merged.rated, false);
  assert.equal(merged.forfeit, true);
  assert.equal(merged.winnerId, "a");
});

test("a rated forfeit keeps forfeit and its ELO when the poll lacks them", () => {
  const prev: MatchOver = { ...socket, rated: true, eloDelta: 8 };
  const merged = mergeMatchOver(prev, { scores: {}, winnerId: null, eloDelta: 0, matchId: 42 });
  assert.equal(merged.rated, true);
  assert.equal(merged.forfeit, true);
  assert.equal(merged.eloDelta, 8);
  assert.equal(merged.winnerId, "a");
  assert.deepEqual(merged.scores, { a: card });
});

test("fields the poll does send win", () => {
  const merged = mergeMatchOver(
    { ...socket, rated: undefined },
    { scores: { a: card, b: card }, winnerId: "b", eloDelta: 0, rated: false, matchId: 42 },
  );
  assert.equal(merged.rated, false);
  assert.deepEqual(Object.keys(merged.scores), ["a", "b"]);
  assert.equal(merged.winnerId, "b");
});

test("seat A (for the ELO sign) survives a poll that lacks it", () => {
  const merged = mergeMatchOver({ ...socket, seatAId: "a" }, { scores: {}, winnerId: "a", eloDelta: 0, matchId: 42 });
  assert.equal(merged.seatAId, "a");
});

test("a different match replaces everything", () => {
  const next: MatchOver = { scores: {}, winnerId: null, eloDelta: 12, matchId: 99 };
  assert.deepEqual(mergeMatchOver(socket, next), next);
  assert.deepEqual(mergeMatchOver(null, next), next);
});
