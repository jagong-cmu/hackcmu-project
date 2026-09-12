import { DemoRoomCode, PublicChaosCode, type Mode } from "@karaoke/shared";

/** Dummy Lane A hooks. Swap these for Socket.IO once rooms/ lands. Do not open LiveKit here. */
export function goWaiting(mode: Mode, extra: Record<string, string>): void {
  const q = new URLSearchParams({ mode, ...extra });
  window.location.hash = `#/waiting?${q.toString()}`;
}

export const laneA = {
  rankedRandom() {
    goWaiting("ranked", { action: "queue" });
  },
  rankedCode(code: string) {
    goWaiting("ranked", { action: "join", code });
  },
  ranked0000() {
    goWaiting("ranked", { action: "join", code: DemoRoomCode });
  },
  duetRandom() {
    goWaiting("duet", { action: "queue" });
  },
  duetCode(code: string) {
    goWaiting("duet", { action: "join", code });
  },
  duet0000() {
    goWaiting("duet", { action: "join", code: DemoRoomCode });
  },
  chaosLounge() {
    goWaiting("chaos", { action: "lounge", code: PublicChaosCode });
  },
  chaosCode(code: string) {
    goWaiting("chaos", { action: "join", code });
  },
};
