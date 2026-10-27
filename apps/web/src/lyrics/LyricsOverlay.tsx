import { cueAt, cueLabel, type DuetSeat } from "./duetParts.ts";
import { parseLrc, type LrcLine } from "./parseLrc.ts";
import { formatCountdown } from "../stage/formatCountdown.ts";
import { anchorLine, inLeadIn } from "./leadIn.ts";
import { lyricRows, upcomingRows, type RowView, type Rows } from "./rows.ts";

export type DuetView = {
  seat: DuetSeat | null;
  nameA: string;
  nameB: string;
};

type Props = {
  lrc: string | LrcLine[];
  currentTime: number;
  duet?: DuetView | null;
  /**
   * The clip's anchor line (song seconds). Before it, the clip is in its
   * lead-in: show "Get ready" and the line singing opens on, not whatever
   * line the lead-in happens to overlap.
   */
  singFromSec?: number | null;
};

/** A line: plain words. The per-word colour fill (wipe.ts) is off until its timing is fixed. */
function PlainLine({ line }: { line: LrcLine }) {
  return (
    <span className="lyric-line">
      {line.text.split(/\s+/).filter(Boolean).map((w, i) => (
        <span key={i} className="lyric-word">
          {w}
        </span>
      ))}
    </span>
  );
}

/**
 * Two rows, alternating, the way a noraebang screen shows lyrics. The top row
 * sits left and the bottom row right, so the eye can tell which line is next.
 */
function LyricRows({ view, activeClass = "" }: { view: Rows; activeClass?: string }) {
  const row = (r: RowView | null, i: 0 | 1) => (
    <p
      key={i}
      className={`lyric-row row-${i}${r?.state === "active" ? ` is-active ${activeClass}` : ""}`}
    >
      {r ? <PlainLine line={r.line} /> : " "}
    </p>
  );
  return <div className="lyric-rows">{[row(view.rows[0], 0), row(view.rows[1], 1)]}</div>;
}

function CountIn({ wait }: { wait: number }) {
  const beats = Math.max(1, Math.min(4, Math.ceil(wait)));
  return (
    <p className="lyrics-count" aria-hidden="true">
      {[4, 3, 2, 1].map((n) => (
        <span key={n} className={n <= beats ? "dot" : "dot spent"} />
      ))}
      <span className="count-num">{formatCountdown(wait * 1000)}</span>
    </p>
  );
}

export function LyricsOverlay({ lrc, currentTime, duet, singFromSec }: Props) {
  const lines = typeof lrc === "string" ? parseLrc(lrc) : lrc;

  if (singFromSec != null && inLeadIn(currentTime, singFromSec)) {
    const line = anchorLine(lines, singFromSec);
    const wait = (line?.timeSec ?? singFromSec) - currentTime;
    const who = duet && line ? cueLabel(line.voice, duet.seat, duet.nameA, duet.nameB) : null;
    const start = line ? lines.indexOf(line) : -1;
    return (
      <div className="lyrics lyrics-leadin">
        <p className="lyrics-cue leadin" aria-live="polite">
          Get ready · lyrics in {Math.max(1, Math.ceil(wait))}
          {who ? <span className={`leadin-who ${who.kind}`}> · {who.text}</span> : null}
        </p>
        <LyricRows view={start >= 0 ? upcomingRows(lines, start) : { rows: [null, null], activeRow: null, countIn: null }} />
        <CountIn wait={wait} />
      </div>
    );
  }

  const view = lyricRows(lines, currentTime);

  if (duet) {
    const cue = cueAt(lines, currentTime);
    const now = cueLabel(cue.voice, duet.seat, duet.nameA, duet.nameB);
    const kind = !cue.waiting && now.kind !== "wait" ? now.kind : "";
    return (
      <div className="lyrics lyrics-duet">
        <p className={`lyrics-cue ${now.kind}`}>{now.text}</p>
        <LyricRows
          view={view}
          activeClass={kind === "you" ? "duet-you" : kind === "them" ? "duet-them" : kind === "together" ? "duet-together" : ""}
        />
        {view.countIn != null ? <CountIn wait={view.countIn} /> : null}
      </div>
    );
  }

  return (
    <div className="lyrics">
      <LyricRows view={view} />
      {view.countIn != null ? <CountIn wait={view.countIn} /> : null}
    </div>
  );
}
