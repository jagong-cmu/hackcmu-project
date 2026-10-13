/**
 * One match settles once, even when two Vercel isolates both hold the room
 * and both run finishMatch. Mongo is the in-memory FakeDb (atomic per op,
 * unique indexes enforced), installed with setDbForTests.
 *
 * Run: MONGODB_URI= npx tsx --test server/src/settlementClaim.test.ts
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

process.env.AUTH_REQUIRED = "0";
process.env.MONGODB_URI = "";
process.env.GEMINI_API_KEY = "";
process.env.POSTHOG_API_KEY = "";
process.env.VITE_PUBLIC_POSTHOG_KEY = "";

const { ServerEvents, StartingElo } = await import("@karaoke/shared");
const { setDbForTests } = await import("./db.ts");
const { FakeDb } = await import("./fakeMongo.testkit.ts");
const { addPlayer, clearTimers, createRoom } = await import("./rooms.ts");
const { claimScore, claimSettlement, loadSnap, saveRoomSnap } = await import("./liveState.ts");
const { finishMatch, recordScore } = await import("./clock.ts");
const { persistSeatedMatch } = await import("./judge.ts");
const { eloDelta } = await import("./elo.ts");

type Room = ReturnType<typeof createRoom>;

const MATCH = 1_700_000_100_000;
let db: InstanceType<typeof FakeDb>;
let nextCode = 7700;
const made: Room[] = [];
const rejections: unknown[] = [];
const onRejection = (r: unknown) => rejections.push(r);

beforeEach(async () => {
  db = new FakeDb();
  await setDbForTests(db.asDb());
  rejections.length = 0;
  process.on("unhandledRejection", onRejection);
});

afterEach(async () => {
  process.off("unhandledRejection", onRejection);
  for (const r of made) clearTimers(r);
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

/** A ranked room on its results screen with both cards in, as isolate 1 holds it. */
function resultsRoom(): Room {
  const room = createRoom("ranked", String(nextCode++));
  addPlayer(room, { id: "pa", clientId: "cid-a", displayName: "Alice", socketId: "sock-a" });
  addPlayer(room, { id: "pb", clientId: "cid-b", displayName: "Bob", socketId: "sock-b" });
  room.songId = "creep";
  room.status = "results";
  room.matchId = MATCH;
  room.clipDurationSec = 20;
  room.scores.set("pa", card(90, 80));
  room.scores.set("pb", card(50, 50));
  made.push(room);
  return room;
}

/** The same room as a second isolate holds it in its own memory. */
function otherIsolate(room: Room): Room {
  const copy: Room = {
    ...room,
    players: room.players.map((p) => ({ ...p })),
    scores: new Map(room.scores),
    timers: new Set(),
  };
  made.push(copy);
  return copy;
}

async function playerDoc(clientId: string) {
  return db.collection("players").findOne({ clientId });
}

test("two isolates racing finishMatch: ELO applied once, one matches doc, same result on both", async () => {
  const iso1 = resultsRoom();
  await saveRoomSnap(iso1);
  const iso2 = otherIsolate(iso1);
  const io1 = recordingIo();
  const io2 = recordingIo();

  await Promise.all([finishMatch(io1 as never, iso1), finishMatch(io2 as never, iso2)]);

  const expected = eloDelta(StartingElo, StartingElo, 1).a;
  const a = await playerDoc("cid-a");
  const b = await playerDoc("cid-b");
  assert.equal(a?.elo, StartingElo + expected, "A rated once");
  assert.equal(b?.elo, StartingElo - expected, "B rated once");
  assert.equal(a?.matchesPlayed, 1);
  assert.equal(b?.matchesPlayed, 1);
  assert.equal(await db.collection("matches").countDocuments({}), 1, "one matches doc");
  assert.equal((await db.collection("matches").findOne({}))?.matchId, MATCH);

  for (const [label, room] of [["iso1", iso1], ["iso2", iso2]] as const) {
    assert.equal(room.settled, true, `${label} settled`);
    assert.equal(room.status, "results", `${label} results`);
    assert.equal(room.lastWinnerId, "pa", `${label} winner`);
    assert.equal(room.lastEloDelta, expected, `${label} delta`);
    assert.equal(room.players[0]?.elo, StartingElo + expected, `${label} seat elo`);
  }
  const over1 = io1.events.filter((e) => e.event === ServerEvents.matchOver);
  const over2 = io2.events.filter((e) => e.event === ServerEvents.matchOver);
  assert.equal(over1.length, 1);
  assert.equal(over2.length, 1, "the losing isolate still tells its sockets");
  assert.deepEqual(over2[0]!.payload, over1[0]!.payload, "same result on both isolates");

  const snap = await loadSnap(iso1.code);
  assert.equal(snap?.settledMatchId, MATCH);
  assert.ok(snap?.settledBy);

  // A third, late call (e.g. the 8s score-wait timer) changes nothing.
  const iso3 = otherIsolate(iso1);
  iso3.settled = false;
  await finishMatch(recordingIo() as never, iso3);
  assert.equal((await playerDoc("cid-a"))?.elo, StartingElo + expected);
  assert.equal(await db.collection("matches").countDocuments({}), 1);
  assert.deepEqual(rejections, []);
});

test("claim lost on a regression: the matches unique index still stops a second rating", async () => {
  // No liveRooms doc at all, so both isolates fall back to "local" settlement.
  const iso1 = resultsRoom();
  const iso2 = otherIsolate(iso1);
  assert.equal(await claimSettlement(iso1), "local");

  await Promise.all([
    finishMatch(recordingIo() as never, iso1),
    finishMatch(recordingIo() as never, iso2),
  ]);

  const expected = eloDelta(StartingElo, StartingElo, 1).a;
  assert.equal((await playerDoc("cid-a"))?.elo, StartingElo + expected, "A rated once");
  assert.equal((await playerDoc("cid-b"))?.elo, StartingElo - expected, "B rated once");
  assert.equal((await playerDoc("cid-a"))?.matchesPlayed, 1);
  assert.equal(await db.collection("matches").countDocuments({}), 1);
  assert.equal(iso1.lastEloDelta, expected);
  assert.equal(iso2.lastEloDelta, expected, "duplicate reports the stored settlement");
  assert.deepEqual(rejections, []);
});

test("persistSeatedMatch twice for one match: duplicate key handled, no double ELO", async () => {
  const room = resultsRoom();
  const input = {
    code: room.code,
    mode: "ranked" as const,
    songId: "creep",
    players: room.players,
    scores: room.scores,
    outcome: 1 as const,
    matchId: MATCH,
  };
  const first = await persistSeatedMatch(input);
  const second = await persistSeatedMatch(input);
  assert.equal(second, first);
  assert.equal((await playerDoc("cid-a"))?.elo, StartingElo + first);
  assert.equal((await playerDoc("cid-a"))?.matchesPlayed, 1);
  assert.equal(await db.collection("matches").countDocuments({}), 1);

  // A different match in the same room is a new doc and rates again.
  await persistSeatedMatch({ ...input, matchId: MATCH + 60_000 });
  assert.equal(await db.collection("matches").countDocuments({}), 2);
  assert.equal((await playerDoc("cid-a"))?.matchesPlayed, 2);
});

test("legacy matches docs without matchId never collide with each other", async () => {
  const col = db.collection("matches");
  await col.insertOne({ roomId: "0000", mode: "ranked" });
  await col.insertOne({ roomId: "0000", mode: "ranked" });
  assert.equal(await col.countDocuments({}), 2);
});

test("one score per seat per match across isolates; a stale snapshot save cannot erase it", async () => {
  const iso1 = resultsRoom();
  iso1.scores.clear();
  await saveRoomSnap(iso1);
  const iso2 = otherIsolate(iso1);
  const io = recordingIo();

  const first = await recordScore(io as never, iso1, "pa", card(40, 40));
  assert.deepEqual(first, { ok: true, settled: false });

  // iso2 never saw that score and saves its own (score-less) snapshot.
  await saveRoomSnap(iso2);
  assert.equal((await loadSnap(iso1.code))?.matchScores?.pa?.card.pitch, 40, "claim survives");

  const second = await recordScore(io as never, iso2, "pa", card(100, 100));
  assert.equal(second.ok, false);
  assert.equal(!second.ok && second.code, "SCORE_ALREADY_RECORDED");
  assert.equal(iso2.scores.has("pa"), false, "the refused card is not kept");

  // iso2 learns the claimed card when it next reads the snapshot.
  const snap = await loadSnap(iso1.code);
  const { applySnap } = await import("./liveState.ts");
  applySnap(iso2, snap!);
  assert.equal(iso2.scores.get("pa")?.pitch, 40);
});

test("a score posted to another isolate after settlement is refused", async () => {
  const iso1 = resultsRoom();
  iso1.scores.delete("pb");
  await saveRoomSnap(iso1);
  const iso2 = otherIsolate(iso1);
  assert.equal(await claimSettlement(iso1), "won");
  const late = await recordScore(recordingIo() as never, iso2, "pb", card(99, 99));
  assert.equal(late.ok, false);
  assert.equal(!late.ok && late.code, "MATCH_SETTLED");
  assert.equal(await claimScore(iso2, "pb", card(99, 99)), "settled");
});

test("without Mongo, settlement and score claims fall back to single-instance behaviour", async () => {
  await setDbForTests(null);
  const room = resultsRoom();
  assert.equal(await claimSettlement(room), "local");
  assert.equal(await claimScore(room, "pa", card(1, 1)), "local");
  const io = recordingIo();
  await finishMatch(io as never, room);
  assert.equal(room.settled, true);
  assert.equal(room.lastWinnerId, "pa");
  assert.equal(io.events.filter((e) => e.event === ServerEvents.matchOver).length, 1);
});
