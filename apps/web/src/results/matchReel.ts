/**
 * Records the match as a downloadable video: both cameras, lyrics, and mixed
 * audio (instrumental + local mic + opponent mics), closed by a results card.
 * Never uploaded: the file only ever lives in this tab as a blob URL.
 *
 * Lifecycle: live (painting the stage) → held (singing ended, recorder paused
 * so the scoring wait is cut) → outro (results card while the instrumental
 * tail fades out) → finalized. A held reel that never gets results closes on
 * a short sting instead.
 */
import { sharedAudioContext, unlockSharedAudio } from "../media/audioContext.ts";
import { RemoteVoiceGain } from "../media/levels.ts";
import { loadCardFonts } from "./cardPaint.ts";
import { drawReelOutro, drawReelSting, type OutroArt } from "./reelOutro.ts";
import {
  decideOutro,
  OutroMs,
  StingMs,
  tailGainAt,
  type ReelResults,
} from "./reelResults.ts";
import { drawStageFrame, FRAME_H, FRAME_W, hudSong } from "./stageFrame.ts";

export type MatchReel = {
  key: string;
  blob: Blob;
  url: string;
  mime: string;
};

type Listener = () => void;

let currentKey = "";
let reel: MatchReel | null = null;
let session: Session | null = null;
const listeners = new Set<Listener>();

type Phase = "live" | "held" | "outro" | "closing";

type Tail = {
  el: HTMLAudioElement;
  node: MediaElementAudioSourceNode;
  gain: GainNode;
};

type Session = {
  key: string;
  phase: Phase;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  recorder: MediaRecorder;
  chunks: Blob[];
  dest: MediaStreamAudioDestinationNode;
  nodes: AudioNode[];
  clones: MediaStreamTrack[];
  tapped: Set<string>;
  micStream: MediaStream | null;
  raf: number;
  frames: number;
  mime: string;
  /** Last stage frame and a blurred copy, for the outro crossfade. */
  art: OutroArt;
  songTitle: string;
  heldAt: number;
  firstResultsAt: number | null;
  results: ReelResults | null;
  holdTimer: number;
  endTimer: number;
  tail: Tail | null;
  closing: Promise<MatchReel | null> | null;
};

function emit() {
  for (const listener of listeners) listener();
}

function revoke(url: string | undefined) {
  if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
}

export function getMatchReel(): MatchReel | null {
  return reel;
}

/** A take is recording, waiting on results, or rendering its outro. */
export function matchReelPending(): boolean {
  return Boolean(session && !reel);
}

export function subscribeMatchReel(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function setReel(next: MatchReel | null) {
  if (reel?.url !== next?.url) revoke(reel?.url);
  reel = next;
  emit();
}

export function resetMatchReel() {
  if (session) {
    abortSession(session);
    session = null;
  }
  currentKey = "";
  setReel(null);
}

export function pickRecorderMime(): string {
  const types = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4",
  ];
  return types.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

export function extForMime(mime: string): string {
  if (mime.includes("mp4")) return "mp4";
  if (mime.includes("webm")) return "webm";
  if (mime.includes("png")) return "png";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  return "webm";
}

function captureElement(el: HTMLMediaElement): MediaStream | null {
  const cap = el as HTMLMediaElement & { captureStream?: (fps?: number) => MediaStream };
  if (typeof cap.captureStream !== "function") return null;
  try {
    return cap.captureStream();
  } catch {
    return null;
  }
}

function findInstrumental(): HTMLAudioElement | null {
  return (
    document.querySelector<HTMLAudioElement>("audio.instrumental") ??
    document.querySelector<HTMLAudioElement>(".training audio") ??
    document.querySelector<HTMLAudioElement>("audio")
  );
}

function tapTrack(session: Session, track: MediaStreamTrack, gainValue: number) {
  if (!track || track.readyState === "ended" || track.kind !== "audio") return;
  if (session.tapped.has(track.id)) return;
  session.tapped.add(track.id);
  try {
    const ctx = sharedAudioContext();
    const clone = track.clone();
    session.clones.push(clone);
    const src = ctx.createMediaStreamSource(new MediaStream([clone]));
    const gain = ctx.createGain();
    gain.gain.value = gainValue;
    src.connect(gain);
    gain.connect(session.dest);
    session.nodes.push(src, gain);
  } catch {
    session.tapped.delete(track.id);
  }
}

function tapStream(session: Session, stream: MediaStream | null, gainValue: number) {
  if (!stream) return;
  for (const track of stream.getAudioTracks()) tapTrack(session, track, gainValue);
}

function collectAudio(session: Session, micStream: MediaStream | null) {
  tapStream(session, micStream, 1);

  const instrumental = findInstrumental();
  if (instrumental) tapStream(session, captureElement(instrumental), 1);

  for (const el of document.querySelectorAll<HTMLAudioElement>("audio.remote-mic")) {
    const fromEl = el.srcObject instanceof MediaStream ? el.srcObject : captureElement(el);
    tapStream(session, fromEl, RemoteVoiceGain);
  }

  for (const video of document.querySelectorAll<HTMLVideoElement>(".stage-cam video, .stage-self video")) {
    if (video.muted) continue;
    const fromEl = video.srcObject instanceof MediaStream ? video.srcObject : captureElement(video);
    tapStream(session, fromEl, RemoteVoiceGain);
  }
}

function paint(target: Session) {
  if (target.phase !== "live") return;
  drawStageFrame(target.ctx, FRAME_W, FRAME_H, { hud: true });
  target.frames += 1;
  if (target.frames % 20 === 0) collectAudio(target, target.micStream);
  target.raf = requestAnimationFrame(() => paint(target));
}

function stopTail(target: Session) {
  const tail = target.tail;
  if (!tail) return;
  target.tail = null;
  try {
    tail.gain.gain.cancelScheduledValues(0);
    tail.gain.gain.value = 0;
  } catch {
    /* context gone */
  }
  try {
    tail.el.pause();
    tail.el.removeAttribute("src");
    tail.el.load();
  } catch {
    /* ignore */
  }
  try {
    tail.node.disconnect();
    tail.gain.disconnect();
  } catch {
    /* already gone */
  }
}

function stopTimers(target: Session) {
  cancelAnimationFrame(target.raf);
  target.raf = 0;
  window.clearInterval(target.holdTimer);
  window.clearTimeout(target.endTimer);
  target.holdTimer = 0;
  target.endTimer = 0;
}

function teardownGraph(target: Session) {
  stopTimers(target);
  stopTail(target);
  for (const node of target.nodes) {
    try {
      node.disconnect();
    } catch {
      /* already gone */
    }
  }
  target.nodes = [];
  for (const clone of target.clones) {
    try {
      clone.stop();
    } catch {
      /* already ended */
    }
  }
  target.clones = [];
}

function abortSession(target: Session) {
  target.phase = "closing";
  teardownGraph(target);
  if (target.recorder.state !== "inactive") {
    try {
      target.recorder.stop();
    } catch {
      /* ignore */
    }
  }
}

export function startMatchReel(key: string, micStream: MediaStream | null) {
  if (!key) return;
  if (session?.key === key) {
    if (session.phase === "live") {
      session.micStream = micStream;
      collectAudio(session, micStream);
    }
    return;
  }
  // This match already has its video; an effect re-run must not restart it.
  if (reel?.key === key) return;
  if (session) {
    // A rematch (or a fresh take) supersedes a reel that is still waiting on
    // results or mid-outro. Release its recorder, tail, and audio taps now so
    // nothing from the old match bleeds into the new recording.
    abortSession(session);
    session = null;
  }
  setReel(null);
  currentKey = key;

  if (typeof MediaRecorder === "undefined") return;

  const canvas = document.createElement("canvas");
  canvas.width = FRAME_W;
  canvas.height = FRAME_H;
  const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
  if (!ctx) return;

  const mime = pickRecorderMime();
  let canvasStream: MediaStream;
  try {
    canvasStream = canvas.captureStream(30);
  } catch {
    return;
  }

  void unlockSharedAudio();
  const audio = sharedAudioContext();
  const dest = audio.createMediaStreamDestination();
  const mixed = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...dest.stream.getAudioTracks(),
  ]);

  let recorder: MediaRecorder;
  try {
    recorder = mime
      ? new MediaRecorder(mixed, {
          mimeType: mime,
          videoBitsPerSecond: 2_400_000,
          audioBitsPerSecond: 128_000,
        })
      : new MediaRecorder(mixed);
  } catch {
    return;
  }

  const next: Session = {
    key,
    phase: "live",
    canvas,
    ctx,
    recorder,
    chunks: [],
    dest,
    nodes: [],
    clones: [],
    tapped: new Set(),
    micStream,
    raf: 0,
    frames: 0,
    mime: recorder.mimeType || mime || "video/webm",
    art: {},
    songTitle: "",
    heldAt: 0,
    firstResultsAt: null,
    results: null,
    holdTimer: 0,
    endTimer: 0,
    tail: null,
    closing: null,
  };

  recorder.ondataavailable = (event) => {
    if (event.data.size) next.chunks.push(event.data);
  };

  collectAudio(next, micStream);
  drawStageFrame(ctx, FRAME_W, FRAME_H, { hud: true });

  try {
    recorder.start(400);
  } catch {
    teardownGraph(next);
    return;
  }

  session = next;
  emit();
  next.raf = requestAnimationFrame(() => paint(next));
}

/** Freeze the last stage frame (sharp, plus a blurred copy) for the crossfade into the card. */
function snapshot(target: Session) {
  try {
    const backdrop = document.createElement("canvas");
    backdrop.width = FRAME_W;
    backdrop.height = FRAME_H;
    backdrop.getContext("2d")?.drawImage(target.canvas, 0, 0);
    const soft = document.createElement("canvas");
    soft.width = FRAME_W;
    soft.height = FRAME_H;
    const softCtx = soft.getContext("2d");
    if (softCtx) {
      softCtx.filter = "blur(24px) saturate(1.15)";
      softCtx.drawImage(backdrop, -48, -48, FRAME_W + 96, FRAME_H + 96);
    }
    target.art = { backdrop, soft };
  } catch {
    target.art = {};
  }
}

/**
 * The live instrumental stops dead at the clip end. A private copy picks up
 * from that exact spot and fades out under the results card. It is routed
 * only into the recording, never to the speakers.
 */
function prepareTail(target: Session) {
  const live = findInstrumental();
  const src = live?.currentSrc || live?.src || "";
  if (!live || !src || live.ended) return;
  const offset = live.currentTime;
  if (Number.isFinite(live.duration) && live.duration - offset < 0.5) return;
  try {
    const ctx = sharedAudioContext();
    const el = new Audio();
    el.preload = "auto";
    el.src = src;
    const seek = () => {
      try {
        el.currentTime = offset;
      } catch {
        /* not seekable yet */
      }
    };
    if (el.readyState >= 1) seek();
    else el.addEventListener("loadedmetadata", seek, { once: true });
    const node = ctx.createMediaElementSource(el);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    node.connect(gain);
    gain.connect(target.dest);
    target.tail = { el, node, gain };
  } catch {
    target.tail = null;
  }
}

/**
 * Singing is over: pause the recorder (the scoring wait is cut from the video)
 * and wait for results to roll the outro. Never blocks forever: with no
 * results by ResultsWaitMs it closes on a short sting.
 */
export function holdMatchReel(key: string) {
  const target = session;
  if (!target || target.key !== key || target.phase !== "live") return;
  target.phase = "held";
  cancelAnimationFrame(target.raf);
  target.raf = 0;
  target.songTitle = hudSong();
  snapshot(target);
  prepareTail(target);
  try {
    if (target.recorder.state === "recording") target.recorder.pause();
  } catch {
    /* keeps recording; the outro still lands */
  }
  target.heldAt = performance.now();
  target.holdTimer = window.setInterval(() => evaluate(target), 200);
  evaluate(target);
  emit();
}

/**
 * Results for the current reel. Call again when they change (Gemini's line
 * lands after the DSP numbers); the outro picks up the newest copy.
 */
export function feedMatchReelResults(results: ReelResults) {
  const target = session;
  if (!target || target.phase === "closing") return;
  target.results = results;
  if (target.firstResultsAt == null) target.firstResultsAt = performance.now();
  if (target.phase === "held") evaluate(target);
}

function evaluate(target: Session) {
  if (target.phase !== "held" || session !== target) return;
  const decision = decideOutro({
    now: performance.now(),
    heldAt: target.heldAt,
    firstResultsAt: target.firstResultsAt,
    complete: target.results?.complete ?? false,
  });
  if (decision === "wait") return;
  window.clearInterval(target.holdTimer);
  target.holdTimer = 0;
  void rollOutro(target, decision === "outro" && target.results ? "outro" : "sting");
}

function settleWithin(promise: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(resolve, ms);
    const done = () => {
      window.clearTimeout(timer);
      resolve();
    };
    promise.then(done, done);
  });
}

function startTail(target: Session): Promise<void> {
  const tail = target.tail;
  if (!tail) return Promise.resolve();
  try {
    tail.gain.gain.value = 1;
    return settleWithin(tail.el.play(), 450);
  } catch {
    return Promise.resolve();
  }
}

function fadeTail(target: Session, totalMs: number) {
  const tail = target.tail;
  if (!tail) return;
  try {
    const ctx = sharedAudioContext();
    const steps = 48;
    const curve = new Float32Array(steps);
    for (let i = 0; i < steps; i++) curve[i] = tailGainAt((i / (steps - 1)) * totalMs, totalMs);
    tail.gain.gain.cancelScheduledValues(ctx.currentTime);
    tail.gain.gain.setValueCurveAtTime(curve, ctx.currentTime, totalMs / 1000);
  } catch {
    /* plays at full, then stops with the recorder */
  }
}

async function rollOutro(target: Session, kind: "outro" | "sting") {
  target.phase = "outro";
  await settleWithin(loadCardFonts(), 400);
  if (target.phase !== "outro") return;
  await startTail(target);
  if (target.phase !== "outro") return;

  const total = kind === "outro" ? OutroMs : StingMs;
  const draw = (t: number) => {
    if (kind === "outro" && target.results) {
      drawReelOutro(target.ctx, FRAME_W, FRAME_H, target.results, t, target.art);
    } else {
      drawReelSting(target.ctx, FRAME_W, FRAME_H, target.songTitle, t, target.art);
    }
  };
  draw(0);
  try {
    if (target.recorder.state === "paused") target.recorder.resume();
  } catch {
    /* still recording */
  }
  fadeTail(target, total);

  const started = performance.now();
  const tick = () => {
    if (target.phase !== "outro") return;
    draw(performance.now() - started);
    target.raf = requestAnimationFrame(tick);
  };
  target.raf = requestAnimationFrame(tick);
  // A timer, not rAF, decides the end, so a backgrounded tab still finalizes.
  target.endTimer = window.setTimeout(() => {
    if (target.phase !== "outro") return;
    draw(total);
    void finishSession(target);
  }, total + 120);
}

function finishSession(target: Session): Promise<MatchReel | null> {
  if (target.closing) return target.closing;
  target.closing = new Promise((resolve) => {
    const settle = () => {
      teardownGraph(target);
      if (session === target) session = null;
      const blob = new Blob(target.chunks, { type: target.mime || "video/webm" });
      if (currentKey !== target.key || blob.size < 64) {
        resolve(null);
        emit();
        return;
      }
      const next: MatchReel = {
        key: target.key,
        blob,
        url: URL.createObjectURL(blob),
        mime: blob.type || target.mime,
      };
      setReel(next);
      resolve(next);
    };

    target.phase = "closing";
    stopTimers(target);
    target.recorder.onstop = settle;
    if (target.recorder.state === "inactive") {
      settle();
      return;
    }
    try {
      target.recorder.requestData();
      target.recorder.stop();
    } catch {
      settle();
    }
  });
  return target.closing;
}

/** Finalize now and skip any outro (a cancelled take). */
export function stopMatchReel(key: string): Promise<MatchReel | null> {
  if (reel?.key === key) return Promise.resolve(reel);
  if (!session || session.key !== key) return Promise.resolve(null);
  return finishSession(session);
}

export function waitForCurrentReel(ms = 5000): Promise<MatchReel | null> {
  if (reel) return Promise.resolve(reel);
  if (session) return waitForReel(session.key, ms);
  return Promise.resolve(null);
}

/**
 * Resolve once this match's video is ready. A reel still recording the
 * singing is closed now; one waiting on results or rendering its outro is
 * left to finish. Resolves null if the reel is dropped (reset, rematch).
 */
export function waitForReel(key: string, ms = 5000): Promise<MatchReel | null> {
  if (!key) return Promise.resolve(null);
  if (reel?.key === key) return Promise.resolve(reel);
  if (session?.key === key && session.phase === "live") void stopMatchReel(key);
  return new Promise((resolve) => {
    const check = (): MatchReel | null | undefined => {
      const have = getMatchReel();
      if (have?.key === key) return have;
      if (!session || session.key !== key) return null;
      return undefined;
    };
    const ready = check();
    if (ready !== undefined) {
      resolve(ready);
      return;
    }
    const timer = window.setTimeout(() => {
      unsub();
      resolve(check() ?? null);
    }, ms);
    const unsub = subscribeMatchReel(() => {
      const next = check();
      if (next === undefined) return;
      window.clearTimeout(timer);
      unsub();
      resolve(next);
    });
  });
}
