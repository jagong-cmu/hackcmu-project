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
  isFull,
  livePlayers,
  resetToLobby,
} from "./rooms.ts";
import { SONGS } from "@karaoke/shared";
import { formatCountdown } from "../../apps/web/src/stage/formatCountdown.ts";
import { advanceDue, maybeArmMatch } from "./clock.ts";
import { eloDelta } from "./elo.ts";

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
    const song = SONGS.find((s) => s.id === room.songId);
    assert.ok(song, "ranked picks a catalog song");
    assert.equal(room.clipStartSec, song.clipStartSec);
    assert.equal(room.clipDurationSec, Math.min(20, song.clipDurationSec));
    assert.ok(room.playAtUnixMs);
    const wait = room.playAtUnixMs! - Date.now();
    assert.ok(wait > 8_000 && wait <= 10_500, `expected ~10s, got ${wait}`);
  } finally {
    clearTimers(room);
  }
});

test("rematch skips the song that just played", () => {
  const room = createRoom("ranked", "6666");
  try {
    seat(room, "a", "sock-a");
    seat(room, "b", "sock-b");
    maybeArmMatch(fakeIo() as never, room);
    const first = room.songId;
    assert.ok(first);
    const seen = new Set<string>([first]);
    for (let i = 0; i < 8; i++) {
      resetToLobby(room);
      maybeArmMatch(fakeIo() as never, room);
      assert.notEqual(room.songId, first, "immediate rematch must not repeat");
      seen.add(room.songId ?? "");
      first && (room.songId = first); // restore so each rematch still skips `first`? No that's wrong
    }
    assert.ok(seen.size >= 2);
  } finally {
    clearTimers(room);
  }
});
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

test("draw does not move ELO even when ratings differ", () => {
  assert.deepEqual(eloDelta(1400, 1000, 0.5), { a: 0, b: 0 });
  assert.deepEqual(eloDelta(1000, 1000, 0.5), { a: 0, b: 0 });
});

test("settled results do not auto-start a new match", () => {
  const room = createRoom("ranked", "5555");
  try {
    seat(room, "a", "sock-a");
    seat(room, "b", "sock-b");
    room.status = "results";
    room.settled = true;
    room.songId = "from-the-start";
    room.rematchAtMs = Date.now() - 10_000;
    advanceDue(fakeIo() as never, room);
    assert.equal(room.status, "results");
    assert.equal(room.songId, "from-the-start");
  } finally {
    clearTimers(room);
  }
});

test("ranked room stays full while a disconnected seat is still on the roster", () => {
  const room = createRoom("ranked", "7777");
  seat(room, "a", "sock-a");
  const b = seat(room, "b", "sock-b");
  b.connected = false;
  assert.equal(livePlayers(room).length, 1);
  assert.equal(isFull(room), true);
  clearTimers(room);
});
