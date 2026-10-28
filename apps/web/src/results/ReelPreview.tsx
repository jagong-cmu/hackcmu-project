/**
 * Dev-only checks for the match video's results outro (via /results-preview).
 *
 *   ?outro=ranked|loss|draw|duet|solo|forfeit[&t=ms]  one outro frame (or the loop)
 *   ?reel=1                                           the whole record → hold → outro run
 */
import type { ScoreCard } from "@karaoke/shared";
import { useEffect, useRef, useState } from "react";
import { ResultsModal, ScoringWait } from "./ResultsModal.tsx";
import { holdMatchReel, startMatchReel } from "./matchReel.ts";
import { drawReelOutro } from "./reelOutro.ts";
import { buildReelResults, OutroMs, type ReelResultsInput } from "./reelResults.ts";
import { useMatchReel, useMatchReelPending } from "./useMatchMoment.ts";
import {
  BG,
  FG,
  loadCardFonts,
  rgba,
} from "./cardPaint.ts";

const card = (
  overall: number,
  pitch: number,
  tone: number,
  source: ScoreCard["source"] = "dsp+gemini",
): ScoreCard => ({ overall, pitch, tone, silence: false, verdict: "", source });

const BASE: ReelResultsInput = {
  you: card(87, 84, 92),
  youName: "Jonathan",
  opponent: card(73, 70, 79),
  opponentName: "Alex",
  versus: true,
  winnerId: "a",
  youId: "a",
  opponentId: "b",
  eloDelta: 16,
  songTitle: "Viva La Vida",
  songArtist: "Coldplay",
  kicker: "Locked in",
  caption: "Pitch locked on the chorus. Tone stayed warm all the way through.",
};

function variant(name: string): ReelResultsInput {
  switch (name) {
    case "loss":
      return { ...BASE, winnerId: "b", you: card(68, 61, 77), opponent: card(81, 83, 78), eloDelta: -12 };
    case "draw":
      return { ...BASE, winnerId: "draw", opponent: card(87, 86, 88), eloDelta: 0, caption: "Dead even. One more chorus and someone blinks." };
    case "duet":
      return { ...BASE, winnerId: null, eloDelta: null, shared: 80, caption: "Oh, you killed it together. That blend is locked in." };
    case "solo":
      return { ...BASE, opponent: null, versus: false, winnerId: null, eloDelta: null, kicker: "Big finish" };
    case "forfeit":
      return { ...BASE, opponent: null, opponentLeft: true, forfeit: true, eloDelta: 8, caption: "" };
    default:
      return BASE;
  }
}

export function ReelOutroPreview() {
  const params = new URLSearchParams(window.location.search);
  const name = params.get("outro") || "ranked";
  const fixed = params.get("t");
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const results = buildReelResults(variant(name));
    let raf = 0;
    let cancelled = false;
    void loadCardFonts().then(() => {
      if (cancelled) return;
      if (fixed != null) {
        drawReelOutro(ctx, canvas.width, canvas.height, results, Number(fixed));
        canvas.dataset.ready = "1";
        return;
      }
      const start = performance.now();
      const tick = () => {
        const t = (performance.now() - start) % (OutroMs + 800);
        drawReelOutro(ctx, canvas.width, canvas.height, results, t);
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [name, fixed]);

  return (
    <div style={{ background: BG, minHeight: "100vh", display: "grid", placeItems: "center" }}>
      <canvas ref={ref} width={1280} height={720} style={{ width: "min(100vw, 1280px)", aspectRatio: "16 / 9" }} />
    </div>
  );
}

/** A fake camera: an animated canvas piped into a <video>. */
function FakeCam({ name, hue }: { name: string; hue: number }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 720;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    const tick = (now: number) => {
      const g = ctx.createRadialGradient(320, 300, 20, 320, 300, 420);
      g.addColorStop(0, `hsl(${hue} 80% 60%)`);
      g.addColorStop(1, `hsl(${hue + 30} 60% 12%)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 640, 720);
      ctx.fillStyle = rgba(FG, 0.22);
      ctx.beginPath();
      ctx.ellipse(320 + Math.sin(now / 400) * 30, 300, 110, 140, 0, 0, Math.PI * 2);
      ctx.fill();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const stream = canvas.captureStream(30);
    if (ref.current) ref.current.srcObject = stream;
    return () => {
      cancelAnimationFrame(raf);
      stream.getTracks().forEach((t) => t.stop());
    };
  }, [hue]);
  return (
    <div className="stage-cam" style={{ width: 240, display: "inline-block", margin: 4 }}>
      <video ref={ref} autoPlay muted playsInline style={{ width: "100%" }} />
      <span className="name">{name}</span>
    </div>
  );
}

type Step = "idle" | "singing" | "scoring" | "results";

/** Record a fake match end to end: sing → hold → scoring wait → results outro. */
export function ReelRunPreview() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [step, setStep] = useState<Step>("idle");
  const [enriched, setEnriched] = useState(false);
  const reel = useMatchReel();
  const pending = useMatchReelPending();
  const key = "preview-reel";

  const run = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = 62;
    void audio.play();
    setStep("singing");
    window.setTimeout(() => startMatchReel(key, null), 300);
    window.setTimeout(() => {
      // Stage's clock halts the instrumental dead at the clip end.
      audio.pause();
      holdMatchReel(key);
      setStep("scoring");
    }, 4300);
    window.setTimeout(() => setStep("results"), 6800);
    // Gemini's verdict lands after the DSP numbers.
    window.setTimeout(() => setEnriched(true), 7800);
  };

  useEffect(() => {
    (window as unknown as { __reel?: unknown }).__reel = reel;
  }, [reel]);

  const you: ScoreCard = {
    ...card(87, 84, 92, enriched ? "dsp+gemini" : "dsp"),
    verdict: enriched ? "Pitch locked on the chorus. Tone stayed warm all the way through." : "",
  };

  return (
    <div style={{ padding: 16 }}>
      <p className="stage-song" style={{ color: FG }}>
        Viva La Vida — Coldplay
      </p>
      <FakeCam name="Alex" hue={210} />
      <FakeCam name="Jonathan" hue={260} />
      <p className="lyrics-now" style={{ color: FG }}>
        I used to rule the world
      </p>
      <audio ref={audioRef} className="instrumental" src="/songs/viva-la-vida/instrumental.mp3" preload="auto" />
      <p style={{ color: FG }} data-step={step} data-pending={pending ? "1" : "0"} data-reel={reel ? "1" : "0"} id="reel-status">
        step {step} · pending {String(pending)} · reel {reel ? `${Math.round(reel.blob.size / 1024)} KB` : "none"}
      </p>
      {step === "idle" ? (
        <button type="button" className="cta" id="reel-run" onClick={run}>
          Record a fake match
        </button>
      ) : null}
      {step === "scoring" ? <ScoringWait /> : null}
      {step === "results" ? (
        <ResultsModal
          you={you}
          youName="You"
          shareName="Jonathan"
          opponent={card(73, 70, 79, "dsp")}
          opponentName="Alex"
          revealOpponent
          winnerId="a"
          youId="a"
          opponentId="b"
          eloDelta={16}
          songTitle="Viva La Vida"
          songArtist="Coldplay"
        />
      ) : null}
    </div>
  );
}
