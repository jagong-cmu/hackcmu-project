/**
 * LANE A — slot registry for Lane B's components.
 *
 * Stage renders LyricsOverlay, PitchMeter and ResultsModal, but those files are
 * Lane B's and may not exist yet. Importing them directly would break the build
 * for whoever is ahead, so B registers them at runtime instead.
 *
 * LANE B: from your entry module (or the top of a component you already load),
 *
 *   import { registerStageSlots } from "../stage/slots.tsx";
 *   registerStageSlots({
 *     LyricsOverlay: MyLyricsOverlay,
 *     PitchMeter: MyPitchMeter,
 *     ResultsModal: MyResultsModal,
 *   });
 *
 * Each component reads `useStage()` for audioRef / micStream / room.
 */
import { useSyncExternalStore, type ComponentType } from "react";

export type StageSlots = {
  LyricsOverlay?: ComponentType;
  PitchMeter?: ComponentType;
  ResultsModal?: ComponentType;
};

let slots: StageSlots = {};
const listeners = new Set<() => void>();

export function registerStageSlots(next: StageSlots): void {
  slots = { ...slots, ...next };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useStageSlots(): StageSlots {
  return useSyncExternalStore(
    subscribe,
    () => slots,
    () => slots,
  );
}

/** Renders B's component if registered, otherwise a labelled placeholder. */
export function Slot({
  component: Component,
  label,
}: {
  component: ComponentType | undefined;
  label: string;
}) {
  if (Component) return <Component />;
  return <div className="slot-empty">{label} — Lane B slot, not registered yet</div>;
}
