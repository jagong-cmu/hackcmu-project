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
  MatchCountdownMs,
  ForfeitSkipMs,
  EloK,
  ForfeitEloK,
  ServerEvents,
  SONGS,
  StartingElo,
  SwapMs,
  RankedClipMaxSec,
  clipWindowFor,
  pickClipAnchor,
  songById,
  type ClipAnchor,
  type ClipWindow,
  type ScoreCard,
  type SongMeta,
} from "@karaoke/shared";
import {
  clearTimers,
  awaitingSettlement,
  later,
  livePlayers,
  matchInProgress,
  resetToLobby,
  seatsForSettlement,
  toPublic,
  type Player,
  type Room,
} from "./rooms.ts";
import {
  applySnap,
  awaitSettlement,
  claimScore,
  claimSettlement,
  loadSnap,
  publishSettlement,
  saveRoomSnap,
  type MatchOverPayload,
  type SettleClaim,
} from "./liveState.ts";
import { persistSeatedMatch } from "./judge.ts";
import { eloDelta, outcomeFromScores } from "./elo.ts";
import {
  cancelRematch,
  expireRematch,
  lapseRematchOnLeave,
  rematchIsMutual,
  requestRematch,
} from "./rematch.ts";
import { trackMatchStarted, trackSongPlayed } from "./analytics.ts";
import { logOnce } from "./hardening.ts";

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

let anchorRng: () => number = Math.random;

/** Tests only: make the per-match anchor coin flip deterministic. No arg restores Math.random. */
export function setClipAnchorRng(rng?: () => number): void {
  anchorRng = rng ?? Math.random;
}

/**
 * The clip both seats play. The anchor (first lyric or chorus) is flipped once
 * here, on the server, so both players get the same start; audio begins
 * ClipLeadInMs before it.
 * Ranked: lead-in + the song's 15–20s hook (capped at RankedClipMaxSec so a
 * stale meta.json cannot turn Ranked back into a full verse).
 * Duet: lead-in, then to the end of the track.
 */
export function matchClip(
  song: SongMeta,
  kind: "ranked" | "duet",
  rng: () => number = anchorRng,
): ClipWindow {
  const window = clipWindowFor(song, kind, pickClipAnchor(song, rng));
  if (kind === "ranked") window.durationSec = Math.min(RankedClipMaxSec, window.durationSec);
  return window;
}

/** Chaos lounges loop whole tracks from 0:00; no anchor, no lead-in. */
function chaosClip(song: SongMeta): { startSec: number; durationSec: number } {
  return { startSec: 0, durationSec: Math.max(1, song.duetClipDurationSec) };
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
  void saveRoomSnap(room).catch(logOnce("saveRoomSnap"));
}

export type ClockPayload = {
  songId: string;
  startSec: number;
  durationSec: number;
  playAtUnixMs: number;
  /** Seconds of instrumental lead-in at the top of the clip (not scored). */
  leadInSec: number;
  anchor: ClipAnchor | null;
};

function clockPayload(room: Room, playAtUnixMs: number): ClockPayload | null {
  if (!room.songId) return null;
  return {
    songId: room.songId,
    startSec: room.clipStartSec,
    durationSec: room.clipDurationSec,
    playAtUnixMs,
    leadInSec: room.clipLeadInSec,
    anchor: room.clipAnchor,
  };
}

export function publicClock(room: Room): ClockPayload | null {
  if (room.playAtUnixMs == null) return null;
  return clockPayload(room, room.playAtUnixMs);
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
    ...clockPayload(room, playAtUnixMs),
    songId: room.songId,
  });
}

/** Late Chaos joiners missed the original clock:play — send it to that socket. */
export function catchUpClock(io: Server, room: Room, socketId: string): void {
  const payload = publicClock(room);
  if (!payload) return;
  io.to(socketId).emit(ServerEvents.clockPlay, payload);
}

// ---------------------------------------------------------------------------
// Ranked / Duet
// ---------------------------------------------------------------------------

export function everyoneReady(room: Room): boolean {
  return livePlayers(room).length === 2;
}

/** Two seated singers in lobby → MatchCountdownMs (5s) countdown. No ready taps. */
export function maybeArmMatch(io: Server, room: Room): void {
  if (room.mode === "chaos") return;
  if (room.status !== "lobby") return;
  if (livePlayers(room).length < 2) return;
  startMatch(io, room);
}

/**
 * lobby → countdown 5s (MatchCountdownMs) → turnA (15–20s chorus hook) → swap 5s → turnB (same) → results.
 * Duet collapses the two turns into one shared `live` block for the whole track.
 */
export function startMatch(io: Server, room: Room): void {
  if (livePlayers(room).length < 2) return;
  if (room.status !== "lobby") return;
  clearTimers(room);
  room.scores.clear();
  room.lastEloDelta = 0;
  room.settleSeats = null;
  room.settled = false;
  room.rematch = null;
  room.rematchLapse = null;

  const isDuet = room.mode === "duet";
  const song = pickSong(room.songId);
  // One anchor flip per match: turn A, turn B, and both laptops share it.
  const window = matchClip(song, isDuet ? "duet" : "ranked");
  room.songId = song.id;
  room.status = "countdown";
  room.activeSingerId = room.players[0]?.id ?? null;
  room.clipStartSec = window.startSec;
  room.clipDurationSec = window.durationSec;
  room.clipLeadInSec = window.leadInSec;
  room.clipAnchor = window.anchor;
  room.matchStartedAtMs = null;

  const goAt = Date.now() + MatchCountdownMs;
  // Fixed for the whole match (the swap re-arms playAt, not this).
  room.matchId = goAt;
  scheduleClip(io, room, goAt);
  broadcastState(io, room);
  trackMatchStarted({
    mode: room.mode,
    songId: song.id,
    roomCode: room.code,
    distinctId: room.players[0]?.clientId,
  }).catch(() => undefined);
  trackSongPlayed({
    mode: room.mode,
    songId: song.id,
    roomCode: room.code,
    distinctId: room.players[0]?.clientId,
  }).catch(() => undefined);

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

  if (room.status === "results") {
    // Wall-clock backstop for the rematch window (timers die on Vercel freezes),
    // and the resolution point when two isolates each recorded one tap.
    if (rematchIsMutual(room)) startRematch(io, room);
    else if (expireRematch(room)) broadcastState(io, room);
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

// ---------------------------------------------------------------------------
// Rematch (results screen, 2 seats). Both players must confirm inside
// RematchWindowMs; see rematch.ts for the state rules.
// ---------------------------------------------------------------------------

/** Both seats agreed: back to lobby and arm the normal pre-match countdown. */
function startRematch(io: Server, room: Room): void {
  resetToLobby(room);
  maybeArmMatch(io, room);
  broadcastState(io, room);
}

/** A player tapped Rematch (propose, or accept the open offer). */
export function handleRematchRequest(io: Server, room: Room, playerId: string): void {
  const outcome = requestRematch(room, playerId);
  if (outcome === "ignored") return;
  if (outcome === "mutual") {
    startRematch(io, room);
    return;
  }
  if (outcome === "opened" && room.rematch) {
    const deadline = room.rematch.deadlineUnixMs;
    later(room, Math.max(0, deadline - Date.now()) + 25, () => {
      if (room.rematch?.deadlineUnixMs !== deadline) return;
      if (expireRematch(room)) broadcastState(io, room);
    });
  }
  broadcastState(io, room);
}

/** Proposer cancels, or the opponent declines. */
export function handleRematchCancel(io: Server, room: Room, playerId: string): void {
  if (cancelRematch(room, playerId)) broadcastState(io, room);
}

/** A seat left mid-offer. Caller broadcasts. */
export function rematchSeatLeft(room: Room, playerId: string): boolean {
  return lapseRematchOnLeave(room, playerId);
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

/**
 * After a seat left during the score wait (forfeitFor held the roster): if
 * everyone still here has posted, settle now on the scores rather than
 * waiting out SCORE_WAIT_MS. The leaver's card, if it never arrived, is the
 * empty-score fallback. Call after the seat is removed.
 */
export function settleIfScoresIn(io: Server, room: Room): void {
  if (!awaitingSettlement(room) || !room.settleSeats) return;
  if (scoresAreIn(room)) void finishMatch(io, room).catch(logOnce("finishMatch"));
}

function awaitScores(io: Server, room: Room): void {
  room.status = "results";
  room.playAtUnixMs = null;
  broadcastState(io, room);
  if (scoresAreIn(room)) {
    void finishMatch(io, room).catch(logOnce("finishMatch"));
    return;
  }
  later(room, SCORE_WAIT_MS, () => void finishMatch(io, room).catch(logOnce("finishMatch")));
}

// ---------------------------------------------------------------------------
// Score acceptance. The client posts its DSP numbers once its clip is over
// (stage/LaneBSlots.tsx flushScore). The server only takes a card from a seat
// that has finished singing in the CURRENT match, once, before settlement.
// ---------------------------------------------------------------------------

/**
 * How early (server clock) a post may arrive before the seat's clip ends. The
 * client flushes ~50ms before the clip end on its own synced clock; this only
 * absorbs clock skew and the isolate's sweep lag, it is not a DSP check.
 */
export const ScoreEarlyGraceMs = 1500;

export type ScoreRejectCode =
  | "NOT_A_SCORED_MATCH"
  | "MATCH_NOT_STARTED"
  | "STALE_MATCH"
  | "MATCH_SETTLED"
  | "SCORE_ALREADY_RECORDED"
  | "NOT_A_SINGER"
  | "TURN_NOT_ENDED";

export type ScoreRejection = { status: 409; code: ScoreRejectCode; message: string };

const reject = (code: ScoreRejectCode, message: string): ScoreRejection => ({
  status: 409,
  code,
  message,
});

/**
 * Null when `playerId` may post its score now, else why not.
 *
 * Ranked: seat 0 (turnA) once its clip is over — status swap/turnB/results, or
 *   still turnA within ScoreEarlyGraceMs of playAt + clip. Seat 1 (turnB) only
 *   in results, or turnB within the grace of its clip end.
 * Duet: in results (the score wait), or live within the grace of the clip end.
 * Never in lobby/countdown, never for an older match (`postedMatchId`), never
 * after settlement, never twice for one seat in one match.
 */
export function scoreRejection(
  room: Room,
  playerId: string,
  now: number = Date.now(),
  postedMatchId?: unknown,
): ScoreRejection | null {
  if (room.mode !== "ranked" && room.mode !== "duet") {
    return reject("NOT_A_SCORED_MATCH", "this room does not score turns");
  }
  if (typeof postedMatchId === "number" && postedMatchId !== room.matchId) {
    return reject("STALE_MATCH", "that score is for an earlier match");
  }
  if (room.matchId == null || room.status === "lobby" || room.status === "countdown") {
    return reject("MATCH_NOT_STARTED", "no match is being sung");
  }
  if (room.settled) return reject("MATCH_SETTLED", "this match is already settled");
  if (room.scores.has(playerId)) {
    return reject("SCORE_ALREADY_RECORDED", "a score for this match is already recorded");
  }
  const seat = room.players.findIndex((p) => p.id === playerId);
  if (seat !== 0 && seat !== 1) return reject("NOT_A_SINGER", "not a singer in this match");

  const clipEnd =
    room.playAtUnixMs == null ? null : room.playAtUnixMs + Math.round(room.clipDurationSec * 1000);
  const clipOver = clipEnd != null && now >= clipEnd - ScoreEarlyGraceMs;
  const notYet = reject("TURN_NOT_ENDED", "your turn has not been sung yet");

  if (room.status === "results") return null;
  if (room.mode === "duet") {
    return room.status === "live" && clipOver ? null : notYet;
  }
  if (seat === 0) {
    if (room.status === "swap" || room.status === "turnB") return null;
    return room.status === "turnA" && clipOver ? null : notYet;
  }
  return room.status === "turnB" && clipOver ? null : notYet;
}

export type ScoreOutcome =
  | { ok: true; settled: boolean }
  | { ok: false; status: number; code: string; message: string };

/**
 * Called by the score route with an already-clamped card. Applies the
 * acceptance rules, then claims the seat's one score for this match across
 * isolates (Mongo), then settles if both cards are in.
 */
export async function recordScore(
  io: Server,
  room: Room,
  playerId: string,
  score: ScoreCard,
  postedMatchId?: unknown,
): Promise<ScoreOutcome> {
  const refused = scoreRejection(room, playerId, Date.now(), postedMatchId);
  if (refused) return { ok: false, ...refused };

  // Reserve the seat on this isolate before awaiting, so a concurrent second
  // post here sees SCORE_ALREADY_RECORDED.
  room.scores.set(playerId, score);
  const release = () => {
    if (room.scores.get(playerId) === score) room.scores.delete(playerId);
  };
  let claim;
  try {
    claim = await claimScore(room, playerId, score);
  } catch (err) {
    release();
    logOnce("claimScore")(err);
    return {
      ok: false,
      status: 503,
      code: "SCORE_STORE_UNAVAILABLE",
      message: "could not record the score, try again",
    };
  }
  if (claim === "duplicate" || claim === "settled" || claim === "stale") {
    release();
    const code: ScoreRejectCode =
      claim === "duplicate"
        ? "SCORE_ALREADY_RECORDED"
        : claim === "settled"
          ? "MATCH_SETTLED"
          : "STALE_MATCH";
    return { ok: false, status: 409, code, message: "score not recorded" };
  }

  emitScoreReady(io, room, playerId, score);
  void saveRoomSnap(room).catch(logOnce("saveRoomSnap"));

  if (scoresAreIn(room) && (room.status === "results" || room.status === "live")) {
    void finishMatch(io, room).catch(logOnce("finishMatch"));
    return { ok: true, settled: true };
  }
  return { ok: true, settled: false };
}

type ForfeitInfo = { winnerId: string | null; underMinimum: boolean };

/** How long an isolate that lost the settlement claim waits for the winner's result. */
const SETTLE_CONVERGE_MS = 8000;

/**
 * Another isolate settled this match: take its result (scores, winner, ELO)
 * instead of computing and persisting our own, and show it to our sockets.
 */
async function convergeSettlement(io: Server, room: Room, matchId: number | null): Promise<void> {
  if (matchId == null) return;
  clearTimers(room);
  const got = await awaitSettlement(room.code, matchId, SETTLE_CONVERGE_MS);
  if (room.matchId !== matchId) return; // a rematch began meanwhile
  if (got) applySnap(room, got.snap);
  room.settled = true;
  room.status = "results";
  room.playAtUnixMs = null;
  if (got) {
    const { matchId: _settled, ...payload } = got.result;
    room.lastWinnerId = payload.winnerId;
    room.lastEloDelta = payload.eloDelta;
    io.to(room.code).emit(ServerEvents.matchOver, payload);
  }
  broadcastState(io, room);
}

export async function finishMatch(
  io: Server,
  room: Room,
  forfeit?: ForfeitInfo,
  seated: Player[] = seatsForSettlement(room),
): Promise<void> {
  const wasSettled = room.settled;
  // Pull the other isolate's claimed scores (and settlement) into this room.
  const snap = forfeit ? null : await loadSnap(room.code);
  if (snap) {
    applySnap(room, snap);
    if (room.settled) {
      if (!wasSettled) await convergeSettlement(io, room, room.matchId);
      return;
    }
  }
  if (room.settled) return;
  // Set before any await so a second local call (timer + last POST) bows out.
  room.settled = true;
  clearTimers(room);

  // Exactly one isolate persists ELO / the matches doc for this match.
  const matchId = room.matchId;
  let claim: SettleClaim;
  try {
    claim = await claimSettlement(room);
  } catch (err) {
    // The matches {roomId, matchId} unique index still stops a double write.
    logOnce("claimSettlement")(err);
    claim = "local";
  }
  if (claim === "lost") {
    await convergeSettlement(io, room, matchId);
    return;
  }
  if (claim === "stale") return;

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

  // Friendly (private) rooms never move ELO: same match, same result screen,
  // no rating. Their result is still recorded, marked rated:false.
  const counts = !forfeit || !forfeit.underMinimum;
  const rateRanked = room.mode === "ranked" && room.rated && counts;
  const friendlyRanked = room.mode === "ranked" && !room.rated && counts;
  if (friendlyRanked) {
    room.lastEloDelta = 0;
    const [a, b] = seated;
    if (a && b) {
      const filled = new Map<string, ScoreCard>();
      for (const player of seated) {
        const card = scores[player.id];
        if (card) filled.set(player.id, card);
      }
      const sa = scores[a.id]?.overall ?? 0;
      const sb = scores[b.id]?.overall ?? 0;
      const outcome = forfeit
        ? forfeit.winnerId === a.id
          ? 1
          : forfeit.winnerId === b.id
            ? 0
            : 0.5
        : outcomeFromScores(sa, sb);
      await persistSeatedMatch({
        code: room.code,
        mode: room.mode,
        songId: room.songId,
        players: seated,
        scores: filled,
        forfeit: Boolean(forfeit),
        outcome,
        matchId,
        rated: false,
      }).catch(logOnce("persistSeatedMatch"));
    }
  } else if (rateRanked) {
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
          matchId,
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
      matchId,
    }).catch(logOnce("persistSeatedMatch"));
  }

  room.status = "results";
  room.playAtUnixMs = null;
  room.lastWinnerId = winnerId;

  if (!rateRanked) room.lastEloDelta = 0;
  const payload: MatchOverPayload = {
    scores,
    winnerId,
    eloDelta: room.lastEloDelta ?? 0,
    // Ranked: whether ELO moved. False in a friendly (private) room, and for
    // a forfeit under ForfeitSkipMs (thrown away rather than rated; a rated
    // forfeit uses K=16 not K=32, PRD §6.1).
    ...(room.mode === "ranked" || forfeit ? { rated: rateRanked } : {}),
    ...(forfeit ? { forfeit: true } : {}),
  };
  // Isolates that lost the claim show this exact result (convergeSettlement).
  if (claim === "won" && matchId != null) {
    // Snap first so the losers also pick up the new ELO on the seats.
    await saveRoomSnap(room).catch(logOnce("saveRoomSnap"));
    await publishSettlement(room, matchId, payload).catch(logOnce("publishSettlement"));
  }
  io.to(room.code).emit(ServerEvents.matchOver, payload);
  broadcastState(io, room);
}

/**
 * A disconnect or leave mid-match (countdown, turns, swap, live) hands the win
 * to whoever is left. Matches shorter than ForfeitSkipMs are discarded
 * entirely rather than rated (PRD §6.1).
 *
 * The results screen is never a forfeit: both turns are sung, so a seat that
 * leaves during the score wait (before settlement) is still counted and the
 * match settles normally on the scores (its card, or the empty-score
 * fallback), with ELO applied once. Before, it settled with one seat and
 * persisted no ELO, so a losing player could dodge by leaving.
 * The safety:leave path (moderation.ts) comes through here as well.
 * `roster` is the seated list in seat order, leaver included: call before the
 * seat is removed, or pass the list from before (pruneRoom drops dead seats
 * first, which used to leave a one-seat forfeit that persisted no ELO).
 */
export function forfeitFor(
  io: Server,
  room: Room,
  leaver: Player,
  roster: Player[] = room.players.slice(),
): void {
  if (awaitingSettlement(room)) {
    if (room.matchId != null && !room.settleSeats) {
      room.settleSeats = { matchId: room.matchId, seats: roster.slice() };
    }
    return;
  }
  if (!matchInProgress(room)) return;

  const survivor = roster.find((p) => p.id !== leaver.id && p.connected);
  const elapsed =
    room.matchStartedAtMs === null ? 0 : Date.now() - room.matchStartedAtMs;
  const seated = roster.slice();
  room.status = "results";

  void finishMatch(
    io,
    room,
    {
      winnerId: survivor?.id ?? null,
      underMinimum: elapsed < ForfeitSkipMs,
    },
    seated,
  ).catch(logOnce("finishMatch"));
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
  const window = chaosClip(song);
  room.songId = song.id;
  room.status = "live";
  room.activeSingerId = null;
  room.clipStartSec = window.startSec;
  room.clipDurationSec = window.durationSec;
  room.clipLeadInSec = 0;
  room.clipAnchor = null;

  const playAt = Date.now() + ClockLeadMs;
  scheduleClip(io, room, playAt);
  broadcastState(io, room);
  trackSongPlayed({
    mode: "chaos",
    songId: song.id,
    roomCode: room.code,
  }).catch(() => undefined);

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
