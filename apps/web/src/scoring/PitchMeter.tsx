import { useEffect, useRef } from "react";
import type { MelodyFile } from "@karaoke/shared";
import { midiFromHz } from "./cents.ts";
import { melodyHzAt } from "./scoreClip.ts";
import {
  TRAIL_SEC,
  createPitchSmoothState,
  melodyRange,
  noteName,
  segmentMelody,
  smoothLivePitch,
  type NoteRun,
} from "./pitchGuide.ts";

type Props = {
  melody: MelodyFile | null;
  playheadSec: number;
  liveHz: number | null;
  liveClarity: number;
  liveRms?: number;
};

const LOOKAHEAD_SEC = 4.2;
const LOOKBEHIND_SEC = TRAIL_SEC;
const RAIL = 58;

export function PitchMeter({ melody, playheadSec, liveHz, liveClarity, liveRms = 0 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef({ melody, playheadSec, liveHz, liveClarity, liveRms });
  const runsRef = useRef<NoteRun[]>([]);
  const smoothRef = useRef(createPitchSmoothState());
  propsRef.current = { melody, playheadSec, liveHz, liveClarity, liveRms };

  useEffect(() => {
    runsRef.current = melody ? segmentMelody(melody) : [];
    smoothRef.current = createPitchSmoothState();
  }, [melody]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    const draw = () => {
      paint(canvas, ctx, wrap, propsRef.current, runsRef.current, smoothRef.current);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div ref={wrapRef} className="pitch-guide">
      <canvas ref={canvasRef} className="pitch-meter" aria-label="Pitch guide" />
    </div>
  );
}

function paint(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  wrap: HTMLDivElement,
  props: Props,
  runs: NoteRun[],
  smooth: ReturnType<typeof createPitchSmoothState>,
) {
  const cssW = Math.max(1, wrap.clientWidth);
  const cssH = Math.max(1, wrap.clientHeight);
  const dpr = window.devicePixelRatio || 1;
  const pw = Math.floor(cssW * dpr);
  const ph = Math.floor(cssH * dpr);
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw;
    canvas.height = ph;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = cssW;
  const h = cssH;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#0c0c0c";
  ctx.fillRect(0, 0, w, h);

  const { min, max } = melodyRange(runs);
  const span = Math.max(1, max - min);
  const yPad = 22;
  const yOf = (midi: number) => {
    const clamped = Math.min(max, Math.max(min, midi));
    const t = (clamped - min) / span;
    const y = h - yPad - t * (h - 2 * yPad);
    return Math.min(h - yPad, Math.max(yPad, y));
  };
  const laneH = Math.max(8, ((h - 32) / span) * 0.78);

  const tNow = props.playheadSec;
  const windowSec = LOOKAHEAD_SEC + LOOKBEHIND_SEC;
  const fieldX = RAIL + 10;
  const fieldW = w - fieldX - 12;
  const xOf = (sec: number) => fieldX + ((sec - (tNow - LOOKBEHIND_SEC)) / windowSec) * fieldW;
  const nowX = xOf(tNow);

  ctx.fillStyle = "rgba(244,239,230,0.04)";
  ctx.fillRect(0, 0, RAIL, h);

  for (let m = Math.ceil(min); m <= Math.floor(max); m++) {
    const y = yOf(m);
    ctx.strokeStyle = m % 12 === 0 ? "rgba(244,239,230,0.16)" : "rgba(244,239,230,0.06)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(RAIL, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(fieldX, 0, fieldW, h);
  ctx.clip();

  for (const run of runs) {
    if (run.endSec < tNow - LOOKBEHIND_SEC || run.startSec > tNow + LOOKAHEAD_SEC) continue;
    const x1 = xOf(run.startSec);
    const x2 = xOf(run.endSec);
    const y = yOf(run.midi);
    const rw = Math.max(6, x2 - x1);
    const rh = laneH;
    const active = tNow >= run.startSec && tNow <= run.endSec;
    const upcoming = run.startSec > tNow;
    ctx.fillStyle = active
      ? "rgba(201,162,39,0.9)"
      : upcoming
        ? "rgba(244,239,230,0.78)"
        : "rgba(244,239,230,0.28)";
    roundRect(ctx, x1, y - rh / 2, rw, rh, 4);
    ctx.fill();
    if (rw > 36) {
      ctx.fillStyle = "#070707";
      ctx.font = "600 11px Outfit, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(noteName(run.midi), x1 + 8, y + 1);
    }
  }

  const targetHz = props.melody ? melodyHzAt(props.melody, tNow) : null;
  const targetMidi = targetHz ? midiFromHz(targetHz) : null;
  const live = smoothLivePitch(smooth, {
    hz: props.liveHz,
    clarity: props.liveClarity,
    rms: props.liveRms ?? 0,
    targetMidi,
    restMidi: (min + max) / 2,
    minMidi: min,
    maxMidi: max,
    playheadSec: tNow,
    nowMs: performance.now(),
  });

  if (smooth.trail.length > 1) {
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.shadowColor = "rgba(201,162,39,0.55)";
    ctx.shadowBlur = 18;
    ctx.beginPath();
    let started = false;
    for (const p of smooth.trail) {
      const x = xOf(p.t);
      const y = yOf(p.midi);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.strokeStyle = "rgba(201,162,39,0.55)";
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.shadowBlur = 0;

    for (let i = 0; i < smooth.trail.length; i += 2) {
      const p = smooth.trail[i];
      if (!p) continue;
      const age = (tNow - p.t) / LOOKBEHIND_SEC;
      const alpha = Math.max(0, 1 - age);
      ctx.fillStyle = p.inTune
        ? `rgba(201,162,39,${0.2 + 0.65 * alpha})`
        : `rgba(244,239,230,${0.12 + 0.4 * alpha})`;
      ctx.beginPath();
      ctx.arc(xOf(p.t), yOf(p.midi), p.inTune ? 3.4 : 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();

  ctx.strokeStyle = "rgba(201,162,39,0.95)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(nowX, 8);
  ctx.lineTo(nowX, h - 8);
  ctx.stroke();

  const y = yOf(live.midi);
  ctx.save();
  ctx.globalAlpha = live.tracking ? 1 : 0.72;
  ctx.shadowColor = live.inTune ? "rgba(201,162,39,0.9)" : "rgba(244,239,230,0.35)";
  ctx.shadowBlur = live.inTune ? 22 : live.tracking ? 8 : 4;
  ctx.fillStyle = live.inTune ? "#c9a227" : "#f4efe6";
  roundRect(ctx, 8, y - 10, RAIL - 16, 20, 4);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = live.inTune ? "rgba(201,162,39,0.95)" : "rgba(244,239,230,0.75)";
  ctx.fillRect(RAIL - 2, y - 1.5, Math.max(0, nowX - (RAIL - 2)), 3);

  if (live.inTune) {
    ctx.save();
    ctx.shadowColor = "rgba(201,162,39,0.8)";
    ctx.shadowBlur = 16;
    ctx.fillStyle = "#c9a227";
    ctx.beginPath();
    ctx.arc(nowX, y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.fillStyle = "rgba(138,130,120,0.95)";
  ctx.font = "11px Outfit, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("high", 10, 8);
  ctx.textBaseline = "bottom";
  ctx.fillText("low", 10, h - 8);
  ctx.textAlign = "right";
  ctx.textBaseline = "top";
  ctx.fillText("coming up →", w - 12, 8);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}
