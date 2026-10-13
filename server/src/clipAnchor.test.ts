/**
 * The server flips the clip anchor once per match, so both seats (and turn A
 * and turn B) share one start, and the flip survives a snapshot round-trip.
 *
 * Run: MONGODB_URI= npx tsx --test server/src/clipAnchor.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { ClipLeadInMs, RankedClipMaxSec, SONGS, songById } from "@karaoke/shared";
import { addPlayer, clearTimers, createRoom, resetToLobby, toPublic } from "./rooms.ts";
import { advanceDue, matchClip, maybeArmMatch, publicClock, setClipAnchorRng } from "./clock.ts";
import { applySnap, snapFromRoom } from "./liveState.ts";

const LEAD = ClipLeadInMs / 1000;

function fakeIo(sink: Array<{ event: string; payload: unknown }> = []) {
  return {
    to() {
      return {
        emit(event: string, payload: unknown) {
          sink.push({ event, payload });
        },
      };
    },
  };
}

function seatTwo(room: ReturnType<typeof createRoom>) {
  for (const id of ["a", "b"]) {
    addPlayer(room, { id, clientId: id, displayName: id, socketId: `sock-${id}` });
  }
}

test("matchClip: same rng → same anchor; ranked total = lead-in + hook, capped", () => {
  const creep = songById("creep")!;
  const chorus = matchClip(creep, "ranked", () => 0.9);
  assert.equal(chorus.anchor, "chorus");
  assert.equal(chorus.startSec, +(64.35 - LEAD).toFixed(2));
  assert.equal(chorus.durationSec, LEAD + 20);
  assert.ok(chorus.durationSec <= RankedClipMaxSec);

  const first = matchClip(creep, "ranked", () => 0.1);
  assert.equal(first.anchor, "firstLyric");
  assert.equal(first.startSec, +(23.06 - LEAD).toFixed(2));

  const duet = matchClip(creep, "duet", () => 0.1);
  assert.equal(duet.startSec, +(23.06 - LEAD).toFixed(2));
  assert.ok(Math.abs(duet.startSec + duet.durationSec - 252.9) < 1e-6, "duet runs to track end");
});

for (const [r, anchor] of [
  [0.2, "firstLyric"],
  [0.8, "chorus"],
] as const) {
  test(`ranked match with rng ${r} stores the ${anchor} anchor in room + public state`, () => {
    setClipAnchorRng(() => r);
    const room = createRoom("ranked", r < 0.5 ? "7101" : "7102");
    const sent: Array<{ event: string; payload: unknown }> = [];
    try {
      seatTwo(room);
      maybeArmMatch(fakeIo(sent) as never, room);
      assert.equal(room.status, "countdown");
      const song = SONGS.find((s) => s.id === room.songId)!;
      assert.ok(song);
      const anchorSec = anchor === "chorus" ? song.chorusSec! : song.firstLyricSec!;
      assert.equal(room.clipAnchor, anchor);
      assert.ok(Math.abs(room.clipStartSec - Math.max(0, anchorSec - LEAD)) < 1e-6);
      assert.ok(Math.abs(room.clipStartSec + room.clipLeadInSec - anchorSec) < 1e-6);
      assert.ok(room.clipDurationSec <= RankedClipMaxSec);

      const pub = toPublic(room);
      assert.equal(pub.clipAnchor, anchor);
      assert.equal(pub.clipStartSec, room.clipStartSec);
      assert.equal(pub.clipLeadInSec, room.clipLeadInSec);

      const clock = sent.find((e) => e.event === "clock:play")?.payload as {
        startSec: number;
        leadInSec: number;
        anchor: string;
      };
      assert.ok(clock, "clock:play sent");
      assert.equal(clock.startSec, room.clipStartSec);
      assert.equal(clock.leadInSec, room.clipLeadInSec);
      assert.equal(clock.anchor, anchor);
      assert.equal(publicClock(room)?.anchor, anchor);
    } finally {
      setClipAnchorRng();
      clearTimers(room);
    }
  });
}

test("turn B replays turn A's window (no second flip)", () => {
  let calls = 0;
  setClipAnchorRng(() => {
    calls += 1;
    return calls === 1 ? 0.9 : 0.1;
  });
  const room = createRoom("ranked", "7103");
  try {
    seatTwo(room);
    maybeArmMatch(fakeIo() as never, room);
    const window = { start: room.clipStartSec, dur: room.clipDurationSec, anchor: room.clipAnchor };
    // Fast-forward through countdown → turnA → swap → turnB on the wall clock.
    room.playAtUnixMs = Date.now() - 1;
    advanceDue(fakeIo() as never, room);
    assert.equal(room.status, "turnA");
    room.playAtUnixMs = Date.now() - room.clipDurationSec * 1000 - 1;
    advanceDue(fakeIo() as never, room);
    assert.equal(room.status, "swap");
    room.playAtUnixMs = Date.now() - 1;
    advanceDue(fakeIo() as never, room);
    assert.equal(room.status, "turnB");
    assert.deepEqual(
      { start: room.clipStartSec, dur: room.clipDurationSec, anchor: room.clipAnchor },
      window,
    );
    assert.equal(calls, 1, "one anchor flip per match");
  } finally {
    setClipAnchorRng();
    clearTimers(room);
  }
});

test("rematch flips a fresh anchor; lobby clears it", () => {
  setClipAnchorRng(() => 0.9);
  const room = createRoom("duet", "7104");
  try {
    seatTwo(room);
    maybeArmMatch(fakeIo() as never, room);
    assert.equal(room.clipAnchor, "chorus");
    resetToLobby(room);
    assert.equal(room.clipAnchor, null);
    assert.equal(toPublic(room).clipAnchor, null);
    setClipAnchorRng(() => 0.1);
    maybeArmMatch(fakeIo() as never, room);
    assert.equal(room.clipAnchor, "firstLyric");
  } finally {
    setClipAnchorRng();
    clearTimers(room);
  }
});

test("clipAnchor + lead-in survive the liveState snapshot round-trip", () => {
  setClipAnchorRng(() => 0.9);
  const src = createRoom("ranked", "7105");
  const dst = createRoom("ranked", "7106");
  try {
    seatTwo(src);
    maybeArmMatch(fakeIo() as never, src);
    const snap = snapFromRoom(src);
    assert.equal(snap.clipAnchor, "chorus");
    assert.equal(snap.clipLeadInSec, src.clipLeadInSec);
    // Through JSON, as Mongo would store it.
    applySnap(dst, JSON.parse(JSON.stringify(snap)));
    assert.equal(dst.clipAnchor, "chorus");
    assert.equal(dst.clipStartSec, src.clipStartSec);
    assert.equal(dst.clipDurationSec, src.clipDurationSec);
    assert.equal(dst.clipLeadInSec, src.clipLeadInSec);

    // Old snaps (before anchors) restore as "no lead-in", not undefined.
    const old = JSON.parse(JSON.stringify(snap));
    delete old.clipAnchor;
    delete old.clipLeadInSec;
    const legacy = createRoom("ranked", "7107");
    applySnap(legacy, old);
    assert.equal(legacy.clipAnchor, null);
    assert.equal(legacy.clipLeadInSec, 0);
    clearTimers(legacy);
  } finally {
    setClipAnchorRng();
    clearTimers(src);
    clearTimers(dst);
  }
});
