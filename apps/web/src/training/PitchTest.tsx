/**
 * Dev-only pitch detector readout.
 *
 * No backing track and no speaker cancellation, so it isolates the detector
 * from every other variable in Training. Sing into it, then export the log so
 * detected-vs-sung can be checked offline.
 */
import { PitchDetector } from "pitchy";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { LayersModel } from "@tensorflow/tfjs";
import { crepeFromBuffer, preloadCrepe } from "../scoring/crepePitch.ts";
import { rmsOf } from "../scoring/pitchGuide.ts";

const FFT = 4096;
const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function noteOf(hz: number): { name: string; cents: number } {
  const midi = 69 + 12 * Math.log2(hz / 440);
  const near = Math.round(midi);
  return {
    name: `${NAMES[((near % 12) + 12) % 12]}${Math.floor(near / 12) - 1}`,
    cents: Math.round((midi - near) * 100),
  };
}

type Sample = {
  t: number;
  crepeHz: number | null;
  crepeConf: number;
  yinHz: number | null;
  yinClarity: number;
  rms: number;
};

export function PitchTest() {
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("Press Start, then sing a slow low-to-high glide.");
  const [s, setS] = useState<Sample | null>(null);
  const [count, setCount] = useState(0);
  const [copied, setCopied] = useState(false);

  const crepeRef = useRef<LayersModel | null>(null);
  const logRef = useRef<Sample[]>([]);
  const rafRef = useRef<number>(0);
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    void preloadCrepe()
      .then((m) => {
        crepeRef.current = m;
        setStatus("CREPE loaded. Press Start, then sing a slow low-to-high glide.");
      })
      .catch(() => setStatus("CREPE unavailable — YIN only. Press Start."));
    return () => stopRef.current?.();
  }, []);

  async function start() {
    logRef.current = [];
    setCount(0);
    setCopied(false);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch {
      setStatus("Mic blocked.");
      return;
    }
    const ctx = new AudioContext();
    await ctx.resume();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = FFT;
    analyser.smoothingTimeConstant = 0;
    src.connect(analyser);
    const buf = new Float32Array(FFT);
    const detector = PitchDetector.forFloat32Array(FFT);
    const t0 = performance.now();
    let skip = 0;
    let lastCrepe = { hz: null as number | null, confidence: 0 };

    setRunning(true);
    setStatus("Listening. Sing a slow glide from your lowest to your highest note.");

    const tick = () => {
      analyser.getFloatTimeDomainData(buf);
      const rms = rmsOf(buf);
      const [yinHz, yinClarity] = detector.findPitch(buf, ctx.sampleRate);
      const model = crepeRef.current;
      if (model && skip++ % 2 === 0) {
        try {
          lastCrepe = crepeFromBuffer(model, buf, ctx.sampleRate);
        } catch {
          /* keep previous */
        }
      }
      const sample: Sample = {
        t: +((performance.now() - t0) / 1000).toFixed(3),
        crepeHz: lastCrepe.hz ? +lastCrepe.hz.toFixed(2) : null,
        crepeConf: +lastCrepe.confidence.toFixed(3),
        yinHz: Number.isFinite(yinHz) && yinHz > 0 ? +yinHz.toFixed(2) : null,
        yinClarity: +yinClarity.toFixed(3),
        rms: +rms.toFixed(4),
      };
      if (rms >= 0.01) {
        logRef.current.push(sample);
        setCount(logRef.current.length);
      }
      setS(sample);
      rafRef.current = requestAnimationFrame(tick);
    };

    stopRef.current = () => {
      cancelAnimationFrame(rafRef.current);
      stream.getTracks().forEach((tr) => tr.stop());
      src.disconnect();
      void ctx.close();
      setRunning(false);
      stopRef.current = null;
      setStatus(`Stopped. ${logRef.current.length} voiced samples captured.`);
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  const crepeNote = s?.crepeHz ? noteOf(s.crepeHz) : null;
  const yinNote = s?.yinHz ? noteOf(s.yinHz) : null;
  const agree =
    s?.crepeHz && s?.yinHz ? Math.abs(12 * Math.log2(s.crepeHz / s.yinHz)) : null;

  return (
    <main className="page training">
      <header className="row-head">
        <Link to="/" className="back">
          Home
        </Link>
        <h1>Pitch test</h1>
      </header>

      <p className="status">{status}</p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", margin: "1.5rem 0" }}>
        <div>
          <p style={{ opacity: 0.6, margin: 0 }}>CREPE</p>
          <p style={{ fontSize: "2.4rem", fontWeight: 700, margin: 0 }}>{crepeNote?.name ?? "—"}</p>
          <p style={{ margin: 0 }}>
            {s?.crepeHz ? `${s.crepeHz.toFixed(1)} Hz` : "—"}{" "}
            {crepeNote ? `(${crepeNote.cents > 0 ? "+" : ""}${crepeNote.cents}¢)` : ""}
          </p>
          <p style={{ opacity: 0.6, margin: 0 }}>conf {s?.crepeConf.toFixed(2) ?? "—"}</p>
        </div>
        <div>
          <p style={{ opacity: 0.6, margin: 0 }}>YIN (pitchy)</p>
          <p style={{ fontSize: "2.4rem", fontWeight: 700, margin: 0 }}>{yinNote?.name ?? "—"}</p>
          <p style={{ margin: 0 }}>
            {s?.yinHz ? `${s.yinHz.toFixed(1)} Hz` : "—"}{" "}
            {yinNote ? `(${yinNote.cents > 0 ? "+" : ""}${yinNote.cents}¢)` : ""}
          </p>
          <p style={{ opacity: 0.6, margin: 0 }}>clarity {s?.yinClarity.toFixed(2) ?? "—"}</p>
        </div>
      </div>

      <p className="status">
        level {s ? (s.rms * 100).toFixed(1) : "0"}% · samples {count}
        {agree != null ? ` · detectors differ by ${agree.toFixed(1)} semitones` : ""}
        {agree != null && Math.abs(agree - 12) < 1 ? " ← OCTAVE DISAGREEMENT" : ""}
      </p>

      <div className="ctas">
        <button type="button" className="btn gold" disabled={running} onClick={() => void start()}>
          Start
        </button>
        <button type="button" className="btn ghost" disabled={!running} onClick={() => stopRef.current?.()}>
          Stop
        </button>
        <button
          type="button"
          className="btn ghost"
          disabled={running || count === 0}
          onClick={() => {
            void navigator.clipboard
              .writeText(JSON.stringify(logRef.current))
              .then(() => setCopied(true));
          }}
        >
          {copied ? "Copied" : `Copy ${count} samples`}
        </button>
      </div>
    </main>
  );
}
