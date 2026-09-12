/** Sparks thrown from the left and right edges of a mode on hover. */
/*
 * Density matters as much as count: the delays are spread across the whole
 * flight time so the spray is continuous, which means only a fraction are
 * mid-flight at any instant. Too few and the edge looks empty between beats.
 */
const SPARKS = 44;
/** How long one spark takes to cross. Must match mode-spark in theme.css. */
const FLIGHT_SEC = 2.6;

/** Stable scatter: the same button throws the same spray every time. */
function rnd(i: number): number {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function sparkStyle(i: number): React.CSSProperties {
  const right = i % 2 === 0;
  const a = rnd(i * 3 + 1);
  const b = rnd(i * 7 + 2);
  const c = rnd(i * 11 + 5);
  // Delay gets its own draw. Sharing one with --dy tied "starts late" to
  // "drifts downward", and the spray fanned in one direction over time.
  const d = rnd(i * 17 + 9);
  return {
    left: right ? "100%" : "0%",
    top: `${10 + b * 80}%`,
    "--dx": `${(right ? 1 : -1) * (60 + a * 150)}px`,
    "--dy": `${(c - 0.5) * 110}px`,
    "--ps": `${2.5 + a * 3}px`,
    "--pd": `${(d * FLIGHT_SEC).toFixed(2)}s`,
  } as React.CSSProperties;
}

export function ModeButton({
  label,
  hint,
  onSelect,
}: {
  label: string;
  hint?: string;
  onSelect: () => void;
}) {
  return (
    <button type="button" className="mode" onClick={onSelect}>
      {label}
      {hint ? <span className="mode-hint">{hint}</span> : null}
      <span className="sparks" aria-hidden="true">
        {Array.from({ length: SPARKS }, (_, i) => (
          <i key={i} style={sparkStyle(i)} />
        ))}
      </span>
    </button>
  );
}
