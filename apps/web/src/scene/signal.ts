import type { HitGrade } from "../scoring/hitGrade.ts";
import { accuracyOf } from "./intensity.ts";

/**
 * What the room should react to right now. Written by the screens that already
 * know (the stage, training), read by the light layer once per frame. A plain
 * module variable, not React state: no re-render per frame, and nothing here is
 * ever read back by scoring.
 */
export type Signal =
  | { kind: "idle" }
  | { kind: "accuracy"; value: number }
  /** The room settles at the final score (0..1) on results. */
  | { kind: "final"; value: number }
  /** Chaos has no score: the room follows the instrumental's energy (0..1). */
  | { kind: "energy"; value: number };

/** A publisher that goes quiet (unmounts, tab hidden) must not leave the room stuck. */
export const StaleMs = 600;

let current: Signal = { kind: "idle" };
let stamp = 0;

const now = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

function put(next: Signal): void {
  current = next;
  stamp = now();
}

export function publishIdle(): void {
  put({ kind: "idle" });
}

/** From a live hit grade (null = silence or off pitch). */
export function publishGrade(grade: HitGrade | null): void {
  put({ kind: "accuracy", value: accuracyOf(grade) });
}

/** From an already-computed 0..1 accuracy (e.g. a Duet partner blended in). */
export function publishAccuracy(value: number): void {
  put({ kind: "accuracy", value });
}

export function publishFinal(score0to100: number): void {
  put({ kind: "final", value: Math.min(1, Math.max(0, score0to100 / 100)) });
}

export function publishEnergy(value: number): void {
  put({ kind: "energy", value });
}

/** The current signal; accuracy and energy go idle if their publisher stopped. "final" holds. */
export function readSignal(at: number = now()): Signal {
  if (current.kind === "final") return current;
  if (current.kind !== "idle" && at - stamp > StaleMs) return { kind: "idle" };
  return current;
}

// Dev only: lets a browser test drive the signal (e.g. verify the room stays still behind the lyrics).
if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __scene: unknown }).__scene = { publishAccuracy, publishIdle, publishFinal };
}
