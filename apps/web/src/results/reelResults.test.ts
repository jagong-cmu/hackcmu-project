/**
 * The match video's closing card: what it says and when it rolls.
 *
 * Run: npx tsx --test apps/web/src/results/reelResults.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ScoreCard } from "@karaoke/shared";
import {
  buildReelResults,
  decideOutro,
  EnrichGraceMs,
  OutroMs,
  outroBeat,
  ResultsWaitMs,
  shownScore,
  tailGainAt,
  type ReelResultsInput,
} from "./reelResults.ts";

const card = (overall: number, source: ScoreCard["source"] = "dsp"): ScoreCard => ({
  overall,
  pitch: overall - 3,
  tone: overall + 2,
  silence: false,
  verdict: "",
  source,
});

const ranked = (over: Partial<ReelResultsInput> = {}): ReelResultsInput => ({
  you: card(87, "dsp+gemini"),
  youName: "Jon",
  opponent: card(73),
  opponentName: "Alex",
  versus: true,
  winnerId: "a",
  youId: "a",
  opponentId: "b",
  eloDelta: 16,
  songTitle: "Viva La Vida",
  songArtist: "Coldplay",
  kicker: "Locked in",
  caption: "Pitch locked on the chorus.",
  ...over,
});

test("ranked win names the winner and mirrors the ELO swing", () => {
  const r = buildReelResults(ranked());
  assert.equal(r.headline, "Jon wins");
  assert.equal(r.players.length, 2);
  assert.deepEqual(
    r.players.map((p) => [p.name, p.card?.overall, p.winner, p.eloDelta]),
    [
      ["Jon", 87, true, 16],
      ["Alex", 73, false, -16],
    ],
  );
  assert.equal(r.complete, true);
});

test("ranked loss and draw", () => {
  assert.equal(buildReelResults(ranked({ winnerId: "b", eloDelta: -12 })).headline, "Alex wins");
  const draw = buildReelResults(ranked({ winnerId: "draw", eloDelta: 0 }));
  assert.equal(draw.headline, "Draw");
  assert.equal(draw.players.some((p) => p.winner), false);
  assert.deepEqual(
    draw.players.map((p) => p.eloDelta),
    [0, 0],
  );
});

test("forfeit: opponent left with no card", () => {
  const r = buildReelResults(
    ranked({ opponent: null, opponentLeft: true, forfeit: true, eloDelta: 8 }),
  );
  assert.equal(r.headline, "Jon wins by forfeit");
  assert.equal(r.players[1]?.card, null);
  assert.equal(r.players[1]?.note, "Left the match");
  // Nobody else is coming, so the card can roll as soon as your verdict is in.
  assert.equal(r.complete, true);
});

test("duet shows both cards and the shared score, no ELO", () => {
  const r = buildReelResults(
    ranked({ winnerId: null, eloDelta: null, shared: 80, opponent: card(73, "dsp+gemini") }),
  );
  assert.equal(r.headline, "Duet locked in");
  assert.equal(r.shared, 80);
  assert.deepEqual(
    r.players.map((p) => p.eloDelta),
    [null, null],
  );
});

test("solo training take uses the coach kicker", () => {
  const r = buildReelResults({
    you: card(64),
    youName: "",
    versus: false,
    kicker: "Warming up",
    caption: "  Lean into the chorus.  ",
  });
  assert.equal(r.players.length, 1);
  assert.equal(r.players[0]?.name, "You");
  assert.equal(r.headline, "Warming up");
  assert.equal(r.caption, "Lean into the chorus.");
  assert.equal(r.songTitle, "Karaoke");
  // DSP only: still worth a short wait for Gemini.
  assert.equal(r.complete, false);
});

test("hidden opponent shows no numbers", () => {
  const r = buildReelResults(ranked({ revealOpponent: false }));
  assert.equal(r.players[1]?.card, null);
  assert.equal(r.players[1]?.note, "Hidden");
  assert.equal(r.players[1]?.eloDelta, null);
});

test("waiting on the opponent's late score keeps it incomplete", () => {
  const r = buildReelResults(ranked({ opponent: null }));
  assert.equal(r.complete, false);
  assert.equal(r.players[1]?.note, "No score");
});

test("decideOutro waits, then rolls with what it has", () => {
  const base = { heldAt: 0, firstResultsAt: null, complete: false };
  assert.equal(decideOutro({ ...base, now: 1000 }), "wait");
  assert.equal(decideOutro({ ...base, now: ResultsWaitMs }), "sting");
  assert.equal(decideOutro({ ...base, now: 1500, firstResultsAt: 1000, complete: true }), "outro");
  assert.equal(decideOutro({ ...base, now: 1500, firstResultsAt: 1000 }), "wait");
  assert.equal(decideOutro({ ...base, now: 1000 + EnrichGraceMs, firstResultsAt: 1000 }), "outro");
  // Results that showed up just before the cap still roll at the cap.
  assert.equal(
    decideOutro({ ...base, now: ResultsWaitMs, firstResultsAt: ResultsWaitMs - 100 }),
    "outro",
  );
});

test("outro timeline lands everything well before the end", () => {
  assert.deepEqual(outroBeat(0), { mix: 0, count: 0, headline: 0, details: 0 });
  const end = outroBeat(OutroMs);
  assert.deepEqual(end, { mix: 1, count: 1, headline: 1, details: 1 });
  const settled = outroBeat(2400);
  assert.equal(settled.details, 1);
  // At least ~2s of the finished card on screen.
  assert.ok(OutroMs - 2250 >= 2000);
  assert.ok(OutroMs >= 3000 && OutroMs <= 5000);
});

test("tail gain holds, fades smoothly, and ends silent", () => {
  assert.equal(tailGainAt(0, OutroMs), 1);
  assert.equal(tailGainAt(800, OutroMs), 1);
  assert.equal(tailGainAt(OutroMs, OutroMs), 0);
  let prev = 1;
  for (let t = 0; t <= OutroMs; t += 50) {
    const g = tailGainAt(t, OutroMs);
    assert.ok(g <= prev + 1e-9, `gain rose at ${t}ms`);
    assert.ok(prev - g < 0.06, `gain jumped at ${t}ms`);
    prev = g;
  }
});

test("shownScore counts up and hides silence", () => {
  const c = { overall: 87, pitch: 84, tone: 92, silence: false };
  assert.equal(shownScore(c, 0), "0");
  assert.equal(shownScore(c, 0.5), "44");
  assert.equal(shownScore(c, 1), "87");
  assert.equal(shownScore({ ...c, silence: true }, 1), "--");
  assert.equal(shownScore(null, 1), "--");
});
