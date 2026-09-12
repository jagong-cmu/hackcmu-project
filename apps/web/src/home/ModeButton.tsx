/** Sparks thrown from the left and right edges of a mode on hover. */
const SPARKS = 24;

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
  return {
    left: right ? "100%" : "0%",
    top: `${12 + b * 76}%`,
    "--dx": `${(right ? 1 : -1) * (48 + a * 150)}px`,
    "--dy": `${(c - 0.5) * 96}px`,
    "--ps": `${2.5 + a * 3}px`,
    "--pd": `${(c * 0.5).toFixed(2)}s`,
  } as React.CSSProperties;
}

export function ModeButton({ label, onSelect }: { label: string; onSelect: () => void }) {
  return (
    <button type="button" className="mode" onClick={onSelect}>
      {label}
      <span className="sparks" aria-hidden="true">
        {Array.from({ length: SPARKS }, (_, i) => (
          <i key={i} style={sparkStyle(i)} />
        ))}
      </span>
    </button>
  );
}
