/**
 * One still from the match, grabbed locally from the live camera tiles.
 * Never uploaded — share cards are composed on this client.
 */

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

function collectVideos(): HTMLVideoElement[] {
  const cams = [...document.querySelectorAll<HTMLVideoElement>(".stage-cam video")].filter(
    (video) => video.readyState >= 2 && video.videoWidth > 0,
  );
  if (cams.length) return cams.slice(0, 2);
  const self = document.querySelector<HTMLVideoElement>(".stage-self video");
  if (self && self.readyState >= 2 && self.videoWidth > 0) return [self];
  return [];
}

export function currentLyric(): string {
  const el = document.querySelector(".lyrics-now");
  const text = el?.textContent?.replace(/\s+/g, " ").trim() ?? "";
  if (!text || text === "·" || text.startsWith("Loading")) return "";
  return text;
}

function tileNames(): string[] {
  return [...document.querySelectorAll(".stage-cam .name, .stage-self p")]
    .map((node) => (node.textContent ?? "").replace(/\s+\(you\)$/i, "").trim())
    .filter(Boolean);
}

function isMirrored(video: HTMLVideoElement): boolean {
  const inline = video.style.transform;
  if (inline.includes("scaleX(-1)")) return true;
  return getComputedStyle(video).transform.includes("matrix(-1,");
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  x: number,
  y: number,
  w: number,
  h: number,
  mirror: boolean,
) {
  const vw = video.videoWidth || w;
  const vh = video.videoHeight || h;
  const scale = Math.max(w / vw, h / vh);
  const dw = vw * scale;
  const dh = vh * scale;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  if (mirror) {
    ctx.translate(x + w, y);
    ctx.scale(-1, 1);
    ctx.drawImage(video, (w - dw) / 2, (h - dh) / 2, dw, dh);
  } else {
    ctx.drawImage(video, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }
  ctx.restore();
}

function wrapLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
) {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  const shown = lines.slice(0, maxLines);
  if (lines.length > maxLines) shown[maxLines - 1] = `${shown[maxLines - 1]}\u2026`;
  const start = y - ((shown.length - 1) * lineHeight) / 2;
  shown.forEach((entry, i) => ctx.fillText(entry, x, start + i * lineHeight));
}

export async function grabMatchMoment(key = currentKey): Promise<MatchMoment | null> {
  if (!key) return null;
  const videos = collectVideos();
  if (!videos.length) return null;

  const width = 1280;
  const height = 720;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = "#070b14";
  ctx.fillRect(0, 0, width, height);

  const gap = 5;
  const count = videos.length;
  const paneW = count === 1 ? width : (width - gap) / count;
  const names = tileNames();

  videos.forEach((video, i) => {
    const x = i * (paneW + gap);
    drawCover(ctx, video, x, 0, paneW, height, isMirrored(video));
    const name = names[i];
    if (!name) return;
    ctx.fillStyle = "rgba(4, 6, 12, 0.52)";
    ctx.fillRect(x, height - 58, paneW, 58);
    ctx.fillStyle = "#f2f8ff";
    ctx.font = "500 22px Outfit, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(name, x + 22, height - 29, paneW - 44);
  });

  const lyric = currentLyric();
  if (lyric) {
    const fade = ctx.createLinearGradient(0, height - 200, 0, height);
    fade.addColorStop(0, "rgba(4, 6, 12, 0)");
    fade.addColorStop(0.45, "rgba(4, 6, 12, 0.45)");
    fade.addColorStop(1, "rgba(4, 6, 12, 0.88)");
    ctx.fillStyle = fade;
    ctx.fillRect(0, height - 200, width, 200);
    ctx.fillStyle = "#ffffff";
    ctx.font = "600 34px Outfit, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    wrapLine(ctx, lyric, width / 2, height - 54, width - 96, 40, 2);
  }

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
