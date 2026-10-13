/**
 * Accounts are required to play and the server fails closed: no Supabase
 * config means no play, and the AUTH_REQUIRED=0 dev opt-out is ignored in
 * production.
 *
 * Run: MONGODB_URI= npx tsx --test server/src/auth.test.ts
 */
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { Request } from "express";
import {
  authMode,
  devOptOutAllowed,
  httpAccount,
  httpIdentity,
  clearSocketAuth,
  helloAuth,
  helloNeedsVerify,
  ProactiveReverifyMs,
  refreshSocketAuth,
  SocketAuthOutageGraceMs,
  verifyAccessTokenOutcome,
  RejectedTokenCacheMax,
  rejectedTokenCacheSize,
  resolveAuthMode,
  setAuthConfigForTests,
  SocketAuthGraceMs,
  socketAuthExpired,
  socketIdentity,
  verifyAccessToken,
} from "./auth.ts";
import { publicPlayerId } from "./publicId.ts";

const KEYS = ["NODE_ENV", "AUTH_REQUIRED", "VITE_AUTH_REQUIRED", "VERCEL", "RENDER"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

function setEnv(env: Partial<Record<(typeof KEYS)[number], string>>): void {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, env);
}

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  setAuthConfigForTests(undefined);
});

const ALICE = "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const req = (headers: Record<string, string> = {}) => ({ headers }) as unknown as Request;
const sock = (authUserId: string | null) => ({ data: { authUserId } });

// ---------------------------------------------------------------------------
// Mode resolution (pure)
// ---------------------------------------------------------------------------

test("config present: accounts are verified", () => {
  assert.equal(resolveAuthMode({}, true), "verify");
  assert.equal(resolveAuthMode({ AUTH_REQUIRED: "1" }, true), "verify");
});

test("no config and no opt-out: unconfigured (refuse), never guest", () => {
  assert.equal(resolveAuthMode({}, false), "unconfigured");
  assert.equal(resolveAuthMode({ NODE_ENV: "production" }, false), "unconfigured");
  assert.equal(resolveAuthMode({ AUTH_REQUIRED: "" }, false), "unconfigured");
});

test("dev opt-out works outside production", () => {
  assert.equal(resolveAuthMode({ AUTH_REQUIRED: "0" }, false), "dev-guest");
  assert.equal(resolveAuthMode({ AUTH_REQUIRED: "0", NODE_ENV: "development" }, true), "dev-guest");
  assert.equal(resolveAuthMode({ VITE_AUTH_REQUIRED: "0" }, true), "dev-guest");
});

test("dev opt-out is ignored when NODE_ENV=production", () => {
  assert.equal(resolveAuthMode({ AUTH_REQUIRED: "0", NODE_ENV: "production" }, true), "verify");
  assert.equal(resolveAuthMode({ AUTH_REQUIRED: "0", NODE_ENV: "production" }, false), "unconfigured");
  assert.equal(devOptOutAllowed({ NODE_ENV: "production" }), false);
});

test("dev opt-out is ignored on the deploy hosts whatever NODE_ENV says", () => {
  assert.equal(resolveAuthMode({ AUTH_REQUIRED: "0", VERCEL: "1" }, false), "unconfigured");
  assert.equal(resolveAuthMode({ AUTH_REQUIRED: "0", RENDER: "true" }, true), "verify");
});

// ---------------------------------------------------------------------------
// Play paths refuse when the server cannot verify
// ---------------------------------------------------------------------------

test("production with no Supabase config refuses every play path", async () => {
  setEnv({ NODE_ENV: "production", AUTH_REQUIRED: "0" });
  setAuthConfigForTests(null);
  assert.equal(authMode(), "unconfigured");

  // Socket gate (player:hello): a claimed clientId is not enough.
  const s = socketIdentity(sock(null), ALICE);
  assert.equal(s.ok, false);
  assert.equal(!s.ok && s.code, "AUTH_UNCONFIGURED");
  // Even a socket that somehow carries a user id is refused.
  assert.equal(socketIdentity(sock(ALICE), ALICE).ok, false);

  // HTTP (score, training score, player hello, LiveKit token).
  const h = await httpIdentity(req({ authorization: "Bearer whatever" }), ALICE);
  assert.equal(h.ok, false);
  assert.equal(!h.ok && h.status, 503);
  assert.equal(!h.ok && h.code, "AUTH_UNCONFIGURED");

  // Room snapshot reads.
  const r = await httpAccount(req());
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.status, 503);
});

test("non-production with no config and no opt-out also refuses", async () => {
  setEnv({});
  setAuthConfigForTests(null);
  assert.equal(authMode(), "unconfigured");
  assert.equal(socketIdentity(sock(null), ALICE).ok, false);
  const h = await httpIdentity(req(), ALICE);
  assert.equal(!h.ok && h.status, 503);
});

test("verify mode: a signed-out socket or request cannot play", async () => {
  setEnv({ NODE_ENV: "production" });
  // Unreachable host: no token can verify, so this also covers "Supabase down".
  setAuthConfigForTests({ url: "http://127.0.0.1:9", key: "anon" });
  assert.equal(authMode(), "verify");

  const s = socketIdentity(sock(null), ALICE);
  assert.equal(!s.ok && s.code, "AUTH_REQUIRED");
  // The verified handshake id wins over any claim.
  const v = socketIdentity(sock(ALICE), "someone-else");
  assert.equal(v.ok && v.clientId, ALICE);

  const noToken = await httpIdentity(req(), ALICE);
  assert.equal(!noToken.ok && noToken.status, 401);
  const badToken = await httpIdentity(req({ authorization: "Bearer not-a-real-token" }), ALICE);
  assert.equal(!badToken.ok && badToken.status, 401);
  const snapshot = await httpAccount(req());
  assert.equal(!snapshot.ok && snapshot.status, 401);

  // Public ids are the account ids outside the dev opt-out.
  assert.equal(publicPlayerId(ALICE), ALICE);
});

test("dev opt-out (non-production) restores guest play for local testing", async () => {
  setEnv({ AUTH_REQUIRED: "0" });
  setAuthConfigForTests(null);
  assert.equal(authMode(), "dev-guest");
  const s = socketIdentity(sock(null), ALICE);
  assert.equal(s.ok && s.clientId, ALICE);
  const h = await httpIdentity(req(), ALICE);
  assert.equal(h.ok && h.clientId, ALICE);
  assert.equal((await httpAccount(req())).ok, true);
  assert.notEqual(publicPlayerId(ALICE), ALICE, "guest ids stay hashed");
});

test("dev opt-out set in production is ignored: still refused", async () => {
  setEnv({ AUTH_REQUIRED: "0", NODE_ENV: "production" });
  setAuthConfigForTests({ url: "http://127.0.0.1:9", key: "anon" });
  assert.equal(authMode(), "verify");
  assert.equal(socketIdentity(sock(null), ALICE).ok, false);
  const h = await httpIdentity(req(), ALICE);
  assert.equal(!h.ok && h.status, 401);
});

// ---------------------------------------------------------------------------
// Healing a socket whose handshake token was missing or stale
// ---------------------------------------------------------------------------

function stubFetch(responses: Array<() => Promise<Response>>): { calls: number; restore: () => void } {
  const original = globalThis.fetch;
  const state = { calls: 0, restore: () => (globalThis.fetch = original) };
  globalThis.fetch = (async () => {
    const next = responses[Math.min(state.calls, responses.length - 1)];
    state.calls++;
    return next();
  }) as typeof fetch;
  return state;
}
const okUser = (id: string) => async () => new Response(JSON.stringify({ id }), { status: 200 });

/** A JWT-shaped token (unsigned; Supabase is stubbed) expiring `expInSec` from now. */
function fakeJwt(tag: string, expInSec = 3600, nowMs = Date.now()): string {
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${enc({ alg: "HS256" })}.${enc({ sub: tag, exp: Math.floor(nowMs / 1000) + expInSec })}.c2ln`;
}

test("hello with a fresh token heals a socket that was not verified at handshake", async () => {
  setEnv({ NODE_ENV: "production" });
  setAuthConfigForTests({ url: "https://example.supabase.co", key: "anon" });
  const f = stubFetch([okUser(ALICE)]);
  try {
    const s = sock(null);
    assert.equal(socketIdentity(s, ALICE).ok, false);
    await refreshSocketAuth(s, fakeJwt("fresh-1"));
    const who = socketIdentity(s, "anything");
    assert.deepEqual(who, { ok: true, clientId: ALICE });
  } finally {
    f.restore();
  }
});

test("a rejected token does not authorise the socket", async () => {
  setEnv({ NODE_ENV: "production" });
  setAuthConfigForTests({ url: "https://example.supabase.co", key: "anon" });
  const f = stubFetch([async () => new Response("{}", { status: 401 })]);
  try {
    const s = sock(null);
    await refreshSocketAuth(s, fakeJwt("rejected-2"));
    assert.equal(socketIdentity(s, ALICE).ok, false);
    assert.equal(f.calls, 1, "a 401 is final: no retry");
  } finally {
    f.restore();
  }
});

test("a network blip or 5xx at Supabase is retried once", async () => {
  setEnv({ NODE_ENV: "production" });
  setAuthConfigForTests({ url: "https://example.supabase.co", key: "anon" });
  const f = stubFetch([async () => new Response("", { status: 503 }), okUser(ALICE)]);
  try {
    assert.equal(await verifyAccessToken(fakeJwt("blip-3")), ALICE);
    assert.equal(f.calls, 2);
  } finally {
    f.restore();
  }
  const g = stubFetch([async () => { throw new TypeError("fetch failed"); }, okUser(ALICE)]);
  try {
    assert.equal(await verifyAccessToken(fakeJwt("blip-4")), ALICE);
    assert.equal(g.calls, 2);
  } finally {
    g.restore();
  }
});

test("refreshSocketAuth does nothing outside verify mode or without a token", async () => {
  setEnv({ AUTH_REQUIRED: "0" });
  setAuthConfigForTests(null);
  const s = sock(null);
  await refreshSocketAuth(s, "whatever");
  assert.equal(s.data.authUserId, null);
  setEnv({ NODE_ENV: "production" });
  setAuthConfigForTests({ url: "https://example.supabase.co", key: "anon" });
  await refreshSocketAuth(s, undefined);
  assert.equal(s.data.authUserId, null);
});

// ---------------------------------------------------------------------------
// Verification amplification (audit #8): local screen + negative cache
// ---------------------------------------------------------------------------

test("tokens that cannot be Supabase JWTs are refused without a network call", async () => {
  setEnv({ NODE_ENV: "production" });
  setAuthConfigForTests({ url: "https://example.supabase.co", key: "anon" });
  const f = stubFetch([okUser(ALICE)]);
  try {
    for (const t of ["garbage", "a.b", "x".repeat(200), "a.b.c.d", fakeJwt("old", -3600)]) {
      assert.equal(await verifyAccessToken(t), null, t.slice(0, 20));
    }
    // No `exp` claim at all.
    const noExp = `${Buffer.from("{}").toString("base64url")}.${Buffer.from('{"sub":"x"}').toString("base64url")}.sig`;
    assert.equal(await verifyAccessToken(noExp), null);
    assert.equal(f.calls, 0);
  } finally {
    f.restore();
  }
});

test("a token Supabase rejected (4xx) is not re-checked for a minute", async () => {
  setEnv({ NODE_ENV: "production" });
  setAuthConfigForTests({ url: "https://example.supabase.co", key: "anon" });
  const f = stubFetch([async () => new Response("{}", { status: 403 })]);
  try {
    const bad = fakeJwt("revoked-5");
    for (let i = 0; i < 10; i++) assert.equal(await verifyAccessToken(bad), null);
    assert.equal(f.calls, 1, "one Supabase call for ten attempts");
    assert.equal(rejectedTokenCacheSize(), 1);
    // A different token is still checked.
    assert.equal(await verifyAccessToken(fakeJwt("revoked-6")), null);
    assert.equal(f.calls, 2);
  } finally {
    f.restore();
  }
});

test("network errors and 5xx are never negatively cached", async () => {
  setEnv({ NODE_ENV: "production" });
  setAuthConfigForTests({ url: "https://example.supabase.co", key: "anon" });
  const token = fakeJwt("flaky-7");
  const f = stubFetch([async () => new Response("", { status: 502 })]);
  try {
    assert.equal(await verifyAccessToken(token), null);
    assert.equal(f.calls, 2, "retried once");
  } finally {
    f.restore();
  }
  assert.equal(rejectedTokenCacheSize(), 0);
  const g = stubFetch([async () => { throw new TypeError("fetch failed"); }]);
  try {
    assert.equal(await verifyAccessToken(token), null);
  } finally {
    g.restore();
  }
  assert.equal(rejectedTokenCacheSize(), 0);
  const h = stubFetch([okUser(ALICE)]);
  try {
    assert.equal(await verifyAccessToken(token), ALICE, "Supabase back: the same token now verifies");
    assert.equal(h.calls, 1);
  } finally {
    h.restore();
  }
});

test("the negative cache is bounded", async () => {
  setEnv({ NODE_ENV: "production" });
  setAuthConfigForTests({ url: "https://example.supabase.co", key: "anon" });
  const f = stubFetch([async () => new Response("{}", { status: 401 })]);
  try {
    for (let i = 0; i < RejectedTokenCacheMax + 50; i++) await verifyAccessToken(fakeJwt(`spray-${i}`));
    assert.equal(rejectedTokenCacheSize(), RejectedTokenCacheMax);
  } finally {
    f.restore();
  }
});

// ---------------------------------------------------------------------------
// Socket auth expiry (audit #19)
// ---------------------------------------------------------------------------

test("a verified socket records its token expiry and lapses after exp + grace", async () => {
  setEnv({ NODE_ENV: "production" });
  setAuthConfigForTests({ url: "https://example.supabase.co", key: "anon" });
  const f = stubFetch([okUser(ALICE)]);
  try {
    const s: { data: { authUserId: string | null; authExpMs?: number } } = { data: { authUserId: null } };
    await refreshSocketAuth(s, fakeJwt("exp-8", 600));
    assert.equal(s.data.authUserId, ALICE);
    const exp = s.data.authExpMs ?? 0;
    assert.ok(Math.abs(exp - (Date.now() + 600_000)) < 2000, "exp comes from the token");
    assert.equal(socketAuthExpired(s), false);
    assert.equal(socketAuthExpired(s, exp + SocketAuthGraceMs - 1), false, "grace period");
    assert.equal(socketAuthExpired(s, exp + SocketAuthGraceMs + 1), true);
    clearSocketAuth(s);
    assert.equal(socketIdentity(s, ALICE).ok, false, "a cleared socket must re-verify");
  } finally {
    f.restore();
  }
});

test("an expired socket heals with a fresh token sent with hello", async () => {
  setEnv({ NODE_ENV: "production" });
  setAuthConfigForTests({ url: "https://example.supabase.co", key: "anon" });
  const f = stubFetch([okUser(ALICE)]);
  try {
    const s = { data: { authUserId: ALICE, authExpMs: Date.now() - 10 * 60_000 } };
    assert.equal(socketAuthExpired(s), true);
    await refreshSocketAuth(s, fakeJwt("fresh-9", 3600));
    assert.equal(socketAuthExpired(s), false);
    assert.equal(s.data.authUserId, ALICE);
  } finally {
    f.restore();
  }
});

test("sockets with no recorded expiry (dev opt-out, unverified) never lapse", () => {
  assert.equal(socketAuthExpired({ data: { authUserId: null } }), false);
  assert.equal(socketAuthExpired({ data: { authUserId: ALICE } }), false);
  assert.equal(socketAuthExpired({ data: {} }), false);
});

// ---------------------------------------------------------------------------
// Rate limits and timeouts at Supabase are not rejections (second-pass #6)
// ---------------------------------------------------------------------------

test("a 429 or 408 from Supabase is retried once and never negatively cached", async () => {
  setEnv({ NODE_ENV: "production" });
  setAuthConfigForTests({ url: "https://example.supabase.co", key: "anon" });
  for (const status of [429, 408]) {
    const token = fakeJwt(`limited-${status}`);
    const f = stubFetch([async () => new Response("{}", { status })]);
    try {
      assert.deepEqual(await verifyAccessTokenOutcome(token), { kind: "unavailable" });
      assert.equal(f.calls, 2, `${status}: retried once`);
    } finally {
      f.restore();
    }
    assert.equal(rejectedTokenCacheSize(), 0, `${status} is not cached`);
    // The burst passes: the same token verifies at once, not a minute later.
    const g = stubFetch([okUser(ALICE)]);
    try {
      assert.equal(await verifyAccessToken(token), ALICE);
      assert.equal(g.calls, 1);
    } finally {
      g.restore();
    }
  }
});

test("a 429 then a 200 inside one verification succeeds (backoff retry)", async () => {
  setEnv({ NODE_ENV: "production" });
  setAuthConfigForTests({ url: "https://example.supabase.co", key: "anon" });
  const f = stubFetch([async () => new Response("{}", { status: 429 }), okUser(ALICE)]);
  try {
    const t0 = Date.now();
    assert.equal(await verifyAccessToken(fakeJwt("burst-1")), ALICE);
    assert.equal(f.calls, 2);
    assert.ok(Date.now() - t0 >= 200, "the retry waits a moment");
  } finally {
    f.restore();
  }
});

test("only 400/401/403 are cached; other 4xx are refused without caching", async () => {
  setEnv({ NODE_ENV: "production" });
  setAuthConfigForTests({ url: "https://example.supabase.co", key: "anon" });
  for (const status of [400, 401, 403]) {
    const f = stubFetch([async () => new Response("{}", { status })]);
    try {
      assert.deepEqual(await verifyAccessTokenOutcome(fakeJwt(`bad-${status}`)), { kind: "rejected" });
      assert.equal(f.calls, 1, `${status} is final`);
    } finally {
      f.restore();
    }
  }
  assert.equal(rejectedTokenCacheSize(), 3);
  const g = stubFetch([async () => new Response("{}", { status: 404 })]);
  try {
    assert.deepEqual(await verifyAccessTokenOutcome(fakeJwt("gone-user")), { kind: "rejected" });
    assert.equal(g.calls, 1);
  } finally {
    g.restore();
  }
  assert.equal(rejectedTokenCacheSize(), 3, "a 404 is not cached");
});

// ---------------------------------------------------------------------------
// player:hello sign-in step (second-pass #7): presence is not authorisation,
// and only a definite rejection signs a socket out
// ---------------------------------------------------------------------------

type TestSock = { data: Record<string, unknown> };
const yes = () => true;
const no = () => false;

/** A socket verified with `token`, whose verified exp is then moved to `expMs`. */
async function verifiedSock(token: string, expMs: number): Promise<TestSock> {
  const f = stubFetch([okUser(ALICE)]);
  try {
    const s: TestSock = { data: { authUserId: null } };
    await refreshSocketAuth(s as never, token);
    assert.equal(s.data.authUserId, ALICE);
    s.data.authExpMs = expMs;
    return s;
  } finally {
    f.restore();
  }
}

test("hello: Supabase down while lapsed keeps the sign-in for a bounded grace", async () => {
  setEnv({ NODE_ENV: "production" });
  setAuthConfigForTests({ url: "https://example.supabase.co", key: "anon" });
  const exp = Date.now() - SocketAuthGraceMs - 5_000;
  const s = await verifiedSock(fakeJwt("held-1"), exp);
  assert.equal(socketAuthExpired(s as never), true);
  const f = stubFetch([async () => new Response("", { status: 503 })]);
  try {
    assert.equal(await helloAuth(s as never, fakeJwt("fresh-1"), yes), "kept");
    assert.equal(f.calls, 2);
  } finally {
    f.restore();
  }
  assert.equal(s.data.authUserId, ALICE, "not signed out over a blip");
  assert.equal(socketAuthExpired(s as never), false, "play events still allowed");
  assert.equal(socketIdentity(s as never, ALICE).ok, true);
  // The grace is rolling and bounded: about a minute per failed check...
  assert.equal(socketAuthExpired(s as never, Date.now() + 2 * 60_000), true);
  // ...and never past exp + SocketAuthOutageGraceMs.
  s.data.authExpMs = Date.now() - SocketAuthOutageGraceMs - 1;
  s.data.authOutageUntilMs = 0;
  const g = stubFetch([async () => { throw new TypeError("fetch failed"); }]);
  try {
    assert.equal(await helloAuth(s as never, fakeJwt("fresh-2"), yes), "lapsed");
  } finally {
    g.restore();
  }
  assert.equal(socketIdentity(s as never, ALICE).ok, false);
});

test("hello: a 429 burst or a spent verify budget is 'could not check', not a rejection", async () => {
  setEnv({ NODE_ENV: "production" });
  setAuthConfigForTests({ url: "https://example.supabase.co", key: "anon" });
  const s = await verifiedSock(fakeJwt("held-2"), Date.now() - SocketAuthGraceMs - 1_000);
  const f = stubFetch([async () => new Response("{}", { status: 429 })]);
  try {
    assert.equal(await helloAuth(s as never, fakeJwt("fresh-3"), yes), "kept");
    assert.equal(await helloAuth(s as never, fakeJwt("fresh-4"), no), "kept", "gate refused");
    assert.equal(f.calls, 2, "the refused gate made no call");
  } finally {
    f.restore();
  }
  assert.equal(socketIdentity(s as never, ALICE).ok, true);
  // Supabase is back: the next hello switches to the fresh token.
  const g = stubFetch([okUser(ALICE)]);
  try {
    const fresh = fakeJwt("fresh-5");
    assert.equal(await helloAuth(s as never, fresh, yes), "verified");
    assert.equal(s.data.authOutageUntilMs, 0);
    assert.equal(socketAuthExpired(s as never), false);
  } finally {
    g.restore();
  }
});

test("hello: a definitively rejected token signs a lapsed socket out", async () => {
  setEnv({ NODE_ENV: "production" });
  setAuthConfigForTests({ url: "https://example.supabase.co", key: "anon" });
  const s = await verifiedSock(fakeJwt("held-3"), Date.now() - SocketAuthGraceMs - 1_000);
  const f = stubFetch([async () => new Response("{}", { status: 401 })]);
  try {
    assert.equal(await helloAuth(s as never, fakeJwt("revoked-10"), yes), "rejected");
  } finally {
    f.restore();
  }
  assert.equal(socketIdentity(s as never, ALICE).ok, false);
});

test("hello: the held token, once run out, lapses without a Supabase call", async () => {
  setEnv({ NODE_ENV: "production" });
  setAuthConfigForTests({ url: "https://example.supabase.co", key: "anon" });
  const held = fakeJwt("held-4");
  const s = await verifiedSock(held, Date.now() - SocketAuthGraceMs - 1_000);
  const f = stubFetch([okUser(ALICE)]);
  try {
    assert.equal(await helloAuth(s as never, held, yes), "lapsed");
    assert.equal(f.calls, 0);
  } finally {
    f.restore();
  }
  assert.equal(socketIdentity(s as never, ALICE).ok, false);
  // No token at all: same.
  const t = await verifiedSock(fakeJwt("held-5"), Date.now() - SocketAuthGraceMs - 1_000);
  assert.equal(await helloAuth(t as never, undefined, yes), "lapsed");
  // An already-expired or malformed token is "lapsed" too, not a rejection
  // (Supabase never said no; the seat keeps its heartbeat).
  for (const junk of [fakeJwt("stale", -3600), "not-a-jwt"]) {
    const u = await verifiedSock(fakeJwt(`held-${junk.length}`), Date.now() - SocketAuthGraceMs - 1_000);
    const g = stubFetch([okUser(ALICE)]);
    try {
      assert.equal(await helloAuth(u as never, junk, yes), "lapsed");
      assert.equal(g.calls, 0);
    } finally {
      g.restore();
    }
  }
});

test("hello: during an outage grace, the old token keeps the grace; a refused one ends it", async () => {
  setEnv({ NODE_ENV: "production" });
  setAuthConfigForTests({ url: "https://example.supabase.co", key: "anon" });
  const held = fakeJwt("held-11");
  const s = await verifiedSock(held, Date.now() - SocketAuthGraceMs - 1_000);
  const f = stubFetch([async () => new Response("", { status: 502 })]);
  try {
    assert.equal(await helloAuth(s as never, fakeJwt("fresh-11"), yes), "kept");
  } finally {
    f.restore();
  }
  assert.equal(await helloAuth(s as never, held, yes), "unchanged", "still inside the grace");
  assert.equal(socketIdentity(s as never, ALICE).ok, true);
  const g = stubFetch([async () => new Response("{}", { status: 401 })]);
  try {
    assert.equal(await helloAuth(s as never, fakeJwt("fresh-12"), yes), "rejected");
  } finally {
    g.restore();
  }
  assert.equal(socketIdentity(s as never, ALICE).ok, false, "a definite rejection ends the outage grace");
});

test("hello: a different bad token while the held one is valid changes nothing", async () => {
  setEnv({ NODE_ENV: "production" });
  setAuthConfigForTests({ url: "https://example.supabase.co", key: "anon" });
  const s = await verifiedSock(fakeJwt("held-6"), Date.now() + 60_000);
  const f = stubFetch([async () => new Response("{}", { status: 401 })]);
  try {
    assert.equal(await helloAuth(s as never, fakeJwt("junk-6"), yes), "unchanged");
    assert.equal(f.calls, 1, "checked, because the held one is close to expiry");
  } finally {
    f.restore();
  }
  assert.equal(socketIdentity(s as never, ALICE).ok, true);
});

test("hello: a new token is verified ahead of expiry, not after", async () => {
  setEnv({ NODE_ENV: "production" });
  setAuthConfigForTests({ url: "https://example.supabase.co", key: "anon" });
  const held = fakeJwt("held-7");
  // Plenty of time left: a different token is not checked (no Supabase call).
  const s = await verifiedSock(held, Date.now() + ProactiveReverifyMs + 60_000);
  assert.equal(helloNeedsVerify(s as never, fakeJwt("next-7")), false);
  assert.equal(helloNeedsVerify(s as never, held), false);
  const f = stubFetch([okUser(ALICE)]);
  try {
    assert.equal(await helloAuth(s as never, fakeJwt("next-7"), yes), "unchanged");
    assert.equal(f.calls, 0);
    // Inside the window: the hello's token is checked and taken over.
    s.data.authExpMs = Date.now() + ProactiveReverifyMs - 1_000;
    assert.equal(helloNeedsVerify(s as never, held), false, "the same token is never re-checked early");
    const next = fakeJwt("next-8", 3600);
    assert.equal(await helloAuth(s as never, next, yes), "verified");
    assert.equal(f.calls, 1);
    assert.ok(Number(s.data.authExpMs) > Date.now() + 3000_000, "the new exp is held");
  } finally {
    f.restore();
  }
});

test("hello: answers synchronously unless Supabase is actually asked", async () => {
  setEnv({ NODE_ENV: "production" });
  setAuthConfigForTests({ url: "https://example.supabase.co", key: "anon" });
  const held = fakeJwt("held-sync");
  const s = await verifiedSock(held, Date.now() + 3600_000);
  // The steady heartbeat: no promise, so the session is seated before the
  // next event in the same packet runs.
  assert.equal(helloAuth(s as never, held, yes), "unchanged");
  assert.equal(helloAuth(s as never, undefined, yes), "unchanged");
  const lapsed = await verifiedSock(fakeJwt("held-sync-2"), Date.now() - SocketAuthGraceMs - 1_000);
  assert.equal(helloAuth(lapsed as never, fakeJwt("fresh-sync"), no), "kept", "budget spent: no promise either");
  const g = stubFetch([okUser(ALICE)]);
  try {
    const asked = helloAuth(lapsed as never, fakeJwt("fresh-sync-2"), yes);
    assert.ok(asked instanceof Promise, "an actual check is awaited");
    assert.equal(await asked, "verified");
  } finally {
    g.restore();
  }
});

test("hello: nothing to do outside verify mode", async () => {
  setEnv({ AUTH_REQUIRED: "0" });
  setAuthConfigForTests(null);
  const s: TestSock = { data: { authUserId: null } };
  assert.equal(await helloAuth(s as never, fakeJwt("dev"), yes), "unchanged");
});

test("dev opt-out room snapshot reader comes from X-Client-Id (or nobody)", async () => {
  setEnv({ AUTH_REQUIRED: "0" });
  setAuthConfigForTests(null);
  assert.deepEqual(await httpAccount(req({ "x-client-id": ALICE })), { ok: true, clientId: ALICE });
  assert.deepEqual(await httpAccount(req()), { ok: true, clientId: "" });
});
