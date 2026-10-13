/**
 * Private (room:create) Ranked rooms are friendly: they play like Ranked but
 * never move ELO, on any isolate, across rematches. Report-then-leave
 * (safety:leave) mid-match in a rated room is a forfeit like any other leave.
 * Mongo is the in-memory FakeDb, installed with setDbForTests.
 *
 * Run: MONGODB_URI= npx tsx --test server/src/friendlyRooms.test.ts
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

process.env.AUTH_REQUIRED = "0";
process.env.MONGODB_URI = "";
process.env.GEMINI_API_KEY = "";
process.env.POSTHOG_API_KEY = "";
process.env.VITE_PUBLIC_POSTHOG_KEY = "";

const { ForfeitEloK, ServerEvents, StartingElo } = await import("@karaoke/shared");
const { setDbForTests } = await import("./db.ts");
const { FakeDb } = await import("./fakeMongo.testkit.ts");
const {
  addPlayer,
  clearTimers,
  createRoom,
  forfeitWouldRate,
  livePlayers,
  matchInProgress,
  removePlayer,
  resetToLobby,
  toPublic,
} = await import("./rooms.ts");
const { applySnap, claimScore, loadSnap, saveRoomSnap, snapFromRoom } = await import("./liveState.ts");
const { finishMatch, forfeitFor, handleRematchRequest } = await import("./clock.ts");
const { persistSeatedMatch } = await import("./judge.ts");
const { eloDelta } = await import("./elo.ts");
const { getArenaStats } = await import("./analytics.ts");
const { publicPlayerId } = await import("./publicId.ts");

/** Seat ids are public ids derived from the clientId, as on every isolate. */
const A = publicPlayerId("cid-a");
const B = publicPlayerId("cid-b");
const { createSafety, markPrivateRoom, publicSafetyState, resetSafetyForTests } = await import(
  "./moderation.ts"
);

type Room = ReturnType<typeof createRoom>;
type Io = ReturnType<typeof recordingIo>;

const MATCH = 1_700_000_200_000;
let db: InstanceType<typeof FakeDb>;
let nextCode = 7900;
const made: Room[] = [];

beforeEach(async () => {
  db = new FakeDb();
  await setDbForTests(db.asDb());
  resetSafetyForTests();
});

afterEach(async () => {
  for (const r of made) clearTimers(r);
  made.length = 0;
  await setDbForTests(undefined);
});

function recordingIo() {
  const events: Array<{ event: string; payload: any }> = [];
  return {
    events,
    to() {
      return {
        emit(event: string, payload: unknown) {
          events.push({ event, payload });
        },
      };
    },
  };
}

const card = (pitch: number, tone: number) => ({
  overall: Math.round(0.7 * pitch + 0.3 * tone),
  pitch,
  tone,
  silence: false,
  verdict: "",
  source: "dsp" as const,
});

/** A ranked room on its results screen with both cards in. `private` = made with room:create. */
function resultsRoom(opts: { private?: boolean } = {}): Room {
  const room = createRoom("ranked", String(nextCode++));
  if (opts.private) markPrivateRoom(room, A);
  addPlayer(room, { id: A, clientId: "cid-a", displayName: "Alice", socketId: "sock-a" });
  addPlayer(room, { id: B, clientId: "cid-b", displayName: "Bob", socketId: "sock-b" });
  room.songId = "creep";
  room.status = "results";
  room.matchId = MATCH;
  room.matchStartedAtMs = Date.now() - 40_000;
  room.clipDurationSec = 20;
  room.scores.set(A, card(90, 80));
  room.scores.set(B, card(50, 50));
  made.push(room);
  return room;
}

/**
 * The same room code as a second isolate first sees it: a blank room that
 * only knows what the Mongo snapshot tells it (like ensureRoom).
 */
async function isolateFromSnap(code: string): Promise<Room> {
  const room = createRoom("ranked", `iso2-${code}`);
  room.code = code;
  made.push(room);
  const snap = await loadSnap(code);
  assert.ok(snap, "snapshot exists");
  applySnap(room, snap);
  return room;
}

const playerDoc = (clientId: string) => db.collection("players").findOne({ clientId });
const overs = (io: Io) => io.events.filter((e) => e.event === ServerEvents.matchOver);

async function until(pred: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}

// ---------------------------------------------------------------------------
// Rated vs friendly settlement
// ---------------------------------------------------------------------------

test("queue-made ranked room is rated: ±16, rated:true on match:over", async () => {
  const room = resultsRoom();
  assert.equal(room.rated, true, "createRoom default (queue, 0000) is rated");
  const io = recordingIo();
  await finishMatch(io as never, room);
  const expected = eloDelta(StartingElo, StartingElo, 1).a;
  assert.equal(expected, 16);
  assert.equal((await playerDoc("cid-a"))?.elo, StartingElo + 16);
  assert.equal((await playerDoc("cid-b"))?.elo, StartingElo - 16);
  const [over] = overs(io);
  assert.equal(over?.payload.eloDelta, 16);
  assert.equal(over?.payload.rated, true);
  const doc = await db.collection("matches").findOne({});
  assert.equal(doc?.rated, true);
});

test("private ranked room settles with no ELO change for either seat", async () => {
  const room = resultsRoom({ private: true });
  assert.equal(room.rated, false);
  assert.equal(toPublic(room).rated, false, "clients see it is a friendly room");
  const io = recordingIo();
  await finishMatch(io as never, room);

  const [over] = overs(io);
  assert.equal(over?.payload.winnerId, A, "same result screen: the better take still wins");
  assert.equal(over?.payload.eloDelta, 0);
  assert.equal(over?.payload.rated, false);
  assert.equal(room.lastEloDelta, 0);
  assert.deepEqual(room.players.map((p) => p.elo), [StartingElo, StartingElo], "seat ELO unchanged");
  for (const id of ["cid-a", "cid-b"]) {
    const doc = await playerDoc(id);
    assert.equal(doc?.elo, StartingElo, `${id} ELO unchanged`);
    assert.equal(doc?.matchesPlayed, 0, `${id} matchesPlayed unchanged`);
  }
  const matchDoc = await db.collection("matches").findOne({});
  assert.equal(matchDoc?.rated, false, "recorded, marked unrated");
  assert.equal(matchDoc?.eloDelta, null);
  assert.equal(matchDoc?.matchId, MATCH);
});

test("private room across isolates: flag, host and no-ELO settlement agree via the snapshot claim", async () => {
  const iso1 = resultsRoom({ private: true });
  iso1.scores.clear();
  await saveRoomSnap(iso1);
  assert.equal(await claimScore(iso1, A, card(90, 80)), "claimed");
  assert.equal(await claimScore(iso1, B, card(50, 50)), "claimed");
  iso1.scores.set(A, card(90, 80));
  iso1.scores.set(B, card(50, 50));

  const iso2 = await isolateFromSnap(iso1.code);
  assert.equal(iso2.rated, false, "second isolate knows the room is unrated");
  assert.equal(iso2.isPrivate, true);
  assert.equal(iso2.hostId, A, "and who the host is (audit #13)");
  assert.deepEqual(
    { isPrivate: publicSafetyState(iso2).isPrivate, hostId: publicSafetyState(iso2).hostId },
    { isPrivate: true, hostId: A },
  );

  const io1 = recordingIo();
  const io2 = recordingIo();
  await Promise.all([finishMatch(io1 as never, iso1), finishMatch(io2 as never, iso2)]);

  for (const id of ["cid-a", "cid-b"]) {
    assert.equal((await playerDoc(id))?.elo, StartingElo, `${id} ELO unchanged`);
    assert.equal((await playerDoc(id))?.matchesPlayed, 0);
  }
  assert.equal(await db.collection("matches").countDocuments({}), 1, "one record");
  const [o1] = overs(io1);
  const [o2] = overs(io2);
  assert.equal(o1?.payload.rated, false);
  assert.equal(o1?.payload.eloDelta, 0);
  assert.deepEqual(o2?.payload, o1?.payload, "both isolates show the same friendly result");
  for (const r of [iso1, iso2]) assert.deepEqual(r.players.map((p) => p.elo), [StartingElo, StartingElo]);
});

test("the host can kick from a second isolate that only knows the room from its snapshot", async () => {
  const iso1 = resultsRoom({ private: true });
  iso1.status = "lobby";
  iso1.settled = false;
  await saveRoomSnap(iso1);
  const iso2 = await isolateFromSnap(iso1.code);
  const safety = createSafety({
    sessionOf: (s) =>
      s === "sock-a" ? { playerId: A, displayName: "Alice", roomCode: iso2.code } : undefined,
    resolveRoom: async (c) => (c === iso2.code ? iso2 : undefined),
    socketsOf: () => [],
    eject: () => undefined,
    broadcast: () => undefined,
    emitTo: () => undefined,
    kickMedia: async () => undefined,
  });
  const ack = await safety.kick("sock-a", { targetId: B });
  assert.equal(ack.ok, true, ack.message);
  assert.equal(ack.removed, true);
});

test("rematch in a private room stays unrated", async () => {
  const room = resultsRoom({ private: true });
  const io = recordingIo();
  await finishMatch(io as never, room);
  assert.equal(room.settled, true);

  handleRematchRequest(io as never, room, A);
  handleRematchRequest(io as never, room, B);
  assert.equal(room.status, "countdown", "rematch armed");
  assert.equal(room.rated, false, "still friendly");
  assert.equal(toPublic(room).rated, false);

  // Play the rematch out to results and settle it.
  const second = room.matchId!;
  assert.notEqual(second, MATCH);
  clearTimers(room);
  room.status = "results";
  room.matchStartedAtMs = Date.now() - 40_000;
  room.scores.set(A, card(20, 20));
  room.scores.set(B, card(95, 95));
  await finishMatch(io as never, room);
  const last = overs(io).at(-1);
  assert.equal(last?.payload.winnerId, B);
  assert.equal(last?.payload.rated, false);
  assert.equal(last?.payload.eloDelta, 0);
  assert.equal((await playerDoc("cid-a"))?.elo, StartingElo);
  assert.equal((await playerDoc("cid-b"))?.elo, StartingElo);
  assert.equal(await db.collection("matches").countDocuments({ rated: false }), 2);
});

test("a forfeit in a private room moves no ELO either", async () => {
  const room = resultsRoom({ private: true });
  room.status = "turnB";
  room.scores.clear();
  const io = recordingIo();
  const leaver = room.players[0]!;
  leaver.connected = false;
  forfeitFor(io as never, room, leaver);
  await until(() => overs(io).length === 1);
  const [over] = overs(io);
  assert.equal(over?.payload.forfeit, true);
  assert.equal(over?.payload.rated, false);
  assert.equal(over?.payload.eloDelta, 0);
  assert.equal(over?.payload.winnerId, B);
  assert.equal((await playerDoc("cid-a"))?.elo ?? StartingElo, StartingElo);
  assert.equal((await playerDoc("cid-b"))?.elo ?? StartingElo, StartingElo);
});

// ---------------------------------------------------------------------------
// Snapshot round trip
// ---------------------------------------------------------------------------

test("rated / isPrivate / hostId survive a snapshot round trip", () => {
  const room = resultsRoom({ private: true });
  const snap = snapFromRoom(room);
  assert.equal(snap.rated, false);
  assert.equal(snap.isPrivate, true);
  assert.equal(snap.hostId, A);

  const fresh = createRoom("ranked", String(nextCode++));
  made.push(fresh);
  applySnap(fresh, { ...snap, code: fresh.code });
  assert.deepEqual([fresh.rated, fresh.isPrivate, fresh.hostId], [false, true, A]);
});

test("old snapshots without the flags: a room built from one is rated; a known private room stays friendly", () => {
  const room = resultsRoom({ private: true });
  const { rated: _r, isPrivate: _p, hostId: _h, ...old } = snapFromRoom(room);

  // A room first seen through an old-format snap: the old (rated) behaviour.
  const fresh = createRoom("ranked", String(nextCode++));
  made.push(fresh);
  applySnap(fresh, { ...old, code: fresh.code });
  assert.deepEqual([fresh.rated, fresh.isPrivate, fresh.hostId], [true, false, null]);

  // An isolate that already knows the room is private keeps it that way.
  applySnap(room, old);
  assert.deepEqual([room.rated, room.isPrivate, room.hostId], [false, true, A]);

  // And a stale snap that says "rated, public" cannot flip it either.
  applySnap(room, { ...old, rated: true, isPrivate: false, hostId: B });
  assert.deepEqual([room.rated, room.isPrivate, room.hostId], [false, true, A]);
});

test("resetToLobby keeps the room's rating flag", () => {
  const room = resultsRoom({ private: true });
  resetToLobby(room);
  assert.equal(room.rated, false);
  assert.equal(room.isPrivate, true);
});

// ---------------------------------------------------------------------------
// Stats and leaderboard ignore friendly matches
// ---------------------------------------------------------------------------

test("stats count only rated ranked matches; the leaderboard (players) never sees friendly ones", async () => {
  const rated = resultsRoom();
  await finishMatch(recordingIo() as never, rated);
  const friendly = resultsRoom({ private: true });
  await finishMatch(recordingIo() as never, friendly);
  // A direct unrated persist (e.g. a retry) is also ignored.
  await persistSeatedMatch({
    code: friendly.code,
    mode: "ranked",
    songId: "creep",
    players: friendly.players,
    scores: friendly.scores,
    outcome: 1,
    matchId: MATCH + 1,
    rated: false,
  });
  await new Promise((r) => setTimeout(r, 20)); // trackMatchCompleted is fire-and-forget

  assert.equal(await db.collection("matches").countDocuments({}), 3);
  const stats = await getArenaStats();
  assert.equal(stats.totals.matchesRanked, 1, "only the rated match is a ranked match");
  // Leaderboard rows are the players docs: ELO and matchesPlayed from the rated match only.
  assert.equal((await playerDoc("cid-a"))?.elo, StartingElo + 16);
  assert.equal((await playerDoc("cid-a"))?.matchesPlayed, 1);
  assert.equal((await playerDoc("cid-b"))?.matchesPlayed, 1);
});

// ---------------------------------------------------------------------------
// Report-then-leave (safety:leave)
// ---------------------------------------------------------------------------

/**
 * The real safety service around a room, with an eject that does what
 * index.ts leaveCurrentRoom does (forfeitFor, then drop the seat).
 */
function leaveHarness(room: Room) {
  const io = recordingIo();
  const sessions = new Map<string, { playerId: string; displayName: string; roomCode: string | null }>(
    room.players.map((p) => [p.socketId, { playerId: p.id, displayName: p.displayName, roomCode: room.code }]),
  );
  const ejected: Array<{ socketId: string; forfeit: boolean }> = [];
  const safety = createSafety({
    sessionOf: (socketId) => sessions.get(socketId),
    resolveRoom: async (c) => (c === room.code ? room : undefined),
    socketsOf: () => [],
    eject: (socketId, opts) => {
      ejected.push({ socketId, forfeit: opts.forfeit });
      const session = sessions.get(socketId);
      if (!session) return;
      const player = room.players.find((p) => p.id === session.playerId);
      if (player) {
        player.connected = false;
        if (opts.forfeit) forfeitFor(io as never, room, player);
        removePlayer(room, player.id);
      }
      session.roomCode = null;
      if (room.status === "countdown" && livePlayers(room).length < 2) resetToLobby(room);
    },
    broadcast: () => undefined,
    emitTo: (target, event, payload) => io.events.push({ event: `${target}:${event}`, payload }),
    kickMedia: async () => undefined,
  });
  return { io, safety, ejected };
}

async function reportOpponent(safety: ReturnType<typeof createSafety>) {
  const ack = await safety.report("sock-a", { targetId: B, reason: "harassment" });
  assert.equal(ack.ok, true, ack.message);
  assert.equal(ack.canLeave, true);
}

test("report then leave mid-match in a rated room is a forfeit, ELO applied once", async () => {
  const room = resultsRoom();
  room.status = "turnB";
  room.scores.clear();
  room.scores.set(A, card(99, 99)); // the leaver was even ahead
  await saveRoomSnap(room);
  assert.equal(matchInProgress(room), true);
  assert.equal(forfeitWouldRate(room), true);
  const h = leaveHarness(room);
  await reportOpponent(h.safety);

  const ack = await h.safety.leave("sock-a");
  assert.equal(ack.ok, true);
  assert.equal(ack.forfeit, true);
  assert.equal(ack.message, "You left. This counts as a forfeit.");
  assert.deepEqual(h.ejected, [{ socketId: "sock-a", forfeit: true }]);
  assert.equal(await db.collection("reports").countDocuments({}), 1, "the report is still recorded");
  const notice = h.io.events.find((e) => e.event.endsWith(ServerEvents.safetyNotice));
  assert.equal(notice?.payload.message, "Your opponent left the match. You win by forfeit.");

  await until(() => overs(h.io).length === 1);
  const [over] = overs(h.io);
  const expected = eloDelta(StartingElo, StartingElo, 0, ForfeitEloK).a; // seat A (leaver) loses
  assert.equal(expected, -8);
  assert.equal(over?.payload.forfeit, true);
  assert.equal(over?.payload.rated, true);
  assert.equal(over?.payload.winnerId, B);
  assert.equal(over?.payload.eloDelta, expected);
  assert.equal((await playerDoc("cid-a"))?.elo, StartingElo + expected);
  assert.equal((await playerDoc("cid-b"))?.elo, StartingElo - expected);

  // A late settlement attempt (score-wait timer, another isolate) changes nothing.
  room.settled = false;
  await finishMatch(recordingIo() as never, room);
  assert.equal((await playerDoc("cid-a"))?.elo, StartingElo + expected, "applied once");
  assert.equal((await playerDoc("cid-a"))?.matchesPlayed, 1);
  assert.equal(await db.collection("matches").countDocuments({}), 1);
  assert.equal((await db.collection("matches").findOne({}))?.forfeit, true);
});

test("report then leave on the results screen before settlement is a forfeit too", async () => {
  const room = resultsRoom(); // results, both cards in, not settled; pa is ahead
  await saveRoomSnap(room);
  assert.equal(matchInProgress(room), true);
  const h = leaveHarness(room);
  await reportOpponent(h.safety);
  const ack = await h.safety.leave("sock-a");
  assert.equal(ack.forfeit, true);
  await until(() => overs(h.io).length === 1);
  assert.equal(overs(h.io)[0]?.payload.winnerId, B, "leaving forfeits even a winning take");
  assert.equal((await playerDoc("cid-a"))?.elo, StartingElo - 8);
});

test("report then leave from the lobby is penalty-free", async () => {
  const room = resultsRoom();
  room.status = "lobby";
  room.matchId = null;
  room.matchStartedAtMs = null;
  room.scores.clear();
  const h = leaveHarness(room);
  await reportOpponent(h.safety);
  const ack = await h.safety.leave("sock-a");
  assert.equal(ack.ok, true);
  assert.equal(ack.forfeit, false);
  assert.equal(ack.message, "You left. No rating change.");
  assert.deepEqual(h.ejected, [{ socketId: "sock-a", forfeit: false }]);
  assert.equal(overs(h.io).length, 0);
  assert.equal(await db.collection("matches").countDocuments({}), 0);
  assert.equal(await playerDoc("cid-a"), null, "no rating touched");
});

test("report then leave in the countdown follows the forfeit path, thrown away under ForfeitSkipMs", async () => {
  const room = resultsRoom();
  room.status = "countdown";
  room.matchStartedAtMs = null;
  room.scores.clear();
  await saveRoomSnap(room);
  assert.equal(forfeitWouldRate(room), false);
  const h = leaveHarness(room);
  await reportOpponent(h.safety);
  const ack = await h.safety.leave("sock-a");
  assert.equal(ack.message, "You left. No rating change.");
  assert.deepEqual(h.ejected, [{ socketId: "sock-a", forfeit: true }], "same path as a normal leave");
  await until(() => overs(h.io).length === 1);
  assert.equal(overs(h.io)[0]?.payload.rated, false);
  assert.equal(overs(h.io)[0]?.payload.eloDelta, 0);
  assert.equal(await db.collection("matches").countDocuments({}), 0);
});

test("report then leave mid-match in a friendly room changes no ELO", async () => {
  const room = resultsRoom({ private: true });
  room.status = "turnB";
  room.scores.clear();
  const h = leaveHarness(room);
  await reportOpponent(h.safety);
  const ack = await h.safety.leave("sock-a");
  assert.equal(ack.ok, true);
  assert.equal(ack.forfeit, false);
  assert.equal(ack.message, "You left. No rating change.");
  assert.equal(room.status, "lobby", "the friendly match just ends");
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(overs(h.io).length, 0);
  assert.equal(await db.collection("matches").countDocuments({}), 0);
  assert.equal(await playerDoc("cid-a"), null);
  assert.equal(await playerDoc("cid-b"), null);
});

test("safety:leave still needs a report or block first", async () => {
  const room = resultsRoom();
  room.status = "turnB";
  const h = leaveHarness(room);
  const ack = await h.safety.leave("sock-a");
  assert.equal(ack.ok, false);
  assert.equal(h.ejected.length, 0);
});
