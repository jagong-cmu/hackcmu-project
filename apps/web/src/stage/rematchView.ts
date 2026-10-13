/**
 * What the results screen should show for the rematch handshake, derived from
 * the server-authoritative `room.rematch` / `room.rematchLapse` and the
 * synced server clock. Pure (no React, no DOM) so the server test suite can import it.
 */
import type { RoomState } from "@karaoke/shared";

/** How long a "rematch lapsed" notice stays on screen. */
export const RematchNoticeMs = 4000;

export type RematchView =
  /** Nobody has asked. Rematch button proposes. */
  | { kind: "idle"; notice: string | null }
  /** I asked; waiting for the opponent. Button cancels. */
  | { kind: "waiting"; opponentName: string; secondsLeft: number }
  /** Opponent asked; I can accept or decline. */
  | { kind: "invited"; opponentName: string; secondsLeft: number }
  /** No opponent seated any more. */
  | { kind: "unavailable"; notice: string };

export function rematchView(
  room: RoomState,
  myPlayerId: string,
  now: number,
  lastOpponentName = "Your opponent",
): RematchView {
  const opponent = room.players.find((p) => p.id !== myPlayerId);
  const opponentName = opponent?.displayName ?? lastOpponentName;
  if (!opponent) return { kind: "unavailable", notice: `${opponentName} left the room.` };

  const offer = room.rematch;
  if (offer && now < offer.deadlineUnixMs) {
    const secondsLeft = Math.max(1, Math.ceil((offer.deadlineUnixMs - now) / 1000));
    if (offer.requestedBy.includes(myPlayerId)) {
      return { kind: "waiting", opponentName, secondsLeft };
    }
    return { kind: "invited", opponentName, secondsLeft };
  }

  const lapse = room.rematchLapse;
  let notice: string | null = null;
  if (lapse && now - lapse.atUnixMs < RematchNoticeMs) {
    const mine = lapse.byPlayerId === myPlayerId;
    switch (lapse.reason) {
      case "expired":
        notice = "Rematch offer expired.";
        break;
      case "declined":
        notice = mine ? "You declined the rematch." : `${opponentName} declined the rematch.`;
        break;
      case "cancelled":
        notice = mine ? "Rematch cancelled." : `${opponentName} cancelled the rematch.`;
        break;
      case "left":
        notice = `${opponentName} left the room.`;
        break;
    }
  } else if (offer) {
    // Deadline passed on our clock; the server's lapse broadcast is on its way.
    notice = "Rematch offer expired.";
  }
  return { kind: "idle", notice };
}
