/**
 * Once-per-account onboarding: the account flag decides, skipping counts as
 * done, and post-sign-in routing sends only new accounts through /check.
 * Also: the client auth mode fails closed and the dev opt-out is dev-only.
 *
 * Run: npx tsx --test apps/web/src/onboarding/onboardingState.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EmptyOnboarding,
  deviceStepPatch,
  fromMetadata,
  needsOnboarding,
  postSignInPath,
  shouldOfferVoice,
  toMetadata,
  voiceSavedPatch,
  voiceSkippedPatch,
} from "./onboardingState.ts";
import { effectiveOnboarding, queuePatch, readMirror, syncFromAccount } from "./accountOnboarding.ts";
import { resolveClientAuthMode } from "../auth/authMode.ts";

const PROFILE = { lowMidi: 48, highMidi: 67, centerMidi: 57, measuredAt: 1_700_000_000_000 };
const WHEN = "2026-10-01T12:00:00.000Z";

test("brand-new account (no metadata) needs onboarding", () => {
  assert.equal(needsOnboarding(fromMetadata(undefined)), true);
  assert.equal(needsOnboarding(fromMetadata({ full_name: "Ann", display_name: "Ann" })), true);
});

test("account with onboarded_at does not need onboarding, on any device", () => {
  const s = fromMetadata({ onboarded_at: WHEN, onboarding_device: "done" });
  assert.equal(needsOnboarding(s), false);
  assert.equal(s.device, "done");
});

test("skipped onboarding still counts as done", () => {
  const s = fromMetadata({ onboarded_at: WHEN, onboarding_device: "skipped" });
  assert.equal(needsOnboarding(s), false);
});

test("junk metadata is ignored, not trusted", () => {
  const s = fromMetadata({
    onboarded_at: "not a date",
    onboarding_device: "yes",
    voice_profile: { lowMidi: 70, highMidi: 50, centerMidi: 60, measuredAt: 1 },
  });
  assert.deepEqual(s, EmptyOnboarding);
});

test("voice profile round-trips through account metadata", () => {
  const meta = toMetadata(voiceSavedPatch(PROFILE));
  assert.deepEqual(meta, { onboarding_voice: "done", voice_profile: PROFILE });
  const s = fromMetadata({ ...meta, onboarded_at: WHEN });
  assert.deepEqual(s.voiceProfile, PROFILE);
  assert.equal(shouldOfferVoice(s), false);
});

test("device step marks the account onboarded; a re-run keeps the first date", () => {
  const first = deviceStepPatch(EmptyOnboarding, "done", new Date(WHEN));
  assert.deepEqual(first, { onboardedAt: WHEN, device: "done" });
  assert.deepEqual(toMetadata(first), { onboarded_at: WHEN, onboarding_device: "done" });

  const later = deviceStepPatch(
    { ...EmptyOnboarding, onboardedAt: WHEN, device: "done" },
    "skipped",
    new Date("2027-01-01T00:00:00.000Z"),
  );
  assert.equal(later.onboardedAt, WHEN);
  assert.equal(later.device, "done", "a re-run never downgrades a passed check");
});

test("voice step is offered once: not after a skip or a saved range", () => {
  assert.equal(shouldOfferVoice(EmptyOnboarding), true);
  assert.equal(shouldOfferVoice({ ...EmptyOnboarding, voice: "skipped" }), false);
  assert.deepEqual(voiceSkippedPatch(EmptyOnboarding), { voice: "skipped" });
  assert.deepEqual(voiceSkippedPatch({ ...EmptyOnboarding, voice: "done" }), {});
});

test("post-sign-in: new account goes through /check, then where it was headed", () => {
  assert.equal(postSignInPath(EmptyOnboarding, "/play"), "/check?next=%2Fplay");
  assert.equal(postSignInPath(EmptyOnboarding, "/room/4821"), "/check?next=%2Froom%2F4821");
  assert.equal(postSignInPath(EmptyOnboarding, "/"), "/check?next=%2F");
});

test("post-sign-in: onboarded account goes straight on", () => {
  const done = fromMetadata({ onboarded_at: WHEN, onboarding_device: "skipped" });
  assert.equal(postSignInPath(done, "/play"), "/play");
  assert.equal(postSignInPath(done, "/room/4821"), "/room/4821");
});

test("post-sign-in: already headed into the checks is not double-wrapped", () => {
  assert.equal(postSignInPath(EmptyOnboarding, "/check?next=%2Fsettings"), "/check?next=%2Fsettings");
  assert.equal(postSignInPath(EmptyOnboarding, "/check/voice?next=%2Fplay"), "/check/voice?next=%2Fplay");
});

test("a failed account write still lets this browser through (pending mirror), scoped per user", () => {
  const alice = `alice-${Math.random()}`;
  const bob = `bob-${Math.random()}`;
  queuePatch(alice, deviceStepPatch(EmptyOnboarding, "done", new Date(WHEN)));

  // The account copy has not caught up (write failed), but the queue covers it.
  const aliceView = effectiveOnboarding(EmptyOnboarding, readMirror(alice));
  assert.equal(needsOnboarding(aliceView), false);
  assert.ok(readMirror(alice).pending, "still queued for retry");

  // Another account on the same browser does not inherit it.
  assert.equal(needsOnboarding(effectiveOnboarding(EmptyOnboarding, readMirror(bob))), true);
});

test("once the account write lands the queue clears; a stale account copy cannot undo it", () => {
  const uid = `carol-${Math.random()}`;
  const patch = deviceStepPatch(EmptyOnboarding, "skipped", new Date(WHEN));
  queuePatch(uid, patch);
  syncFromAccount(uid, fromMetadata(toMetadata(patch)), patch);
  assert.equal(readMirror(uid).pending, null);

  // Later page load with an old stored session (no onboarded_at yet).
  syncFromAccount(uid, EmptyOnboarding);
  assert.equal(needsOnboarding(effectiveOnboarding(EmptyOnboarding, readMirror(uid))), false);
});

test("client auth mode: no Supabase config fails closed, never guest", () => {
  assert.equal(resolveClientAuthMode({ dev: false }), "unconfigured");
  assert.equal(resolveClientAuthMode({ dev: true }), "unconfigured");
  assert.equal(resolveClientAuthMode({ dev: false, url: "https://x.supabase.co", key: "k" }), "accounts");
});

test("client dev opt-out only works in a dev build", () => {
  assert.equal(resolveClientAuthMode({ dev: true, optOut: "0" }), "dev-guest");
  assert.equal(resolveClientAuthMode({ dev: false, optOut: "0" }), "unconfigured");
  assert.equal(
    resolveClientAuthMode({ dev: false, optOut: "0", url: "https://x.supabase.co", key: "k" }),
    "accounts",
  );
  assert.equal(resolveClientAuthMode({ dev: true, optOut: "1" }), "unconfigured");
});
