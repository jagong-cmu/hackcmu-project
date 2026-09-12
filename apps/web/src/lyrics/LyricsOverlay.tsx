import { lineAt, parseLrc, type LrcLine } from "./parseLrc.ts";

type Props = {
  lrc: string | LrcLine[];
  currentTime: number;
};

export function LyricsOverlay({ lrc, currentTime }: Props) {
  const lines = typeof lrc === "string" ? parseLrc(lrc) : lrc;
  const { current, next } = lineAt(lines, currentTime);
  return (
    <div className="lyrics">
      <p className="lyrics-now">{current?.text ?? "·"}</p>
      <p className="lyrics-next">{next?.text ?? ""}</p>
    </div>
  );
}
