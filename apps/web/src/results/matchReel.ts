/**
 * Records the match as a downloadable video: both cameras, lyrics, and mixed
 * audio (instrumental + local mic + opponent mics). Never uploaded.
 */
import { sharedAudioContext, unlockSharedAudio } from "../media/audioContext.ts";
import { RemoteVoiceGain } from "../media/levels.ts";
import { drawStageFrame, FRAME_H, FRAME_W } from "./stageFrame.ts";

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
let stopPromise: Promise<MatchReel | null> | null = null;
const listeners = new Set<Listener>();

type Session = {
  key: string;
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
  live: boolean;
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
    void abortSession(session);
    session = null;
  }
  stopPromise = null;
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

  const instrumental =
    document.querySelector<HTMLAudioElement>("audio.instrumental") ??
    document.querySelector<HTMLAudioElement>(".training audio") ??
    document.querySelector<HTMLAudioElement>("audio");
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
  if (!target.live) return;
  drawStageFrame(target.ctx, FRAME_W, FRAME_H, { hud: true });
  target.frames += 1;
  if (target.frames % 20 === 0) collectAudio(target, target.micStream);
  target.raf = requestAnimationFrame(() => paint(target));
}

function teardownGraph(target: Session) {
  target.live = false;
  cancelAnimationFrame(target.raf);
  target.raf = 0;
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

async function abortSession(target: Session) {
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
    session.micStream = micStream;
    collectAudio(session, micStream);
    return;
  }
  if (session) {
    void abortSession(session);
    session = null;
  }
  if (reel?.key !== key) setReel(null);
  currentKey = key;
  stopPromise = null;

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
    live: true,
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

function finishSession(target: Session): Promise<MatchReel | null> {
  return new Promise((resolve) => {
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

    target.live = false;
    cancelAnimationFrame(target.raf);
    target.raf = 0;
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
}

export function stopMatchReel(key: string): Promise<MatchReel | null> {
  if (reel?.key === key) return Promise.resolve(reel);
  if (!session || session.key !== key) return Promise.resolve(null);
  if (stopPromise) return stopPromise;
  const target = session;
  stopPromise = finishSession(target).finally(() => {
    if (session === target) session = null;
    if (stopPromise) stopPromise = null;
  });
  return stopPromise;
}

export function waitForCurrentReel(ms = 5000): Promise<MatchReel | null> {
  if (reel) return Promise.resolve(reel);
  if (session) return waitForReel(session.key, ms);
  return Promise.resolve(null);
}

export function waitForReel(key: string, ms = 5000): Promise<MatchReel | null> {
  if (!key) return Promise.resolve(null);
  if (reel?.key === key) return Promise.resolve(reel);
  void stopMatchReel(key);
  return new Promise((resolve) => {
    const have = getMatchReel();
    if (have?.key === key) {
      resolve(have);
      return;
    }
    const timer = window.setTimeout(() => {
      unsub();
      resolve(getMatchReel()?.key === key ? getMatchReel() : null);
    }, ms);
    const unsub = subscribeMatchReel(() => {
      const next = getMatchReel();
      if (next?.key === key) {
        window.clearTimeout(timer);
        unsub();
        resolve(next);
      }
    });
  });
}
