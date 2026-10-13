/**
 * Gemini verdict calls and training analytics are limited per user (audit #9):
 * a looping client gets its DSP score back every time, but at most one Gemini
 * call per 15s and 30 per hour, with at most 4 calls in flight per instance.
 *
 * Run: MONGODB_URI= npx tsx --test server/src/geminiBudget.test.ts
 */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, test } from "node:test";

process.env.AUTH_REQUIRED = "0";
delete process.env.VITE_AUTH_REQUIRED;
delete process.env.NODE_ENV;
delete process.env.VERCEL;
delete process.env.RENDER;
process.env.MONGODB_URI = "";
process.env.GEMINI_API_KEY = "test-key";
process.env.POSTHOG_API_KEY = "";
process.env.VITE_PUBLIC_POSTHOG_KEY = "";

const express = (await import("express")).default;
const { registerLaneBRoutes, enrichScore } = await import("./judge.ts");
const { jsonErrors } = await import("./hardening.ts");
const {
  ConcurrencyCap,
  KeyedBudget,
  VerdictHourlyLimit,
  VerdictMaxInFlight,
  VerdictMinGapMs,
  trainingEventBudget,
  verdictBudget,
} = await import("./abuseLimits.ts");

const app = express();
app.use(express.json({ limit: "256kb" }));
registerLaneBRoutes(app);
app.use(jsonErrors);

let base = "";
let server: ReturnType<typeof app.listen>;
const realFetch = globalThis.fetch;

/** Gemini stub: counts calls; `hang` holds each call until aborted or released. */
const gemini = { calls: 0, hang: false, release: [] as Array<() => void> };

function geminiResponse(): Response {
  const text = JSON.stringify({ verdict: "Locked in on the chorus." });
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

before(async () => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.includes("generativelanguage.googleapis.com")) return realFetch(input, init);
    gemini.calls++;
    if (!gemini.hang) return geminiResponse();
    return new Promise<Response>((resolve, reject) => {
      gemini.release.push(() => resolve(geminiResponse()));
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    });
  }) as typeof fetch;
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  globalThis.fetch = realFetch;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  gemini.calls = 0;
  gemini.hang = false;
  gemini.release = [];
  verdictBudget.reset();
  trainingEventBudget.reset();
});

async function train(clientId: string, score: Record<string, unknown> = { pitch: 80, tone: 70 }) {
  const res = await realFetch(base + "/api/training/score", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId, score, songId: "creep" }),
  });
  return { status: res.status, json: (await res.json()) as any };
}

const user = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

test("KeyedBudget: one per gap, a cap per rolling hour, bounded keys", () => {
  const b = new KeyedBudget(15_000, 3, 2);
  assert.equal(b.take("a", 0), true);
  assert.equal(b.take("a", 14_999), false, "inside the gap");
  assert.equal(b.take("a", 15_000), true);
  assert.equal(b.take("a", 30_000), true);
  assert.equal(b.take("a", 45_000), false, "hourly cap of 3 reached");
  assert.equal(b.take("a", 60 * 60_000), true, "the first hit aged out of the hour");
  assert.equal(b.take("b", 0), true, "another key has its own budget");
  b.take("c", 0);
  assert.equal(b.size, 2, "least recently used key evicted");
});

test("ConcurrencyCap refuses past max instead of queueing", () => {
  const c = new ConcurrencyCap(2);
  assert.equal(c.tryEnter(), true);
  assert.equal(c.tryEnter(), true);
  assert.equal(c.tryEnter(), false);
  c.leave();
  assert.equal(c.tryEnter(), true);
  assert.equal(c.inFlight, 2);
});

test("limits are the documented ones", () => {
  assert.equal(VerdictMinGapMs, 15_000);
  assert.equal(VerdictHourlyLimit, 30);
  assert.equal(VerdictMaxInFlight, 4);
});

test("training loop: first post gets Gemini, the rest get the DSP score with no call", async () => {
  const first = await train(user(1));
  assert.equal(first.status, 200);
  assert.equal(first.json.score.source, "dsp+gemini");
  assert.equal(first.json.score.verdict, "Locked in on the chorus.");
  for (let i = 0; i < 10; i++) {
    const again = await train(user(1));
    assert.equal(again.status, 200, "over the limit is never an error");
    assert.equal(again.json.ok, true);
    assert.equal(again.json.score.source, "dsp");
    assert.equal(again.json.score.verdict, "");
    // round(0.7*80 + 0.3*70) = 77: the DSP score is always returned.
    assert.equal(again.json.score.overall, 77);
  }
  assert.equal(gemini.calls, 1);

  // Another user has their own budget.
  const other = await train(user(2));
  assert.equal(other.json.score.source, "dsp+gemini");
  assert.equal(gemini.calls, 2);
});

test("training analytics are capped per user as well", async () => {
  await train(user(3));
  // The route already spent this user's analytics slot for the next 15s.
  assert.equal(trainingEventBudget.take(user(3)), false);
  assert.equal(trainingEventBudget.take(user(4)), true);
});

test("a silent take never calls Gemini and never spends the budget", async () => {
  const silent = await train(user(5), { silence: true, pitch: 0, tone: 0 });
  assert.equal(silent.json.score.verdict, "We couldn't hear you.");
  assert.equal(gemini.calls, 0);
  const sung = await train(user(5));
  assert.equal(sung.json.score.source, "dsp+gemini");
});

test("no key configured: no call, no budget spent", async () => {
  process.env.GEMINI_API_KEY = "";
  try {
    const a = await train(user(6));
    assert.equal(a.json.score.source, "dsp");
    assert.equal(gemini.calls, 0);
  } finally {
    process.env.GEMINI_API_KEY = "test-key";
  }
  assert.equal(verdictBudget.take(user(6)), true);
});

test("at most 4 Gemini calls in flight per instance; the 5th is skipped, and hung calls time out", async () => {
  gemini.hang = true;
  const pending = [1, 2, 3, 4].map((n) => enrichScore({ pitch: 60, tone: 60 }, undefined, user(100 + n)));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(gemini.calls, 4);

  const t0 = Date.now();
  const fifth = await enrichScore({ pitch: 60, tone: 60 }, undefined, user(105));
  assert.ok(Date.now() - t0 < 500, "the 5th returns at once");
  assert.equal(fifth.source, "dsp");
  assert.equal(gemini.calls, 4, "no 5th call");
  // The skipped user was not charged: they can still get a verdict later.
  assert.equal(verdictBudget.take(user(105)), true);

  // Release two; the other two hit the 2.5s timeout and fall back.
  gemini.release[0]!();
  gemini.release[1]!();
  const done = await Promise.all(pending);
  assert.deepEqual(
    done.map((c) => c.source),
    ["dsp+gemini", "dsp+gemini", "dsp", "dsp"],
  );

  // Slots are free again.
  gemini.hang = false;
  const later = await enrichScore({ pitch: 60, tone: 60 }, undefined, user(106));
  assert.equal(later.source, "dsp+gemini");
});
