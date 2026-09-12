/**
 * Light lifting off the active lyric line.
 *
 * Rendered once and animated by CSS, like the mode sparks on Home — these sit
 * on Training and the stage, where a per-frame JS loop is already running the
 * pitch tracker and must not share the main thread with decoration.
 *
 * Remount it with a key tied to the line so each new line throws a fresh burst.
 */
/* Delays are spread across the whole flight, so only a fraction are airborne
 * at any instant — density has to carry it. */
const SPARKS = 36;
/** One spark's flight. Must match lyric-spark in theme.css. */
const FLIGHT_SEC = 2.2;

function rnd(i: number): number {
  const x = Math.sin(i * 78.233 + 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function sparkStyle(i: number): React.CSSProperties {
  const a = rnd(i * 3 + 1);
  const b = rnd(i * 7 + 2);
  const c = rnd(i * 13 + 4);
  return {
    // Spread across the line's width, drifting up and slightly outward.
    left: `${6 + b * 88}%`,
    "--dx": `${(a - 0.5) * 90}px`,
    "--dy": `${-46 - c * 86}px`,
    "--ps": `${2.4 + a * 3.4}px`,
    "--pd": `${(c * FLIGHT_SEC).toFixed(2)}s`,
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
