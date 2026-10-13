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
  /** Ranked/Duet: leave with no rating change after blocking or reporting the opponent. */
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
export const CountdownMs = 5000;
/** Click-track fallback only. Live ranked length is each song's 15–20s chorus hook. */
export const RankedClipMs = 15000;
export const SwapMs = 5000;
/** How long a rematch offer stays open for the opponent to accept. */
export const RematchWindowMs = 8000;
export const ClockLeadMs = 400;
export const MaxDriftSec = 0.15;
export const ChaosCap = 100;
export const RankedCap = 2;
