/**
 * Merging the 750ms GET poll's matchOver into the one the socket delivered.
 *
 * The socket's match:over carries `rated` and `forfeit`; the GET snapshot
 * only adds `rated: false` for friendly rooms and never `forfeit`. A plain
 * `{...incoming}` dropped a thrown-away forfeit's rated:false (and the
 * forfeit flag) 750ms after it arrived. For the same match, keep what the
 * poll does not know; a different match replaces everything.
 */
import type { ScoreCard } from "@karaoke/shared";

export type MatchOver = {
  scores: Record<string, ScoreCard>;
  winnerId: string | null;
  eloDelta: number;
  forfeit?: boolean;
  /** Ranked: false when no ELO moved (friendly private room, or a forfeit under 5s). */
  rated?: boolean;
  /** Client-side tag: the room's matchId when this result arrived. */
  matchId?: number | null;
  /** Ranked: the match's seat A, which `eloDelta` is relative to (not room.players[0]). */
  seatAId?: string | null;
};

export function mergeMatchOver(prev: MatchOver | null, incoming: MatchOver): MatchOver {
  if (!prev) return incoming;
  if (prev.matchId != null && incoming.matchId != null && prev.matchId !== incoming.matchId) {
    return incoming;
  }
  const eloDelta =
    prev.eloDelta !== 0 && incoming.eloDelta === 0 ? prev.eloDelta : incoming.eloDelta;
  const scores =
    Object.keys(incoming.scores).length >= Object.keys(prev.scores).length
      ? incoming.scores
      : prev.scores;
  return {
    ...prev,
    ...incoming,
    eloDelta,
    scores,
    winnerId: incoming.winnerId ?? prev.winnerId,
    rated: incoming.rated ?? prev.rated,
    forfeit: incoming.forfeit ?? prev.forfeit,
    matchId: incoming.matchId ?? prev.matchId,
    seatAId: incoming.seatAId ?? prev.seatAId,
  };
}
