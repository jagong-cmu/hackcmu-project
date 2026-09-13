import { useEffect, useRef } from "react";
import { palette, pitchColor } from "../theme/palette.ts";
import type { MelodyFile } from "@karaoke/shared";
import { midiFromHz } from "./cents.ts";
import { melodyHzAt } from "./scoreClip.ts";
import {
  TRAIL_SEC,
  createPitchSmoothState,
  segmentMelody,
  smoothLivePitch,
  windowedMelodyRange,
  type NoteRun,
} from "./pitchGuide.ts";

type Props = {
  melody: MelodyFile | null;
  playheadSec: number;
  liveHz: number | null;
  liveClarity: number;
  liveRms?: number;
};

const LOOKAHEAD_SEC = 2.0;
const LOOKBEHIND_SEC = TRAIL_SEC;
/** Vertical camera follows a shorter window so upcoming leaps don't squash live travel. */
const VIEW_BEHIND_SEC = 0.45;
const VIEW_AHEAD_SEC = 0.85;
const RAIL = 78;

export function PitchMeter({ melody, playheadSec, liveHz, liveClarity, liveRms = 0 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef({ melody, playheadSec, liveHz, liveClarity, liveRms });
  const runsRef = useRef<NoteRun[]>([]);
  const smoothRef = useRef(createPitchSmoothState());
  const viewRef = useRef({ min: 52, max: 62 });
  propsRef.current = { melody, playheadSec, liveHz, liveClarity, liveRms };

  useEffect(() => {
    runsRef.current = melody ? segmentMelody(melody) : [];
    smoothRef.current = createPitchSmoothState();
    const r = windowedMelodyRange(runsRef.current, 0, VIEW_BEHIND_SEC, VIEW_AHEAD_SEC);
    viewRef.current = { min: r.min, max: r.max };
  }, [melody]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    const draw = () => {
      paint(canvas, ctx, wrap, propsRef.current, runsRef.current, smoothRef.current, viewRef.current);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div ref={wrapRef} className="pitch-guide">
      <canvas
        ref={canvasRef}
        className="pitch-meter"
        aria-label="Pitch guide"
        draggable={false}
      />
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
  viewRef: { min: number; max: number },
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
  const pal = palette();
  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, w, h);

  const tNow = props.playheadSec;
  // Zoom onto notes in frame so live pitch travel fills the staff. Edges ease
  // so a sudden leap does not jump the camera.
  const tune = windowedMelodyRange(runs, tNow, VIEW_BEHIND_SEC, VIEW_AHEAD_SEC, smooth.midi);
  const view = viewRef;
  view.min += (tune.min - view.min) * 0.14;
  view.max += (tune.max - view.max) * 0.14;
  const min = view.min;
  const max = view.max;
  const span = Math.max(1, max - min);
  const yPad = Math.max(8, Math.min(14, h * 0.09));
  const yOf = (midi: number) => {
    const t = (midi - min) / span;
    const y = h - yPad - t * (h - 2 * yPad);
    return Math.min(h - 4, Math.max(4, y));
  };
  const laneH = Math.max(18, Math.min(h * 0.28, ((h - 48) / span) * 0.78));
  const voiceW = Math.max(14, Math.round(h * 0.065));
  const headR = Math.max(10, Math.round(h * 0.045));

  const windowSec = LOOKAHEAD_SEC + LOOKBEHIND_SEC;
  const fieldX = RAIL + 10;
  const fieldW = w - fieldX - 12;
  const xOf = (sec: number) => fieldX + ((sec - (tNow - LOOKBEHIND_SEC)) / windowSec) * fieldW;
  const nowX = xOf(tNow);

  ctx.fillStyle = pal.ink(0.04);
  ctx.fillRect(0, 0, RAIL, h);

  for (let m = Math.ceil(min); m <= Math.floor(max); m++) {
    const y = yOf(m);
    ctx.strokeStyle = m % 12 === 0 ? pal.ink(0.16) : pal.ink(0.06);
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
      ? pitchColor(run.midi, 0.92)
      : upcoming
        ? pal.ink(0.78)
        : pal.ink(0.28);
    roundRect(ctx, x1, y - rh / 2, rw, rh, Math.min(8, rh / 2));
    ctx.fill();
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

  // Stretch live travel around the target so small pitch/tone wobble reads.
  const around = targetMidi ?? (min + max) / 2;
  const liveYOf = (midi: number) => yOf(around + (midi - around) * 1.45);

  // The head marker rides the smoothed curve so the two cannot disagree.
  let headY: number | null = null;

  if (smooth.trail.length > 1) {
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    const voiceHue = pitchColor(Math.round(live.midi), 0.95);
    ctx.shadowColor = pitchColor(Math.round(live.midi), 0.7);
    ctx.shadowBlur = 26;
    // Rolling average over the trail, then a quadratic through the midpoints.
    // Straight segments between per-frame samples read as a jagged sawtooth
    // even when the pitch itself is steady.
    const n = smooth.trail.length;
    const avg = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      let count = 0;
      for (let j = Math.max(0, i - 3); j <= Math.min(n - 1, i + 3); j++) {
        const q = smooth.trail[j];
        if (!q) continue;
        sum += q.midi;
        count++;
      }
      avg[i] = count ? sum / count : (smooth.trail[i]?.midi ?? 0);
    }
    if (n > 0) headY = liveYOf(avg[n - 1]!);

    const pts: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < n; i++) {
      const p = smooth.trail[i];
      if (!p) continue;
      const x = xOf(p.t);
      const prev = pts[pts.length - 1];
      if (prev && Math.abs(x - prev.x) < 0.75) continue;
      pts.push({ x, y: liveYOf(avg[i]!) });
    }

    ctx.beginPath();
    if (pts.length === 1) {
      ctx.moveTo(pts[0]!.x, pts[0]!.y);
    } else if (pts.length > 1) {
      ctx.moveTo(pts[0]!.x, pts[0]!.y);
      for (let i = 1; i < pts.length - 1; i++) {
        const a = pts[i]!;
        const b = pts[i + 1]!;
        ctx.quadraticCurveTo(a.x, a.y, (a.x + b.x) / 2, (a.y + b.y) / 2);
      }
      const last = pts[pts.length - 1]!;
      ctx.lineTo(last.x, last.y);
    }
    ctx.strokeStyle = voiceHue;
    ctx.lineWidth = voiceW;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Dots sit on the smoothed curve, not the raw samples, or they read as
    // speckle scattered either side of the line.
    for (let i = 0; i < n; i += 4) {
      const p = smooth.trail[i];
      if (!p) continue;
      const age = (tNow - p.t) / LOOKBEHIND_SEC;
      const alpha = Math.max(0, 1 - age);
      ctx.fillStyle = p.inTune
        ? pitchColor(Math.round(p.midi), 0.25 + 0.7 * alpha)
        : pal.ink(0.16 + 0.45 * alpha);
      ctx.beginPath();
      ctx.arc(xOf(p.t), liveYOf(avg[i]!), p.inTune ? headR * 0.42 : headR * 0.32, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();

  ctx.strokeStyle = pal.ink(0.5);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(nowX, 8);
  ctx.lineTo(nowX, h - 8);
  ctx.stroke();

  const y = headY ?? liveYOf(live.midi);
  const pillH = Math.max(28, Math.round(laneH * 0.85));
  ctx.save();
  ctx.globalAlpha = live.tracking ? 1 : 0.72;
  const headHue = pitchColor(Math.round(live.midi), 1);
  ctx.shadowColor = live.inTune ? pitchColor(Math.round(live.midi), 0.9) : pal.ink(0.35);
  ctx.shadowBlur = live.inTune ? 22 : live.tracking ? 8 : 4;
  ctx.fillStyle = live.inTune ? headHue : pal.fg;
  roundRect(ctx, 8, y - pillH / 2, RAIL - 16, pillH, 6);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = live.inTune ? headHue : pal.ink(0.8);
  ctx.fillRect(RAIL - 2, y - voiceW / 2, Math.max(0, nowX - (RAIL - 2)), voiceW);

  ctx.save();
  ctx.shadowColor = live.inTune ? pitchColor(Math.round(live.midi), 0.9) : pal.ink(0.45);
  ctx.shadowBlur = live.inTune ? 22 : 10;
  ctx.fillStyle = live.inTune ? headHue : pal.fg;
  ctx.beginPath();
  ctx.arc(nowX, y, headR, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = pal.ink(0.5);
  ctx.font = "12px Outfit, sans-serif";
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
