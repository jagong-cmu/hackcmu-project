/**
 * Match arming must not depend on the opponent's socket living on this isolate.
 * Vercel runs one Socket.IO per function; the other laptop is always "not connected" here.
 *
 * Run: MONGODB_URI= npx tsx --test server/src/matchClock.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addPlayer,
  clearTimers,
  createRoom,
  dropDeadPlayers,
  livePlayers,
} from "./rooms.ts";
import { formatCountdown } from "../../apps/web/src/stage/formatCountdown.ts";
import { advanceDue, maybeArmMatch } from "./clock.ts";

function fakeIo() {
  return {
    to() {
      return { emit() {} };
    },
  };
}

function seat(
  room: ReturnType<typeof createRoom>,
  id: string,
  socketId: string,
) {
  return addPlayer(room, {
    id,
    clientId: id,
    displayName: id,
    socketId,
  });
}

test("dropDeadPlayers keeps a fresh remote seat whose socket is on another isolate", () => {
  const room = createRoom("ranked", "1111");
  seat(room, "a", "sock-a");
  seat(room, "b", "sock-b");
  const removed = dropDeadPlayers(room, (id) => id === "sock-a");
  assert.equal(removed.length, 0, "remote player must not be pruned as a ghost");
  assert.equal(livePlayers(room).length, 2);
  clearTimers(room);
});

test("dropDeadPlayers still kicks a seat that has gone idle", () => {
  const room = createRoom("ranked", "2222");
  const stale = seat(room, "ghost", "sock-ghost");
  stale.lastSeenMs = Date.now() - 60_000;
  const removed = dropDeadPlayers(room, () => false);
  assert.equal(removed.length, 1);
  assert.equal(livePlayers(room).length, 0);
  clearTimers(room);
});

test("two seated players arm a 10s countdown without ready taps", () => {
  const room = createRoom("ranked", "3333");
  try {
    seat(room, "a", "sock-a");
    seat(room, "b", "sock-b");
    maybeArmMatch(fakeIo() as never, room);
    assert.equal(room.status, "countdown");
    assert.equal(room.songId, "viva-la-vida", "ranked demo clip is Viva La Vida");
    assert.equal(room.clipDurationSec, 30);
    assert.ok(room.playAtUnixMs);
    const wait = room.playAtUnixMs! - Date.now();
    assert.ok(wait > 8_000 && wait <= 10_500, `expected ~10s, got ${wait}`);
  } finally {
    clearTimers(room);
  }
});

test("countdown text is always one decimal", () => {
  assert.equal(formatCountdown(10_000), "10.0");
  assert.equal(formatCountdown(9_040), "9.0");
  assert.equal(formatCountdown(50), "0.1");
  assert.equal(formatCountdown(0), "0.0");
});

test("advanceDue starts the clip when playAtUnixMs is reached even if later() died", () => {
  const room = createRoom("ranked", "4444");
  try {
    seat(room, "a", "sock-a");
    seat(room, "b", "sock-b");
    maybeArmMatch(fakeIo() as never, room);
    assert.equal(room.status, "countdown");
    room.playAtUnixMs = Date.now() - 20;
    clearTimers(room);
    advanceDue(fakeIo() as never, room);
    assert.equal(room.status, "turnA");
  } finally {
    clearTimers(room);
  }
});
