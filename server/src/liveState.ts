/**
 * Shared live state for Vercel: matchmaking queue + room snapshots in Atlas.
 * In-memory maps still run the clock on whichever isolate handled the event;
 * Mongo is how two laptops on two isolates find each other.
 */
import type {
  ClipAnchor,
  Mode,
  RematchLapse,
  RematchOffer,
  RoomStatus,
  ScoreCard,
} from "@karaoke/shared";
import { randomUUID } from "node:crypto";
import type { Filter, UpdateFilter } from "mongodb";
import { getDb, isDuplicateKey } from "./db.ts";
import {
  addPlayer,
  clearTimers,
  createRoom,
  draftRoom,
  generateCode,
  getRoom,
  randomRoomCode,
  registerRoom,
  awaitingSettlement,
  currentMatchSeats,
  type MatchResult,
  type MatchSeat,
  type Player,
  type Room,
} from "./rooms.ts";
import type { Waiting } from "./matchmaking.ts";
import { mergeRematchSnap } from "./rematch.ts";
import { publicPlayerId } from "./publicId.ts";
import { pairingAvoidList } from "./moderation.ts";

const WAITER_TTL_MS = 12_000;
const PAIR_TTL_MS = 120_000;

type QueueMode = Extract<Mode, "ranked" | "duet">;

type WaiterDoc = Waiting & {
  /** Public player id, so block lists (keyed by it) can filter the queue. */
  playerId?: string;
  mode: QueueMode;
  updatedAt: Date;
};

type PairDoc = {
  _id: string;
  code: string;
  mode: QueueMode;
  a: Waiting;
  b: Waiting;
  createdAt: Date;
};

export type RoomSnap = {
  code: string;
  mode: Mode;
  players: Player[];
  songId: string | null;
  status: RoomStatus;
  activeSingerId: string | null;
  playAtUnixMs: number | null;
  clipStartSec: number;
  clipDurationSec: number;
  /** Older snaps lack these; read as no lead-in / no anchor. */
  clipLeadInSec?: number;
  clipAnchor?: ClipAnchor | null;
  songStartedAtMs: number | null;
  matchStartedAtMs: number | null;
  lastEloDelta: number;
  lastWinnerId?: string | null;
  settled: boolean;
  /** Open rematch offer while in results. Older snaps carried `rematchAtMs` instead; ignored. */
  rematch?: RematchOffer | null;
  rematchLapse?: RematchLapse | null;
  /**
   * See Room.rated / isPrivate / hostId. Fixed for the room's life. Absent on
   * snaps written before private rooms were unrated: such a room keeps
   * whatever this isolate already knows, and a room first built from one is
   * rated, public and hostless (the old behaviour).
   */
  rated?: boolean;
  isPrivate?: boolean;
  hostId?: string | null;
  /** See Room.matchId. Absent on snaps written before score claims existed. */
  matchId?: number | null;
  /** See Room.matchSeats: the match roster, so any isolate settles with both seats. */
  matchSeats?: { matchId: number; seats: MatchSeat[] } | null;
  /**
   * One card per seat per match. Written only by claimScore (and the verdict
   * refresh of an already-claimed card), never by saveRoomSnap's whole-doc
   * $set, so a stale isolate's save cannot erase or replace a claimed score.
   * Entries from an older match are ignored (their matchId differs).
   */
  matchScores?: Record<string, SnapScore>;
  /** Written only by claimSettlement: the matchId this room last settled. */
  settledMatchId?: number;
  settledBy?: string;
  /** The winning isolate's match:over payload, so losers show the same result. */
  settledResult?: SettledResult;
  /** Legacy (pre-claim) snaps carried the score map here. Read only when matchId is absent. */
  scores?: Record<string, ScoreCard>;
  updatedAt: Date;
};

export type SnapScore = { matchId: number; card: ScoreCard };

/**
 * What finishMatch emits as match:over. `rated` (Ranked) is false when no ELO
 * moved (a friendly room, or a forfeit under ForfeitSkipMs); `seatAId` is the
 * match's first seat, which `eloDelta` is relative to.
 */
export type MatchOverPayload = Omit<MatchResult, "matchId">;

export type SettledResult = MatchResult;

/** Names this isolate in `settledBy` (which instance settled a match). */
export const instanceId = randomUUID();

function waiters() {
  return getDb().then((db) => db?.collection<WaiterDoc>("queueWaiters") ?? null);
}
function pairs() {
  return getDb().then((db) => db?.collection<PairDoc>("queuePairs") ?? null);
}
function snaps() {
  return getDb().then((db) => db?.collection<RoomSnap>("liveRooms") ?? null);
}

export async function rememberWaiter(mode: QueueMode, player: Waiting): Promise<void> {
  const col = await waiters();
  if (!col) return;
  await col.updateOne(
    { clientId: player.clientId },
    { $set: { ...player, mode, updatedAt: new Date() } },
    { upsert: true },
  );
}

export async function forgetWaiter(filter: { clientId?: string; socketId?: string }): Promise<void> {
  const col = await waiters();
  if (!col) return;
  if (filter.clientId) await col.deleteOne({ clientId: filter.clientId });
  else if (filter.socketId) await col.deleteOne({ socketId: filter.socketId });
}

export async function findOpenPair(clientId: string, mode: QueueMode): Promise<PairDoc | null> {
  const col = await pairs();
  if (!col) return null;
  const cutoff = new Date(Date.now() - PAIR_TTL_MS);
  const doc = await col.findOne({
    mode,
    createdAt: { $gt: cutoff },
    $or: [{ "a.clientId": clientId }, { "b.clientId": clientId }],
  });
  if (!doc) return null;
  const room = await ensureRoom(doc.code);
  if (room && (room.settled || room.status === "results")) {
    await col.deleteOne({ _id: doc._id });
    return null;
  }
  return doc;
}

/**
 * Reserve a fresh room code across instances. Each try upserts the draft's
 * snapshot with $setOnInsert, so it only writes when no liveRooms doc has
 * that code (a live room on another instance, or a leftover snapshot of an
 * ended one). The unique {code} index turns a lost upsert race into E11000.
 * Either way the code is taken and we try another.
 *
 * Returns the reserved draft (not registered on this instance), or null
 * without Mongo, when Mongo errors, or after 40 taken codes. Callers then
 * fall back to a code checked against this instance only.
 */
export async function reserveSharedCode(makeDraft: (code: string) => Room): Promise<Room | null> {
  const col = await snaps();
  if (!col) return null;
  for (let attempt = 0; attempt < 40; attempt++) {
    const code = randomRoomCode();
    if (getRoom(code)) continue;
    const draft = makeDraft(code);
    try {
      const res = await col.updateOne(
        { code },
        { $setOnInsert: snapFromRoom(draft) },
        { upsert: true },
      );
      if (res.upsertedCount === 1) return draft;
    } catch (err) {
      if (isDuplicateKey(err)) continue;
      console.error("[liveState] room code reservation failed; using a local code", err);
      return null;
    }
  }
  return null;
}

/**
 * Claim one specific code (a typed private lounge code). True when this call
 * created its liveRooms doc, or without Mongo; false when another instance
 * already holds a doc for it.
 */
export async function reserveExactCode(draft: Room): Promise<boolean> {
  const col = await snaps();
  if (!col) return true;
  try {
    const res = await col.updateOne(
      { code: draft.code },
      { $setOnInsert: snapFromRoom(draft) },
      { upsert: true },
    );
    return res.upsertedCount === 1;
  } catch (err) {
    if (isDuplicateKey(err)) return false;
    console.error("[liveState] room code reservation failed", err);
    return true;
  }
}

/**
 * A new room (room:create) whose code no other live instance holds. `setup`
 * runs on the draft before its snapshot is written (host, private, unrated).
 * Without Mongo: a code free on this instance, as before.
 */
export async function createSharedRoom(mode: Mode, setup: (room: Room) => void = () => {}): Promise<Room> {
  const reserved = await reserveSharedCode((code) => {
    const draft = draftRoom(mode, code);
    setup(draft);
    return draft;
  });
  if (reserved && !getRoom(reserved.code)) return registerRoom(reserved);
  const room = createRoom(mode);
  setup(room);
  return room;
}

/** Queue matches: a code reserved across instances (see reserveSharedCode). */
async function generateSharedCode(mode: QueueMode): Promise<string> {
  const reserved = await reserveSharedCode((code) => draftRoom(mode, code));
  return reserved?.code ?? generateCode();
}

/**
 * Upsert this player in the shared queue. If another fresh waiter exists,
 * atomically create one pair document both isolates can read.
 */

export async function sharedPairOrWait(
  mode: QueueMode,
  player: Waiting,
): Promise<{ code: string; pair: [Waiting, Waiting] } | "waiting" | null> {
  const waiterCol = await waiters();
  const pairCol = await pairs();
  if (!waiterCol || !pairCol) return null;

  const existing = await findOpenPair(player.clientId, mode);
  if (existing) return { code: existing.code, pair: [existing.a, existing.b] };

  await waiterCol.updateOne(
    { clientId: player.clientId },
    { $set: { ...player, playerId: publicPlayerId(player.clientId), mode, updatedAt: new Date() } },
    { upsert: true },
  );

  const stale = new Date(Date.now() - WAITER_TTL_MS);
  // Never pair two players where either has blocked the other (moderation.ts).
  // Blocks are keyed by public player id, never the secret clientId.
  const avoid = await pairingAvoidList(publicPlayerId(player.clientId));
  const opp = await waiterCol.findOneAndDelete(
    {
      mode,
      clientId: { $ne: player.clientId },
      playerId: { $nin: avoid },
      updatedAt: { $gt: stale },
    },
    { sort: { updatedAt: 1 } },
  );
  if (!opp) return "waiting";

  const lo = player.clientId < opp.clientId ? player.clientId : opp.clientId;
  const hi = player.clientId < opp.clientId ? opp.clientId : player.clientId;
  const id = `${mode}:${lo}:${hi}`;
  const pair: [Waiting, Waiting] = [
    { socketId: opp.socketId, clientId: opp.clientId, displayName: opp.displayName, elo: opp.elo },
    player,
  ];
  const code = await generateSharedCode(mode);
  try {
    await pairCol.insertOne({
      _id: id,
      code,
      mode,
      a: pair[0],
      b: pair[1],
      createdAt: new Date(),
    });
  } catch {
    const won = await pairCol.findOne({ _id: id });
    if (won) {
      await waiterCol.deleteMany({ clientId: { $in: [player.clientId, opp.clientId] } });
      return { code: won.code, pair: [won.a, won.b] };
    }
    await waiterCol.updateOne(
      { clientId: opp.clientId },
      {
        $set: {
          socketId: opp.socketId,
          clientId: opp.clientId,
          displayName: opp.displayName,
          elo: opp.elo,
          mode,
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    );
    return "waiting";
  }
  await waiterCol.deleteMany({ clientId: { $in: [player.clientId, opp.clientId] } });
  return { code, pair };
}

/** What saveRoomSnap writes. Exported for the snapshot round-trip test. */
export function snapFromRoom(room: Room): RoomSnap {
  return {
    code: room.code,
    mode: room.mode,
    players: room.players,
    songId: room.songId,
    status: room.status,
    activeSingerId: room.activeSingerId,
    playAtUnixMs: room.playAtUnixMs,
    clipStartSec: room.clipStartSec,
    clipDurationSec: room.clipDurationSec,
    clipLeadInSec: room.clipLeadInSec,
    clipAnchor: room.clipAnchor,
    songStartedAtMs: room.songStartedAtMs,
    matchStartedAtMs: room.matchStartedAtMs,
    matchId: room.matchId,
    matchSeats: room.matchSeats,
    lastEloDelta: room.lastEloDelta,
    lastWinnerId: room.lastWinnerId,
    settled: room.settled,
    rematch: room.rematch,
    rematchLapse: room.rematchLapse,
    rated: room.rated,
    isPrivate: room.isPrivate,
    hostId: room.hostId,
    // No scores here: they are written only by claimScore (see matchScores).
    updatedAt: new Date(),
  };
}

export async function saveRoomSnap(room: Room): Promise<void> {
  const col = await snaps();
  if (!col) return;
  await col.updateOne({ code: room.code }, { $set: snapFromRoom(room) }, { upsert: true });
}

/** The raw snapshot document, or null without Mongo / when none exists. */
export async function loadSnap(code: string): Promise<RoomSnap | null> {
  const col = await snaps();
  return col ? await col.findOne({ code }) : null;
}

export async function ensureRoom(code: string): Promise<Room | undefined> {
  const local = getRoom(code);
  const col = await snaps();
  const snap = col ? await col.findOne({ code }) : null;
  if (local && !snap) return local;
  if (!snap) return local;
  if (!local) {
    const room = createRoom(snap.mode, snap.code, snap.code === "0000");
    applySnap(room, snap);
    return room;
  }
  applySnap(local, snap);
  return local;
}

export function applySnap(room: Room, snap: RoomSnap): void {
  // Fixed per room, so they only ever move one way: if either copy says the
  // room is private/unrated, it is. A stale or old-format snap cannot turn a
  // friendly room into a rated one (or hand a private room a new host).
  if (snap.rated === false) room.rated = false;
  if (snap.isPrivate === true) room.isPrivate = true;
  if (!room.hostId && typeof snap.hostId === "string" && snap.hostId) room.hostId = snap.hostId;
  const order: RoomStatus[] = ["lobby", "countdown", "turnA", "swap", "turnB", "live", "results"];
  const snapAhead = order.indexOf(snap.status) > order.indexOf(room.status);
  // Another isolate accepted a rematch: its snap is back in lobby/countdown with
  // a clip scheduled after anything this (results) room ever played. A stale
  // mid-match snap never has a newer songStartedAtMs, so it cannot rewind us.
  const rematch =
    room.status === "results" &&
    snap.status !== "results" &&
    (snap.status === "lobby" || (snap.songStartedAtMs ?? 0) > (room.songStartedAtMs ?? 0));
  if (rematch) {
    clearTimers(room);
    room.scores.clear();
    room.settled = false;
    room.rematch = null;
    room.rematchLapse = null;
  }
  // The mirror case: this isolate already restarted (countdown+) and the snap
  // is still the previous match's results. Do not let it rewind or re-settle us.
  const staleResults =
    snap.status === "results" &&
    room.status !== "results" &&
    room.status !== "lobby" &&
    (room.songStartedAtMs ?? 0) > (snap.songStartedAtMs ?? 0);
  if (staleResults) return;
  // A snap of an earlier match (a save that landed late, or another isolate
  // that has not seen the rematch) must never rewind this one: its status,
  // clip, and clock all belong to the old song.
  const olderMatch =
    snap.matchId != null && room.matchId != null && snap.matchId < room.matchId;
  if (olderMatch) return;
  if (snapAhead || rematch || room.status === "lobby" || snap.status === room.status) {
    room.status = snap.status;
    room.songId = snap.songId;
    room.activeSingerId = snap.activeSingerId;
    room.playAtUnixMs = snap.playAtUnixMs;
    room.clipStartSec = snap.clipStartSec;
    room.clipDurationSec = snap.clipDurationSec;
    room.clipLeadInSec = snap.clipLeadInSec ?? 0;
    room.clipAnchor = snap.clipAnchor ?? null;
    room.songStartedAtMs = snap.songStartedAtMs;
    room.matchStartedAtMs = snap.matchStartedAtMs;
    if (snap.matchId !== undefined) room.matchId = snap.matchId;
    room.lastEloDelta = snap.lastEloDelta;
    if (snap.lastWinnerId !== undefined) room.lastWinnerId = snap.lastWinnerId;
  }
  mergeRematchSnap(room, snap.rematch, snap.rematchLapse);
  if (snap.matchSeats && room.matchId != null && snap.matchSeats.matchId === room.matchId) {
    room.matchSeats = {
      matchId: snap.matchSeats.matchId,
      seats: snap.matchSeats.seats.map((seat) => ({ ...seat })),
    };
  }
  // Settled means "the result is known", not "someone claimed it": the claim
  // (settledMatchId) lands before the winner has persisted, so taking it as
  // settled would show a winner from partial scores and no ELO. The result
  // itself is applied at the end (applyResult). Legacy snaps had only the flag.
  if (snap.matchId === undefined && snap.settled) room.settled = true;
  const snapIds = new Set(snap.players.map((p) => p.clientId));
  for (const p of snap.players) {
    const have = room.players.find((x) => x.clientId === p.clientId);
    if (have) {
      have.displayName = p.displayName;
      have.elo = p.elo;
      if (p.lastSeenMs) have.lastSeenMs = Math.max(have.lastSeenMs || 0, p.lastSeenMs);
      if (p.socketId && p.socketId !== "pending") have.socketId = p.socketId;
      if (rematch) have.ready = p.ready;
      else if (p.ready) have.ready = true;
      if (p.connected) have.connected = true;
      continue;
    }
    if (!p.connected || !p.socketId || p.socketId === "pending") continue;
    addPlayer(room, {
      // Recompute rather than trust the snap: an older snap stored id = clientId.
      id: publicPlayerId(p.clientId),
      clientId: p.clientId,
      displayName: p.displayName,
      socketId: p.socketId || "pending",
      elo: p.elo,
    });
    const seated = room.players.find((x) => x.clientId === p.clientId);
    if (seated) {
      seated.ready = p.ready;
      seated.connected = p.connected;
      if (p.lastSeenMs) seated.lastSeenMs = p.lastSeenMs;
    }
  }
  const now = Date.now();
  // While the match awaits settlement its seats stay: one that left on
  // another isolate still counts, and still settles with its own card.
  const keep = awaitingSettlement(room)
    ? new Set((currentMatchSeats(room) ?? []).map((s) => s.clientId))
    : new Set<string>();
  room.players = room.players.filter(
    (p) => snapIds.has(p.clientId) || keep.has(p.clientId) || now - p.lastSeenMs < 8_000,
  );
  // Merge, never replace: a score this isolate already holds for the match wins.
  if (snap.matchId === undefined) {
    for (const [id, card] of Object.entries(snap.scores ?? {})) {
      if (!room.scores.has(id)) room.scores.set(id, card);
    }
  } else if (room.matchId != null) {
    for (const [id, entry] of Object.entries(snap.matchScores ?? {})) {
      if (entry?.matchId !== room.matchId || !entry.card) continue;
      if (!room.scores.has(id)) room.scores.set(id, entry.card);
    }
  }
  const result = snap.settledResult;
  if (room.matchId != null && result && result.matchId === room.matchId) applyResult(room, result);
}

/** Take a published settlement as this room's result: winner, ELO, cards, flags. */
export function applyResult(room: Room, result: SettledResult): void {
  room.settled = true;
  room.result = { ...result, scores: { ...result.scores } };
  room.lastWinnerId = result.winnerId;
  room.lastEloDelta = result.eloDelta;
  for (const [id, card] of Object.entries(result.scores)) room.scores.set(id, card);
}

/**
 * This match's claimed cards from a snapshot (matchScores), by seat id.
 * After settledMatchId is set no further claim can land, so a read taken
 * after winning the settlement claim is complete.
 */
export function claimedScores(snap: RoomSnap, matchId: number): Map<string, ScoreCard> {
  const out = new Map<string, ScoreCard>();
  for (const [id, entry] of Object.entries(snap.matchScores ?? {})) {
    if (entry?.matchId === matchId && entry.card) out.set(id, entry.card);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cross-isolate claims. Every isolate holding a room runs its clock, so two
// isolates can each accept a score or settle the same match. These are atomic
// conditional writes on the liveRooms doc; the first writer wins.
// Without Mongo they answer "local": single-instance behaviour, unchanged.
// ---------------------------------------------------------------------------

export type ScoreClaim = "claimed" | "local" | "duplicate" | "settled" | "stale";

/**
 * Store `card` as `playerId`'s one score for the room's current match, unless
 * one is already stored or the match is settled / no longer current.
 */
export async function claimScore(room: Room, playerId: string, card: ScoreCard): Promise<ScoreClaim> {
  const matchId = room.matchId;
  const col = await snaps();
  if (!col || matchId == null) return "local";
  const key = `matchScores.${playerId}`;
  const filter = {
    code: room.code,
    matchId,
    settledMatchId: { $ne: matchId },
    [`${key}.matchId`]: { $ne: matchId },
  } as Filter<RoomSnap>;
  const update = { $set: { [key]: { matchId, card } } } as UpdateFilter<RoomSnap>;
  const res = await col.updateOne(filter, update);
  if (res.matchedCount > 0) return "claimed";
  const doc = await col.findOne({ code: room.code });
  if (!doc) return "local";
  if (doc.matchScores?.[playerId]?.matchId === matchId) return "duplicate";
  if (doc.settledMatchId === matchId) return "settled";
  if ((doc.matchId ?? 0) > matchId) return "stale";
  // The snap lags this isolate (its save has not landed yet): fall back to
  // the local one-score rule, which the caller has already applied.
  return "local";
}

/** Swap in the Gemini verdict on a card that is already claimed. Numbers never change. */
export async function refreshClaimedCard(
  room: Room,
  matchId: number,
  playerId: string,
  card: ScoreCard,
): Promise<void> {
  const col = await snaps();
  if (!col) return;
  const key = `matchScores.${playerId}`;
  await col.updateOne(
    { code: room.code, [`${key}.matchId`]: matchId } as Filter<RoomSnap>,
    { $set: { [`${key}.card`]: card } } as UpdateFilter<RoomSnap>,
  );
}

export type SettleClaim = "won" | "lost" | "stale" | "local";

/**
 * Exactly one isolate may persist a match (ELO, matches doc, duet best).
 * "won": this isolate persists. "lost": another isolate already did (or is
 * doing it); converge from its published result. "stale": the room doc has
 * moved on to a newer match. "local": no Mongo / no snap; settle as a single
 * instance (the matches unique index still stops a double write).
 */
export async function claimSettlement(room: Room): Promise<SettleClaim> {
  const matchId = room.matchId;
  const col = await snaps();
  if (!col || matchId == null) return "local";
  const won = await col.findOneAndUpdate(
    { code: room.code, matchId, settledMatchId: { $ne: matchId } } as Filter<RoomSnap>,
    { $set: { settledMatchId: matchId, settledBy: instanceId, settled: true } },
  );
  if (won) return "won";
  const doc = await col.findOne({ code: room.code });
  if (!doc) return "local";
  if (doc.settledMatchId === matchId) return "lost";
  if ((doc.matchId ?? 0) > matchId) return "stale";
  return "local";
}

/** The claim winner publishes its match:over payload for the losing isolates. */
export async function publishSettlement(
  room: Room,
  matchId: number,
  result: MatchOverPayload,
): Promise<void> {
  const col = await snaps();
  if (!col) return;
  await col.updateOne(
    { code: room.code, settledMatchId: matchId } as Filter<RoomSnap>,
    { $set: { settledResult: { ...result, matchId } } },
  );
}

/** Poll for the winner's published result (it persists ELO first). Null on timeout. */
export async function awaitSettlement(
  code: string,
  matchId: number,
  timeoutMs: number,
  pollMs = 250,
): Promise<{ snap: RoomSnap; result: SettledResult } | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const snap = await loadSnap(code);
    const result = snap?.settledResult;
    if (snap && result && result.matchId === matchId) return { snap, result };
    if (Date.now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

export async function seatPairOnThisIsolate(
  room: Room,
  pair: [Waiting, Waiting],
  seatFn: (socketId: string, room: Room) => boolean,
): Promise<void> {
  for (const person of pair) {
    const already = room.players.find((p) => p.clientId === person.clientId);
    if (already) continue;
    addPlayer(room, {
      id: publicPlayerId(person.clientId),
      clientId: person.clientId,
      displayName: person.displayName,
      socketId: person.socketId,
      elo: person.elo,
    });
  }
  for (const person of pair) {
    seatFn(person.socketId, room);
  }
  await saveRoomSnap(room);
}

// ---------------------------------------------------------------------------
// Releasing abandoned room:create reservations.
//
// Every reservation is a liveRooms doc that otherwise lives until the 2h TTL
// on updatedAt, and disposeIfEmpty (rooms.ts) never deletes it. Codes are 4
// digits, so a loop of room:create could hold most of them. A private room
// this instance created is watched; once this instance no longer holds it and
// its doc is still an empty private lobby by the same host that never played
// a match and that nobody has saved for ReservationReleaseGraceMs, the doc
// is deleted. The delete is conditional on all of that, so it never removes
// a room another instance is using (a seat or any save there keeps it).
// Best effort: an instance that stops (Vercel) leaves the doc to the TTL.
// ---------------------------------------------------------------------------

/** How long an abandoned reservation is kept, so its host can reload and rejoin. */
export const ReservationReleaseGraceMs = 2 * 60_000;
/** How often watched reservations are checked. */
export const ReservationSweepMs = 30_000;
/** Watched reservations per instance (oldest dropped first; those fall back to the TTL). */
export const ReservationWatchMax = 10_000;
/** Matches the liveRooms TTL: past this, the doc expires on its own. */
const ReservationWatchMaxAgeMs = 2 * 60 * 60_000;

type WatchedReservation = { hostId: string | null; since: number };
const watched = new Map<string, WatchedReservation>();
let sweepTimer: NodeJS.Timeout | null = null;

/**
 * Watch a private room this instance just reserved with room:create, so its
 * code is released once the room is abandoned (see releaseReservation).
 */
export function watchReservation(room: Room, now = Date.now()): void {
  if (!room.isPrivate || room.persistent) return;
  watched.delete(room.code);
  watched.set(room.code, { hostId: room.hostId, since: now });
  while (watched.size > ReservationWatchMax) {
    const oldest = watched.keys().next().value;
    if (oldest === undefined) break;
    watched.delete(oldest);
  }
  if (!sweepTimer) {
    sweepTimer = setInterval(() => {
      void sweepReservations().catch((err) => console.error("[liveState] reservation sweep failed", err));
    }, ReservationSweepMs);
    sweepTimer.unref?.();
  }
}

/**
 * Delete a reservation's liveRooms doc if, and only if, it is still the empty
 * private lobby `hostId` made, it never played a match, and nobody has saved
 * it for ReservationReleaseGraceMs. "released" when deleted; "busy" when it
 * may still be in use (check again later); "gone" when there is nothing of
 * ours to release (no doc, another host's room, a match was played, no Mongo).
 */
export async function releaseReservation(
  code: string,
  hostId: string | null,
  now = Date.now(),
): Promise<"released" | "busy" | "gone"> {
  const col = await snaps();
  if (!col) return "gone";
  const res = await col.deleteOne({
    code,
    isPrivate: true,
    hostId,
    status: "lobby",
    players: [],
    settledMatchId: { $exists: false },
    matchScores: { $exists: false },
    updatedAt: { $lt: new Date(now - ReservationReleaseGraceMs) },
  } as Filter<RoomSnap>);
  if (res.deletedCount === 1) return "released";
  const doc = await col.findOne({ code });
  if (!doc || doc.hostId !== hostId || doc.settledMatchId !== undefined || doc.matchScores !== undefined) {
    return "gone";
  }
  return "busy";
}

/**
 * One pass over watched reservations: try to release each whose room this
 * instance no longer holds. Exported for tests; normally run on a timer.
 */
export async function sweepReservations(now = Date.now()): Promise<number> {
  let released = 0;
  for (const [code, entry] of [...watched]) {
    if (now - entry.since > ReservationWatchMaxAgeMs) {
      watched.delete(code);
      continue;
    }
    if (getRoom(code)) continue;
    try {
      const out = await releaseReservation(code, entry.hostId, now);
      if (out === "busy") continue;
      watched.delete(code);
      if (out === "released") released++;
    } catch (err) {
      watched.delete(code);
      console.error("[liveState] reservation release failed", err);
    }
  }
  if (watched.size === 0 && sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
  return released;
}

/** Test-only: how many reservations are watched; `reset` forgets them all. */
export function watchedReservations(reset = false): number {
  const n = watched.size;
  if (reset) {
    watched.clear();
    if (sweepTimer) clearInterval(sweepTimer);
    sweepTimer = null;
  }
  return n;
}
