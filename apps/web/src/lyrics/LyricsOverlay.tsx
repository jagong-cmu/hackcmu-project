import { useMemo } from "react";
import { parseLrc, type LrcLine } from "./parseLrc.ts";

type Props = {
  lrc: string | LrcLine[];
  currentTime: number;
};

/** A line stays lit for its own span, but never longer than this. */
const MAX_LINE_SEC = 7;
/** How early a countdown appears before the next line. */
const COUNTDOWN_SEC = 4;

type Window = { text: string; startSec: number; endSec: number };

function windows(lines: LrcLine[]): Window[] {
  return lines.map((l, i) => {
    const next = lines[i + 1]?.timeSec ?? l.timeSec + MAX_LINE_SEC;
    return {
      text: l.text,
      startSec: l.timeSec,
      endSec: Math.min(next, l.timeSec + MAX_LINE_SEC),
    };
  });
}

export function LyricsOverlay({ lrc, currentTime }: Props) {
  const wins = useMemo(() => windows(typeof lrc === "string" ? parseLrc(lrc) : lrc), [lrc]);

  const { active, upcoming } = useMemo(() => {
    let activeWin: Window | null = null;
    let nextWin: Window | null = null;
    for (const w of wins) {
      if (currentTime >= w.startSec && currentTime < w.endSec) activeWin = w;
      if (w.startSec > currentTime) {
        nextWin = w;
        break;
      }
    }
    return { active: activeWin, upcoming: nextWin };
  }, [wins, currentTime]);

  if (active) {
    return (
      <div className="lyrics">
        <p className="lyrics-now">{active.text}</p>
        <p className="lyrics-next">{upcoming?.text ?? ""}</p>
      </div>
    );
  }

  // Between lines: count the singer back in rather than leaving a dead screen.
  if (upcoming) {
    const wait = upcoming.startSec - currentTime;
    if (wait <= COUNTDOWN_SEC) {
      const beats = Math.ceil(wait);
      return (
        <div className="lyrics">
          <p className="lyrics-cue">{upcoming.text}</p>
          <p className="lyrics-count" aria-live="off">
            {[4, 3, 2, 1].map((n) => (
              <span key={n} className={n <= beats ? "dot" : "dot spent"} />
            ))}
            <span className="count-num">{beats}</span>
          </p>
        </div>
      );
    }
    return (
      <div className="lyrics">
        <p className="lyrics-rest">♪</p>
        <p className="lyrics-next">{upcoming.text}</p>
      </div>
    );
  }

  return (
    <div className="lyrics">
      <p className="lyrics-rest">♪</p>
      <p className="lyrics-next" />
    </div>
  );
}
