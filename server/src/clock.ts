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
  CountdownMs,
  ForfeitSkipMs,
  EloK,
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
  toPublic,
  type Player,
  type Room,
} from "./rooms.ts";
import { ensureRoom, saveRoomSnap } from "./liveState.ts";
import { persistSeatedMatch } from "./judge.ts";
import { eloDelta, outcomeFromScores } from "./elo.ts";

const songsDir =
  [
    path.resolve(process.cwd(), "apps/web/dist/songs"),
    path.resolve(process.cwd(), "apps/web/public/songs"),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../apps/web/dist/songs"),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../apps/web/public/songs"),
  ].find((dir) => existsSync(dir)) ??
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../apps/web/public/songs");

/** Last-chance wait for an in-flight POST. Vercel round-trips need more than 250ms. */
const SCORE_WAIT_MS = 1800;

/**
 * Used when Lane B's DSP has not landed yet, or a client never POSTs.
 * Shape is pinned by the Lane A prompt so the machine is demoable solo.
 */
const STUB_SCORE: ScoreCard = {
  overall: 80,
  pitch: 82,
  tone: 74,
  silence: false,
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

/** Hold the last chorus line at least this long if the next line is farther. */
const LyricTailSec = 6;

const LrcTimeRe = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/;

function lyricTimes(id: string): number[] {
  const file = path.join(songsDir, id, "lyrics.lrc");
  if (!existsSync(file)) return [];
  try {
    const times: number[] = [];
    for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = raw.match(LrcTimeRe);
      if (!m) continue;
      const min = Number(m[1]);
      const sec = Number(m[2]);
      const frac = m[3] ? Number(m[3].padEnd(3, "0").slice(0, 3)) / 1000 : 0;
      times.push(min * 60 + sec + frac);
    }
    return times.sort((a, b) => a - b);
  } catch {
    return [];
  }
}

function lineEndSec(times: number[], lineStart: number): number {
  const next = times.find((t) => t > lineStart + 0.05);
  if (next == null) return lineStart + 4;
  return Math.min(next - 0.2, lineStart + LyricTailSec);
}

/** Ranked: 0:00 through the first chorus. Duet: the whole track. */
function clipWindow(song: SongMeta, kind: "ranked" | "duet"): { startSec: number; durationSec: number } {
  if (kind === "duet") {
    return { startSec: 0, durationSec: Math.max(1, song.duetClipDurationSec) };
  }
  const start0 = song.clipStartSec;
  const duration0 = song.clipDurationSec;
  const end0 = start0 + duration0;
  const times = lyricTimes(song.id);
  if (times.length === 0) return { startSec: 0, durationSec: Math.max(1, end0) };
  const last = [...times].reverse().find((t) => t < end0 - 0.1);
  if (last == null) return { startSec: 0, durationSec: Math.max(1, end0) };
  const sungEnd = lineEndSec(times, last);
  const next = times.find((t) => t > last + 0.05);
  const cap = next == null ? sungEnd : next - 0.2;
  const endSec = Math.min(Math.max(end0, sungEnd), cap);
  return { startSec: 0, durationSec: Math.max(1, endSec) };
}

function useTestSong(): boolean {
  return process.env.USE_TEST_SONG === "1";
}

function metaFromDisk(id: string): SongMeta | undefined {
  const file = path.join(songsDir, id, "meta.json");
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as SongMeta;
  } catch {
    return undefined;
  }
}

function pickSong(): SongMeta {
  const testFile = path.join(songsDir, TEST_SONG.id, "instrumental.mp3");
  if (useTestSong() && existsSync(testFile)) return TEST_SONG;
  const onDisk = SONGS.filter(
    (s) =>
      existsSync(path.join(songsDir, s.id, "instrumental.mp3")) &&
      existsSync(path.join(songsDir, s.id, "melody.json")),
  );
  const pool = onDisk.length > 0 ? onDisk : SONGS;
  const song = pool[Math.floor(Math.random() * pool.length)];
  if (!song) return TEST_SONG;
  return metaFromDisk(song.id) ?? song;
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
  return room.players.length === 2 && room.players.every((p) => p.ready);
}

/**
 * lobby → countdown 5s → turnA (0:00 through first chorus) → swap 5s → turnB (same) → results.
 * Duet collapses the two turns into one shared `live` block for the whole track.
 */
export function startMatch(io: Server, room: Room): void {
  if (room.players.length !== 2) return;
  if (room.status !== "lobby") return;
  clearTimers(room);
  room.scores.clear();
  room.lastEloDelta = 0;
  room.settled = false;

  const song = pickSong();
  const isDuet = room.mode === "duet";
  const window = clipWindow(song, isDuet ? "duet" : "ranked");
  room.songId = song.id;
  room.status = "countdown";
  room.activeSingerId = room.players[0]?.id ?? null;
  room.clipStartSec = window.startSec;
  room.clipDurationSec = window.durationSec;
  room.matchStartedAtMs = null;

  scheduleClip(io, room, Date.now() + CountdownMs);
  broadcastState(io, room);

  const clipMs = Math.round(room.clipDurationSec * 1000);
  later(room, CountdownMs, () => {
    room.matchStartedAtMs = Date.now();
    room.status = isDuet ? "live" : "turnA";
    broadcastState(io, room);
    later(room, clipMs, () => {
      if (isDuet) awaitScores(io, room);
      else swapToTurnB(io, room);
    });
  });
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
  io.to(room.code).emit(ServerEvents.scoreReady, { playerId, score });
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
): Promise<void> {
  const hydrated = await ensureRoom(room.code);
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
  for (const player of room.players) {
    scores[player.id] = room.scores.get(player.id) ?? { ...STUB_SCORE };
  }

  let winnerId: string | null = null;
  if (forfeit) {
    winnerId = forfeit.winnerId;
  } else {
    const [a, b] = room.players;
    if (a && b) {
      const sa = scores[a.id]?.overall ?? 0;
      const sb = scores[b.id]?.overall ?? 0;
      // Equal overall is a draw, and a draw leaves ELO untouched (PRD §6.1).
      if (sa > sb) winnerId = a.id;
      else if (sb > sa) winnerId = b.id;
    }
  }

  const usedStub = room.players.some((p) => !room.scores.has(p.id));
  if (!forfeit && room.mode !== "chaos" && !usedStub) {
    const [a, b] = room.players;
    const sa = a ? scores[a.id]?.overall ?? 0 : 0;
    const sb = b ? scores[b.id]?.overall ?? 0 : 0;
    room.lastEloDelta = eloDelta(
      StartingElo,
      StartingElo,
      outcomeFromScores(sa, sb),
      EloK,
    ).a;
    void persistSeatedMatch({
      code: room.code,
      mode: room.mode,
      songId: room.songId,
      players: room.players,
      scores: room.scores,
    })
      .then((d) => {
        room.lastEloDelta = d;
      })
      .catch(() => {
        /* results already shown */
      });
  }

  room.status = "results";
  room.playAtUnixMs = null;

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

  void finishMatch(io, room, {
    winnerId: survivor?.id ?? null,
    underMinimum: elapsed < ForfeitSkipMs,
  });
}

// ---------------------------------------------------------------------------
// Chaos lounge
// ---------------------------------------------------------------------------

/**
 * Chaos autoplays 60s cuts back to back for as long as anyone is in the room.
 * No scoring, no turns (PRD §6.4).
 */
export function startChaos(io: Server, room: Room, delayMs = CountdownMs): void {
  clearTimers(room);
  if (room.players.length === 0) return;
  later(room, delayMs, () => playChaosSong(io, room));
}

function playChaosSong(io: Server, room: Room): void {
  if (room.players.length === 0) {
    stopChaos(io, room);
    return;
  }
  const song = pickSong();
  room.songId = song.id;
  room.status = "live";
  room.activeSingerId = null;
  room.clipStartSec = clipWindow(song, "ranked").startSec;
  room.clipDurationSec = song.chaosDurationSec;

  const playAt = Date.now() + ClockLeadMs;
  scheduleClip(io, room, playAt);
  broadcastState(io, room);

  later(room, ClockLeadMs + song.chaosDurationSec * 1000, () =>
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
