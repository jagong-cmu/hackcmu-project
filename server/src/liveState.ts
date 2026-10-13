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
import { getDb } from "./db.ts";
import {
  addPlayer,
  clearTimers,
  createRoom,
  generateCode,
  getRoom,
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
  /** See Room.matchId. Absent on snaps written before score claims existed. */
  matchId?: number | null;
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

/** What finishMatch emits as match:over. */
export type MatchOverPayload = {
  scores: Record<string, ScoreCard>;
  winnerId: string | null;
  eloDelta: number;
  forfeit?: boolean;
  rated?: boolean;
};

export type SettledResult = MatchOverPayload & { matchId: number };

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
 * Upsert this player in the shared queue. If another fresh waiter exists,
 * atomically create one pair document both isolates can read.
 */
async function generateSharedCode(): Promise<string> {
  const col = await snaps();
  for (let attempt = 0; attempt < 40; attempt++) {
    const code = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
    if (getRoom(code)) continue;
    if (col && (await col.findOne({ code }))) continue;
    return code;
  }
  return generateCode();
}

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
  const code = await generateSharedCode();
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
    lastEloDelta: room.lastEloDelta,
    lastWinnerId: room.lastWinnerId,
    settled: room.settled,
    rematch: room.rematch,
    rematchLapse: room.rematchLapse,
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
  if (snap.settled) room.settled = true;
  if (room.matchId != null && snap.settledMatchId === room.matchId) room.settled = true;
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
  room.players = room.players.filter(
    (p) => snapIds.has(p.clientId) || now - p.lastSeenMs < 8_000,
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
