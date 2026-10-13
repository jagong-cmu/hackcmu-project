/**
 * Google Identity Services sign-in: the nonce pair (Google gets the SHA-256,
 * Supabase gets the raw value) and when the button falls back to the Supabase
 * redirect flow.
 *
 * Run: npx tsx --test apps/web/src/auth/googleSignIn.test.ts
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createNoncePair, randomNonce, sha256Hex } from "./nonce.ts";
import { initialGisStatus, isGoogleClientId, selectSignInFlow } from "./signInFlow.ts";

const CLIENT = "123456789012-abcdefghijklmnopqrstuvwxyz012345.apps.googleusercontent.com";

test("sha256Hex matches Node's SHA-256, lower-case hex", async () => {
  assert.equal(
    await sha256Hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  assert.equal(await sha256Hex(""), createHash("sha256").update("").digest("hex"));
  assert.equal(await sha256Hex("héllo ✓"), createHash("sha256").update("héllo ✓", "utf8").digest("hex"));
});

test("randomNonce is 64 hex chars and never repeats", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const n = randomNonce();
    assert.match(n, /^[0-9a-f]{64}$/);
    seen.add(n);
  }
  assert.equal(seen.size, 200);
  assert.match(randomNonce(8), /^[0-9a-f]{16}$/);
});

test("nonce pair: Google gets sha256(raw), Supabase keeps raw", async () => {
  const a = await createNoncePair();
  const b = await createNoncePair();
  assert.equal(a.hashed, createHash("sha256").update(a.raw).digest("hex"));
  assert.notEqual(a.raw, a.hashed);
  assert.notEqual(a.raw, b.raw);
});

test("client id shape", () => {
  assert.equal(isGoogleClientId(CLIENT), true);
  assert.equal(isGoogleClientId(` ${CLIENT} `), true);
  assert.equal(isGoogleClientId(""), false);
  assert.equal(isGoogleClientId(undefined), false);
  assert.equal(isGoogleClientId(null), false);
  assert.equal(isGoogleClientId("your-client-id"), false);
  assert.equal(isGoogleClientId("123.apps.googleusercontent.com"), false);
  assert.equal(isGoogleClientId(`${CLIENT}.evil.example`), false);
});

test("no client id: redirect flow, and GIS is never loaded", () => {
  assert.equal(initialGisStatus(undefined), "failed");
  assert.equal(initialGisStatus(""), "failed");
  for (const status of ["loading", "ready", "failed"] as const) {
    assert.equal(selectSignInFlow({ clientId: "", status }), "redirect");
    assert.equal(selectSignInFlow({ clientId: undefined, status }), "redirect");
  }
});

test("with a client id: pending while loading, GIS when ready, redirect on failure", () => {
  assert.equal(initialGisStatus(CLIENT), "loading");
  assert.equal(selectSignInFlow({ clientId: CLIENT, status: "loading" }), "pending");
  assert.equal(selectSignInFlow({ clientId: CLIENT, status: "ready" }), "gis");
  assert.equal(selectSignInFlow({ clientId: CLIENT, status: "failed" }), "redirect");
});

test("user can always force the redirect flow", () => {
  for (const status of ["loading", "ready", "failed"] as const) {
    assert.equal(selectSignInFlow({ clientId: CLIENT, status, forceRedirect: true }), "redirect");
  }
});
