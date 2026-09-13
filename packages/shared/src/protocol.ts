/** Socket.IO event names. Keep payloads in sync with TECHNICAL_PRD.md §5.2 */

export const ClientEvents = {
  playerHello: "player:hello",
  queueJoin: "queue:join",
  queueLeave: "queue:leave",
  roomCreate: "room:create",
  roomJoin: "room:join",
  roomLeave: "room:leave",
  roomReady: "room:ready",
  chaosJoin: "chaos:join",
  pitchLive: "pitch:live",
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
  error: "error",
} as const;

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
export const ClockLeadMs = 400;
export const MaxDriftSec = 0.15;
export const ChaosCap = 100;
export const RankedCap = 2;
