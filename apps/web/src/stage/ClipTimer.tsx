/**
 * LANE A — countdown and 15s clip timer.
 *
 * Reads the same `playAtUnixMs` the audio does, so the number on screen and the
 * music can never disagree.
 */
import { useEffect, useState } from "react";
import { serverNow } from "../rooms/timeSync.ts";
import type { ClockPlay } from "../rooms/RoomProvider.tsx";

const TICK_MS = 100;

export default function ClipTimer({
  clockPlay,
  status,
}: {
  clockPlay: ClockPlay | null;
  status: string;
}) {
  const [now, setNow] = useState(() => serverNow());

  useEffect(() => {
    const id = window.setInterval(() => setNow(serverNow()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  if (!clockPlay) return null;

  const { playAtUnixMs, durationSec } = clockPlay;
  const msUntilStart = playAtUnixMs - now;

  if (msUntilStart > 0) {
    const seconds = Math.ceil(msUntilStart / 1000);
    return (
      <div className="timer timer-compact">
        {seconds}
        <div className="bar"><span style={{ width: "0%" }} /></div>
      </div>
    );
  }

  if (status === "results" || status === "lobby") return null;

  const elapsedSec = Math.min(durationSec, (now - playAtUnixMs) / 1000);
  const remaining = Math.max(0, durationSec - elapsedSec);
  const pct = durationSec > 0 ? (elapsedSec / durationSec) * 100 : 0;

  return (
    <div className="timer timer-compact">
      {remaining.toFixed(1)}s
      <div className="bar"><span style={{ width: `${pct}%` }} /></div>
    </div>
  );
}
