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
  createWindowGate,
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
