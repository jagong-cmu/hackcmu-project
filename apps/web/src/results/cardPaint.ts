/**
 * Shared canvas look for the share card and the match-video outro: palette,
 * fonts, the spaced ARIA wordmark, the red bloom, and the chip copy.
 */

// Canvas painters cannot read CSS variables: these mirror theme/tokens.css
// (canvasPalette.test.ts fails if they drift).
export const BG = "#05070d";
export const PANEL = "#0d1220";
export const FG = "#e8eeff";
export const MUTED = "#8e9ab8";
export const RED = "#e5183b";
export const RED_TEXT = "#ff5c73";
export const BLUE = "#4d86ff";
export const BLUE_TEXT = "#7fa8ff";
export const ICE = "#bbd0ff";
export const DIM = MUTED;

/** A palette hex at an alpha, for gradients and translucent fills. */
export function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export const DISPLAY = "'Krona One', sans-serif";
export const BODY = "'Hanken Grotesk', sans-serif";

export async function loadCardFonts() {
  try {
    await document.fonts.ready;
    await Promise.all([
      document.fonts.load(`400 96px ${DISPLAY}`),
      document.fonts.load(`600 42px ${BODY}`),
      document.fonts.load(`500 28px ${BODY}`),
      document.fonts.load(`400 24px ${BODY}`),
    ]);
  } catch {
    /* fall back to system fonts */
  }
}

export function roundRect(
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

/** Word-wrap from the top line down. Returns how many lines it drew. */
export function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
): number {
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
  if (lines.length > maxLines) shown[maxLines - 1] = `${shown[maxLines - 1]}…`;
  shown.forEach((entry, i) => ctx.fillText(entry, x, y + i * lineHeight));
  return shown.length;
}

/** Soft blue glow behind the headline. */
export function paintBloom(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  height: number,
  width: number,
  strength = 1,
) {
  const bloom = ctx.createRadialGradient(cx, cy - radius * 0.11, 20, cx, cy, radius);
  bloom.addColorStop(0, rgba(RED, 0.38 * strength));
  bloom.addColorStop(0.45, rgba(RED, 0.16 * strength));
  bloom.addColorStop(1, rgba(BG, 0));
  ctx.fillStyle = bloom;
  ctx.fillRect(0, 0, width, height);
}

/** "A R I A" with a hairline and a dot under it, centred on cx. Returns the rule's y. */
export function paintWordmark(
  ctx: CanvasRenderingContext2D,
  cx: number,
  top: number,
  size: number,
) {
  const brand = "ARIA";
  const gap = size * 0.28;
  ctx.fillStyle = FG;
  ctx.font = `400 ${size}px ${DISPLAY}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const width =
    [...brand].reduce((sum, ch) => sum + ctx.measureText(ch).width, 0) + gap * (brand.length - 1);
  let x = cx - width / 2;
  for (const ch of brand) {
    const w = ctx.measureText(ch).width;
    ctx.fillText(ch, x + w / 2, top);
    x += w + gap;
  }

  const ruleY = top + size * 1.16;
  const half = size * 2.8;
  ctx.strokeStyle = rgba(ICE, 0.35);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - half, ruleY);
  ctx.lineTo(cx + half, ruleY);
  ctx.stroke();
  ctx.fillStyle = RED;
  ctx.beginPath();
  ctx.arc(cx, ruleY, Math.max(2.5, size * 0.055), 0, Math.PI * 2);
  ctx.fill();
  return ruleY;
}

export function eloLabel(delta: number): string {
  if (delta === 0) return "ELO unchanged";
  return `${delta > 0 ? "+" : "−"}${Math.abs(delta)} ELO`;
}

export function eloColor(delta: number): string {
  // The sign carries the meaning; red and blue stay reserved for you / them.
  return delta > 0 ? ICE : MUTED;
}

/** Same bands as the on-screen meters (scoreBand). */
export function bandColor(n: number): string {
  if (n >= 80) return ICE;
  if (n >= 55) return FG;
  return MUTED;
}
