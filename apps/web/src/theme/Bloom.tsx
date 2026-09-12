import { useEffect, useRef } from "react";

/**
 * The light field behind a page, which drifts toward the pointer.
 *
 * The two arcs move opposite ways so the light reads as parallax rather than
 * as the whole background sliding. Positions are eased toward the target in a
 * rAF loop instead of written straight from the pointer event — raw pointer
 * deltas make the bloom twitch.
 *
 * Only used on pages without live DSP (Home, Play, Settings, Leaderboard), so
 * this loop never competes with the pitch tracker.
 */
export function Bloom({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let targetX = 0;
    let targetY = 0;
    let x = 0;
    let y = 0;
    let raf = 0;

    const onMove = (e: PointerEvent) => {
      targetX = (e.clientX / window.innerWidth - 0.5) * 2;
      targetY = (e.clientY / window.innerHeight - 0.5) * 2;
    };

    const tick = () => {
      x += (targetX - x) * 0.045;
      y += (targetY - y) * 0.045;
      el.style.setProperty("--bx", x.toFixed(4));
      el.style.setProperty("--by", y.toFixed(4));
      raf = requestAnimationFrame(tick);
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    raf = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(raf);
    };
  }, []);

  // Each layer is a pair: the outer element carries the slow ambient drift, the
  // inner one the pointer parallax. They have to be separate elements because a
  // single transform can't hold a keyframe animation and a live value at once.
  return (
    <div className={["bloom", className ?? ""].filter(Boolean).join(" ")} ref={ref} aria-hidden="true">
      <div className="bloom-drift bloom-drift-a">
        <i className="bloom-arc bloom-arc-top" />
      </div>
      <div className="bloom-drift bloom-drift-b">
        <i className="bloom-arc bloom-arc-bottom" />
      </div>
      <div className="bloom-drift bloom-drift-c">
        <i className="bloom-core" />
      </div>
    </div>
  );
}
