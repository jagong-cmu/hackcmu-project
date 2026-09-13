/**
 * Full-screen countdown and turn callouts so a match reads as beats, not a badge.
 * A thinner guide stays up for the whole turn so the waiting singer doesn't jump in.
 */
import { useEffect, useRef, useState } from "react";
import type { RoomState } from "@karaoke/shared";
import { serverNow } from "../rooms/timeSync.ts";
import type { ClockPlay } from "../rooms/RoomProvider.tsx";
import CountdownOverlay from "./CountdownOverlay.tsx";
import { OverlayHideMs, showCountdownOverlay, showSwapOverlay } from "./formatCountdown.ts";

type Beat =
  | { kind: "turn"; title: string; sub: string }
  | { kind: "together" }
  | { kind: "chaos" }
  | { kind: "time" };

function isSingingTurn(room: RoomState, myPlayerId: string | null): boolean {
  if (room.mode === "duet" || room.mode === "chaos") return true;
  return Boolean(myPlayerId && room.activeSingerId === myPlayerId);
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

    if (status === "swap") {
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
    const lead = clockPlay.playAtUnixMs - serverNow();
    if (lead > OverlayHideMs) return;
    setBeat({ kind: "chaos" });
  }, [room?.mode, clockPlay?.songId, clockPlay?.playAtUnixMs]);

  useEffect(() => {
    if (!beat) return;
    const hold = beat.kind === "time" ? 1400 : beat.kind === "chaos" ? 2800 : 2200;
    const t = window.setTimeout(() => setBeat(null), hold);
    return () => window.clearTimeout(t);
  }, [beat]);

  if (!room) return null;

  const mine = Boolean(myPlayerId && room.activeSingerId === myPlayerId);
  const singer = room.players.find((p) => p.id === room.activeSingerId);
  const themName =
    room.players.find((p) => p.id !== myPlayerId)?.displayName ?? singer?.displayName ?? "They";
  const msUntil = (clockPlay?.playAtUnixMs ?? room.playAtUnixMs ?? 0) - now;
  const hasClock = clockPlay != null || room.playAtUnixMs != null;
  const prePlay = hasClock && msUntil > 0;
  const swapping = room.status === "swap";
  const overlayUp =
    prePlay && (swapping ? showSwapOverlay(msUntil) : showCountdownOverlay(msUntil));
  const go =
    msUntil <= 0 &&
    msUntil > -1100 &&
    (room.status === "countdown" || room.status === "swap") &&
    hasClock;

  let guide: { title: string; body: string } | null = null;
  if (room.mode === "ranked" && (room.status === "turnA" || room.status === "turnB")) {
    guide = mine
      ? { title: "Your turn", body: "Sing this chorus. They wait and watch." }
      : { title: "Wait", body: `${themName} is singing. Stay quiet — you go next.` };
  } else if (room.mode === "ranked" && room.status === "countdown") {
    guide = mine
      ? { title: "Your turn", body: "Sing this chorus." }
      : { title: "Wait", body: `${themName} sings first. Stay quiet.` };
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
      {overlayUp ? (
        <CountdownOverlay
          remainingMs={msUntil}
          singing={isSingingTurn(room, myPlayerId)}
          phase={swapping ? "swap" : "countdown"}
        />
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

      {!overlayUp && !go && beat?.kind === "turn" ? (
        <div className="callout flash" role="status">
          <p className="callout-title">{beat.title}</p>
          <p className="callout-sub">{beat.sub}</p>
        </div>
      ) : null}

      {!overlayUp && !go && beat?.kind === "together" ? (
        <div className="callout flash" role="status">
          <p className="callout-title">SING TOGETHER</p>
          <p className="callout-sub">Whole song. Your lines light up.</p>
        </div>
      ) : null}

      {!overlayUp && !go && beat?.kind === "chaos" ? (
        <div className="callout flash" role="status">
          <p className="callout-title">CHAOS</p>
          <p className="callout-sub">Whole song. No score. Sing whenever.</p>
        </div>
      ) : null}

      {beat?.kind === "time" ? (
        <div className="callout hold" role="status">
          <p className="callout-title">TIME</p>
          <p className="callout-sub">Locking in scores</p>
        </div>
      ) : null}

      {guide && !overlayUp && !go && beat?.kind !== "time" ? (
        <div className={`turn-guide ${mine || room.mode !== "ranked" ? "go" : "wait"}`} role="status">
          <strong>{guide.title}</strong>
          <span>{guide.body}</span>
        </div>
      ) : null}
    </>
  );
}
