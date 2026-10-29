import { PitchDetector } from "pitchy";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  clipWindowFor,
  MatchCountdownMs,
  pickClipAnchor,
  type ClipWindow,
  type MelodyFile,
  type ScoreCard,
  type SongMeta,
} from "@karaoke/shared";
import { melodyFrom } from "../lyrics/leadIn.ts";
import type { LayersModel } from "@tensorflow/tfjs";
import { getClientId, getDisplayName, validName } from "../home/identity.ts";
import { authHeaders } from "../auth/supabase.ts";
import { LyricsOverlay } from "../lyrics/LyricsOverlay.tsx";
import { loadCatalog, loadSongPack, type ReadySong } from "../scoring/catalog.ts";
import { HitCallout } from "../scoring/HitCallout.tsx";
import { gradeLive } from "../scoring/hitGrade.ts";
import { PitchMeter } from "../scoring/PitchMeter.tsx";
import type { ScoreBits } from "../scoring/ScoreBars.tsx";
import { ResultsModal, ScoringWait } from "../results/ResultsModal.tsx";
import { useMatchMomentCapture } from "../results/useMatchMoment.ts";
import { holdMatchReel, stopMatchReel } from "../results/matchReel.ts";
import {
  isMusicOnly,
  PITCH_FFT,
} from "../scoring/cancelPlayback.ts";
import { crepeFromBuffer, preloadCrepe } from "../scoring/crepePitch.ts";
import { pitchAnalyser, rmsOf } from "../scoring/pitchGuide.ts";
import { scoreContour, type PitchFrame } from "../scoring/scoreClip.ts";
import { PageShell } from "../theme/PageShell.tsx";
import { Button } from "../ui/Button.tsx";
import { KeyHintBar, type Hint } from "../ui/KeyHints.tsx";
import { SongGrid } from "./SongGrid.tsx";
import { KaraokeMachine, MachineStage, ScorePanel } from "../stage/KaraokeMachine.tsx";
import { mmss, ProgressBar } from "../stage/ClipTimer.tsx";
import { Digits } from "../ui/Digits.tsx";
import "./training.css";
import CountdownOverlay from "../stage/CountdownOverlay.tsx";
import { capture } from "../analytics/posthog.ts";
import { useVoiceProfile } from "../auth/AuthProvider.tsx";

const LastSongKey = "training:lastSong";

function lastSong(): string {
  try {
    return localStorage.getItem(LastSongKey) ?? "";
  } catch {
    return "";
  }
}

const IdleHints: Hint[] = [
  { keys: ["←", "→", "↑", "↓"], label: "Move" },
  { keys: ["Enter"], label: "Start" },
  { keys: ["P"], label: "Preview" },
  { keys: ["Esc"], label: "Back" },
];

export function Training() {
  const [songs, setSongs] = useState<ReadySong[]>([]);
  const [songId, setSongId] = useState(lastSong);
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
  // Display-only: seeds the pitch line's octave for your voice. Not scoring.
  const voiceProfile = useVoiceProfile();
  const [card, setCard] = useState<ScoreCard | null>(null);
  const [liveCard, setLiveCard] = useState<ScoreBits | null>(null);
  const [scoring, setScoring] = useState(false);
  const [countMs, setCountMs] = useState<number | null>(null);
  const [camDenied, setCamDenied] = useState(false);
  const [combo, setCombo] = useState(0);
  const [previewing, setPreviewing] = useState(false);
  const [clipKey, setClipKey] = useState("");
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const clipKeyRef = useRef("");
  // This take's window: anchor (first lyric / chorus) minus ClipLeadInMs → end.
  const [trainingClip, setTrainingClip] = useState<ClipWindow | null>(null);
  const clipRef = useRef<ClipWindow | null>(null);
  const leadInActive = Boolean(trainingClip) && (running || countMs != null);
  const guideMelody = useMemo(
    () =>
      melody && leadInActive && trainingClip
        ? melodyFrom(melody, trainingClip.anchorSec)
        : melody,
    [melody, leadInActive, trainingClip],
  );

  const navigate = useNavigate();
  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const framesRef = useRef<PitchFrame[]>([]);
  const rafRef = useRef<number>(0);
  const stopRef = useRef<(() => void) | null>(null);
  const endRef = useRef<(() => void) | null>(null);
  const previewRafRef = useRef<number>(0);
  const countTimerRef = useRef<number>(0);

  useMatchMomentCapture({
    matchKey: clipKey,
    singing: running,
    recording: running,
    windowMs: (meta?.clipDurationSec ?? 20) * 1000,
    micStream,
    settle: Boolean(card) || scoring,
    reset: !clipKey,
  });

  const crepeRef = useRef<LayersModel | null>(null);

  useEffect(() => {
    void loadCatalog().then((list) => {
      setSongs(list);
      // Keep the remembered song if it is still playable, else the first ready one.
      setSongId((cur) => (list.some((s) => s.id === cur && s.ready) ? cur : (list.find((s) => s.ready)?.id ?? cur)));
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
    void loadSongPack(songId)
      .then((pack) => {
        if (cancelled) return;
        setMeta(pack.meta);
        setMelody(pack.melody);
        setLrc(pack.lrc);
        setAudioUrl(pack.audioUrl);
      })
      .catch(() => {
        if (cancelled) return;
        setMeta(null);
        setMelody(null);
        setLrc("");
        setAudioUrl("");
        setStatus("Could not load that song.");
      });
    return () => {
      cancelled = true;
    };
  }, [songId, songs]);

  useEffect(
    () => () => {
      window.clearInterval(countTimerRef.current);
      stopRef.current?.();
    },
    [],
  );

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
    if (!meta || !melody) {
      setStatus("That song is still loading.");
      return;
    }
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
    setMicStream(stream);

    capture("training started", { song_id: meta.id });

    const audio = audioRef.current;
    if (!audio) return;
    audio.src = audioUrl;
    audio.volume = 0.8;
    // Same rule as a match: open ClipLeadInMs before the first lyric or the
    // chorus (50/50, picked here since Training is solo), then run to the end.
    const clip = clipWindowFor(meta, "training", pickClipAnchor(meta));
    const singFrom = clip.anchorSec;
    clipRef.current = clip;
    setTrainingClip(clip);
    setPlayhead(clip.startSec);
    audio.currentTime = clip.startSec;

    // Nothing to cancel on headphones, so the mic is read straight -- no
    // playback tap, no adaptive canceller.
    const ctx = new AudioContext();
    await ctx.resume();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = pitchAnalyser(ctx, src, PITCH_FFT);
    const buf = new Float32Array(PITCH_FFT);
    const refBuf = new Float32Array(PITCH_FFT);
    const clean = new Float32Array(PITCH_FFT);
    const detector = PitchDetector.forFloat32Array(PITCH_FFT);

    try {
      await audio.play();
      audio.pause();
      audio.currentTime = clip.startSec;
    } catch {
      /* timed play() below will surface a block */
    }

    const armMs = MatchCountdownMs;
    const goAt = Date.now() + armMs;
    setCountMs(armMs);
    setStatus("Your turn to sing. Track starts after the countdown.");

    let crepeSkip = 0;
    let lastCrepe = { hz: null as number | null, confidence: 0 };
    let lastLiveScore = 0;
    let begun = false;

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
        // The live guide always reads pitchy, like the stage does. Hopping
        // between CREPE and pitchy on a confidence that falls with volume let
        // loudness pick which detector drew the line, and CREPE's confidence
        // is not on pitchy's clarity scale for the guide's gate.
        setLiveHz(Number.isFinite(yinHz) && yinHz > 0 ? yinHz : null);
        setLiveClarity(yinClarity);
        setLiveRms(rms);
      }
      // Nothing to score until the anchor line: the lead-in is instrumental.
      if (melody && t >= singFrom && t - lastLiveScore >= 0.12) {
        lastLiveScore = t;
        const live = scoreContour(framesRef.current, melody, {
          startSec: singFrom,
          durationSec: Math.max(0.25, t - singFrom),
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
      window.clearInterval(countTimerRef.current);
      countTimerRef.current = 0;
      cancelAnimationFrame(rafRef.current);
      audio.pause();
      void stopMatchReel(clipKeyRef.current);
      stream.getTracks().forEach((tr) => tr.stop());
      src.disconnect();
      setMicStream(null);
      setRunning(false);
      setCountMs(null);
      stopRef.current = null;
      endRef.current = null;
    };
    stopRef.current = stop;
    endRef.current = () => {
      if (!begun) {
        stop();
        setStatus("Cancelled.");
        return;
      }
      src.disconnect();
      void finish(stream);
    };

    const begin = () => {
      if (begun) return;
      begun = true;
      window.clearInterval(countTimerRef.current);
      countTimerRef.current = 0;
      setCountMs(null);
      audio.currentTime = clip.startSec;
      void audio.play().catch(() => undefined);
      setRunning(true);
      const key = crypto.randomUUID();
      clipKeyRef.current = key;
      setClipKey(key);
      setStatus("Follow the melody. Stop whenever — you'll still be scored.");
      rafRef.current = requestAnimationFrame(tick);
    };

    countTimerRef.current = window.setInterval(() => {
      const left = goAt - Date.now();
      if (left <= 0) {
        begin();
        return;
      }
      setCountMs(left);
      // Constant on purpose: the status is aria-live and the overlay shows the number.
      setStatus("Your turn to sing. Track starts after the countdown.");
    }, 80);
  }

  async function finish(stream: MediaStream) {
    stopRef.current = null;
    endRef.current = null;
    cancelAnimationFrame(rafRef.current);
    audioRef.current?.pause();
    setRunning(false);
    setCountMs(null);
    setScoring(true);
    setStatus("Scoring…");
    // Hold, not stop: the video waits for the score card and closes on it.
    holdMatchReel(clipKeyRef.current);
    stream.getTracks().forEach((tr) => tr.stop());
    setMicStream(null);
    if (!meta || !melody) return;

    const startedAt = Date.now();

    // Whole take from the anchor line on — the lead-in is never scored.
    const frames = framesRef.current;
    const singFrom = clipRef.current?.anchorSec ?? 0;
    const lastSec = frames.length ? frames[frames.length - 1].timeSec : singFrom + 1;
    const dsp = scoreContour(frames, melody, {
      startSec: singFrom,
      durationSec: Math.max(1, lastSec - singFrom),
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
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
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

  const singing = running || countMs != null;

  function pickSong(id: string) {
    if (id === songId) return;
    stopPreview();
    setPlayhead(0);
    setCard(null);
    setSongId(id);
    try {
      localStorage.setItem(LastSongKey, id);
    } catch {
      /* private mode: just don't remember */
    }
  }

  // P previews, Esc goes home. Enter is the focused song's own button.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || singing || card || scoring) return;
      if (e.key === "Escape") navigate("/");
      else if (e.key.toLowerCase() === "p" && meta && !(e.target instanceof HTMLInputElement)) {
        if (previewing) stopPreview();
        else void startPreview();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const readySongs = songs.filter((s) => s.ready);
  const youName = getDisplayName() || "You";
  const elapsed = trainingClip && singing ? Math.max(0, playhead - trainingClip.startSec) : 0;
  const total = trainingClip?.durationSec ?? meta?.clipDurationSec ?? 0;
  const nameOk = validName(getDisplayName());

  return (
    <PageShell
      title="Training"
      tag="Pick a song, then sing. The wave behind you is your mic."
      wide
      className={singing ? "training is-singing" : "training"}
      level={Math.min(1, liveRms / 0.07)}
    >
      <section className={`song-collapse${singing ? " is-collapsed" : ""}`} ref={(el) => {
          if (el) el.inert = singing; // React 18 has no inert prop
        }}
      >
        <div className="song-collapse-inner">
          <h2 className="song-section t-label">Songs</h2>
          <SongGrid
            songs={songs}
            selectedId={songId}
            onSelect={pickSong}
            onStart={() => void start()}
            onBack={() => navigate("/")}
          />
        </div>
      </section>

      {!nameOk ? <p className="err">Set a display name in Settings first.</p> : null}
      {readySongs.length === 0 ? <p className="err">No complete songs yet.</p> : null}

      <MachineStage>
        <div className="km-row">
          <ScorePanel
            side="you"
            name={youName}
            card={liveCard}
            combo={combo}
            camera={
              <div className="stage-cam">
                <div className="tile">
                  {camDenied ? (
                    <div className="placeholder cam-initial">{youName[0]}</div>
                  ) : (
                    <video ref={videoRef} muted playsInline />
                  )}
                </div>
              </div>
            }
          />
          <KaraokeMachine
            title={meta?.title ?? "Training"}
            label="Training"
            time={<Digits value={`${mmss(elapsed)} / ${mmss(total)}`} />}
            lanes={
              <div className="pitch-stage">
                <PitchMeter
                  melody={guideMelody}
                  playheadSec={playhead}
                  liveHz={liveHz}
                  liveClarity={liveClarity}
                  liveRms={liveRms}
                  voiceProfile={voiceProfile}
                  onCombo={setCombo}
                />
                {running ? <HitCallout grade={gradeLive(guideMelody, playhead, liveHz)} /> : null}
              </div>
            }
            lyrics={
              <LyricsOverlay
                lrc={lrc}
                currentTime={playhead}
                singFromSec={leadInActive ? trainingClip?.anchorSec : null}
              />
            }
            lock={liveCard?.pitch ?? null}
          />
          <span />
        </div>
        <ProgressBar
          label={meta ? `${meta.title} · ${meta.artist}` : "Training"}
          elapsedSec={elapsed}
          durationSec={total}
        />
      </MachineStage>

      <audio ref={audioRef} className="instrumental" preload="auto" />

      <div className="train-actions">
        <p className="status" aria-live="polite">{status}</p>
        <Button variant="primary" disabled={singing || !meta || !nameOk} onClick={() => void start()}>
          Start
        </Button>
        <Button
          disabled={singing || !meta}
          onClick={() => {
            if (previewing) stopPreview();
            else void startPreview();
          }}
        >
          {previewing ? "Pause preview" : "Preview"}
        </Button>
        <Button disabled={!singing} onClick={() => endRef.current?.()}>
          {countMs != null ? "Cancel" : "Stop & score"}
        </Button>
      </div>
      {singing ? null : <KeyHintBar hints={IdleHints} />}

      {countMs != null ? <CountdownOverlay remainingMs={countMs} singing /> : null}
      {scoring && !card ? <ScoringWait /> : null}
      {card ? (
        <ResultsModal
          you={card}
          youName={youName}
          songTitle={meta?.title}
          songArtist={meta?.artist}
          onHome={() => navigate("/")}
          onAgain={() => {
            setCard(null);
            setLiveCard(null);
            setPlayhead(0);
          }}
          onPickSong={() => {
            setCard(null);
            setLiveCard(null);
            setPlayhead(0);
            document.querySelector<HTMLElement>('.song-grid .sl-item[tabindex="0"]')?.focus();
          }}
        />
      ) : null}
    </PageShell>
  );
}
