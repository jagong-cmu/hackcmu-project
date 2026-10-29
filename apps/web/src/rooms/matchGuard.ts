/**
 * Which match a room update belongs to, so a rematch never shows the old one.
 *
 * A rematch goes results → countdown on the server in one step (the socket
 * never sees "lobby"), and a new match always has a larger `matchId` (it is
 * the match's GO time). Updates can still arrive late: the 750ms GET poll
 * can answer from a snapshot that is one save behind, and another server
 * instance can replay the old match's clock:play or match:over. Before these
 * checks, a late "results" snapshot flipped the new match back to the old
 * results card, and a late clock re-seeked the audio into the old song or
 * stopped it, which also flushed the new take early.
 */
import type { Mode } from "@karaoke/shared";

/** The newest match this client has seen in its room. */
export type MatchMark = { code: string; matchId: number | null };

/** True when `incoming` is from an earlier match than the one we already hold. */
export function isOlderMatch(
  mark: MatchMark | null,
  code: string,
  incoming: number | null | undefined,
): boolean {
  if (!mark || mark.code !== code) return false;
  return mark.matchId != null && incoming != null && incoming < mark.matchId;
}

/** True when `incoming` starts a later match than the one we hold (clear the old results). */
export function isNewerMatch(
  mark: MatchMark | null,
  code: string,
  incoming: number | null | undefined,
): boolean {
  if (!mark || mark.code !== code) return false;
  return mark.matchId != null && incoming != null && incoming > mark.matchId;
}

/** Move the mark forward (never back) for an accepted room update. */
export function advanceMark(
  mark: MatchMark | null,
  code: string,
  matchId: number | null | undefined,
): MatchMark {
  if (!mark || mark.code !== code) return { code, matchId: matchId ?? null };
  if (matchId == null || (mark.matchId != null && matchId <= mark.matchId)) return mark;
  return { code, matchId };
}

/**
 * A Ranked/Duet clock whose downbeat is before the current match's GO is the
 * previous match's. Every clip in a match plays at or after its matchId
 * (turn A at GO, turn B after the swap). Chaos has no matchId.
 */
export function isStaleClock(
  room: { mode: Mode; matchId?: number | null } | null,
  mark: MatchMark | null,
  clock: { playAtUnixMs: number },
): boolean {
  if (!room || room.mode === "chaos") return false;
  const current = Math.max(room.matchId ?? 0, mark?.matchId ?? 0);
  return current > 0 && clock.playAtUnixMs < current;
}
