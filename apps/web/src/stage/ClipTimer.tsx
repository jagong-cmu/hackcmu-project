/**
 * Clip progress under the machine, and the "01:12 / 03:20" clock on its screen.
 *
 * Reads the same `playAtUnixMs` the audio does, so the number on screen and the
 * music can never disagree.
 */
import { useEffect, useState, type ReactNode } from "react";
import { formatCountdown } from "./formatCountdown.ts";
import { serverNow } from "../rooms/timeSync.ts";
import type { ClockPlay } from "../rooms/RoomProvider.tsx";
import { Digits } from "../ui/Digits.tsx";

const TICK_MS = 80;

/** 72.4 → "01:12". */
export function mmss(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

type Clip = { elapsedSec: number; durationSec: number; msUntilStart: number } | null;

function useClip(clockPlay: ClockPlay | null, playAtUnixMs?: number | null): Clip {
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    const id = window.setInterval(() => setNow(serverNow()), TICK_MS);
    return () => clearInterval(id);
  }, []);
  const goAt = clockPlay?.playAtUnixMs ?? playAtUnixMs ?? null;
  if (goAt == null) return null;
  const durationSec = clockPlay?.durationSec ?? 0;
  return {
    elapsedSec: Math.max(0, Math.min(durationSec, (now - goAt) / 1000)),
    durationSec,
    msUntilStart: goAt - now,
  };
}

/** The bar itself, for any caller that already has the numbers (Training). */
export function ProgressBar({ label, elapsedSec, durationSec, note }: {
  label: string;
  elapsedSec: number;
  durationSec: number;
  /** Replaces the time on the right, e.g. a countdown. */
  note?: ReactNode;
}) {
  const frac = durationSec > 0 ? Math.min(1, elapsedSec / durationSec) : 0;
  return (
    <div className="km-progress" aria-hidden="true">
      <div className="km-progress-row t-label">
        <span>{label}</span>
        <span>{note ?? <Digits value={`${mmss(elapsedSec)} / ${mmss(durationSec)}`} />}</span>
      </div>
      <div className="km-track">
        <span style={{ transform: `scaleX(${frac})` }} />
      </div>
    </div>
  );
}

export default function ClipTimer({
  clockPlay,
  playAtUnixMs,
  status,
  label,
}: {
  clockPlay: ClockPlay | null;
  playAtUnixMs?: number | null;
  status: string;
  label: string;
}) {
  const clip = useClip(clockPlay, playAtUnixMs);
  if (!clip || status === "lobby") return <ProgressBar label={label} elapsedSec={0} durationSec={0} note="--:--" />;
  if (clip.msUntilStart > 0) {
    return <ProgressBar label={label} elapsedSec={0} durationSec={clip.durationSec} note={<>Starts in <Digits value={formatCountdown(clip.msUntilStart)} /></>} />;
  }
  return <ProgressBar label={label} elapsedSec={clip.elapsedSec} durationSec={clip.durationSec} />;
}

export function ClipClock({ clockPlay, playAtUnixMs }: { clockPlay: ClockPlay | null; playAtUnixMs?: number | null }) {
  const clip = useClip(clockPlay, playAtUnixMs);
  return <Digits value={`${mmss(clip && clip.msUntilStart <= 0 ? clip.elapsedSec : 0)} / ${mmss(clip?.durationSec ?? 0)}`} />;
}
