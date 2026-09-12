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
  const viewRef = useRef({ min: 52, max: 76 });
  propsRef.current = { melody, playheadSec, liveHz, liveClarity, liveRms };

  useEffect(() => {
    runsRef.current = melody ? segmentMelody(melody) : [];
    smoothRef.current = createPitchSmoothState();
    const r = melodyRange(runsRef.current);
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
  ctx.fillStyle = "#0c0c0c";
  ctx.fillRect(0, 0, w, h);

  const tune = melodyRange(runs);
  // Widen the view so the singer stays visible off the top or bottom of the
  // tune; otherwise every out-of-range note pins to the same rail and reads as
  // "not moving". View edges ease toward the target so it never jitters.
  const view = viewRef;
  const wantMin = Math.min(tune.min, smooth.midi != null ? smooth.midi - 2 : tune.min);
  const wantMax = Math.max(tune.max, smooth.midi != null ? smooth.midi + 2 : tune.max);
  view.min += (wantMin - view.min) * 0.08;
  view.max += (wantMax - view.max) * 0.08;
  const min = view.min;
  const max = view.max;
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

  // The head marker rides the smoothed curve so the two cannot disagree.
  let headY: number | null = null;

  if (smooth.trail.length > 1) {
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.shadowColor = "rgba(201,162,39,0.55)";
    ctx.shadowBlur = 18;
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
    if (n > 0) headY = yOf(avg[n - 1]!);

    const pts: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < n; i++) {
      const p = smooth.trail[i];
      if (!p) continue;
      const x = xOf(p.t);
      const prev = pts[pts.length - 1];
      if (prev && Math.abs(x - prev.x) < 0.75) continue;
      pts.push({ x, y: yOf(avg[i]!) });
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
    ctx.strokeStyle = "rgba(201,162,39,0.55)";
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Dots sit on the smoothed curve, not the raw samples, or they read as
    // speckle scattered either side of the line.
    for (let i = 0; i < n; i += 5) {
      const p = smooth.trail[i];
      if (!p) continue;
      const age = (tNow - p.t) / LOOKBEHIND_SEC;
      const alpha = Math.max(0, 1 - age);
      ctx.fillStyle = p.inTune
        ? `rgba(201,162,39,${0.2 + 0.65 * alpha})`
        : `rgba(244,239,230,${0.12 + 0.4 * alpha})`;
      ctx.beginPath();
      ctx.arc(xOf(p.t), yOf(avg[i]!), p.inTune ? 3.2 : 2, 0, Math.PI * 2);
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

  const y = headY ?? yOf(live.midi);
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

  // The indicator is octave-folded onto the tune, so label the note actually
  // sung. Otherwise a bass reads "G4" while singing G2.
  if (live.tracking && live.rawMidi != null) {
    ctx.fillStyle = "#070707";
    ctx.font = "600 10px Outfit, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(noteName(live.rawMidi), 8 + (RAIL - 16) / 2, y + 1);
  }

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
