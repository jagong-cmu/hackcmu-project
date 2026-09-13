/**
 * One frame of the match: both camera tiles, lyrics, and a thin broadcast HUD.
 * Used by the still grab and by the share-video recorder.
 */

export const FRAME_W = 1280;
export const FRAME_H = 720;

export function collectVideos(): HTMLVideoElement[] {
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

function nextLyric(): string {
  const line = document.querySelector(".lyrics-next .next-line");
  if (line) return (line.textContent ?? "").replace(/\s+/g, " ").trim();
  return (document.querySelector(".lyrics-next")?.textContent ?? "").replace(/\s+/g, " ").trim();
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

function isSinging(video: HTMLVideoElement): boolean {
  return Boolean(video.closest(".tile.singing"));
}

function hudSong(): string {
  return (document.querySelector(".stage-song")?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function hudBadge(): string {
  return (document.querySelector(".badge")?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function hudTimer(): string {
  const el = document.querySelector(".timer");
  if (!el) return "";
  const first = el.childNodes[0];
  return (first?.textContent ?? "").replace(/\s+/g, " ").trim();
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

export function drawStageFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  opts: { hud?: boolean } = {},
): { lyric: string } {
  ctx.fillStyle = "#070b14";
  ctx.fillRect(0, 0, width, height);

  const videos = collectVideos();
  const gap = 5;
  const count = Math.max(1, videos.length);
  const paneW = count === 1 ? width : (width - gap) / count;
  const names = tileNames();

  if (!videos.length) {
    ctx.fillStyle = "rgba(206, 224, 255, 0.45)";
    ctx.font = "500 28px Outfit, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Waiting for cameras…", width / 2, height / 2);
  } else {
    videos.forEach((video, i) => {
      const x = i * (paneW + gap);
      drawCover(ctx, video, x, 0, paneW, height, isMirrored(video));
      if (isSinging(video)) {
        ctx.strokeStyle = "rgba(121, 180, 255, 0.85)";
        ctx.lineWidth = 6;
        ctx.strokeRect(x + 3, 3, paneW - 6, height - 6);
      }
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
  }

  const lyric = currentLyric();
  const upcoming = nextLyric();
  if (lyric || upcoming) {
    const fade = ctx.createLinearGradient(0, height - 220, 0, height);
    fade.addColorStop(0, "rgba(4, 6, 12, 0)");
    fade.addColorStop(0.4, "rgba(4, 6, 12, 0.5)");
    fade.addColorStop(1, "rgba(4, 6, 12, 0.9)");
    ctx.fillStyle = fade;
    ctx.fillRect(0, height - 220, width, 220);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (lyric) {
      ctx.fillStyle = "#ffffff";
      ctx.font = "600 34px Outfit, sans-serif";
      wrapLine(ctx, lyric, width / 2, upcoming ? height - 78 : height - 54, width - 96, 40, 2);
    }
    if (upcoming) {
      ctx.fillStyle = "rgba(206, 224, 255, 0.62)";
      ctx.font = "500 20px Outfit, sans-serif";
      ctx.fillText(upcoming, width / 2, height - 32, width - 120);
    }
  }

  if (opts.hud) {
    const top = ctx.createLinearGradient(0, 0, 0, 88);
    top.addColorStop(0, "rgba(4, 6, 12, 0.78)");
    top.addColorStop(1, "rgba(4, 6, 12, 0)");
    ctx.fillStyle = top;
    ctx.fillRect(0, 0, width, 88);

    ctx.fillStyle = "#ffffff";
    ctx.font = "400 28px 'Bebas Neue', sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("ARIA", 28, 32);

    const song = hudSong();
    if (song) {
      ctx.fillStyle = "rgba(206, 224, 255, 0.86)";
      ctx.font = "500 20px Outfit, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(song, width / 2, 32, width - 360);
    }

    const badge = hudBadge();
    const timer = hudTimer();
    ctx.textAlign = "right";
    ctx.fillStyle = "#79b4ff";
    ctx.font = "600 18px Outfit, sans-serif";
    const right = [badge, timer].filter(Boolean).join("   ");
    if (right) ctx.fillText(right, width - 28, 32);
  }

  return { lyric };
}
