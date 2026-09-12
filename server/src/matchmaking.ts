/**
 * LANE A — FIFO matchmaking for Ranked and Duet.
 *
 * Deliberately dumb: no skill bracketing, no backfill. Two people waiting in
 * the same mode get paired in arrival order (TECHNICAL_PRD §6).
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

/** Drop a player from every queue — used on disconnect and on manual leave. */
export function dequeue(socketId: string): void {
  for (const mode of Object.keys(queues) as QueueMode[]) {
    queues[mode] = queues[mode].filter((w) => w.socketId !== socketId);
  }
}

export function queueLength(mode: QueueMode): number {
  return queues[mode].length;
}

/**
 * Join the FIFO. Returns a fresh room plus both waiting entries once a pair is
 * available, or null while still waiting.
 */
export function enqueue(
  mode: QueueMode,
  player: Waiting,
): { room: Room; pair: [Waiting, Waiting] } | null {
  dequeue(player.socketId);

  const queue = queues[mode];
  const opponent = queue.shift();
  if (!opponent) {
    queue.push(player);
    return null;
  }

  // Guard against a stale entry for the same person in two tabs.
  if (opponent.clientId === player.clientId) {
    queue.unshift(opponent);
    return null;
  }

  const room = createRoom(mode);
  return { room, pair: [opponent, player] };
}
