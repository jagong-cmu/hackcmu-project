/**
 * Ranked waiting screen: searching (on /play/ranked?go=1) and match found
 * (the stage's pre-match countdown, drawn over it until GO). Display only:
 * the queue, the clock and the pitch detector are read, never changed.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { PitchDetector } from "pitchy";
import { RankedHookMaxSec, SONGS, songById, type PlayerPublic, type RoomState } from "@karaoke/shared";
import { eloDelta } from "../../../../server/src/elo.ts";
import { Button } from "../ui/Button.tsx";
import { Digits } from "../ui/Digits.tsx";
import { Img } from "../ui/Img.tsx";
import { KeyHint } from "../ui/KeyHints.tsx";
import { artFor } from "../ui/assets.ts";
import { PitchMeter } from "../scoring/PitchMeter.tsx";
import { PITCH_FFT } from "../scoring/cancelPlayback.ts";
import { midiFromHz } from "../scoring/cents.ts";
import { MIN_RMS, noteName, pitchAnalyser, rejectFrame, rmsOf, segmentMelody } from "../scoring/pitchGuide.ts";
import { loadSongPack } from "../scoring/catalog.ts";
import { useVoiceProfile } from "../auth/AuthProvider.tsx";
import { checkPathFor, preferredCameraId, preferredMicId } from "../onboarding/deviceCheck.ts";
import { serverNow } from "../rooms/timeSync.ts";
import { mmss } from "../stage/ClipTimer.tsx";
import "./rankedWaiting.css";

const SilentMs = 5000;
/** Any input at all. A dead or muted mic reads ~0; a quiet room is still above this. */
const SignalRms = MIN_RMS / 5;
/** Shorter runs are pitch-tracker blips, not notes (same cut as training/vocalRange). */
const MinNoteSec = 0.15;
const TipMs = 7000;

const Tips = [
  "Octave doesn't matter. Sing it low or high, it scores the same.",
  "Pitch is 70% of your score. Land the notes before you belt them.",
  "The music starts 5 seconds before your first line. Use it to find the key.",
  "Stay quiet on their turn. Your mic stays open and they can hear you.",
  "Headphones keep the track out of your mic.",
];

/** When this tab joined the queue, so the match-found screen can say how long it waited. */
let queuedAt: number | null = null;

const initialOf = (name: string | undefined) => (name?.trim()[0] ?? "?").toUpperCase();

function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

// ---------------------------------------------------------------------------
// Searching
// ---------------------------------------------------------------------------

export function RankedSearching({
  me,
  name,
  connected,
  notice,
  onLeave,
  onHome,
}: {
  me: PlayerPublic | null;
  name: string;
  connected: boolean;
  notice?: ReactNode;
  onLeave: () => void;
  onHome: () => void;
}) {
  const [since] = useState(() => (queuedAt = Date.now()));
  const now = useNow(1000);
  const media = useLocalMedia();
  const [tip, setTip] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setTip((n) => (n + 1) % Tips.length), TipMs);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) onLeave();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onLeave]);

  return (
    <Shell
      onHome={onHome}
      timerLabel="In queue"
      timer={mmss((now - since) / 1000)}
      notice={notice}
      you={
        <>
          <CardHead side="you" />
          <Cam name={name}>{media.stream?.getVideoTracks().length ? <LocalVideo stream={media.stream} /> : null}</Cam>
          <Who name={name} elo={me?.elo ?? null} />
          <WarmUp stream={media.stream} failed={media.failed} />
        </>
      }
      center={
        <>
          <p className="rw-vs" aria-hidden="true">VS</p>
          <p className="t-label rw-dim">Tonight's chorus</p>
          <Reel songId={null} />
          <p className="rw-caption">Locks in when you're matched.</p>
          <Steps sec={RankedHookMaxSec} part="chorus" active={null} youFirst={null} />
        </>
      }
      them={
        <>
          <CardHead side="them" />
          <div className="rw-cam rw-cam-empty" aria-hidden="true">
            <svg className="rw-silhouette" viewBox="0 0 100 100">
              <circle cx="50" cy="38" r="17" />
              <path d="M18 100c0-22 14-36 32-36s32 14 32 36z" />
            </svg>
            <span className="rw-scan" />
          </div>
          <div className="rw-looking">
            <span className="rw-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <p className="t-label">Looking for a singer</p>
            <p className="rw-copy" role="status">
              {connected ? "Stay here. The next person who taps Play is your match." : "Connecting. You'll be matched automatically."}
            </p>
          </div>
          <p className="rw-elo">
            <span className="t-label rw-dim">Elo</span> <span className="t-num rw-dim">—</span>
          </p>
          <p className="rw-tip" key={tip}>
            <span className="t-label">Tip</span> {Tips[tip]}
          </p>
        </>
      }
      foot={
        <>
          <Button variant="secondary" onClick={onLeave}>
            Leave queue
          </Button>
          <span className="rw-keys">
            <KeyHint keys={["Esc"]} label="Leave queue" />
          </span>
        </>
      }
    />
  );
}

/** Camera + raw mic for the preview tile and the warm-up lane. Released on unmount. */
function useLocalMedia() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    let got: MediaStream | null = null;
    const mic = preferredMicId();
    const cam = preferredCameraId();
    const audio: MediaTrackConstraints = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
      ...(mic ? { deviceId: mic } : {}),
    };
    const ask = (c: MediaStreamConstraints) => navigator.mediaDevices.getUserMedia(c);
    (async () => {
      try {
        got = await ask({ audio, video: cam ? { deviceId: cam } : true });
      } catch {
        try {
          got = await ask({ audio });
        } catch {
          if (live) setFailed(true);
          return;
        }
      }
      if (live) setStream(got);
      else got.getTracks().forEach((t) => t.stop());
    })();
    return () => {
      live = false;
      got?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  return { stream, failed };
}

function LocalVideo({ stream }: { stream: MediaStream }) {
  return (
    <video
      ref={(el) => {
        if (el && el.srcObject !== stream) el.srcObject = stream;
      }}
      autoPlay
      playsInline
      muted
    />
  );
}

/** Mini pitch lane: the singing view's PitchMeter with no melody, fed by the same detector path. */
function WarmUp({ stream, failed }: { stream: MediaStream | null; failed: boolean }) {
  const profile = useVoiceProfile();
  const [live, setLive] = useState({ hz: null as number | null, clarity: 0, rms: 0, t: 0 });
  const [silent, setSilent] = useState(false);
  const [heard, setHeard] = useState(false);

  useEffect(() => {
    if (!stream?.getAudioTracks().length) return;
    const ctx = new AudioContext();
    const resume = () => void ctx.resume();
    resume();
    window.addEventListener("pointerdown", resume);
    const src = ctx.createMediaStreamSource(stream);
    const analyser = pitchAnalyser(ctx, src, PITCH_FFT);
    const buf = new Float32Array(PITCH_FFT);
    const detector = PitchDetector.forFloat32Array(PITCH_FFT);
    let heardAt = performance.now();
    let raf = 0;
    const tick = () => {
      const now = performance.now();
      if (ctx.state === "running") {
        analyser.getFloatTimeDomainData(buf);
        const rms = rmsOf(buf);
        const [hz, clarity] = detector.findPitch(buf, ctx.sampleRate);
        if (rms >= SignalRms) {
          heardAt = now;
          setHeard(true);
        }
        setLive({ hz: hz > 0 ? hz : null, clarity, rms, t: now / 1000 });
      } else {
        heardAt = now;
      }
      setSilent(now - heardAt > SilentMs);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointerdown", resume);
      src.disconnect();
      void ctx.close();
    };
  }, [stream]);

  const noMic = failed || (stream != null && !stream.getAudioTracks().length);
  const note = rejectFrame(live.hz, live.clarity, live.rms) == null ? noteName(midiFromHz(live.hz!)) : null;
  const checkLink = <Link to={checkPathFor("/play/ranked?go=1")}>Check your mic</Link>;

  return (
    <div className="rw-warm">
      <p className="t-label rw-dim">Warm up / hum a note</p>
      <div className="rw-lane">
        <PitchMeter melody={null} playheadSec={live.t} liveHz={live.hz} liveClarity={live.clarity} liveRms={live.rms} voiceProfile={profile} />
        <span className="rw-note t-num" aria-hidden="true">{note ?? "—"}</span>
      </div>
      {noMic ? (
        <p className="rw-copy rw-warn" role="status">Your mic is blocked, so you can't be scored. {checkLink}</p>
      ) : silent ? (
        <p className="rw-copy rw-warn" role="status">We can't hear your mic. {checkLink}</p>
      ) : (
        <p className="rw-copy">{heard ? "Your mic is working. Sing a few notes while you wait." : "Listening for your mic…"}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Match found
// ---------------------------------------------------------------------------

export function RankedMatched({
  room,
  myId,
  playAtUnixMs,
  youCamera,
  themCamera,
  onHome,
}: {
  room: RoomState;
  myId: string;
  playAtUnixMs: number | null;
  youCamera: ReactNode;
  themCamera: ReactNode;
  onHome: () => void;
}) {
  const [waited] = useState(() => (queuedAt == null ? null : (Date.now() - queuedAt) / 1000));
  useNow(100);
  const self = room.players.find((p) => p.id === myId);
  const them = room.players.find((p) => p.id !== myId);
  const counting = room.status === "countdown";
  const youFirst = counting && room.activeSingerId ? room.activeSingerId === myId : null;
  const songId = counting ? room.songId : null;
  const song = songId ? songById(songId) : undefined;
  const part = room.clipAnchor === "firstLyric" ? "opening" : "chorus";
  const sungSec = Math.round(
    room.clipDurationSec != null ? room.clipDurationSec - (room.clipLeadInSec ?? 0) : (song?.clipDurationSec ?? RankedHookMaxSec),
  );
  const msUntil = counting && playAtUnixMs != null ? playAtUnixMs - serverNow() : null;
  const secs = msUntil == null ? null : Math.ceil(msUntil / 1000);
  const rated = room.rated !== false;
  const elo = rated && self && them ? { win: eloDelta(self.elo, them.elo, 1).a, loss: eloDelta(self.elo, them.elo, 0).a } : null;

  return createPortal(
    <Shell
      matched
      leaving={msUntil != null && msUntil <= 300}
      onHome={onHome}
      timerLabel="Waited"
      timer={waited == null ? null : mmss(waited)}
      you={
        <>
          <CardHead side="you" badge={youFirst == null ? null : youFirst ? "Singing first" : "Singing second"} />
          <Cam name={self?.displayName}>{youCamera}</Cam>
          <Who name={self?.displayName ?? "You"} elo={self?.elo ?? null} />
          <RangeCompare room={room} songId={songId} />
          {elo ? (
            <p className="rw-stakes">
              <span className="t-label rw-dim">Win</span> <Digits className="t-num rw-ice" value={`+${elo.win}`} />
              <span className="t-label rw-dim">Loss</span> <Digits className="t-num rw-dim" value={`−${Math.abs(elo.loss)}`} />
            </p>
          ) : null}
        </>
      }
      center={
        <>
          <p className="rw-vs on" aria-hidden="true">
            <span>V</span>
            <span>S</span>
          </p>
          <p className="t-label rw-dim">{song ? `Tonight's ${part}` : "Tonight's chorus"}</p>
          <Reel songId={songId} />
          {song ? (
            <div className="rw-song">
              <span className="rw-art" aria-hidden="true">
                {initialOf(song.title)}
                <Img src={artFor(song.id)} alt="" width={48} height={48} />
              </span>
              <span>
                <span className="rw-artist">{song.artist}</span>
                <span className="t-label rw-dim">
                  {part} / <Digits value={mmss(sungSec)} />
                </span>
              </span>
            </div>
          ) : (
            <p className="rw-caption">Picking a song…</p>
          )}
          <Steps sec={sungSec} part={part} active={youFirst == null ? null : youFirst ? 1 : 2} youFirst={youFirst} />
        </>
      }
      them={
        <>
          <CardHead side="them" badge="Ready" />
          <Cam name={them?.displayName}>{themCamera}</Cam>
          <Who name={them?.displayName ?? "Opponent"} elo={them?.elo ?? null} />
        </>
      }
      foot={
        <div className={`rw-count${secs != null && secs <= 3 && secs > 0 ? " on" : ""}${youFirst === false ? " them" : ""}`} aria-live="polite">
          <p className="t-label">{youFirst === false ? "They're up in" : "You're up in"}</p>
          <span className="rw-ring">
            <span className="rw-ring-num" key={secs ?? 0}>
              {secs != null && secs > 0 && secs <= 3 ? secs : ""}
            </span>
          </span>
        </div>
      }
    />,
    document.body,
  );
}

/** Your saved range against the clip's notes. Nothing renders without both. */
function RangeCompare({ room, songId }: { room: RoomState; songId: string | null }) {
  const profile = useVoiceProfile();
  const [songRange, setSongRange] = useState<{ id: string; lo: number; hi: number } | null>(null);
  const from = (room.clipStartSec ?? 0) + (room.clipLeadInSec ?? 0);
  const to = (room.clipStartSec ?? 0) + (room.clipDurationSec ?? 0);

  useEffect(() => {
    if (!songId || !profile || to <= from) return;
    let live = true;
    loadSongPack(songId)
      .then(({ melody }) => {
        const midis = segmentMelody(melody)
          .filter((n) => n.endSec - n.startSec >= MinNoteSec && n.endSec > from && n.startSec < to)
          .map((n) => n.midi);
        if (live && midis.length) setSongRange({ id: songId, lo: Math.min(...midis), hi: Math.max(...midis) });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [songId, profile, from, to]);

  if (!profile || !songRange || songRange.id !== songId) return null;
  const lo = Math.min(profile.lowMidi, songRange.lo) - 1;
  const span = Math.max(profile.highMidi, songRange.hi) + 1 - lo;
  const bar = (a: number, b: number) => ({ left: `${((a - lo) / span) * 100}%`, width: `${((b - a) / span) * 100}%` });
  // One semitone of slack: the profile is an estimate.
  const advice =
    songRange.hi > profile.highMidi + 1
      ? "Sing it an octave down. It scores the same."
      : songRange.lo < profile.lowMidi - 1
        ? "Sing it an octave up. It scores the same."
        : null;
  return (
    <div className="rw-range">
      <p className="rw-range-row">
        <span className="t-label rw-dim">You</span>
        <span className="rw-track"><i className="you" style={bar(profile.lowMidi, profile.highMidi)} /></span>
        <span className="rw-range-txt">{noteName(profile.lowMidi)}–{noteName(profile.highMidi)}</span>
      </p>
      <p className="rw-range-row">
        <span className="t-label rw-dim">Song</span>
        <span className="rw-track"><i style={bar(songRange.lo, songRange.hi)} /></span>
        <span className="rw-range-txt">{noteName(songRange.lo)}–{noteName(songRange.hi)}</span>
      </p>
      {advice ? <p className="rw-copy">{advice}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

function Shell({
  matched = false,
  leaving = false,
  onHome,
  timerLabel,
  timer,
  notice,
  you,
  center,
  them,
  foot,
}: {
  matched?: boolean;
  leaving?: boolean;
  onHome: () => void;
  timerLabel: string;
  timer: string | null;
  notice?: ReactNode;
  you: ReactNode;
  center: ReactNode;
  them: ReactNode;
  foot: ReactNode;
}) {
  return (
    <div className={`rw${matched ? " rw-matched" : ""}${leaving ? " rw-leaving" : ""}`}>
      <header className="rw-head">
        <div>
          <Link className="rw-home" to="/" onClick={onHome}>
            ← Home
          </Link>
          <h1 className="t-title">Ranked</h1>
          {matched ? <p className="t-label rw-found" role="status">Match found</p> : null}
        </div>
        {timer != null ? (
          <p className="rw-timer">
            <span className="t-label rw-dim">{timerLabel}</span>
            <Digits className="t-num" value={timer} />
          </p>
        ) : null}
      </header>
      {notice ? <div className="rw-notice">{notice}</div> : null}
      <main className="rw-row">
        <section className="rw-card rw-you" aria-label="You">{you}</section>
        <section className="rw-center" aria-label="Format">{center}</section>
        <section className="rw-card rw-them" aria-label="Opponent">{them}</section>
      </main>
      <footer className="rw-foot">{foot}</footer>
    </div>
  );
}

function CardHead({ side, badge = null }: { side: "you" | "them"; badge?: string | null }) {
  return (
    <p className="rw-card-head">
      <span className="t-label">{side === "you" ? "You" : "Opponent"}</span>
      {badge ? <span className="rw-badge t-tab">{badge}</span> : null}
    </p>
  );
}

function Cam({ name, children }: { name: string | undefined; children: ReactNode }) {
  return (
    <div className="rw-cam">
      <span className="rw-initial" aria-hidden="true">{initialOf(name)}</span>
      {children}
    </div>
  );
}

function Who({ name, elo }: { name: string; elo: number | null }) {
  return (
    <p className="rw-who">
      <span className="rw-name">{name}</span>
      <span>
        <span className="t-label rw-dim">Elo</span> {elo == null ? <span className="t-num rw-dim">—</span> : <Digits className="t-num rw-ice" value={elo} />}
      </span>
    </p>
  );
}

/** Titles from the real song list. Spins while searching; lands on the pick once it's known. */
function Reel({ songId }: { songId: string | null }) {
  const spin = useMemo(() => [...SONGS, ...SONGS].map((s) => s.title), []);
  const land = useMemo(() => {
    if (!songId) return null;
    const others = SONGS.filter((s) => s.id !== songId).map((s) => s.title);
    const pick = songById(songId)?.title ?? songId;
    // Several laps, the pick second-to-last so it lands in the middle row.
    return [...others, ...others, ...others, pick, others[0] ?? ""];
  }, [songId]);
  return (
    <div className="rw-reel">
      {land ? (
        <ol className="rw-reel-track land" style={{ ["--land" as string]: land.length - 3 }} aria-hidden="true">
          {land.map((t, i) => (
            <li key={i} className={i === land.length - 2 ? "pick" : undefined}>{t}</li>
          ))}
        </ol>
      ) : (
        <>
          <ol className="rw-reel-track spin" aria-hidden="true">
            {spin.map((t, i) => <li key={i}>{t}</li>)}
          </ol>
          <p className="rw-reel-still">Picking a chorus</p>
        </>
      )}
      {land ? <p className="sr-only">{land[land.length - 2]}</p> : null}
    </div>
  );
}

function Steps({
  sec,
  part,
  active,
  youFirst,
}: {
  sec: number;
  part: string;
  active: 1 | 2 | null;
  youFirst: boolean | null;
}) {
  const first = youFirst === false ? { who: "them", text: `They sing the ${part}` } : { who: "you", text: `You sing the ${part}` };
  const second = youFirst === false ? { who: "you", text: "You sing the same one" } : { who: "them", text: "They sing the same one" };
  const rows = [
    { n: 1, ...first, dur: `${sec}s` },
    { n: 2, ...second, dur: `${sec}s` },
    { n: 3, who: "ice", text: "Higher score takes the Elo", dur: null },
  ];
  return (
    <ol className="rw-steps">
      {rows.map((r) => (
        <li key={r.n} className={`${r.who}${active === r.n ? " on" : ""}`}>
          <span className="rw-step-n t-num">{r.n}</span>
          <span className="rw-step-text">
            {r.text}
            {active === r.n ? <span className="t-label rw-next">{youFirst ? "Up next" : "Then you"}</span> : null}
          </span>
          {r.dur ? <span className="rw-dur">{r.dur}</span> : null}
        </li>
      ))}
    </ol>
  );
}
