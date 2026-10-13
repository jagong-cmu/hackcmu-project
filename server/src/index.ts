/**
 * LANE A — HTTP + Socket.IO entry point.
 *
 * Owns: connection lifecycle, room routing, LiveKit token minting, static
 * hosting of the built client, and mounting the score route.
 * Never touches Gemini or Mongo — that is Lane B (TECHNICAL_PRD §4).
 */
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import dotenv from "dotenv";
import cors from "cors";
import express from "express";
import { Server } from "socket.io";

import {
  ClientEvents,
  DemoRoomCode,
  isPublicChaosCode,
  RemovedFromRoomCode,
  ServerEvents,
  StartingElo,
  type Mode,
} from "@karaoke/shared";

import {
  addPlayer,
  allRooms,
  disposeIfEmpty,
  dropDeadPlayers,
  ensurePermanentRooms,
  createRoom,
  draftRoom,
  getRoom,
  registerRoom,
  isFull,
  livePlayers,
  removePlayer,
  resetToLobby,
  toPublic,
  touchPlayer,
  type Room,
} from "./rooms.ts";
import {
  broadcastState,
  catchUpClock,
  ensureChaosPlaying,
  forfeitFor,
  settleIfScoresIn,
  handleRematchCancel,
  handleRematchRequest,
  maybeArmMatch,
  rematchSeatLeft,
  advanceDue,
  publicClock,
  revealedScores,
  emitScoreReady,
  recordScore,
  startChaos,
  stopChaos,
} from "./clock.ts";
import { dequeue, enqueue, isQueueMode, park, queueLength, type Waiting } from "./matchmaking.ts";
import {
  createSharedRoom,
  ensureRoom,
  findOpenPair,
  forgetWaiter,
  reserveExactCode,
  seatPairOnThisIsolate,
  sharedPairOrWait,
  watchReservation,
} from "./liveState.ts";
import { liveKitRoomName, mintToken, readLiveKitConfig } from "./livekit.ts";
import { decideLiveKitAccess } from "./livekitAccess.ts";
import { publicPlayerId } from "./publicId.ts";
import { getDb, upsertPlayer } from "./db.ts";
import { registerLaneBRoutes } from "./judge.ts";
import { registerScoreRoute } from "./scoreRoute.ts";
import {
  asyncRoute,
  createRateGate,
  installProcessGuards,
  jsonErrors,
  logOnce,
  roomCodeOf,
  safeHandler,
  sanitizeDisplayName,
  sanitizePitchSample,
} from "./hardening.ts";
import {
  attachSocketAuth,
  authMode,
  helloAuth,
  httpAccount,
  httpIdentity,
  socketAuthExpired,
  socketIdentity,
} from "./auth.ts";
import {
  canReadRoom,
  CreateRateLimitedCode,
  createRateLimitedMessage,
  createWindowGate,
  RoomCreateLimit,
  RoomCreateWindowMs,
  WindowLimiter,
  HelloVerifyLimit,
  HelloVerifyWindowMs,
  isGuardedRoomCode,
  JoinAttemptLimiter,
  joinLimitKey,
  JoinRateLimitedCode,
  joinRateLimitedMessage,
  RoomSnapshotNotFound,
  RoomUnavailableCode,
  roomUnavailableMessage,
} from "./abuseLimits.ts";
import {
  posthogConfigured,
  trackChaosJoined,
  trackQueueJoined,
  trackRoomCreated,
} from "./analytics.ts";
import {
  isBannedFromRoom,
  isBannedLocal,
  markPrivateRoom,
  openLoungeFor,
  registerSafety,
  removeFromLiveKit,
} from "./moderation.ts";

// Last resort: a stray rejection or throw is logged, never fatal to the instance.
installProcessGuards();

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, "../.env") });
const PORT = Number(process.env.PORT ?? 8080);
const ON_VERCEL = Boolean(process.env.VERCEL);
const WEB_DIST = [
  path.resolve(process.cwd(), "apps/web/dist"),
  path.resolve(here, "../../apps/web/dist"),
].find((dir) => existsSync(dir)) ?? path.resolve(here, "../../apps/web/dist");

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: true },
  transports: ["websocket", "polling"],
});

app.use(cors());
app.use(express.json({ limit: "256kb" }));
registerLaneBRoutes(app);
attachSocketAuth(io);

/** Per-socket identity. Rooms hold the authoritative player record. */
type Session = {
  playerId: string;
  clientId: string;
  displayName: string;
  elo: number;
  roomCode: string | null;
};
const sessions = new Map<string, Session>();

/** Failed private-code joins, per verified account (abuseLimits.ts). Per instance. */
const sharedJoinLimiter = new JoinAttemptLimiter();
/** room:create calls, per verified account (abuseLimits.ts). Per instance. */
const roomCreateLimiter = new WindowLimiter(RoomCreateLimit, RoomCreateWindowMs);

function sessionOf(socketId: string): Session | undefined {
  return sessions.get(socketId);
}

function roomOfSession(session: Session | undefined): Room | undefined {
  if (!session?.roomCode) return undefined;
  return getRoom(session.roomCode);
}

// ---------------------------------------------------------------------------
// REST
// ---------------------------------------------------------------------------

/**
 * Ping this ~2 minutes before a demo to wake a sleeping Render Free dyno.
 * Public, so it says only what the client reads: the clock (timeSync.ts) and
 * whether scores persist (Settings.tsx). Which keys are configured stays private.
 */
app.get("/api/health", asyncRoute(async (_req, res) => {
  const db = await getDb().catch(() => null);
  res.json({
    ok: true,
    serverTimeMs: Date.now(),
    mongo: Boolean(db),
  });
}));

/**
 * LiveKit join token. The API secret stays server-side; the client only ever
 * sees a scoped, expiring JWT plus the public ws URL.
 *
 * Room codes are guessable, so a token is only minted for a player already
 * seated in that room, as their public player id (see livekitAccess.ts).
 */
app.post("/api/livekit/token", asyncRoute(async (req, res) => {
  const config = readLiveKitConfig();
  if (!config) {
    res.status(503).json({
      code: "LIVEKIT_UNCONFIGURED",
      message: "Set LIVEKIT_API_KEY / LIVEKIT_API_SECRET / LIVEKIT_WS_URL in .env",
    });
    return;
  }

  const who = await httpIdentity(req, req.body?.clientId);
  if (!who.ok) {
    res.status(who.status).json({ code: who.code, message: who.message });
    return;
  }
  const rawCode: unknown = req.body?.code;
  const code = typeof rawCode === "string" ? rawCode.trim() : rawCode;
  const room =
    typeof code === "string" && code ? ((await ensureRoom(code)) ?? getRoom(code)) : undefined;
  const access = decideLiveKitAccess({
    code,
    room,
    clientId: who.clientId,
    requested: req.body?.identity,
  });
  if (!access.ok) {
    res.status(access.status).json({ code: access.code, message: access.message });
    return;
  }
  // Removal ejects the seat too; this also covers a stale snapshot that still seats them.
  if (await isBannedFromRoom(access.roomCode, access.identity)) {
    res.status(403).json({ code: RemovedFromRoomCode, message: "removed from this room" });
    return;
  }

  const token = await mintToken(config, access.roomCode, access.identity, access.displayName);
  res.json({
    token,
    wsUrl: config.wsUrl,
    room: liveKitRoomName(access.roomCode),
    identity: access.identity,
  });
}));

app.get("/api/rooms/:code", asyncRoute(async (req, res) => {
  // Seated players only. Everyone else, signed in or not seated yet, gets the
  // same 404 as "no such room", so this cannot be used to find live private
  // codes or read other rooms' names and scores. The poll (RoomProvider)
  // ignores a 404 until room:join has seated it. Polling also advances the
  // room clock and prunes dead seats; only seated callers trigger that.
  const who = await httpAccount(req);
  if (!who.ok) {
    res.status(who.status).json({ code: who.code, message: who.message });
    return;
  }
  const code = roomCodeOf(req.params.code);
  const room = code ? await ensureRoom(code) : undefined;
  if (!room || !canReadRoom(room, who.clientId)) {
    res.status(404).json(RoomSnapshotNotFound);
    return;
  }
  pruneRoom(room);
  advanceDue(io, room);
  const scores = revealedScores(room);
  const [a, b] = room.players;
  let winnerId: string | null = room.lastWinnerId;
  if (winnerId == null && a && b && room.settled) {
    const sa = scores[a.id]?.overall ?? 0;
    const sb = scores[b.id]?.overall ?? 0;
    if (sa > sb) winnerId = a.id;
    else if (sb > sa) winnerId = b.id;
  }
  res.json({
    room: toPublic(room),
    clock: publicClock(room),
    scores,
    settled: room.settled,
    matchOver:
      room.status === "results" && room.settled
        ? {
            scores,
            winnerId,
            eloDelta: room.lastEloDelta ?? 0,
            ...(room.mode === "ranked" && !room.rated ? { rated: false } : {}),
          }
        : null,
  });
}));

// Score upload (scoreRoute.ts): DSP numbers only; the verdict is the server's.
registerScoreRoute(app, io);

// Serve the built client from the same origin in production so there is one
// HTTPS URL for getUserMedia. In dev, Vite proxies to us instead.
if (existsSync(WEB_DIST)) {
  app.use(express.static(WEB_DIST));
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(WEB_DIST, "index.html"));
  });
}
// Bad JSON / oversize bodies keep their 4xx; anything else is a bare 500. Always JSON.
app.use(jsonErrors);

// ---------------------------------------------------------------------------
// Socket.IO
// ---------------------------------------------------------------------------

/** One field of a socket payload, without trusting its shape. */
function fieldOf(payload: unknown, key: string): unknown {
  return payload && typeof payload === "object" ? (payload as Record<string, unknown>)[key] : undefined;
}

/** A requested mode: one of the known strings, defaulting to ranked when absent. */
function modeOf(payload: unknown): Mode | null {
  const raw = fieldOf(payload, "mode");
  if (raw === undefined || raw === null) return "ranked";
  return raw === "ranked" || raw === "duet" || raw === "chaos" ? raw : null;
}

function fail(socket: { emit: (e: string, p: unknown) => void }, code: string, message: string) {
  socket.emit(ServerEvents.error, { code, message });
}

/** Seat a socket in a room and sync everyone. Returns false if it could not. */
function seat(socketId: string, room: Room): boolean {
  const session = sessionOf(socketId);
  if (!session) {
    // Opponent lives on another Vercel isolate. Keep the Mongo-hydrated seat.
    return room.players.some((p) => p.socketId === socketId);
  }

  pruneRoom(room);

  if (isBannedLocal(room.code, session.playerId)) return false;
  const alreadyHere = room.players.some((p) => p.clientId === session.clientId);
  if (!alreadyHere && isFull(room)) return false;

  const wasEmpty = livePlayers(room).length === 0;
  const player = addPlayer(room, {
    id: session.playerId,
    clientId: session.clientId,
    displayName: session.displayName,
    elo: session.elo,
    socketId,
  });
  // addPlayer may reuse an existing seat; keep the session pointing at it.
  session.playerId = player.id;
  session.roomCode = room.code;
  touchPlayer(player);

  io.sockets.sockets.get(socketId)?.join(room.code);

  if (room.mode === "chaos") {
    if (wasEmpty) startChaos(io, room, 3000);
    else ensureChaosPlaying(io, room);
    catchUpClock(io, room, socketId);
  } else {
    maybeArmMatch(io, room);
  }
  broadcastState(io, room);
  return true;
}

/** How long a dropped socket has to come back before its LiveKit connection is ended. */
const MEDIA_DROP_GRACE_MS = 20_000;

/**
 * End a departed player's LiveKit connection (best effort): LiveKit tokens
 * cannot be revoked, so leaving the room has to drop the media session too.
 * "now" for deliberate exits; "later" for a dropped socket, which usually
 * reconnects and re-seats within seconds, so only drop it if it has not.
 */
function dropMedia(code: string, playerId: string, when: "now" | "later"): void {
  if (!readLiveKitConfig()) return;
  if (when === "now") {
    void removeFromLiveKit(code, playerId, { quiet: true }).catch(logOnce("livekit drop on leave"));
    return;
  }
  const timer = setTimeout(() => {
    void (async () => {
      for (const s of sessions.values()) {
        if (s.playerId === playerId && s.roomCode === code) return;
      }
      const room = (await ensureRoom(code)) ?? getRoom(code);
      if (room?.players.some((p) => p.id === playerId)) return;
      await removeFromLiveKit(code, playerId, { quiet: true });
    })().catch(logOnce("livekit drop after disconnect"));
  }, MEDIA_DROP_GRACE_MS);
  timer.unref?.();
}

function leaveCurrentRoom(
  socketId: string,
  opts: { forfeit: boolean; media?: "now" | "later" } = { forfeit: true },
): void {
  const session = sessionOf(socketId);
  const room = roomOfSession(session);
  if (!session || !room) return;

  const player = room.players.find((p) => p.id === session.playerId);
  if (player) {
    player.connected = false;
    // Kicks carry no forfeit. A safety:leave forfeits only mid-match in a rated
    // Ranked room (moderation.ts leave), through this same path.
    if (opts.forfeit) forfeitFor(io, room, player);
    removePlayer(room, player.id);
    // Left during the score wait: the seat still counts; settle if the rest is in.
    settleIfScoresIn(io, room);
    // Leaving (Home, tab close, disconnect) mid-offer cancels it for the other seat.
    rematchSeatLeft(room, player.id);
    dropMedia(room.code, player.id, opts.media ?? "now");
  }

  io.sockets.sockets.get(socketId)?.leave(room.code);
  session.roomCode = null;

  if (room.mode === "chaos") {
    if (livePlayers(room).length === 0) stopChaos(io, room);
    else ensureChaosPlaying(io, room);
  } else if (room.status === "countdown" && livePlayers(room).length < 2) {
    resetToLobby(room);
  }
  if (room.players.length === 0 && room.persistent) resetToLobby(room);

  broadcastState(io, room);
  disposeIfEmpty(room);
}

function pruneRoom(room: Room): void {
  // Seat order before the drop, so a forfeit or settlement still counts both seats.
  const roster = room.players.slice();
  const removed = dropDeadPlayers(room, (socketId) => socketIsLive(socketId));
  for (const player of removed) {
    const session = sessions.get(player.socketId);
    if (session?.roomCode === room.code) session.roomCode = null;
    io.sockets.sockets.get(player.socketId)?.leave(room.code);
    if (room.mode !== "chaos") {
      forfeitFor(io, room, player, roster);
      settleIfScoresIn(io, room);
      rematchSeatLeft(room, player.id);
    }
  }
  if (removed.length === 0) return;
  if (room.mode === "chaos") {
    if (livePlayers(room).length === 0) stopChaos(io, room);
    else ensureChaosPlaying(io, room);
  } else if (room.status === "countdown" && livePlayers(room).length < 2) {
    resetToLobby(room);
  }
}

function socketIsLive(socketId: string): boolean {
  return Boolean(io.sockets.sockets.get(socketId)?.connected && sessionOf(socketId));
}

async function deliverMatch(
  mode: Extract<Mode, "ranked" | "duet">,
  code: string,
  pair: [Waiting, Waiting],
  socket: { id: string; emit: (e: string, p: unknown) => void },
): Promise<void> {
  const room = (await ensureRoom(code)) ?? getRoom(code) ?? createRoom(mode, code);
  await seatPairOnThisIsolate(room, pair, seat);
  seat(socket.id, room);
  socket.emit(ServerEvents.matchFound, { code: room.code, mode });
  for (const person of pair) {
    if (person.socketId === socket.id || !socketIsLive(person.socketId)) continue;
    io.to(person.socketId).emit(ServerEvents.matchFound, {
      code: room.code,
      mode,
    });
    catchUpClock(io, room, person.socketId);
  }
  catchUpClock(io, room, socket.id);
  broadcastState(io, room);
}

/** Seat both players and tell them. Returns false if either seat failed. */
function announceQueueMatch(
  mode: Extract<Mode, "ranked" | "duet">,
  room: Room,
  pair: [Waiting, Waiting],
): boolean {
  const seated: Waiting[] = [];
  for (const person of pair) {
    if (seat(person.socketId, room)) seated.push(person);
  }
  if (seated.length < 2) {
    for (const person of seated) leaveCurrentRoom(person.socketId);
    disposeIfEmpty(room);
    return false;
  }
  for (const person of pair) {
    io.to(person.socketId).emit(ServerEvents.matchFound, {
      code: room.code,
      mode,
    });
  }
  broadcastState(io, room);
  return true;
}

// Report / block / remove (moderation.ts). Its own socket handlers; these are the hooks it needs.
registerSafety(io, {
  sessionOf,
  resolveRoom: async (code) => (await ensureRoom(code)) ?? getRoom(code),
  socketsOf: (playerId, code) =>
    [...sessions].filter(([, s]) => s.playerId === playerId && s.roomCode === code).map(([id]) => id),
  eject: (socketId, opts) => leaveCurrentRoom(socketId, opts),
  broadcast: (room) => broadcastState(io, room),
});

io.on("connection", (socket) => {
  // Token checks cost a Supabase round trip, so a socket gets a few per window.
  const helloVerifyGate = createWindowGate(HelloVerifyLimit, HelloVerifyWindowMs);

  /**
   * Accounts on, and this socket's verified token has expired (or was
   * dropped as expired): refuse play events until a hello re-verifies it.
   * AUTH_REQUIRED makes the client refresh its session and say hello again
   * (RoomProvider onError). The seat is kept, so nobody forfeits over this.
   */
  const authLapsed = (): boolean => {
    if (authMode() !== "verify") return false;
    if (socket.data.authUserId && !socketAuthExpired(socket)) return false;
    fail(socket, "AUTH_REQUIRED", "Your sign-in expired. Sign in again to play.");
    return true;
  };

  /** Refresh this socket's existing seat (lastSeenMs) without touching its identity. */
  const keepSeatAlive = (): void => {
    const session = sessionOf(socket.id);
    const room = roomOfSession(session);
    const seated = room?.players.find((p) => p.id === session?.playerId && p.socketId === socket.id);
    if (!room || !seated) return;
    touchPlayer(seated);
    broadcastState(io, room);
  };

  socket.on(ClientEvents.playerHello, safeHandler(socket, ClientEvents.playerHello, async (payload: unknown) => {
    const { clientId: claimedId, displayName, accessToken } = (payload ?? {}) as Record<string, unknown>;
    // Not verified at handshake (session restored late), the verified token
    // has since expired, or it is about to and this hello carries its
    // successor: check the token sent with this hello (auth.ts helloAuth).
    // Only then do we await (helloAuth answers synchronously otherwise), so
    // an already-verified hello still seats the session synchronously before
    // a following room:create / room:ready. Checks are rate limited per
    // socket. Supabase being down or rate limiting us keeps the previous
    // sign-in for a bounded grace; only a definitively bad token signs the
    // socket out.
    const pending = helloAuth(socket, accessToken, helloVerifyGate);
    const auth = typeof pending === "string" ? pending : await pending;
    // The verified Supabase user id, never whatever was sent. Every other
    // play event needs the session this creates, so this is the socket gate.
    const who = socketIdentity(socket, claimedId);
    if (!who.ok) {
      // Presence is not authorisation: a seated socket whose sign-in lapsed
      // (or could not be re-checked) still heartbeats, so the opponent's
      // instance does not prune the seat and forfeit it. Play events keep
      // answering AUTH_REQUIRED until a token verifies. A definitively bad
      // token gets no such pass.
      if (auth !== "rejected") keepSeatAlive();
      return fail(socket, who.code, who.message);
    }
    const clientId = who.clientId;
    const name = sanitizeDisplayName(displayName);

    // Seat the session synchronously. Awaiting Atlas first let a following
    // room:create / room:ready run against a wiped session (NOT_IN_ROOM).
    const existing = sessions.get(socket.id);
    const session: Session =
      existing && existing.clientId === clientId
        ? { ...existing, displayName: name }
        : {
            // Never the clientId: that is the credential, and this id is
            // broadcast to everyone in the room.
            playerId: publicPlayerId(clientId),
            clientId,
            displayName: name,
            elo: existing?.elo ?? StartingElo,
            roomCode: null,
          };
    sessions.set(socket.id, session);

    const emitOk = () =>
      socket.emit(ServerEvents.playerOk, {
        player: {
          // The client learns its own public id here and matches "me" by it.
          id: session.playerId,
          displayName: session.displayName,
          elo: session.elo,
        },
      });

    // Ack identity before Atlas so queue:join is never blocked on Mongo.
    emitOk();

    try {
      const db = await getDb();
      if (db) {
        const player = await upsertPlayer(db, clientId, name);
        if (session.elo !== player.elo) {
          session.elo = player.elo;
          emitOk();
        }
      }
    } catch {
      /* Atlas down: keep current elo */
    }

    if (session.roomCode) {
      const room = getRoom(session.roomCode);
      const seated = room?.players.find((p) => p.id === session.playerId);
      if (room && seated) {
        seated.displayName = session.displayName;
        seated.elo = session.elo;
        touchPlayer(seated);
        broadcastState(io, room);
      }
    }
  }));

  socket.on(ClientEvents.queueJoin, safeHandler(socket, ClientEvents.queueJoin, async (payload: unknown) => {
    const session = sessionOf(socket.id);
    if (!session) return fail(socket, "NO_SESSION", "send player:hello first");
    if (authLapsed()) return;

    const mode = modeOf(payload);
    if (!mode || !isQueueMode(mode)) return fail(socket, "BAD_MODE", "ranked or duet only");

    void trackQueueJoined({ mode, distinctId: session.clientId }).catch(logOnce("trackQueueJoined"));

    const waiting: Waiting = {
      socketId: socket.id,
      clientId: session.clientId,
      displayName: session.displayName,
      elo: session.elo,
    };

    const ticket = await findOpenPair(session.clientId, mode);
    if (ticket) {
      await deliverMatch(mode, ticket.code, [ticket.a, ticket.b], socket);
      return;
    }

    if (session.roomCode) {
      const current = (await ensureRoom(session.roomCode)) ?? getRoom(session.roomCode);
      if (
        current &&
        current.mode === mode &&
        current.players.some((p) => p.clientId === session.clientId) &&
        current.players.length === 2
      ) {
        socket.emit(ServerEvents.matchFound, { code: current.code, mode });
        catchUpClock(io, current, socket.id);
        broadcastState(io, current);
        return;
      }
      leaveCurrentRoom(socket.id);
    }

    const shared = await sharedPairOrWait(mode, waiting);
    if (shared && shared !== "waiting") {
      dequeue(socket.id);
      await deliverMatch(mode, shared.code, shared.pair, socket);
      return;
    }
    if (shared === "waiting") {
      socket.emit(ServerEvents.queueWaiting, { mode, waiting: Math.max(1, queueLength(mode)) });
      return;
    }

    const match = enqueue(mode, waiting, socketIsLive);
    if (!match) {
      socket.emit(ServerEvents.queueWaiting, { mode, waiting: queueLength(mode) });
      return;
    }
    if (announceQueueMatch(mode, match.room, match.pair)) return;

    for (const person of match.pair) {
      if (!socketIsLive(person.socketId)) continue;
      const retry = enqueue(mode, person, socketIsLive);
      if (!retry) {
        io.to(person.socketId).emit(ServerEvents.queueWaiting, {
          mode,
          waiting: queueLength(mode),
        });
        continue;
      }
      if (!announceQueueMatch(mode, retry.room, retry.pair)) {
        park(mode, person);
        io.to(person.socketId).emit(ServerEvents.queueWaiting, {
          mode,
          waiting: queueLength(mode),
        });
      }
    }
  }));

  socket.on(ClientEvents.roomCreate, safeHandler(socket, ClientEvents.roomCreate, async (payload: unknown) => {
    const session = sessionOf(socket.id);
    if (!session) return fail(socket, "NO_SESSION", "send player:hello first");
    if (authLapsed()) return;

    const mode = modeOf(payload);
    if (mode !== "ranked" && mode !== "duet" && mode !== "chaos") {
      leaveCurrentRoom(socket.id);
      dequeue(socket.id);
      return fail(socket, "BAD_MODE", "ranked, duet, or chaos");
    }
    // Every create reserves a code for up to 2h, so creates are limited per
    // account. Refused before leaving, so the caller keeps their current room.
    const wait = roomCreateLimiter.take(joinLimitKey(socket.data.authUserId, socket.id));
    if (wait > 0) return fail(socket, CreateRateLimitedCode, createRateLimitedMessage(wait));
    leaveCurrentRoom(socket.id);
    dequeue(socket.id);

    // The code is reserved in liveRooms first (with Mongo), so no other
    // instance can hold it. Host + private + unrated (friendly) are set on
    // the draft, so they are in the very first snapshot. Once the room is
    // abandoned (empty lobby, gone from here), its reservation is released.
    const room = await createSharedRoom(mode, (draft) => markPrivateRoom(draft, session.playerId));
    watchReservation(room);
    if (!sessionOf(socket.id)) {
      disposeIfEmpty(room);
      return;
    }
    // Another event may have seated or queued this socket during the reservation.
    leaveCurrentRoom(socket.id);
    dequeue(socket.id);
    if (!seat(socket.id, room)) return fail(socket, "ROOM_FULL", "room is full");
    void trackRoomCreated({ mode: room.mode, roomCode: room.code, distinctId: session.clientId }).catch(
      logOnce("trackRoomCreated"),
    );
    socket.emit(ServerEvents.matchFound, { code: room.code, mode });
  }));

  const joinKey = () => joinLimitKey(socket.data.authUserId, socket.id);

  /**
   * A private code this socket is not already in: limited, and every miss
   * (no such room, full, wrong mode) is the same ROOM_UNAVAILABLE answer.
   * Returns false (after telling the client) while the caller is cooling down.
   */
  const mayTryCode = (code: string, session: Session): boolean => {
    if (!isGuardedRoomCode(code) || session.roomCode === code) return true;
    const wait = sharedJoinLimiter.waitMs(joinKey());
    if (wait <= 0) return true;
    fail(socket, JoinRateLimitedCode, joinRateLimitedMessage(wait));
    return false;
  };
  const missedCode = (code: string): void => {
    if (isGuardedRoomCode(code)) sharedJoinLimiter.fail(joinKey(), code);
    fail(socket, RoomUnavailableCode, roomUnavailableMessage(code));
  };

  socket.on(ClientEvents.roomJoin, safeHandler(socket, ClientEvents.roomJoin, async (payload: unknown) => {
    const session = sessionOf(socket.id);
    if (!session) return fail(socket, "NO_SESSION", "send player:hello first");
    if (authLapsed()) return;

    const code = roomCodeOf(fieldOf(payload, "code"));
    if (!code) return fail(socket, "BAD_CODE", "enter a 4-digit code");
    if (!mayTryCode(code, session)) return;
    const room = (await ensureRoom(code)) ?? getRoom(code);
    // Public codes keep their specific errors; private ones never say why.
    if (!room) {
      return isGuardedRoomCode(code) ? missedCode(code) : fail(socket, "ROOM_NOT_FOUND", `no room ${code}`);
    }
    if (await isBannedFromRoom(room.code, session.playerId)) {
      return fail(socket, RemovedFromRoomCode, "You were removed from this room.");
    }

    if (session.roomCode === room.code) {
      broadcastState(io, room);
      return;
    }

    leaveCurrentRoom(socket.id);
    dequeue(socket.id);

    if (!seat(socket.id, room)) {
      return isGuardedRoomCode(room.code) ? missedCode(room.code) : fail(socket, "ROOM_FULL", "room is full");
    }
    socket.emit(ServerEvents.matchFound, { code: room.code, mode: room.mode });
  }));

  socket.on(ClientEvents.chaosJoin, safeHandler(socket, ClientEvents.chaosJoin, async (payload: unknown) => {
    const session = sessionOf(socket.id);
    if (!session) return fail(socket, "NO_SESSION", "send player:hello first");
    if (authLapsed()) return;

    const raw = roomCodeOf(fieldOf(payload, "code"));
    if (raw && !isPublicChaosCode(raw) && !/^\d{4}$/.test(raw)) {
      return fail(socket, "BAD_CODE", "enter a 4-digit code");
    }
    if (raw && !mayTryCode(raw, session)) return;

    if (raw && (await isBannedFromRoom(raw, session.playerId))) {
      return fail(socket, RemovedFromRoomCode, "You were removed from this room.");
    }
    let room = raw ? ((await ensureRoom(raw)) ?? getRoom(raw)) : openLoungeFor(session.playerId);
    if (raw) {
      if (room && room.mode !== "chaos") {
        return isGuardedRoomCode(raw) ? missedCode(raw) : fail(socket, "NOT_CHAOS", `${raw} is not a lounge`);
      }
      if (!room) {
        // Opening a fresh private lounge by typing a code also tells the caller
        // that code was free, so it counts against the join limit (the web
        // client makes private lounges with room:create, never this way).
        if (isGuardedRoomCode(raw) && session.roomCode !== raw) {
          sharedJoinLimiter.fail(joinKey(), raw);
        }
        if (isPublicChaosCode(raw)) {
          room = createRoom("chaos", raw, false);
        } else {
          // Claim the code in liveRooms first: if another instance opened it
          // in the meantime, join that room instead of shadowing it.
          const draft = draftRoom("chaos", raw);
          markPrivateRoom(draft, session.playerId);
          if (await reserveExactCode(draft)) {
            room = getRoom(raw) ?? registerRoom(draft);
          } else {
            room = (await ensureRoom(raw)) ?? getRoom(raw);
            if (!room) return missedCode(raw);
            if (room.mode !== "chaos") return missedCode(raw);
          }
        }
      }
    }

    if (!room) return fail(socket, "ROOM_NOT_FOUND", "no open lounge");

    if (session.roomCode === room.code) {
      catchUpClock(io, room, socket.id);
      broadcastState(io, room);
      return;
    }

    leaveCurrentRoom(socket.id);
    dequeue(socket.id);

    if (!seat(socket.id, room)) {
      if (!raw) {
        room = openLoungeFor(session.playerId);
        if (seat(socket.id, room)) {
          trackChaosJoined({ roomCode: room.code, distinctId: session.clientId }).catch(logOnce("trackChaosJoined"));
          socket.emit(ServerEvents.matchFound, { code: room.code, mode: room.mode });
          return;
        }
      }
      if (raw && isGuardedRoomCode(raw)) return missedCode(raw);
      return fail(socket, "ROOM_FULL", "lounge is full");
    }
    trackChaosJoined({ roomCode: room.code, distinctId: session.clientId }).catch(logOnce("trackChaosJoined"));
    socket.emit(ServerEvents.matchFound, { code: room.code, mode: room.mode });
  }));

  socket.on(ClientEvents.queueLeave, safeHandler(socket, ClientEvents.queueLeave, () => {
    const session = sessionOf(socket.id);
    dequeue(socket.id);
    void forgetWaiter({ socketId: socket.id }).catch(logOnce("forgetWaiter"));
    if (session) void forgetWaiter({ clientId: session.clientId }).catch(logOnce("forgetWaiter"));
  }));

  socket.on(ClientEvents.roomLeave, safeHandler(socket, ClientEvents.roomLeave, () => {
    dequeue(socket.id);
    leaveCurrentRoom(socket.id);
  }));

  /** Resolve (and Mongo-hydrate) the 2-seat room this socket sits in. */
  async function seatedRoom(): Promise<{ room: Room; player: Room["players"][number] | undefined } | null> {
    const session = sessionOf(socket.id);
    if (!session) {
      fail(socket, "NOT_IN_ROOM", "join a room first");
      return null;
    }
    const room = session.roomCode
      ? ((await ensureRoom(session.roomCode)) ?? roomOfSession(session))
      : roomOfSession(session);
    if (!room) {
      fail(socket, "NOT_IN_ROOM", "join a room first");
      return null;
    }
    const player = room.players.find((p) => p.clientId === session.clientId);
    if (player) touchPlayer(player);
    return { room, player };
  }

  socket.on(ClientEvents.roomReady, safeHandler(socket, ClientEvents.roomReady, async () => {
    if (authLapsed()) return;
    const seated = await seatedRoom();
    if (!seated || seated.room.mode === "chaos") return;
    const { room, player } = seated;

    // Results: a ready tap is a rematch request, never a one-sided restart.
    if (room.status === "results") {
      if (player) handleRematchRequest(io, room, player.id);
      return;
    }

    if (room.status === "lobby") maybeArmMatch(io, room);
    else catchUpClock(io, room, socket.id);
    broadcastState(io, room);
  }));

  socket.on(ClientEvents.rematchRequest, safeHandler(socket, ClientEvents.rematchRequest, async () => {
    if (authLapsed()) return;
    const seated = await seatedRoom();
    if (!seated || seated.room.mode === "chaos" || !seated.player) return;
    handleRematchRequest(io, seated.room, seated.player.id);
  }));

  socket.on(ClientEvents.rematchCancel, safeHandler(socket, ClientEvents.rematchCancel, async () => {
    if (authLapsed()) return;
    const seated = await seatedRoom();
    if (!seated || seated.room.mode === "chaos" || !seated.player) return;
    handleRematchCancel(io, seated.room, seated.player.id);
  }));

  // pitch:live is relayed to the room ~10x/s. Extras past 20/s are dropped
  // silently, and every number is clamped before anyone else sees it.
  const pitchGate = createRateGate();
  socket.on(ClientEvents.pitchLive, safeHandler(socket, ClientEvents.pitchLive, (payload: unknown) => {
    if (!pitchGate()) return;
    const session = sessionOf(socket.id);
    const room = roomOfSession(session);
    if (!session || !room) return;
    const player = room.players.find((p) => p.id === session.playerId);
    if (!player) return;
    touchPlayer(player);
    const singing =
      room.mode === "duet"
        ? room.status === "live"
        : (room.status === "turnA" || room.status === "turnB") &&
          room.activeSingerId === player.id;
    if (!singing) return;
    socket.to(room.code).emit(ServerEvents.pitchLive, {
      playerId: player.id,
      ...sanitizePitchSample(payload),
    });
  }));

  socket.on("disconnect", safeHandler(socket, "disconnect", () => {
    dequeue(socket.id);
    void forgetWaiter({ socketId: socket.id }).catch(logOnce("forgetWaiter"));
    leaveCurrentRoom(socket.id, { forfeit: true, media: "later" });
    sessions.delete(socket.id);
  }));
});

ensurePermanentRooms();

setInterval(() => {
  void (async () => {
    for (const room of allRooms()) {
      // One bad room must not stop the sweep for the rest.
      try {
        await ensureRoom(room.code);
        pruneRoom(room);
        advanceDue(io, room);
        if (room.players.length === 0 && room.persistent) continue;
        if (room.players.length === 0) disposeIfEmpty(room);
      } catch (err) {
        logOnce("room sweep")(err);
      }
    }
  })().catch(logOnce("room sweep"));
}, 2000);

function logBoot(): void {
  const auth = authMode();
  console.log(
    `[lane-a] accounts: ${
      auth === "verify"
        ? "required (Supabase)"
        : auth === "dev-guest"
          ? "DEV OPT-OUT, guest play (AUTH_REQUIRED=0)"
          : "NOT CONFIGURED, play refused (set SUPABASE_URL / SUPABASE_ANON_KEY)"
    }`,
  );
  const lk = readLiveKitConfig() ? "configured" : "MISSING (see .env)";
  console.log(`[lane-a] livekit: ${lk}`);
  console.log(`[lane-a] posthog: ${posthogConfigured() ? "configured" : "off"}`);
  console.log(`[lane-a] demo room ${DemoRoomCode} is live; Chaos lounges spawn on join`);
  if (process.env.USE_TEST_SONG === "1") {
    console.log("[lane-a] USE_TEST_SONG=1 — serving /songs/_test click track");
  }
  if (!existsSync(WEB_DIST)) {
    console.log("[lane-a] no client build yet; run `npm run dev` and use Vite on :5173");
  }
}

if (!ON_VERCEL) {
  httpServer.listen(PORT, () => {
    console.log(`[lane-a] http+socket.io on :${PORT}`);
    logBoot();
  });
} else {
  console.log("[lane-a] vercel function ready");
  logBoot();
}

export default httpServer;
