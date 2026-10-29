/**
 * Voice range check: step two of onboarding, after the mic + camera check.
 *
 * Three short guided hums (lowest, highest, a comfortable "ahh"). Each one
 * records a few seconds once a steady voice is heard and takes a robust
 * estimate (scoring/voiceRange.ts). The saved profile only seeds the live
 * pitch line's octave and guards it against detector octave errors; it never
 * touches scoring. Skippable, and re-runnable from Settings / the mode picker.
 *
 * Uses the same detector path as Training: CREPE when the model has loaded,
 * pitchy otherwise.
 */
import { PitchDetector } from "pitchy";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { LayersModel } from "@tensorflow/tfjs";
import { PageShell } from "../theme/PageShell.tsx";
import { sharedAudioContext, unlockSharedAudio } from "../media/audioContext.ts";
import { crepeFromBuffer, preloadCrepe } from "../scoring/crepePitch.ts";
import { PITCH_FFT } from "../scoring/cancelPlayback.ts";
import { midiFromHz } from "../scoring/cents.ts";
import { rmsOf } from "../scoring/pitchGuide.ts";
import {
  VoiceTuning,
  buildVoiceProfile,
  estimateHeldPitch,
  formatVoiceProfile,
  isConfidentFrame,
  midiNoteName,
  type ProfileStep,
  type VoiceFrame,
  type VoiceProfile,
} from "../scoring/voiceRange.ts";
import { preferredMicId, safeNext } from "./deviceCheck.ts";
import { useAuth } from "../auth/AuthProvider.tsx";
import { voiceSavedPatch, voiceSkippedPatch } from "./onboardingState.ts";
import "./deviceCheck.css";

const STEPS: Array<{ id: ProfileStep; title: string; prompt: string }> = [
  { id: "low", title: "Lowest note", prompt: "Hum the lowest note you can hold comfortably." },
  { id: "high", title: "Highest note", prompt: "Now the highest note you can hum without straining." },
  { id: "center", title: "Easy “ahh”", prompt: "Sing a relaxed “ahh” on whatever note feels natural." },
];

/** Live readout gates — the same ones the pitch guide uses before it draws. */
const SHOW_CONFIDENCE = 0.4;
const SHOW_RMS = 0.012;
/** Pitch bar span, C2..C6. */
const BAR_LO = 36;
const BAR_HI = 84;
/** Readout repaint interval; the detector still runs every frame. */
const READOUT_MS = 50;

const RawAudio: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
};

type Live = { midi: number | null; progress: number };
type Capture = { step: ProfileStep; armedAt: number; startedAt: number | null; frames: VoiceFrame[] };

const FAIL_COPY = {
  silent: "We didn’t hear a steady note. Hum a little louder, closer to the mic.",
  "too-few": "That was too short to measure. Hold the note for the whole bar.",
  unstable: "The pitch moved around too much. Pick one note and hold it steady.",
} as const;

function barPct(midi: number): number {
  return Math.min(100, Math.max(0, ((midi - BAR_LO) / (BAR_HI - BAR_LO)) * 100));
}

export function VoiceCheck() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const { onboarding, saveOnboarding } = useAuth();
  // The account's range at mount (re-runs show it and can keep it).
  const [saved] = useState(() => onboarding.voiceProfile);

  const [mic, setMic] = useState<MediaStreamTrack | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const [results, setResults] = useState<Partial<Record<ProfileStep, number>>>({});
  const [errors, setErrors] = useState<Partial<Record<ProfileStep, string>>>({});
  const [active, setActive] = useState<ProfileStep | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [live, setLive] = useState<Live>({ midi: null, progress: 0 });

  const alive = useRef(true);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const crepeRef = useRef<LayersModel | null>(null);
  const captureRef = useRef<Capture | null>(null);
  const resultsRef = useRef(results);
  resultsRef.current = results;

  const stopMic = useCallback(() => {
    trackRef.current?.stop();
    trackRef.current = null;
  }, []);

  const openMic = useCallback(async () => {
    stopMic();
    setMicError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicError("Mic access needs a secure (https) page.");
      return;
    }
    const id = preferredMicId();
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: id ? { ...RawAudio, deviceId: id } : RawAudio,
      });
      const t = s.getAudioTracks()[0] ?? null;
      if (!alive.current) {
        s.getTracks().forEach((x) => x.stop());
        return;
      }
      trackRef.current = t;
      setMic(t);
    } catch {
      if (alive.current) setMicError("We couldn’t open your mic. Check it on the mic check page, then try again.");
    }
  }, [stopMic]);

  useEffect(() => {
    alive.current = true;
    void openMic();
    void preloadCrepe()
      .then((m) => {
        crepeRef.current = m;
      })
      .catch(() => {
        crepeRef.current = null;
      });
    return () => {
      alive.current = false;
      captureRef.current = null;
      stopMic();
    };
  }, [openMic, stopMic]);

  /** Wrap up a capture: estimate, then validate the whole profile once all three exist. */
  const finish = useCallback((cap: Capture, failure?: keyof typeof FAIL_COPY) => {
    captureRef.current = null;
    setActive(null);
    setLive((l) => ({ ...l, progress: 0 }));
    const est = failure ? null : estimateHeldPitch(cap.frames);
    if (!est || !est.ok) {
      const why = failure ?? (est && !est.ok ? est.reason : "silent");
      setErrors((e) => ({ ...e, [cap.step]: FAIL_COPY[why] }));
      return;
    }
    setErrors((e) => ({ ...e, [cap.step]: undefined }));
    const nextResults = { ...resultsRef.current, [cap.step]: est.midi };
    const { low, high, center } = nextResults;
    if (low != null && high != null && center != null) {
      const check = buildVoiceProfile(low, high, center, Date.now());
      if (!check.ok) {
        for (const s of check.redo) delete nextResults[s];
        setProfileError(check.message);
      } else {
        setProfileError(null);
      }
    }
    setResults(nextResults);
  }, []);

  // Detector loop: live readout always, frame capture while a step is recording.
  useEffect(() => {
    if (!mic) return;
    const ctx = sharedAudioContext();
    void unlockSharedAudio().catch(() => {});
    const source = ctx.createMediaStreamSource(new MediaStream([mic]));
    const analyser = ctx.createAnalyser();
    analyser.fftSize = PITCH_FFT;
    analyser.smoothingTimeConstant = 0;
    source.connect(analyser);
    const buf = new Float32Array(PITCH_FFT);
    const detector = PitchDetector.forFloat32Array(PITCH_FFT);
    let crepeSkip = 0;
    let lastCrepe = { hz: null as number | null, confidence: 0 };
    let lastPaint = 0;
    let raf = 0;

    const tick = () => {
      const now = performance.now();
      analyser.getFloatTimeDomainData(buf);
      const rms = rmsOf(buf);
      const [yinHz, yinClarity] = detector.findPitch(buf, ctx.sampleRate);
      const model = crepeRef.current;
      if (model && crepeSkip++ % 2 === 0) {
        try {
          lastCrepe = crepeFromBuffer(model, buf, ctx.sampleRate);
        } catch {
          /* keep last CREPE frame */
        }
      }
      const useCrepe = lastCrepe.hz != null && lastCrepe.confidence >= 0.4;
      const hz = useCrepe ? lastCrepe.hz : Number.isFinite(yinHz) && yinHz > 0 ? yinHz : null;
      const confidence = useCrepe ? lastCrepe.confidence : yinClarity;
      const frame: VoiceFrame = { midi: hz ? midiFromHz(hz) : null, confidence, rms };

      const cap = captureRef.current;
      let progress = 0;
      if (cap) {
        if (cap.startedAt == null && isConfidentFrame(frame)) cap.startedAt = now;
        if (cap.startedAt != null) {
          cap.frames.push(frame);
          progress = Math.min(1, (now - cap.startedAt) / VoiceTuning.captureMs);
          if (progress >= 1) finish(cap);
        } else if (now - cap.armedAt > VoiceTuning.captureTimeoutMs) {
          finish(cap, "silent");
        }
      }

      if (now - lastPaint >= READOUT_MS) {
        lastPaint = now;
        const shown = frame.midi != null && confidence >= SHOW_CONFIDENCE && rms >= SHOW_RMS ? frame.midi : null;
        setLive({ midi: shown, progress: captureRef.current ? progress : 0 });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      source.disconnect();
    };
  }, [mic, finish]);

  function start(step: ProfileStep) {
    if (!mic) return;
    void unlockSharedAudio().catch(() => {});
    setErrors((e) => ({ ...e, [step]: undefined }));
    setProfileError(null);
    setResults((r) => {
      const copy = { ...r };
      delete copy[step];
      return copy;
    });
    captureRef.current = { step, armedAt: performance.now(), startedAt: null, frames: [] };
    setActive(step);
  }

  const profile: VoiceProfile | null = useMemo(() => {
    const { low, high, center } = results;
    if (low == null || high == null || center == null) return null;
    const check = buildVoiceProfile(low, high, center, Date.now());
    return check.ok ? check.profile : null;
  }, [results]);

  function leave(kind: "save" | "skip") {
    // Saved to the account so the range follows it to every device.
    if (kind === "save" && profile) saveOnboarding(voiceSavedPatch(profile));
    // Leaving a re-run keeps the saved profile; only a first-time skip is remembered.
    if (kind === "skip" && !saved) saveOnboarding(voiceSkippedPatch(onboarding));
    captureRef.current = null;
    stopMic();
    navigate(next);
  }

  const micStream = useMemo(() => (mic ? new MediaStream([mic]) : null), [mic]);
  const nextStep = STEPS.find((s) => results[s.id] == null)?.id ?? null;
  const activeStep = STEPS.find((s) => s.id === active);
  const recording = active != null && live.progress > 0;

  return (
    <PageShell
      title="Voice range"
      tag="Three quick hums so the pitch line starts where your voice is. It doesn’t change your score."
      wide
      className="device-check-page voice-check-page"
      stream={micStream}
      onHome={stopMic}
    >
      {saved ? (
        <p className="vc-saved">
          Saved range: <strong>{formatVoiceProfile(saved)}</strong>
        </p>
      ) : null}

      <div className="dc-grid vc-grid">
        <section className="card dc-panel vc-live">
          <h2>Listening</h2>
          <p className="dc-mic-state" aria-live="polite">
            {micError
              ? micError
              : !mic
                ? "Starting mic…"
                : activeStep
                  ? recording
                    ? "Hold it…"
                    : activeStep.prompt
                  : nextStep
                    ? "Press Start on the next step, then hum."
                    : profile
                      ? "All done."
                      : "Redo the highlighted step."}
          </p>
          <p className="vc-note" aria-live="off">
            {live.midi != null ? midiNoteName(live.midi) : "—"}
          </p>
          <div className="vc-bar" role="presentation">
            {results.low != null && results.high != null && results.low < results.high ? (
              <span
                className="vc-band"
                style={{ left: `${barPct(results.low)}%`, width: `${barPct(results.high) - barPct(results.low)}%` }}
              />
            ) : null}
            {live.midi != null ? <span className="vc-marker" style={{ left: `${barPct(live.midi)}%` }} /> : null}
          </div>
          <div className="vc-bar-scale" aria-hidden="true">
            <span>C2</span>
            <span>C3</span>
            <span>C4</span>
            <span>C5</span>
            <span>C6</span>
          </div>
          <div className="vc-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(live.progress * 100)}>
            <span style={{ width: `${live.progress * 100}%` }} />
          </div>
          {micError ? (
            <button type="button" className="cta cta-ghost" onClick={() => void openMic()}>
              Try again
            </button>
          ) : null}
        </section>

        <section className="card dc-panel vc-steps">
          <h2>Three hums</h2>
          <ol>
            {STEPS.map((s, i) => {
              const value = results[s.id];
              const err = errors[s.id];
              const isActive = active === s.id;
              const isNext = !active && nextStep === s.id;
              return (
                <li key={s.id} className={["vc-step", isActive ? "is-active" : "", isNext ? "is-next" : "", err ? "is-bad" : ""].join(" ")}>
                  <div className="vc-step-text">
                    <p className="vc-step-title">
                      {i + 1}. {s.title}
                      {value != null ? <strong className="vc-step-value">{midiNoteName(value)}</strong> : null}
                    </p>
                    <p className="vc-step-prompt">{err ?? s.prompt}</p>
                  </div>
                  <button
                    type="button"
                    className={isNext ? "cta vc-step-btn" : "cta cta-ghost vc-step-btn"} /* one red button: the step to do now */
                    disabled={!mic || active != null}
                    onClick={() => start(s.id)}
                  >
                    {isActive ? "Listening…" : value != null || err ? "Redo" : "Start"}
                  </button>
                </li>
              );
            })}
          </ol>
          {profileError ? (
            <div className="dc-notice is-soft" role="alert">
              <p className="dc-notice-head">Let’s try that again</p>
              <p>{profileError}</p>
            </div>
          ) : null}
          {profile ? (
            <p className="vc-result">
              Your range: <strong>{formatVoiceProfile(profile)}</strong>
            </p>
          ) : null}
        </section>
      </div>

      <div className="ctas dc-actions">
        <button type="button" className="cta" disabled={!profile || active != null} onClick={() => leave("save")}>
          Save &amp; continue
        </button>
        <button type="button" className="dc-skip" onClick={() => leave("skip")}>
          {saved ? "Keep my saved range" : "Skip voice check"}
        </button>
      </div>
    </PageShell>
  );
}
