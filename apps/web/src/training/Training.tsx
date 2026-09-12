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
  const [previewing, setPreviewing] = useState(false);

  const navigate = useNavigate();
  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const framesRef = useRef<PitchFrame[]>([]);
  const rafRef = useRef<number>(0);
  const stopRef = useRef<(() => void) | null>(null);
  const endRef = useRef<(() => void) | null>(null);
  const previewRafRef = useRef<number>(0);

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

  function stopPreview() {
    cancelAnimationFrame(previewRafRef.current);
    const audio = audioRef.current;
    if (audio) audio.pause();
    setPreviewing(false);
  }

  async function startPreview() {
    const audio = audioRef.current;
    if (!audio || !meta || !audioUrl || running) return;
    if (audio.src !== new URL(audioUrl, location.href).href) audio.src = audioUrl;
    if (audio.currentTime < meta.clipStartSec) audio.currentTime = meta.clipStartSec;
    try {
      await audio.play();
    } catch {
      // Chrome blocks playback that is not tied to a gesture; the button covers it.
      setPreviewing(false);
      return;
    }
    setPreviewing(true);
    const tick = () => {
      setPlayhead(audio.currentTime);
      if (audio.paused || audio.ended) {
        setPreviewing(false);
        return;
      }
      previewRafRef.current = requestAnimationFrame(tick);
    };
    previewRafRef.current = requestAnimationFrame(tick);
  }

  useEffect(() => () => cancelAnimationFrame(previewRafRef.current), []);

  async function start() {
    stopPreview();
    if (!meta || !melody) return;
    setCard(null);
    framesRef.current = [];
    setStatus("Allow the mic. Camera is optional.");

    // Raw mic. Chrome's noise suppression is tuned for speech and guts the
    // sustained low end of a low voice, and AGC moves the levels the RMS gates
    // key off. Training assumes headphones, so there is no speaker bleed for
    // echo cancelling to earn its keep either.
    const audioConstraints: MediaTrackConstraints = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
    };

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
        video: true,
      });
    } catch {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraints,
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
    // Training plays the whole track, not just the ranked clip.
    audio.currentTime = 0;

    // Nothing to cancel on headphones, so the mic is read straight -- no
    // playback tap, no adaptive canceller.
    const ctx = new AudioContext();
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

    await audio.play();

    setRunning(true);
    setStatus(
      crepeRef.current
        ? "CREPE is listening — sing the gold line. Stop whenever; you'll still be scored."
        : "Sing the gold line. Stop whenever — you'll still be scored.",
    );

    let crepeSkip = 0;
    let lastCrepe = { hz: null as number | null, confidence: 0 };

    const tick = () => {
      const t = audio.currentTime;
      setPlayhead(t);
      analyser.getFloatTimeDomainData(buf);
      clean.set(buf);
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
        const forScore = clarity >= 0.45 && hz != null && hz >= 55 && hz <= 1200 && rms >= 0.012;
        framesRef.current.push({
          timeSec: t,
          hz: forScore ? hz : null,
          clarity,
        });
        setLiveHz(useCrepe || (Number.isFinite(yinHz) && yinHz > 0) ? hz : null);
        setLiveClarity(clarity);
        setLiveRms(rms);
      }
      if (audio.ended) {
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
      endRef.current = null;
    };
    stopRef.current = stop;
    // Stopping a full song early should still score what was sung.
    endRef.current = () => {
      src.disconnect();
      void finish(stream);
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  async function finish(stream: MediaStream) {
    stopRef.current = null;
    endRef.current = null;
    cancelAnimationFrame(rafRef.current);
    audioRef.current?.pause();
    stream.getTracks().forEach((tr) => tr.stop());
    setRunning(false);
    if (!meta || !melody) return;

    // Score everything from the first vocal line to wherever playback stopped,
    // so the intro's silence never counts against the singer.
    const frames = framesRef.current;
    const lastSec = frames.length ? frames[frames.length - 1].timeSec : meta.clipStartSec;
    const dsp = scoreContour(frames, melody, {
      startSec: meta.clipStartSec,
      durationSec: Math.max(1, lastSec - meta.clipStartSec),
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
        <select
          value={songId}
          disabled={running}
          onChange={(e) => {
            stopPreview();
            setPlayhead(0);
            setCard(null);
            setSongId(e.target.value);
          }}
        >
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

      <LyricsOverlay lrc={lrc} currentTime={playhead} />
      <PitchMeter
        melody={melody}
        playheadSec={playhead}
        liveHz={liveHz}
        liveClarity={liveClarity}
        liveRms={liveRms}
      />

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
          disabled={running || !meta}
          onClick={() => {
            if (previewing) stopPreview();
            else void startPreview();
          }}
        >
          {previewing ? "Pause preview" : "Preview"}
        </button>
        <button
          type="button"
          className="btn ghost"
          disabled={!running}
          onClick={() => endRef.current?.()}
        >
          Stop &amp; score
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
