import "./AriaOrb.css";

type Props = {
  /** Diameter in px, or any CSS length. */
  size?: number | string;
  /**
   * Audio drive, 0..1. Feed it mic RMS (or leave it alone) — it brightens the
   * corona and widens the bloom so the orb breathes with the singer.
   */
  level?: number;
  /** A still, dimmed orb for screens where nothing is listening yet. */
  idle?: boolean;
  className?: string;
};

/**
 * Aria's face: an eclipse. Purely decorative, hidden from assistive tech.
 */
export function AriaOrb({ size = 300, level = 0, idle = false, className }: Props) {
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
      <span className="aria-corona" />
      <span className="aria-body" />
      <span className="aria-crescent" />
      <span className="aria-rim" />
    </div>
  );
}
