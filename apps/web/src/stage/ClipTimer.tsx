/**
 * LANE A — countdown and per-song chorus clip timer.
 *
 * Reads the same `playAtUnixMs` the audio does, so the number on screen and the
 * music can never disagree.
 */
import { useEffect, useState } from "react";
import { formatCountdown } from "./formatCountdown.ts";
import { serverNow } from "../rooms/timeSync.ts";
import type { ClockPlay } from "../rooms/RoomProvider.tsx";

const TICK_MS = 80;

export default function ClipTimer({
  clockPlay,
  playAtUnixMs,
  status,
}: {
  clockPlay: ClockPlay | null;
  playAtUnixMs?: number | null;
  status: string;
}) {
  const [now, setNow] = useState(() => serverNow());

  useEffect(() => {
    const id = window.setInterval(() => setNow(serverNow()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  const goAt = clockPlay?.playAtUnixMs ?? playAtUnixMs ?? null;
  if (goAt == null && !clockPlay) return null;

  const msUntilStart = goAt == null ? 0 : goAt - now;

  if (goAt != null && msUntilStart > 0) {
    return (
      <div className="timer timer-compact timer-count" aria-live="off">
        {formatCountdown(msUntilStart)}
        <div className="bar"><span style={{ width: "0%" }} /></div>
      </div>
    );
  }

  if (status === "results" || status === "lobby") return null;
  if (!clockPlay) return null;

  const { playAtUnixMs: startedAt, durationSec } = clockPlay;
  const elapsedSec = Math.min(durationSec, (now - startedAt) / 1000);
  const remaining = Math.max(0, durationSec - elapsedSec);
  const pct = durationSec > 0 ? (elapsedSec / durationSec) * 100 : 0;

  return (
    <div className="timer timer-compact" aria-live="off">
      {formatCountdown(remaining * 1000)}
      <div className="bar"><span style={{ width: `${pct}%` }} /></div>
    </div>
  );
}
