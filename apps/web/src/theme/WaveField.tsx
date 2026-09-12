/**
 * Training's take on the bloom: the same blue light, shaped as a waveform.
 *
 * Pure CSS. Training runs the pitch tracker every frame, so the background
 * gets no rAF loop and no pointer parallax — unlike Bloom on the browsing
 * pages, which can afford one.
 */
const BARS = 72;

/** Stable profile: the field looks the same every visit. */
function rnd(i: number): number {
  const x = Math.sin(i * 41.77 + 7.31) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * An envelope that swells toward the middle, so the field reads as one sustained
 * phrase rather than noise. The jitter on top keeps it from looking like a plot.
 */
function barStyle(i: number): React.CSSProperties {
  const t = i / (BARS - 1);
  const envelope = Math.sin(Math.PI * t) ** 0.7;
  const detail = 0.45 + 0.55 * rnd(i);
  const height = Math.max(4, envelope * detail * 100);
  return {
    "--h": `${height.toFixed(1)}%`,
    "--bd": `${(rnd(i * 5 + 3) * 3.4).toFixed(2)}s`,
    "--bs": `${(2.6 + rnd(i * 9 + 2) * 2.4).toFixed(2)}s`,
  } as React.CSSProperties;
}

export function WaveField() {
  return (
    <div className="wavefield" aria-hidden="true">
      <div className="wavefield-glow" />
      <div className="wavefield-bars">
        {Array.from({ length: BARS }, (_, i) => (
          <i key={i} style={barStyle(i)} />
        ))}
      </div>
      <div className="wavefield-core" />
    </div>
  );
}
