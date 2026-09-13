/**
 * Sparks thrown off the dropped score, same language as lyric sparks:
 * CSS-only particles so the reveal doesn't steal the main thread.
 */
const FLIGHT_SEC = 1.35;

function rnd(i: number): number {
  const x = Math.sin(i * 78.233 + 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function sparkStyle(i: number, count: number): React.CSSProperties {
  const a = rnd(i * 3 + 1);
  const b = rnd(i * 7 + 2);
  const c = rnd(i * 13 + 4);
  const d = rnd(i * 17 + 9);
  const ang = ((i / count) * 360 + a * 24) * (Math.PI / 180);
  const dist = 70 + b * 130;
  return {
    left: "50%",
    top: "50%",
    "--dx": `${Math.cos(ang) * dist}px`,
    "--dy": `${Math.sin(ang) * dist}px`,
    "--ps": `${2.4 + c * 3.4}px`,
    "--pd": `${(d * 0.28).toFixed(2)}s`,
  } as React.CSSProperties;
}

export function ScoreBurst({ count = 28 }: { count?: number }) {
  return (
    <span className="score-burst" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <i key={i} style={sparkStyle(i, count)} />
      ))}
    </span>
  );
}

export { FLIGHT_SEC as SCORE_BURST_SEC };
