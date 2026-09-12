/**
 * Full-screen countdown and turn callouts so a match reads as beats, not a badge.
 */
import { useEffect, useRef, useState } from "react";
import type { RoomState } from "@karaoke/shared";
import { serverNow } from "../rooms/timeSync.ts";
import type { ClockPlay } from "../rooms/RoomProvider.tsx";

type Beat =
  | { kind: "end" }
  | { kind: "turn"; title: string; sub: string }
  | { kind: "together" }
  | { kind: "time" };

export default function TurnOverlay({
  room,
  myPlayerId,
  clockPlay,
}: {
  room: RoomState | null;
  myPlayerId: string | null;
  clockPlay: ClockPlay | null;
}) {
  const [now, setNow] = useState(() => serverNow());
  const [beat, setBeat] = useState<Beat | null>(null);
  const prevStatus = useRef<string | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNow(serverNow()), 80);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!room) return;
    const status = room.status;
    const prev = prevStatus.current;
    if (status === prev) return;
    prevStatus.current = status;

    const singer = room.players.find((p) => p.id === room.activeSingerId);
    const mine = Boolean(myPlayerId && room.activeSingerId === myPlayerId);

    if ((prev === "turnA" || prev === "turnB") && status === "swap") {
      setBeat({ kind: "end" });
      return;
    }
    if (status === "turnA" || status === "turnB") {
      setBeat({
        kind: "turn",
        title: mine ? "YOUR TURN" : "THEIR TURN",
        sub: mine ? "Sing the chorus" : `${singer?.displayName ?? "They"} take the mic`,
      });
      return;
    }
    if (status === "live") {
      if (room.mode === "duet") return;
      setBeat({ kind: "together" });
      return;
    }
    if (status === "results") {
      setBeat({ kind: "time" });
    }
  }, [room, myPlayerId]);

  useEffect(() => {
    if (!beat) return;
    const hold = beat.kind === "end" ? 1400 : beat.kind === "time" ? 1400 : 1600;
    const t = window.setTimeout(() => setBeat(null), hold);
    return () => clearTimeout(t);
  }, [beat]);

  if (!room || room.mode === "chaos") return null;

  const mine = Boolean(myPlayerId && room.activeSingerId === myPlayerId);
  const singer = room.players.find((p) => p.id === room.activeSingerId);
  const msUntil = clockPlay ? clockPlay.playAtUnixMs - now : 0;
  const countingDown =
    (room.status === "countdown" || room.status === "swap") &&
    Boolean(clockPlay) &&
    msUntil > 0;
  const go =
    Boolean(clockPlay) &&
    msUntil <= 0 &&
    msUntil > -1100 &&
    (room.status === "countdown" || room.status === "swap");

  if (countingDown) {
    const count = Math.max(1, Math.ceil(msUntil / 1000));
    const swapping = room.status === "swap";
    return (
      <div className="callout hold" role="status">
        <p className="callout-kicker">
          {swapping
            ? "SWITCH"
            : room.mode === "duet"
              ? "Your lines light up"
              : mine
                ? "You're up first"
                : "They sing first"}
        </p>
        <p className="callout-count">{count}</p>
        <p className="callout-sub">
          {swapping
            ? mine
              ? "You're next"
              : `${singer?.displayName ?? "They"} are next`
            : room.mode === "duet"
              ? "Jump in on together"
              : "Get ready"}
        </p>
      </div>
    );
  }

  if (go) {
    return (
      <div className="callout hold" role="status">
        <p className="callout-count go">GO</p>
      </div>
    );
  }

  if (beat?.kind === "turn") {
    return (
      <div className="callout flash" role="status">
        <p className="callout-title">{beat.title}</p>
        <p className="callout-sub">{beat.sub}</p>
      </div>
    );
  }

  if (beat?.kind === "together") {
    return (
      <div className="callout flash" role="status">
        <p className="callout-title">SING TOGETHER</p>
        <p className="callout-sub">Both mics are on</p>
      </div>
    );
  }

  if (beat?.kind === "end") {
    return (
      <div className="callout hold" role="status">
        <p className="callout-kicker">End of turn</p>
        <p className="callout-title">LOCKED IN</p>
        <p className="callout-sub">Same chorus. Other singer.</p>
      </div>
    );
  }

  if (beat?.kind === "time") {
    return (
      <div className="callout hold" role="status">
        <p className="callout-title">TIME</p>
        <p className="callout-sub">Locking in scores</p>
      </div>
    );
  }

  return null;
}
