/**
 * What the match video's closing card says, and when it rolls. Pure (no DOM)
 * so it runs under node --test: see reelResults.test.ts.
 */
import type { ScoreCard } from "@karaoke/shared";

export type ReelCard = Pick<ScoreCard, "overall" | "pitch" | "tone" | "silence">;

export type ReelPlayer = {
  name: string;
  /** Null while hidden or when the player left before a score landed. */
  card: ReelCard | null;
  winner: boolean;
  eloDelta: number | null;
  /** Shown instead of numbers when there is no card. */
  note?: string;
};

export type ReelResults = {
  songTitle: string;
  songArtist: string;
  headline: string;
  caption: string;
  /** You first (left), opponent second (right), like the share card. */
  players: ReelPlayer[];
  shared: number | null;
  /** Every card and the Gemini line are in; no point waiting longer. */
  complete: boolean;
};

export type ReelResultsInput = {
  you: ScoreCard;
  youName: string;
  opponent?: ScoreCard | null;
  opponentName?: string;
  /** A second seat existed this match (Ranked/Duet), even if they left. */
  versus: boolean;
  opponentLeft?: boolean;
  revealOpponent?: boolean;
  winnerId?: string | "draw" | null;
  youId?: string;
  opponentId?: string;
  /** From your seat. The opponent's swing is the mirror. */
  eloDelta?: number | null;
  shared?: number | null;
  forfeit?: boolean;
  songTitle?: string;
  songArtist?: string;
  /** Fallback headline for solo takes (the coach kicker). */
  kicker: string;
  /** Gemini verdict, or the coach line when there is none. */
  caption: string;
};

function cardOf(card: ScoreCard): ReelCard {
  return {
    overall: card.overall,
    pitch: card.pitch,
    tone: card.tone,
    silence: card.silence,
  };
}

export function buildReelResults(input: ReelResultsInput): ReelResults {
  const reveal = input.revealOpponent ?? true;
  const youName = input.youName.trim() || "You";
  const oppName = input.opponentName?.trim() || "Them";
  const youWon = Boolean(input.winnerId && input.youId && input.winnerId === input.youId);
  const theyWon = Boolean(
    input.winnerId && input.opponentId && input.winnerId === input.opponentId,
  );
  const draw = input.winnerId === "draw";
  const elo = reveal && input.eloDelta != null ? input.eloDelta : null;

  const players: ReelPlayer[] = [
    { name: youName, card: cardOf(input.you), winner: youWon, eloDelta: elo },
  ];
  if (input.versus || input.opponent) {
    const card = input.opponent && reveal ? cardOf(input.opponent) : null;
    players.push({
      name: oppName,
      card,
      winner: theyWon,
      eloDelta: elo == null ? null : 0 - elo || 0,
      note: card
        ? undefined
        : input.opponentLeft
          ? "Left the match"
          : reveal
            ? "No score"
            : "Hidden",
    });
  }

  let headline: string;
  if (input.shared != null) headline = "Duet locked in";
  else if (draw) headline = "Draw";
  else if (youWon || theyWon) {
    const name = youWon ? youName : oppName;
    headline = input.forfeit ? `${name} wins by forfeit` : `${name} wins`;
  } else if (input.you.silence) headline = "Mic check";
  else headline = input.kicker || "Nice take";

  const expectOpponent = players.length > 1 && !input.opponentLeft && reveal;
  const opponentIn = !expectOpponent || Boolean(input.opponent);
  const youJudged = input.you.silence || input.you.source === "dsp+gemini";

  return {
    songTitle: input.songTitle?.trim() || "Karaoke",
    songArtist: input.songArtist?.trim() || "",
    headline,
    caption: input.caption.trim(),
    players,
    shared: input.shared ?? null,
    complete: opponentIn && youJudged,
  };
}

/** Results card length once it starts rolling. */
export const OutroMs = 4600;
/** Brand sting when no results ever arrived: still fades the music out. */
export const StingMs = 1800;
/** After the first scores land, how long to hold out for the Gemini line. */
export const EnrichGraceMs = 2500;
/** Longest the video waits on results before it closes with what it has. */
export const ResultsWaitMs = 12000;

export type OutroDecision = "wait" | "outro" | "sting";

/** Should a held reel keep waiting, roll the results card, or close on the sting? */
export function decideOutro(opts: {
  now: number;
  heldAt: number;
  firstResultsAt: number | null;
  complete: boolean;
}): OutroDecision {
  const waited = opts.now - opts.heldAt;
  if (opts.firstResultsAt == null) return waited >= ResultsWaitMs ? "sting" : "wait";
  if (opts.complete) return "outro";
  if (opts.now - opts.firstResultsAt >= EnrichGraceMs) return "outro";
  if (waited >= ResultsWaitMs) return "outro";
  return "wait";
}

export type OutroBeat = {
  /** 0 → last stage frame, 1 → results card. */
  mix: number;
  /** Count-up progress for the numbers and meters. */
  count: number;
  /** Headline and winner entrance. */
  headline: number;
  /** ELO swing and caption entrance. */
  details: number;
};

export const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const easeOut = (t: number) => 1 - (1 - clamp01(t)) ** 3;

/** Eased 0→1 progress of tMs through [from, to]. */
export const span = (tMs: number, from: number, to: number) => easeOut((tMs - from) / (to - from));

/** Timeline for the results card, in ms since the outro started. */
export function outroBeat(tMs: number): OutroBeat {
  return {
    mix: span(tMs, 0, 650),
    count: span(tMs, 350, 1450),
    headline: span(tMs, 1250, 1750),
    details: span(tMs, 1650, 2250),
  };
}

/** Instrumental tail gain over the outro: hold briefly, then ease to silence. */
export function tailGainAt(tMs: number, totalMs: number): number {
  const holdMs = Math.min(900, totalMs * 0.25);
  const fadeEnd = Math.max(holdMs + 1, totalMs - 150);
  if (tMs <= holdMs) return 1;
  if (tMs >= fadeEnd) return 0;
  const t = (tMs - holdMs) / (fadeEnd - holdMs);
  return (1 - t) ** 2;
}

export function shownScore(card: ReelCard | null, count: number): string {
  if (!card || card.silence) return "--";
  return String(Math.round(Math.max(0, Math.min(100, card.overall)) * clamp01(count)));
}
