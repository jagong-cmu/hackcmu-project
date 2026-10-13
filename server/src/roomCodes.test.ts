/**
 * room:create codes are reserved in Mongo (audit #10): two instances can never
 * hand out the same code, so one instance's snapshot can never overwrite a
 * live room on another. Mongo is the in-memory FakeDb (atomic per op, unique
 * {code} index enforced); "another instance" is a liveRooms doc this
 * process's room map does not hold.
 *
 * Run: MONGODB_URI= npx tsx --test server/src/roomCodes.test.ts
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

process.env.AUTH_REQUIRED = "0";
process.env.MONGODB_URI = "";
process.env.GEMINI_API_KEY = "";
process.env.POSTHOG_API_KEY = "";
process.env.VITE_PUBLIC_POSTHOG_KEY = "";

const { setDbForTests } = await import("./db.ts");
const { FakeDb } = await import("./fakeMongo.testkit.ts");
const { draftRoom, getRoom, disposeIfEmpty } = await import("./rooms.ts");
const { markPrivateRoom } = await import("./moderation.ts");
const { createSharedRoom, ensureRoom, loadSnap, reserveExactCode, saveRoomSnap, snapFromRoom } = await import(
  "./liveState.ts"
);

type Room = ReturnType<typeof draftRoom>;

let db: InstanceType<typeof FakeDb>;
const made: Room[] = [];
const realRandom = Math.random;

/** Math.random yields these 4-digit codes in order, then real randomness. */
function forceCodes(...codes: string[]): void {
  const queue = codes.map((c) => (Number(c) + 0.5) / 10_000);
  Math.random = () => (queue.length ? queue.shift()! : realRandom());
}

beforeEach(async () => {
  db = new FakeDb();
  await setDbForTests(db.asDb());
});

afterEach(async () => {
  Math.random = realRandom;
  for (const r of made.splice(0)) {
    r.players = [];
    r.persistent = false;
    disposeIfEmpty(r);
  }
  await setDbForTests(undefined);
});

async function create(host = "p_host"): Promise<Room> {
  const room = await createSharedRoom("ranked", (d) => markPrivateRoom(d, host));
  made.push(room);
  return room;
}

/** Another instance's live room: a snapshot in Mongo, unknown to this process. */
async function roomOnOtherInstance(code: string): Promise<void> {
  const other = draftRoom("ranked", code);
  other.players = [
    { id: "p_b1", clientId: "cid-b1", displayName: "B1", socketId: "sock-b1", connected: true, lastSeen: Date.now() } as any,
  ];
  await db.collection("liveRooms").insertOne(snapFromRoom(other));
}

test("without Mongo: a local code, setup applied, registered", async () => {
  await setDbForTests(null);
  const room = await create();
  assert.match(room.code, /^\d{4}$/);
  assert.equal(getRoom(room.code), room);
  assert.equal(room.isPrivate, true);
  assert.equal(room.rated, false);
  assert.equal(room.hostId, "p_host");
});

test("a code live on another instance is never handed out", async () => {
  await roomOnOtherInstance("4321");
  forceCodes("4321", "4321", "5555");
  const room = await create();
  assert.equal(room.code, "5555");
  // B's room is untouched: still its seat, still rated/public.
  const theirs = await loadSnap("4321");
  assert.equal(theirs?.players.length, 1);
  assert.equal(theirs?.isPrivate, false);
});

test("the reservation is the first snapshot: private, unrated, hosted", async () => {
  forceCodes("1111");
  const room = await create("p_alice");
  assert.equal(room.code, "1111");
  assert.equal(getRoom("1111"), room);
  const snap = await loadSnap("1111");
  assert.ok(snap);
  assert.equal(snap.isPrivate, true);
  assert.equal(snap.rated, false);
  assert.equal(snap.hostId, "p_alice");
  assert.equal(snap.status, "lobby");
  // Later saves merge into the reserved doc, as before.
  room.songId = "creep";
  await saveRoomSnap(room);
  assert.equal((await loadSnap("1111"))?.songId, "creep");
  assert.equal(db.collection("liveRooms").docs.filter((d) => d.code === "1111").length, 1);
});

test("two instances racing for the same code: only one gets it", async () => {
  // Both draw 2468 first. The first upsert wins; the second sees the doc and draws again.
  forceCodes("2468", "2468", "1357");
  const [a, b] = await Promise.all([create("p_a"), create("p_b")]);
  assert.notEqual(a.code, b.code);
  assert.deepEqual([a.code, b.code].sort(), ["1357", "2468"]);
  assert.equal((await loadSnap("2468"))?.hostId, "p_a");
  assert.equal((await loadSnap("1357"))?.hostId, "p_b");
});

test("many concurrent creates: every code distinct, one liveRooms doc each", async () => {
  const rooms = await Promise.all(Array.from({ length: 200 }, (_, i) => create(`p_${i}`)));
  const codes = new Set(rooms.map((r) => r.code));
  assert.equal(codes.size, 200);
  assert.equal(db.collection("liveRooms").docs.length, 200);
});

test("a leftover snapshot of an ended room is skipped, not merged into", async () => {
  const ended = draftRoom("duet", "3030");
  ended.status = "results";
  ended.settled = true;
  await db.collection("liveRooms").insertOne(snapFromRoom(ended));
  forceCodes("3030", "4040");
  const room = await create();
  assert.equal(room.code, "4040");
  assert.equal(room.mode, "ranked");
  assert.equal(room.status, "lobby");
});

test("a lost upsert race (E11000) counts as taken", async () => {
  const col = db.collection("liveRooms");
  const real = col.updateOne.bind(col);
  let first = true;
  col.updateOne = (async (...args: Parameters<typeof real>) => {
    if (first) {
      first = false;
      throw Object.assign(new Error("E11000 duplicate key"), { code: 11000 });
    }
    return real(...args);
  }) as typeof col.updateOne;
  forceCodes("6060", "7070");
  const room = await create();
  assert.equal(room.code, "7070");
});

test("Mongo down: falls back to a local code instead of failing room:create", async () => {
  const col = db.collection("liveRooms");
  col.updateOne = (async () => {
    throw new Error("connection reset");
  }) as typeof col.updateOne;
  const origError = console.error;
  console.error = () => {};
  try {
    const room = await create();
    assert.match(room.code, /^\d{4}$/);
    assert.equal(getRoom(room.code), room);
    assert.equal(room.isPrivate, true);
  } finally {
    console.error = origError;
  }
});

test("reserveExactCode: the first claim wins, the second instance joins that room", async () => {
  const mine = draftRoom("chaos", "8080");
  assert.equal(await reserveExactCode(mine), true);
  assert.equal(await reserveExactCode(draftRoom("chaos", "8080")), false);
  // The loser builds the winner's room from its snapshot (what chaos:join does).
  assert.equal(getRoom("8080"), undefined);
  const theirs = await ensureRoom("8080");
  assert.ok(theirs);
  made.push(theirs);
  assert.equal(theirs.mode, "chaos");
});

test("an unknown code still resolves to no room (join semantics unchanged)", async () => {
  forceCodes("9090");
  await create();
  assert.equal(await ensureRoom("9191"), undefined);
});
