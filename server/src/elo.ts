import { EloK, ForfeitEloK } from "../../packages/shared/src/index.ts";

export function expectedScore(eloA: number, eloB: number): number {
  return 1 / (1 + 10 ** ((eloB - eloA) / 400));
}

export type Outcome = 0 | 0.5 | 1;

/** Integer ELO deltas for player A (B is the negation). Draws never move ELO (PRD §6.1). */
export function eloDelta(
  eloA: number,
  eloB: number,
  scoreA: Outcome,
  k: number = EloK,
): { a: number; b: number } {
  if (scoreA === 0.5) return { a: 0, b: 0 };
  const ea = expectedScore(eloA, eloB);
  const da = Math.round(k * (scoreA - ea));
  return { a: da, b: -da };
}

export function outcomeFromScores(aOverall: number, bOverall: number): Outcome {
  if (aOverall > bOverall) return 1;
  if (aOverall < bOverall) return 0;
  return 0.5;
}

export function kForMatch(opts: { forfeit?: boolean; elapsedMs?: number }): number {
  if (!opts.forfeit) return EloK;
  return ForfeitEloK;
}
