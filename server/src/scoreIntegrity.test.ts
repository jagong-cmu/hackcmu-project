/**
 * Turn scores are the server's: overall recomputed from pitch/tone, one card
 * per seat per match, only once that seat's clip is over, never after
 * settlement, never for an older match.
 *
 * Run: MONGODB_URI= npx tsx --test server/src/scoreIntegrity.test.ts
 */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";

process.env.AUTH_REQUIRED = "0";
delete process.env.VITE_AUTH_REQUIRED;
delete process.env.NODE_ENV;
delete process.env.VERCEL;
delete process.env.RENDER;
process.env.MONGODB_URI = "";
process.env.GEMINI_API_KEY = "";
process.env.POSTHOG_API_KEY = "";
process.env.VITE_PUBLIC_POSTHOG_KEY = "";

const express = (await import("express")).default;
const { ServerEvents } = await import("@karaoke/shared");
const { registerScoreRoute } = await import("./scoreRoute.ts");
const { jsonErrors } = await import("./hardening.ts");
const { addPlayer, clearTimers, createRoom, removePlayer } = await import("./rooms.ts");
const { publicPlayerId } = await import("./publicId.ts");
const { ScoreEarlyGraceMs, scoreRejection } = await import("./clock.ts");

type Room = ReturnType<typeof createRoom>;

const ALICE = "21111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BOB = "22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const A = publicPlayerId(ALICE);
const B = publicPlayerId(BOB);
const CLIP_SEC = 20;
const MATCH = 1_700_000_000_000;

const emitted: Array<{ room: string; event: string; payload: any }> = [];
const io = {
  to(room: string) {
    return {
      emit(event: string, payload: unknown) {
        emitted.push({ room, event, payload });
      },
    };
  },
};

const app = express();
app.use(express.json({ limit: "256kb" }));
registerScoreRoute(app, io as never);
app.use(jsonErrors);

let base = "";
let server: ReturnType<typeof app.listen>;
const made: Room[] = [];
let nextCode = 7600;

before(async () => {
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  for (const r of made) clearTimers(r);
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/**
 * Two seated singers (Alice = seat 0 / turnA, Bob = seat 1 / turnB) in `status`,
 * with the current clip ending `clipEndsInMs` from now (server clock).
 */
function roomIn(
  status: Room["status"],
  opts: { mode?: "ranked" | "duet"; clipEndsInMs?: number } = {},
): Room {
  const room = createRoom(opts.mode ?? "ranked", String(nextCode++));
  addPlayer(room, { id: A, clientId: ALICE, displayName: "Alice", socketId: "sock-a" });
  addPlayer(room, { id: B, clientId: BOB, displayName: "Bob", socketId: "sock-b" });
  room.songId = "creep";
  room.status = status;
  room.matchId = status === "lobby" ? null : MATCH;
  room.clipDurationSec = CLIP_SEC;
  room.playAtUnixMs =
    status === "results" || status === "lobby"
      ? null
      : Date.now() + (opts.clipEndsInMs ?? 0) - CLIP_SEC * 1000;
  made.push(room);
  return room;
}

const card = (pitch: number, tone: number, overall = 99) => ({ overall, pitch, tone, silence: false });

async function postScore(
  room: Room,
  clientId: string,
  score: unknown,
  extra: Record<string, unknown> = {},
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${base}/api/turns/${room.code}/score`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId, score, ...extra }),
  });
  return { status: res.status, json: await res.json() };
}

async function expectRefused(p: Promise<{ status: number; json: any }>, code: string, label: string) {
  const { status, json } = await p;
  assert.equal(status, 409, `${label}: status`);
  assert.equal(json.code, code, `${label}: code`);
}

const settle = () => new Promise((r) => setTimeout(r, 30));

test("overall is recomputed from pitch and tone; the posted overall is ignored", async () => {
  const room = roomIn("results");
  const { status, json } = await postScore(room, ALICE, { overall: 100, pitch: 0, tone: 0 });
  assert.equal(status, 200);
  assert.equal(json.score.overall, 0);
  assert.equal(room.scores.get(A)?.overall, 0);

  const { json: bob } = await postScore(room, BOB, { overall: 3, pitch: 90, tone: 50, silence: false });
  assert.equal(bob.score.overall, Math.round(0.7 * 90 + 0.3 * 50));

  const silent = roomIn("results");
  const { json: s } = await postScore(silent, ALICE, { overall: 100, pitch: 100, tone: 100, silence: true });
  assert.equal(s.score.overall, 0, "a silent take stays 0");
  assert.equal(s.score.silence, true);
});

test("no score in lobby or countdown", async () => {
  await expectRefused(postScore(roomIn("lobby"), ALICE, card(80, 80)), "MATCH_NOT_STARTED", "lobby");
  await expectRefused(
    postScore(roomIn("countdown", { clipEndsInMs: 25_000 }), ALICE, card(80, 80)),
    "MATCH_NOT_STARTED",
    "countdown",
  );
});

test("ranked turnA: nobody may post until seat A's clip is over", async () => {
  const early = roomIn("turnA", { clipEndsInMs: 10_000 });
  await expectRefused(postScore(early, ALICE, card(80, 80)), "TURN_NOT_ENDED", "A mid-turn");
  await expectRefused(postScore(early, BOB, card(80, 80)), "TURN_NOT_ENDED", "B before singing");
  assert.equal(early.scores.size, 0);

  // Just past the grace line: the client flushes ~50ms before its clip end.
  const atEnd = roomIn("turnA", { clipEndsInMs: ScoreEarlyGraceMs - 500 });
  assert.equal((await postScore(atEnd, ALICE, card(80, 80))).status, 200, "A at clip end");
  await expectRefused(postScore(atEnd, BOB, card(80, 80)), "TURN_NOT_ENDED", "B still unsung");
});

test("ranked swap/turnB: seat A may post, seat B only once its clip is over", async () => {
  const swap = roomIn("swap", { clipEndsInMs: 25_000 });
  await expectRefused(postScore(swap, BOB, card(80, 80)), "TURN_NOT_ENDED", "B in swap");
  assert.equal((await postScore(swap, ALICE, card(80, 80))).status, 200, "A in swap");

  const midB = roomIn("turnB", { clipEndsInMs: 10_000 });
  assert.equal((await postScore(midB, ALICE, card(80, 80))).status, 200, "A late, in turnB");
  await expectRefused(postScore(midB, BOB, card(80, 80)), "TURN_NOT_ENDED", "B mid-turn");

  const endB = roomIn("turnB", { clipEndsInMs: 500 });
  assert.equal((await postScore(endB, BOB, card(80, 80))).status, 200, "B at clip end");
});

test("both ranked seats are accepted in the results window", async () => {
  const room = roomIn("results");
  assert.equal((await postScore(room, ALICE, card(70, 70))).status, 200);
  assert.equal((await postScore(room, BOB, card(60, 60))).status, 200);
  assert.equal(room.scores.size, 2);
});

test("a post for an older match is refused", async () => {
  const room = roomIn("results");
  await expectRefused(postScore(room, ALICE, card(80, 80), { matchId: MATCH - 30_000 }), "STALE_MATCH", "old");
  assert.equal(room.scores.size, 0);
  assert.equal((await postScore(room, ALICE, card(80, 80), { matchId: MATCH })).status, 200, "current");
  // A late retry after a rematch reset the room to lobby.
  const reset = roomIn("lobby");
  await expectRefused(postScore(reset, ALICE, card(80, 80), { matchId: MATCH }), "STALE_MATCH", "after reset");
});

test("no score after settlement", async () => {
  const room = roomIn("results");
  room.settled = true;
  await expectRefused(postScore(room, ALICE, card(80, 80)), "MATCH_SETTLED", "settled");
  assert.equal(room.scores.size, 0);
});

test("second post for a seat is refused and does not overwrite", async () => {
  const room = roomIn("results");
  assert.equal((await postScore(room, ALICE, card(40, 40))).status, 200);
  await expectRefused(postScore(room, ALICE, card(100, 100)), "SCORE_ALREADY_RECORDED", "second");
  assert.equal(room.scores.get(A)?.pitch, 40);
  assert.equal(room.scores.get(A)?.overall, 40);
});

test("duet: both seats post once the shared clip is over, not before", async () => {
  const early = roomIn("live", { mode: "duet", clipEndsInMs: 30_000 });
  await expectRefused(postScore(early, ALICE, card(80, 80)), "TURN_NOT_ENDED", "duet mid-song");
  await expectRefused(postScore(early, BOB, card(80, 80)), "TURN_NOT_ENDED", "duet mid-song B");

  const atEnd = roomIn("live", { mode: "duet", clipEndsInMs: 200 });
  assert.equal((await postScore(atEnd, ALICE, card(80, 70))).status, 200);
  assert.equal((await postScore(atEnd, BOB, card(60, 50))).status, 200);
  await settle();
  assert.equal(atEnd.settled, true, "both cards in → settled");

  const waiting = roomIn("results", { mode: "duet" });
  assert.equal((await postScore(waiting, BOB, card(60, 50))).status, 200, "duet score-wait window");
});

test("ranked outcome uses the recomputed overall, not the posted one", async () => {
  const room = roomIn("results");
  emitted.length = 0;
  // Alice claims 100 overall with weak pitch/tone; Bob claims 1 with strong ones.
  assert.equal((await postScore(room, ALICE, { overall: 100, pitch: 10, tone: 10 })).status, 200);
  assert.equal((await postScore(room, BOB, { overall: 1, pitch: 80, tone: 80 })).status, 200);
  await settle();
  assert.equal(room.settled, true);
  assert.equal(room.lastWinnerId, B);
  assert.ok(room.lastEloDelta < 0, "seat A (Alice) lost ELO");
  const over = emitted.filter((e) => e.room === room.code && e.event === ServerEvents.matchOver);
  assert.equal(over.length, 1, "one match:over");
  assert.equal(over[0]!.payload.winnerId, B);
  assert.equal(over[0]!.payload.scores[A].overall, 10);
  assert.equal(over[0]!.payload.scores[B].overall, 80);
});

test("scoreRejection: chaos and non-singers are refused", () => {
  const chaos = createRoom("chaos", String(nextCode++));
  made.push(chaos);
  chaos.status = "live";
  chaos.matchId = MATCH;
  assert.equal(scoreRejection(chaos, A)?.code, "NOT_A_SCORED_MATCH");
  const room = roomIn("results");
  assert.equal(scoreRejection(room, "p_stranger")?.code, "NOT_A_SINGER");
  assert.equal(scoreRejection(room, A), null);
});

/** The match roster startMatch records (Room.matchSeats). */
function withRoster(room: Room): Room {
  room.matchSeats = {
    matchId: room.matchId!,
    seats: room.players.map(({ id, clientId, displayName, elo }) => ({ id, clientId, displayName, elo })),
  };
  return room;
}

test("a seat that left during the score wait may still post its card (it still counts)", async () => {
  const room = withRoster(roomIn("results"));
  removePlayer(room, B); // Bob's leave was handled before his clip-end POST landed
  const posted = await postScore(room, BOB, card(70, 70));
  assert.equal(posted.status, 200, JSON.stringify(posted.json));
  assert.equal(room.scores.get(B)?.overall, 70);
  // Only the match's own seats, and only while it awaits settlement.
  const stranger = await postScore(room, "23333333-cccc-4ccc-8ccc-cccccccccccc", card(70, 70));
  assert.equal(stranger.status, 404);
  assert.equal(stranger.json.code, "PLAYER_NOT_IN_ROOM");
  const midMatch = withRoster(roomIn("turnB", { clipEndsInMs: 500 }));
  removePlayer(midMatch, B);
  assert.equal((await postScore(midMatch, BOB, card(70, 70))).status, 404, "a mid-match leave forfeits instead");
});

test("seat order is the match's: a reconnect that reorders room.players keeps each seat's window", () => {
  const room = withRoster(roomIn("swap", { clipEndsInMs: 5_000 }));
  room.players.reverse(); // Bob first, as after Alice re-seated by appending
  assert.equal(scoreRejection(room, A), null, "seat A may post from the swap on");
  assert.equal(scoreRejection(room, B)?.code, "TURN_NOT_ENDED", "seat B has not sung yet");
});
