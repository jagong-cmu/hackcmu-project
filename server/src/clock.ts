/**
 * LANE A — shared clock and the Ranked/Duet/Chaos state machines.
 *
 * Every client plays its own local <audio>. The server only broadcasts *when*
 * to press play (`playAtUnixMs`), never the audio itself. The instrumental must
 * never touch WebRTC (TECHNICAL_PRD §6).
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Server } from "socket.io";
import {
  ClockLeadMs,
  CountdownMs,
  ForfeitSkipMs,
  RankedClipMs,
  ServerEvents,
  SONGS,
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
import { persistSeatedMatch } from "./judge.ts";

const songsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../apps/web/public/songs",
);

/** How long we wait for both DSP ScoreCards before falling back to stubs. */
const SCORE_WAIT_MS = 12_000;

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

const useTestSong = (): boolean => process.env.USE_TEST_SONG === "1";

function pickSong(): SongMeta {
  if (useTestSong()) return TEST_SONG;
  const pool = SONGS.filter(
    (s) =>
      existsSync(path.join(songsDir, s.id, "instrumental.mp3")) &&
      existsSync(path.join(songsDir, s.id, "melody.json")),
  );
  const song = pool[Math.floor(Math.random() * pool.length)];
  return song ?? TEST_SONG;
}

function songFor(room: Room): SongMeta | undefined {
  if (room.songId === null) return undefined;
  if (room.songId === TEST_SONG.id) return TEST_SONG;
  return songById(room.songId);
}

export function broadcastState(io: Server, room: Room): void {
  io.to(room.code).emit(ServerEvents.roomState, toPublic(room));
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

// ---------------------------------------------------------------------------
// Ranked / Duet
// ---------------------------------------------------------------------------

export function everyoneReady(room: Room): boolean {
  return (
    room.players.length === 2 && room.players.every((p) => p.ready && p.connected)
  );
}

/**
 * lobby → countdown 3s → turnA 15s → swap 2s → turnB 15s → results.
 * Duet collapses the two turns into one shared `live` block (PRD §6.2).
 */
export function startMatch(io: Server, room: Room): void {
  if (room.players.length !== 2) return;
  clearTimers(room);
  room.scores.clear();
  room.lastEloDelta = 0;
  room.settled = false;

  const song = pickSong();
  const isDuet = room.mode === "duet";
  room.songId = song.id;
  room.status = "countdown";
  room.activeSingerId = room.players[0]?.id ?? null;
  room.clipStartSec = isDuet ? song.duetClipStartSec : song.clipStartSec;
  room.clipDurationSec = isDuet ? song.duetClipDurationSec : song.clipDurationSec;
  room.matchStartedAtMs = null;

  scheduleClip(io, room, Date.now() + CountdownMs);
  broadcastState(io, room);

  const clipMs = isDuet ? room.clipDurationSec * 1000 : RankedClipMs;
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
    later(room, RankedClipMs, () => awaitScores(io, room));
  });
}

/**
 * Both clips are sung. Hold in `results` until both ScoreCards POST in, or the
 * wait expires and we fall back to stubs so the demo never hangs.
 */
function awaitScores(io: Server, room: Room): void {
  room.status = "results";
  room.playAtUnixMs = null;
  broadcastState(io, room);
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

  const expected = room.players.filter((p) => p.connected);
  const allIn = expected.every((p) => room.scores.has(p.id));
  if (allIn && (room.status === "results" || room.status === "live")) {
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
    room.lastEloDelta = await persistSeatedMatch({
      code: room.code,
      mode: room.mode,
      songId: room.songId,
      players: room.players,
      scores: room.scores,
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
  room.clipStartSec = song.clipStartSec;
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
