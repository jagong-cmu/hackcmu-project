/**
 * Short LiveKit tokens (15 min) must not strand a long session: after an
 * unexpected drop the stage rejoins with a fresh token, a few times, with
 * backoff, and never after leaving on purpose.
 *
 * Run: npx tsx --test apps/web/src/media/rejoin.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { MaxRejoins, rejoinDelayMs } from "./rejoin.ts";

test("unexpected drops rejoin with growing, capped backoff", () => {
  const delays = Array.from({ length: MaxRejoins }, (_, i) => rejoinDelayMs(i + 1, { intentional: false }));
  assert.deepEqual(delays, [1000, 2000, 4000, 8000, 8000]);
});

test("no rejoin after we left on purpose or ran out of attempts", () => {
  assert.equal(rejoinDelayMs(1, { intentional: true }), null);
  assert.equal(rejoinDelayMs(MaxRejoins + 1, { intentional: false }), null);
  assert.equal(rejoinDelayMs(0, { intentional: false }), null);
});
