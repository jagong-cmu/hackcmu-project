export type EloDisplay = { text: string; tone: "up" | "down" | "flat" | "unrated" };

/**
 * The Elo line on results. The sign is part of the text, so the change never
 * rests on colour alone. Unrated rooms never show a number, real or not.
 */
export function formatEloDelta(delta: number | null | undefined, unrated: boolean): EloDisplay | null {
  if (unrated) return { text: "Unrated · friendly match", tone: "unrated" };
  if (delta == null || !Number.isFinite(delta)) return null;
  const n = Math.round(delta);
  if (n === 0) return { text: "Elo unchanged", tone: "flat" };
  return n > 0 ? { text: `+${n} Elo`, tone: "up" } : { text: `−${Math.abs(n)} Elo`, tone: "down" };
}

/** A 0..100 score as the scoreboard shows it; "--" when there is none. */
export function formatScore(overall: number, silence: boolean): string {
  if (silence || !Number.isFinite(overall)) return "--";
  return String(Math.min(100, Math.max(0, Math.round(overall))));
}
