/**
 * Light thrown off the left and right edges of the active lyric line.
 *
 * Must be rendered inside .lyric-line — an inline-block that hugs the text —
 * not the full-width <p>. Anchored to the paragraph the sparks would fly off
 * the edges of the screen instead of the words, since lyric lines are centred
 * and rarely fill the column.
 *
 * Rendered once and animated by CSS, like the mode sparks on Home: these sit
 * on Training and the stage, where a per-frame JS loop is already running the
 * pitch tracker and must not share the main thread with decoration.
 *
 * Remount with a key tied to the line so each new line throws a fresh burst.
 */
/* Delays are spread across the whole flight, so only a fraction are airborne
 * at any instant — density has to carry it. */
const SPARKS = 30;
/** One spark's flight. Must match lyric-spark in theme.css. */
const FLIGHT_SEC = 2.2;

function rnd(i: number): number {
  const x = Math.sin(i * 78.233 + 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function sparkStyle(i: number): React.CSSProperties {
  const right = i % 2 === 0;
  const a = rnd(i * 3 + 1);
  const b = rnd(i * 7 + 2);
  const c = rnd(i * 13 + 4);
  // Delay gets its own draw: sharing one with --dy tied "starts late" to
  // "drifts up", which fanned the spray one way over time.
  const d = rnd(i * 17 + 9);
  return {
    left: right ? "100%" : "0%",
    top: `${14 + b * 72}%`,
    "--dx": `${(right ? 1 : -1) * (30 + a * 120)}px`,
    "--dy": `${(c - 0.5) * 84}px`,
    "--ps": `${2.2 + a * 3}px`,
    "--pd": `${(d * FLIGHT_SEC).toFixed(2)}s`,
  } as React.CSSProperties;
}

export function LyricSparks() {
  return (
    <span className="lyric-sparks" aria-hidden="true">
      {Array.from({ length: SPARKS }, (_, i) => (
        <i key={i} style={sparkStyle(i)} />
      ))}
    </span>
  );
}
