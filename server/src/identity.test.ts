/**
 * Public player ids never leak the clientId, and LiveKit tokens only go to
 * seated players, as their public id.
 *
 * Run: MONGODB_URI= npx tsx --test server/src/identity.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { addPlayer, clearTimers, createRoom, toPublic } from "./rooms.ts";
import { decideLiveKitAccess, type RoomView } from "./livekitAccess.ts";
import { mintToken, TOKEN_TTL_SECONDS } from "./livekit.ts";
import { hashedPlayerId, publicPlayerId } from "./publicId.ts";

// Dev guest mode (the AUTH_REQUIRED=0 opt-out, non-production only) for these
// tests, whatever the local shell or .env says.
process.env.AUTH_REQUIRED = "0";
delete process.env.VITE_AUTH_REQUIRED;
delete process.env.NODE_ENV;
delete process.env.VERCEL;
delete process.env.RENDER;

const ALICE ="11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BOB = "22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const EVE = "33333333-eeee-4eee-8eee-eeeeeeeeeeee";

// ---------------------------------------------------------------------------
// Public ids
// ---------------------------------------------------------------------------

test("guest public id is stable, opaque, and not the clientId", () => {
  const a1 = hashedPlayerId(ALICE, "k");
  const a2 = hashedPlayerId(ALICE, "k");
  assert.equal(a1, a2, "stable across calls (and isolates sharing the secret)");
  assert.notEqual(a1, ALICE);
  assert.ok(!a1.includes(ALICE));
  assert.match(a1, /^p_[A-Za-z0-9_-]{22}$/);
  assert.notEqual(hashedPlayerId(BOB, "k"), a1, "different players differ");
  assert.notEqual(hashedPlayerId(ALICE, "other-secret"), a1, "keyed by the server secret");
});

test("publicPlayerId hashes in dev guest mode (AUTH_REQUIRED=0)", () => {
  assert.notEqual(publicPlayerId(ALICE), ALICE);
  assert.equal(publicPlayerId(ALICE), hashedPlayerId(ALICE));
});

test("toPublic never broadcasts clientId", () => {
  const room = createRoom("ranked", "7101");
  try {
    for (const clientId of [ALICE, BOB]) {
      addPlayer(room, {
        id: publicPlayerId(clientId),
        clientId,
        displayName: clientId.slice(0, 4),
        socketId: `sock-${clientId}`,
      });
    }
    const state = toPublic(room);
    const wire = JSON.stringify(state);
    assert.ok(!wire.includes(ALICE), "alice's clientId is not on the wire");
    assert.ok(!wire.includes(BOB), "bob's clientId is not on the wire");
    for (const p of state.players) {
      assert.equal("clientId" in p, false);
    }
    assert.deepEqual(
      state.players.map((p) => p.id),
      [publicPlayerId(ALICE), publicPlayerId(BOB)],
    );
  } finally {
    clearTimers(room);
  }
});

// ---------------------------------------------------------------------------
// LiveKit access
// ---------------------------------------------------------------------------

function roomWith(code: string, ...clientIds: string[]): RoomView {
  return {
    code,
    players: clientIds.map((clientId) => ({
      id: publicPlayerId(clientId),
      clientId,
      displayName: `name-${clientId.slice(0, 4)}`,
    })),
  };
}

test("seated player gets a token as their public id and seat name", () => {
  const room = roomWith("4821", ALICE, BOB);
  const res = decideLiveKitAccess({ code: "4821", room, clientId: ALICE });
  assert.deepEqual(res, {
    ok: true,
    roomCode: "4821",
    identity: publicPlayerId(ALICE),
    displayName: "name-1111",
  });
});

test("seated player may name their own public id as the expected identity", () => {
  const room = roomWith("4821", ALICE, BOB);
  const res = decideLiveKitAccess({
    code: "4821",
    room,
    clientId: BOB,
    requested: publicPlayerId(BOB),
  });
  assert.equal(res.ok, true);
  assert.equal(res.ok && res.identity, publicPlayerId(BOB));
});

test("token identity never comes from the request body", () => {
  const room = roomWith("4821", ALICE, BOB);
  // Alice asks to be Bob on the call.
  const res = decideLiveKitAccess({
    code: "4821",
    room,
    clientId: ALICE,
    requested: publicPlayerId(BOB),
  });
  assert.equal(res.ok, false);
  assert.equal(!res.ok && res.code, "IDENTITY_MISMATCH");
  assert.equal(!res.ok && res.status, 403);
});

test("asking for a raw clientId as identity is a mismatch", () => {
  const room = roomWith("4821", ALICE);
  const res = decideLiveKitAccess({ code: "4821", room, clientId: ALICE, requested: ALICE });
  assert.equal(!res.ok && res.code, "IDENTITY_MISMATCH");
});

test("unseated user is refused even with a valid room code", () => {
  const room = roomWith("4821", ALICE, BOB);
  const res = decideLiveKitAccess({ code: "4821", room, clientId: EVE });
  assert.equal(res.ok, false);
  assert.equal(!res.ok && res.code, "NOT_SEATED");
  assert.equal(!res.ok && res.status, 403);
});

test("unknown room gets the same answer as an unseated one (no existence oracle)", () => {
  const res = decideLiveKitAccess({ code: "9999", room: undefined, clientId: ALICE });
  const unseated = decideLiveKitAccess({ code: "1234", room: roomWith("1234", BOB), clientId: ALICE });
  assert.equal(!res.ok && res.code, "NOT_SEATED");
  assert.equal(!res.ok && res.status, 403);
  assert.deepEqual(res, unseated);
});

test("room that does not match the requested code is refused", () => {
  const res = decideLiveKitAccess({ code: "1234", room: roomWith("4321", ALICE), clientId: ALICE });
  assert.equal(!res.ok && res.code, "NOT_SEATED");
});

test("missing or malformed code is a bad request", () => {
  for (const code of [undefined, null, "", "   ", 1234, {}]) {
    const res = decideLiveKitAccess({ code, room: roomWith("4821", ALICE), clientId: ALICE });
    assert.equal(!res.ok && res.code, "BAD_REQUEST", `code=${JSON.stringify(code)}`);
    assert.equal(!res.ok && res.status, 400);
  }
});

test("chaos walk-in gets a token once chaos:join seated them", () => {
  const lounge = createRoom("chaos", "chaos-71");
  try {
    addPlayer(lounge, {
      id: publicPlayerId(EVE),
      clientId: EVE,
      displayName: "eve",
      socketId: "sock-eve",
    });
    const ok = decideLiveKitAccess({ code: "chaos-71", room: lounge, clientId: EVE });
    assert.equal(ok.ok, true);
    assert.equal(ok.ok && ok.identity, publicPlayerId(EVE));

    // Someone who only knows the lounge name, without walking in, is refused.
    const no = decideLiveKitAccess({ code: "chaos-71", room: lounge, clientId: ALICE });
    assert.equal(!no.ok && no.code, "NOT_SEATED");
  } finally {
    clearTimers(lounge);
  }
});

test("LiveKit join tokens live 15 minutes, not 2 hours (audit #5)", async () => {
  assert.equal(TOKEN_TTL_SECONDS, 15 * 60);
  const jwt = await mintToken(
    { apiKey: "key", apiSecret: "secret-secret-secret-secret-1234", wsUrl: "wss://x" },
    "4821",
    "p_abc",
    "Alice",
  );
  const claims = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString()) as {
    exp: number;
    nbf?: number;
    iat?: number;
  };
  const life = claims.exp - Math.floor(Date.now() / 1000);
  assert.ok(life > 14 * 60 && life <= 15 * 60, `token lifetime ${life}s`);
});
