/**
 * LANE A — what the stage exposes to Lane B (TECHNICAL_PRD §5.3).
 *
 * `audioRef`   the instrumental element; read currentTime for lyric timing
 * `micStream`  the same capture LiveKit publishes; feed it to pitchy / the DSP
 * `room`       live RoomState, including status and activeSingerId
 *
 * Lane B reads this. Lane B does not open LiveKit or a socket.
 */
import { createContext, useContext } from "react";
import type { RoomState } from "@karaoke/shared";

export type StageContextValue = {
  audioRef: React.RefObject<HTMLAudioElement>;
  micStream: MediaStream | null;
  room: RoomState | null;
  /** The signed-in player's id, for "is it my turn" checks. */
  myPlayerId: string | null;
};

export const StageContext = createContext<StageContextValue | null>(null);

export function useStage(): StageContextValue {
  const value = useContext(StageContext);
  if (!value) throw new Error("useStage must be used inside <Stage>");
  return value;
}
