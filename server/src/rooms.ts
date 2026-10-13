/**
 * LANE A — in-memory room registry.
 *
 * Rooms live in process memory only. Render Free sleeps and wipes them; that is
 * accepted (TECHNICAL_PRD §6). Persistence is Lane B's Atlas layer and only
 * covers players/matches, never live room state.
 */
import {
  ChaosCap,
  DemoRoomCode,
  ForfeitSkipMs,
  isPublicChaosCode,
  PublicChaosPrefix,
  publicChaosIndex,
  RankedCap,
  StartingElo,
  type ClipAnchor,
  type Mode,
  type PlayerPublic,
  type RematchLapse,
  type RematchOffer,
  type RoomState,
  type RoomStatus,
  type ScoreCard,
} from "@karaoke/shared";
import { logOnce } from "./hardening.ts";

export type Player = PlayerPublic & {
  /**
   * Server-only. The verified identity this seat belongs to (Supabase user id
   * with auth on, else the browser's secret clientId). Never put it in
   * toPublic(): in guest mode it is the credential that plays as you.
   */
  clientId: string;
  socketId: string;
  ready: boolean;
  connected: boolean;
  lastSeenMs: number;
};

export type Room = {
  code: string;
  mode: Mode;
  players: Player[];
  songId: string | null;
  status: RoomStatus;
  activeSingerId: string | null;
  playAtUnixMs: number | null;

  /** Permanent rooms (0000) survive going empty. */
  persistent: boolean;

  /**
   * Ranked only: does a match here move ELO? Fixed when the room is made and
   * kept across rematches. Queue (matchmaking) rooms and the 0000 demo room
   * are rated; private rooms (room:create) are friendly and unrated.
   * Persisted in the room snapshot so every isolate agrees.
   */
  rated: boolean;
  /** Made with a shareable code (room:create, or a typed 4-digit Chaos code). In the snapshot. */
  isPrivate: boolean;
  /** Public id of whoever made a private room; they may kick. In the snapshot. */
  hostId: string | null;

  /** Clip window currently scheduled, for late-join playhead math. */
  clipStartSec: number;
  clipDurationSec: number;
  /** Instrumental lead-in at the top of the clip (anchor − clipStartSec). */
  clipLeadInSec: number;
  /** Which anchor this match's clip starts from. Null in Chaos / before a match. */
  clipAnchor: ClipAnchor | null;

  /** Wall clock of the last clock:play, for chaos late-join seeking. */
  songStartedAtMs: number | null;

  /** Set when the countdown fires, for the <5s forfeit rule. */
  matchStartedAtMs: number | null;

  /**
   * Identifies one Ranked/Duet match across isolates: the scheduled start of
   * the first clip (the countdown's playAt), fixed by startMatch and never
   * re-armed by the swap. Scores and the settlement claim are keyed on it.
   */
  matchId: number | null;

  scores: Map<string, ScoreCard>;
  timers: Set<NodeJS.Timeout>;

  /** First-seated player's ELO delta; Lane B fills this before match:over. */
  lastEloDelta: number;
  /**
   * This isolate only: the seated roster captured when a seat left during the
   * score wait, so the match still settles with both seats. Cleared per match.
   */
  settleSeats: { matchId: number; seats: Player[] } | null;
  /**
   * The match roster as it stood when the match began (seat order, public id,
   * identity, rating then). In the snapshot, so any isolate can settle the
   * match with both seats even after one left (or was dropped by a snapshot
   * merge). Keyed by matchId; ignored for any other match.
   */
  matchSeats: { matchId: number; seats: MatchSeat[] } | null;
  /** Settled winner (or null for a draw). Survives the loser being removed. */
  lastWinnerId: string | null;
  /**
   * The settled result for `result.matchId` (what match:over carried). Only a
   * result for the current matchId means "settled" to clients (GET /api/rooms).
   */
  result: MatchResult | null;
  /**
   * This isolate only: the matchId finishMatch is settling (or settled) here.
   * Set synchronously on entry, so overlapping local calls (score-wait timer,
   * last POST, a leave) emit match:over once.
   */
  settlingMatchId: number | null;
  /**
   * This isolate only: when the score wait for `matchId` settles at the
   * latest. One wait per match (awaitScores is idempotent); a leaver's grace
   * can only bring it forward. advanceDue settles past it if the timer died.
   */
  scoreWait: { matchId: number; dueAtMs: number } | null;

  /** True once match:over has been emitted, so late POSTs cannot double-settle. */
  settled: boolean;

  /** Open rematch offer on the results screen (see rematch.ts). Both seats must confirm. */
  rematch: RematchOffer | null;
  /** Why the last rematch offer closed without a match. Kept for client messaging. */
  rematchLapse: RematchLapse | null;
};

/** One seat of a match's roster (Room.matchSeats). */
export type MatchSeat = { id: string; clientId: string; displayName: string; elo: number };

/** A settled match: the match:over payload plus the match it settles. */
export type MatchResult = {
  matchId: number;
  scores: Record<string, ScoreCard>;
  winnerId: string | null;
  /** ELO change for seat A (`seatAId`); seat B moved by the negation. */
  eloDelta: number;
  forfeit?: boolean;
  rated?: boolean;
  /** Public id of the first seat of the match, which `eloDelta` is relative to. */
  seatAId?: string | null;
};

const rooms = new Map<string, Room>();

export function capacityFor(mode: Mode): number {
  return mode === "chaos" ? ChaosCap : RankedCap;
}

function blankRoom(code: string, mode: Mode, persistent: boolean): Room {
  return {
    code,
    mode,
    players: [],
    songId: null,
    status: "lobby",
    activeSingerId: null,
    playAtUnixMs: null,
    persistent,
    rated: true,
    isPrivate: false,
    hostId: null,
    clipStartSec: 0,
    clipDurationSec: 0,
    clipLeadInSec: 0,
    clipAnchor: null,
    songStartedAtMs: null,
    matchStartedAtMs: null,
    matchId: null,
    scores: new Map(),
    timers: new Set(),
    lastEloDelta: 0,
    settleSeats: null,
    matchSeats: null,
    lastWinnerId: null,
    result: null,
    settlingMatchId: null,
    scoreWait: null,
    settled: false,
    rematch: null,
    rematchLapse: null,
  };
}

export function createRoom(mode: Mode, code?: string, persistent = false): Room {
  const roomCode = code ?? generateCode();
  const room = blankRoom(roomCode, mode, persistent);
  rooms.set(roomCode, room);
  return room;
}

/**
 * A blank room that is not registered on this instance yet. createSharedRoom
 * (liveState.ts) reserves its code in Mongo first, then calls registerRoom.
 */
export function draftRoom(mode: Mode, code: string): Room {
  return blankRoom(code, mode, false);
}

export function registerRoom(room: Room): Room {
  rooms.set(room.code, room);
  return room;
}

export function getRoom(code: string): Room | undefined {
  return rooms.get(code);
}

export function allRooms(): Room[] {
  return [...rooms.values()];
}

export function randomRoomCode(): string {
  return String(Math.floor(Math.random() * 10000)).padStart(4, "0");
}

/**
 * A code free on this instance only. Other instances may hold it: with Mongo,
 * new rooms take their code from liveState's createSharedRoom instead.
 */
export function generateCode(): string {
  for (let attempt = 0; attempt < 200; attempt++) {
    const code = randomRoomCode();
    if (!rooms.has(code)) return code;
  }
  throw new Error("room code space exhausted");
}

/** `0000` survives going empty. Public Chaos lounges are created on demand. */
export function ensurePermanentRooms(): void {
  if (!rooms.has(DemoRoomCode)) createRoom("ranked", DemoRoomCode, true);
}

/**
 * Seat the next public Chaos joiner. Fill the lowest-index lounge that still
 * has space; open `chaos-N+1` when the current one hits ChaosCap.
 */
export function findOpenPublicChaosLounge(): Room {
  const lounges = allRooms()
    .filter((room) => room.mode === "chaos" && isPublicChaosCode(room.code))
    .sort((a, b) => (publicChaosIndex(a.code) ?? 0) - (publicChaosIndex(b.code) ?? 0));

  const open = lounges.find((room) => !isFull(room));
  if (open) return open;

  let next = 1;
  while (getRoom(`${PublicChaosPrefix}${next}`)) next += 1;
  return createRoom("chaos", `${PublicChaosPrefix}${next}`, false);
}

export const PlayerIdleMs = 45_000;

export function touchPlayer(player: Player): void {
  player.lastSeenMs = Date.now();
  player.connected = true;
}

export function livePlayers(room: Room): Player[] {
  const now = Date.now();
  return room.players.filter((p) => p.connected && now - p.lastSeenMs < PlayerIdleMs);
}

export function addPlayer(
  room: Room,
  player: Omit<Player, "ready" | "connected" | "elo" | "lastSeenMs"> & { elo?: number },
): Player {
  const existing = room.players.find((p) => p.clientId === player.clientId);
  if (existing) {
    // Reconnect or second tab with the same client id: rebind the socket
    // rather than seating a duplicate.
    existing.socketId = player.socketId;
    existing.displayName = player.displayName;
    existing.connected = true;
    existing.lastSeenMs = Date.now();
    return existing;
  }
  const seated: Player = {
    ...player,
    elo: player.elo ?? StartingElo,
    ready: false,
    connected: true,
    lastSeenMs: Date.now(),
  };
  // Back during the same match (e.g. a results-phase reconnect): take the
  // original seat, so seat A stays seat A for settlement and the client.
  const seatIndex = currentMatchSeats(room)?.findIndex((s) => s.clientId === player.clientId) ?? -1;
  if (seatIndex >= 0) room.players.splice(Math.min(seatIndex, room.players.length), 0, seated);
  else room.players.push(seated);
  return seated;
}

export function removePlayer(room: Room, playerId: string): Player | undefined {
  const index = room.players.findIndex((p) => p.id === playerId);
  if (index === -1) return undefined;
  const [removed] = room.players.splice(index, 1);
  return removed;
}

export function isFull(room: Room): boolean {
  // Chaos can walk in/out, so only live bodies count. Ranked/Duet keep the
  // seated roster so a disconnect mid-match cannot free a third chair.
  if (room.mode === "chaos") return livePlayers(room).length >= capacityFor(room.mode);
  return room.players.length >= capacityFor(room.mode);
}

/**
 * Drop idle or explicitly disconnected seats.
 * A socket that is not on this isolate is not dead — Vercel has one Socket.IO
 * per function, so the opponent is almost always "not connected" here.
 */
export function dropDeadPlayers(
  room: Room,
  isLive: (socketId: string) => boolean,
  idleMs = PlayerIdleMs,
): Player[] {
  const now = Date.now();
  const removed: Player[] = [];
  room.players = room.players.filter((player) => {
    if (isLive(player.socketId)) {
      player.connected = true;
      return true;
    }
    const stale = now - (player.lastSeenMs || 0) > idleMs;
    if (!stale && player.connected) return true;
    removed.push(player);
    return false;
  });
  return removed;
}

export function clearTimers(room: Room): void {
  for (const timer of room.timers) clearTimeout(timer);
  room.timers.clear();
}

export function later(room: Room, ms: number, fn: () => void): NodeJS.Timeout {
  const timer = setTimeout(() => {
    room.timers.delete(timer);
    // A throw in a room timer is logged, never an uncaught exception.
    try {
      fn();
    } catch (err) {
      logOnce("room timer")(err);
    }
  }, ms);
  room.timers.add(timer);
  return timer;
}

/**
 * Drop a room once the last player leaves, unless it is 0000. A room on its
 * score wait is kept until it settles (both seats may leave before their
 * cards land); the sweep disposes it after.
 */
export function disposeIfEmpty(room: Room): void {
  if (room.persistent || room.players.length > 0) return;
  if (awaitingSettlement(room)) return;
  clearTimers(room);
  rooms.delete(room.code);
}

export function resetToLobby(room: Room): void {
  clearTimers(room);
  room.status = "lobby";
  // Keep songId so the next match can skip repeating the last track.
  room.activeSingerId = null;
  room.playAtUnixMs = null;
  room.songStartedAtMs = null;
  room.matchStartedAtMs = null;
  room.matchId = null;
  // The next match flips its own anchor.
  room.clipAnchor = null;
  room.clipLeadInSec = 0;
  room.scores.clear();
  room.lastEloDelta = 0;
  room.settleSeats = null;
  room.matchSeats = null;
  room.lastWinnerId = null;
  room.result = null;
  room.scoreWait = null;
  room.settled = false;
  room.rematch = null;
  room.rematchLapse = null;
  for (const player of room.players) player.ready = false;
}

/**
 * A Ranked/Duet match is being sung: counting down, singing, or swapping.
 * Leaving now is a forfeit. The results screen is never a forfeit (see
 * awaitingSettlement).
 */
export function matchInProgress(room: Room): boolean {
  if (room.mode === "chaos") return false;
  return (
    room.status === "countdown" ||
    room.status === "turnA" ||
    room.status === "swap" ||
    room.status === "turnB" ||
    room.status === "live"
  );
}

/**
 * Both turns are over and the result is not settled yet (the score wait on
 * the results screen). A seat that leaves now is still counted: the match
 * settles on the scores, its own card or the empty-score fallback.
 */
export function awaitingSettlement(room: Room): boolean {
  return room.mode !== "chaos" && room.status === "results" && !room.settled && room.matchId != null;
}

/** The current match's roster (startMatch), or null (no match, or an older snapshot). */
export function currentMatchSeats(room: Room): MatchSeat[] | null {
  const held = room.matchSeats;
  if (!held || room.matchId == null || held.matchId !== room.matchId) return null;
  return held.seats;
}

/**
 * The seats a settlement counts, in match seat order (seat A first). With
 * the match roster: each seat's live Player here if seated, else the one
 * forfeitFor held, else one rebuilt from the roster (it left on another
 * isolate). Without one: the roster held at a score-wait leave, else whoever
 * is seated.
 */
export function seatsForSettlement(room: Room): Player[] {
  const held = room.settleSeats && room.settleSeats.matchId === room.matchId ? room.settleSeats.seats : null;
  const roster = currentMatchSeats(room);
  if (roster && roster.length >= 2) {
    return roster.map(
      (seat) =>
        room.players.find((p) => p.id === seat.id) ??
        held?.find((p) => p.id === seat.id) ?? {
          ...seat,
          socketId: "pending",
          ready: false,
          connected: false,
          lastSeenMs: 0,
        },
    );
  }
  if (held && held.length >= room.players.length) return held.slice();
  return room.players.slice();
}

/**
 * The public seat id a clientId sang under in the current match, even if it
 * is no longer seated: only while the match awaits settlement, so a leaver's
 * in-flight card still counts.
 */
export function heldSeatId(room: Room, clientId: string): string | undefined {
  if (!awaitingSettlement(room)) return undefined;
  const fromRoster = currentMatchSeats(room)?.find((s) => s.clientId === clientId);
  if (fromRoster) return fromRoster.id;
  const held = room.settleSeats && room.settleSeats.matchId === room.matchId ? room.settleSeats.seats : [];
  return held.find((p) => p.clientId === clientId)?.id;
}

/** Seat index (0 = A, 1 = B) of `playerId` in the current match. */
export function matchSeatIndex(room: Room, playerId: string): number {
  const roster = currentMatchSeats(room);
  if (roster) return roster.findIndex((s) => s.id === playerId);
  const live = room.players.findIndex((p) => p.id === playerId);
  if (live !== -1) return live;
  const held = room.settleSeats && room.settleSeats.matchId === room.matchId ? room.settleSeats.seats : [];
  return held.findIndex((p) => p.id === playerId);
}

/**
 * A forfeit right now would move ELO: a rated Ranked room, mid-match, at
 * least ForfeitSkipMs after the first clip began (shorter ones are thrown
 * away, PRD §6.1).
 */
export function forfeitWouldRate(room: Room, now = Date.now()): boolean {
  if (room.mode !== "ranked" || !room.rated || !matchInProgress(room)) return false;
  if (room.matchStartedAtMs === null) return false;
  return now - room.matchStartedAtMs >= ForfeitSkipMs;
}

/**
 * Seconds into the current clip right now. Chaos uses this so a late joiner
 * seeks to where everyone else already is.
 */
export function playheadSec(room: Room): number {
  if (room.songStartedAtMs === null) return 0;
  const elapsed = (Date.now() - room.songStartedAtMs) / 1000;
  if (elapsed <= 0) return room.clipStartSec;
  return room.clipStartSec + Math.min(elapsed, room.clipDurationSec);
}

export function toPublic(room: Room): RoomState {
  return {
    code: room.code,
    mode: room.mode,
    // Public id only. clientId stays on the server (see Player).
    players: room.players.map(({ id, displayName, elo, ready }) => ({
      id,
      displayName,
      elo,
      ready,
    })),
    songId: room.songId,
    status: room.status,
    activeSingerId: room.activeSingerId,
    playAtUnixMs: room.playAtUnixMs,
    playheadSec: playheadSec(room),
    clipAnchor: room.clipAnchor,
    clipStartSec: room.clipStartSec,
    clipDurationSec: room.clipDurationSec,
    clipLeadInSec: room.clipLeadInSec,
    matchId: room.matchId,
    rematch: room.rematch,
    rematchLapse: room.rematchLapse,
    rated: room.rated,
    isPrivate: room.isPrivate,
  };
}
