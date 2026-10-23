/**
 * Full-viewport countdown veil. Dark enough to read, clear enough to see
 * cameras and lyrics. Opening match is up for the whole MatchCountdownMs
 * (5.0 → 1.0) and lifts for the last second so the clear stage shows before
 * GO; ranked swap stays up until GO so the handoff is as obvious as the start.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  countdownVeilOpacity,
  formatCountdown,
  showCountdownOverlay,
  showMatchIntro,
  showSwapOverlay,
  swapVeilOpacity,
} from "./formatCountdown.ts";

export type Versus = { left: string; right: string; song?: string };

export default function CountdownOverlay({
  remainingMs,
  singing,
  phase = "countdown",
  versus,
}: {
  remainingMs: number;
  singing: boolean;
  phase?: "countdown" | "swap";
  /** Ranked / Duet: the short versus card that opens the countdown. */
  versus?: Versus | null;
}) {
  const [skipped, setSkipped] = useState(false);
  const introUp =
    Boolean(versus) &&
    phase === "countdown" &&
    !skipped &&
    showMatchIntro(remainingMs) &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  useEffect(() => {
    if (!introUp) return;
    const skip = () => setSkipped(true);
    window.addEventListener("keydown", skip);
    window.addEventListener("pointerdown", skip);
    return () => {
      window.removeEventListener("keydown", skip);
      window.removeEventListener("pointerdown", skip);
    };
  }, [introUp]);
  const visible = phase === "swap" ? showSwapOverlay(remainingMs) : showCountdownOverlay(remainingMs);
  if (!visible) return null;
  const base = phase === "swap" ? swapVeilOpacity(remainingMs) : countdownVeilOpacity(remainingMs);
  // The versus card stands alone on a near-opaque veil; the stage shows through after.
  const veil = introUp ? 1 : base;
  return createPortal(
    <div
      className="countdown-veil"
      role="status"
      aria-live="assertive"
      style={{ background: `rgb(var(--ink-rgb) / ${veil})` }}
    >
      {phase === "swap" ? <p className="countdown-kicker">Same chorus</p> : null}
      {introUp && versus ? (
        <div className="versus" aria-label={`${versus.left} versus ${versus.right}`}>
          <p className="versus-names">
            <span className="versus-name">{versus.left}</span>
            <span className="versus-vs">vs</span>
            <span className="versus-name">{versus.right}</span>
          </p>
          {versus.song ? <p className="versus-song">{versus.song}</p> : null}
          <p className="versus-skip">Press any key to skip</p>
        </div>
      ) : null}
      <p className="countdown-headline">
        {singing ? (
          <>
            <span className="countdown-go">Your turn</span> to sing
          </>
        ) : (
          <>
            Your turn to <span className="countdown-wait">wait</span>
          </>
        )}
      </p>
      <p className="countdown-num">{formatCountdown(remainingMs)}</p>
    </div>,
    document.body,
  );
}
