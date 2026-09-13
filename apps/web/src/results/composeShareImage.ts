import type { MatchMoment } from "./matchMoment.ts";

export type ShareCardInput = {
  moment: MatchMoment | null;
  kicker: string;
  songTitle: string;
  songArtist: string;
  youName: string;
  youScore: number;
  opponentName?: string;
  opponentScore?: number | null;
  youWon?: boolean;
  theyWon?: boolean;
  shared?: number | null;
  eloDelta?: number | null;
  verdict?: string;
};

const W = 1080;
const H = 1350;

const INK = "#04060c";
const FG = "#ffffff";
const DIM = "rgba(206, 224, 255, 0.62)";
const BLUE = "#79b4ff";
const BLUE_DEEP = "#1b4fa3";
const GOOD = "#3ee08a";
const DANGER = "#ff8a8a";

async function loadFonts() {
  await document.fonts.ready;
  await Promise.all([
    document.fonts.load("400 96px 'Bebas Neue'"),
    document.fonts.load("600 42px Outfit"),
    document.fonts.load("500 28px Outfit"),
    document.fonts.load("400 24px Outfit"),
  ]);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function wrap(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
) {
  const words = text.split(/\s+/);
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
  shown.forEach((entry, i) => ctx.fillText(entry, x, y + i * lineHeight));
  return shown.length;
}

export async function composeShareImage(input: ShareCardInput): Promise<Blob> {
  await loadFonts();

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not draw the share card");

  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, W, H);

  const bloom = ctx.createRadialGradient(W * 0.5, 210, 20, W * 0.5, 280, 640);
  bloom.addColorStop(0, "rgba(79, 151, 245, 0.38)");
  bloom.addColorStop(0.45, "rgba(27, 79, 163, 0.16)");
  bloom.addColorStop(1, "rgba(4, 6, 12, 0)");
  ctx.fillStyle = bloom;
  ctx.fillRect(0, 0, W, 760);

  ctx.fillStyle = FG;
  ctx.font = "400 64px 'Bebas Neue', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const brand = "ARIA";
  const brandGap = 18;
  const brandWidth =
    [...brand].reduce((sum, ch) => sum + ctx.measureText(ch).width, 0) + brandGap * (brand.length - 1);
  let brandX = W / 2 - brandWidth / 2;
  for (const ch of brand) {
    ctx.fillText(ch, brandX + ctx.measureText(ch).width / 2, 44);
    brandX += ctx.measureText(ch).width + brandGap;
  }

  ctx.strokeStyle = "rgba(121, 180, 255, 0.35)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(360, 118);
  ctx.lineTo(720, 118);
  ctx.stroke();
  ctx.fillStyle = BLUE;
  ctx.beginPath();
  ctx.arc(W / 2, 118, 3.5, 0, Math.PI * 2);
  ctx.fill();

  const frameX = 48;
  const frameY = 136;
  const frameW = W - 96;
  const frameH = 560;
  roundRect(ctx, frameX, frameY, frameW, frameH, 28);
  ctx.fillStyle = "#070b14";
  ctx.fill();
  ctx.save();
  roundRect(ctx, frameX, frameY, frameW, frameH, 28);
  ctx.clip();

  if (input.moment) {
    const bitmap = await createImageBitmap(input.moment.blob);
    const scale = Math.max(frameW / bitmap.width, frameH / bitmap.height);
    const dw = bitmap.width * scale;
    const dh = bitmap.height * scale;
    ctx.drawImage(bitmap, frameX + (frameW - dw) / 2, frameY + (frameH - dh) / 2, dw, dh);
    bitmap.close();
  } else {
    ctx.fillStyle = "#0c1320";
    ctx.fillRect(frameX, frameY, frameW, frameH);
    ctx.fillStyle = DIM;
    ctx.font = "500 28px Outfit, sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText("The room went dark", W / 2, frameY + frameH / 2);
  }
  ctx.restore();

  ctx.strokeStyle = "rgba(168, 208, 255, 0.28)";
  ctx.lineWidth = 1.5;
  roundRect(ctx, frameX, frameY, frameW, frameH, 28);
  ctx.stroke();

  let y = frameY + frameH + 36;
  ctx.fillStyle = FG;
  ctx.font = "600 48px Outfit, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText(input.songTitle || "Karaoke", W / 2, y, frameW);
  y += 56;
  ctx.fillStyle = DIM;
  ctx.font = "400 28px Outfit, sans-serif";
  ctx.fillText(input.songArtist || "Aria", W / 2, y, frameW);
  y += 64;

  const hasOpp = Boolean(input.opponentName) && input.opponentScore != null;
  if (hasOpp) {
    const leftX = 220;
    const rightX = W - 220;
    ctx.font = "500 30px Outfit, sans-serif";
    ctx.fillStyle = DIM;
    ctx.textAlign = "center";
    ctx.fillText(input.youName, leftX, y);
    ctx.fillText(input.opponentName ?? "Them", rightX, y);
    y += 46;
    ctx.font = "400 140px 'Bebas Neue', sans-serif";
    ctx.textBaseline = "top";
    ctx.fillStyle = input.youWon ? GOOD : FG;
    ctx.fillText(String(Math.round(input.youScore)), leftX, y);
    ctx.fillStyle = input.theyWon ? GOOD : FG;
    ctx.fillText(String(Math.round(input.opponentScore ?? 0)), rightX, y);

    ctx.strokeStyle = "rgba(121, 180, 255, 0.25)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(W / 2, y + 28);
    ctx.lineTo(W / 2, y + 112);
    ctx.stroke();
    ctx.fillStyle = DIM;
    ctx.font = "500 24px Outfit, sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText("vs", W / 2, y + 72);
    y += 156;
  } else {
    ctx.fillStyle = FG;
    ctx.font = "400 180px 'Bebas Neue', sans-serif";
    ctx.textBaseline = "top";
    ctx.fillText(String(Math.round(input.youScore)), W / 2, y - 12);
    y += 168;
  }

  ctx.fillStyle = FG;
  ctx.font = "600 40px Outfit, sans-serif";
  ctx.textBaseline = "top";
  ctx.fillText(input.kicker, W / 2, y, frameW);
  y += 52;

  const chips: string[] = [];
  if (input.shared != null) chips.push(`Shared ${Math.round(input.shared)}`);
  if (input.eloDelta != null) {
    chips.push(
      input.eloDelta === 0
        ? "ELO unchanged"
        : `${input.eloDelta > 0 ? "+" : ""}${input.eloDelta} ELO`,
    );
  }
  if (chips.length) {
    ctx.fillStyle = input.eloDelta && input.eloDelta < 0 ? DANGER : BLUE;
    ctx.font = "500 28px Outfit, sans-serif";
    ctx.fillText(chips.join("   "), W / 2, y, frameW);
    y += 46;
  }

  const verdict = input.verdict?.trim();
  if (verdict) {
    ctx.fillStyle = "rgba(206, 224, 255, 0.78)";
    ctx.font = "400 26px Outfit, sans-serif";
    wrap(ctx, verdict, W / 2, y, frameW - 24, 34, 3);
    y += 90;
  }

  ctx.fillStyle = BLUE_DEEP;
  ctx.font = "500 22px Outfit, sans-serif";
  ctx.textBaseline = "bottom";
  ctx.fillText("aria", W / 2, H - 36);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((next) => (next ? resolve(next) : reject(new Error("share card"))), "image/png");
  });
  return blob;
}

export function shareFilename(songTitle: string): string {
  const slug = songTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `aria-${slug || "match"}.png`;
}

export function canNativeShare(file: File): boolean {
  const nav = navigator as Navigator & {
    canShare?: (data: ShareData) => boolean;
  };
  try {
    return Boolean(nav.share) && (nav.canShare ? nav.canShare({ files: [file] }) : true);
  } catch {
    return Boolean(nav.share);
  }
}

export async function nativeShare(file: File, title: string, text: string): Promise<boolean> {
  if (!canNativeShare(file)) return false;
  try {
    await navigator.share({ files: [file], title, text });
    return true;
  } catch (err) {
    if ((err as DOMException).name === "AbortError") return true;
    return false;
  }
}

export async function copyImage(blob: Blob): Promise<boolean> {
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    return true;
  } catch {
    return false;
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}
