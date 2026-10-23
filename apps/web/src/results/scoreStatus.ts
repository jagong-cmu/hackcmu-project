import { useSyncExternalStore } from "react";

/**
 * Where this player's own score is on its way to the server, for the results
 * screen. The posting code (stage/LaneBSlots.tsx) writes it; ScoringWait reads
 * it so a failed send is visible and retryable rather than a silent spinner.
 */
export type ScoreStatus = "idle" | "sending" | "failed";

let status: ScoreStatus = "idle";
let retry: (() => void) | null = null;
const listeners = new Set<() => void>();

export function setScoreStatus(next: ScoreStatus): void {
  if (next === status) return;
  status = next;
  listeners.forEach((fn) => fn());
}

/** The posting code says how to try again; null when it unmounts. */
export function registerScoreRetry(fn: (() => void) | null): void {
  retry = fn;
}

export function retryScore(): void {
  retry?.();
}

export function useScoreStatus(): ScoreStatus {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => status,
  );
}
