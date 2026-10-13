/**
 * Rematch handshake for 2-seat rooms (Ranked / Duet, queue or private code).
 *
 * One tap opens an offer with a RematchWindowMs deadline. The match only
 * restarts once every seated player has tapped inside that window. Expiry,
 * a decline, a cancel, or a seat leaving closes the offer and records a
 * `rematchLapse` so both clients can say why.
 *
 * Pure state only — no Socket.IO, no timers. clock.ts drives it.
 */
import {
  RematchWindowMs,
  type RematchLapse,
  type RematchLapseReason,
  type RematchOffer,
} from "@karaoke/shared";
import type { Room } from "./rooms.ts";

export type RematchOutcome =
  /** Not applicable (wrong mode/status, unknown player). Nothing changed. */
  | "ignored"
  /** A new offer was opened by this player. */
  | "opened"
  /** Already requested by this player; still waiting on the other seat. */
  | "waiting"
  /** Every seat has now asked: the caller should restart the match. */
  | "mutual"
  /** No one left to accept (opponent gone). The offer lapsed immediately. */
  | "lapsed";

function lapse(
  room: Room,
  reason: RematchLapseReason,
  byPlayerId: string | null,
  now: number,
): void {
  room.rematch = null;
  room.rematchLapse = { reason, byPlayerId, atUnixMs: now };
}

/** True when an open offer has been confirmed by every seated player. */
export function rematchIsMutual(room: Room): boolean {
  const offer = room.rematch;
  if (!offer || room.status !== "results") return false;
  if (room.players.length < 2) return false;
  return room.players.every((p) => offer.requestedBy.includes(p.id));
}

/** Close an offer whose deadline has passed. Returns true if it changed state. */
export function expireRematch(room: Room, now = Date.now()): boolean {
  const offer = room.rematch;
  if (!offer) return false;
  if (room.status !== "results") {
    room.rematch = null;
    return true;
  }
  if (now < offer.deadlineUnixMs) return false;
  lapse(room, "expired", null, now);
  return true;
}

export function requestRematch(
  room: Room,
  playerId: string,
  now = Date.now(),
): RematchOutcome {
  if (room.mode === "chaos" || room.status !== "results") return "ignored";
  if (!room.players.some((p) => p.id === playerId)) return "ignored";

  expireRematch(room, now);

  if (room.players.length < 2) {
    lapse(room, "left", null, now);
    return "lapsed";
  }

  const offer = room.rematch;
  if (!offer) {
    // Strictly after the last lapse so snapshot merges can order them.
    const openedAtUnixMs = Math.max(now, (room.rematchLapse?.atUnixMs ?? 0) + 1);
    room.rematch = {
      requestedBy: [playerId],
      openedAtUnixMs,
      deadlineUnixMs: openedAtUnixMs + RematchWindowMs,
    };
    return rematchIsMutual(room) ? "mutual" : "opened";
  }

  if (!offer.requestedBy.includes(playerId)) offer.requestedBy.push(playerId);
  return rematchIsMutual(room) ? "mutual" : "waiting";
}

/**
 * Proposer taps Cancel → "cancelled". Opponent taps Decline → "declined".
 * Returns true if an open offer was closed.
 */
export function cancelRematch(room: Room, playerId: string, now = Date.now()): boolean {
  const offer = room.rematch;
  if (!offer) return false;
  if (!room.players.some((p) => p.id === playerId)) return false;
  const reason = offer.requestedBy.includes(playerId) ? "cancelled" : "declined";
  lapse(room, reason, playerId, now);
  return true;
}

/** A seat left or dropped mid-offer. Returns true if an open offer was closed. */
export function lapseRematchOnLeave(room: Room, leaverId: string, now = Date.now()): boolean {
  if (!room.rematch) return false;
  lapse(room, "left", leaverId, now);
  return true;
}

/**
 * Fold another isolate's snapshot into this room. Newest lapse wins; an offer
 * only survives if it opened after the newest lapse; two concurrent offers
 * (both players tapped on different isolates) union into one, which then
 * reads as mutual.
 */
export function mergeRematchSnap(
  room: Room,
  offer: RematchOffer | null | undefined,
  lapsed: RematchLapse | null | undefined,
): void {
  if (room.status !== "results") {
    room.rematch = null;
    return;
  }
  if (lapsed && (!room.rematchLapse || lapsed.atUnixMs > room.rematchLapse.atUnixMs)) {
    room.rematchLapse = { ...lapsed };
  }
  const lapseAt = room.rematchLapse?.atUnixMs ?? Number.NEGATIVE_INFINITY;

  if (offer && offer.openedAtUnixMs > lapseAt) {
    const mine = room.rematch;
    if (!mine) {
      room.rematch = { ...offer, requestedBy: [...offer.requestedBy] };
    } else {
      for (const id of offer.requestedBy) {
        if (!mine.requestedBy.includes(id)) mine.requestedBy.push(id);
      }
      if (offer.openedAtUnixMs < mine.openedAtUnixMs) {
        mine.openedAtUnixMs = offer.openedAtUnixMs;
        mine.deadlineUnixMs = offer.deadlineUnixMs;
      }
    }
  }
  if (room.rematch && room.rematch.openedAtUnixMs <= lapseAt) room.rematch = null;
}
