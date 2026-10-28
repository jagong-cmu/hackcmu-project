import { useEffect, useRef } from "react";
import { palette } from "../theme/palette.ts";
import type { MelodyFile } from "@karaoke/shared";
import { midiFromHz } from "./cents.ts";
import { melodyHzAt } from "./scoreClip.ts";
import {
  createPitchSmoothState,
  noteName,
  segmentMelody,
  smoothLivePitch,
  wrapMidi,
  type NoteRun,
} from "./pitchGuide.ts";
import type { VoiceProfile } from "./voiceRange.ts";

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
  /**
   * Display-only combo: notes in a row held in tune (the detector's inTune
   * flag), reported when each note ends. Never feeds scoring.
   */
  onCombo?: (combo: number) => void;
};

function smoothStateFor(profile: VoiceProfile | null | undefined) {
  return createPitchSmoothState(profile ? { profile } : undefined);
}

/** Playhead sits this far across; the rest is look-ahead. */
const PLAYHEAD_X = 0.26;
const LOOKAHEAD_SEC = 3.5;
const LOOKAHEAD_NARROW_SEC = 2.5;
const NARROW_PX = 900;
/** Notes after the window that still count toward the fitted range, so it settles before they arrive. */
const FIT_EXTRA_SEC = 2;
const FIT_MARGIN_ST = 2;
/** At least an octave plus margin, so an octave-folded live dot always lands in view. */
const MIN_SPAN_ST = 14;
const RANGE_EASE_MS = 350;
const GUIDES = 6;
const DOT_TRAIL_SEC = 0.3;
/** Share of a note's frames that must be in tune for it to count as hit. */
const HIT_RATIO = 0.4;
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

type NoteHit = { on: number; n: number; done: boolean; hit: boolean };
type LaneState = {
  lo: number | null;
  hi: number | null;
  lastMs: number;
  lastT: number;
  hits: Map<number, NoteHit>;
  combo: number;
};

const freshLane = (): LaneState => ({ lo: null, hi: null, lastMs: 0, lastT: -Infinity, hits: new Map(), combo: 0 });

type Colors = { blue: string; red: string; redGlow: string; ice: string; muted: string; line: string; white: string };
let colorCache: Colors | null = null;
/** Resolved once: reading tokens every frame is a style lookup the lane cannot afford. */
function colors(): Colors {
  if (colorCache) return colorCache;
  const p = palette();
  colorCache = {
    blue: p.tone("blue-rgb", 1),
    red: p.tone("red-rgb", 1),
    redGlow: p.tone("red-rgb", 0.7),
    ice: p.tone("ice-rgb", 1),
    muted: getComputedStyle(document.documentElement).getPropertyValue("--muted").trim(),
    line: p.ink(0.2),
    white: p.tone("text-rgb", 1),
  };
  return colorCache;
}

export function PitchMeter({ melody, playheadSec, liveHz, liveClarity, liveRms = 0, voiceProfile, onCombo }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef({ melody, playheadSec, liveHz, liveClarity, liveRms, onCombo });
  const runsRef = useRef<NoteRun[]>([]);
  const smoothRef = useRef(createPitchSmoothState());
  const laneRef = useRef(freshLane());
  const profileRef = useRef(voiceProfile);
  propsRef.current = { melody, playheadSec, liveHz, liveClarity, liveRms, onCombo };
  profileRef.current = voiceProfile;

  useEffect(() => {
    runsRef.current = melody ? segmentMelody(melody) : [];
    smoothRef.current = smoothStateFor(profileRef.current);
    laneRef.current = freshLane();
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
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

    let raf = 0;
    const draw = () => {
      paint(canvas, ctx, wrap, propsRef.current, runsRef.current, smoothRef.current, laneRef.current, reduced.matches);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div ref={wrapRef} className="pitch-guide">
      <canvas ref={canvasRef} className="pitch-meter" aria-hidden="true" draggable={false} />
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
  lane: LaneState,
  reduced: boolean,
) {
  const w = Math.max(1, wrap.clientWidth);
  const h = Math.max(1, wrap.clientHeight);
  const dpr = window.devicePixelRatio || 1;
  const pw = Math.floor(w * dpr);
  const ph = Math.floor(h * dpr);
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw;
    canvas.height = ph;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const c = colors();

  const t = props.playheadSec;
  const nowMs = performance.now();
  const dt = lane.lastMs ? nowMs - lane.lastMs : 0;
  lane.lastMs = nowMs;
  // Seek back or a new take on the same melody: notes are ungraded again.
  if (t < lane.lastT - 0.5) {
    lane.hits.clear();
    if (lane.combo !== 0) props.onCombo?.(0);
    lane.combo = 0;
  }
  lane.lastT = t;

  const ahead = window.innerWidth < NARROW_PX ? LOOKAHEAD_NARROW_SEC : LOOKAHEAD_SEC;
  const playX = Math.round(w * PLAYHEAD_X);
  const pps = (w - playX) / ahead;
  const behind = playX / pps;
  const xOf = (sec: number) => playX + (sec - t) * pps;

  // Fit the vertical range to the notes around now, eased so lanes never jump.
  let fitLo = Infinity;
  let fitHi = -Infinity;
  for (const run of runs) {
    if (run.endSec < t - behind || run.startSec > t + ahead + FIT_EXTRA_SEC) continue;
    if (run.midi < fitLo) fitLo = run.midi;
    if (run.midi > fitHi) fitHi = run.midi;
  }
  if (fitLo <= fitHi) {
    fitLo -= FIT_MARGIN_ST;
    fitHi += FIT_MARGIN_ST;
    if (fitHi - fitLo < MIN_SPAN_ST) {
      const mid = (fitLo + fitHi) / 2;
      fitLo = mid - MIN_SPAN_ST / 2;
      fitHi = mid + MIN_SPAN_ST / 2;
    }
    if (lane.lo == null || lane.hi == null || reduced) {
      lane.lo = fitLo;
      lane.hi = fitHi;
    } else {
      const k = 1 - Math.exp(-dt / RANGE_EASE_MS);
      lane.lo += (fitLo - lane.lo) * k;
      lane.hi += (fitHi - lane.hi) * k;
    }
  }
  const lo = lane.lo ?? 53;
  const hi = lane.hi ?? 67;

  const noteH = Math.max(14, Math.min(22, Math.round(h * 0.11)));
  const pad = noteH / 2 + 6;
  const yOf = (midi: number) => pad + ((hi - midi) / (hi - lo)) * (h - 2 * pad);

  ctx.strokeStyle = c.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < GUIDES; i++) {
    const y = Math.round(pad + (i * (h - 2 * pad)) / (GUIDES - 1)) + 0.5;
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }
  ctx.stroke();

  const targetHz = props.melody ? melodyHzAt(props.melody, t) : null;
  const targetMidi = targetHz ? midiFromHz(targetHz) : null;
  const live = smoothLivePitch(smooth, {
    hz: props.liveHz,
    clarity: props.liveClarity,
    rms: props.liveRms ?? 0,
    targetMidi,
    playheadSec: t,
    nowMs,
  });
  // The detector's own "no pitch" (midi null) hides the dot; never pin or freeze it.
  const voiced = live.midi != null && Number.isFinite(live.midi);

  // Grade the note under the playhead, then close out any that just ended.
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]!;
    if (run.startSec > t) break;
    if (t > run.endSec) continue;
    const rec = lane.hits.get(i) ?? { on: 0, n: 0, done: false, hit: false };
    rec.n++;
    if (live.inTune) rec.on++;
    lane.hits.set(i, rec);
  }
  for (const [i, rec] of lane.hits) {
    if (rec.done || t <= runs[i]!.endSec) continue;
    rec.done = true;
    rec.hit = rec.on / rec.n >= HIT_RATIO;
    lane.combo = rec.hit ? lane.combo + 1 : 0;
    props.onCombo?.(lane.combo);
  }

  const r = noteH / 2;
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]!;
    if (run.endSec < t - behind) continue;
    if (run.startSec > t + ahead) break;
    const x1 = xOf(run.startSec);
    const x2 = Math.max(x1 + noteH, xOf(run.endSec));
    const y = yOf(run.midi) - r;
    const rec = lane.hits.get(i);
    if (run.endSec < t) {
      if (rec?.hit) {
        ctx.shadowColor = c.redGlow;
        ctx.shadowBlur = 12;
        ctx.fillStyle = c.red;
        pill(ctx, x1, y, x2 - x1, noteH, r);
        ctx.fill();
        ctx.shadowBlur = 0;
      } else {
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = c.muted;
        pill(ctx, x1, y, x2 - x1, noteH, r);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    } else if (run.startSec <= t) {
      // Being sung: the sung part shows hit (red) or not (muted), the rest is still to come.
      const hitSoFar = rec != null && rec.on / rec.n >= HIT_RATIO;
      pill(ctx, x1, y, x2 - x1, noteH, r);
      ctx.save();
      ctx.clip();
      ctx.fillStyle = c.blue;
      ctx.fillRect(playX, y, x2 - playX, noteH);
      if (hitSoFar) ctx.fillStyle = c.red;
      else {
        ctx.fillStyle = c.muted;
        ctx.globalAlpha = 0.3;
      }
      ctx.fillRect(x1, y, playX - x1, noteH);
      ctx.restore();
    } else {
      ctx.fillStyle = c.blue;
      pill(ctx, x1, y, x2 - x1, noteH, r);
      ctx.fill();
    }
  }

  ctx.save();
  ctx.shadowColor = c.ice;
  ctx.shadowBlur = 8;
  ctx.fillStyle = c.ice;
  ctx.fillRect(playX - 1, 0, 2, h);
  ctx.restore();

  if (voiced) {
    const center = (lo + hi) / 2;
    const fold = (m: number) => wrapMidi(m, center);
    ctx.fillStyle = c.white;
    for (const p of smooth.trail) {
      if (p.midi == null || p.t < t - DOT_TRAIL_SEC || p.t >= t) continue;
      const age = (t - p.t) / DOT_TRAIL_SEC;
      ctx.globalAlpha = 0.45 * (1 - age);
      ctx.beginPath();
      ctx.arc(xOf(p.t), yOf(fold(p.midi)), 9 * (1 - 0.5 * age), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    const y = yOf(fold(live.midi!));
    const pulse = live.inTune && !reduced ? 1.5 * (1 + Math.sin(nowMs / 140)) : 0;
    ctx.strokeStyle = live.inTune ? c.red : c.blue;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(playX, y, 12 + pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = c.white;
    ctx.beginPath();
    ctx.arc(playX, y, 9, 0, Math.PI * 2);
    ctx.fill();
  }

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
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = palette().bg;
    ctx.fillRect(4, 4, 240, lines.length * 13 + 6);
    ctx.globalAlpha = 1;
    ctx.fillStyle = c.white;
    lines.forEach((line, i) => ctx.fillText(line, 8, 7 + i * 13));
  }
}

function pill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
}
