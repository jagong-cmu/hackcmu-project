/**
 * Short LiveKit tokens (15 min) must not strand a long session: after an
 * unexpected drop the stage rejoins with a fresh token, a few times, with
 * backoff, and never after leaving on purpose.
 *
 * Run: npx tsx --test apps/web/src/media/rejoin.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { MaxRejoins, rejoinDelayMs, rejoinOnPageShow, retryFailedConnectMs } from "./rejoin.ts";

test("unexpected drops rejoin with growing, capped backoff", () => {
  const delays = Array.from({ length: MaxRejoins }, (_, i) => rejoinDelayMs(i + 1, { intentional: false }));
  assert.deepEqual(delays, [1000, 2000, 4000, 8000, 8000]);
});

test("no rejoin after we left on purpose or ran out of attempts", () => {
  assert.equal(rejoinDelayMs(1, { intentional: true }), null);
  assert.equal(rejoinDelayMs(MaxRejoins + 1, { intentional: false }), null);
  assert.equal(rejoinDelayMs(0, { intentional: false }), null);
});

test("a failed connect during a rejoin retries on the same budget", () => {
  const rejoining = { intentional: false, rejoining: true, permanent: false };
  assert.equal(retryFailedConnectMs(2, rejoining), 2000);
  assert.equal(retryFailedConnectMs(MaxRejoins, rejoining), 8000);
  assert.equal(retryFailedConnectMs(MaxRejoins + 1, rejoining), null);
});

test("a failed first connect, a permanent failure or an intentional leave never retries", () => {
  assert.equal(retryFailedConnectMs(1, { intentional: false, rejoining: false, permanent: false }), null);
  assert.equal(retryFailedConnectMs(1, { intentional: false, rejoining: true, permanent: true }), null);
  assert.equal(retryFailedConnectMs(1, { intentional: true, rejoining: true, permanent: false }), null);
});

test("only a bfcache restore rejoins on pageshow, and never after leaving on purpose", () => {
  assert.equal(rejoinOnPageShow({ persisted: true, intentional: false }), true);
  assert.equal(rejoinOnPageShow({ persisted: false, intentional: false }), false);
  assert.equal(rejoinOnPageShow({ persisted: true, intentional: true }), false);
});
