/**
 * Full-viewport countdown veil. Dark enough to read, clear enough to see
 * cameras and lyrics. Opening match lifts at 5s remaining; ranked swap
 * stays up until GO so the handoff is as obvious as the start.
 */
import { createPortal } from "react-dom";
import {
  countdownVeilOpacity,
  formatCountdown,
  showCountdownOverlay,
  showSwapOverlay,
  swapVeilOpacity,
} from "./formatCountdown.ts";

export default function CountdownOverlay({
  remainingMs,
  singing,
  phase = "countdown",
}: {
  remainingMs: number;
  singing: boolean;
  phase?: "countdown" | "swap";
}) {
  const visible = phase === "swap" ? showSwapOverlay(remainingMs) : showCountdownOverlay(remainingMs);
  if (!visible) return null;
  const veil = phase === "swap" ? swapVeilOpacity(remainingMs) : countdownVeilOpacity(remainingMs);
  return createPortal(
    <div
      className="countdown-veil"
      role="status"
      aria-live="assertive"
      style={{ background: `rgb(4 6 12 / ${veil})` }}
    >
      {phase === "swap" ? <p className="countdown-kicker">Same chorus</p> : null}
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
