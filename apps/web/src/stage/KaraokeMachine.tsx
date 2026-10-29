/**
 * The singing view as a karaoke machine: mode tabs, the machine body (LCD
 * screen with the pitch lane and lyrics, PITCH LOCK meter), score panels on
 * either side and a progress bar. Layout only: every number comes in as a prop.
 * Used by Stage (Ranked / Duet / Chaos) and, via B's Training, solo.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Mode } from "@karaoke/shared";
import { Digits } from "../ui/Digits.tsx";
import type { ScoreBits } from "../scoring/ScoreBars.tsx";
import "./machine.css";

/** The fixed stage the desktop layout is drawn at, then scaled to fit. */
const STAGE_W = 1208;
const STAGE_H = 520;
/** Matches the stacked breakpoint in machine.css. */
const STACKED_PX = 900;

const TABS: { mode: Mode; label: string }[] = [
  { mode: "ranked", label: "Ranked" },
  { mode: "duet", label: "Duet" },
  { mode: "chaos", label: "Chaos" },
];

/** Shows which mode this room is. Not navigation: the mode is fixed once seated. */
export function ModeTabs({ mode }: { mode: Mode }) {
  return (
    <nav className="km-tabs" aria-label="Mode">
      {TABS.map((t) => (
        <span key={t.mode} className={`km-tab${t.mode === mode ? " is-active" : ""}`} aria-current={t.mode === mode ? "true" : undefined}>
          <span className="t-tab">{t.label}</span>
        </span>
      ))}
    </nav>
  );
}

const BARS = 32;
const BLUE_BARS = Math.round((BARS * 2) / 3);
const LOCK_TAU_MS = 500;

/**
 * Visual only. Lit fraction eases toward `value` (0–100) with a ~500ms time
 * constant; bars are toggled through refs so the stage never re-renders for it.
 */
export function LockMeter({ value }: { value: number | null }) {
  const barsRef = useRef<HTMLSpanElement>(null);
  const shown = useRef(0);
  const target = Math.max(0, Math.min(100, value ?? 0)) / 100;

  useEffect(() => {
    const bars = barsRef.current?.children;
    if (!bars) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let last = performance.now();
    let litCount = -1;
    const step = (now: number) => {
      const k = reduced ? 1 : 1 - Math.exp(-(now - last) / LOCK_TAU_MS);
      last = now;
      shown.current += (target - shown.current) * k;
      const lit = Math.round(shown.current * BARS);
      if (lit !== litCount) {
        for (let i = 0; i < BARS; i++) bars[i]!.classList.toggle("on", i < lit);
        litCount = lit;
      }
      if (Math.abs(target - shown.current) > 0.004) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);

  return (
    <div className="km-lock" aria-hidden="true">
      <span className="km-lock-label t-label">Pitch lock</span>
      <span className="km-lock-bars" ref={barsRef}>
        {Array.from({ length: BARS }, (_, i) => (
          <i key={i} className={i < BLUE_BARS ? "b" : "r"} />
        ))}
      </span>
    </div>
  );
}

export function KaraokeMachine({
  title,
  label,
  time,
  lanes,
  lyrics,
  lock,
}: {
  title: string;
  /** Mode / section, e.g. "Ranked · Turn A". */
  label: string;
  /** "01:12 / 03:20", usually <ClipClock>. */
  time?: ReactNode;
  /** The pitch lane. Omit (Chaos) and the screen is lyrics only. */
  lanes?: ReactNode;
  lyrics: ReactNode;
  /** Accuracy 0–100 for the PITCH LOCK meter. */
  lock: number | null;
}) {
  return (
    <div className={`km-machine${lanes ? "" : " no-lanes"}`}>
      <div className="km-strip" aria-hidden="true">
        <span className="km-led on" />
        <span className="km-model t-tab">ARIA-1</span>
        <span className="km-leds">
          <span className="km-led on" />
          <span className="km-led" />
          <span className="km-led" />
        </span>
      </div>
      <div className="km-bezel">
        <div className="km-screen">
          <header className="km-screen-head">
            <div className="km-screen-id">
              <p className="km-title">{title}</p>
              <p className="km-label t-label">{label}</p>
            </div>
            {time ? <p className="km-time t-label">{time}</p> : null}
          </header>
          {lanes ? <div className="km-lanes">{lanes}</div> : null}
          <div className="km-lyrics">{lyrics}</div>
        </div>
      </div>
      <div className="km-controls">
        <span className="km-grille" aria-hidden="true" />
        <LockMeter value={lock} />
        <span className="km-jack" aria-hidden="true">
          <i />
          <span className="t-label">Mic in</span>
        </span>
        <span className="km-grille" aria-hidden="true" />
      </div>
    </div>
  );
}

export function ScorePanel({
  side,
  name,
  camera,
  card,
  combo,
  scoreLabel,
  hideScore = false,
}: {
  side: "you" | "them";
  name: string;
  camera: ReactNode;
  card: ScoreBits | null;
  combo: number | null;
  /** Duet: "Team" on the panel that carries the one shared score. */
  scoreLabel?: string;
  /** Duet: the other panel shows no score of its own. */
  hideScore?: boolean;
}) {
  const pct = (n: number | undefined) => (card && n != null ? `${Math.round(n)}%` : "--");
  return (
    <section className={`km-panel km-${side}`} aria-label={`${name} score`}>
      <div className="km-panel-in">
        <div className="km-cam">{camera}</div>
        <p className="km-name">{name}</p>
        {hideScore ? null : (
          <p className="km-score">
            {scoreLabel ? <span className="km-score-label t-label">{scoreLabel}</span> : null}
            <span className="t-score">
              <Digits value={card ? Math.round(card.overall) : "--"} />
            </span>
          </p>
        )}
        <dl className="km-stats">
          <div>
            <dt>Pitch</dt>
            <dd><Digits value={pct(card?.pitch)} /></dd>
          </div>
          <div>
            <dt>Tone</dt>
            <dd><Digits value={pct(card?.tone)} /></dd>
          </div>
        </dl>
        {combo != null ? (
          <p className="km-combo" aria-label={`Combo ${combo}`}>
            x<Digits value={combo} />
          </p>
        ) : null}
      </div>
    </section>
  );
}

/**
 * The desktop stage is a fixed 1208×520 drawing scaled to its box: 1 from
 * 1280 wide, smaller below, up to 1.25× from 1920. Under STACKED_PX it is
 * not scaled at all; CSS stacks it instead.
 */
export function MachineStage({ children }: { children: ReactNode }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const fit = () => {
      if (window.innerWidth < STACKED_PX) return setScale(1);
      const cap = window.innerWidth >= 1920 ? 1.25 : 1;
      setScale(Math.min(cap, box.clientWidth / STAGE_W, box.clientHeight / STAGE_H));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="km-fit" ref={boxRef}>
      <div className="km-stage" style={{ "--km-scale": scale } as React.CSSProperties}>
        {children}
      </div>
    </div>
  );
}
