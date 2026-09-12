/** Socket.IO event names. Keep payloads in sync with TECHNICAL_PRD.md §5.2 */

export const ClientEvents = {
  playerHello: "player:hello",
  queueJoin: "queue:join",
  roomCreate: "room:create",
  roomJoin: "room:join",
  roomReady: "room:ready",
  chaosJoin: "chaos:join",
} as const;

export const ServerEvents = {
  playerOk: "player:ok",
  roomState: "room:state",
  matchFound: "match:found",
  clockPlay: "clock:play",
  scoreReady: "score:ready",
  matchOver: "match:over",
  error: "error",
} as const;

export const ScorePostPath = "/api/turns/:roomId/score";
export const DemoRoomCode = "0000";
export const PublicChaosCode = "chaos";
export const StartingElo = 1000;
export const EloK = 32;
export const ForfeitEloK = 16;
export const ForfeitSkipMs = 5000;
export const CountdownMs = 3000;
export const RankedClipMs = 15000;
export const SwapMs = 2000;
export const ClockLeadMs = 400;
export const MaxDriftSec = 0.15;
export const ChaosCap = 8;
export const RankedCap = 2;
