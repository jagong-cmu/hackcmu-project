/**
 * Crash guards and input coercion: a throwing handler answers 500 / an
 * `error` event and the process stays up; display names cannot carry bidi
 * or zero-width tricks; pitch:live is throttled and clamped.
 *
 * Run: MONGODB_URI= npx tsx --test server/src/hardening.test.ts
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import express from "express";
import {
  asyncRoute,
  cleanText,
  createRateGate,
  finiteIn,
  jsonErrors,
  memoizeFor,
  roomCodeOf,
  safeHandler,
  sanitizeDisplayName,
  sanitizePitchSample,
} from "./hardening.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Display names
// ---------------------------------------------------------------------------

test("display name: plain names pass through, trimmed and collapsed", () => {
  assert.equal(sanitizeDisplayName("  Ada   Lovelace "), "Ada Lovelace");
  assert.equal(sanitizeDisplayName("Zoë"), "Zoë");
  assert.equal(sanitizeDisplayName("歌手"), "歌手");
  assert.equal(sanitizeDisplayName("DJ 🎤"), "DJ 🎤");
});

test("display name: bidi overrides, isolates and zero-width characters are stripped", () => {
  assert.equal(sanitizeDisplayName("evil\u202Eadmin"), "eviladmin");
  assert.equal(sanitizeDisplayName("a\u200Bb\u200Cc\u200Dd\u200Ee\u200Ff"), "abcdef");
  assert.equal(sanitizeDisplayName("\u2066x\u2067y\u2068z\u2069"), "xyz");
  assert.equal(sanitizeDisplayName("\uFEFFbom"), "bom");
  assert.equal(sanitizeDisplayName("tab\tnew\nline"), "tab new line");
  assert.equal(sanitizeDisplayName("nul\u0000x"), "nul x");
});

test("display name: NFKC folds lookalike forms", () => {
  assert.equal(sanitizeDisplayName("Ｓｉｎｇｅｒ"), "Singer");
  assert.equal(sanitizeDisplayName("ﬁne"), "fine");
});

test("display name: capped at 16 characters without splitting surrogate pairs", () => {
  assert.equal(sanitizeDisplayName("x".repeat(40)), "x".repeat(16));
  const emoji = sanitizeDisplayName("🎤".repeat(20));
  assert.equal(Array.from(emoji).length, 16);
  assert.ok(!/[\uD800-\uDFFF]$/.test(emoji.slice(-1)) || emoji.endsWith("🎤"));
  // A trailing space left by the cut is trimmed.
  assert.equal(sanitizeDisplayName("abcdefghijklmno pqr"), "abcdefghijklmno");
});

test("display name: Zalgo stacks are limited", () => {
  const zalgo = "a" + "\u0301".repeat(30);
  const out = sanitizeDisplayName(zalgo);
  // NFKC composes a + U+0301 into U+00E1; at most two marks may stack on it.
  assert.ok(out.startsWith("\u00E1"), out);
  assert.ok(Array.from(out).length <= 3, `${Array.from(out).length} code points`);
});

test("display name: nothing visible, or not a string, falls back to Singer", () => {
  for (const raw of [
    "",
    "   ",
    "\u202E\u200B\u2066",
    "\u3164\u3164",
    "\u0000\u0001",
    undefined,
    null,
    42,
    {},
    { toString: 1, valueOf: 1 },
    ["Ada"],
  ]) {
    assert.equal(sanitizeDisplayName(raw), "Singer", JSON.stringify(raw));
  }
});

// ---------------------------------------------------------------------------
// Other coercion
// ---------------------------------------------------------------------------

test("cleanText is string-only, strips control/format characters, and caps length", () => {
  assert.equal(cleanText({}, 10), "");
  assert.equal(cleanText(["a"], 10), "");
  assert.equal(cleanText("a\u202Eb\u0007c", 10), "ab c");
  assert.equal(cleanText("line1\r\nline2\u200B", 50, { multiline: true }), "line1\nline2");
  assert.equal(cleanText("x".repeat(2000), 600).length, 600);
});

test("roomCodeOf and finiteIn never coerce objects", () => {
  assert.equal(roomCodeOf(" 1234 "), "1234");
  assert.equal(roomCodeOf({ toString: 1, valueOf: 1 }), "");
  assert.equal(roomCodeOf(1234), "");
  assert.equal(roomCodeOf("x".repeat(100)), "");
  assert.equal(finiteIn(5, 0, 1, 0), 1);
  assert.equal(finiteIn(Number.NaN, 0, 1, 0.5), 0.5);
  assert.equal(finiteIn("0.3", 0, 1, 0), 0);
  assert.equal(finiteIn(Infinity, 0, 1, 0), 0);
});

// ---------------------------------------------------------------------------
// pitch:live
// ---------------------------------------------------------------------------

test("pitch:live gate allows 20 per second and drops the rest", () => {
  const gate = createRateGate();
  const t0 = 1_000_000;
  let passed = 0;
  for (let i = 0; i < 100; i++) if (gate(t0 + i)) passed += 1;
  assert.equal(passed, 20, "100 messages inside one second: 20 relayed");
  assert.equal(gate(t0 + 1000), true, "the next second opens a new window");
  // A steady 10/s singer is never throttled.
  const steady = createRateGate();
  for (let i = 0; i < 50; i++) assert.equal(steady(t0 + i * 100), true);
});

test("pitch:live payload is clamped to finite, sane ranges", () => {
  assert.deepEqual(
    sanitizePitchSample({ hz: 440, clarity: 0.9, rms: 0.05, pitch: 80, tone: 70, overall: 75 }),
    { hz: 440, clarity: 0.9, rms: 0.05, pitch: 80, tone: 70, overall: 75 },
  );
  assert.deepEqual(
    sanitizePitchSample({ hz: 1e12, clarity: 1e9, rms: -4, pitch: 1e9, tone: -1, overall: Number.NaN }),
    { hz: null, clarity: 1, rms: 0, pitch: 100, tone: 0, overall: undefined },
  );
  assert.deepEqual(
    sanitizePitchSample({ hz: "440", clarity: {}, rms: [1], pitch: "9" }),
    { hz: null, clarity: 0, rms: 0, pitch: undefined, tone: undefined, overall: undefined },
  );
  for (const junk of [null, undefined, "x", 7, []]) {
    const out = sanitizePitchSample(junk);
    assert.equal(out.hz, null);
    assert.equal(out.clarity, 0);
    assert.equal(out.rms, 0);
  }
});

// ---------------------------------------------------------------------------
// asyncRoute / jsonErrors
// ---------------------------------------------------------------------------

async function withApp(
  mount: (app: express.Express) => void,
  run: (base: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json({ limit: "1kb" }));
  mount(app);
  app.use(jsonErrors);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("asyncRoute turns a rejecting handler into a 500 JSON reply, no internals", async () => {
  const errors: unknown[] = [];
  const onRejection = (r: unknown) => errors.push(r);
  process.on("unhandledRejection", onRejection);
  try {
    await withApp(
      (app) => {
        app.get("/reject", asyncRoute(async () => {
          throw new Error("secret mongo detail");
        }));
        app.get("/throw", asyncRoute(() => {
          // Same shape as `displayName.trim()` on an object.
          (({}) as { trim: () => string }).trim();
        }));
        app.get("/ok", asyncRoute(async (_req, res) => {
          res.json({ ok: true });
        }));
      },
      async (base) => {
        for (const p of ["/reject", "/throw"]) {
          const res = await fetch(base + p);
          assert.equal(res.status, 500, p);
          const text = await res.text();
          assert.ok(!text.includes("secret"), "no error message leaked");
          assert.ok(!text.includes("at "), "no stack leaked");
          assert.equal(JSON.parse(text).code, "INTERNAL");
        }
        assert.equal((await fetch(base + "/ok")).status, 200, "server still serving");
      },
    );
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(errors, [], "no unhandled rejection escaped");
  } finally {
    process.off("unhandledRejection", onRejection);
  }
});

test("jsonErrors keeps body-parser 4xx as JSON", async () => {
  await withApp(
    (app) => app.post("/x", (_req, res) => void res.json({ ok: true })),
    async (base) => {
      const bad = await fetch(base + "/x", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not json",
      });
      assert.equal(bad.status, 400);
      assert.equal(((await bad.json()) as { code?: string }).code, "BAD_REQUEST");
      const big = await fetch(base + "/x", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ x: "y".repeat(5000) }),
      });
      assert.equal(big.status, 413);
    },
  );
});

// ---------------------------------------------------------------------------
// safeHandler
// ---------------------------------------------------------------------------

test("safeHandler: a throwing or rejecting socket handler emits error INTERNAL", async () => {
  const errors: unknown[] = [];
  const onRejection = (r: unknown) => errors.push(r);
  process.on("unhandledRejection", onRejection);
  try {
    const emitted: Array<[string, unknown]> = [];
    const socket = { emit: (e: string, p: unknown) => void emitted.push([e, p]) };

    const asyncBoom = safeHandler(socket, "queue:join", async (payload: unknown) => {
      await Promise.resolve();
      (payload as { name: { trim: () => string } }).name.trim();
    });
    const syncBoom = safeHandler(socket, "room:create", () => {
      throw new Error("sync");
    });
    let ran = false;
    const fine = safeHandler(socket, "room:leave", () => {
      ran = true;
    });

    asyncBoom({ name: {} });
    syncBoom();
    fine();
    await new Promise((r) => setTimeout(r, 20));

    assert.equal(ran, true);
    assert.equal(emitted.length, 2);
    for (const [event, payload] of emitted) {
      assert.equal(event, "error");
      assert.deepEqual(Object.keys(payload as object).sort(), ["code", "message"]);
      assert.equal((payload as { code: string }).code, "INTERNAL");
    }
    assert.deepEqual(errors, [], "no unhandled rejection escaped");
  } finally {
    process.off("unhandledRejection", onRejection);
  }
});

test("safeHandler survives a socket whose emit throws", async () => {
  const socket = {
    emit: () => {
      throw new Error("closed");
    },
  };
  safeHandler(socket, "x", async () => {
    throw new Error("boom");
  })();
  await new Promise((r) => setTimeout(r, 10));
});

// ---------------------------------------------------------------------------
// Process guards
// ---------------------------------------------------------------------------

test("process guards: a stray rejection and throw are logged, the process keeps running", () => {
  const mod = path.join(here, "hardening.ts");
  const script = `
    const { installProcessGuards } = await import(${JSON.stringify(mod)});
    installProcessGuards();
    Promise.reject(new Error("stray rejection"));
    setTimeout(() => { throw new Error("stray throw"); }, 5);
    setTimeout(() => { console.log("still alive"); }, 60);
  `;
  const out = spawnSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", script],
    { encoding: "utf8", timeout: 20_000 },
  );
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /still alive/);
  assert.match(out.stderr, /unhandledRejection: Error: stray rejection/);
  assert.match(out.stderr, /uncaughtException: Error: stray throw/);
});

// ---------------------------------------------------------------------------
// memoizeFor (/api/stats cache)
// ---------------------------------------------------------------------------

test("memoizeFor serves one result per TTL and shares the in-flight call", async () => {
  let clock = 0;
  let calls = 0;
  const get = memoizeFor(60_000, async () => ++calls, () => clock);
  const [a, b] = await Promise.all([get(), get()]);
  assert.equal(a, 1);
  assert.equal(b, 1);
  clock = 59_999;
  assert.equal(await get(), 1);
  assert.equal(calls, 1);
  clock = 60_000;
  assert.equal(await get(), 2);

  let fail = true;
  const flaky = memoizeFor(60_000, async () => {
    if (fail) throw new Error("db down");
    return "ok";
  });
  await assert.rejects(flaky());
  fail = false;
  assert.equal(await flaky(), "ok", "a rejection is not cached");
});
