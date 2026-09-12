/**
 * Full-screen countdown and turn callouts so a match reads as beats, not a badge.
 * A thinner guide stays up for the whole turn so the waiting singer doesn't jump in.
 */
import { useEffect, useRef, useState } from "react";
import type { RoomState } from "@karaoke/shared";
import { serverNow } from "../rooms/timeSync.ts";
import type { ClockPlay } from "../rooms/RoomProvider.tsx";
import { formatCountdown } from "./formatCountdown.ts";

type Beat =
  | { kind: "end" }
  | { kind: "turn"; title: string; sub: string }
  | { kind: "together" }
  | { kind: "chaos" }
  | { kind: "time" };

function rankedCountdownCopy(
  mine: boolean,
  swapping: boolean,
  singerName: string,
): { kicker: string; sub: string } {
  if (swapping) {
    return mine
      ? {
          kicker: "Your turn — sing now",
          sub: "Same chorus they just sang. Start on GO. They wait.",
        }
      : {
          kicker: "Wait — their turn",
          sub: `${singerName} sings the same chorus. Stay quiet until it is your turn again.`,
        };
  }
  return mine
    ? {
        kicker: "You sing first",
        sub: `${singerName} waits. Sing this chorus from the top. Do not start until GO.`,
      }
    : {
        kicker: "Wait — they sing first",
        sub: `${singerName} has this chorus. Stay quiet. You sing the same lines after they finish.`,
      };
}

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
  const prevSong = useRef<string | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNow(serverNow()), 80);
    return () => window.clearInterval(id);
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
        title: mine ? "YOUR TURN" : "WAIT",
        sub: mine
          ? "Sing this chorus. They are watching."
          : `Don't sing. ${singer?.displayName ?? "They"} have the mic.`,
      });
      return;
    }
    if (status === "live") {
      if (room.mode === "duet") {
        setBeat({ kind: "together" });
        return;
      }
      if (room.mode === "chaos") {
        setBeat({ kind: "chaos" });
        return;
      }
      setBeat({ kind: "together" });
      return;
    }
    if (status === "results") {
      setBeat({ kind: "time" });
    }
  }, [room, myPlayerId]);

  useEffect(() => {
    if (room?.mode !== "chaos" || !clockPlay?.songId) return;
    if (prevSong.current === clockPlay.songId) return;
    prevSong.current = clockPlay.songId;
    setBeat({ kind: "chaos" });
  }, [room?.mode, clockPlay?.songId]);

  useEffect(() => {
    if (!beat) return;
    const hold =
      beat.kind === "end" ? 1600 : beat.kind === "time" ? 1400 : beat.kind === "chaos" ? 2800 : 2200;
    const t = window.setTimeout(() => setBeat(null), hold);
    return () => window.clearTimeout(t);
  }, [beat]);

  if (!room) return null;

  const mine = Boolean(myPlayerId && room.activeSingerId === myPlayerId);
  const singer = room.players.find((p) => p.id === room.activeSingerId);
  const themName =
    room.players.find((p) => p.id !== myPlayerId)?.displayName ?? singer?.displayName ?? "They";
  const msUntil = (clockPlay?.playAtUnixMs ?? room.playAtUnixMs ?? 0) - now;
  const countingDown =
    (room.status === "countdown" || room.status === "swap") &&
    msUntil > 0 &&
    (clockPlay != null || room.playAtUnixMs != null);
  const go =
    msUntil <= 0 &&
    msUntil > -1100 &&
    (room.status === "countdown" || room.status === "swap") &&
    (clockPlay != null || room.playAtUnixMs != null);

  const rankedCopy = rankedCountdownCopy(mine, room.status === "swap", themName);

  let guide: { title: string; body: string } | null = null;
  if (room.mode === "ranked" && (room.status === "turnA" || room.status === "turnB")) {
    guide = mine
      ? { title: "Your turn", body: "Sing this chorus. They wait and watch." }
      : { title: "Wait", body: `${themName} is singing. Stay quiet — you go next.` };
  } else if (room.mode === "ranked" && room.status === "swap") {
    guide = mine
      ? { title: "You're next", body: "Same chorus. Get ready." }
      : { title: "Wait", body: `${themName} is up next. Don't sing yet.` };
  } else if (room.mode === "duet" && (room.status === "countdown" || room.status === "live")) {
    guide = {
      title: "Sing together",
      body: "Whole song. Your lines light up. Jump in on together.",
    };
  } else if (room.mode === "chaos" && room.status === "live") {
    guide = {
      title: "Chaos lounge",
      body: "Whole song. No score. Sing whenever.",
    };
  }

  return (
    <>
      {countingDown ? (
        <div className="callout hold" role="status">
          <p className="callout-kicker">
            {room.mode === "duet"
              ? "Sing together"
              : room.mode === "chaos"
                ? "Chaos lounge"
                : rankedCopy.kicker}
          </p>
          <p className="callout-count">{formatCountdown(msUntil)}</p>
          <p className="callout-sub">
            {room.mode === "duet"
              ? "Whole song. Your lines light up. Don't start until GO."
              : room.mode === "chaos"
                ? "Whole song. No score. Sing whenever."
                : rankedCopy.sub}
          </p>
        </div>
      ) : null}

      {go ? (
        <div className="callout hold" role="status">
          <p className="callout-count go">GO</p>
          <p className="callout-sub">
            {room.mode === "duet"
              ? "Sing your lines"
              : room.mode === "chaos"
                ? "Open mic"
                : mine
                  ? "Sing now"
                  : "Stay quiet"}
          </p>
        </div>
      ) : null}

      {!countingDown && !go && beat?.kind === "turn" ? (
        <div className="callout flash" role="status">
          <p className="callout-title">{beat.title}</p>
          <p className="callout-sub">{beat.sub}</p>
        </div>
      ) : null}

      {!countingDown && !go && beat?.kind === "together" ? (
        <div className="callout flash" role="status">
          <p className="callout-title">SING TOGETHER</p>
          <p className="callout-sub">Whole song. Your lines light up.</p>
        </div>
      ) : null}

      {!countingDown && !go && beat?.kind === "chaos" ? (
        <div className="callout flash" role="status">
          <p className="callout-title">CHAOS</p>
          <p className="callout-sub">Whole song. No score. Sing whenever.</p>
        </div>
      ) : null}

      {beat?.kind === "end" ? (
        <div className="callout hold" role="status">
          <p className="callout-kicker">End of turn</p>
          <p className="callout-title">SWAP</p>
          <p className="callout-sub">Same chorus. Other singer.</p>
        </div>
      ) : null}

      {beat?.kind === "time" ? (
        <div className="callout hold" role="status">
          <p className="callout-title">TIME</p>
          <p className="callout-sub">Locking in scores</p>
        </div>
      ) : null}

      {guide && !countingDown && !go && beat?.kind !== "end" && beat?.kind !== "time" ? (
        <div className={`turn-guide ${mine || room.mode !== "ranked" ? "go" : "wait"}`} role="status">
          <strong>{guide.title}</strong>
          <span>{guide.body}</span>
        </div>
      ) : null}
    </>
  );
}
