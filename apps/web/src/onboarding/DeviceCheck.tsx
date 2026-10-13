/**
 * Mic + camera check, run once before a singer's first real match and
 * re-runnable from Settings and the mode picker.
 *
 * Opens the same raw capture LiveKit will (no AEC / AGC / noise suppression),
 * so the meter shows the levels the scorer will actually see. Every track is
 * stopped on the way out so the camera light is off before LiveKit asks for
 * the devices again.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PageShell } from "../theme/PageShell.tsx";
import { sharedAudioContext, unlockSharedAudio } from "../media/audioContext.ts";
import {
  deviceCheckCleared,
  markDeviceCheckDone,
  preferredCameraId,
  preferredMicId,
  safeNext,
  skipDeviceCheckForSession,
} from "./deviceCheck.ts";
import "./deviceCheck.css";

type Kind = "mic" | "camera";
type Problem = "denied" | "missing" | "busy" | "gone" | "insecure" | "unknown";

/** Same raw capture LiveKit opens in media/livekit.ts. */
const RawAudio: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
};
const Video: MediaTrackConstraints = { width: 640, height: 480 };

/** Normalised level a singing voice reliably crosses. */
const HeardLevel = 0.35;
/** Consecutive loud frames before we call the mic "heard". */
const HeardFrames = 8;
const MeterSegments = 24;

function problemOf(err: unknown): Problem {
  const name = err && typeof err === "object" && "name" in err ? String(err.name) : "";
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return "denied";
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return "missing";
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return "busy";
    default:
      return "unknown";
  }
}

const COPY: Record<Kind, Record<Problem, { title: string; body: string }>> = {
  mic: {
    denied: {
      title: "Your mic is blocked",
      body: "Click the camera icon at the right end of the address bar, set Microphone to Allow, then press Try again. On a Mac, also check System Settings → Privacy & Security → Microphone and make sure Chrome is on.",
    },
    missing: {
      title: "We can’t find a mic",
      body: "Plug in a headset, earbuds with a mic, or a USB mic, then press Try again.",
    },
    busy: {
      title: "Your mic is busy",
      body: "Another app is holding it — usually Zoom, Teams, FaceTime, Discord or OBS. Close the call or quit that app, then press Try again.",
    },
    gone: {
      title: "Your mic disconnected",
      body: "It looks like it was unplugged. Plug it back in or pick another mic, then press Try again.",
    },
    insecure: {
      title: "Devices aren’t available here",
      body: "Browsers only share a mic and camera on secure pages. Open the site over https:// and try again.",
    },
    unknown: {
      title: "Your mic didn’t start",
      body: "Something went wrong opening it. Press Try again, or pick a different mic.",
    },
  },
  camera: {
    denied: {
      title: "Your camera is blocked",
      body: "To be seen, click the camera icon in the address bar, set Camera to Allow, then press Try again. Or carry on without it — you can still sing.",
    },
    missing: {
      title: "No camera found",
      body: "That’s fine — you can still sing. The other singer sees your name instead of your face.",
    },
    busy: {
      title: "Your camera is busy",
      body: "Another app is using it (Zoom, Teams, FaceTime, Photo Booth, OBS). Close it and press Try again — or carry on without video.",
    },
    gone: {
      title: "Your camera disconnected",
      body: "Plug it back in and press Try again, or carry on without video.",
    },
    insecure: {
      title: "Devices aren’t available here",
      body: "Browsers only share a mic and camera on secure pages. Open the site over https:// and try again.",
    },
    unknown: {
      title: "Your camera didn’t start",
      body: "Press Try again, pick a different camera, or carry on without video.",
    },
  },
};

function audioConstraints(deviceId?: string, exact = false): MediaTrackConstraints {
  if (!deviceId) return RawAudio;
  return { ...RawAudio, deviceId: exact ? { exact: deviceId } : deviceId };
}

function videoConstraints(deviceId?: string, exact = false): MediaTrackConstraints {
  if (!deviceId) return Video;
  return { ...Video, deviceId: exact ? { exact: deviceId } : deviceId };
}

export function DeviceCheck() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const [rerun] = useState(() => deviceCheckCleared());

  const [busy, setBusy] = useState(true);
  const [mic, setMic] = useState<MediaStreamTrack | null>(null);
  const [cam, setCam] = useState<MediaStreamTrack | null>(null);
  const [micProblem, setMicProblem] = useState<Problem | null>(null);
  const [camProblem, setCamProblem] = useState<Problem | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [heard, setHeard] = useState(false);

  const tracks = useRef(new Set<MediaStreamTrack>());
  const alive = useRef(true);
  const generation = useRef(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const meterRef = useRef<HTMLDivElement>(null);

  const stopAll = useCallback(() => {
    for (const t of tracks.current) t.stop();
    tracks.current.clear();
  }, []);

  const stopTrack = useCallback((t: MediaStreamTrack | null) => {
    if (!t) return;
    t.stop();
    tracks.current.delete(t);
  }, []);

  const refreshDevices = useCallback(async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      if (alive.current) setDevices(list.filter((d) => d.deviceId));
    } catch {
      /* the picker just stays hidden */
    }
  }, []);

  /** Keep a track, and notice if it's unplugged mid-check. */
  const adopt = useCallback((kind: Kind, track: MediaStreamTrack) => {
    tracks.current.add(track);
    track.onended = () => {
      tracks.current.delete(track);
      if (!alive.current) return;
      if (kind === "mic") {
        setMic((cur) => (cur === track ? null : cur));
        setMicProblem("gone");
      } else {
        setCam((cur) => (cur === track ? null : cur));
        setCamProblem("gone");
      }
    };
    if (kind === "mic") {
      setMic(track);
      setMicProblem(null);
    } else {
      setCam(track);
      setCamProblem(null);
    }
  }, []);

  /** Open mic and camera. One prompt when both work, then each half alone. */
  const start = useCallback(async () => {
    const gen = ++generation.current;
    const stale = () => !alive.current || gen !== generation.current;
    stopAll();
    setMic(null);
    setCam(null);
    setHeard(false);
    setBusy(true);

    if (!navigator.mediaDevices?.getUserMedia) {
      setMicProblem("insecure");
      setCamProblem("insecure");
      setBusy(false);
      return;
    }

    const micId = preferredMicId();
    const camId = preferredCameraId();
    const drop = (s: MediaStream) => s.getTracks().forEach((t) => t.stop());

    try {
      const both = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints(micId),
        video: videoConstraints(camId),
      });
      if (stale()) return drop(both);
      const a = both.getAudioTracks()[0];
      const v = both.getVideoTracks()[0];
      if (a) adopt("mic", a);
      if (v) adopt("camera", v);
    } catch {
      // One of the two failed and the error doesn't say which. Ask apart;
      // the mic first, since karaoke with no face cam is still karaoke.
      if (stale()) return;
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints(micId) });
        if (stale()) return drop(s);
        adopt("mic", s.getAudioTracks()[0]);
      } catch (err) {
        if (stale()) return;
        setMicProblem(problemOf(err));
      }
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: videoConstraints(camId) });
        if (stale()) return drop(s);
        adopt("camera", s.getVideoTracks()[0]);
      } catch (err) {
        if (stale()) return;
        setCamProblem(problemOf(err));
      }
    }
    if (stale()) return;
    setBusy(false);
    void refreshDevices();
  }, [adopt, refreshDevices, stopAll]);

  /** Swap one device without touching the other. */
  const pick = useCallback(
    async (kind: Kind, deviceId: string) => {
      const gen = ++generation.current;
      const old = kind === "mic" ? mic : cam;
      stopTrack(old);
      if (kind === "mic") {
        setMic(null);
        setHeard(false);
      } else {
        setCam(null);
      }
      setBusy(true);
      try {
        const s = await navigator.mediaDevices.getUserMedia(
          kind === "mic"
            ? { audio: audioConstraints(deviceId, true) }
            : { video: videoConstraints(deviceId, true) },
        );
        if (!alive.current || gen !== generation.current) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        const t = kind === "mic" ? s.getAudioTracks()[0] : s.getVideoTracks()[0];
        adopt(kind, t);
      } catch (err) {
        if (!alive.current || gen !== generation.current) return;
        if (kind === "mic") setMicProblem(problemOf(err));
        else setCamProblem(problemOf(err));
      }
      setBusy(false);
    },
    [adopt, cam, mic, stopTrack],
  );

  // Open on arrival; they just clicked into this page, so audio can unlock.
  useEffect(() => {
    alive.current = true;
    void start();
    return () => {
      alive.current = false;
      generation.current++;
      stopAll();
    };
  }, [start, stopAll]);

  // Unplug / plug in → refresh the pickers.
  useEffect(() => {
    const md = navigator.mediaDevices;
    if (!md?.addEventListener) return;
    const onChange = () => void refreshDevices();
    md.addEventListener("devicechange", onChange);
    return () => md.removeEventListener("devicechange", onChange);
  }, [refreshDevices]);

  // If they flip a blocked permission to Allow, retry without making them click.
  const startRef = useRef(start);
  startRef.current = start;
  useEffect(() => {
    let cancelled = false;
    const statuses: PermissionStatus[] = [];
    for (const name of ["microphone", "camera"]) {
      navigator.permissions
        ?.query({ name: name as PermissionName })
        .then((status) => {
          if (cancelled) return;
          statuses.push(status);
          status.onchange = () => {
            if (status.state === "granted") void startRef.current();
          };
        })
        .catch(() => {
          /* not supported for this name; Try again still works */
        });
    }
    return () => {
      cancelled = true;
      for (const s of statuses) s.onchange = null;
    };
  }, []);

  // Live camera preview.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.srcObject = cam ? new MediaStream([cam]) : null;
    if (cam) void el.play().catch(() => {});
  }, [cam]);

  // Live mic meter, on the shared AudioContext like VoiceWave.
  useEffect(() => {
    if (!mic) return;
    const ctx = sharedAudioContext();
    void unlockSharedAudio().catch(() => {});
    const source = ctx.createMediaStreamSource(new MediaStream([mic]));
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.3;
    source.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    let shown = 0;
    let loud = 0;
    let raf = 0;
    let lit = -1;

    const tick = () => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      // Same curve VoiceWave uses, so the two move together.
      const level = Math.min(1, Math.pow(rms / 0.07, 0.62));
      shown = level > shown ? level : shown * 0.88 + level * 0.12;

      const on = Math.round(shown * MeterSegments);
      if (on !== lit && meterRef.current) {
        lit = on;
        const segs = meterRef.current.children;
        for (let i = 0; i < segs.length; i++) segs[i].classList.toggle("on", i < on);
      }
      loud = level >= HeardLevel ? loud + 1 : Math.max(0, loud - 1);
      if (loud >= HeardFrames) setHeard(true);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      source.disconnect();
      if (meterRef.current) {
        for (const seg of Array.from(meterRef.current.children)) seg.classList.remove("on");
      }
    };
  }, [mic]);

  const micStream = useMemo(() => (mic ? new MediaStream([mic]) : null), [mic]);
  const mics = devices.filter((d) => d.kind === "audioinput");
  const cams = devices.filter((d) => d.kind === "videoinput");
  const micId = mic?.getSettings().deviceId ?? "";
  const camId = cam?.getSettings().deviceId ?? "";
  const anyProblem = micProblem != null || camProblem != null;

  function leave(kind: "done" | "skip") {
    if (kind === "done") {
      markDeviceCheckDone({ micId: micId || undefined, cameraId: camId || undefined });
    } else {
      skipDeviceCheckForSession();
    }
    // Release the devices before the next page (and LiveKit) asks for them.
    generation.current++;
    stopAll();
    navigate(next);
  }

  const micState = mic ? (heard ? "good" : "live") : micProblem ? "bad" : "wait";

  return (
    <PageShell
      title="Mic check"
      tag="Make sure we can see and hear you before you sing."
      wide
      className="device-check-page"
      stream={micStream}
      onHome={stopAll}
    >
      <div className="dc-grid">
        <section className="card dc-panel dc-camera">
          <h2>Camera</h2>
          <div className={cam ? "dc-video" : "dc-video is-off"}>
            <video ref={videoRef} autoPlay muted playsInline aria-label="Your camera preview" />
            {!cam ? (
              <span className="dc-video-off">{busy ? "Starting camera…" : "Camera off"}</span>
            ) : null}
          </div>
          {camProblem ? <Notice kind="camera" problem={camProblem} soft /> : null}
          {cams.length > 1 ? (
            <DevicePicker
              label="Camera"
              devices={cams}
              value={camId}
              disabled={busy}
              onPick={(id) => void pick("camera", id)}
            />
          ) : null}
        </section>

        <section className="card dc-panel dc-mic">
          <h2>Microphone</h2>
          <p className={`dc-mic-state is-${micState}`} aria-live="polite">
            {micState === "good"
              ? "We can hear you."
              : micState === "live"
                ? "Say something or sing a line — the meter should move."
                : micState === "bad"
                  ? "No mic yet."
                  : "Starting mic…"}
          </p>
          <div className="dc-meter" ref={meterRef} role="presentation">
            {Array.from({ length: MeterSegments }, (_, i) => (
              <span key={i} />
            ))}
          </div>
          {micProblem ? <Notice kind="mic" problem={micProblem} /> : null}
          {mics.length > 1 ? (
            <DevicePicker
              label="Microphone"
              devices={mics}
              value={micId}
              disabled={busy}
              onPick={(id) => void pick("mic", id)}
            />
          ) : null}

          <div className="dc-tip">
            <p className="dc-tip-head">Tip: wear headphones</p>
            <p>
              Your mic picks up whatever your speakers play — the backing track and the other
              singer — and that echo gets scored and sent back to them. Any earbuds or headphones
              fix it. Recommended, not required.
            </p>
          </div>
        </section>
      </div>

      <div className="ctas dc-actions">
        {anyProblem ? (
          <button type="button" className="cta cta-ghost" disabled={busy} onClick={() => void start()}>
            Try again
          </button>
        ) : null}
        <button type="button" className="cta" disabled={!mic} onClick={() => leave("done")}>
          {rerun ? "Done" : "Looks good — continue"}
        </button>
        {!rerun ? (
          <button type="button" className="dc-skip" onClick={() => leave("skip")}>
            Skip for now
          </button>
        ) : null}
      </div>
    </PageShell>
  );
}

function Notice({ kind, problem, soft }: { kind: Kind; problem: Problem; soft?: boolean }) {
  const copy = COPY[kind][problem];
  return (
    <div className={soft ? "dc-notice is-soft" : "dc-notice"} role="alert">
      <p className="dc-notice-head">{copy.title}</p>
      <p>{copy.body}</p>
    </div>
  );
}

function DevicePicker({
  label,
  devices,
  value,
  disabled,
  onPick,
}: {
  label: string;
  devices: MediaDeviceInfo[];
  value: string;
  disabled?: boolean;
  onPick: (deviceId: string) => void;
}) {
  return (
    <label className="dc-pick">
      <span>{label}</span>
      <select value={value} disabled={disabled} onChange={(e) => onPick(e.target.value)}>
        {value && !devices.some((d) => d.deviceId === value) ? <option value={value}>Current</option> : null}
        {devices.map((d, i) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || `${label} ${i + 1}`}
          </option>
        ))}
      </select>
    </label>
  );
}
