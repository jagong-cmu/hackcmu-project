/**
 * What StagePitch knows about the scores, for the score panels Stage draws
 * around the machine. StagePitch is a slot with no props out, so it publishes
 * here (same pattern as slots.tsx). Display only.
 */
import { useSyncExternalStore } from "react";
import type { ScoreBits } from "../scoring/ScoreBars.tsx";

export type StageHud = {
  you: ScoreBits | null;
  them: ScoreBits | null;
  /** Whose voice is on the lane right now, so the lock meter and combo follow it. */
  laneSide: "you" | "them";
  combo: { you: number; them: number };
  /** Live PITCH LOCK per side (pitchLock.ts), 0–100, or null before any singing. */
  lock: { you: number | null; them: number | null };
};

const empty: StageHud = {
  you: null,
  them: null,
  laneSide: "you",
  combo: { you: 0, them: 0 },
  lock: { you: null, them: null },
};
let hud = empty;
let key = JSON.stringify(hud);
const listeners = new Set<() => void>();

/** Cheap to call every frame: only a real change notifies. */
export function setStageHud(next: StageHud): void {
  const nextKey = JSON.stringify(next);
  if (nextKey === key) return;
  key = nextKey;
  hud = next;
  for (const l of listeners) l();
}

export function resetStageHud(): void {
  setStageHud(empty);
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useStageHud(): StageHud {
  return useSyncExternalStore(subscribe, () => hud, () => hud);
}
