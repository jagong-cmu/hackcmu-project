import { PitchDetector } from "pitchy";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { MelodyFile, ScoreCard, SongMeta } from "@karaoke/shared";
import { getClientId, getDisplayName, validName } from "../home/identity.ts";
import { LyricsOverlay } from "../lyrics/LyricsOverlay.tsx";
import { ResultsModal } from "../results/ResultsModal.tsx";
import { loadCatalog, loadSongPack, type ReadySong } from "../scoring/catalog.ts";
import { PitchMeter } from "../scoring/PitchMeter.tsx";
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

  useEffect(() => {
    void loadCatalog().then((list) => {
      setSongs(list);
      const first = list.find((s) => s.ready);
      if (first) setSongId(first.id);
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

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
        video: true,
      });
    } catch {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
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

    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    src.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const detector = PitchDetector.forFloat32Array(analyser.fftSize);

    const audio = audioRef.current;
    if (!audio) return;
    audio.src = audioUrl;
    audio.currentTime = 0;
    await audio.play();

    setRunning(true);
    setStatus("Sing the gold line. Stop whenever — you'll still be scored.");

    const tick = () => {
      const t = audio.currentTime;
      setPlayhead(t);
      analyser.getFloatTimeDomainData(buf);
      const [hz, clarity] = detector.findPitch(buf, ctx.sampleRate);
      const voiced = clarity >= 0.6 && hz >= 70 && hz <= 1200;
      framesRef.current.push({
        timeSec: t,
        hz: voiced ? hz : null,
        clarity,
      });
      setLiveHz(voiced ? hz : null);
      setLiveClarity(clarity);
      if (audio.ended) {
        void finish(stream, ctx);
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    const stop = () => {
      cancelAnimationFrame(rafRef.current);
      audio.pause();
      stream.getTracks().forEach((tr) => tr.stop());
      void ctx.close();
      setRunning(false);
      stopRef.current = null;
      endRef.current = null;
    };
    stopRef.current = stop;
    // Stopping a full song early should still score what was sung.
    endRef.current = () => void finish(stream, ctx);
    rafRef.current = requestAnimationFrame(tick);
  }

  async function finish(stream: MediaStream, ctx: AudioContext) {
    stopRef.current = null;
    endRef.current = null;
    cancelAnimationFrame(rafRef.current);
    audioRef.current?.pause();
    stream.getTracks().forEach((tr) => tr.stop());
    void ctx.close();
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

      <PitchMeter melody={melody} playheadSec={playhead} liveHz={liveHz} liveClarity={liveClarity} />
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
