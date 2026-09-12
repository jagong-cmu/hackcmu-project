import "./AriaOrb.css";

type Props = {
  /** Diameter in px, or any CSS length. */
  size?: number | string;
  /**
   * Audio drive, 0..1. Feed it mic RMS (or leave it alone) — it widens the
   * bloom and lifts the halo so the orb breathes with the singer.
   */
  level?: number;
  /** A still, dimmed orb for screens where nothing is listening yet. */
  idle?: boolean;
  className?: string;
};

/**
 * Aria's face. Purely decorative: no role, hidden from assistive tech.
 */
export function AriaOrb({ size = 260, level = 0, idle = false, className }: Props) {
  const style = {
    "--aria-size": typeof size === "number" ? `${size}px` : size,
    "--aria-level": String(Math.max(0, Math.min(1, level))),
  } as React.CSSProperties;

  return (
    <div
      className={["aria-orb", idle ? "is-idle" : "", className ?? ""].filter(Boolean).join(" ")}
      style={style}
      aria-hidden="true"
    >
      <span className="aria-halo" />
      <span className="aria-glass">
        <span className="aria-body" />
        <span className="aria-band aria-band-warm" />
        <span className="aria-band aria-band-cool" />
        <span className="aria-core" />
        <span className="aria-underglow" />
        <span className="aria-rim" />
      </span>
    </div>
  );
}
