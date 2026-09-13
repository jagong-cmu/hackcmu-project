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
  isPublicChaosCode,
  PublicChaosPrefix,
  publicChaosIndex,
  RankedCap,
  StartingElo,
  type Mode,
  type PlayerPublic,
  type RoomState,
  type RoomStatus,
  type ScoreCard,
} from "@karaoke/shared";

export type Player = PlayerPublic & {
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

  /** Clip window currently scheduled, for late-join playhead math. */
  clipStartSec: number;
  clipDurationSec: number;

  /** Wall clock of the last clock:play, for chaos late-join seeking. */
  songStartedAtMs: number | null;

  /** Set when the countdown fires, for the <5s forfeit rule. */
  matchStartedAtMs: number | null;

  scores: Map<string, ScoreCard>;
  timers: Set<NodeJS.Timeout>;

  /** First-seated player's ELO delta; Lane B fills this before match:over. */
  lastEloDelta: number;
  /** Settled winner (or null for a draw). Survives the loser being removed. */
  lastWinnerId: string | null;

  /** True once match:over has been emitted, so late POSTs cannot double-settle. */
  settled: boolean;

  /** Wall clock leftover from an older auto-rematch; results now stay until someone taps Rematch. */
  rematchAtMs: number | null;
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
    clipStartSec: 0,
    clipDurationSec: 0,
    songStartedAtMs: null,
    matchStartedAtMs: null,
    scores: new Map(),
    timers: new Set(),
    lastEloDelta: 0,
    lastWinnerId: null,
    settled: false,
    rematchAtMs: null,
  };
}

export function createRoom(mode: Mode, code?: string, persistent = false): Room {
  const roomCode = code ?? generateCode();
  const room = blankRoom(roomCode, mode, persistent);
  rooms.set(roomCode, room);
  return room;
}

export function getRoom(code: string): Room | undefined {
  return rooms.get(code);
}

export function allRooms(): Room[] {
  return [...rooms.values()];
}

export function generateCode(): string {
  for (let attempt = 0; attempt < 200; attempt++) {
    const code = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
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
  room.players.push(seated);
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
    fn();
  }, ms);
  room.timers.add(timer);
  return timer;
}

/** Drop a room once the last player leaves, unless it is 0000. */
export function disposeIfEmpty(room: Room): void {
  if (room.persistent || room.players.length > 0) return;
  clearTimers(room);
  rooms.delete(room.code);
}

export function resetToLobby(room: Room): void {
  clearTimers(room);
  room.status = "lobby";
  room.songId = null;
  room.activeSingerId = null;
  room.playAtUnixMs = null;
  room.songStartedAtMs = null;
  room.matchStartedAtMs = null;
  room.scores.clear();
  room.lastEloDelta = 0;
  room.lastWinnerId = null;
  room.settled = false;
  room.rematchAtMs = null;
  for (const player of room.players) player.ready = false;
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
    players: room.players.map(({ id, clientId, displayName, elo, ready }) => ({
      id,
      clientId,
      displayName,
      elo,
      ready,
    })),
    songId: room.songId,
    status: room.status,
    activeSingerId: room.activeSingerId,
    playAtUnixMs: room.playAtUnixMs,
    playheadSec: playheadSec(room),
  };
}
