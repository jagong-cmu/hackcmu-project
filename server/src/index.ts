/**
 * LANE A — HTTP + Socket.IO entry point.
 *
 * Owns: connection lifecycle, room routing, LiveKit token minting, static
 * hosting of the built client, and mounting the score route.
 * Never touches Gemini or Mongo — that is Lane B (TECHNICAL_PRD §4).
 */
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import dotenv from "dotenv";
import cors from "cors";
import express from "express";
import { Server } from "socket.io";

import {
  ChaosLounges,
  ClientEvents,
  DemoRoomCode,
  PublicChaosCode,
  ServerEvents,
  StartingElo,
  type Mode,
  type ScoreCard,
} from "@karaoke/shared";

import {
  addPlayer,
  disposeIfEmpty,
  ensurePermanentRooms,
  createRoom,
  getRoom,
  isFull,
  removePlayer,
  resetToLobby,
  type Room,
} from "./rooms.ts";
import {
  broadcastState,
  catchUpClock,
  everyoneReady,
  forfeitFor,
  recordScore,
  startChaos,
  startMatch,
  stopChaos,
} from "./clock.ts";
import { dequeue, enqueue, isQueueMode, type Waiting } from "./matchmaking.ts";
import { liveKitRoomName, mintToken, readLiveKitConfig } from "./livekit.ts";
import { getDb, mongoConfigured, upsertPlayer } from "./db.ts";
import { enrichScore, registerLaneBRoutes } from "./judge.ts";

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
  transports: ["websocket"],
});

app.use(cors());
app.use(express.json({ limit: "256kb" }));
registerLaneBRoutes(app);

/** Per-socket identity. Rooms hold the authoritative player record. */
type Session = {
  playerId: string;
  clientId: string;
  displayName: string;
  elo: number;
  roomCode: string | null;
};
const sessions = new Map<string, Session>();

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

/** Ping this ~2 minutes before a demo to wake a sleeping Render Free dyno. */
app.get("/api/health", async (_req, res) => {
  const db = await getDb();
  res.json({
    ok: true,
    serverTimeMs: Date.now(),
    uptimeSec: Math.round(process.uptime()),
    mongo: Boolean(db),
    mongoConfigured: mongoConfigured(),
    gemini: Boolean(process.env.GEMINI_API_KEY?.trim()),
  });
});

/**
 * LiveKit join token. The API secret stays server-side; the client only ever
 * sees a scoped, expiring JWT plus the public ws URL.
 */
app.post("/api/livekit/token", async (req, res) => {
  const config = readLiveKitConfig();
  if (!config) {
    res.status(503).json({
      code: "LIVEKIT_UNCONFIGURED",
      message: "Set LIVEKIT_API_KEY / LIVEKIT_API_SECRET / LIVEKIT_WS_URL in .env",
    });
    return;
  }

  const { code, identity, displayName } = req.body ?? {};
  if (typeof code !== "string" || typeof identity !== "string") {
    res.status(400).json({ code: "BAD_REQUEST", message: "code and identity required" });
    return;
  }

  const token = await mintToken(
    config,
    code,
    identity,
    typeof displayName === "string" ? displayName : "Singer",
  );
  res.json({ token, wsUrl: config.wsUrl, room: liveKitRoomName(code) });
});

/**
 * Score upload. The client runs the DSP locally and posts numbers — never a
 * 15s audio blob (TECHNICAL_PRD §5.2).
 *
 * ── LANE B ────────────────────────────────────────────────────────────────
 * This is the stub. Replace the marked block with your handler: merge the
 * Gemini verdict from judge.ts, persist via db.ts, apply elo.ts. Keep the
 * `recordScore(...)` call — it is what advances Lane A's turn machine.
 * ──────────────────────────────────────────────────────────────────────────
 */
app.post("/api/turns/:roomId/score", async (req, res) => {
  const room = getRoom(req.params.roomId);
  if (!room) {
    res.status(404).json({ code: "ROOM_NOT_FOUND", message: "no such room" });
    return;
  }

  const { clientId, score, lyrics } = req.body ?? {};
  if (typeof clientId !== "string" || !score || typeof score !== "object") {
    res.status(400).json({ code: "BAD_REQUEST", message: "clientId and score required" });
    return;
  }

  const player = room.players.find((p) => p.clientId === clientId);
  if (!player) {
    res.status(404).json({ code: "PLAYER_NOT_IN_ROOM", message: "not seated here" });
    return;
  }

  const enriched = await enrichScore(
    score as ScoreCard,
    typeof lyrics === "string" ? lyrics : undefined,
  );
  const settled = recordScore(io, room, player.id, enriched);
  res.json({ ok: true, settled, score: enriched });
});

// Serve the built client from the same origin in production so there is one
// HTTPS URL for getUserMedia. In dev, Vite proxies to us instead.
if (existsSync(WEB_DIST)) {
  app.use(express.static(WEB_DIST));
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(WEB_DIST, "index.html"));
  });
}

// ---------------------------------------------------------------------------
// Socket.IO
// ---------------------------------------------------------------------------

function fail(socket: { emit: (e: string, p: unknown) => void }, code: string, message: string) {
  socket.emit(ServerEvents.error, { code, message });
}

/** Seat a socket in a room and sync everyone. Returns false if it could not. */
function seat(socketId: string, room: Room): boolean {
  const session = sessionOf(socketId);
  if (!session) return false;

  const alreadyHere = room.players.some((p) => p.clientId === session.clientId);
  if (!alreadyHere && isFull(room)) return false;

  const wasEmpty = room.players.length === 0;
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

  io.sockets.sockets.get(socketId)?.join(room.code);

  if (room.mode === "chaos") {
    if (wasEmpty) startChaos(io, room);
    else catchUpClock(io, room, socketId);
  }
  broadcastState(io, room);
  return true;
}

function leaveCurrentRoom(socketId: string): void {
  const session = sessionOf(socketId);
  const room = roomOfSession(session);
  if (!session || !room) return;

  const player = room.players.find((p) => p.id === session.playerId);
  if (player) {
    player.connected = false;
    forfeitFor(io, room, player);
    removePlayer(room, player.id);
  }

  io.sockets.sockets.get(socketId)?.leave(room.code);
  session.roomCode = null;

  if (room.mode === "chaos" && room.players.length === 0) stopChaos(io, room);
  if (room.players.length === 0 && room.persistent) resetToLobby(room);

  broadcastState(io, room);
  disposeIfEmpty(room);
}

io.on("connection", (socket) => {
  socket.on(ClientEvents.playerHello, async (payload: unknown) => {
    const { clientId, displayName } = (payload ?? {}) as Record<string, unknown>;
    if (typeof clientId !== "string" || !clientId) {
      fail(socket, "BAD_HELLO", "clientId required");
      return;
    }
    const name =
      typeof displayName === "string" && displayName.trim()
        ? displayName.trim().slice(0, 24)
        : "Singer";

    // Seat the session synchronously. Awaiting Atlas first let a following
    // room:create / room:ready run against a wiped session (NOT_IN_ROOM).
    const existing = sessions.get(socket.id);
    const session: Session =
      existing && existing.clientId === clientId
        ? { ...existing, displayName: name }
        : {
            playerId: randomUUID(),
            clientId,
            displayName: name,
            elo: existing?.elo ?? StartingElo,
            roomCode: null,
          };
    sessions.set(socket.id, session);

    try {
      const db = await getDb();
      if (db) {
        const player = await upsertPlayer(db, clientId, name);
        session.elo = player.elo;
      }
    } catch {
      /* Atlas down: keep current elo */
    }

    if (session.roomCode) {
      const room = getRoom(session.roomCode);
      const seated = room?.players.find((p) => p.id === session.playerId);
      if (seated) {
        seated.displayName = session.displayName;
        seated.elo = session.elo;
        broadcastState(io, room);
      }
    }

    socket.emit(ServerEvents.playerOk, {
      player: {
        id: session.playerId,
        clientId: session.clientId,
        displayName: session.displayName,
        elo: session.elo,
      },
    });
  });

  socket.on(ClientEvents.queueJoin, (payload: unknown) => {
    const session = sessionOf(socket.id);
    if (!session) return fail(socket, "NO_SESSION", "send player:hello first");

    const mode = ((payload ?? {}) as { mode?: Mode }).mode ?? "ranked";
    if (!isQueueMode(mode)) return fail(socket, "BAD_MODE", "ranked or duet only");

    leaveCurrentRoom(socket.id);

    const waiting: Waiting = {
      socketId: socket.id,
      clientId: session.clientId,
      displayName: session.displayName,
      elo: session.elo,
    };
    const match = enqueue(mode, waiting);
    if (!match) {
      socket.emit(ServerEvents.queueWaiting, { mode });
      return;
    }

    for (const person of match.pair) {
      if (!seat(person.socketId, match.room)) continue;
      io.to(person.socketId).emit(ServerEvents.matchFound, {
        code: match.room.code,
        mode,
      });
    }
    broadcastState(io, match.room);
  });

  socket.on(ClientEvents.roomCreate, (payload: unknown) => {
    const session = sessionOf(socket.id);
    if (!session) return fail(socket, "NO_SESSION", "send player:hello first");

    const mode = ((payload ?? {}) as { mode?: Mode }).mode ?? "ranked";
    leaveCurrentRoom(socket.id);
    dequeue(socket.id);

    const room = createRoom(mode);
    if (!seat(socket.id, room)) return fail(socket, "ROOM_FULL", "room is full");
    socket.emit(ServerEvents.matchFound, { code: room.code, mode });
  });

  socket.on(ClientEvents.roomJoin, (payload: unknown) => {
    const session = sessionOf(socket.id);
    if (!session) return fail(socket, "NO_SESSION", "send player:hello first");

    const code = String(((payload ?? {}) as { code?: unknown }).code ?? "").trim();
    const room = getRoom(code);
    if (!room) return fail(socket, "ROOM_NOT_FOUND", `no room ${code}`);

    if (session.roomCode === room.code) {
      broadcastState(io, room);
      return;
    }

    leaveCurrentRoom(socket.id);
    dequeue(socket.id);

    if (!seat(socket.id, room)) return fail(socket, "ROOM_FULL", "room is full");
    socket.emit(ServerEvents.matchFound, { code: room.code, mode: room.mode });
  });

  socket.on(ClientEvents.chaosJoin, (payload: unknown) => {
    const session = sessionOf(socket.id);
    if (!session) return fail(socket, "NO_SESSION", "send player:hello first");

    const raw = String(((payload ?? {}) as { code?: unknown }).code ?? "").trim();
    const code = raw || PublicChaosCode;

    const knownLounge = ChaosLounges.some((lounge) => lounge.code === code);
    const room = getRoom(code) ?? createRoom("chaos", code, knownLounge);
    if (room.mode !== "chaos") return fail(socket, "NOT_CHAOS", `${code} is not a lounge`);

    if (session.roomCode === room.code) {
      catchUpClock(io, room, socket.id);
      broadcastState(io, room);
      return;
    }

    leaveCurrentRoom(socket.id);
    dequeue(socket.id);

    if (!seat(socket.id, room)) return fail(socket, "ROOM_FULL", "lounge is full");
    socket.emit(ServerEvents.matchFound, { code: room.code, mode: room.mode });
  });

  socket.on(ClientEvents.queueLeave, () => {
    dequeue(socket.id);
  });

  socket.on(ClientEvents.roomLeave, () => {
    dequeue(socket.id);
    leaveCurrentRoom(socket.id);
  });

  socket.on(ClientEvents.roomReady, () => {
    const session = sessionOf(socket.id);
    const room = roomOfSession(session);
    if (!session || !room) return fail(socket, "NOT_IN_ROOM", "join a room first");
    if (room.mode === "chaos") return;

    // Ready pressed on the results screen means rematch: same pair, new song.
    if (room.status === "results") resetToLobby(room);

    const player = room.players.find((p) => p.id === session.playerId);
    if (player) player.ready = true;

    if (everyoneReady(room)) startMatch(io, room);
    else broadcastState(io, room);
  });

  socket.on("disconnect", () => {
    dequeue(socket.id);
    leaveCurrentRoom(socket.id);
    sessions.delete(socket.id);
  });
});

ensurePermanentRooms();

function logBoot(): void {
  const lk = readLiveKitConfig() ? "configured" : "MISSING (see .env)";
  console.log(`[lane-a] livekit: ${lk}`);
  console.log(`[lane-a] demo room ${DemoRoomCode} and lounges lounge-a / lounge-b are live`);
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
