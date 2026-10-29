import { useEffect, useRef } from "react";
import { Images } from "../ui/assets.ts";

/** `start` is the subject's left edge as a fraction of the width; homeMenu.css sizes the layer from it. */
type Hero = { src: string; srcSet: string; start: number };
const hero = (x1: string, x2: string, start: number): Hero => ({ src: x1, srcSet: `${x1} 1600w, ${x2} 2752w`, start });

const S = Images.heroSubjectStart;
const HOME = hero(Images.heroHome1x, Images.heroHome, S.home);
const HEROES: Record<string, Hero> = {
  ranked: hero(Images.heroRanked1x, Images.heroRanked, S.ranked),
  duet: hero(Images.heroDuet1x, Images.heroDuet, S.duet),
  training: hero(Images.heroTraining1x, Images.heroTraining, S.training),
  chaos: hero(Images.heroChaos1x, Images.heroChaos, S.chaos),
  room: hero(Images.heroRoom1x, Images.heroRoom, S.room),
  leaderboard: hero(Images.heroLeaderboard1x, Images.heroLeaderboard, S.leaderboard),
  settings: hero(Images.heroSettings1x, Images.heroSettings, S.settings),
};
const setStart = (el: HTMLImageElement, h: Hero) => el.style.setProperty("--start", String(h.start));
// The image is at most full viewport height, so it is drawn at most 179vh wide (1600/893).
const SIZES = "(max-width: 899px) 100vw, 179vh";
const DEBOUNCE_MS = 120;

/** Below 900px the hero is a dim backdrop: always hero-home, nothing else loaded. */
const wide = () => matchMedia("(min-width: 900px)").matches;
const heroFor = (id: string | undefined) => (wide() && id && HEROES[id]) || HOME;

/** One decode per hero per page load. A file that fails resolves to hero-home. */
const loads = new Map<Hero, Promise<Hero>>();
let warmed = false;
function load(h: Hero, priority: "auto" | "low" = "auto"): Promise<Hero> {
  let p = loads.get(h);
  if (!p) {
    const img = new Image();
    img.fetchPriority = priority;
    img.sizes = SIZES;
    img.srcset = h.srcSet;
    img.src = h.src;
    p = img.decode().then(
      () => h,
      () => (h === HOME ? Promise.reject(new Error("hero-home missing")) : load(HOME)),
    );
    loads.set(h, p);
  }
  return p;
}

/**
 * Right-side hero that follows the menu selection. Two stacked layers: the
 * next image is decoded into the hidden one, raised, and faded in over the
 * old one, so there is never an empty frame. A new selection mid-fade reverses
 * it (if you went back) or waits for it and then fades once to the latest.
 */
export function HomeHero({ id }: { id: string | undefined }) {
  const refs = [useRef<HTMLImageElement>(null), useRef<HTMLImageElement>(null)];
  const initial = useRef(heroFor(id)).current;
  const ctl = useRef<{ want: (h: Hero) => void; failed: () => void } | null>(null);

  useEffect(() => {
    const imgs = refs.map((r) => r.current!);
    const shown: [Hero | null, Hero | null] = [initial, null];
    let front = 0;
    let target = initial;
    let anim: Animation | null = null;
    let out: Animation | null = null;
    let busy = false;

    async function pump() {
      if (busy) return;
      busy = true;
      try {
        for (;;) {
          const t = target;
          const h = await load(t);
          if (t !== target) continue; // selection moved on while loading
          if (h === shown[front]) break;
          const back = 1 - front;
          const el = imgs[back]!;
          if (shown[back] !== h) {
            el.srcset = h.srcSet;
            el.src = h.src;
            setStart(el, h);
            shown[back] = h;
            await el.decode().catch(() => {});
            if (t !== target) continue;
          }
          el.hidden = false;
          el.style.zIndex = "1";
          const old = imgs[front]!;
          old.style.zIndex = "0";
          front = back;
          const css = getComputedStyle(el);
          const ms = parseFloat(css.getPropertyValue("--dur-slow")) || 0; // 0 under reduced motion
          if (ms) {
            // The old layer fades out too: layers can differ in size, so the new one may not cover it.
            const opts = { duration: ms, easing: css.getPropertyValue("--ease").trim() || "ease" };
            anim = el.animate([{ opacity: 0 }, { opacity: 1 }], { ...opts, fill: "backwards" });
            out = old.animate([{ opacity: 1 }, { opacity: 0 }], { ...opts, fill: "forwards" });
            await anim.finished.catch(() => {});
            if (anim.playbackRate < 0) {
              // Reversed back to zero: the layer underneath is the front again.
              el.style.zIndex = "0";
              old.style.zIndex = "1";
              front = 1 - front;
            }
            anim.cancel();
            out.cancel();
            anim = out = null;
          }
          imgs[1 - front]!.hidden = true;
        }
      } catch {
        /* hero-home itself is missing: keep whatever is showing */
      } finally {
        busy = false;
      }
    }

    ctl.current = {
      want(h) {
        target = h;
        // Mid-fade: going back to the image underneath reverses the fade; returning to the incoming one resumes it.
        if (anim && (h === shown[1 - front]) === anim.playbackRate > 0 && (h === shown[1 - front] || h === shown[front])) {
          anim.reverse();
          out?.reverse();
        }
        void pump();
      },
      failed() {
        // The initial file is missing: fall back to hero-home, or show nothing if that is missing too.
        const el = imgs[0]!;
        if (shown[0] === HOME) el.hidden = true;
        else {
          shown[0] = HOME;
          el.srcset = HOME.srcSet;
          el.src = HOME.src;
          setStart(el, HOME);
        }
      },
    };
    return () => {
      anim?.cancel();
      out?.cancel();
      ctl.current = null;
    };
    // Set up once; the layers are driven imperatively from here on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setTimeout(() => ctl.current?.want(heroFor(id)), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [id]);

  return (
    <div className="home-hero" aria-hidden="true">
      <img
        ref={refs[0]}
        src={initial.src}
        srcSet={initial.srcSet}
        sizes={SIZES}
        width={1600}
        height={893}
        alt=""
        // React 18 doesn't know fetchPriority; the lowercase attribute passes straight through.
        {...{ fetchpriority: "high" }}
        style={{ zIndex: 1, "--start": initial.start } as React.CSSProperties}
        onLoad={() => {
          if (warmed) return;
          warmed = true;
          // Only now warm the others, at low priority, so they never compete with the first image.
          if (wide()) for (const h of [HOME, ...Object.values(HEROES)]) void load(h, "low").catch(() => {});
        }}
        onError={() => ctl.current?.failed()}
      />
      <img ref={refs[1]} sizes={SIZES} width={1600} height={893} alt="" hidden />
    </div>
  );
}
