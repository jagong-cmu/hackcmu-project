import { lineAt, parseLrc, type LrcLine } from "./parseLrc.ts";

type Props = {
  lrc: string | LrcLine[];
  currentTime: number;
};

export function LyricsOverlay({ lrc, currentTime }: Props) {
  const lines = typeof lrc === "string" ? parseLrc(lrc) : lrc;
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
