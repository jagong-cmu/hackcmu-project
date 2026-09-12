import { PitchDetector } from "pitchy";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { MelodyFile, ScoreCard, SongMeta } from "@karaoke/shared";
import type { LayersModel } from "@tensorflow/tfjs";
import { getClientId, getDisplayName, validName } from "../home/identity.ts";
import { LyricsOverlay } from "../lyrics/LyricsOverlay.tsx";
import { loadCatalog, loadSongPack, type ReadySong } from "../scoring/catalog.ts";
import { HitCallout } from "../scoring/HitCallout.tsx";
import { gradeLive } from "../scoring/hitGrade.ts";
import { PitchMeter } from "../scoring/PitchMeter.tsx";
import { LiveScoreHud, type ScoreBits } from "../scoring/ScoreBars.tsx";
import { ResultsModal, ScoringWait } from "../results/ResultsModal.tsx";
import {
  isMusicOnly,
  PITCH_FFT,
} from "../scoring/cancelPlayback.ts";
import { crepeFromBuffer, preloadCrepe } from "../scoring/crepePitch.ts";
import { rmsOf } from "../scoring/pitchGuide.ts";
import { scoreContour, type PitchFrame } from "../scoring/scoreClip.ts";
import { PageShell } from "../theme/PageShell.tsx";

export function Training() {
  const [songs, setSongs] = useState<ReadySong[]>([]);
  const [songId, setSongId] = useState("viva-la-vida");
  const [meta, setMeta] = useState<SongMeta | null>(null);
  const [melody, setMelody] = useState<MelodyFile | null>(null);
  const [lrc, setLrc] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const [status, setStatus] = useState("Pick a song, then Start.");
  const [running, setRunning] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [liveHz, setLiveHz] = useState<number | null>(null);
  const [liveClarity, setLiveClarity] = useState(0);
  const [liveRms, setLiveRms] = useState(0);
  const [card, setCard] = useState<ScoreCard | null>(null);
  const [liveCard, setLiveCard] = useState<ScoreBits | null>(null);
  const [scoring, setScoring] = useState(false);
  const [intro, setIntro] = useState(false);
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
    setLiveCard(null);
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
    setIntro(true);
    window.setTimeout(() => setIntro(false), 2400);
    setStatus("Follow the melody. Stop whenever — you'll still be scored.");

    let crepeSkip = 0;
    let lastCrepe = { hz: null as number | null, confidence: 0 };
    let lastLiveScore = 0;

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
        // Same gates the stage uses, so a take does not score differently here.
        const forScore = clarity >= 0.4 && hz != null && hz >= 55 && hz <= 1200 && rms >= 0.008;
        framesRef.current.push({
          timeSec: t,
          hz: forScore ? hz : null,
          clarity,
        });
        setLiveHz(useCrepe || (Number.isFinite(yinHz) && yinHz > 0) ? hz : null);
        setLiveClarity(clarity);
        setLiveRms(rms);
      }
      if (melody && t - lastLiveScore >= 0.12) {
        lastLiveScore = t;
        const live = scoreContour(framesRef.current, melody, {
          startSec: 0,
          durationSec: Math.max(0.25, t),
        });
        if (!live.silence) {
          setLiveCard({ pitch: live.pitch, tone: live.tone, overall: live.overall });
        }
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
    setIntro(false);
    if (!meta || !melody) return;

    setScoring(true);
    setStatus("Scoring…");
    const startedAt = Date.now();

    // Whole take, from 0:00 — intro silence does not count against the singer.
    const frames = framesRef.current;
    const lastSec = frames.length ? frames[frames.length - 1].timeSec : 1;
    const dsp = scoreContour(frames, melody, {
      startSec: 0,
      durationSec: Math.max(1, lastSec),
    });
    const lyrics = lrc
      .split("\n")
      .map((l) => l.replace(/\[\d.+?\]/g, "").trim())
      .filter(Boolean)
      .slice(0, 12)
      .join("\n");
    let next: ScoreCard = dsp;
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
      next = json.score ?? dsp;
    } catch {
      next = dsp;
    }
    const wait = Math.max(0, 1400 - (Date.now() - startedAt));
    if (wait) await new Promise((r) => window.setTimeout(r, wait));
    setCard(next);
    setScoring(false);
    setStatus("Done.");
  }

  const readySongs = songs.filter((s) => s.ready);
  const nameOk = validName(getDisplayName());

  return (
    <PageShell
      title="Training"
      tag="Pick a song, then sing. The wave behind you is your mic."
      wide
      className="training"
      level={Math.min(1, liveRms / 0.07)}
    >
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

      {!nameOk ? <p className="err">Set a display name in Settings first.</p> : null}
      {readySongs.length === 0 ? <p className="err">No complete songs yet.</p> : null}

      <LyricsOverlay lrc={lrc} currentTime={playhead} />
      <div className="pitch-stage">
        <PitchMeter
          melody={melody}
          playheadSec={playhead}
          liveHz={liveHz}
          liveClarity={liveClarity}
          liveRms={liveRms}
        />
        {running ? <HitCallout grade={gradeLive(melody, playhead, liveHz)} /> : null}
        {running ? (
          <LiveScoreHud left={{ name: getDisplayName() || "You", card: liveCard, singing: true }} />
        ) : null}
      </div>

      <div className="stage-self">
        {camDenied ? <div className="avatar-tile">camera off</div> : <video ref={videoRef} muted playsInline />}
        <p>{getDisplayName() || "You"}</p>
      </div>

      <audio ref={audioRef} preload="auto" />

      <p className="status">{status}</p>
      <div className="ctas">
        <button type="button" className="cta" disabled={running || !meta || !nameOk} onClick={() => void start()}>
          Start
        </button>
        <button
          type="button"
          className="cta cta-ghost"
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
          className="cta cta-ghost"
          disabled={!running}
          onClick={() => endRef.current?.()}
        >
          Stop &amp; score
        </button>
      </div>

      {intro && running ? (
        <div className="callout hold training-callout" role="status">
          <p className="callout-kicker">Training</p>
          <p className="callout-title">YOUR TURN</p>
          <p className="callout-sub">Whole song. Follow the melody. You’ll get a score when you stop.</p>
        </div>
      ) : null}
      {scoring && !card ? <ScoringWait /> : null}
      {card ? (
        <ResultsModal
          you={card}
          onHome={() => navigate("/")}
          onAgain={() => {
            setCard(null);
            setLiveCard(null);
            setPlayhead(0);
          }}
        />
      ) : null}
    </PageShell>
  );
}
