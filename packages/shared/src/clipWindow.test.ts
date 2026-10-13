/**
 * Clip anchors: every clip starts ClipLeadInMs before the first lyric or the
 * chorus, never anywhere else.
 *
 * Run: npx tsx --test packages/shared/src/clipWindow.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  anchorSecFor,
  availableAnchors,
  clipWindowFor,
  pickClipAnchor,
  singWindow,
  trackEndSec,
} from "./clipWindow.ts";
import { ClipLeadInMs, RankedClipMaxSec, RankedHookMaxSec } from "./protocol.ts";
import { SONGS } from "./songs.ts";
import type { SongMeta } from "./types.ts";

const LEAD = ClipLeadInMs / 1000;

const base: SongMeta = {
  id: "t",
  title: "T",
  artist: "A",
  clipStartSec: 64.3,
  clipDurationSec: 18,
  firstLyricSec: 23.06,
  chorusSec: 64.35,
  duetClipStartSec: 0,
  duetClipDurationSec: 252.9,
  chaosDurationSec: 60,
};

const close = (a: number, b: number, msg?: string) =>
  assert.ok(Math.abs(a - b) < 1e-6, msg ?? `${a} != ${b}`);

test("ClipLeadInMs is 5s and the ranked cap leaves room for it", () => {
  assert.equal(ClipLeadInMs, 5000);
  assert.equal(RankedClipMaxSec, RankedHookMaxSec + LEAD);
});

test("both anchors are reachable, deterministically, with an injected rng", () => {
  assert.equal(pickClipAnchor(base, () => 0), "firstLyric");
  assert.equal(pickClipAnchor(base, () => 0.49), "firstLyric");
  assert.equal(pickClipAnchor(base, () => 0.5), "chorus");
  assert.equal(pickClipAnchor(base, () => 0.999999), "chorus");
  // rng() === 1 must not index past the end.
  assert.equal(pickClipAnchor(base, () => 1), "chorus");
});

test("roughly 50/50 over many flips", () => {
  let seed = 7;
  const rng = () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed / 2 ** 31;
  };
  let chorus = 0;
  for (let i = 0; i < 2000; i++) if (pickClipAnchor(base, rng) === "chorus") chorus++;
  assert.ok(chorus > 850 && chorus < 1150, `chorus picked ${chorus}/2000`);
});

test("a missing anchor falls back to the other", () => {
  const noFirst = { ...base, firstLyricSec: undefined };
  assert.deepEqual(availableAnchors(noFirst), ["chorus"]);
  assert.equal(pickClipAnchor(noFirst, () => 0), "chorus");
  assert.equal(clipWindowFor(noFirst, "ranked", "firstLyric").anchor, "chorus");

  // No chorusSec and no legacy clipStartSec either.
  const noChorus = { ...base, chorusSec: undefined, clipStartSec: Number.NaN };
  assert.deepEqual(availableAnchors(noChorus), ["firstLyric"]);
  assert.equal(pickClipAnchor(noChorus, () => 0.99), "firstLyric");
  const w = clipWindowFor(noChorus, "duet", "chorus");
  assert.equal(w.anchor, "firstLyric");
  close(w.startSec, 23.06 - LEAD);
});

test("pre-anchor meta.json treats the old ranked clipStartSec as the chorus", () => {
  const legacy = { ...base, chorusSec: undefined };
  assert.equal(anchorSecFor(legacy, "chorus"), 64.3);
});

test("anchors within the lead-in of each other collapse into one", () => {
  const near = { ...base, firstLyricSec: 10, chorusSec: 13 };
  assert.deepEqual(availableAnchors(near), ["firstLyric"]);
  assert.equal(pickClipAnchor(near, () => 0.99), "firstLyric");
});

test("start is anchor − lead-in, clamped at 0 for early anchors", () => {
  const early = { ...base, firstLyricSec: 4.08 };
  const w = clipWindowFor(early, "duet", "firstLyric");
  assert.equal(w.startSec, 0);
  close(w.leadInSec, 4.08);
  close(w.anchorSec, 4.08);

  const zero = { ...base, firstLyricSec: 0 };
  const z = clipWindowFor(zero, "ranked", "firstLyric");
  assert.equal(z.startSec, 0);
  assert.equal(z.leadInSec, 0);
});

test("every catalog clip starts exactly at an anchor minus the lead-in — never mid-song", () => {
  for (const song of SONGS) {
    const anchors = new Set(
      [song.firstLyricSec, song.chorusSec].filter((n): n is number => n != null),
    );
    for (const kind of ["ranked", "duet", "training"] as const) {
      for (const r of [0, 0.25, 0.5, 0.75, 0.99]) {
        const w = clipWindowFor(song, kind, pickClipAnchor(song, () => r));
        assert.ok(w.startSec >= 0, `${song.id} ${kind} start < 0`);
        assert.ok(anchors.has(w.anchorSec), `${song.id} ${kind} anchor ${w.anchorSec} not an anchor`);
        close(w.startSec, Math.max(0, w.anchorSec - LEAD), `${song.id} ${kind}`);
        close(w.startSec + w.leadInSec, w.anchorSec);
        assert.ok(w.leadInSec <= LEAD + 1e-9);
      }
    }
  }
});

test("ranked: the 15–20s hook is sung after the lead-in; total = lead-in + hook", () => {
  const w = clipWindowFor(base, "ranked", "chorus");
  close(w.startSec, 64.35 - LEAD);
  close(w.leadInSec, LEAD);
  close(w.durationSec, LEAD + 18);
  const sung = singWindow(w);
  close(sung.startSec, 64.35);
  close(sung.durationSec, 18);

  // A stale long hook is still capped at RankedHookMaxSec of singing.
  const long = clipWindowFor({ ...base, clipDurationSec: 90 }, "ranked", "firstLyric");
  close(long.durationSec, LEAD + RankedHookMaxSec);
  assert.ok(long.durationSec <= RankedClipMaxSec);

  for (const song of SONGS) {
    for (const anchor of ["chorus", "firstLyric"] as const) {
      const c = clipWindowFor(song, "ranked", anchor);
      const s = singWindow(c);
      assert.ok(s.durationSec >= 15 && s.durationSec <= 20, `${song.id} sings ${s.durationSec}s`);
      assert.ok(c.durationSec <= RankedClipMaxSec);
    }
  }
});

test("duet / training: from anchor − lead-in to the end of the track", () => {
  for (const kind of ["duet", "training"] as const) {
    const c = clipWindowFor(base, kind, "firstLyric");
    close(c.startSec, 23.06 - LEAD);
    close(c.durationSec, 252.9 - (23.06 - LEAD));
    close(c.startSec + c.durationSec, trackEndSec(base));
    const ch = clipWindowFor(base, kind, "chorus");
    close(ch.startSec + ch.durationSec, 252.9);
  }
});

test("singWindow with no lead-in is the clip itself", () => {
  assert.deepEqual(singWindow({ startSec: 3, durationSec: 10 }), { startSec: 3, durationSec: 10 });
});
