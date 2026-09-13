/**
 * LANE A — shared clock and the Ranked/Duet/Chaos state machines.
 *
 * Every client plays its own local <audio>. The server only broadcasts *when*
 * to press play (`playAtUnixMs`), never the audio itself. The instrumental must
 * never touch WebRTC (TECHNICAL_PRD §6).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Server } from "socket.io";
import {
  ClockLeadMs,
  ForfeitSkipMs,
  EloK,
  ForfeitEloK,
  ServerEvents,
  SONGS,
  StartingElo,
  SwapMs,
  songById,
  type ScoreCard,
  type SongMeta,
} from "@karaoke/shared";
import {
  clearTimers,
  later,
  livePlayers,
  toPublic,
  type Player,
  type Room,
} from "./rooms.ts";
import { ensureRoom, saveRoomSnap } from "./liveState.ts";
import { persistSeatedMatch } from "./judge.ts";
import { eloDelta, outcomeFromScores } from "./elo.ts";

const songDirs = [
  path.resolve(process.cwd(), "apps/web/public/songs"),
  path.resolve(process.cwd(), "apps/web/dist/songs"),
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../apps/web/public/songs"),
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../apps/web/dist/songs"),
].filter((dir, i, all) => existsSync(dir) && all.indexOf(dir) === i);

function songAssetsDir(id: string): string | undefined {
  return songDirs.find(
    (dir) =>
      existsSync(path.join(dir, id, "instrumental.mp3")) &&
      existsSync(path.join(dir, id, "melody.json")),
  );
}

function songFile(id: string, name: string): string | undefined {
  for (const dir of songDirs) {
    const file = path.join(dir, id, name);
    if (existsSync(file)) return file;
  }
  return undefined;
}

/** Ranked/Duet lobby wait before GO. Shared CountdownMs stays 5s for other beats. */
const MatchCountdownMs = 10_000;
/** Last-chance wait for in-flight POSTs across Vercel isolates. */
const SCORE_WAIT_MS = 8000;

/**
 * Fallback when a client never POSTs. Silence, not a fake 80, so ELO still
 * moves instead of locking both singers into a draw.
 */
const STUB_SCORE: ScoreCard = {
  overall: 0,
  pitch: 0,
  tone: 0,
  silence: true,
  verdict: "",
  source: "dsp",
};

/**
 * Click track so clock work is not blocked on Lane B's song files.
 * Enable with USE_TEST_SONG=1. Lives at apps/web/public/songs/_test/.
 */
const TEST_SONG: SongMeta = {
  id: "_test",
  title: "Click Track",
  artist: "Lane A",
  clipStartSec: 0,
  clipDurationSec: 15,
  duetClipStartSec: 0,
  duetClipDurationSec: 45,
  chaosDurationSec: 60,
};

/** Hard cap so a stale meta.json cannot turn Ranked back into a full verse. */
const RankedClipMaxSec = 20;

/** Ranked: the song's 15–20s chorus hook. Duet: the whole track. */
function clipWindow(song: SongMeta, kind: "ranked" | "duet"): { startSec: number; durationSec: number } {
  if (kind === "duet") {
    return { startSec: 0, durationSec: Math.max(1, song.duetClipDurationSec) };
  }
  return {
    startSec: Math.max(0, song.clipStartSec),
    durationSec: Math.min(RankedClipMaxSec, Math.max(1, song.clipDurationSec)),
  };
}

function useTestSong(): boolean {
  return process.env.USE_TEST_SONG === "1";
}

function metaFromDisk(id: string): SongMeta | undefined {
  const file = songFile(id, "meta.json");
  if (!file) return undefined;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as SongMeta;
  } catch {
    return undefined;
  }
}

function songPool(): SongMeta[] {
  const testFile = songFile(TEST_SONG.id, "instrumental.mp3");
  if (useTestSong() && testFile) return [TEST_SONG];
  const onDisk = SONGS.filter((s) => songAssetsDir(s.id));
  return onDisk.length > 0 ? onDisk : SONGS;
}

function resolvedMeta(song: SongMeta): SongMeta {
  return metaFromDisk(song.id) ?? song;
}

/** Random catalog pick. Skip the song that just played when we have a choice. */
function pickSong(avoidId?: string | null): SongMeta {
  const pool = songPool();
  if (pool.length === 0) return TEST_SONG;
  const choices = avoidId && pool.length > 1 ? pool.filter((s) => s.id !== avoidId) : pool;
  const song = choices[Math.floor(Math.random() * choices.length)] ?? pool[0];
  if (!song) return TEST_SONG;
  return resolvedMeta(song);
}

function songFor(room: Room): SongMeta | undefined {
  if (room.songId === null) return undefined;
  if (room.songId === TEST_SONG.id) return TEST_SONG;
  return songById(room.songId);
}

export function broadcastState(io: Server, room: Room): void {
  io.to(room.code).emit(ServerEvents.roomState, toPublic(room));
  void saveRoomSnap(room);
}

export function publicClock(room: Room): {
  songId: string;
  startSec: number;
  durationSec: number;
  playAtUnixMs: number;
} | null {
  if (!room.songId || room.playAtUnixMs == null) return null;
  return {
    songId: room.songId,
    startSec: room.clipStartSec,
    durationSec: room.clipDurationSec,
    playAtUnixMs: room.playAtUnixMs,
  };
}

export function publicScores(room: Room): Record<string, ScoreCard> {
  const scores: Record<string, ScoreCard> = {};
  for (const [id, card] of room.scores) scores[id] = card;
  return scores;
}

/** Ranked hides numbers until the match is settled so Player B cannot read A's card (PRD A4). */
export function revealedScores(room: Room): Record<string, ScoreCard> {
  if (room.mode === "ranked" && !room.settled) return {};
  return publicScores(room);
}

export function emitScoreReady(io: Server, room: Room, playerId: string, score: ScoreCard): void {
  if (room.mode === "ranked" && !room.settled) {
    io.to(room.code).emit(ServerEvents.scoreReady, { playerId, received: true });
    return;
  }
  io.to(room.code).emit(ServerEvents.scoreReady, { playerId, score });
}

/**
 * Arm the shared clock. Clients start their local audio at `playAtUnixMs` and
 * re-seek if they drift past MaxDriftSec.
 */
function scheduleClip(io: Server, room: Room, playAtUnixMs: number): void {
  room.playAtUnixMs = playAtUnixMs;
  room.songStartedAtMs = playAtUnixMs;
  io.to(room.code).emit(ServerEvents.clockPlay, {
    songId: room.songId,
    startSec: room.clipStartSec,
    durationSec: room.clipDurationSec,
    playAtUnixMs,
  });
}

/** Late Chaos joiners missed the original clock:play — send it to that socket. */
export function catchUpClock(io: Server, room: Room, socketId: string): void {
  if (!room.songId || room.playAtUnixMs == null) return;
  io.to(socketId).emit(ServerEvents.clockPlay, {
    songId: room.songId,
    startSec: room.clipStartSec,
    durationSec: room.clipDurationSec,
    playAtUnixMs: room.playAtUnixMs,
  });
}

// ---------------------------------------------------------------------------
// Ranked / Duet
// ---------------------------------------------------------------------------

export function everyoneReady(room: Room): boolean {
  return livePlayers(room).length === 2;
}

/** Two seated singers in lobby → 10s countdown. No ready taps. */
export function maybeArmMatch(io: Server, room: Room): void {
  if (room.mode === "chaos") return;
  if (room.status !== "lobby") return;
  if (livePlayers(room).length < 2) return;
  startMatch(io, room);
}

/**
 * lobby → countdown 10s → turnA (15–20s chorus hook) → swap 5s → turnB (same) → results.
 * Duet collapses the two turns into one shared `live` block for the whole track.
 */
export function startMatch(io: Server, room: Room): void {
  if (livePlayers(room).length < 2) return;
  if (room.status !== "lobby") return;
  clearTimers(room);
  room.scores.clear();
  room.lastEloDelta = 0;
  room.settled = false;
  room.rematchAtMs = null;

  const isDuet = room.mode === "duet";
  const song = pickSong(room.songId);
  const window = clipWindow(song, isDuet ? "duet" : "ranked");
  room.songId = song.id;
  room.status = "countdown";
  room.activeSingerId = room.players[0]?.id ?? null;
  room.clipStartSec = window.startSec;
  room.clipDurationSec = window.durationSec;
  room.matchStartedAtMs = null;

  const goAt = Date.now() + MatchCountdownMs;
  scheduleClip(io, room, goAt);
  broadcastState(io, room);

  later(room, MatchCountdownMs, () => beginClip(io, room));
}

function beginClip(io: Server, room: Room): void {
  if (room.status !== "countdown") return;
  const isDuet = room.mode === "duet";
  room.matchStartedAtMs = Date.now();
  room.status = isDuet ? "live" : "turnA";
  broadcastState(io, room);
  const clipMs = Math.round(room.clipDurationSec * 1000);
  later(room, clipMs, () => {
    if (isDuet) awaitScores(io, room);
    else if (room.status === "turnA") swapToTurnB(io, room);
  });
}

/**
 * Drive the match from wall-clock even when this isolate lost its setTimeout
 * (Vercel freeze) or never owned the original later() callback.
 */
export function advanceDue(io: Server, room: Room): void {
  if (room.mode === "chaos") {
    ensureChaosPlaying(io, room);
    return;
  }
  if (room.status === "lobby") {
    maybeArmMatch(io, room);
    return;
  }

  const now = Date.now();
  const playAt = room.playAtUnixMs;
  const clipMs = Math.round(room.clipDurationSec * 1000);

  if (room.status === "countdown" && playAt != null && now >= playAt) {
    beginClip(io, room);
    return;
  }
  if (room.status === "swap" && playAt != null && now >= playAt) {
    room.status = "turnB";
    broadcastState(io, room);
    later(room, clipMs, () => {
      if (room.status === "turnB") awaitScores(io, room);
    });
    return;
  }
  if (room.status === "turnA" && playAt != null && now >= playAt + clipMs) {
    swapToTurnB(io, room);
    return;
  }
  if (
    (room.status === "turnB" || room.status === "live") &&
    playAt != null &&
    now >= playAt + clipMs
  ) {
    awaitScores(io, room);
    return;
  }
}

function swapToTurnB(io: Server, room: Room): void {
  room.status = "swap";
  room.activeSingerId = room.players[1]?.id ?? null;
  // Same clip, second singer: re-arm the clock so both clients restart together.
  scheduleClip(io, room, Date.now() + SwapMs);
  broadcastState(io, room);

  later(room, SwapMs, () => {
    room.status = "turnB";
    broadcastState(io, room);
    later(room, Math.round(room.clipDurationSec * 1000), () => awaitScores(io, room));
  });
}

/** Both clips are sung. Settle as soon as both DSP ScoreCards are in. */
function scoresAreIn(room: Room): boolean {
  const expected = room.players.filter((p) => p.connected);
  return expected.length > 0 && expected.every((p) => room.scores.has(p.id));
}

function awaitScores(io: Server, room: Room): void {
  room.status = "results";
  room.playAtUnixMs = null;
  broadcastState(io, room);
  if (scoresAreIn(room)) {
    void finishMatch(io, room);
    return;
  }
  later(room, SCORE_WAIT_MS, () => void finishMatch(io, room));
}

/** Called by the score route. Returns true once the match has been settled. */
export function recordScore(
  io: Server,
  room: Room,
  playerId: string,
  score: ScoreCard,
): boolean {
  room.scores.set(playerId, score);
  emitScoreReady(io, room, playerId, score);
  void saveRoomSnap(room);

  if (scoresAreIn(room) && (room.status === "results" || room.status === "live")) {
    void finishMatch(io, room);
    return true;
  }
  return false;
}

type ForfeitInfo = { winnerId: string | null; underMinimum: boolean };

export async function finishMatch(
  io: Server,
  room: Room,
  forfeit?: ForfeitInfo,
  seated: Player[] = room.players.slice(),
): Promise<void> {
  const hydrated = forfeit ? undefined : await ensureRoom(room.code);
  if (hydrated) {
    for (const [id, card] of hydrated.scores) {
      if (!room.scores.has(id)) room.scores.set(id, card);
    }
    if (hydrated.settled) {
      room.settled = true;
      return;
    }
  }
  if (room.settled) return;
  room.settled = true;
  clearTimers(room);

  const scores: Record<string, ScoreCard> = {};
  for (const player of seated) {
    scores[player.id] = room.scores.get(player.id) ?? { ...STUB_SCORE };
  }

  let winnerId: string | null = null;
  if (forfeit) {
    winnerId = forfeit.winnerId;
  } else {
    const [a, b] = seated;
    if (a && b) {
      const sa = scores[a.id]?.overall ?? 0;
      const sb = scores[b.id]?.overall ?? 0;
      // Equal overall is a draw, and a draw leaves ELO untouched (PRD §6.1).
      if (sa > sb) winnerId = a.id;
      else if (sb > sa) winnerId = b.id;
    }
  }

  const rateRanked =
    room.mode === "ranked" && (!forfeit || !forfeit.underMinimum);
  if (rateRanked) {
    const [a, b] = seated;
    const sa = a ? scores[a.id]?.overall ?? 0 : 0;
    const sb = b ? scores[b.id]?.overall ?? 0 : 0;
    const k = forfeit ? ForfeitEloK : EloK;
    const outcome = forfeit
      ? forfeit.winnerId === a?.id
        ? 1
        : forfeit.winnerId === b?.id
          ? 0
          : 0.5
      : outcomeFromScores(sa, sb);
    const local = eloDelta(
      a?.elo ?? StartingElo,
      b?.elo ?? StartingElo,
      outcome,
      k,
    );
    room.lastEloDelta = local.a;
    if (a && b) {
      const filled = new Map<string, ScoreCard>();
      for (const player of seated) {
        const card = scores[player.id];
        if (card) filled.set(player.id, card);
      }
      try {
        room.lastEloDelta = await persistSeatedMatch({
          code: room.code,
          mode: room.mode,
          songId: room.songId,
          players: seated,
          scores: filled,
          forfeit: Boolean(forfeit),
          outcome,
        });
      } catch {
        room.lastEloDelta = local.a;
      }
      a.elo = Math.max(100, Math.round((a.elo ?? StartingElo) + room.lastEloDelta));
      b.elo = Math.max(100, Math.round((b.elo ?? StartingElo) - room.lastEloDelta));
    }
  } else if (!forfeit && room.mode === "duet") {
    room.lastEloDelta = 0;
    void persistSeatedMatch({
      code: room.code,
      mode: room.mode,
      songId: room.songId,
      players: room.players,
      scores: room.scores,
    }).catch(() => {
      /* leaderboard best-effort */
    });
  }

  room.status = "results";
  room.playAtUnixMs = null;
  room.lastWinnerId = winnerId;

  io.to(room.code).emit(ServerEvents.matchOver, {
    scores,
    winnerId,
    eloDelta: room.lastEloDelta ?? 0,
    ...(forfeit
      ? {
          forfeit: true,
          // A forfeit under ForfeitSkipMs is thrown away rather than rated, and
          // a rated forfeit uses K=16 not K=32 (PRD §6.1). Lane B needs this
          // flag to apply that — it is not derivable from the other fields.
          rated: !forfeit.underMinimum,
        }
      : {}),
  });
  broadcastState(io, room);
}

/**
 * A disconnect mid-match hands the win to whoever is left. Matches shorter than
 * ForfeitSkipMs are discarded entirely rather than rated (PRD §6.1).
 */
export function forfeitFor(io: Server, room: Room, leaver: Player): void {
  if (room.mode === "chaos") return;
  const inMatch =
    room.status === "countdown" ||
    room.status === "turnA" ||
    room.status === "swap" ||
    room.status === "turnB" ||
    room.status === "live";
  if (!inMatch) return;

  const survivor = room.players.find((p) => p.id !== leaver.id && p.connected);
  const elapsed =
    room.matchStartedAtMs === null ? 0 : Date.now() - room.matchStartedAtMs;
  const seated = room.players.slice();
  room.status = "results";

  void finishMatch(
    io,
    room,
    {
      winnerId: survivor?.id ?? null,
      underMinimum: elapsed < ForfeitSkipMs,
    },
    seated,
  );
}

// ---------------------------------------------------------------------------
// Chaos lounge
// ---------------------------------------------------------------------------

/**
 * Chaos autoplays whole tracks back to back for as long as anyone is in the room.
 * No scoring, no turns (PRD §6.4).
 */
export function startChaos(io: Server, room: Room, delayMs = ClockLeadMs): void {
  clearTimers(room);
  if (livePlayers(room).length === 0) return;
  later(room, delayMs, () => playChaosSong(io, room));
}

function chaosStillPlaying(room: Room): boolean {
  if (room.status !== "live" || !room.songId || room.playAtUnixMs == null) return false;
  const end = room.playAtUnixMs + room.clipDurationSec * 1000;
  return Date.now() < end + 750;
}

/** Keep the playlist going whenever anyone live is in the lounge. */
export function ensureChaosPlaying(io: Server, room: Room): void {
  if (room.mode !== "chaos") return;
  if (livePlayers(room).length === 0) {
    stopChaos(io, room);
    return;
  }
  if (chaosStillPlaying(room)) return;
  playChaosSong(io, room);
}

function playChaosSong(io: Server, room: Room): void {
  if (livePlayers(room).length === 0) {
    stopChaos(io, room);
    return;
  }
  const song = pickSong(room.songId);
  const window = clipWindow(song, "duet");
  room.songId = song.id;
  room.status = "live";
  room.activeSingerId = null;
  room.clipStartSec = window.startSec;
  room.clipDurationSec = window.durationSec;

  const playAt = Date.now() + ClockLeadMs;
  scheduleClip(io, room, playAt);
  broadcastState(io, room);

  later(room, ClockLeadMs + window.durationSec * 1000, () =>
    playChaosSong(io, room),
  );
}

export function stopChaos(io: Server, room: Room): void {
  clearTimers(room);
  room.songId = null;
  room.status = "lobby";
  room.playAtUnixMs = null;
  room.songStartedAtMs = null;
  broadcastState(io, room);
}
