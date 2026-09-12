import { PitchDetector } from "pitchy";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { MelodyFile, ScoreCard, SongMeta } from "@karaoke/shared";
import type { LayersModel } from "@tensorflow/tfjs";
import { getClientId, getDisplayName, validName } from "../home/identity.ts";
import { LyricsOverlay } from "../lyrics/LyricsOverlay.tsx";
import { ResultsModal } from "../results/ResultsModal.tsx";
import { loadCatalog, loadSongPack, type ReadySong } from "../scoring/catalog.ts";
import { PitchMeter } from "../scoring/PitchMeter.tsx";
import {
  cancelSpeaker,
  createSpeakerCanceller,
  ensurePlaybackTap,
  isMusicOnly,
  PITCH_FFT,
} from "../scoring/cancelPlayback.ts";
import { crepeFromBuffer, preloadCrepe } from "../scoring/crepePitch.ts";
import { rmsOf } from "../scoring/pitchGuide.ts";
import { scoreContour, type PitchFrame } from "../scoring/scoreClip.ts";

export function Training() {
  const [songs, setSongs] = useState<ReadySong[]>([]);
  const [songId, setSongId] = useState("viva-la-vida");
  const [meta, setMeta] = useState<SongMeta | null>(null);
  const [melody, setMelody] = useState<MelodyFile | null>(null);
  const [lrc, setLrc] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const [status, setStatus] = useState("Pick a complete song, then Start.");
  const [running, setRunning] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [liveHz, setLiveHz] = useState<number | null>(null);
  const [liveClarity, setLiveClarity] = useState(0);
  const [liveRms, setLiveRms] = useState(0);
  const [card, setCard] = useState<ScoreCard | null>(null);
  const [camDenied, setCamDenied] = useState(false);

  const navigate = useNavigate();
  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const framesRef = useRef<PitchFrame[]>([]);
  const rafRef = useRef<number>(0);
  const stopRef = useRef<(() => void) | null>(null);

  const crepeRef = useRef<LayersModel | null>(null);

  useEffect(() => {
    void loadCatalog().then((list) => {
      setSongs(list);
      const first = list.find((s) => s.ready);
      if (first) setSongId(first.id);
    });
    void preloadCrepe()
      .then((model) => {
        crepeRef.current = model;
      })
      .catch(() => {
        crepeRef.current = null;
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const chosen = songs.find((s) => s.id === songId);
    if (!chosen?.ready) {
      setMeta(null);
      setMelody(null);
      setLrc("");
      setAudioUrl("");
      return;
    }
    void loadSongPack(songId).then((pack) => {
      if (cancelled) return;
      setMeta(pack.meta);
      setMelody(pack.melody);
      setLrc(pack.lrc);
      setAudioUrl(pack.audioUrl);
    });
    return () => {
      cancelled = true;
    };
  }, [songId, songs]);

  useEffect(() => () => stopRef.current?.(), []);

  async function start() {
    if (!meta || !melody) return;
    setCard(null);
    framesRef.current = [];
    setStatus("Allow the mic. Camera is optional.");

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
        video: true,
      });
    } catch {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: false,
        });
        setCamDenied(true);
      } catch {
        setStatus("Mic blocked. Chrome needs a mic for Training.");
        return;
      }
    }

    if (videoRef.current && stream.getVideoTracks().length) {
      videoRef.current.srcObject = stream;
      await videoRef.current.play().catch(() => undefined);
    }

    const audio = audioRef.current;
    if (!audio) return;
    audio.src = audioUrl;
    audio.volume = 0.8;
    audio.currentTime = meta.clipStartSec;

    const tap = ensurePlaybackTap(audio);
    const ctx = tap?.ctx ?? new AudioContext();
    await ctx.resume();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = PITCH_FFT;
    analyser.smoothingTimeConstant = 0;
    src.connect(analyser);
    const buf = new Float32Array(PITCH_FFT);
    const refBuf = new Float32Array(PITCH_FFT);
    const clean = new Float32Array(PITCH_FFT);
    const detector = PitchDetector.forFloat32Array(PITCH_FFT);
    const canceller = createSpeakerCanceller();

    await audio.play();

    const clipEnd = meta.clipStartSec + meta.clipDurationSec;
    setRunning(true);
    setStatus(crepeRef.current ? "CREPE is listening — sing the gold line." : "Sing the gold line.");

    let crepeSkip = 0;
    let lastCrepe = { hz: null as number | null, confidence: 0 };

    const tick = () => {
      const t = audio.currentTime;
      setPlayhead(t);
      analyser.getFloatTimeDomainData(buf);
      if (tap) {
        tap.analyser.getFloatTimeDomainData(refBuf);
        cancelSpeaker(buf, refBuf, canceller, clean);
      } else {
        clean.set(buf);
        refBuf.fill(0);
      }
      const musicOnly = isMusicOnly(buf, clean, refBuf);
      const rms = rmsOf(clean);
      if (musicOnly) {
        framesRef.current.push({ timeSec: t, hz: null, clarity: 0 });
        setLiveHz(null);
        setLiveClarity(0);
        setLiveRms(0);
      } else {
        const [yinHz, yinClarity] = detector.findPitch(clean, ctx.sampleRate);
        const model = crepeRef.current;
        if (model && crepeSkip++ % 2 === 0) {
          try {
            lastCrepe = crepeFromBuffer(model, clean, ctx.sampleRate);
          } catch {
            /* keep last CREPE frame */
          }
        }
        const useCrepe = lastCrepe.hz != null && lastCrepe.confidence >= 0.4;
        const hz = useCrepe ? lastCrepe.hz : yinHz;
        const clarity = useCrepe ? lastCrepe.confidence : yinClarity;
        const forScore = clarity >= 0.45 && hz != null && hz >= 55 && hz <= 1200 && rms >= 0.02;
        framesRef.current.push({
          timeSec: t,
          hz: forScore ? hz : null,
          clarity,
        });
        setLiveHz(useCrepe || (Number.isFinite(yinHz) && yinHz > 0) ? hz : null);
        setLiveClarity(clarity);
        setLiveRms(rms);
      }
      if (t >= clipEnd || audio.ended) {
        src.disconnect();
        void finish(stream);
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    const stop = () => {
      cancelAnimationFrame(rafRef.current);
      audio.pause();
      stream.getTracks().forEach((tr) => tr.stop());
      src.disconnect();
      setRunning(false);
      stopRef.current = null;
    };
    stopRef.current = stop;
    rafRef.current = requestAnimationFrame(tick);
  }

  async function finish(stream: MediaStream) {
    stopRef.current = null;
    cancelAnimationFrame(rafRef.current);
    audioRef.current?.pause();
    stream.getTracks().forEach((tr) => tr.stop());
    setRunning(false);
    if (!meta || !melody) return;

    const dsp = scoreContour(framesRef.current, melody, {
      startSec: meta.clipStartSec,
      durationSec: meta.clipDurationSec,
    });
    setStatus("Scoring…");
    const lyrics = lrc
      .split("\n")
      .map((l) => l.replace(/\[\d.+?\]/g, "").trim())
      .filter(Boolean)
      .slice(0, 12)
      .join("\n");
    try {
      const res = await fetch("/api/training/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: getClientId(),
          displayName: getDisplayName() || "Singer",
          songId: meta.id,
          lyrics,
          score: dsp,
        }),
      });
      const json = (await res.json()) as { score?: ScoreCard };
      setCard(json.score ?? dsp);
    } catch {
      setCard(dsp);
    }
    setStatus("Clip over.");
  }

  const readySongs = songs.filter((s) => s.ready);
  const nameOk = validName(getDisplayName());

  return (
    <main className="page training">
      <header className="row-head">
        <Link to="/" className="back">
          Home
        </Link>
        <h1>Training</h1>
      </header>

      <label className="song-pick">
        Song
        <select value={songId} disabled={running} onChange={(e) => setSongId(e.target.value)}>
          {songs.map((s) => (
            <option key={s.id} value={s.id} disabled={!s.ready}>
              {s.title} — {s.artist}
              {s.ready ? "" : " (incomplete)"}
            </option>
          ))}
        </select>
      </label>

      {!nameOk ? <p className="err">Set a display name on Home first.</p> : null}
      {readySongs.length === 0 ? <p className="err">No complete songs yet.</p> : null}

      <PitchMeter
        melody={melody}
        playheadSec={playhead}
        liveHz={liveHz}
        liveClarity={liveClarity}
        liveRms={liveRms}
      />
      <LyricsOverlay lrc={lrc} currentTime={playhead} />

      <div className="stage-self">
        {camDenied ? <div className="avatar-tile">camera off</div> : <video ref={videoRef} muted playsInline />}
        <p>{getDisplayName() || "You"}</p>
      </div>

      <audio ref={audioRef} preload="auto" />

      <p className="status">{status}</p>
      <div className="ctas">
        <button type="button" className="btn gold" disabled={running || !meta || !nameOk} onClick={() => void start()}>
          Start
        </button>
        <button
          type="button"
          className="btn ghost"
          disabled={!running}
          onClick={() => stopRef.current?.()}
        >
          Stop
        </button>
      </div>

      {card ? (
        <ResultsModal
          you={card}
          onHome={() => navigate("/")}
          onAgain={() => {
            setCard(null);
            setPlayhead(meta?.clipStartSec ?? 0);
          }}
        />
      ) : null}
    </main>
  );
}
