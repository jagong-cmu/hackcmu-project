import { PitchDetector } from "pitchy";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { songById, type MelodyFile, type RoomState } from "@karaoke/shared";
import { useMatchMomentCapture } from "../results/useMatchMoment.ts";
import { LyricsOverlay } from "../lyrics/LyricsOverlay.tsx";
import { cueAt, duetSeat, singingNow, windowsForSeat } from "../lyrics/duetParts.ts";
import { parseLrc } from "../lyrics/parseLrc.ts";
import { ResultsModal, ScoringWait } from "../results/ResultsModal.tsx";
import { HitCallout } from "../scoring/HitCallout.tsx";
import { gradeLive } from "../scoring/hitGrade.ts";
import { PitchMeter } from "../scoring/PitchMeter.tsx";
import { LiveScoreHud, type ScoreBits } from "../scoring/ScoreBars.tsx";
import { loadSongPack } from "../scoring/catalog.ts";
import { isMusicOnly, PITCH_FFT } from "../scoring/cancelPlayback.ts";
import { scoreContour, type PitchFrame } from "../scoring/scoreClip.ts";
import { rmsOf } from "../scoring/pitchGuide.ts";
import { postTurnScore } from "../scoring/postScore.ts";
import { getClientId, getDisplayName } from "../home/identity.ts";
import { sharedAudioContext, unlockSharedAudio } from "../media/audioContext.ts";
import { InstrumentalVolume } from "../media/levels.ts";
import { useStage } from "./StageContext.tsx";
import { useRoom, type ClockPlay } from "../rooms/RoomProvider.tsx";
import { playheadFromClock } from "./useSharedClock.ts";

/** Same song-time on both laptops. Never follow a local <audio> that hasn't sought yet. */
function displayPlayhead(
  clockPlay: ClockPlay | null,
  room: RoomState | null,
  audio: HTMLAudioElement | null | undefined,
): number {
  const fromClock = playheadFromClock(clockPlay);
  if (fromClock != null) return fromClock;
  if (room?.playAtUnixMs != null && room.songId) {
    const song = songById(room.songId);
    if (song) {
      const together = room.mode === "duet" || room.mode === "chaos";
      const startSec = together ? song.duetClipStartSec : song.clipStartSec;
      const durationSec =
        room.mode === "duet"
          ? song.duetClipDurationSec
          : room.mode === "chaos"
            ? song.chaosDurationSec
            : song.clipDurationSec;
      const t = playheadFromClock({
        songId: room.songId,
        startSec,
        durationSec,
        playAtUnixMs: room.playAtUnixMs,
      });
      if (t != null) return t;
    }
  }
  return audio?.currentTime ?? 0;
}

function isScoringClip(room: RoomState | null, myPlayerId: string | null): boolean {
  if (!room || !myPlayerId || room.mode === "chaos") return false;
  if (room.mode === "duet") return room.status === "live";
  return (
    (room.status === "turnA" || room.status === "turnB") &&
    room.activeSingerId === myPlayerId
  );
}

export function StageLyrics() {
  const { audioRef, room, myPlayerId, reportDuetVoice } = useStage();
  const { clockPlay } = useRoom();
  const [lrc, setLrc] = useState("");
  const [lrcFailed, setLrcFailed] = useState(false);
  const [t, setT] = useState(0);
  const running =
    room?.status === "countdown" ||
    room?.status === "turnA" ||
    room?.status === "turnB" ||
    room?.status === "swap" ||
    room?.status === "live";
  const lines = useMemo(() => parseLrc(lrc), [lrc]);
  const duetOn = room?.mode === "duet" && running;
  const song = room?.songId ? songById(room.songId) : undefined;
  const clockPlayRef = useRef(clockPlay);
  const roomRef = useRef(room);
  clockPlayRef.current = clockPlay;
  roomRef.current = room;
  const singing =
    room?.status === "turnA" || room?.status === "turnB" || room?.status === "live";
  const windowSec =
    room?.mode === "duet" ? song?.duetClipDurationSec : song?.clipDurationSec;
  useMatchMomentCapture({
    matchKey:
      room?.playAtUnixMs && room.songId ? `${room.code}:${room.songId}:${room.playAtUnixMs}` : "",
    singing: Boolean(singing && room?.mode !== "chaos"),
    windowMs: (windowSec ?? 20) * 1000,
    settle: room?.status === "results",
    reset: !room || room.status === "lobby" || room.mode === "chaos",
  });

  useEffect(() => {
    const id = room?.songId;
    if (!id) {
      setLrc("");
      setLrcFailed(false);
      return;
    }
    let cancelled = false;
    setLrcFailed(false);
    void loadSongPack(id)
      .then((pack) => {
        if (!cancelled) setLrc(pack.lrc);
      })
      .catch(() => {
        if (!cancelled) setLrcFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [room?.songId]);

  useEffect(() => {
    if (!running) return;
    let raf = 0;
    const tick = () => {
      setT(displayPlayhead(clockPlayRef.current, roomRef.current, audioRef.current));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [audioRef, running]);

  useEffect(() => {
    if (!duetOn) {
      reportDuetVoice(null);
      return;
    }
    reportDuetVoice(cueAt(lines, t).voice);
  }, [duetOn, lines, t, reportDuetVoice]);

  if (!room?.songId) {
    return (
      <div className="lyrics">
        <p className="lyrics-now">{room?.mode === "chaos" ? "Next song starting…" : "·"}</p>
      </div>
    );
  }
  if (!lrc) {
    return (
      <div className="lyrics">
        <p className="lyrics-now">{lrcFailed ? "Lyrics unavailable" : "Loading lyrics…"}</p>
      </div>
    );
  }
  return (
    <LyricsOverlay
      lrc={lines}
      currentTime={t}
      duet={
        duetOn && room
          ? {
              seat: duetSeat(room.players, myPlayerId),
              nameA: room.players[0]?.displayName ?? "A",
              nameB: room.players[1]?.displayName ?? "B",
            }
          : null
      }
    />
  );
}

export function StagePitch() {
  const { audioRef, micStream, room, myPlayerId, duetVoice } = useStage();
  const { clockPlay, livePitches, emitPitchLive, scores, matchOver } = useRoom();
  const [melody, setMelody] = useState<MelodyFile | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [liveHz, setLiveHz] = useState<number | null>(null);
  const [liveClarity, setLiveClarity] = useState(0);
  const [liveRms, setLiveRms] = useState(0);
  const [mineLive, setMineLive] = useState<ScoreBits | null>(null);
  const lrcRef = useRef("");
  const framesRef = useRef<PitchFrame[]>([]);
  const singingRef = useRef(false);
  const postedRef = useRef(false);
  const postingRef = useRef(false);
  const scoringRef = useRef(false);
  const meterRef = useRef(false);
  const emitRef = useRef(emitPitchLive);
  const lastEmitRef = useRef(0);
  const lastScoreAtRef = useRef(0);
  const runningRef = useRef<ScoreBits | null>(null);
  const clipWindowRef = useRef<{ startSec: number; durationSec: number } | null>(null);
  const melodyRef = useRef(melody);
  const roomRef = useRef(room);
  const myPlayerIdRef = useRef(myPlayerId);
  const clockPlayRef = useRef(clockPlay);
  const seat = room ? duetSeat(room.players, myPlayerId) : null;
  const scoring = isScoringClip(room, myPlayerId);
  const mine =
    room?.mode === "duet" ? singingNow(duetVoice, seat).me : scoring;
  scoringRef.current = scoring;
  meterRef.current = mine;
  emitRef.current = emitPitchLive;
  melodyRef.current = melody;
  roomRef.current = room;
  myPlayerIdRef.current = myPlayerId;
  clockPlayRef.current = clockPlay;
  if (clockPlay) {
    clipWindowRef.current = { startSec: clockPlay.startSec, durationSec: clockPlay.durationSec };
  }

  const refreshRunning = (t: number) => {
    if (!singingRef.current || postedRef.current) return;
    if (t - lastScoreAtRef.current < 0.12) return;
    lastScoreAtRef.current = t;
    const mel = melodyRef.current;
    const clip = clipWindowRef.current;
    const r = roomRef.current;
    if (!mel || !clip || !r) return;
    const elapsed = Math.max(0.25, t - clip.startSec);
    const duetSeatNow = duetSeat(r.players, myPlayerIdRef.current);
    const windows =
      r.mode === "duet" && duetSeatNow
        ? windowsForSeat(parseLrc(lrcRef.current), duetSeatNow, {
            startSec: clip.startSec,
            durationSec: elapsed,
          })
        : undefined;
    const dsp = scoreContour(
      framesRef.current,
      mel,
      { startSec: clip.startSec, durationSec: elapsed },
      windows,
    );
    if (dsp.silence) return;
    const next = { pitch: dsp.pitch, tone: dsp.tone, overall: dsp.overall };
    runningRef.current = next;
    setMineLive(next);
  };

  const flushScore = () => {
    const r = roomRef.current;
    const mel = melodyRef.current;
    const clip = clipWindowRef.current;
    if (!r || !mel || !clip || postedRef.current || postingRef.current || !singingRef.current) return;
    singingRef.current = false;
    postingRef.current = true;
    const duetSeatNow = duetSeat(r.players, myPlayerIdRef.current);
    const windows =
      r.mode === "duet" && duetSeatNow
        ? windowsForSeat(parseLrc(lrcRef.current), duetSeatNow, clip)
        : undefined;
    const dsp = scoreContour(framesRef.current, mel, clip, windows);
    if (!dsp.silence) {
      const next = { pitch: dsp.pitch, tone: dsp.tone, overall: dsp.overall };
      runningRef.current = next;
      setMineLive(next);
    }
    void postTurnScore(r.code, {
      clientId: getClientId(),
      displayName: getDisplayName() || "Singer",
      score: dsp,
      mode: r.mode,
      songId: r.songId ?? undefined,
      lyrics: lrcRef.current.slice(0, 600),
    })
      .then(() => {
        postedRef.current = true;
      })
      .catch(() => {
        postingRef.current = false;
        singingRef.current = true;
      });
  };
  const flushRef = useRef(flushScore);
  flushRef.current = flushScore;
  const refreshRef = useRef(refreshRunning);
  refreshRef.current = refreshRunning;

  useEffect(() => {
    const id = room?.songId;
    if (!id) return;
    let cancelled = false;
    void loadSongPack(id)
      .then((pack) => {
        if (cancelled) return;
        setMelody(pack.melody);
        lrcRef.current = pack.lrc;
      })
      .catch(() => {
        if (cancelled) return;
        setMelody(null);
      });
    return () => {
      cancelled = true;
    };
  }, [room?.songId]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    let raf = 0;
    const tick = () => {
      const shown = displayPlayhead(clockPlayRef.current, roomRef.current, audio);
      setPlayhead(shown);
      const clip = clipWindowRef.current;
      const heard = audio.currentTime;
      const pastClip = (t: number) =>
        Boolean(clip && t >= clip.startSec + clip.durationSec - 0.05);
      if (singingRef.current && !postedRef.current && (pastClip(heard) || pastClip(shown))) {
        flushRef.current();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [audioRef]);

  useEffect(() => {
    if (!micStream) return;
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = InstrumentalVolume;
    const raw = micStream.getAudioTracks()[0];
    if (!raw) return;
    // Clone so WebRTC encoding cannot starve the pitch analyser.
    const clone = raw.clone();
    const dspStream = new MediaStream([clone]);
    const ctx = sharedAudioContext();
    void unlockSharedAudio();
    const src = ctx.createMediaStreamSource(dspStream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = PITCH_FFT;
    analyser.smoothingTimeConstant = 0;
    src.connect(analyser);
    const buf = new Float32Array(PITCH_FFT);
    const silentRef = new Float32Array(PITCH_FFT);
    const detector = PitchDetector.forFloat32Array(PITCH_FFT);
    let raf = 0;
    const publish = (hz: number | null, clarity: number, rms: number) => {
      setLiveHz(hz);
      setLiveClarity(clarity);
      setLiveRms(rms);
      const now = performance.now();
      if (now - lastEmitRef.current < 40) return;
      lastEmitRef.current = now;
      const run = runningRef.current;
      emitRef.current({
        hz,
        clarity,
        rms,
        pitch: run?.pitch,
        tone: run?.tone,
        overall: run?.overall,
      });
    };
    const tick = () => {
      const t = audio.currentTime;
      analyser.getFloatTimeDomainData(buf);
      // LiveKit already runs AEC. A second speaker-cancel pass was eating
      // vocals and posting "We couldn't hear you."
      const musicOnly = isMusicOnly(buf, buf, silentRef);
      const rms = rmsOf(buf);
      const tracking = scoringRef.current || singingRef.current;
      if (!tracking) {
        raf = requestAnimationFrame(tick);
        return;
      }
      if (musicOnly) {
        if (singingRef.current) {
          framesRef.current.push({ timeSec: t, hz: null, clarity: 0 });
        }
        refreshRef.current(t);
        if (meterRef.current) publish(null, 0, 0);
      } else {
        const [yinHz, yinClarity] = detector.findPitch(buf, ctx.sampleRate);
        const hz = Number.isFinite(yinHz) && yinHz > 0 ? yinHz : null;
        const clarity = yinClarity;
        const forScore = clarity >= 0.4 && hz != null && hz >= 55 && hz <= 1200 && rms >= 0.008;
        if (singingRef.current) {
          framesRef.current.push({ timeSec: t, hz: forScore ? hz : null, clarity });
        }
        refreshRef.current(t);
        if (meterRef.current) {
          publish(hz, clarity, rms);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      src.disconnect();
      clone.stop();
    };
  }, [micStream, audioRef]);

  useEffect(() => {
    if (isScoringClip(room, myPlayerId) && !singingRef.current) {
      framesRef.current = [];
      postedRef.current = false;
      singingRef.current = true;
      postingRef.current = false;
      lastScoreAtRef.current = 0;
      runningRef.current = null;
      setMineLive(null);
    }
  }, [room, myPlayerId]);

  useEffect(() => {
    if (!room || !melody || !myPlayerId) return;
    if (isScoringClip(room, myPlayerId)) return;
    flushRef.current();
  }, [room, melody, myPlayerId]);

  useEffect(() => {
    return () => {
      flushRef.current();
    };
  }, []);

  const opponent = room?.players.find((p) => p.id !== myPlayerId);
  const singerId = room?.activeSingerId ?? null;
  const singerLive =
    singerId && singerId !== myPlayerId ? livePitches[singerId] : undefined;
  const remote = opponent ? livePitches[opponent.id] : undefined;
  const watchLive = singerLive ?? remote;
  const shownHz = mine ? liveHz : (watchLive?.hz ?? null);
  const shownClarity = mine ? liveClarity : (watchLive?.clarity ?? 0);
  const shownRms = mine ? liveRms : (watchLive?.rms ?? 0);
  const themLive = remote;
  const rankedHidden =
    room?.mode === "ranked" && room.status !== "results" && !matchOver;
  const youCard: ScoreBits | null =
    (myPlayerId ? scores[myPlayerId] : undefined) ?? mineLive;
  const themCard: ScoreBits | null = rankedHidden
    ? null
    : ((opponent ? scores[opponent.id] : undefined) ??
      (themLive && themLive.overall != null
        ? {
            pitch: themLive.pitch ?? 0,
            tone: themLive.tone ?? 0,
            overall: themLive.overall,
          }
        : null));
  const youSinging =
    room?.mode === "duet"
      ? singingNow(duetVoice, seat).me
      : Boolean(room && myPlayerId && room.activeSingerId === myPlayerId && (room.status === "turnA" || room.status === "turnB"));
  const themSinging =
    room?.mode === "duet"
      ? singingNow(duetVoice, seat).them
      : Boolean(room && opponent && room.activeSingerId === opponent.id && (room.status === "turnA" || room.status === "turnB"));
  const showHud =
    room?.mode === "ranked" || room?.mode === "duet"
      ? room.status === "turnA" ||
        room.status === "turnB" ||
        room.status === "swap" ||
        room.status === "live"
      : false;
  const calloutGrade = gradeLive(melody, playhead, shownHz);

  return (
    <div className="pitch-stage">
      <PitchMeter
        melody={melody}
        playheadSec={playhead}
        liveHz={shownHz}
        liveClarity={shownClarity}
        liveRms={shownRms}
      />
      {showHud ? <HitCallout grade={calloutGrade} /> : null}
      {showHud ? (
        <LiveScoreHud
          left={{ name: opponent?.displayName ?? "Them", card: themCard, singing: themSinging }}
          right={{ name: "You", card: youCard, singing: youSinging }}
        />
      ) : null}
    </div>
  );
}

export function StageResults() {
  const navigate = useNavigate();
  const { room, myPlayerId } = useStage();
  const { matchOver, scores, ready, roomLeave } = useRoom();
  if (!room || !myPlayerId) return null;
  if (room.status === "results" && !matchOver) return <ScoringWait />;
  if (!matchOver) return null;

  const you = scores[myPlayerId] ?? matchOver.scores[myPlayerId];
  const opponent = room.players.find((p) => p.id !== myPlayerId);
  const oppCard = opponent
    ? (scores[opponent.id] ?? matchOver.scores[opponent.id] ?? null)
    : null;
  if (!you) return <ScoringWait />;

  const shared =
    room.mode === "duet" && oppCard
      ? Math.round((you.overall + oppCard.overall) / 2)
      : null;
  const myDelta =
    room.mode === "ranked"
      ? room.players[0]?.id === myPlayerId
        ? matchOver.eloDelta
        : -matchOver.eloDelta
      : null;
  const rankedWinner =
    matchOver.winnerId ?? (room.mode === "ranked" ? "draw" : null);
  const song = room.songId ? songById(room.songId) : undefined;

  return (
    <ResultsModal
      you={you}
      youName="You"
      opponent={oppCard}
      opponentName={opponent?.displayName ?? "Them"}
      revealOpponent
      winnerId={rankedWinner}
      youId={myPlayerId}
      opponentId={opponent?.id}
      eloDelta={myDelta}
      shared={shared}
      songTitle={song?.title}
      songArtist={song?.artist}
      onHome={() => {
        roomLeave();
        navigate("/");
      }}
      onRematch={() => ready()}
    />
  );
}
