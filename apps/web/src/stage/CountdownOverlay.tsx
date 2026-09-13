/**
 * Full-viewport countdown veil. Dark enough to read, clear enough to see
 * cameras and lyrics. Lifts at 5s remaining so the last beat is the real stage.
 */
import { createPortal } from "react-dom";
import { countdownVeilOpacity, formatCountdown, showCountdownOverlay } from "./formatCountdown.ts";

export default function CountdownOverlay({
  remainingMs,
  singing,
}: {
  remainingMs: number;
  singing: boolean;
}) {
  if (!showCountdownOverlay(remainingMs)) return null;
  const veil = countdownVeilOpacity(remainingMs);
  return createPortal(
    <div
      className="countdown-veil"
      role="status"
      aria-live="assertive"
      style={{ background: `rgb(4 6 12 / ${veil})` }}
    >
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
