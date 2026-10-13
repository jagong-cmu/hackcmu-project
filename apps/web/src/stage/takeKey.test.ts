/**
 * A take is keyed on matchId + seat + status, never playAtUnixMs, and never
 * restarts once started (score in flight or posted).
 *
 * Run: npx tsx --test apps/web/src/stage/takeKey.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { RoomState } from "@karaoke/shared";
import { isScoringClip, shouldStartTake, takeKey } from "./takeKey.ts";

const base: RoomState = {
  code: "ABCD",
  mode: "ranked",
  players: [
    { id: "a", displayName: "A", elo: 1000 },
    { id: "b", displayName: "B", elo: 1000 },
  ],
  songId: "song",
  status: "turnB",
  activeSingerId: "b",
  playAtUnixMs: 1_000_000,
  playheadSec: 0,
  matchId: 900_000,
};

test("playAt differing per server instance keeps the same take", () => {
  const socket = takeKey(base, "b");
  const poll = takeKey({ ...base, playAtUnixMs: 1_000_137 }, "b");
  assert.ok(socket);
  assert.equal(socket, poll);
});

test("turn, match and seat each name a different take", () => {
  const b = takeKey(base, "b");
  assert.notEqual(takeKey({ ...base, status: "turnA", activeSingerId: "a" }, "a"), b);
  assert.notEqual(takeKey({ ...base, matchId: 950_000 }, "b"), b);
});

test("no take when this player is not being scored", () => {
  assert.equal(takeKey(base, "a"), null);
  assert.equal(takeKey({ ...base, status: "swap" }, "b"), null);
  assert.equal(takeKey({ ...base, mode: "chaos" }, "b"), null);
  assert.equal(takeKey(null, "b"), null);
  assert.equal(takeKey(base, null), null);
  assert.equal(isScoringClip({ ...base, mode: "duet", status: "live" }, "a"), true);
});

test("a started take (in flight or posted) never restarts", () => {
  const started = new Set<string>();
  const key = takeKey(base, "b");
  assert.equal(shouldStartTake(key, started), true);
  started.add(key!);
  // Socket room:state and a poll from another instance, B's POST in flight.
  assert.equal(shouldStartTake(takeKey({ ...base, playAtUnixMs: 1_000_250 }, "b"), started), false);
  assert.equal(shouldStartTake(null, started), false);
  // The next match is a new take.
  assert.equal(shouldStartTake(takeKey({ ...base, matchId: 2_000_000 }, "b"), started), true);
});
