/** Socket.IO event names. Keep payloads in sync with TECHNICAL_PRD.md §5.2 */

export const ClientEvents = {
  playerHello: "player:hello",
  queueJoin: "queue:join",
  queueLeave: "queue:leave",
  roomCreate: "room:create",
  roomJoin: "room:join",
  roomLeave: "room:leave",
  roomReady: "room:ready",
  /** Results screen: propose a rematch, or accept the opponent's open offer. */
  rematchRequest: "rematch:request",
  /** Results screen: withdraw your own offer, or decline the opponent's. */
  rematchCancel: "rematch:cancel",
  chaosJoin: "chaos:join",
  pitchLive: "pitch:live",
  /** Ask for this room's safety state (host, vote tallies, my blocks). Acked with SafetyState. */
  safetySync: "safety:sync",
  /** Report someone in your room. Payload: SafetyReportRequest. Acked with SafetyAck. */
  safetyReport: "safety:report",
  /** Block someone. Payload: { targetId }. Stored per player; you are never matched again. */
  safetyBlock: "safety:block",
  /** Remove someone: host kick in private rooms, a vote in Chaos. Payload: { targetId }. */
  safetyKick: "safety:kick",
  /**
   * Ranked/Duet: leave after blocking or reporting the opponent. Free from the
   * lobby; mid-match in a rated room it is a forfeit, like any other leave.
   */
  safetyLeave: "safety:leave",
} as const;

export const ServerEvents = {
  playerOk: "player:ok",
  roomState: "room:state",
  matchFound: "match:found",
  queueWaiting: "queue:waiting",
  clockPlay: "clock:play",
  scoreReady: "score:ready",
  matchOver: "match:over",
  pitchLive: "pitch:live",
  /** Room-level SafetyState, broadcast when the host or a vote tally changes. */
  safetyState: "safety:state",
  /** You were removed from a room and cannot rejoin it. Payload: SafetyRemoved. */
  safetyRemoved: "safety:removed",
  /** A safety action changed your room (opponent left, someone was removed). SafetyNotice. */
  safetyNotice: "safety:notice",
  error: "error",
} as const;

/** `error` code when a removed player tries to rejoin that room. */
export const RemovedFromRoomCode = "REMOVED_FROM_ROOM";

export const ReportReasons = [
  "harassment",
  "sexual",
  "hate",
  "violence",
  "underage",
  "spam",
  "other",
] as const;
export const ReportNoteMax = 280;
/** Per reporter: at most ReportLimit reports per ReportWindowMs. */
export const ReportLimit = 5;
export const ReportWindowMs = 10 * 60_000;
/** Per player: at most BlockLimit blocks per ReportWindowMs. */
export const BlockLimit = 20;
/** Lifetime cap on how many players one player can block. */
export const MaxBlockedPlayers = 10;
/**
 * Chaos vote-kick: votes needed to remove someone, given how many *other*
 * people are live in the room. A strict majority, never fewer than 2, so one
 * person can never remove another alone.
 */
export function votesToRemove(othersLive: number): number {
  return Math.max(2, Math.floor(othersLive / 2) + 1);
}
/** A room ban lasts as long as a LiveKit token, so a 4-digit code can be reused later. */
export const RoomBanMs = 2 * 60 * 60_000;

export const ScorePostPath = "/api/turns/:roomId/score";
export const DemoRoomCode = "0000";

/** Public Chaos lounges are `chaos-1`, `chaos-2`, … — players never pick one. */
export const PublicChaosPrefix = "chaos-";

export function isPublicChaosCode(code: string): boolean {
  return /^chaos-\d+$/.test(code);
}

export function publicChaosIndex(code: string): number | null {
  const match = /^chaos-(\d+)$/.exec(code);
  return match ? Number(match[1]) : null;
}

export function chaosLoungeName(code: string): string | undefined {
  const index = publicChaosIndex(code);
  return index == null ? undefined : `Lounge ${index}`;
}

export const StartingElo = 1000;
export const EloK = 32;
export const ForfeitEloK = 16;
export const ForfeitSkipMs = 5000;
/**
 * Pre-match countdown: two seats filled (or a rematch accepted) → GO.
 * Server arms the clip this far out; the stage veil and copy derive from it.
 * Replaces the old unused-by-matches `CountdownMs` (only Training read it, ×2).
 */
export const MatchCountdownMs = 5000;
/**
 * Every Ranked / Duet / Training clip starts this long before its anchor line
 * (first lyric or chorus, picked 50/50), so the music comes in before the
 * words. Part of the clip, after GO; never scored. Clamped at 0:00 for songs
 * that start singing sooner.
 */
export const ClipLeadInMs = 5000;
/** Longest ranked hook that is actually sung, after the lead-in. */
export const RankedHookMaxSec = 20;
/** Hard cap on a whole ranked clip: lead-in + hook. */
export const RankedClipMaxSec = RankedHookMaxSec + ClipLeadInMs / 1000;
/** Click-track fallback only. Live ranked length is each song's 15–20s chorus hook. */
export const RankedClipMs = 15000;
export const SwapMs = 5000;
/** How long a rematch offer stays open for the opponent to accept. */
export const RematchWindowMs = 8000;
export const ClockLeadMs = 400;
export const MaxDriftSec = 0.15;
export const ChaosCap = 100;
export const RankedCap = 2;
