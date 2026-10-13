import { cueAt, cueLabel, type DuetSeat } from "./duetParts.ts";
import { LyricSparks } from "./LyricSparks.tsx";
import { lineAt, parseLrc, type LrcLine } from "./parseLrc.ts";
import { formatCountdown } from "../stage/formatCountdown.ts";
import { anchorLine, inLeadIn } from "./leadIn.ts";

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

/** A line stays on screen for its own span, but never longer than this. */
const MAX_LINE_SEC = 7;
/** How early the count-in appears before the next line. */
const COUNTDOWN_SEC = 4;
function LeadIn({
  line,
  wait,
  who,
}: {
  line: LrcLine | null;
  wait: number;
  who: { text: string; kind: string } | null;
}) {
  const beats = Math.max(1, Math.min(4, Math.ceil(wait)));
  return (
    <div className="lyrics lyrics-leadin">
      <p className="lyrics-cue leadin" aria-live="polite">
        Get ready · lyrics in {Math.max(1, Math.ceil(wait))}
      </p>
      <p className="lyrics-now lyrics-soon">
        {who ? <span className={`leadin-who ${who.kind}`}>{who.text} · </span> : null}
        {line?.text ?? "·"}
      </p>
      <p className="lyrics-count" aria-hidden="true">
        {[4, 3, 2, 1].map((n) => (
          <span key={n} className={n <= beats ? "dot" : "dot spent"} />
        ))}
        <span className="count-num">{formatCountdown(wait * 1000)}</span>
      </p>
    </div>
  );
}

export function LyricsOverlay({ lrc, currentTime, duet, singFromSec }: Props) {
  const lines = typeof lrc === "string" ? parseLrc(lrc) : lrc;
  if (singFromSec != null && inLeadIn(currentTime, singFromSec)) {
    const line = anchorLine(lines, singFromSec);
    const who = duet && line ? cueLabel(line.voice, duet.seat, duet.nameA, duet.nameB) : null;
    return <LeadIn line={line} wait={(line?.timeSec ?? singFromSec) - currentTime} who={who} />;
  }
  if (duet) {
    const cue = cueAt(lines, currentTime);
    const now = cueLabel(cue.voice, duet.seat, duet.nameA, duet.nameB);
    const upcoming = cue.next;
    const nextWho = upcoming
      ? cueLabel(upcoming.voice, duet.seat, duet.nameA, duet.nameB)
      : null;
    const singing = !cue.waiting && now.kind !== "wait";
    return (
      <div className="lyrics lyrics-duet">
        <p className={`lyrics-cue ${now.kind}`}>{now.text}</p>
        <p
          className={[
            "lyrics-now",
            cue.waiting || now.kind === "wait" ? "lyrics-soon" : "",
            !cue.waiting && now.kind === "you" ? "duet-you" : "",
            !cue.waiting && now.kind === "them" ? "duet-them" : "",
            !cue.waiting && now.kind === "together" ? "duet-together" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <span className="lyric-line">
            {cue.waiting ? "·" : (cue.current?.text ?? "·")}
            {singing && cue.current ? <LyricSparks key={cue.current.timeSec} /> : null}
          </span>
        </p>
        {upcoming ? (
          <p className={`lyrics-next ${nextWho?.kind ?? ""}`}>
            <span className="who">{nextWho?.text}</span>
            <span className="next-line">{upcoming.text}</span>
          </p>
        ) : (
          <p className="lyrics-next" />
        )}
      </div>
    );
  }

  const { current, next } = lineAt(lines, currentTime);

  // lineAt keeps `current` set for the rest of the song, so a line would sit
  // there through an instrumental break. Treat a line as spent once its own
  // span is up, and count the singer back in instead of leaving it stale.
  const lineEnd = current
    ? Math.min(next?.timeSec ?? current.timeSec + MAX_LINE_SEC, current.timeSec + MAX_LINE_SEC)
    : 0;
  const inGap = Boolean(next) && (!current || currentTime >= lineEnd);

  if (inGap && next) {
    const wait = next.timeSec - currentTime;
    if (wait <= COUNTDOWN_SEC) {
      const beats = Math.max(1, Math.ceil(wait));
      return (
        <div className="lyrics">
          <p className="lyrics-now lyrics-soon">{next.text}</p>
          <p className="lyrics-count" aria-live="off">
            {[4, 3, 2, 1].map((n) => (
              <span key={n} className={n <= beats ? "dot" : "dot spent"} />
            ))}
            <span className="count-num">{formatCountdown(wait * 1000)}</span>
          </p>
        </div>
      );
    }
    return (
      <div className="lyrics">
        <p className="lyrics-rest">♪</p>
        <p className="lyrics-next">{next.text}</p>
      </div>
    );
  }

  return (
    <div className="lyrics">
      <p className="lyrics-now">
        <span className="lyric-line">
          {current?.text ?? "·"}
          {current ? <LyricSparks key={current.timeSec} /> : null}
        </span>
      </p>
      <p className="lyrics-next">{next?.text ?? ""}</p>
    </div>
  );
}
