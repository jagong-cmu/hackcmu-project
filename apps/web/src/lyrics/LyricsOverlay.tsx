import { cueAt, cueLabel, type DuetSeat } from "./duetParts.ts";
import { lineAt, parseLrc, type LrcLine } from "./parseLrc.ts";

export type DuetView = {
  seat: DuetSeat | null;
  nameA: string;
  nameB: string;
};

type Props = {
  lrc: string | LrcLine[];
  currentTime: number;
  duet?: DuetView | null;
};

export function LyricsOverlay({ lrc, currentTime, duet }: Props) {
  const lines = typeof lrc === "string" ? parseLrc(lrc) : lrc;
  if (duet) {
    const cue = cueAt(lines, currentTime);
    const now = cueLabel(cue.voice, duet.seat, duet.nameA, duet.nameB);
    const shown = cue.waiting ? cue.next : cue.current;
    const upcoming = cue.waiting ? null : cue.next;
    const nextWho = upcoming
      ? cueLabel(upcoming.voice, duet.seat, duet.nameA, duet.nameB)
      : null;
    return (
      <div className="lyrics lyrics-duet">
        <p className={`lyrics-cue ${now.kind}`}>{now.text}</p>
        <p
          className={[
            "lyrics-now",
            cue.waiting || now.kind === "wait" ? "lyrics-soon" : "",
            now.kind === "you" ? "duet-you" : "",
            now.kind === "them" ? "duet-them" : "",
            now.kind === "together" ? "duet-together" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {shown?.text ?? "·"}
        </p>
        {upcoming ? (
          <p className={`lyrics-next ${nextWho?.kind ?? ""}`}>
            <span className="who">{nextWho?.text}</span>
            <span className="next-line">{upcoming.text}</span>
          </p>
        ) : cue.waiting ? (
          <p className="lyrics-next">coming up</p>
        ) : (
          <p className="lyrics-next" />
        )}
      </div>
    );
  }

  const { current, next } = lineAt(lines, currentTime);
  const waiting = !current && Boolean(next);
  return (
    <div className="lyrics">
      <p className={waiting ? "lyrics-now lyrics-soon" : "lyrics-now"}>
        {current?.text ?? next?.text ?? "·"}
      </p>
      <p className="lyrics-next">{waiting ? "coming up" : (next?.text ?? "")}</p>
    </div>
  );
}
