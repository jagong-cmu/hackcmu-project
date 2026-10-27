import { useEffect, useRef } from "react";
import { IdleLevel, initialFilter, lightParams, stepIntensity } from "./intensity.ts";
import { TvGlow, type RoomId } from "./rooms.ts";
import { readSignal } from "./signal.ts";

const SPOTS = 8;
const TAU = Math.PI * 2;
/** data-room-intensity is for tests and tooling; update it at most this often. */
const AttrEveryMs = 250;

/**
 * The reactive light layer: disco-ball spots, an edge warmth, and the TV glow,
 * all driven by one smoothed intensity (0..1) read from the signal store.
 *
 * It lives outside React's render loop on purpose: one requestAnimationFrame
 * loop writes CSS variables and transforms straight to the DOM, so a take can
 * run at 60fps without a single re-render. The layer is masked to the edges of
 * the screen, so nothing behind the lyrics or the faces ever changes
 * brightness. Under prefers-reduced-motion the spots stay put and intensity
 * shows only as a slow brightness fade.
 */
export function Light({ room }: { room: RoomId }) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const spots = Array.from(el.querySelectorAll<HTMLElement>(".scene-spot"));
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = mq.matches;
    const onMq = () => {
      reduced = mq.matches;
    };
    mq.addEventListener("change", onMq);

    let filter = initialFilter(IdleLevel);
    let shown = filter.value; // extra slow low-pass for reduced motion
    const phase = spots.map((_, i) => (i / SPOTS) * TAU);
    const ring = spots.map((_, i) => 0.92 + ((i * 37) % 11) / 100); // keep them out at the edges
    const dir = spots.map((_, i) => (i % 2 === 0 ? 1 : -1) * (0.7 + (i % 3) * 0.25));

    // The area behind the lyrics and the faces never changes brightness. Measure the
    // stage's lyric rows and feeds a few times a second (never per frame) and cut that
    // rectangle out of the layer, whatever the screen size.
    const hole = () => {
      const rects = Array.from(document.querySelectorAll(".lyrics, .tile")).map((n) => n.getBoundingClientRect());
      const live = rects.filter((r) => r.width > 0 && r.height > 0);
      if (!live.length) {
        for (const k of ["hx0", "hx1", "hy0", "hy1"]) el.style.setProperty(`--${k}`, "-9999px"); // no hole: everything lit
        return;
      }
      const pad = 16;
      el.style.setProperty("--hx0", `${Math.max(0, Math.min(...live.map((r) => r.left)) - pad)}px`);
      el.style.setProperty("--hx1", `${Math.max(...live.map((r) => r.right)) + pad}px`);
      el.style.setProperty("--hy0", `${Math.max(0, Math.min(...live.map((r) => r.top)) - pad)}px`);
      el.style.setProperty("--hy1", `${Math.max(...live.map((r) => r.bottom)) + pad}px`);
    };
    hole();
    const holeTimer = window.setInterval(hole, 300);
    window.addEventListener("resize", hole);

    let last = performance.now();
    let lastAttr = 0;
    let lastAttrValue = -1;
    let raf = 0;

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(64, now - last);
      last = now;

      const sig = readSignal(now);
      filter = stepIntensity(filter, sig.kind === "idle" ? IdleLevel : sig.value, dt);
      let v = filter.value;
      if (reduced) {
        shown += (v - shown) * (1 - Math.exp(-dt / 1500));
        v = shown;
      }
      const p = lightParams(v);

      el.style.setProperty("--lb", p.brightness.toFixed(3));
      el.style.setProperty("--ltv", p.tvGlow.toFixed(3));

      for (let i = 0; i < spots.length; i++) {
        if (!reduced) phase[i] += p.spotSpeed * dir[i] * (dt / 1000);
        const a = reduced ? (i / SPOTS) * TAU : phase[i];
        const x = 50 + 52 * ring[i] * Math.cos(a);
        const y = 50 + 50 * ring[i] * Math.sin(a);
        spots[i].style.transform = `translate3d(${x}vw, ${y}vh, 0)`;
        spots[i].style.opacity = i < p.spotCount ? (0.22 + 0.5 * p.brightness).toFixed(3) : "0";
      }

      if (now - lastAttr >= AttrEveryMs && Math.abs(v - lastAttrValue) >= 0.02) {
        lastAttr = now;
        lastAttrValue = v;
        el.dataset.roomIntensity = v.toFixed(2);
        el.dataset.roomSignal = sig.kind;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(holeTimer);
      window.removeEventListener("resize", hole);
      mq.removeEventListener("change", onMq);
    };
  }, []);

  const tv = TvGlow[room];
  return (
    <div
      ref={root}
      className="scene-light"
      data-room-intensity={IdleLevel.toFixed(2)}
      style={{ "--tvx": `${tv.x}%`, "--tvy": `${tv.y}%`, "--tvs": `${tv.size}vmin` } as React.CSSProperties}
    >
      <div className="scene-light-hole">
        <div className="scene-warmth" />
        <div className="scene-tv" />
        {Array.from({ length: SPOTS }, (_, i) => (
          <div key={i} className={`scene-spot spot-${(i % 5) + 1}`} />
        ))}
      </div>
    </div>
  );
}
