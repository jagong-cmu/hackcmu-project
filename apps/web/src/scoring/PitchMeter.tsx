import { useEffect, useRef } from "react";
import { palette, pitchColor } from "../theme/palette.ts";
import type { MelodyFile } from "@karaoke/shared";
import { midiFromHz } from "./cents.ts";
import { melodyHzAt } from "./scoreClip.ts";
import {
  TRAIL_SEC,
  createPitchSmoothState,
  noteName,
  segmentMelody,
  smoothLivePitch,
  type NoteRun,
} from "./pitchGuide.ts";
import type { VoiceProfile } from "./voiceRange.ts";
import { BODY } from "../results/cardPaint.ts";

type Props = {
  melody: MelodyFile | null;
  playheadSec: number;
  liveHz: number | null;
  liveClarity: number;
  liveRms?: number;
  /**
   * The singer's voice range, only when the live pitch shown is theirs. Guards
   * against detector octave errors (fixOctaveByRange). Display only; omitted /
   * null → no guard.
   */
  voiceProfile?: VoiceProfile | null;
};

function smoothStateFor(profile: VoiceProfile | null | undefined) {
  return createPitchSmoothState(profile ? { profile } : undefined);
}

const LOOKAHEAD_SEC = 2.0;
const LOOKBEHIND_SEC = TRAIL_SEC;
/**
 * Fixed vertical range, C2–C6 (MIDI 36–84): bass to soprano. Y is linear in
 * MIDI, so every semitone gets the same height. Pitches outside pin to an edge.
 */
const VIEW_MIN_MIDI = 36;
const VIEW_MAX_MIDI = 84;
const RAIL = 78;
/**
 * Add ?pitchdebug to the URL for a Hz / note / clarity / RMS readout, and a
 * per-frame log of the last ~20 s in the console as `pitchLog`
 * (e.g. `console.table(pitchLog.filter((f) => f.reject))`).
 */
const DEBUG = new URLSearchParams(window.location.search).has("pitchdebug");
type FrameLog = {
  hz: number | null;
  clarity: number;
  rms: number;
  reject: string | null;
  shown: number | null;
};
const pitchLog: FrameLog[] = [];
if (DEBUG) (window as unknown as { pitchLog: FrameLog[] }).pitchLog = pitchLog;

export function PitchMeter({ melody, playheadSec, liveHz, liveClarity, liveRms = 0, voiceProfile }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef({ melody, playheadSec, liveHz, liveClarity, liveRms });
  const runsRef = useRef<NoteRun[]>([]);
  const smoothRef = useRef(createPitchSmoothState());
  const profileRef = useRef(voiceProfile);
  propsRef.current = { melody, playheadSec, liveHz, liveClarity, liveRms };
  profileRef.current = voiceProfile;

  useEffect(() => {
    runsRef.current = melody ? segmentMelody(melody) : [];
    smoothRef.current = smoothStateFor(profileRef.current);
  }, [melody]);

  // A different voice on the line (e.g. your turn starts after watching
  // theirs): fresh smoother seeded for it. Never fires without a profile.
  const seededFor = useRef(voiceProfile);
  useEffect(() => {
    if (seededFor.current === voiceProfile) return;
    seededFor.current = voiceProfile;
    smoothRef.current = smoothStateFor(voiceProfile);
  }, [voiceProfile]);

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
  const min = VIEW_MIN_MIDI;
  const max = VIEW_MAX_MIDI;
  const span = max - min;
  const yPad = Math.max(8, Math.min(14, h * 0.09));
  const stPx = (h - 2 * yPad) / span;
  const yOf = (midi: number) => {
    const t = (midi - min) / span;
    const y = h - yPad - t * (h - 2 * yPad);
    return Math.min(h - 4, Math.max(4, y));
  };
  // Lanes and the voice line are sized in semitones so a line one semitone
  // off the note is visibly off it.
  const laneH = Math.max(4, stPx);
  const voiceW = Math.max(4, Math.min(Math.round(h * 0.065), Math.round(stPx * 1.5)));
  const headR = Math.max(10, Math.round(h * 0.045));

  const windowSec = LOOKAHEAD_SEC + LOOKBEHIND_SEC;
  const fieldX = RAIL + 10;
  const fieldW = w - fieldX - 12;
  const xOf = (sec: number) => fieldX + ((sec - (tNow - LOOKBEHIND_SEC)) / windowSec) * fieldW;
  const nowX = xOf(tNow);

  ctx.fillStyle = pal.ink(0.04);
  ctx.fillRect(0, 0, RAIL, h);

  for (let m = min; m <= max; m++) {
    // Octave lines always; semitone lines only when they would not smear into a fill.
    if (m % 12 !== 0 && stPx < 6) continue;
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
    // Current note ice, coming up blue (them / coming up), sung notes dim.
    ctx.fillStyle = active
      ? pal.tone("ice-rgb", 0.92)
      : upcoming
        ? pal.tone("blue-rgb", 0.78)
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
    playheadSec: tNow,
    nowMs: performance.now(),
  });

  // The head marker rides the smoothed curve so the two cannot disagree.
  let headY: number | null = null;

  // Silence breaks the line instead of holding a stale note.
  type TrailPoint = { t: number; midi: number; inTune: boolean };
  const segments: TrailPoint[][] = [];
  let open: TrailPoint[] | null = null;
  for (const p of smooth.trail) {
    if (p.midi == null) {
      open = null;
      continue;
    }
    if (!open) segments.push((open = []));
    open.push({ t: p.t, midi: p.midi, inTune: p.inTune });
  }

  for (const trail of segments) {
    if (trail.length < 2) continue;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    const hue = Math.round(trail[trail.length - 1]!.midi);
    const voiceHue = pitchColor(hue, 0.95);
    ctx.shadowColor = pitchColor(hue, 0.7);
    ctx.shadowBlur = 26;
    // Rolling average over the trail, then a quadratic through the midpoints.
    // Straight segments between per-frame samples read as a jagged sawtooth
    // even when the pitch itself is steady.
    const n = trail.length;
    const avg = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      let count = 0;
      for (let j = Math.max(0, i - 3); j <= Math.min(n - 1, i + 3); j++) {
        sum += trail[j]!.midi;
        count++;
      }
      avg[i] = sum / count;
    }
    if (live.midi != null && trail === open) headY = yOf(avg[n - 1]!);

    const pts: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < n; i++) {
      const p = trail[i];
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
    ctx.strokeStyle = voiceHue;
    ctx.lineWidth = voiceW;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Dots sit on the smoothed curve, not the raw samples, or they read as
    // speckle scattered either side of the line.
    for (let i = 0; i < n; i += 4) {
      const p = trail[i];
      if (!p) continue;
      const age = (tNow - p.t) / LOOKBEHIND_SEC;
      const alpha = Math.max(0, 1 - age);
      ctx.fillStyle = p.inTune
        ? pitchColor(Math.round(p.midi), 0.25 + 0.7 * alpha)
        : pal.ink(0.16 + 0.45 * alpha);
      ctx.beginPath();
      ctx.arc(xOf(p.t), yOf(avg[i]!), p.inTune ? headR * 0.42 : headR * 0.32, 0, Math.PI * 2);
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

  if (live.midi != null) {
    const y = headY ?? yOf(live.midi);
    const pillH = Math.max(28, Math.round(laneH * 0.85));
    ctx.save();
    const headHue = pitchColor(Math.round(live.midi), 1);
    ctx.shadowColor = live.inTune ? pitchColor(Math.round(live.midi), 0.9) : pal.ink(0.35);
    ctx.shadowBlur = live.inTune ? 22 : 8;
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
  }

  ctx.fillStyle = pal.ink(0.5);
  ctx.font = `12px ${BODY}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("high", 10, 8);
  ctx.textBaseline = "bottom";
  ctx.fillText("low", 10, h - 8);
  ctx.textAlign = "right";
  ctx.textBaseline = "top";
  ctx.fillText("coming up →", w - 12, 8);

  if (DEBUG) {
    const hz = props.liveHz;
    const m = hz != null && hz > 0 ? midiFromHz(hz) : null;
    const cents = m == null ? 0 : Math.round((m - Math.round(m)) * 100);
    const lines = [
      `hz ${m == null ? "—" : hz!.toFixed(1)}  midi ${m?.toFixed(2) ?? "—"}`,
      `note ${m == null ? "—" : `${noteName(m)} ${cents >= 0 ? "+" : ""}${cents}¢`}`,
      `clarity ${props.liveClarity.toFixed(2)}  rms ${(props.liveRms ?? 0).toFixed(4)}`,
      `frame ${live.reject ?? "accepted"}  shown ${live.midi == null ? "hidden" : live.midi.toFixed(2)}`,
    ];
    pitchLog.push({
      hz,
      clarity: +props.liveClarity.toFixed(3),
      rms: +(props.liveRms ?? 0).toFixed(4),
      reject: live.reject,
      shown: live.midi == null ? null : +live.midi.toFixed(2),
    });
    if (pitchLog.length > 1200) pitchLog.shift();
    ctx.font = "11px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = pal.bg;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(fieldX + 4, 4, 240, lines.length * 13 + 6);
    ctx.globalAlpha = 1;
    ctx.fillStyle = pal.fg;
    lines.forEach((line, i) => ctx.fillText(line, fieldX + 8, 7 + i * 13));
  }
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
