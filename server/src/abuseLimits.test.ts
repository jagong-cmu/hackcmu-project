/**
 * Room-code brute force (audit #4), room snapshot reads (#12) and Supabase
 * verification amplification on player:hello (#8).
 *
 * Unit tests for the limiter, plus two real servers (index.ts in a child
 * process): one in the dev opt-out for joins and snapshots, one in verify
 * mode against a stub Supabase that counts calls.
 *
 * Run: MONGODB_URI= npx tsx --test server/src/abuseLimits.test.ts
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, test } from "node:test";
import {
  canReadRoom,
  CreateRateLimitedCode,
  createRateLimitedMessage,
  createWindowGate,
  RoomCreateLimit,
  RoomCreateWindowMs,
  WindowLimiter,
  isGuardedRoomCode,
  JoinAttemptLimiter,
  JoinFailLimit,
  joinLimitKey,
  joinRateLimitedMessage,
  RoomUnavailableCode,
} from "./abuseLimits.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const requireWeb = createRequire(path.join(repoRoot, "apps/web/package.json"));
const { io } = requireWeb("socket.io-client") as typeof import("socket.io-client");

// ---------------------------------------------------------------------------
// Pure pieces
// ---------------------------------------------------------------------------

test("only private codes are guarded; the demo room and public lounges are not", () => {
  assert.equal(isGuardedRoomCode("4821"), true);
  assert.equal(isGuardedRoomCode("0000"), false);
  assert.equal(isGuardedRoomCode("chaos-3"), false);
  assert.equal(isGuardedRoomCode(""), false);
});

test("join limiter: distinct failed codes trip a cool-down; repeats and successes are free", () => {
  const lim = new JoinAttemptLimiter(3, 60_000, 120_000);
  const k = "u:alice";
  assert.equal(lim.waitMs(k, 0), 0);
  // The Stage retries the same code every 800ms: one failure, however many tries.
  for (let i = 0; i < 50; i++) assert.equal(lim.fail(k, "1111", i * 800), false);
  assert.equal(lim.waitMs(k, 41_000), 0);
  assert.equal(lim.fail(k, "2222", 41_000), false);
  assert.equal(lim.fail(k, "3333", 42_000), true, "third distinct code starts the cool-down");
  assert.ok(lim.waitMs(k, 42_000) > 0);
  assert.equal(lim.waitMs(k, 42_000 + 119_999), 1);
  // Failures during the cool-down do not extend it.
  assert.equal(lim.fail(k, "4444", 50_000), false);
  assert.equal(lim.waitMs(k, 42_000 + 120_000), 0, "served");
  // Clean slate afterwards.
  assert.equal(lim.fail(k, "5555", 170_000), false);
  assert.equal(lim.waitMs(k, 170_000), 0);
  // Other callers are unaffected.
  assert.equal(lim.waitMs("u:bob", 42_500), 0);
});

test("join limiter: failures age out of the window", () => {
  const lim = new JoinAttemptLimiter(3, 60_000, 120_000);
  lim.fail("k", "1", 0);
  lim.fail("k", "2", 2000);
  assert.equal(lim.fail("k", "3", 61_000), false, "the first miss aged out");
  assert.equal(lim.waitMs("k", 61_000), 0);
  assert.equal(lim.fail("k", "4", 61_500), true);
});

test("join limiter memory is bounded", () => {
  const lim = new JoinAttemptLimiter(8, 60_000, 60_000, 100);
  for (let i = 0; i < 1000; i++) lim.fail(`s:${i}`, "1234", i);
  assert.ok(lim.size <= 100, `size ${lim.size}`);
  // Keys with nothing left in the window are dropped when looked at.
  const small = new JoinAttemptLimiter(8, 1000, 1000);
  small.fail("k", "1", 0);
  assert.equal(small.size, 1);
  small.waitMs("k", 5000);
  assert.equal(small.size, 0);
});

test("join limiter key: the verified account, else the socket", () => {
  assert.equal(joinLimitKey("user-1", "sock-1"), "u:user-1");
  assert.equal(joinLimitKey(null, "sock-1"), "s:sock-1");
  assert.equal(joinLimitKey(undefined, "sock-2"), "s:sock-2");
});

test("cool-down copy rounds up to whole minutes", () => {
  assert.match(joinRateLimitedMessage(1), /Wait 1 minute and/);
  assert.match(joinRateLimitedMessage(4 * 60_000 + 1), /Wait 5 minutes/);
});

test("window gate: at most N per window", () => {
  const gate = createWindowGate(5, 30_000);
  for (let i = 0; i < 5; i++) assert.equal(gate(i), true);
  assert.equal(gate(10), false);
  assert.equal(gate(29_999), false);
  assert.equal(gate(30_000), true, "first hit aged out");
});

test("room:create limiter: a burst of N is fine, N+1 waits for the oldest to age out", () => {
  const lim = new WindowLimiter(RoomCreateLimit, RoomCreateWindowMs);
  for (let i = 0; i < RoomCreateLimit; i++) assert.equal(lim.take("u:alice", 1000 + i), 0, `create ${i + 1}`);
  const wait = lim.take("u:alice", 2000);
  assert.ok(wait > 0 && wait <= RoomCreateWindowMs, `wait ${wait}`);
  assert.equal(wait, 1000 + RoomCreateWindowMs - 2000);
  // Refusals spend nothing; the window slides.
  assert.equal(lim.take("u:alice", 1000 + RoomCreateWindowMs), 0);
  assert.ok(lim.take("u:alice", 1000 + RoomCreateWindowMs) > 0);
  // Other callers are unaffected.
  assert.equal(lim.take("u:bob", 2000), 0);
  assert.match(createRateLimitedMessage(wait), /Wait 5 minutes/);
  assert.match(createRateLimitedMessage(30_000), /Wait 1 minute and/);
});

test("room:create limiter memory is bounded", () => {
  const lim = new WindowLimiter(6, 60_000, 100);
  for (let i = 0; i < 1000; i++) lim.take(`s:${i}`, i);
  assert.ok(lim.size <= 100, `size ${lim.size}`);
});

test("room snapshots: seated callers only", () => {
  const room = { players: [{ clientId: "a" }, { clientId: "b" }] };
  assert.equal(canReadRoom(room, "a"), true);
  assert.equal(canReadRoom(room, "c"), false);
  assert.equal(canReadRoom(room, ""), false, "nobody (dev opt-out without a header)");
  assert.equal(canReadRoom(undefined, "a"), false);
});

// ---------------------------------------------------------------------------
// Live server harness
// ---------------------------------------------------------------------------

type Client = {
  clientId: string;
  s: ReturnType<typeof io>;
  events: Array<{ event: string; payload: any }>;
  hello: () => Promise<void>;
  next: (pred: (e: { event: string; payload: any }) => boolean, ms?: number) => Promise<any>;
  emitAndWait: (event: string, payload: unknown, ms?: number) => Promise<{ event: string; payload: any } | null>;
};

function client(base: string, opts: { auth?: object; clientId?: string } = {}): Client {
  const clientId = opts.clientId ?? randomUUID();
  const s = io(base, { transports: ["websocket"], forceNew: true, auth: opts.auth ?? {} });
  const events: Client["events"] = [];
  s.onAny((event, payload) => events.push({ event, payload }));
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const c: Client = {
    clientId,
    s,
    events,
    hello: () =>
      new Promise((resolve) => {
        s.once("player:ok", () => resolve());
        s.emit("player:hello", { clientId, displayName: "T" });
      }),
    next: async (pred, ms = 3000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        const hit = events.find(pred);
        if (hit) return hit;
        await sleep(20);
      }
      return null;
    },
    // Emit, then wait for the first match:found or error that follows.
    emitAndWait: async (event, payload, ms = 3000) => {
      const from = events.length;
      s.emit(event, payload);
      const end = Date.now() + ms;
      while (Date.now() < end) {
        const hit = events.slice(from).find((e) => e.event === "match:found" || e.event === "error");
        if (hit) return hit;
        await sleep(20);
      }
      return null;
    },
  };
  return c;
}

async function startServer(env: Record<string, string>): Promise<{ base: string; child: ChildProcess }> {
  const port = 30_000 + Math.floor(Math.random() * 20_000);
  const child = spawn(process.execPath, ["--import", "tsx", path.join(here, "index.ts")], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(port),
      MONGODB_URI: "",
      GEMINI_API_KEY: "",
      POSTHOG_API_KEY: "",
      VITE_PUBLIC_POSTHOG_KEY: "",
      // Never touch LiveKit Cloud from tests.
      LIVEKIT_API_KEY: "",
      LIVEKIT_API_SECRET: "",
      LIVEKIT_WS_URL: "",
      VERCEL: "",
      RENDER: "",
      NODE_ENV: "test",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start:\n${out}`)), 20_000);
    const onData = (buf: Buffer) => {
      out += buf.toString();
      if (out.includes("http+socket.io on")) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout!.on("data", onData);
    child.stderr!.on("data", onData);
    child.once("exit", (code) => reject(new Error(`server exited ${code}:\n${out}`)));
  });
  return { base: `http://127.0.0.1:${port}`, child };
}

// ---------------------------------------------------------------------------
// Dev opt-out server: generic join errors, join limit, snapshot reads
// ---------------------------------------------------------------------------

describe("live server (dev opt-out)", () => {
  let base = "";
  let child: ChildProcess | null = null;
  const clients: Client[] = [];
  const mk = (opts?: Parameters<typeof client>[1]) => {
    const c = client(base, opts);
    clients.push(c);
    return c;
  };

  before(async () => {
    ({ base, child } = await startServer({ AUTH_REQUIRED: "0" }));
  });
  after(() => {
    for (const c of clients) c.s.close();
    child?.kill();
  });

  /** Create a private room; returns its code. */
  async function hostRoom(mode: "duet" | "ranked" | "chaos") {
    const host = mk();
    await host.hello();
    const found = await host.emitAndWait("room:create", { mode });
    assert.equal(found?.event, "match:found");
    return { host, code: found!.payload.code as string };
  }

  /** A 4-digit code that is not one of `taken`. */
  function freeCode(taken: Set<string>, seed: number): string {
    for (let n = seed; ; n++) {
      const code = String(1000 + (n % 9000));
      if (!taken.has(code)) {
        taken.add(code);
        return code;
      }
    }
  }

  test("missing, full and wrong-mode private rooms all get one generic error", async () => {
    const { code: duet } = await hostRoom("duet");
    const guest = mk();
    await guest.hello();
    assert.equal((await guest.emitAndWait("room:join", { code: duet }))?.event, "match:found");

    const taken = new Set([duet]);
    const prober = mk();
    await prober.hello();
    const missing = freeCode(taken, 4242);
    const a = await prober.emitAndWait("room:join", { code: missing });
    const b = await prober.emitAndWait("room:join", { code: duet }); // full
    const c = await prober.emitAndWait("chaos:join", { code: duet }); // wrong mode
    const d = await prober.emitAndWait("chaos:join", { code: missing }); // free code: opens a lounge (counted as a miss)
    for (const [label, e] of [["missing", a], ["full", b], ["wrong mode", c]] as const) {
      assert.equal(e?.event, "error", label);
      assert.equal(e?.payload.code, RoomUnavailableCode, label);
    }
    const shape = (e: any, code: string) => String(e.payload.message).replace(code, "<code>");
    assert.equal(shape(a, missing), shape(b, duet));
    assert.equal(shape(b, duet), shape(c, duet));
    // chaos:join on a free private code still opens a lounge (old behaviour).
    assert.equal(d?.event, "match:found");
  });

  test("failed private-code joins trip a cool-down; retrying one code does not", async () => {
    const { code: target } = await hostRoom("chaos"); // joinable
    const taken = new Set([target]);
    const prober = mk();
    await prober.hello();

    // The Stage's 800ms retry loop on one bad code: never limited.
    const same = freeCode(taken, 100);
    for (let i = 0; i < JoinFailLimit + 4; i++) {
      const e = await prober.emitAndWait("room:join", { code: same });
      assert.equal(e?.payload.code, RoomUnavailableCode, `retry ${i}`);
    }
    // Distinct codes: the limit-th miss starts the cool-down.
    for (let i = 1; i < JoinFailLimit; i++) {
      const e = await prober.emitAndWait("room:join", { code: freeCode(taken, 200 + i * 37) });
      assert.equal(e?.payload.code, RoomUnavailableCode, `miss ${i}`);
    }
    const limited = await prober.emitAndWait("room:join", { code: freeCode(taken, 900) });
    assert.equal(limited?.payload.code, "JOIN_RATE_LIMITED");
    // Even a real room is refused during the cool-down, before any lookup.
    const real = await prober.emitAndWait("room:join", { code: target });
    assert.equal(real?.payload.code, "JOIN_RATE_LIMITED");
    assert.match(real?.payload.message, /Too many room codes tried/);
    // chaos:join with a private code is limited too.
    const viaChaos = await prober.emitAndWait("chaos:join", { code: target });
    assert.equal(viaChaos?.payload.code, "JOIN_RATE_LIMITED");
    // Public lounges are never limited.
    const lounge = await prober.emitAndWait("chaos:join", {});
    assert.equal(lounge?.event, "match:found");
    // Another player is unaffected.
    const other = mk();
    await other.hello();
    assert.equal((await other.emitAndWait("room:join", { code: target }))?.event, "match:found");
  });

  test("successful joins never count toward the limit", async () => {
    const rooms: string[] = [];
    for (let i = 0; i < JoinFailLimit + 2; i++) rooms.push((await hostRoom("chaos")).code);
    const hopper = mk();
    await hopper.hello();
    for (const code of rooms) {
      const e = await hopper.emitAndWait("room:join", { code });
      assert.equal(e?.event, "match:found", code);
    }
  });

  test("room:create: create, leave, create again is fine; a create loop is cut off", async () => {
    const host = mk();
    await host.hello();
    const codes: string[] = [];
    for (let i = 0; i < RoomCreateLimit; i++) {
      const e = await host.emitAndWait("room:create", { mode: i % 2 ? "duet" : "ranked" });
      assert.equal(e?.event, "match:found", `create ${i + 1}`);
      codes.push(e!.payload.code);
      if (i % 2 && i < RoomCreateLimit - 1) host.s.emit("room:leave");
    }
    assert.equal(new Set(codes).size, RoomCreateLimit);
    const last = codes[codes.length - 1]!;
    const refused = await host.emitAndWait("room:create", { mode: "ranked" });
    assert.equal(refused?.event, "error");
    assert.equal(refused?.payload.code, CreateRateLimitedCode);
    assert.match(refused?.payload.message, /Wait \d+ minutes? and try again/);
    // A refused create does not pull the caller out of the room they are in.
    const res = await fetch(`${base}/api/rooms/${last}`, { headers: { "x-client-id": host.clientId } });
    assert.equal(res.status, 200, "still seated in the last room");
    // Joining a friend's code still works, and other callers can create.
    const other = mk();
    await other.hello();
    const theirs = await other.emitAndWait("room:create", { mode: "duet" });
    assert.equal(theirs?.event, "match:found");
    const joined = await host.emitAndWait("room:join", { code: theirs!.payload.code });
    assert.equal(joined?.event, "match:found");
  });

  test("GET /api/rooms/:code: seated players only, one 404 for everyone else", async () => {
    const { host, code } = await hostRoom("duet");
    const taken = new Set([code]);
    const get = async (c: string, clientId?: string) => {
      const res = await fetch(`${base}/api/rooms/${c}`, {
        headers: clientId ? { "X-Client-Id": clientId } : {},
      });
      return { status: res.status, body: (await res.json()) as { room?: { code: string }; code?: string } };
    };
    const seated = await get(code, host.clientId);
    assert.equal(seated.status, 200);
    assert.equal(seated.body.room?.code, code);

    const stranger = await get(code, randomUUID());
    const anonymous = await get(code);
    const missing = await get(freeCode(taken, 3131), host.clientId);
    assert.equal(stranger.status, 404);
    assert.deepEqual(stranger, anonymous);
    assert.deepEqual(stranger, missing, "exists-but-not-yours looks exactly like does-not-exist");
    assert.equal(JSON.stringify(stranger.body).includes(code), false);

    // A guest who just joined can read it.
    const guest = mk();
    await guest.hello();
    assert.equal((await guest.emitAndWait("room:join", { code }))?.event, "match:found");
    assert.equal((await get(code, guest.clientId)).status, 200);
    // And after leaving, cannot.
    guest.s.emit("room:leave");
    await new Promise((r) => setTimeout(r, 200));
    assert.equal((await get(code, guest.clientId)).status, 404);
  });
});

// ---------------------------------------------------------------------------
// Verify-mode server against a stub Supabase: hello verification is limited
// ---------------------------------------------------------------------------

describe("live server (accounts on, stub Supabase)", () => {
  let base = "";
  let child: ChildProcess | null = null;
  let stub: HttpServer | null = null;
  let supabaseCalls = 0;
  const clients: Client[] = [];

  const fakeJwt = (tag: string) => {
    const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    return `${enc({ alg: "HS256" })}.${enc({ sub: tag, exp: Math.floor(Date.now() / 1000) + 3600 })}.c2ln`;
  };

  before(async () => {
    stub = createServer((_req, res) => {
      supabaseCalls += 1;
      res.writeHead(401, { "content-type": "application/json" });
      res.end("{}");
    });
    await new Promise<void>((r) => stub!.listen(0, "127.0.0.1", () => r()));
    const port = (stub.address() as AddressInfo).port;
    ({ base, child } = await startServer({
      AUTH_REQUIRED: "1",
      VITE_AUTH_REQUIRED: "1",
      SUPABASE_URL: `http://127.0.0.1:${port}`,
      SUPABASE_ANON_KEY: "anon",
    }));
  });
  after(() => {
    for (const c of clients) c.s.close();
    child?.kill();
    stub?.close();
  });

  test("player:hello checks at most 5 tokens per socket per 30s; garbage never reaches Supabase", async () => {
    const c = client(base, { auth: { token: "not-a-jwt" } });
    clients.push(c);
    await new Promise((r) => c.s.once("connect", () => r(undefined)));
    supabaseCalls = 0;
    for (let i = 0; i < 12; i++) {
      c.s.emit("player:hello", { clientId: c.clientId, displayName: "T", accessToken: fakeJwt(`t${i}`) });
    }
    for (let i = 0; i < 12; i++) {
      c.s.emit("player:hello", { clientId: c.clientId, displayName: "T", accessToken: "garbage" });
    }
    const end = Date.now() + 3000;
    while (Date.now() < end && c.events.filter((e) => e.event === "error").length < 24) {
      await new Promise((r) => setTimeout(r, 25));
    }
    const errors = c.events.filter((e) => e.event === "error");
    assert.equal(errors.length, 24);
    assert.ok(errors.every((e) => e.payload.code === "AUTH_REQUIRED"));
    assert.equal(supabaseCalls, 5, "rate limited to 5 verifications");
  });

  test("a rejected token is negatively cached across requests", async () => {
    supabaseCalls = 0;
    const token = fakeJwt("http-bad");
    for (let i = 0; i < 6; i++) {
      const res = await fetch(`${base}/api/rooms/1234`, { headers: { authorization: `Bearer ${token}` } });
      assert.equal(res.status, 401);
    }
    assert.equal(supabaseCalls, 1);
  });
});

// ---------------------------------------------------------------------------
// Verify-mode server against a flaky Supabase (second-pass #6 and #7):
// rate limits are not rejections, and a lapsed sign-in never costs the seat
// ---------------------------------------------------------------------------

describe("live server (accounts on, flaky Supabase)", () => {
  let base = "";
  let child: ChildProcess | null = null;
  let stub: HttpServer | null = null;
  /** What the stub answers next: a status for every call, or 200 with the user. */
  let answer: number = 200;
  let calls = 0;
  const seenSubs: string[] = [];
  const clients: Client[] = [];

  /** sub "user:n": the user id is the part before the colon. */
  const jwt = (sub: string, expInSec = 3600) => {
    const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    return `${enc({ alg: "HS256" })}.${enc({ sub, exp: Math.floor(Date.now() / 1000) + expInSec })}.c2ln`;
  };
  const userIdOf = (sub: string) => `00000000-0000-4000-8000-${sub.split(":")[0]!.padStart(12, "0").slice(-12)}`;

  before(async () => {
    stub = createServer((req, res) => {
      calls += 1;
      const token = String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
      let sub = "";
      try {
        sub = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")).sub ?? "";
      } catch {
        /* not ours */
      }
      seenSubs.push(sub);
      if (answer !== 200) {
        res.writeHead(answer, { "content-type": "application/json" });
        res.end('{"msg":"rate limited"}');
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: userIdOf(sub) }));
    });
    await new Promise<void>((r) => stub!.listen(0, "127.0.0.1", () => r()));
    const port = (stub.address() as AddressInfo).port;
    ({ base, child } = await startServer({
      AUTH_REQUIRED: "1",
      VITE_AUTH_REQUIRED: "1",
      SUPABASE_URL: `http://127.0.0.1:${port}`,
      SUPABASE_ANON_KEY: "anon",
    }));
  });
  after(() => {
    for (const c of clients) c.s.close();
    child?.kill();
    stub?.close();
  });

  const connect = async (token: string) => {
    const c = client(base, { auth: { token } });
    clients.push(c);
    await new Promise((r) => c.s.once("connect", () => r(undefined)));
    return c;
  };
  /** Say hello with `token`; resolves with player:ok or the error that came back. */
  const hello = async (c: Client, token: string | undefined) => {
    const from = c.events.length;
    c.s.emit("player:hello", { clientId: c.clientId, displayName: "T", accessToken: token });
    const end = Date.now() + 5000;
    while (Date.now() < end) {
      const hit = c.events.slice(from).find((e) => e.event === "player:ok" || e.event === "error");
      if (hit) {
        await new Promise((r) => setTimeout(r, 150));
        return { hit, after: c.events.slice(from) };
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error("no answer to hello");
  };
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  test("a 429 burst at Supabase does not lock a valid token out", async () => {
    answer = 429;
    const token = jwt("101:burst");
    const c = await connect(token);
    const refused = await hello(c, token);
    assert.equal(refused.hit.event, "error");
    assert.equal(refused.hit.payload.code, "AUTH_REQUIRED");
    const http = await fetch(`${base}/api/rooms/1234`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(http.status, 401);
    // The burst ends: the very same token works at once (no 60s negative cache).
    answer = 200;
    const ok = await hello(c, token);
    assert.equal(ok.hit.event, "player:ok");
    const after = await fetch(`${base}/api/rooms/1234`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(after.status, 404, "signed in: just not seated there");
  });

  test("a new token is taken over before the held one expires", async () => {
    answer = 200;
    const held = jwt("102:a", 90); // inside the 2-minute window
    const c = await connect(held);
    assert.equal((await hello(c, held)).hit.event, "player:ok");
    calls = 0;
    seenSubs.length = 0;
    assert.equal((await hello(c, held)).hit.event, "player:ok");
    assert.equal(calls, 0, "the held token is never re-checked");
    assert.equal((await hello(c, jwt("102:b"))).hit.event, "player:ok");
    assert.deepEqual(seenSubs, ["102:b"], "the successor was verified ahead of expiry");
    // Supabase now down: the held token is still good, so play goes on.
    answer = 503;
    assert.equal((await hello(c, jwt("102:c"))).hit.event, "player:ok");
    const created = await c.emitAndWait("room:create", { mode: "duet" });
    assert.equal(created?.event, "match:found");
    answer = 200;
  });

  /** Seated in a fresh duet room with a token whose exp + 30s grace ran out just now. */
  const seatedThenLapsed = async (user: string) => {
    answer = 200;
    const held = jwt(`${user}:held`, -27); // exp + 30s grace ends ~3s from now
    const c = await connect(held);
    assert.equal((await hello(c, held)).hit.event, "player:ok");
    const created = await c.emitAndWait("room:create", { mode: "duet" });
    assert.equal(created?.event, "match:found");
    await sleep(3500);
    return { c, held, code: created!.payload.code as string };
  };

  test("a lapsed sign-in keeps the seat alive; play events wait for a fresh token", async () => {
    const { c, held, code } = await seatedThenLapsed("103");
    // The client could not refresh and sends its expired token (heartbeat).
    const lapsed = await hello(c, held);
    assert.equal(lapsed.hit.event, "error");
    assert.equal(lapsed.hit.payload.code, "AUTH_REQUIRED");
    assert.ok(
      lapsed.after.some((e) => e.event === "room:state" && e.payload?.code === code),
      "the seat was refreshed (lastSeenMs) and broadcast anyway",
    );
    const ready = await c.emitAndWait("room:ready", {}, 1000);
    assert.equal(ready?.payload?.code, "AUTH_REQUIRED", "no play rights without a sign-in");
    const fresh = jwt("103:fresh");
    const seated = await fetch(`${base}/api/rooms/${code}`, { headers: { authorization: `Bearer ${fresh}` } });
    assert.equal(seated.status, 200, "still seated");
    // A fresh token heals it.
    assert.equal((await hello(c, fresh)).hit.event, "player:ok");
    const again = await c.emitAndWait("room:ready", {}, 800);
    assert.notEqual(again?.payload?.code, "AUTH_REQUIRED");
  });

  test("Supabase down while lapsed: the sign-in is kept (bounded) instead of dropped", async () => {
    const { c } = await seatedThenLapsed("104");
    answer = 503;
    try {
      const kept = await hello(c, jwt("104:fresh"));
      assert.equal(kept.hit.event, "player:ok", "an outage does not sign the socket out");
      const ready = await c.emitAndWait("room:ready", {}, 800);
      assert.notEqual(ready?.payload?.code, "AUTH_REQUIRED");
    } finally {
      answer = 200;
    }
  });
});
