/**
 * Which "take" (one scored clip by this player) the room is in right now.
 *
 * The key is matchId + seat + status, never playAtUnixMs:
 * each server instance arms turn B with its own Date.now() + SwapMs, so a
 * socket room:state and a poll from another instance disagree on playAt
 * for the same turn. Keying on it restarted the take mid-POST with empty
 * frames and raced a silent card against the real one.
 */
import type { RoomState } from "@karaoke/shared";

export function isScoringClip(room: RoomState | null, myPlayerId: string | null): boolean {
  if (!room || !myPlayerId || room.mode === "chaos") return false;
  if (room.mode === "duet") return room.status === "live";
  return (
    (room.status === "turnA" || room.status === "turnB") &&
    room.activeSingerId === myPlayerId
  );
}

/** The current take's key, or null when this player is not being scored. */
export function takeKey(room: RoomState | null, myPlayerId: string | null): string | null {
  if (!room || !myPlayerId || !isScoringClip(room, myPlayerId)) return null;
  // Ranked: being scored means I am the active singer, so the seat plus
  // turnA/turnB names the clip. Duet: one "live" clip per match.
  // No matchId (an older server): fall back to playAt so a rematch is still a
  // new take. Every current server sends matchId for Ranked/Duet.
  const match = room.matchId ?? `p${room.playAtUnixMs ?? ""}`;
  return `${match}:${myPlayerId}:${room.status}`;
}

/**
 * Whether to start a fresh take for `key`. A take that already started this
 * mount (singing, score in flight, or posted) never restarts, even if an
 * out-of-order room update briefly flips status back to it.
 */
export function shouldStartTake(key: string | null, started: ReadonlySet<string>): key is string {
  return key !== null && !started.has(key);
}
