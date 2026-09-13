import { useEffect, useState } from "react";

export function useCountUp(target: number, play: boolean, durationMs = 1100): number {
  const goal = Math.max(0, Math.min(100, Math.round(target)));
  const [n, setN] = useState(play ? 0 : goal);

  useEffect(() => {
    if (!play) {
      setN(goal);
      return;
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setN(goal);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - (1 - t) ** 3;
      setN(Math.round(goal * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [goal, play, durationMs]);

  return n;
}
