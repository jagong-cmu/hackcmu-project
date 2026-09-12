import type { MelodyFile } from "@karaoke/shared";
import { centsError } from "./cents.ts";
import { melodyHzAt } from "./scoreClip.ts";

export type HitGrade = "perfect" | "great" | "good" | "okay";

export function gradeCents(cents: number): HitGrade | null {
  if (!Number.isFinite(cents)) return null;
  if (cents <= 22) return "perfect";
  if (cents <= 45) return "great";
  if (cents <= 80) return "good";
  if (cents <= 130) return "okay";
  return null;
}

export function gradeLive(
  melody: MelodyFile | null,
  playheadSec: number,
  liveHz: number | null,
): HitGrade | null {
  if (!melody || liveHz == null || liveHz <= 0) return null;
  const target = melodyHzAt(melody, playheadSec);
  if (target == null) return null;
  return gradeCents(centsError(liveHz, target));
}

export function hitLabel(grade: HitGrade): string {
  if (grade === "perfect") return "PERFECT";
  if (grade === "great") return "GREAT";
  if (grade === "good") return "GOOD";
  return "OKAY";
}
