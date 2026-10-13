/**
 * Ticks the rematch view off the synced server clock while a countdown or a
 * lapse notice is on screen.
 */
import { useEffect, useState } from "react";
import type { RoomState } from "@karaoke/shared";
import { serverNow } from "../rooms/timeSync.ts";
import { RematchNoticeMs, rematchView, type RematchView } from "./rematchView.ts";

/** Re-render on a short beat while a rematch countdown or notice is live. */
export function useRematchView(
  room: RoomState | null,
  myPlayerId: string | null,
): RematchView | null {
  const [now, setNow] = useState(() => serverNow());
  const [lastOpponentName, setLastOpponentName] = useState<string | undefined>(undefined);
  const opponentName = room?.players.find((p) => p.id !== myPlayerId)?.displayName;
  useEffect(() => {
    if (opponentName) setLastOpponentName(opponentName);
  }, [opponentName]);

  const offerDeadline = room?.rematch?.deadlineUnixMs ?? null;
  const lapseAt = room?.rematchLapse?.atUnixMs ?? null;
  const live =
    room?.status === "results" &&
    ((offerDeadline != null && serverNow() < offerDeadline + 1000) ||
      (lapseAt != null && serverNow() - lapseAt < RematchNoticeMs + 500));

  useEffect(() => {
    setNow(serverNow());
    if (!live) return;
    const id = window.setInterval(() => setNow(serverNow()), 200);
    return () => window.clearInterval(id);
  }, [live, offerDeadline, lapseAt]);

  if (!room || !myPlayerId || room.status !== "results" || room.mode === "chaos") return null;
  return rematchView(room, myPlayerId, now, lastOpponentName);
}
