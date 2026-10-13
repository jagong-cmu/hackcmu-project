/**
 * Room safety (issue #9): block-aware matchmaking, who may remove whom, and
 * removed players staying out.
 *
 * Run: MONGODB_URI= npx tsx --test server/src/moderation.test.ts
 */
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { MaxBlockedPlayers, ReportLimit, ServerEvents, type Mode } from "@karaoke/shared";
import {
  addPlayer,
  clearTimers,
  createRoom,
  findOpenPublicChaosLounge,
  removePlayer,
} from "./rooms.ts";
import { dequeue, enqueue, type Waiting } from "./matchmaking.ts";
import { publicPlayerId } from "./publicId.ts";
import {
  addBlock,
  blockedEitherWay,
  createSafety,
  hasBlocked,
  isBannedFromRoom,
  isBannedLocal,
  kickRule,
  liveKitApiHost,
  markPrivateRoom,
  openLoungeFor,
  pairingAvoidList,
  resetSafetyForTests,
  votesNeeded,
} from "./moderation.ts";

beforeEach(() => resetSafetyForTests());

let nextCode = 7100;

// ---------------------------------------------------------------------------
// Harness: a fake index.ts around the real safety service
// ---------------------------------------------------------------------------

type Emit = { target: string; event: string; payload: unknown };

function harness(mode: Mode, ids: string[], code = String(nextCode++)) {
  const room = createRoom(mode, code);
  const sessions = new Map<string, { playerId: string; displayName: string; roomCode: string | null }>();
  for (const id of ids) {
    addPlayer(room, { id, clientId: id, displayName: id.toUpperCase(), socketId: `sock-${id}` });
    sessions.set(`sock-${id}`, { playerId: id, displayName: id.toUpperCase(), roomCode: room.code });
  }
  const emits: Emit[] = [];
  const ejected: Array<{ socketId: string; forfeit: boolean }> = [];
  const mediaKicks: Array<[string, string]> = [];
  const safety = createSafety({
    sessionOf: (socketId) => sessions.get(socketId),
    resolveRoom: async (c) => (c === room.code ? room : undefined),
    socketsOf: (playerId, c) =>
      [...sessions]
        .filter(([, s]) => s.playerId === playerId && s.roomCode === c)
        .map(([id]) => id),
    eject: (socketId, opts) => {
      ejected.push({ socketId, forfeit: opts.forfeit });
      const session = sessions.get(socketId);
      if (!session) return;
      removePlayer(room, session.playerId);
      session.roomCode = null;
    },
    broadcast: () => undefined,
    emitTo: (target, event, payload) => emits.push({ target, event, payload }),
    kickMedia: async (c, identity) => {
      mediaKicks.push([c, identity]);
    },
  });
  const seated = () => room.players.map((p) => p.id);
  return { room, safety, emits, ejected, mediaKicks, seated, sock: (id: string) => `sock-${id}` };
}

// ---------------------------------------------------------------------------
// Block-aware matchmaking
// ---------------------------------------------------------------------------

function waiter(id: string): Waiting {
  return { socketId: `q-${id}`, clientId: id, displayName: id, elo: 1000 };
}
const live = () => true;

test("matchmaker never pairs two players where the waiting one blocked the joiner", async () => {
  await addBlock(publicPlayerId("qa"), publicPlayerId("qb"));
  try {
    assert.equal(enqueue("duet", waiter("qa"), live), null);
    assert.equal(enqueue("duet", waiter("qb"), live), null, "qb must not be paired with qa");
    const match = enqueue("duet", waiter("qc"), live);
    assert.ok(match, "qc pairs with the head of the line");
    assert.deepEqual(
      match.pair.map((w) => w.clientId),
      ["qa", "qc"],
    );
    clearTimers(match.room);
  } finally {
    for (const id of ["qa", "qb", "qc"]) dequeue(`q-${id}`);
  }
});

test("matchmaker respects a block in the other direction too", async () => {
  await addBlock(publicPlayerId("rb"), publicPlayerId("ra")); // the joiner blocked the one waiting
  try {
    assert.equal(enqueue("ranked", waiter("ra"), live), null);
    assert.equal(enqueue("ranked", waiter("rb"), live), null);
    // Both still waiting, each free to meet someone else.
    const m1 = enqueue("ranked", waiter("rc"), live);
    assert.ok(m1);
    assert.deepEqual(m1.pair.map((w) => w.clientId), ["ra", "rc"]);
    const m2 = enqueue("ranked", waiter("rd"), live);
    assert.ok(m2);
    assert.deepEqual(m2.pair.map((w) => w.clientId), ["rb", "rd"]);
    clearTimers(m1.room);
    clearTimers(m2.room);
  } finally {
    for (const id of ["ra", "rb", "rc", "rd"]) dequeue(`q-${id}`);
  }
});

test("pairing avoid list covers both directions (feeds the Mongo queue)", async () => {
  await addBlock("x1", "x2");
  await addBlock("x3", "x1");
  assert.deepEqual((await pairingAvoidList("x1")).sort(), ["x2", "x3"]);
  assert.deepEqual(await pairingAvoidList("x2"), ["x1"]);
  assert.equal(blockedEitherWay("x2", "x1"), true);
  assert.equal(blockedEitherWay("x2", "x3"), false);
});

// ---------------------------------------------------------------------------
// Kick permissions (pure policy)
// ---------------------------------------------------------------------------

function rule(over: Partial<Parameters<typeof kickRule>[0]>) {
  return kickRule({
    mode: "chaos",
    isPrivate: false,
    hostId: null,
    actorId: "a",
    targetId: "t",
    seatedIds: ["a", "b", "c", "t"],
    liveIds: ["a", "b", "c", "t"],
    ...over,
  });
}

test("votes needed: strict majority of the others, never fewer than 2", () => {
  assert.equal(votesNeeded(1), 2);
  assert.equal(votesNeeded(2), 2);
  assert.equal(votesNeeded(3), 2);
  assert.equal(votesNeeded(4), 3);
  assert.equal(votesNeeded(9), 5);
});

test("kick rules per mode", () => {
  // Private room host: immediate kick in every mode.
  for (const mode of ["ranked", "duet", "chaos"] as const) {
    const d = rule({ mode, isPrivate: true, hostId: "a", seatedIds: ["a", "t"], liveIds: ["a", "t"] });
    assert.equal(d.kind, "kick", mode);
  }
  // Ranked/Duet, not host (public match, or the guest in a private room): no kick.
  for (const over of [
    { mode: "ranked" as const },
    { mode: "duet" as const },
    { mode: "ranked" as const, isPrivate: true, hostId: "t" },
  ]) {
    const d = rule({ ...over, seatedIds: ["a", "t"], liveIds: ["a", "t"] });
    assert.equal(d.kind, "deny");
  }
  // Public Chaos: vote.
  const vote = rule({});
  assert.deepEqual(vote, { kind: "vote", needed: 2 });
  // Private Chaos, not host: still a vote.
  assert.equal(rule({ isPrivate: true, hostId: "b" }).kind, "vote");
  // Chaos with one other person: nobody can be voted out alone.
  assert.equal(rule({ seatedIds: ["a", "t"], liveIds: ["a", "t"] }).kind, "deny");
  // Never yourself, never someone not here, never from outside the room.
  assert.equal(rule({ targetId: "a" }).kind, "deny");
  assert.equal(rule({ targetId: "ghost" }).kind, "deny");
  assert.equal(rule({ actorId: "outsider" }).kind, "deny");
});

// ---------------------------------------------------------------------------
// Removal end to end through the service
// ---------------------------------------------------------------------------

test("chaos vote-kick removes, bans, drops LiveKit, and blocks rejoin", async () => {
  const h = harness("chaos", ["a", "b", "c", "t"]);
  try {
    const first = await h.safety.kick(h.sock("a"), { targetId: "t" });
    assert.equal(first.ok, true);
    assert.equal(first.removed, false);
    assert.deepEqual(first.votes, { count: 1, needed: 2 });
    // Voting twice does not count twice.
    const again = await h.safety.kick(h.sock("a"), { targetId: "t" });
    assert.deepEqual(again.votes, { count: 1, needed: 2 });
    assert.ok(h.seated().includes("t"));

    const second = await h.safety.kick(h.sock("b"), { targetId: "t" });
    assert.equal(second.removed, true);
    assert.ok(!h.seated().includes("t"), "t is out of the room");
    assert.deepEqual(h.ejected, [{ socketId: "sock-t", forfeit: false }]);
    assert.deepEqual(h.mediaKicks, [[h.room.code, "t"]]);
    assert.ok(
      h.emits.some((e) => e.target === "sock-t" && e.event === ServerEvents.safetyRemoved),
      "t is told they were removed",
    );

    // The ban check the token endpoint and join handlers use.
    assert.equal(await isBannedFromRoom(h.room.code, "t"), true);
    assert.equal(isBannedLocal(h.room.code, "t"), true);
    assert.equal(await isBannedFromRoom(h.room.code, "a"), false);
    assert.equal(await isBannedFromRoom(String(nextCode + 500), "t"), false, "only that room");
  } finally {
    clearTimers(h.room);
  }
});

test("only the host kicks in a private room; the guest cannot", async () => {
  const h = harness("ranked", ["host", "guest"]);
  markPrivateRoom(h.room, "host");
  h.room.status = "turnA";
  h.room.matchStartedAtMs = Date.now() - 10_000;
  try {
    const denied = await h.safety.kick(h.sock("guest"), { targetId: "host" });
    assert.equal(denied.ok, false);
    assert.ok(h.seated().includes("host"));

    const ok = await h.safety.kick(h.sock("host"), { targetId: "guest" });
    assert.equal(ok.ok, true);
    assert.equal(ok.removed, true);
    assert.deepEqual(h.seated(), ["host"]);
    assert.equal(h.room.status, "lobby", "the match ends, no rating change");
    assert.deepEqual(h.ejected, [{ socketId: "sock-guest", forfeit: false }]);
    assert.equal(await isBannedFromRoom(h.room.code, "guest"), true);
    assert.equal(await isBannedFromRoom(h.room.code, "host"), false);
  } finally {
    clearTimers(h.room);
  }
});

test("public 1v1: no kick; block or report unlocks a no-penalty leave", async () => {
  const h = harness("duet", ["me", "opp"]);
  h.room.status = "live";
  try {
    assert.equal((await h.safety.kick(h.sock("me"), { targetId: "opp" })).ok, false);
    const early = await h.safety.leave(h.sock("me"));
    assert.equal(early.ok, false, "a plain leave still goes through the forfeit path");
    assert.equal(h.ejected.length, 0);

    const blocked = await h.safety.block(h.sock("me"), { targetId: "opp" });
    assert.equal(blocked.ok, true);
    assert.equal(blocked.canLeave, true);
    assert.equal(hasBlocked("me", "opp"), true);

    const left = await h.safety.leave(h.sock("me"));
    assert.equal(left.ok, true);
    assert.deepEqual(h.ejected, [{ socketId: "sock-me", forfeit: false }]);
    assert.equal(h.room.status, "lobby");
    assert.ok(
      h.emits.some((e) => e.target === h.room.code && e.event === ServerEvents.safetyNotice),
      "the opponent hears the match ended",
    );
    // Leaving is not a kick: nobody is banned.
    assert.equal(await isBannedFromRoom(h.room.code, "opp"), false);
    assert.equal(await isBannedFromRoom(h.room.code, "me"), false);
  } finally {
    clearTimers(h.room);
  }
});

test("a removed player is skipped by the public Chaos auto-pick", async () => {
  const h = harness("chaos", ["a", "b", "c", "t"], "chaos-1");
  try {
    assert.equal(findOpenPublicChaosLounge().code, "chaos-1");
    await h.safety.kick(h.sock("a"), { targetId: "t" });
    await h.safety.kick(h.sock("b"), { targetId: "t" });
    assert.equal(isBannedLocal("chaos-1", "t"), true);
    const pick = openLoungeFor("t");
    assert.notEqual(pick.code, "chaos-1");
    assert.equal(openLoungeFor("someone-else").code, "chaos-1");
    clearTimers(pick);
  } finally {
    clearTimers(h.room);
  }
});

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

test("reports validate, de-duplicate, rate-limit, and can block in one tap", async () => {
  const ids = ["r", ...Array.from({ length: ReportLimit + 2 }, (_, i) => `p${i}`)];
  const h = harness("chaos", ids);
  try {
    const bad = await h.safety.report(h.sock("r"), { targetId: "p0", reason: "nope" });
    assert.equal(bad.ok, false);
    const self = await h.safety.report(h.sock("r"), { targetId: "r", reason: "spam" });
    assert.equal(self.ok, false);

    const first = await h.safety.report(h.sock("r"), {
      targetId: "p0",
      reason: "harassment",
      note: "x".repeat(1000),
      block: true,
    });
    assert.equal(first.ok, true);
    assert.equal(hasBlocked("r", "p0"), true);
    const dup = await h.safety.report(h.sock("r"), { targetId: "p0", reason: "spam" });
    assert.equal(dup.ok, true);
    assert.match(dup.message, /Already reported/);

    for (let i = 1; i < ReportLimit; i++) {
      const ok = await h.safety.report(h.sock("r"), { targetId: `p${i}`, reason: "spam" });
      assert.equal(ok.ok, true, `report ${i}`);
    }
    const limited = await h.safety.report(h.sock("r"), { targetId: `p${ReportLimit}`, reason: "spam" });
    assert.equal(limited.ok, false, "rate limited after ReportLimit");
  } finally {
    clearTimers(h.room);
  }
});

test("LiveKit API host is the https twin of the ws URL", () => {
  assert.equal(liveKitApiHost("wss://x.livekit.cloud"), "https://x.livekit.cloud");
  assert.equal(liveKitApiHost("ws://localhost:7880"), "http://localhost:7880");
});

test("a player can block at most MaxBlockedPlayers people", async () => {
  const h = harness("chaos", ["me", "next", "old0"]);
  try {
    for (let i = 0; i < MaxBlockedPlayers; i += 1) await addBlock("me", `old${i}`);
    const denied = await h.safety.block(h.sock("me"), { targetId: "next" });
    assert.equal(denied.ok, false);
    assert.match(denied.message ?? "", /up to 10/);
    assert.equal(hasBlocked("me", "next"), false);
    // Re-blocking someone already blocked is not a new block.
    assert.equal((await h.safety.block(h.sock("me"), { targetId: "old0" })).ok, true);
  } finally {
    clearTimers(h.room);
  }
});
