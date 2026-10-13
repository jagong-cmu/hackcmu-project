/**
 * What leaving the 1v1 does right now, mirroring the server's
 * forfeitWouldRate (server/src/rooms.ts): a rated Ranked room, mid-match,
 * at least ForfeitSkipMs after the first clip began. A leave before that
 * (countdown, the first seconds of turn A) throws the match away with no
 * rating change. On results before settlement the match still counts on the
 * scores; everywhere else (lobby, Duet, friendly rooms, settled) nothing.
 *
 * The server stamps matchStartedAtMs when the countdown ends, which is the
 * scheduled first-clip start it published as matchId (clock.ts startMatch:
 * matchId = goAt, beginClip fires at goAt). RoomState has no exact start
 * field, so matchId stands in, read against server time.
 */
import { ForfeitSkipMs, type RoomState } from "@karaoke/shared";

export type LeaveEffect = "forfeit" | "scored" | "free";

/**
 * Warn a little early rather than late: clock-sync error and a late timer
 * on the server both mean the client could undercount elapsed time.
 */
export const ForfeitWarnSlackMs = 250;

const Sung: ReadonlySet<RoomState["status"]> = new Set(["turnA", "swap", "turnB"]);

export function leaveEffectOf(
  room: Pick<RoomState, "mode" | "rated" | "status" | "matchId"> | null,
  settled: boolean,
  serverNowMs: number,
): LeaveEffect {
  if (!room || room.mode !== "ranked" || room.rated === false) return "free";
  if (room.status === "results") return settled ? "free" : "scored";
  if (!Sung.has(room.status) || room.matchId == null) return "free";
  return serverNowMs - room.matchId >= ForfeitSkipMs - ForfeitWarnSlackMs ? "forfeit" : "free";
}

/**
 * Ms until a "free" mid-match leave turns into a forfeit, so the label can
 * re-render then. Null when it never will on its own.
 */
export function msUntilForfeit(
  room: Pick<RoomState, "mode" | "rated" | "status" | "matchId"> | null,
  serverNowMs: number,
): number | null {
  if (!room || room.mode !== "ranked" || room.rated === false) return null;
  if (room.status !== "countdown" && !Sung.has(room.status)) return null;
  if (room.matchId == null) return null;
  const left = room.matchId + ForfeitSkipMs - ForfeitWarnSlackMs - serverNowMs;
  return left > 0 ? left : null;
}

/** The short suffix on every "leave the match" control. */
export function leaveSuffix(effect: LeaveEffect): string {
  return effect === "forfeit"
    ? "counts as a forfeit"
    : effect === "scored"
      ? "result still counts"
      : "no rating change";
}
