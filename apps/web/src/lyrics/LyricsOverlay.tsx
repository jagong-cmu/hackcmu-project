import { useMemo, type CSSProperties } from "react";
import { cueAt, cueLabel, type DuetSeat } from "./duetParts.ts";
import { lineAt, parseLrc, type LrcLine } from "./parseLrc.ts";
import { formatCountdown } from "../stage/formatCountdown.ts";
import { Digits } from "../ui/Digits.tsx";
import { anchorLine, inLeadIn } from "./leadIn.ts";
import { retimeLines, wordProgress, wordsByLine, type TimedWord, type WordsFile } from "./words.ts";
import { lyricClockDebug } from "./lyricClock.ts";

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
  /** The song's words.json: word-by-word highlight. Without it, lines are estimated. */
  words?: WordsFile | null;
};

type ShownLine = LrcLine & { words?: TimedWord[] };

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A line stays on screen for its own span, but never longer than this. */
const MAX_LINE_SEC = 7;
/** How early the count-in appears before the next line. */
const COUNTDOWN_SEC = 4;

/**
 * The current line with its sung part filled. With word timings, sung words
 * are lit, the current word fills through its own time (note by note when it
 * is held over several), and later words stay dim. Without them, LRC only
 * times whole lines, so each word's start is spread over the line's span by
 * its share of the characters: an estimate. Keyed by line so it fades in fresh.
 */
function SungLine({ line, next, t }: { line: ShownLine; next: LrcLine | null; t: number }) {
  if (line.words) {
    const instant = reducedMotion();
    return (
      <span className="lyric-line">
        {line.words.map((w, i) => {
          const p = instant ? (t >= w.start ? 1 : 0) : wordProgress(w, t);
          return (
            <span key={i}>
              <span
                className={p >= 1 ? "lyric-word sung" : p > 0 ? "lyric-word filling" : "lyric-word"}
                style={p > 0 && p < 1 ? ({ "--p": p } as CSSProperties) : undefined}
              >
                {w.text}
              </span>{" "}
            </span>
          );
        })}
      </span>
    );
  }
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
        Get ready · lyrics in <Digits value={Math.max(1, Math.ceil(wait))} />
      </p>
      <p className="lyrics-now lyrics-soon">
        {who ? <span className={`leadin-who ${who.kind}`}>{who.text} · </span> : null}
        {line?.text ?? "·"}
      </p>
      <p className="lyrics-count" aria-hidden="true">
        {[4, 3, 2, 1].map((n) => (
          <span key={n} className={n <= beats ? "dot" : "dot spent"} />
        ))}
        <span className="count-num"><Digits value={formatCountdown(wait * 1000)} /></span>
      </p>
    </div>
  );
}

export function LyricsOverlay({ lrc, currentTime, duet, singFromSec, words }: Props) {
  const lines = useMemo(() => (typeof lrc === "string" ? parseLrc(lrc) : lrc), [lrc]);
  // Timed lines switch a beat before their first word, so the singer reads ahead.
  const shown: ShownLine[] = useMemo(() => {
    const byLine = wordsByLine(lines, words ?? null);
    return retimeLines(lines, byLine).map((l, i) => (byLine?.[i] ? { ...l, words: byLine[i]! } : l));
  }, [lines, words]);
  const debug = import.meta.env.DEV && new URLSearchParams(location.search).has("lyricdebug");
  return (
    <>
      <LyricsView lines={lines} shown={shown} currentTime={currentTime} duet={duet} singFromSec={singFromSec} />
      {debug ? <LyricDebug lines={shown} t={currentTime} /> : null}
    </>
  );
}

/** Dev only (?lyricdebug): the word being sung, when it should start, and the clock behind it. */
function LyricDebug({ lines, t }: { lines: ShownLine[]; t: number }) {
  const words = lines.flatMap((l) => l.words ?? []);
  const w = words.filter((x) => x.start <= t).at(-1) ?? words[0];
  const { audioSec, latencySec, offsetMs } = lyricClockDebug;
  const ms = (s: number) => `${(s * 1000).toFixed(0)} ms`;
  return (
    <pre className="lyric-debug">
      {w ? `word    ${w.text}\nstart   ${w.start.toFixed(3)} s (${ms(t - w.start)} in)\n` : "no word timings\n"}
      {`audio   ${audioSec.toFixed(3)} s\nlatency ${ms(latencySec)}\noffset  ${offsetMs} ms\nlyric t ${t.toFixed(3)} s`}
    </pre>
  );
}

function LyricsView({
  lines,
  shown,
  currentTime,
  duet,
  singFromSec,
}: Omit<Props, "lrc" | "words"> & { lines: LrcLine[]; shown: ShownLine[] }) {
  if (singFromSec != null && inLeadIn(currentTime, singFromSec)) {
    const line = anchorLine(lines, singFromSec);
    const who = duet && line ? cueLabel(line.voice, duet.seat, duet.nameA, duet.nameB) : null;
    return <LeadIn line={line} wait={(line?.timeSec ?? singFromSec) - currentTime} who={who} />;
  }
  if (duet) {
    const cue = cueAt(shown, currentTime);
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
            <SungLine line={cue.current as ShownLine} next={cue.next} t={currentTime} />
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

  const { current, next } = lineAt(shown, currentTime);

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
            <span className="count-num"><Digits value={formatCountdown(wait * 1000)} /></span>
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
