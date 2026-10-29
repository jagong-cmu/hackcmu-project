import { cueAt, cueLabel, type DuetSeat } from "./duetParts.ts";
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

/**
 * The current line with its sung part filled. LRC only times whole lines, so
 * each word's start is spread over the line's span by its share of the
 * characters: an estimate, not word timing. Keyed by line so it fades in fresh.
 */
function SungLine({ line, next, t }: { line: LrcLine; next: LrcLine | null; t: number }) {
  const end = Math.min(next?.timeSec ?? line.timeSec + MAX_LINE_SEC, line.timeSec + MAX_LINE_SEC);
  const span = Math.max(0.1, end - line.timeSec);
  const words = line.text.split(/\s+/).filter(Boolean);
  const total = words.reduce((n, w) => n + w.length, 0) || 1;
  let before = 0;
  return (
    <span className="lyric-line">
      {words.map((w, i) => {
        const lit = t >= line.timeSec + (span * before) / total;
        before += w.length;
        return (
          <span key={i} className={lit ? "lyric-word sung" : "lyric-word"}>
            {w}{" "}
          </span>
        );
      })}
    </span>
  );
}
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
      <p className="lyrics-cue leadin">
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
          key={cue.current?.timeSec ?? "wait"}
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
          {singing && cue.current ? (
            <SungLine line={cue.current} next={cue.next} t={currentTime} />
          ) : (
            <span className="lyric-line">{cue.waiting ? "·" : (cue.current?.text ?? "·")}</span>
          )}
        </p>
        {upcoming ? (
          <p key={upcoming.timeSec} className={`lyrics-next ${nextWho?.kind ?? ""}`}>
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
          <p key={next.timeSec} className="lyrics-now lyrics-soon">{next.text}</p>
          <p className="lyrics-count" aria-hidden="true">
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
        <p key={next.timeSec} className="lyrics-next">{next.text}</p>
      </div>
    );
  }

  return (
    <div className="lyrics">
      <p key={current?.timeSec ?? "none"} className="lyrics-now">
        {current ? <SungLine line={current} next={next} t={currentTime} /> : <span className="lyric-line">·</span>}
      </p>
      <p key={next?.timeSec ?? "end"} className="lyrics-next">{next?.text ?? ""}</p>
    </div>
  );
}
