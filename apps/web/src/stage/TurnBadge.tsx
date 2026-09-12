/**
 * LANE A — YOUR TURN / THEIR TURN (PRD §6.1).
 */
import type { RoomState } from "@karaoke/shared";

export default function TurnBadge({
  room,
  myPlayerId,
}: {
  room: RoomState | null;
  myPlayerId: string | null;
}) {
  if (!room) return null;

  const singing = room.activeSingerId !== null && room.activeSingerId === myPlayerId;

  const label = (() => {
    switch (room.status) {
      case "lobby":
        return "LOBBY";
      case "countdown":
        return singing ? "YOU'RE UP" : "THEY'RE UP";
      case "turnA":
      case "turnB":
        return singing ? "YOUR TURN" : "THEIR TURN";
      case "swap":
        return "SWAP";
      case "live":
        return "SING TOGETHER";
      case "results":
        return "RESULTS";
    }
  })();

  const active = singing && (room.status === "turnA" || room.status === "turnB" || room.status === "live");
  return <span className={active ? "badge you" : "badge them"}>{label}</span>;
}
