/**
 * Shared live state for Vercel: matchmaking queue + room snapshots in Atlas.
 * In-memory maps still run the clock on whichever isolate handled the event;
 * Mongo is how two laptops on two isolates find each other.
 */
import type { Mode, RoomStatus, ScoreCard } from "@karaoke/shared";
import { getDb } from "./db.ts";
import {
  addPlayer,
  createRoom,
  generateCode,
  getRoom,
  type Player,
  type Room,
} from "./rooms.ts";
import type { Waiting } from "./matchmaking.ts";

const WAITER_TTL_MS = 12_000;
const PAIR_TTL_MS = 120_000;

type QueueMode = Extract<Mode, "ranked" | "duet">;

type WaiterDoc = Waiting & {
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

type RoomSnap = {
  code: string;
  mode: Mode;
  players: Player[];
  songId: string | null;
  status: RoomStatus;
  activeSingerId: string | null;
  playAtUnixMs: number | null;
  clipStartSec: number;
  clipDurationSec: number;
  songStartedAtMs: number | null;
  matchStartedAtMs: number | null;
  lastEloDelta: number;
  settled: boolean;
  scores: Record<string, ScoreCard>;
  updatedAt: Date;
};

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
    { $set: { ...player, mode, updatedAt: new Date() } },
    { upsert: true },
  );

  const stale = new Date(Date.now() - WAITER_TTL_MS);
  const opp = await waiterCol.findOneAndDelete(
    {
      mode,
      clientId: { $ne: player.clientId },
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

export async function saveRoomSnap(room: Room): Promise<void> {
  const col = await snaps();
  if (!col) return;
  const scores: Record<string, ScoreCard> = {};
  for (const [id, card] of room.scores) scores[id] = card;
  await col.updateOne(
    { code: room.code },
    {
      $set: {
        code: room.code,
        mode: room.mode,
        players: room.players,
        songId: room.songId,
        status: room.status,
        activeSingerId: room.activeSingerId,
        playAtUnixMs: room.playAtUnixMs,
        clipStartSec: room.clipStartSec,
        clipDurationSec: room.clipDurationSec,
        songStartedAtMs: room.songStartedAtMs,
        matchStartedAtMs: room.matchStartedAtMs,
        lastEloDelta: room.lastEloDelta,
        settled: room.settled,
        scores,
        updatedAt: new Date(),
      },
    },
    { upsert: true },
  );
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

function applySnap(room: Room, snap: RoomSnap): void {
  const order: RoomStatus[] = ["lobby", "countdown", "turnA", "swap", "turnB", "live", "results"];
  const snapAhead = order.indexOf(snap.status) > order.indexOf(room.status);
  const rematch = room.status === "results" && snap.status === "lobby";
  if (snapAhead || rematch || room.status === "lobby" || snap.status === room.status) {
    room.status = snap.status;
    room.songId = snap.songId;
    room.activeSingerId = snap.activeSingerId;
    room.playAtUnixMs = snap.playAtUnixMs;
    room.clipStartSec = snap.clipStartSec;
    room.clipDurationSec = snap.clipDurationSec;
    room.songStartedAtMs = snap.songStartedAtMs;
    room.matchStartedAtMs = snap.matchStartedAtMs;
    room.lastEloDelta = snap.lastEloDelta;
  }
  if (snap.settled) room.settled = true;
  for (const p of snap.players) {
    const have = room.players.find((x) => x.clientId === p.clientId);
    if (have) {
      have.displayName = p.displayName;
      have.elo = p.elo;
      if (p.lastSeenMs) have.lastSeenMs = Math.max(have.lastSeenMs || 0, p.lastSeenMs);
      if (rematch) have.ready = p.ready;
      else if (p.ready) have.ready = true;
      continue;
    }
    if (!p.connected || !p.socketId || p.socketId === "pending") continue;
    addPlayer(room, {
      id: p.clientId,
      clientId: p.clientId,
      displayName: p.displayName,
      socketId: p.socketId || "pending",
      elo: p.elo,
    });
    const seated = room.players.find((x) => x.clientId === p.clientId);
    if (seated) {
      seated.ready = p.ready;
      seated.connected = p.connected;
    }
  }
  for (const [id, card] of Object.entries(snap.scores ?? {})) {
    if (!room.scores.has(id)) room.scores.set(id, card);
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
      id: person.clientId,
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
