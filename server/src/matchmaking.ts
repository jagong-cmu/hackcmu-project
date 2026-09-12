/**
 * LANE A — FIFO matchmaking for Ranked and Duet.
 *
 * Deliberately dumb: no skill bracketing, no backfill. Two live people waiting
 * in the same mode get paired in arrival order (TECHNICAL_PRD §6).
 */
import type { Mode } from "@karaoke/shared";
import { createRoom, type Room } from "./rooms.ts";

export type Waiting = {
  socketId: string;
  clientId: string;
  displayName: string;
  elo: number;
};

type QueueMode = Extract<Mode, "ranked" | "duet">;

const queues: Record<QueueMode, Waiting[]> = {
  ranked: [],
  duet: [],
};

export function isQueueMode(mode: Mode): mode is QueueMode {
  return mode === "ranked" || mode === "duet";
}

export function dequeue(socketId: string): void {
  for (const mode of Object.keys(queues) as QueueMode[]) {
    queues[mode] = queues[mode].filter((w) => w.socketId !== socketId);
  }
}

export function dequeueClient(clientId: string): void {
  for (const mode of Object.keys(queues) as QueueMode[]) {
    queues[mode] = queues[mode].filter((w) => w.clientId !== clientId);
  }
}

export function queueLength(mode: QueueMode): number {
  return queues[mode].length;
}

/** Put a live player back in line without trying to pair them. */
export function park(mode: QueueMode, player: Waiting): void {
  dequeue(player.socketId);
  if (!queues[mode].some((w) => w.socketId === player.socketId)) {
    queues[mode].push(player);
  }
}

/**
 * Join the FIFO. Returns a fresh room plus both waiting entries once a live
 * opponent is available, or null while still waiting.
 *
 * `isLive` drops sockets that disconnected without a dequeue (stale rows would
 * otherwise sit at the head and block everyone behind them).
 */
export function enqueue(
  mode: QueueMode,
  player: Waiting,
  isLive: (socketId: string) => boolean,
): { room: Room; pair: [Waiting, Waiting] } | null {
  dequeue(player.socketId);
  dequeueClient(player.clientId);

  const kept: Waiting[] = [];
  let opponent: Waiting | undefined;
  for (const waiting of queues[mode]) {
    if (!isLive(waiting.socketId) || waiting.clientId === player.clientId) continue;
    if (!opponent) opponent = waiting;
    else kept.push(waiting);
  }
  queues[mode] = kept;

  if (!opponent) {
    queues[mode].push(player);
    return null;
  }

  const room = createRoom(mode);
  return { room, pair: [opponent, player] };
}
