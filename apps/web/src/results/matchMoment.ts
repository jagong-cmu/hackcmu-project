/**
 * One still from the match, grabbed locally from the live camera tiles.
 * Never uploaded — share cards are composed on this client.
 */
import { collectVideos, drawStageFrame, FRAME_H, FRAME_W } from "./stageFrame.ts";

export { currentLyric } from "./stageFrame.ts";

export type MatchMoment = {
  key: string;
  blob: Blob;
  url: string;
  lyric: string;
  capturedAt: number;
};

type Listener = () => void;

let currentKey = "";
let moment: MatchMoment | null = null;
let timer = 0;
let retryTimer = 0;
const listeners = new Set<Listener>();

function emit() {
  for (const listener of listeners) listener();
}

function revoke(url: string | undefined) {
  if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
}

export function getMatchMoment(): MatchMoment | null {
  return moment;
}

export function subscribeMatchMoment(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetMatchMoment() {
  window.clearTimeout(timer);
  window.clearTimeout(retryTimer);
  timer = 0;
  retryTimer = 0;
  currentKey = "";
  revoke(moment?.url);
  moment = null;
  emit();
}

function setMoment(next: MatchMoment | null) {
  if (moment?.url !== next?.url) revoke(moment?.url);
  moment = next;
  emit();
}

export async function grabMatchMoment(key = currentKey): Promise<MatchMoment | null> {
  if (!key) return null;
  const videos = collectVideos();
  if (!videos.length) return null;

  const canvas = document.createElement("canvas");
  canvas.width = FRAME_W;
  canvas.height = FRAME_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const { lyric } = drawStageFrame(ctx, FRAME_W, FRAME_H);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.9),
  );
  if (!blob) return null;

  const next: MatchMoment = {
    key,
    blob,
    url: URL.createObjectURL(blob),
    lyric,
    capturedAt: Date.now(),
  };
  if (currentKey !== key) {
    revoke(next.url);
    return null;
  }
  setMoment(next);
  return next;
}

export function armRandomCapture(key: string, windowMs: number) {
  if (!key) return;
  if (currentKey === key) {
    if (moment?.key === key || timer) return;
  } else {
    window.clearTimeout(timer);
    window.clearTimeout(retryTimer);
    timer = 0;
    retryTimer = 0;
    setMoment(null);
    currentKey = key;
  }

  const span = Math.max(4000, windowMs);
  const min = Math.min(2800, span * 0.18);
  const max = Math.max(min + 400, span * 0.72);
  const delay = min + Math.random() * (max - min);

  timer = window.setTimeout(async () => {
    timer = 0;
    const grabbed = await grabMatchMoment(key);
    if (grabbed || currentKey !== key) return;
    retryTimer = window.setTimeout(() => {
      retryTimer = 0;
      void grabMatchMoment(key);
    }, 700);
  }, delay);
}

/** Last chance: grab now if the random beat never landed a frame. */
export function flushCapture(key: string) {
  if (!key || currentKey !== key) return;
  window.clearTimeout(timer);
  window.clearTimeout(retryTimer);
  timer = 0;
  retryTimer = 0;
  if (moment?.key === key) return;
  void grabMatchMoment(key);
}

export async function seedPreviewMoment(): Promise<MatchMoment> {
  const width = 1280;
  const height = 720;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;

  const panes = [
    { x: 0, glow: "#4f97f5", name: "Alex" },
    { x: width / 2 + 3, glow: "#79b4ff", name: "You" },
  ];
  ctx.fillStyle = "#04060c";
  ctx.fillRect(0, 0, width, height);
  for (const pane of panes) {
    const w = width / 2 - 3;
    const g = ctx.createRadialGradient(pane.x + w * 0.5, height * 0.42, 20, pane.x + w * 0.5, height * 0.4, 280);
    g.addColorStop(0, pane.glow);
    g.addColorStop(0.45, "#1b4fa3");
    g.addColorStop(1, "#070b14");
    ctx.fillStyle = g;
    ctx.fillRect(pane.x, 0, w, height);
    ctx.fillStyle = "rgba(242, 248, 255, 0.16)";
    ctx.beginPath();
    ctx.ellipse(pane.x + w * 0.5, height * 0.38, 92, 118, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(4, 6, 12, 0.5)";
    ctx.fillRect(pane.x, height - 58, w, 58);
    ctx.fillStyle = "#f2f8ff";
    ctx.font = "500 22px Outfit, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(pane.name, pane.x + 22, height - 29);
  }
  const fade = ctx.createLinearGradient(0, height - 200, 0, height);
  fade.addColorStop(0, "rgba(4, 6, 12, 0)");
  fade.addColorStop(1, "rgba(4, 6, 12, 0.86)");
  ctx.fillStyle = fade;
  ctx.fillRect(0, height - 200, width, 200);
  ctx.fillStyle = "#ffffff";
  ctx.font = "600 34px Outfit, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("I used to rule the world", width / 2, height - 54);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((next) => (next ? resolve(next) : reject(new Error("preview moment"))), "image/jpeg", 0.88);
  });
  const next: MatchMoment = {
    key: "preview",
    blob,
    url: URL.createObjectURL(blob),
    lyric: "I used to rule the world",
    capturedAt: Date.now(),
  };
  currentKey = "preview";
  setMoment(next);
  return next;
}
