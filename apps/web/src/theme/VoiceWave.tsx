import { useEffect, useRef } from "react";
import { sharedAudioContext, unlockSharedAudio } from "../media/audioContext.ts";

type Props = {
  /** LiveKit / getUserMedia stream. The wave follows this mic's volume. */
  stream?: MediaStream | null;
  /** 0–1 level from an analyser the page already owns (Training). */
  level?: number;
  className?: string;
};

/**
 * Futuristic Siri-style ribbon: a few luminous blue waves with a bright core,
 * fat in the middle, thin at the edges. Idle pages breathe; a live mic or
 * `level` makes the bulge follow volume.
 */
export function VoiceWave({ stream, level = 0, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const levelRef = useRef(level);
  levelRef.current = level;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let audio: AudioContext | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let analyser: AnalyserNode | null = null;
    let clone: MediaStreamTrack | null = null;
    // Pin the buffer type: getFloatTimeDomainData wants Float32Array<ArrayBuffer>,
    // and a bare Float32Array widens to ArrayBufferLike, which fails strict tsc.
    let buf: Float32Array<ArrayBuffer> | null = null;
    let micLevel = 0;
    let shown = 0.16;
    let phase = 0;
    let raf = 0;
    let alive = true;

    const track = stream?.getAudioTracks()[0];
    if (track && track.readyState === "live") {
      clone = track.clone();
      audio = sharedAudioContext();
      void unlockSharedAudio();
      source = audio.createMediaStreamSource(new MediaStream([clone]));
      analyser = audio.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.35;
      source.connect(analyser);
      buf = new Float32Array(analyser.fftSize);
    }

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const readMic = () => {
      if (!analyser || !buf) return 0;
      analyser.getFloatTimeDomainData(buf);
      let s = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = buf[i] ?? 0;
        s += v * v;
      }
      const rms = Math.sqrt(s / buf.length);
      return Math.min(1, Math.pow(rms / 0.07, 0.62));
    };

    const envelope = (t: number) => {
      const d = (t - 0.5) * 2;
      return Math.exp(-d * d * 3.6);
    };

    const stroke = (
      ctx: CanvasRenderingContext2D,
      w: number,
      h: number,
      amp: number,
      freq: number,
      offset: number,
      color: string,
      width: number,
      glow: number,
    ) => {
      const mid = h * 0.5;
      ctx.beginPath();
      const steps = Math.max(80, Math.floor(w / 3));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x = t * w;
        const env = envelope(t);
        const y =
          mid +
          Math.sin(t * Math.PI * 2 * freq + phase * freq + offset) * amp * env +
          Math.sin(t * Math.PI * 2 * freq * 0.5 + phase * 0.35 + offset) * amp * 0.22 * env;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.shadowColor = color;
      ctx.shadowBlur = glow;
      ctx.stroke();
    };

    const tick = () => {
      if (!alive) return;
      const w = canvas.width;
      const h = canvas.height;
      const ctx = ctx2d;

      const fromMic = readMic();
      micLevel = micLevel * 0.8 + fromMic * 0.2;
      const target = Math.max(levelRef.current, micLevel);
      const idle = 0.14 + Math.sin(phase * 0.35) * 0.04;
      const next = target > 0.02 ? 0.2 + target * 0.8 : idle;
      shown += (next - shown) * 0.12;

      if (!reduced) phase += 0.018 + shown * 0.01;

      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";

      const amp = h * 0.2 * shown;

      stroke(ctx, w, h, amp * 1.05, 1.15, 0, "rgba(70, 170, 255, 0.28)", Math.max(10, h * 0.035), 28);
      stroke(ctx, w, h, amp * 0.92, 1.7, 1.1, "rgba(120, 210, 255, 0.55)", Math.max(3, h * 0.01), 18);
      stroke(ctx, w, h, amp * 0.7, 2.35, 2.4, "rgba(160, 230, 255, 0.4)", Math.max(2, h * 0.007), 12);
      stroke(
        ctx,
        w,
        h,
        amp * (0.28 + shown * 0.22),
        1.05,
        0.2,
        // Blue only — this stroke was pink, the one warm note in the palette.
        `rgba(120, 190, 255, ${0.4 + shown * 0.5})`,
        Math.max(1.5, h * 0.0055),
        16,
      );
      stroke(ctx, w, h, amp * 0.18, 0.9, 0, "rgba(242, 248, 255, 0.85)", Math.max(1.2, h * 0.004), 8);

      ctx.globalCompositeOperation = "source-over";
      ctx.shadowBlur = 0;
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      source?.disconnect();
      clone?.stop();
    };
  }, [stream]);

  return (
    <canvas
      ref={canvasRef}
      className={["voice-wave", className ?? ""].filter(Boolean).join(" ")}
      aria-hidden="true"
    />
  );
}
