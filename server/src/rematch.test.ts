/**
 * Rematch needs both seats to confirm inside RematchWindowMs.
 *
 * Run: MONGODB_URI= npx tsx --test server/src/rematch.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { RematchWindowMs, type RematchOffer } from "@karaoke/shared";
import { addPlayer, clearTimers, createRoom, removePlayer, toPublic } from "./rooms.ts";
import {
  advanceDue,
  handleRematchCancel,
  handleRematchRequest,
  rematchSeatLeft,
} from "./clock.ts";
import { mergeRematchSnap, requestRematch } from "./rematch.ts";
import { rematchView } from "../../apps/web/src/stage/rematchView.ts";

function fakeIo() {
  return {
    to() {
      return { emit() {} };
    },
  };
}
const io = fakeIo() as never;

let nextCode = 8100;

/** Two seated players sitting on a settled results screen. */
function resultsRoom(mode: "ranked" | "duet" = "ranked") {
  const room = createRoom(mode, String(nextCode++));
  for (const id of ["a", "b"]) {
    addPlayer(room, { id, clientId: id, displayName: id, socketId: `sock-${id}` });
  }
  room.status = "results";
  room.settled = true;
  room.songId = "from-the-start";
  room.songStartedAtMs = Date.now() - 30_000;
  return room;
}

test("one-sided rematch request does NOT start a match", () => {
  const room = resultsRoom();
  try {
    const before = Date.now();
    handleRematchRequest(io, room, "a");
    assert.equal(room.status, "results");
    assert.equal(room.settled, true);
    assert.ok(room.rematch, "offer is open");
    assert.deepEqual(room.rematch.requestedBy, ["a"]);
    const window = room.rematch.deadlineUnixMs - before;
    assert.ok(window >= RematchWindowMs && window <= RematchWindowMs + 50, `window ${window}`);
    // Tapping again is idempotent.
    handleRematchRequest(io, room, "a");
    assert.equal(room.status, "results");
    // Broadcast to clients.
    assert.deepEqual(toPublic(room).rematch?.requestedBy, ["a"]);
  } finally {
    clearTimers(room);
  }
});

test("opponent accepting inside the window starts the normal countdown", () => {
  const room = resultsRoom();
  try {
    handleRematchRequest(io, room, "a");
    handleRematchRequest(io, room, "b");
    assert.equal(room.status, "countdown");
    assert.equal(room.settled, false);
    assert.equal(room.rematch, null);
    assert.notEqual(room.songId, "from-the-start", "rematch still skips the last song");
    assert.ok(room.playAtUnixMs && room.playAtUnixMs > Date.now());
  } finally {
    clearTimers(room);
  }
});

test("duet uses the same handshake", () => {
  const room = resultsRoom("duet");
  try {
    handleRematchRequest(io, room, "b");
    assert.equal(room.status, "results");
    handleRematchRequest(io, room, "a");
    assert.equal(room.status, "countdown");
  } finally {
    clearTimers(room);
  }
});

test("window expiry clears the offer and leaves both on results", () => {
  const room = resultsRoom();
  try {
    handleRematchRequest(io, room, "a");
    assert.ok(room.rematch);
    room.rematch.deadlineUnixMs = Date.now() - 1;
    advanceDue(io, room);
    assert.equal(room.status, "results");
    assert.equal(room.rematch, null);
    assert.equal(room.rematchLapse?.reason, "expired");

    // A late accept now opens a fresh offer instead of starting a match.
    handleRematchRequest(io, room, "b");
    assert.equal(room.status, "results");
    const reopened = room.rematch as RematchOffer | null;
    assert.deepEqual(reopened?.requestedBy, ["b"]);
    assert.ok(reopened!.openedAtUnixMs > room.rematchLapse!.atUnixMs);
  } finally {
    clearTimers(room);
  }
});

test("an accept that arrives after the deadline (timer missed) does not start", () => {
  const room = resultsRoom();
  try {
    handleRematchRequest(io, room, "a");
    room.rematch!.deadlineUnixMs = Date.now() - 1;
    clearTimers(room);
    handleRematchRequest(io, room, "b");
    assert.equal(room.status, "results");
    assert.deepEqual(room.rematch?.requestedBy, ["b"]);
  } finally {
    clearTimers(room);
  }
});

test("simultaneous requests count as mutual acceptance", () => {
  const room = resultsRoom();
  try {
    const now = Date.now();
    assert.equal(requestRematch(room, "a", now), "opened");
    assert.equal(requestRematch(room, "b", now), "mutual");
    // Same tie on the live path.
    const live = resultsRoom();
    try {
      handleRematchRequest(io, live, "b");
      handleRematchRequest(io, live, "a");
      assert.equal(live.status, "countdown");
    } finally {
      clearTimers(live);
    }
  } finally {
    clearTimers(room);
  }
});

test("simultaneous taps on two isolates merge via the snapshot into a match", () => {
  const isoA = resultsRoom();
  const isoB = resultsRoom();
  try {
    const now = Date.now();
    requestRematch(isoA, "a", now);
    requestRematch(isoB, "b", now + 3);
    // isoA reads isoB's snapshot.
    mergeRematchSnap(isoA, isoB.rematch, isoB.rematchLapse);
    assert.deepEqual(isoA.rematch?.requestedBy.sort(), ["a", "b"]);
    advanceDue(io, isoA);
    assert.equal(isoA.status, "countdown");
  } finally {
    clearTimers(isoA);
    clearTimers(isoB);
  }
});

test("a snapshot with a newer lapse closes a stale local offer", () => {
  const room = resultsRoom();
  try {
    const now = Date.now();
    requestRematch(room, "a", now);
    mergeRematchSnap(room, null, { reason: "declined", byPlayerId: "b", atUnixMs: now + 10 });
    assert.equal(room.rematch, null);
    assert.equal(room.rematchLapse?.reason, "declined");
    // But an old snapshot cannot resurrect it.
    mergeRematchSnap(room, { requestedBy: ["a"], openedAtUnixMs: now, deadlineUnixMs: now + RematchWindowMs }, null);
    assert.equal(room.rematch, null);
  } finally {
    clearTimers(room);
  }
});

test("opponent declining closes the offer for both", () => {
  const room = resultsRoom();
  try {
    handleRematchRequest(io, room, "a");
    handleRematchCancel(io, room, "b");
    assert.equal(room.status, "results");
    assert.equal(room.rematch, null);
    assert.deepEqual(
      { reason: room.rematchLapse?.reason, by: room.rematchLapse?.byPlayerId },
      { reason: "declined", by: "b" },
    );
  } finally {
    clearTimers(room);
  }
});

test("proposer cancelling closes the offer", () => {
  const room = resultsRoom();
  try {
    handleRematchRequest(io, room, "a");
    handleRematchCancel(io, room, "a");
    assert.equal(room.rematch, null);
    assert.equal(room.rematchLapse?.reason, "cancelled");
    // B tapping afterwards opens a new offer, it does not start a match.
    handleRematchRequest(io, room, "b");
    assert.equal(room.status, "results");
  } finally {
    clearTimers(room);
  }
});

test("a player disconnecting mid-offer cancels it cleanly", () => {
  const room = resultsRoom();
  try {
    handleRematchRequest(io, room, "a");
    // What leaveCurrentRoom / pruneRoom do for the leaving seat.
    removePlayer(room, "b");
    assert.equal(rematchSeatLeft(room, "b"), true);
    assert.equal(room.rematch, null);
    assert.deepEqual(
      { reason: room.rematchLapse?.reason, by: room.rematchLapse?.byPlayerId },
      { reason: "left", by: "b" },
    );
    // The survivor tapping again cannot start a 1-player match.
    handleRematchRequest(io, room, "a");
    assert.equal(room.status, "results");
    assert.equal(room.rematch, null);
    assert.equal(room.rematchLapse?.reason, "left");
  } finally {
    clearTimers(room);
  }
});

test("rematch requests are ignored outside results and in chaos", () => {
  const room = resultsRoom();
  const chaos = createRoom("chaos", String(nextCode++));
  try {
    room.status = "turnA";
    assert.equal(requestRematch(room, "a"), "ignored");
    assert.equal(room.rematch, null);
    addPlayer(chaos, { id: "c", clientId: "c", displayName: "c", socketId: "sock-c" });
    chaos.status = "results";
    assert.equal(requestRematch(chaos, "c"), "ignored");
  } finally {
    clearTimers(room);
    clearTimers(chaos);
  }
});

test("results screen copy follows the server offer and synced clock", () => {
  const room = resultsRoom();
  try {
    const now = Date.now();
    requestRematch(room, "a", now);
    const state = toPublic(room);
    assert.deepEqual(rematchView(state, "a", now + 1_200), {
      kind: "waiting",
      opponentName: "b",
      secondsLeft: 7,
    });
    assert.deepEqual(rematchView(state, "b", now + 1_200), {
      kind: "invited",
      opponentName: "a",
      secondsLeft: 7,
    });
    handleRematchCancel(io, room, "b");
    const lapsed = toPublic(room);
    const at = room.rematchLapse!.atUnixMs;
    assert.deepEqual(rematchView(lapsed, "a", at + 100), {
      kind: "idle",
      notice: "b declined the rematch.",
    });
    assert.deepEqual(rematchView(lapsed, "a", at + 60_000), { kind: "idle", notice: null });
    removePlayer(room, "b");
    assert.equal(rematchView(toPublic(room), "a", at, "b").kind, "unavailable");
  } finally {
    clearTimers(room);
  }
});
