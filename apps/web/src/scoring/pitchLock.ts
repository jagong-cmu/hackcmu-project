/**
 * PITCH LOCK: how tightly the last moment of singing sits on the guide
 * melody, 0–100. Display only — the score card still comes from scoreContour.
 *
 * The meter used to show the running clip score, which reacts to a whole
 * take: one rough line early on kept it low for the rest of the song, and it
 * read 0 while you watched a Ranked opponent (their card is hidden). This is
 * a rolling window instead, so it follows the singer note by note, and it can
 * be fed from any pitch stream (your mic, or an opponent's pitch:live).
 *
 * Same rules as the score: octave-folded cents error, the same cents→points
 * curve, the same pitch gates, and partial credit for a half-sung window.
 */
import type { MelodyFile } from "@karaoke/shared";
import { centsError, centsToPitch } from "./cents.ts";
import { melodyHzAt } from "./scoreClip.ts";

/** Seconds of singing the meter reads. Long enough to ride out one breath. */
export const LockWindowSec = 1.5;
/** Share of the window's guide notes you must voice before the lock stops being scaled down. */
const LockFullCoverage = 0.5;
/** Fewer voiced frames than this is not enough to judge: hold the last value. */
const MinVoicedFrames = 4;
/** Same gates scoreContour applies to a frame. */
const MinClarity = 0.5;
const MinHz = 55;
const MaxHz = 1200;

type LockSample = { timeSec: number; credit: number | null };

/** True when a pitch reading is clean enough to judge, by scoreContour's gates. */
export function lockableHz(hz: number | null | undefined, clarity: number): hz is number {
  return hz != null && Number.isFinite(hz) && hz >= MinHz && hz <= MaxHz && clarity >= MinClarity;
}

export class PitchLock {
  private samples: LockSample[] = [];
  private value: number | null = null;
  private lastSec = -Infinity;

  /** Start over (a new take, a new song, or the playhead jumped back). */
  reset(): void {
    this.samples = [];
    this.value = null;
    this.lastSec = -Infinity;
  }

  /**
   * One pitch frame at song time `timeSec`. `hz` is null when nothing usable
   * was heard. Frames where the guide has no note (rests, the lead-in) are
   * ignored, so the meter holds through gaps instead of falling to zero.
   */
  push(melody: MelodyFile | null, timeSec: number, hz: number | null, clarity: number): number | null {
    if (!melody || !Number.isFinite(timeSec)) return this.value;
    // A seek back (new take, rematch, re-sync) starts a fresh window.
    if (timeSec < this.lastSec - 0.25) this.reset();
    this.lastSec = Math.max(this.lastSec, timeSec);

    const target = melodyHzAt(melody, timeSec);
    if (target != null) {
      const credit = lockableHz(hz, clarity) ? centsToPitch(centsError(hz, target)) : null;
      this.samples.push({ timeSec, credit });
    }
    const from = timeSec - LockWindowSec;
    let drop = 0;
    while (drop < this.samples.length && this.samples[drop]!.timeSec < from) drop++;
    if (drop) this.samples.splice(0, drop);

    let sum = 0;
    let voiced = 0;
    for (const s of this.samples) {
      if (s.credit == null) continue;
      sum += s.credit;
      voiced++;
    }
    if (voiced >= MinVoicedFrames) {
      const coverage = voiced / this.samples.length;
      this.value = Math.round((sum / voiced) * Math.min(1, coverage / LockFullCoverage));
    } else if (this.samples.length >= MinVoicedFrames * 4) {
      // A guide note is running and you are not on it: the lock lets go.
      this.value = 0;
    }
    return this.value;
  }

  get current(): number | null {
    return this.value;
  }
}
