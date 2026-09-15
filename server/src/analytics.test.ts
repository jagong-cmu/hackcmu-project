/**
 * Run: MONGODB_URI= POSTHOG_API_KEY= npx tsx --test server/src/analytics.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

process.env.MONGODB_URI = "";
delete process.env.POSTHOG_API_KEY;
delete process.env.VITE_PUBLIC_POSTHOG_KEY;

const { captureEvent, getArenaStats, posthogConfigured } = await import("./analytics.ts");

test("stats are empty when Atlas is off", async () => {
  const stats = await getArenaStats();
  assert.equal(stats.ok, true);
  assert.equal(stats.mongo, false);
  assert.equal(stats.posthog, false);
  assert.equal(stats.totals.matchesRanked, 0);
  assert.equal(stats.totals.songsPlayed, 0);
  assert.deepEqual(stats.songs, []);
});

test("posthogConfigured is false without a project token", () => {
  assert.equal(posthogConfigured(), false);
});

test("captureEvent does not throw when PostHog is off", () => {
  assert.doesNotThrow(() => captureEvent("anon", "test event", { mode: "ranked" }));
});
