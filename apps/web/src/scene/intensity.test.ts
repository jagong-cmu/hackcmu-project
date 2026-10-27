/**
 * Accuracy samples -> a smoothed 0..1 room intensity that responds fast, swells
 * and settles, and can never flash (WCAG 2.3.1: at most 3 flashes per second).
 *
 * Run: npx tsx --test apps/web/src/scene/intensity.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  IdleLevel,
  MinReverseMs,
  accuracyOf,
  initialFilter,
  lightParams,
  stepIntensity,
  type FilterState,
} from "./intensity.ts";

const FRAME = 1000 / 60;

function run(targets: (tMs: number) => number, ms: number): { t: number; v: number }[] {
  let s: FilterState = initialFilter(0);
  const out: { t: number; v: number }[] = [];
  for (let t = 0; t < ms; t += FRAME) {
    s = stepIntensity(s, targets(t), FRAME);
    out.push({ t, v: s.value });
  }
  return out;
}

/** Opposite-direction transitions with at least `swing` excursion, per sliding 1s window. */
function worstTransitionsPerSecond(samples: { t: number; v: number }[], swing = 0.1): number {
  const turns: number[] = [];
  let dir = 0;
  let extreme = samples[0].v;
  let extremeT = samples[0].t;
  for (const { t, v } of samples) {
    const d = v > extreme ? 1 : v < extreme ? -1 : 0;
    if (dir === 0 && d !== 0 && Math.abs(v - extreme) >= swing) {
      dir = d;
      extreme = v;
      extremeT = t;
    } else if (dir !== 0) {
      if ((dir === 1 && v > extreme) || (dir === -1 && v < extreme)) {
        extreme = v;
        extremeT = t;
      } else if (Math.abs(v - extreme) >= swing) {
        turns.push(extremeT);
        dir = -dir;
        extreme = v;
        extremeT = t;
      }
    }
  }
  let worst = 0;
  for (let i = 0; i < turns.length; i++) {
    let n = 0;
    for (let j = i; j < turns.length && turns[j] - turns[i] < 1000; j++) n++;
    worst = Math.max(worst, n);
  }
  return worst;
}

test("responds within 150ms: a step to full accuracy is past halfway by then", () => {
  const out = run(() => 1, 400);
  const at150 = out.find((s) => s.t >= 150)!;
  assert.ok(at150.v >= 0.5, `value at 150ms was ${at150.v}`);
});

test("a one-frame spike barely moves it", () => {
  const out = run((t) => (t < FRAME ? 1 : 0), 500);
  assert.ok(Math.max(...out.map((s) => s.v)) < 0.2);
});

test("it swells fast and settles slowly", () => {
  let s = initialFilter(0);
  for (let t = 0; t < 600; t += FRAME) s = stepIntensity(s, 1, FRAME);
  assert.ok(s.value > 0.95);
  const peak = s.value;
  for (let t = 0; t < 150; t += FRAME) s = stepIntensity(s, 0, FRAME);
  assert.ok(s.value > peak * 0.6, `fell too fast: ${s.value}`);
});

test("always within 0..1, and nonsense input holds the value", () => {
  for (const bad of [Number.NaN, Infinity, -Infinity, 5, -5]) {
    const out = run(() => bad, 800);
    for (const { v } of out) assert.ok(v >= 0 && v <= 1, `${bad} -> ${v}`);
  }
  let s = stepIntensity(initialFilter(0.4), 1, 200);
  const held = stepIntensity(s, Number.NaN, 100).value;
  assert.equal(held, s.value);
  s = initialFilter(2);
  assert.equal(s.value, 1);
});

test("flash limit: rapid toggling never exceeds 3 flashes (6 transitions) in any second", () => {
  for (const periodMs of [16, 33, 50, 100, 166, 250, 333, 500]) {
    const out = run((t) => (Math.floor(t / periodMs) % 2 === 0 ? 1 : 0), 6000);
    const worst = worstTransitionsPerSecond(out);
    assert.ok(worst <= 6, `period ${periodMs}ms gave ${worst} transitions in a second`);
  }
});

test("flash limit holds for random input too", () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const out = run(() => (rnd() > 0.5 ? 1 : 0), 10_000);
  assert.ok(worstTransitionsPerSecond(out) <= 6);
});

test("a direction change is held for MinReverseMs, then allowed", () => {
  let s = initialFilter(0);
  for (let t = 0; t < 100; t += FRAME) s = stepIntensity(s, 1, FRAME); // rising for ~100ms
  const peak = s.value;
  s = stepIntensity(s, 0, FRAME); // asks to fall straight away
  assert.equal(s.value, peak, "reversal inside the hold window must not move");
  for (let t = 0; t < MinReverseMs; t += FRAME) s = stepIntensity(s, 0, FRAME);
  assert.ok(s.value < peak, "after the hold it is free to fall");
  assert.ok(MinReverseMs >= 200 && MinReverseMs <= 330);
});

test("accuracy from a live hit grade: better grade, higher accuracy; silence is low", () => {
  const a = (g: Parameters<typeof accuracyOf>[0]) => accuracyOf(g);
  assert.ok(a("perfect") > a("great"));
  assert.ok(a("great") > a("good"));
  assert.ok(a("good") > a("okay"));
  assert.ok(a("okay") > a(null));
  assert.ok(a("perfect") <= 1 && a(null) >= 0);
});

test("idle level sits between a miss and a hit", () => {
  assert.ok(IdleLevel > accuracyOf(null) && IdleLevel < accuracyOf("great"));
});

test("light parameters grow with intensity and stay in range", () => {
  const lo = lightParams(0);
  const mid = lightParams(0.5);
  const hi = lightParams(1);
  assert.ok(lo.spotCount < mid.spotCount && mid.spotCount < hi.spotCount);
  assert.ok(lo.spotSpeed < hi.spotSpeed);
  assert.ok(lo.brightness < hi.brightness);
  assert.ok(lo.tvGlow < hi.tvGlow);
  for (const p of [lo, mid, hi]) {
    assert.ok(p.brightness >= 0 && p.brightness <= 1 && p.tvGlow >= 0 && p.tvGlow <= 1);
  }
  assert.deepEqual(lightParams(-3), lightParams(0));
  assert.deepEqual(lightParams(9), lightParams(1));
});
