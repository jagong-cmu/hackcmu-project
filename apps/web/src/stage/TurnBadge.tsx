/**
 * LANE A — YOUR TURN / THEIR TURN (PRD §6.1).
 * Duet live follows the current lyric part, not a swap beat.
 */
import type { RoomState } from "@karaoke/shared";
import type { DuetVoiceCue } from "./StageContext.tsx";

export default function TurnBadge({
  room,
  myPlayerId,
  duetVoice,
}: {
  room: RoomState | null;
  myPlayerId: string | null;
  duetVoice?: DuetVoiceCue | null;
}) {
  if (!room) return null;
  if (room.mode === "chaos") {
    return <span className="badge them">LOUNGE</span>;
  }

  const singing = room.activeSingerId !== null && room.activeSingerId === myPlayerId;
  const seat = myPlayerId
    ? room.players[0]?.id === myPlayerId
      ? "a"
      : room.players[1]?.id === myPlayerId
        ? "b"
        : null
    : null;

  const duetLive = room.mode === "duet" && (room.status === "live" || room.status === "countdown");
  const duetMine =
    duetLive &&
    duetVoice != null &&
    duetVoice !== "rest" &&
    (duetVoice === "both" || duetVoice === seat);

  const label = (() => {
    if (room.mode === "duet") {
      switch (room.status) {
        case "lobby":
          return "LOBBY";
        case "countdown":
        case "live":
          if (!duetVoice && room.status === "countdown") return "GET READY";
          if (duetVoice === "both") return "TOGETHER";
          if (duetVoice === "rest" || !duetVoice) return "WAIT";
          return duetVoice === seat ? "YOU" : "THEM";
        case "results":
          return "RESULTS";
        default:
          return "DUET";
      }
    }
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

  const active =
    (singing && (room.status === "turnA" || room.status === "turnB")) ||
    (room.mode === "duet" && room.status === "live" && duetMine);
  const together = room.mode === "duet" && room.status === "live" && duetVoice === "both";
  return (
    <span className={together ? "badge together" : active ? "badge you" : "badge them"}>
      {label}
    </span>
  );
}
