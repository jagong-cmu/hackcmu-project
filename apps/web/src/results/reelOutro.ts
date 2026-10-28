/**
 * Paints the results card that closes the match video: who sang, the scores,
 * who won, and the ELO swing. Same palette and wordmark as the share card.
 * What it says and when it rolls live in reelResults.ts.
 */
import {
  bandColor,
  BG,
  BODY,
  DIM,
  DISPLAY,
  eloColor,
  eloLabel,
  FG,
  ICE,
  paintBloom,
  paintWordmark,
  RED_TEXT,
  rgba,
  roundRect,
  wrapText,
} from "./cardPaint.ts";
import {
  outroBeat,
  shownScore,
  span,
  type OutroBeat,
  type ReelPlayer,
  type ReelResults,
} from "./reelResults.ts";

function paintBackdrop(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  backdrop: CanvasImageSource | null,
  soft: CanvasImageSource | null,
  mix: number,
) {
  ctx.globalAlpha = 1;
  if (backdrop && mix < 1) {
    ctx.drawImage(backdrop, 0, 0, w, h);
  } else {
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, w, h);
  }
  if (mix <= 0) return;
  ctx.globalAlpha = mix;
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);
  if (soft) {
    ctx.globalAlpha = mix * 0.32;
    ctx.drawImage(soft, 0, 0, w, h);
  }
  ctx.globalAlpha = mix;
  paintBloom(ctx, w / 2, h * 0.36, h * 0.82, h, w, 1);
  const vignette = ctx.createLinearGradient(0, h * 0.55, 0, h);
  vignette.addColorStop(0, rgba(BG, 0));
  vignette.addColorStop(1, rgba(BG, 0.7));
  ctx.fillStyle = vignette;
  ctx.fillRect(0, h * 0.55, w, h * 0.45);
  ctx.globalAlpha = 1;
}

function paintMeter(
  ctx: CanvasRenderingContext2D,
  label: string,
  value: number,
  count: number,
  cx: number,
  y: number,
  width: number,
) {
  const n = Math.max(0, Math.min(100, Math.round(value)));
  const left = cx - width / 2;
  ctx.font = `500 17px ${BODY}`;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillStyle = DIM;
  ctx.fillText(label.toUpperCase(), left, y);
  ctx.textAlign = "right";
  ctx.fillStyle = FG;
  ctx.fillText(String(Math.round(n * count)), left + width, y);
  const trackY = y + 9;
  roundRect(ctx, left, trackY, width, 6, 3);
  ctx.fillStyle = rgba(FG, 0.1);
  ctx.fill();
  const fill = (width * n * count) / 100;
  if (fill > 0.5) {
    roundRect(ctx, left, trackY, Math.max(6, fill), 6, 3);
    ctx.fillStyle = bandColor(n);
    ctx.fill();
  }
}

function paintPlayer(
  ctx: CanvasRenderingContext2D,
  player: ReelPlayer,
  cx: number,
  top: number,
  colW: number,
  big: number,
  beat: OutroBeat,
  hasWinner: boolean,
  solo = false,
) {
  const lift = player.winner ? beat.headline : 0;
  // The caller fades the whole card in; scale every alpha by that.
  const base = ctx.globalAlpha;

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.font = `500 26px ${BODY}`;
  ctx.fillStyle = player.winner && lift > 0 ? FG : DIM;
  ctx.fillText(player.name, cx, top, colW - 24);

  const scoreTop = top + 40;
  if (player.winner && lift > 0) {
    ctx.save();
    ctx.globalAlpha = base * lift;
    const glow = ctx.createRadialGradient(cx, scoreTop + big * 0.45, 4, cx, scoreTop + big * 0.45, big);
    glow.addColorStop(0, rgba(ICE, 0.28));
    glow.addColorStop(1, rgba(ICE, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(cx - big * 1.2, scoreTop - big * 0.3, big * 2.4, big * 1.6);
    ctx.restore();
  }

  ctx.font = `400 ${big}px ${DISPLAY}`;
  ctx.textBaseline = "top";
  const dim = hasWinner && !player.winner ? 0.72 : 1;
  ctx.globalAlpha = base * dim;
  const banded = solo && player.card && !player.card.silence ? bandColor(player.card.overall) : null;
  ctx.fillStyle = player.winner && lift > 0 ? ICE : (banded ?? (player.card ? FG : DIM));
  ctx.fillText(shownScore(player.card, beat.count), cx, scoreTop);
  ctx.globalAlpha = base;

  if (player.winner) {
    ctx.save();
    ctx.globalAlpha = base * lift;
    ctx.font = `600 15px ${BODY}`;
    const tag = "WINNER";
    const tw = ctx.measureText(tag).width + 26;
    const ty = top - 34 + (1 - lift) * 8;
    roundRect(ctx, cx - tw / 2, ty, tw, 24, 12);
    ctx.fillStyle = rgba(ICE, 0.16);
    ctx.fill();
    ctx.strokeStyle = rgba(ICE, 0.7);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = ICE;
    ctx.textBaseline = "middle";
    ctx.fillText(tag, cx, ty + 12.5);
    ctx.restore();
  }

  const metersTop = scoreTop + big * 0.92 + 18;
  const meterW = Math.min(300, colW - 60);
  if (player.card && !player.card.silence) {
    paintMeter(ctx, "Pitch", player.card.pitch, beat.count, cx, metersTop + 16, meterW);
    paintMeter(ctx, "Tone", player.card.tone, beat.count, cx, metersTop + 56, meterW);
  } else {
    ctx.font = `500 20px ${BODY}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = DIM;
    ctx.fillText(
      player.card?.silence ? "We couldn't hear this one" : (player.note ?? "No score"),
      cx,
      metersTop + 12,
      colW - 40,
    );
  }

  if (player.eloDelta != null) {
    ctx.save();
    ctx.globalAlpha = base * beat.details;
    ctx.font = `600 20px ${BODY}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = eloColor(player.eloDelta);
    ctx.fillText(eloLabel(player.eloDelta), cx, metersTop + 84 + (1 - beat.details) * 6);
    ctx.restore();
  }
}

export type OutroArt = {
  /** Last stage frame, for the crossfade in. */
  backdrop?: CanvasImageSource | null;
  /** Blurred, dimmed copy of it, kept faintly behind the card. */
  soft?: CanvasImageSource | null;
};

/** One frame of the results outro at tMs since it started. */
export function drawReelOutro(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  results: ReelResults,
  tMs: number,
  art: OutroArt = {},
) {
  const beat = outroBeat(tMs);
  paintBackdrop(ctx, w, h, art.backdrop ?? null, art.soft ?? null, beat.mix);
  if (beat.mix <= 0) return;

  ctx.save();
  ctx.globalAlpha = beat.mix;

  const ruleY = paintWordmark(ctx, w / 2, 26, 38);

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = FG;
  ctx.font = `600 28px ${BODY}`;
  ctx.fillText(results.songTitle, w / 2, ruleY + 18, w - 200);
  if (results.songArtist) {
    ctx.fillStyle = DIM;
    ctx.font = `400 19px ${BODY}`;
    ctx.fillText(results.songArtist, w / 2, ruleY + 54, w - 200);
  }

  const versus = results.players.length > 1;
  const hasWinner = results.players.some((p) => p.winner);
  const colTop = ruleY + (versus ? 140 : 124);
  if (versus) {
    const leftX = w * 0.27;
    const rightX = w * 0.73;
    const colW = w * 0.42;
    paintPlayer(ctx, results.players[0], leftX, colTop, colW, 132, beat, hasWinner);
    paintPlayer(ctx, results.players[1], rightX, colTop, colW, 132, beat, hasWinner);

    const midY = colTop + 112;
    ctx.strokeStyle = rgba(ICE, 0.25);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(w / 2, midY - 70);
    ctx.lineTo(w / 2, midY - 22);
    ctx.moveTo(w / 2, midY + 22);
    ctx.lineTo(w / 2, midY + 70);
    ctx.stroke();
    ctx.fillStyle = DIM;
    ctx.font = `500 22px ${BODY}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(results.shared != null ? "&" : "vs", w / 2, midY);
  } else {
    paintPlayer(ctx, results.players[0], w / 2, colTop, w * 0.6, 150, beat, false, true);
  }

  const headTop = h - 178;
  ctx.save();
  ctx.globalAlpha = beat.mix * beat.headline;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = FG;
  ctx.font = `600 40px ${BODY}`;
  ctx.fillText(results.headline, w / 2, headTop + (1 - beat.headline) * 10, w - 160);
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = beat.mix * beat.details;
  let y = headTop + 54;
  if (results.shared != null) {
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = RED_TEXT;
    ctx.font = `600 22px ${BODY}`;
    ctx.fillText(`Shared score ${Math.round(results.shared)}`, w / 2, y);
    y += 34;
  }
  if (results.caption) {
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = rgba(FG, 0.78);
    ctx.font = `400 21px ${BODY}`;
    wrapText(ctx, results.caption, w / 2, y, w - 280, 28, results.shared != null ? 1 : 2);
  }
  ctx.restore();

  ctx.restore();
}

/** Short brand close when the results never showed up. */
export function drawReelSting(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  songTitle: string,
  tMs: number,
  art: OutroArt = {},
) {
  const mix = span(tMs, 0, 600);
  paintBackdrop(ctx, w, h, art.backdrop ?? null, art.soft ?? null, mix);
  if (mix <= 0) return;
  ctx.save();
  ctx.globalAlpha = mix;
  const ruleY = paintWordmark(ctx, w / 2, h / 2 - 70, 64);
  if (songTitle) {
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = DIM;
    ctx.font = `500 24px ${BODY}`;
    ctx.fillText(songTitle, w / 2, ruleY + 24, w - 200);
  }
  ctx.restore();
}
