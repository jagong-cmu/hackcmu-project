import { useEffect, useRef } from "react";
import type { MelodyFile } from "@karaoke/shared";
import { melodyHzAt } from "./scoreClip.ts";
import { centsError } from "./cents.ts";

type Props = {
  melody: MelodyFile | null;
  playheadSec: number;
  liveHz: number | null;
  liveClarity: number;
};

export function PitchMeter({ melody, playheadSec, liveHz, liveClarity }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = "#0c0c0c";
    ctx.fillRect(0, 0, w, h);

    const mid = w / 2;
    ctx.strokeStyle = "rgba(201,162,39,0.85)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(mid, 10);
    ctx.lineTo(mid, h - 10);
    ctx.stroke();

    ctx.fillStyle = "rgba(244,239,230,0.55)";
    ctx.font = "12px Outfit, sans-serif";
    ctx.fillText("flat", 12, h - 12);
    ctx.textAlign = "right";
    ctx.fillText("sharp", w - 12, h - 12);
    ctx.textAlign = "left";

    const target = melody ? melodyHzAt(melody, playheadSec) : null;
    ctx.fillStyle = "#f4efe6";
    ctx.font = "13px Outfit, sans-serif";
    ctx.fillText(target ? `guide ${Math.round(target)} Hz` : "rest", 12, 18);

    if (liveHz && liveClarity > 0.5 && target) {
      const cents = Math.max(-200, Math.min(200, signedCents(liveHz, target)));
      const x = mid + (cents / 200) * (w * 0.42);
      const inTune = Math.abs(cents) < 40;
      ctx.fillStyle = inTune ? "#c9a227" : "#f4efe6";
      ctx.beginPath();
      ctx.arc(x, h / 2, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#070707";
      ctx.font = "600 11px Outfit, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`${cents > 0 ? "+" : ""}${Math.round(cents)}¢`, x, h / 2 + 4);
      ctx.textAlign = "left";
    } else if (liveHz && liveClarity > 0.5) {
      ctx.fillStyle = "#c9a227";
      ctx.beginPath();
      ctx.arc(mid, h / 2, 10, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [melody, playheadSec, liveHz, liveClarity]);

  return <canvas ref={ref} className="pitch-meter" width={720} height={88} />;
}

function signedCents(sungHz: number, targetHz: number): number {
  const err = centsError(sungHz, targetHz);
  const sung = 69 + 12 * Math.log2(sungHz / 440);
  const target = 69 + 12 * Math.log2(targetHz / 440);
  let diff = sung - target;
  diff -= 12 * Math.round(diff / 12);
  return diff * 100 * (err === Infinity ? 0 : 1);
}
