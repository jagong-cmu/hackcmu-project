/**
 * Open-redirect gate for `?next=` and the post-sign-in stash.
 *
 * Run: npx tsx --test apps/web/src/lib/safeNext.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { safeAuthNext as authSafeNext, safeNextPath } from "./safeNext.ts";
import { safeNext as checkSafeNext } from "../onboarding/deviceCheck.ts";
import { EmptyOnboarding, postSignInPath } from "../onboarding/onboardingState.ts";

const BASE = "https://karaoke-arena.vercel.app";
const FB = "/fallback";

const rejected = [
  "/\\evil.com",
  "/%5Cevil.com",
  "/%5cevil.com",
  "\\\\evil.com",
  "//evil.com",
  "///evil.com",
  "/%2F%2Fevil.com",
  "/%2fevil.com",
  "/\t/evil.com",
  "/%09/evil.com",
  "/\n/evil.com",
  "/%0A/evil.com",
  "/%0d%0a/evil.com",
  "/\r/evil.com",
  "/%00/evil.com",
  "/%7F/evil.com",
  "/\x7f/evil.com",
  " /evil",
  "https://evil.com",
  "http:evil.com",
  "javascript:alert(1)",
  "JavaScript:alert(1)",
  "data:text/html,hi",
  "evil.com",
  "%2F%2Fevil.com",
  "/%E0%A4%A", // malformed percent-encoding
  "",
];

for (const raw of rejected) {
  test(`rejects ${JSON.stringify(raw)}`, () => {
    assert.equal(safeNextPath(raw, FB, BASE), FB);
  });
}

test("rejects null / undefined", () => {
  assert.equal(safeNextPath(null, FB, BASE), FB);
  assert.equal(safeNextPath(undefined, FB, BASE), FB);
});

test("allows plain same-origin paths and keeps search + hash", () => {
  assert.equal(safeNextPath("/play?x=1#y", FB, BASE), "/play?x=1#y");
  assert.equal(safeNextPath("/room/1234", FB, BASE), "/room/1234");
  assert.equal(safeNextPath("/", FB, BASE), "/");
  assert.equal(safeNextPath("/play/ranked?go=1", FB, BASE), "/play/ranked?go=1");
  assert.equal(safeNextPath("/settings?next=%2Fplay", FB, BASE), "/settings?next=%2Fplay");
});

test("normalises dot segments without escaping the origin", () => {
  assert.equal(safeNextPath("/a/../play", FB, BASE), "/play");
  assert.equal(safeNextPath("/../../evil.com", FB, BASE), "/evil.com");
});

test("works without a window (falls back to a fixed base)", () => {
  assert.equal(safeNextPath("/play"), "/play");
  assert.equal(safeNextPath("//evil.com"), "/");
});

test("auth safeNext: blocks the bypasses and /signin loops", () => {
  assert.equal(authSafeNext("/\\evil.com"), "/");
  assert.equal(authSafeNext("/%09/evil.com"), "/");
  assert.equal(authSafeNext("/\t/evil.com"), "/");
  assert.equal(authSafeNext("/signin?next=/play"), "/");
  assert.equal(authSafeNext("/play?x=1#y"), "/play?x=1#y");
});

test("device-check safeNext: blocks the bypasses and /check loops", () => {
  assert.equal(checkSafeNext("/%5Cevil.com"), "/play");
  assert.equal(checkSafeNext("/\\evil.com"), "/play");
  assert.equal(checkSafeNext("/%09/evil.com"), "/play");
  assert.equal(checkSafeNext("/check?next=/play"), "/play");
  assert.equal(checkSafeNext("/room/1234"), "/room/1234");
  assert.equal(checkSafeNext(null, "/settings"), "/settings");
});

test("postSignInPath never emits an off-site destination", () => {
  const done = { ...EmptyOnboarding, onboardedAt: new Date(0).toISOString() };
  assert.equal(postSignInPath(done, "/\\evil.com"), "/");
  assert.equal(postSignInPath(done, "https://evil.com"), "/");
  assert.equal(postSignInPath(done, "/play"), "/play");
});
