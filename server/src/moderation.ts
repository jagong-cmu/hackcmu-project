/**
 * Room safety: report, block, remove (issue #9).
 *
 * Rules (documented in PRD §6.5):
 * - Report: anyone, about anyone seated in their room. Short reason + optional
 *   note. Stored in Mongo `reports` and always logged. ReportLimit per
 *   ReportWindowMs per reporter; repeat reports of the same person in the same
 *   room are acknowledged but not stored twice.
 * - Block: per player, stored in Mongo `blocks`. Hides + unsubscribes the
 *   blocked person on the blocker's screen right away, and the matchmaker never
 *   pairs two players where either has blocked the other.
 * - Remove:
 *   - Private rooms (room:create, or a 4-digit Chaos code): the host (whoever
 *     made the room) kicks immediately, in any mode.
 *   - Chaos (public lounge, or a private one when you are not the host): vote
 *     kick. A strict majority of the other live people must vote, and never
 *     fewer than 2, so one person can never remove another alone. With only one
 *     other person present there is no vote; block instead.
 *   - Ranked/Duet (not host): no kick. Block or report your opponent and you
 *     can leave with no rating change for either of you; the match just ends.
 *   A removed player is banned from that room code for RoomBanMs (memory +
 *   Mongo `roomBans`), their LiveKit connection is dropped, and the token
 *   endpoint and the join handlers refuse them via `isBannedFromRoom`.
 */
import { RoomServiceClient } from "livekit-server-sdk";
import type { Server, Socket } from "socket.io";
import {
  BlockLimit,
  MaxBlockedPlayers,
  ClientEvents,
  PublicChaosPrefix,
  ReportLimit,
  ReportNoteMax,
  ReportReasons,
  ReportWindowMs,
  RoomBanMs,
  ServerEvents,
  votesToRemove,
  type Mode,
  type ReportReason,
  type SafetyAck,
  type SafetyNotice,
  type SafetyRemoved,
  type SafetyState,
} from "@karaoke/shared";
import { getDb } from "./db.ts";
import { cleanText } from "./hardening.ts";
import { liveKitRoomName, readLiveKitConfig } from "./livekit.ts";
import {
  createRoom,
  findOpenPublicChaosLounge,
  getRoom,
  isFull,
  livePlayers,
  removePlayer,
  resetToLobby,
  type Room,
} from "./rooms.ts";

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

/** Sliding-window counter: at most `limit` hits per key per `windowMs`. */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(
    readonly limit: number,
    readonly windowMs: number,
  ) {}

  take(key: string, now = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }

  reset(): void {
    this.hits.clear();
  }
}

const reportLimiter = new RateLimiter(ReportLimit, ReportWindowMs);
const blockLimiter = new RateLimiter(BlockLimit, ReportWindowMs);
const voteLimiter = new RateLimiter(10, 60_000);

// ---------------------------------------------------------------------------
// Mongo (best effort; everything works in memory when Atlas is down)
// ---------------------------------------------------------------------------

export type ReportDoc = {
  reporterId: string;
  reportedId: string;
  reporterName: string;
  reportedName: string;
  roomCode: string;
  mode: Mode;
  reason: ReportReason;
  note: string;
  createdAt: Date;
};

type BlockDoc = { blockerId: string; blockedId: string; createdAt: Date };
type BanDoc = {
  code: string;
  playerId: string;
  byId: string;
  reason: "host" | "vote";
  createdAt: Date;
  expiresAt: Date;
};

let indexed: Promise<void> | null = null;

async function safetyDb() {
  const db = await getDb().catch(() => null);
  if (!db) return null;
  indexed ??= (async () => {
    await db.collection("reports").createIndex({ createdAt: -1 });
    await db.collection("reports").createIndex({ reportedId: 1, createdAt: -1 });
    await db.collection("blocks").createIndex({ blockerId: 1, blockedId: 1 }, { unique: true });
    await db.collection("blocks").createIndex({ blockedId: 1 });
    await db.collection("roomBans").createIndex({ code: 1, playerId: 1 }, { unique: true });
    await db.collection("roomBans").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  })().catch((err) => {
    indexed = null;
    console.warn("[safety] index setup failed", err);
  });
  await indexed;
  return db;
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

const blocksBy = new Map<string, Set<string>>();
const blockedBy = new Map<string, Set<string>>();
const hydratedAt = new Map<string, number>();
const HYDRATE_MS = 30_000;

function remember(blocker: string, blocked: string): void {
  if (!blocksBy.has(blocker)) blocksBy.set(blocker, new Set());
  if (!blockedBy.has(blocked)) blockedBy.set(blocked, new Set());
  blocksBy.get(blocker)!.add(blocked);
  blockedBy.get(blocked)!.add(blocker);
}

export function hasBlocked(blocker: string, blocked: string): boolean {
  return blocksBy.get(blocker)?.has(blocked) ?? false;
}

/** Sync, from the cache. True when either player has blocked the other. */
export function blockedEitherWay(a: string, b: string): boolean {
  return hasBlocked(a, b) || hasBlocked(b, a);
}

export function blockListOf(playerId: string): string[] {
  return [...(blocksBy.get(playerId) ?? [])];
}

/** Pull this player's blocks (both directions) from Mongo into the cache. */
export async function hydrateBlocks(playerId: string): Promise<void> {
  const last = hydratedAt.get(playerId) ?? 0;
  if (Date.now() - last < HYDRATE_MS) return;
  try {
    const db = await safetyDb();
    if (!db) return;
    const docs = await db
      .collection<BlockDoc>("blocks")
      .find({ $or: [{ blockerId: playerId }, { blockedId: playerId }] })
      .limit(2000)
      .toArray();
    for (const doc of docs) remember(doc.blockerId, doc.blockedId);
    hydratedAt.set(playerId, Date.now());
  } catch (err) {
    console.warn("[safety] block hydrate failed", err);
  }
}

/** Everyone this player must never be paired with (blocked, or blocked them). */
export async function pairingAvoidList(playerId: string): Promise<string[]> {
  await hydrateBlocks(playerId);
  return [
    ...new Set([...(blocksBy.get(playerId) ?? []), ...(blockedBy.get(playerId) ?? [])]),
  ];
}

export async function addBlock(blocker: string, blocked: string): Promise<void> {
  remember(blocker, blocked);
  try {
    const db = await safetyDb();
    if (!db) return;
    await db
      .collection<BlockDoc>("blocks")
      .updateOne(
        { blockerId: blocker, blockedId: blocked },
        { $setOnInsert: { blockerId: blocker, blockedId: blocked, createdAt: new Date() } },
        { upsert: true },
      );
  } catch (err) {
    console.warn("[safety] block persist failed (kept in memory)", err);
  }
}

// ---------------------------------------------------------------------------
// Room bans
// ---------------------------------------------------------------------------

const bans = new Map<string, number>();
const banKey = (code: string, playerId: string) => `${code}\u0000${playerId}`;

/** Sync, this isolate only. Used by seat() where we cannot await. */
export function isBannedLocal(code: string, playerId: string, now = Date.now()): boolean {
  const until = bans.get(banKey(code, playerId));
  if (until === undefined) return false;
  if (until > now) return true;
  bans.delete(banKey(code, playerId));
  return false;
}

/**
 * True when `playerId` was removed from room `code` and may not come back.
 * Checks this isolate, then Mongo (another isolate may have done the kick).
 * The LiveKit token endpoint and the room join handlers both call this.
 */
export async function isBannedFromRoom(code: string, playerId: string): Promise<boolean> {
  if (!code || !playerId) return false;
  if (isBannedLocal(code, playerId)) return true;
  try {
    const db = await safetyDb();
    if (!db) return false;
    const doc = await db
      .collection<BanDoc>("roomBans")
      .findOne({ code, playerId, expiresAt: { $gt: new Date() } });
    if (!doc) return false;
    bans.set(banKey(code, playerId), doc.expiresAt.getTime());
    return true;
  } catch {
    return false;
  }
}

export async function banFromRoom(
  code: string,
  playerId: string,
  byId: string,
  reason: "host" | "vote",
): Promise<void> {
  const now = Date.now();
  bans.set(banKey(code, playerId), now + RoomBanMs);
  try {
    const db = await safetyDb();
    if (!db) return;
    await db.collection<BanDoc>("roomBans").updateOne(
      { code, playerId },
      {
        $set: {
          code,
          playerId,
          byId,
          reason,
          createdAt: new Date(now),
          expiresAt: new Date(now + RoomBanMs),
        },
      },
      { upsert: true },
    );
  } catch (err) {
    console.warn("[safety] ban persist failed (kept in memory)", err);
  }
}

/** Public Chaos auto-pick, skipping lounges this player was removed from. */
export function openLoungeFor(playerId: string): Room {
  const first = findOpenPublicChaosLounge();
  if (!isBannedLocal(first.code, playerId)) return first;
  let next = 1;
  for (;;) {
    const code = `${PublicChaosPrefix}${next}`;
    const room = getRoom(code);
    if (!isBannedLocal(code, playerId)) {
      if (!room) return createRoom("chaos", code, false);
      if (!isFull(room)) return room;
    }
    next += 1;
  }
}

// ---------------------------------------------------------------------------
// Per-room safety meta (host, votes, who flagged whom)
// ---------------------------------------------------------------------------

type RoomMeta = {
  isPrivate: boolean;
  hostId: string | null;
  /** target -> voters */
  votes: Map<string, Set<string>>;
  /** actor -> people they reported or blocked here (unlocks a no-penalty leave) */
  flagged: Map<string, Set<string>>;
};

/** Keyed by the Room object, so a reused 4-digit code never inherits a host. */
const metas = new WeakMap<Room, RoomMeta>();

function metaOf(room: Room): RoomMeta {
  let meta = metas.get(room);
  if (!meta) {
    meta = { isPrivate: false, hostId: null, votes: new Map(), flagged: new Map() };
    metas.set(room, meta);
  }
  return meta;
}

/** Call when a room is made with a code someone will share. The maker is host. */
export function markPrivateRoom(room: Room, hostId: string): void {
  const meta = metaOf(room);
  meta.isPrivate = true;
  meta.hostId = hostId;
}

export function roomHost(room: Room): string | null {
  return metaOf(room).hostId;
}

function flag(room: Room, actor: string, target: string): void {
  const meta = metaOf(room);
  if (!meta.flagged.has(actor)) meta.flagged.set(actor, new Set());
  meta.flagged.get(actor)!.add(target);
}

const ACTIVE = new Set(["countdown", "turnA", "swap", "turnB", "live"]);
const isOneOnOne = (room: Room) => room.mode !== "chaos";

// ---------------------------------------------------------------------------
// Policy (pure)
// ---------------------------------------------------------------------------

/** Votes to remove someone from Chaos: strict majority of the others, min 2. */
export const votesNeeded = votesToRemove;

export type KickDecision =
  | { kind: "kick" }
  | { kind: "vote"; needed: number }
  | { kind: "deny"; message: string };

export function kickRule(input: {
  mode: Mode;
  isPrivate: boolean;
  hostId: string | null;
  actorId: string;
  targetId: string;
  seatedIds: string[];
  liveIds: string[];
}): KickDecision {
  const { mode, isPrivate, hostId, actorId, targetId, seatedIds, liveIds } = input;
  if (actorId === targetId) return { kind: "deny", message: "You can't remove yourself." };
  if (!seatedIds.includes(actorId)) return { kind: "deny", message: "Join the room first." };
  if (!seatedIds.includes(targetId)) return { kind: "deny", message: "They already left." };
  if (isPrivate && hostId === actorId) return { kind: "kick" };
  if (mode === "chaos") {
    const others = liveIds.filter((id) => id !== targetId).length;
    const needed = votesNeeded(others);
    if (needed > others) {
      return { kind: "deny", message: "Not enough people here to vote. Block them instead." };
    }
    return { kind: "vote", needed };
  }
  return {
    kind: "deny",
    message: "You can't remove your opponent in a 1v1. Block or report them, then leave with no rating change.",
  };
}

/** Current tally for one target, counting only voters still live in the room. */
export function tallyFor(room: Room, targetId: string): { count: number; needed: number } {
  const live = livePlayers(room).map((p) => p.id);
  const others = live.filter((id) => id !== targetId);
  const voters = metaOf(room).votes.get(targetId) ?? new Set<string>();
  const count = [...voters].filter((id) => others.includes(id)).length;
  return { count, needed: votesNeeded(others.length) };
}

export function publicSafetyState(room: Room): SafetyState {
  const meta = metaOf(room);
  const seated = new Set(room.players.map((p) => p.id));
  const votes: SafetyState["votes"] = {};
  for (const target of [...meta.votes.keys()]) {
    if (!seated.has(target)) {
      meta.votes.delete(target);
      continue;
    }
    const tally = tallyFor(room, target);
    if (tally.count > 0) votes[target] = tally;
  }
  return { code: room.code, isPrivate: meta.isPrivate, hostId: meta.hostId, votes };
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

const reported = new Set<string>();

/** A string field of a socket payload, else "" (never coerces an object). */
function stringField(payload: unknown, key: string): string {
  const v = payload && typeof payload === "object" ? (payload as Record<string, unknown>)[key] : undefined;
  return typeof v === "string" ? v.slice(0, 128) : "";
}

function cleanNote(raw: unknown): string {
  return cleanText(raw, ReportNoteMax);
}

export async function persistReport(doc: ReportDoc): Promise<"mongo" | "log"> {
  console.warn("[safety] report", JSON.stringify(doc));
  try {
    const db = await safetyDb();
    if (!db) return "log";
    await db.collection<ReportDoc>("reports").insertOne({ ...doc });
    return "mongo";
  } catch (err) {
    console.warn("[safety] report persist failed (logged above)", err);
    return "log";
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export type SafetySession = { playerId: string; displayName: string; roomCode: string | null };

export type SafetyDeps = {
  sessionOf: (socketId: string) => SafetySession | undefined;
  resolveRoom: (code: string) => Promise<Room | undefined>;
  /** Sockets on this isolate seated as `playerId` in room `code`. */
  socketsOf: (playerId: string, code: string) => string[];
  /** Take a socket out of its room. `forfeit: false` skips the rating forfeit. */
  eject: (socketId: string, opts: { forfeit: boolean }) => void;
  broadcast: (room: Room) => void;
  /** Emit to a socket id or a room code. */
  emitTo: (target: string, event: string, payload: unknown) => void;
  /** Drop the LiveKit media connection. Defaults to RoomServiceClient. */
  kickMedia?: (code: string, identity: string) => Promise<unknown>;
};

export function liveKitApiHost(wsUrl: string): string {
  return wsUrl.replace(/^wss:\/\//i, "https://").replace(/^ws:\/\//i, "http://");
}

/** End this identity's LiveKit connection. False when unconfigured or not there. */
export async function removeFromLiveKit(code: string, identity: string): Promise<boolean> {
  const config = readLiveKitConfig();
  if (!config) return false;
  const client = new RoomServiceClient(
    liveKitApiHost(config.wsUrl),
    config.apiKey,
    config.apiSecret,
  );
  try {
    await client.removeParticipant(liveKitRoomName(code), identity);
    return true;
  } catch (err) {
    // Not connected (already gone, or camera never opened) is fine.
    console.warn("[safety] livekit removeParticipant", code, identity, String(err));
    return false;
  }
}

function deny(action: SafetyAck["action"], message: string, targetId?: string): SafetyAck {
  return { action, ok: false, message, targetId };
}

export function createSafety(deps: SafetyDeps) {
  const kickMedia = deps.kickMedia ?? removeFromLiveKit;

  async function context(socketId: string) {
    const session = deps.sessionOf(socketId);
    if (!session?.roomCode) return null;
    const room = await deps.resolveRoom(session.roomCode);
    if (!room) return null;
    const me = room.players.find((p) => p.id === session.playerId);
    return { session, room, me };
  }

  function sendState(room: Room): void {
    deps.emitTo(room.code, ServerEvents.safetyState, publicSafetyState(room));
  }

  function personalState(room: Room, playerId: string): SafetyState {
    const meta = metaOf(room);
    const myVotes = [...meta.votes.entries()]
      .filter(([, voters]) => voters.has(playerId))
      .map(([target]) => target);
    return { ...publicSafetyState(room), blocked: blockListOf(playerId), myVotes };
  }

  /** Remove `targetId` for good: ban, eject, drop LiveKit, end a 1v1 match. */
  async function removeFromRoom(
    room: Room,
    targetId: string,
    byId: string,
    reason: "host" | "vote",
  ): Promise<void> {
    const target = room.players.find((p) => p.id === targetId);
    const name = target?.displayName ?? "Someone";
    await banFromRoom(room.code, targetId, byId, reason);

    const removed: SafetyRemoved = {
      code: room.code,
      reason,
      message:
        reason === "host"
          ? "The host removed you from this room."
          : "The room voted to remove you.",
    };
    for (const socketId of deps.socketsOf(targetId, room.code)) {
      deps.emitTo(socketId, ServerEvents.safetyRemoved, removed);
      deps.eject(socketId, { forfeit: false });
    }
    // Their socket may live on another isolate: drop the seat regardless.
    if (room.players.some((p) => p.id === targetId)) removePlayer(room, targetId);

    const meta = metaOf(room);
    meta.votes.delete(targetId);
    for (const voters of meta.votes.values()) voters.delete(targetId);

    if (isOneOnOne(room) && ACTIVE.has(room.status)) resetToLobby(room);

    await kickMedia(room.code, targetId);

    const notice: SafetyNotice = {
      code: room.code,
      kind: "removed-someone",
      message: `${name} was removed from the room.`,
    };
    deps.emitTo(room.code, ServerEvents.safetyNotice, notice);
    deps.broadcast(room);
    sendState(room);
  }

  async function report(socketId: string, payload: unknown): Promise<SafetyAck> {
    const ctx = await context(socketId);
    if (!ctx?.me) return deny("report", "Join the room first.");
    const body = (payload ?? {}) as Record<string, unknown>;
    const targetId = typeof body.targetId === "string" ? body.targetId : "";
    const target = ctx.room.players.find((p) => p.id === targetId);
    if (!target || target.id === ctx.me.id) return deny("report", "Pick someone in this room.", targetId);
    const reason = (ReportReasons as readonly string[]).includes(typeof body.reason === "string" ? body.reason : "")
      ? (body.reason as ReportReason)
      : null;
    if (!reason) return deny("report", "Pick a reason.", targetId);

    const once = `${ctx.me.id}|${target.id}|${ctx.room.code}`;
    const canLeave = isOneOnOne(ctx.room);
    if (body.block === true) await addBlock(ctx.me.id, target.id);
    flag(ctx.room, ctx.me.id, target.id);

    if (reported.has(once)) {
      return { action: "report", ok: true, message: "Already reported. Thanks.", targetId, canLeave };
    }
    if (!reportLimiter.take(ctx.me.id)) {
      return deny("report", "You've sent a lot of reports. Try again in a few minutes.", targetId);
    }
    reported.add(once);
    await persistReport({
      reporterId: ctx.me.id,
      reportedId: target.id,
      reporterName: ctx.me.displayName,
      reportedName: target.displayName,
      roomCode: ctx.room.code,
      mode: ctx.room.mode,
      reason,
      note: cleanNote(body.note),
      createdAt: new Date(),
    });
    return {
      action: "report",
      ok: true,
      message: "Report sent. Thanks for keeping the room safe.",
      targetId,
      canLeave,
    };
  }

  async function block(socketId: string, payload: unknown): Promise<SafetyAck> {
    const ctx = await context(socketId);
    if (!ctx?.me) return deny("block", "Join the room first.");
    const targetId = stringField(payload, "targetId");
    const target = ctx.room.players.find((p) => p.id === targetId);
    if (!target || target.id === ctx.me.id) return deny("block", "Pick someone in this room.", targetId);
    await hydrateBlocks(ctx.me.id);
    if (!hasBlocked(ctx.me.id, target.id) && blockListOf(ctx.me.id).length >= MaxBlockedPlayers) {
      return deny("block", `You can block up to ${MaxBlockedPlayers} players.`, targetId);
    }
    if (!hasBlocked(ctx.me.id, target.id) && !blockLimiter.take(ctx.me.id)) {
      return deny("block", "Too many blocks at once. Try again in a few minutes.", targetId);
    }
    await addBlock(ctx.me.id, target.id);
    flag(ctx.room, ctx.me.id, target.id);
    return {
      action: "block",
      ok: true,
      message: `Blocked ${target.displayName}. You won't see or hear them, or be matched with them again.`,
      targetId,
      canLeave: isOneOnOne(ctx.room),
    };
  }

  async function kick(socketId: string, payload: unknown): Promise<SafetyAck> {
    const ctx = await context(socketId);
    if (!ctx?.me) return deny("kick", "Join the room first.");
    const { room, me } = ctx;
    const targetId = stringField(payload, "targetId");
    const meta = metaOf(room);
    const decision = kickRule({
      mode: room.mode,
      isPrivate: meta.isPrivate,
      hostId: meta.hostId,
      actorId: me.id,
      targetId,
      seatedIds: room.players.map((p) => p.id),
      liveIds: livePlayers(room).map((p) => p.id),
    });
    if (decision.kind === "deny") return deny("kick", decision.message, targetId);
    const name = room.players.find((p) => p.id === targetId)?.displayName ?? "them";

    if (decision.kind === "kick") {
      await removeFromRoom(room, targetId, me.id, "host");
      return { action: "kick", ok: true, removed: true, message: `Removed ${name}.`, targetId };
    }

    const already = meta.votes.get(targetId)?.has(me.id) ?? false;
    if (!already && !voteLimiter.take(me.id)) {
      return deny("kick", "Slow down. Try again in a minute.", targetId);
    }
    if (!meta.votes.has(targetId)) meta.votes.set(targetId, new Set());
    meta.votes.get(targetId)!.add(me.id);
    const votes = tallyFor(room, targetId);
    if (votes.count >= votes.needed) {
      await removeFromRoom(room, targetId, me.id, "vote");
      return { action: "kick", ok: true, removed: true, votes, message: `The room removed ${name}.`, targetId };
    }
    sendState(room);
    return {
      action: "kick",
      ok: true,
      removed: false,
      votes,
      message: `Vote counted: ${votes.count} of ${votes.needed} needed to remove ${name}.`,
      targetId,
    };
  }

  /** Ranked/Duet: walk away from someone you blocked or reported. No rating change. */
  async function leave(socketId: string): Promise<SafetyAck> {
    const ctx = await context(socketId);
    if (!ctx?.me) return deny("leave", "You're not in a match.");
    const { room, me } = ctx;
    if (!isOneOnOne(room)) return deny("leave", "Chaos has no rating. Just leave.");
    const opponents = room.players.filter((p) => p.id !== me.id);
    const flagged = metaOf(room).flagged.get(me.id) ?? new Set<string>();
    const earned = opponents.some((p) => flagged.has(p.id) || hasBlocked(me.id, p.id));
    if (!earned) return deny("leave", "Block or report your opponent first.");

    const wasActive = ACTIVE.has(room.status);
    deps.eject(socketId, { forfeit: false });
    if (wasActive) resetToLobby(room);
    if (room.players.length > 0) {
      const notice: SafetyNotice = {
        code: room.code,
        kind: "opponent-left",
        message: "Your opponent left the match. No rating change.",
      };
      deps.emitTo(room.code, ServerEvents.safetyNotice, notice);
      deps.broadcast(room);
    }
    return { action: "leave", ok: true, message: "You left. No rating change." };
  }

  async function sync(socketId: string): Promise<SafetyState | null> {
    const ctx = await context(socketId);
    if (!ctx) return null;
    await hydrateBlocks(ctx.session.playerId);
    return personalState(ctx.room, ctx.session.playerId);
  }

  return { report, block, kick, leave, sync, removeFromRoom };
}

export type SafetyService = ReturnType<typeof createSafety>;

/** Wire the safety socket events. Every event takes an optional ack callback. */
export function registerSafety(
  io: Server,
  deps: Omit<SafetyDeps, "emitTo">,
): SafetyService {
  const service = createSafety({
    ...deps,
    emitTo: (target, event, payload) => io.to(target).emit(event, payload),
  });

  const handlers: Array<[string, (socket: Socket, payload: unknown) => Promise<unknown>]> = [
    [ClientEvents.safetySync, (s) => service.sync(s.id)],
    [ClientEvents.safetyReport, (s, p) => service.report(s.id, p)],
    [ClientEvents.safetyBlock, (s, p) => service.block(s.id, p)],
    [ClientEvents.safetyKick, (s, p) => service.kick(s.id, p)],
    [ClientEvents.safetyLeave, (s) => service.leave(s.id)],
  ];

  io.on("connection", (socket) => {
    for (const [event, handle] of handlers) {
      socket.on(event, async (payload: unknown, ack?: unknown) => {
        const reply = typeof payload === "function" ? payload : ack;
        try {
          const result = await handle(socket, typeof payload === "function" ? undefined : payload);
          if (typeof reply === "function") reply(result);
        } catch (err) {
          console.warn("[safety]", event, err);
          if (typeof reply === "function") {
            reply({ action: "sync", ok: false, message: "Something went wrong. Try again." });
          }
        }
      });
    }
  });

  return service;
}

/** Test-only: forget all in-memory safety state. */
export function resetSafetyForTests(): void {
  blocksBy.clear();
  blockedBy.clear();
  hydratedAt.clear();
  bans.clear();
  reported.clear();
  reportLimiter.reset();
  blockLimiter.reset();
  voteLimiter.reset();
}
