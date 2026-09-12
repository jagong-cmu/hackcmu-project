import { PitchDetector } from "pitchy";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { MelodyFile } from "@karaoke/shared";
import type { LayersModel } from "@tensorflow/tfjs";
import { LyricsOverlay } from "../lyrics/LyricsOverlay.tsx";
import { cueAt, duetSeat, singingNow, windowsForSeat } from "../lyrics/duetParts.ts";
import { parseLrc } from "../lyrics/parseLrc.ts";
import { ResultsModal } from "../results/ResultsModal.tsx";
import { HitCallout } from "../scoring/HitCallout.tsx";
import { gradeLive } from "../scoring/hitGrade.ts";
import { PitchMeter } from "../scoring/PitchMeter.tsx";
import { loadSongPack } from "../scoring/catalog.ts";
import {
  cancelSpeaker,
  createSpeakerCanceller,
  ensurePlaybackTap,
  isMusicOnly,
  PITCH_FFT,
} from "../scoring/cancelPlayback.ts";
import { crepeFromBuffer, preloadCrepe } from "../scoring/crepePitch.ts";
import { scoreContour, type PitchFrame } from "../scoring/scoreClip.ts";
import { rmsOf } from "../scoring/pitchGuide.ts";
import { postTurnScore } from "../scoring/postScore.ts";
import { getClientId, getDisplayName } from "../home/identity.ts";
import { useStage } from "./StageContext.tsx";
import { useRoom } from "../rooms/RoomProvider.tsx";
import type { RoomState } from "@karaoke/shared";

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
  const [lrc, setLrc] = useState("");
  const [t, setT] = useState(0);
  const running =
    room?.status === "countdown" ||
    room?.status === "turnA" ||
    room?.status === "turnB" ||
    room?.status === "swap" ||
    room?.status === "live";
  const lines = useMemo(() => parseLrc(lrc), [lrc]);
  const duetOn = room?.mode === "duet" && running;

  useEffect(() => {
    const id = room?.songId;
    if (!id) {
      setLrc("");
      return;
    }
    let cancelled = false;
    void loadSongPack(id).then((pack) => {
      if (!cancelled) setLrc(pack.lrc);
    });
    return () => {
      cancelled = true;
    };
  }, [room?.songId]);

  useEffect(() => {
    if (!running) return;
    let raf = 0;
    const tick = () => {
      setT(audioRef.current?.currentTime ?? 0);
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
        <p className="lyrics-now">Loading lyrics…</p>
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
  const { clockPlay, livePitch, emitPitchLive } = useRoom();
  const [melody, setMelody] = useState<MelodyFile | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [liveHz, setLiveHz] = useState<number | null>(null);
  const [liveClarity, setLiveClarity] = useState(0);
  const [liveRms, setLiveRms] = useState(0);
  const lrcRef = useRef("");
  const framesRef = useRef<PitchFrame[]>([]);
  const singingRef = useRef(false);
  const postedRef = useRef(false);
  const crepeRef = useRef<LayersModel | null>(null);
  const scoringRef = useRef(false);
  const meterRef = useRef(false);
  const emitRef = useRef(emitPitchLive);
  const lastEmitRef = useRef(0);
  const clipWindowRef = useRef<{ startSec: number; durationSec: number } | null>(null);
  const melodyRef = useRef(melody);
  const roomRef = useRef(room);
  const myPlayerIdRef = useRef(myPlayerId);
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
  if (clockPlay) {
    clipWindowRef.current = { startSec: clockPlay.startSec, durationSec: clockPlay.durationSec };
  }

  const flushScore = () => {
    const r = roomRef.current;
    const mel = melodyRef.current;
    const clip = clipWindowRef.current;
    if (!r || !mel || !clip || postedRef.current || !singingRef.current) return;
    singingRef.current = false;
    postedRef.current = true;
    const duetSeatNow = duetSeat(r.players, myPlayerIdRef.current);
    const windows =
      r.mode === "duet" && duetSeatNow
        ? windowsForSeat(parseLrc(lrcRef.current), duetSeatNow, clip)
        : undefined;
    const dsp = scoreContour(framesRef.current, mel, clip, windows);
    void postTurnScore(r.code, {
      clientId: getClientId(),
      displayName: getDisplayName() || "Singer",
      score: dsp,
      mode: r.mode,
      songId: r.songId ?? undefined,
      lyrics: lrcRef.current.slice(0, 600),
    });
  };
  const flushRef = useRef(flushScore);
  flushRef.current = flushScore;

  useEffect(() => {
    void preloadCrepe()
      .then((model) => {
        crepeRef.current = model;
      })
      .catch(() => {
        crepeRef.current = null;
      });
  }, []);

  useEffect(() => {
    const id = room?.songId;
    if (!id) return;
    let cancelled = false;
    void loadSongPack(id).then((pack) => {
      if (cancelled) return;
      setMelody(pack.melody);
      lrcRef.current = pack.lrc;
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
      const t = audio.currentTime;
      setPlayhead(t);
      const clip = clipWindowRef.current;
      if (
        clip &&
        singingRef.current &&
        !postedRef.current &&
        t >= clip.startSec + clip.durationSec - 0.05
      ) {
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
    audio.volume = 0.8;
    const tap = ensurePlaybackTap(audio);
    const ctx = tap?.ctx ?? new AudioContext();
    void ctx.resume();
    const src = ctx.createMediaStreamSource(micStream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = PITCH_FFT;
    analyser.smoothingTimeConstant = 0;
    src.connect(analyser);
    const buf = new Float32Array(PITCH_FFT);
    const refBuf = new Float32Array(PITCH_FFT);
    const clean = new Float32Array(PITCH_FFT);
    const detector = PitchDetector.forFloat32Array(PITCH_FFT);
    const canceller = createSpeakerCanceller();
    let raf = 0;
    let crepeSkip = 0;
    let lastCrepe = { hz: null as number | null, confidence: 0 };
    const publish = (hz: number | null, clarity: number, rms: number) => {
      setLiveHz(hz);
      setLiveClarity(clarity);
      setLiveRms(rms);
      const now = performance.now();
      if (now - lastEmitRef.current < 50) return;
      lastEmitRef.current = now;
      emitRef.current({ hz, clarity, rms });
    };
    const tick = () => {
      const t = audio.currentTime;
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
      const tracking = scoringRef.current || singingRef.current;
      if (!tracking) {
        raf = requestAnimationFrame(tick);
        return;
      }
      if (musicOnly) {
        if (singingRef.current) {
          framesRef.current.push({ timeSec: t, hz: null, clarity: 0 });
        }
        if (meterRef.current) publish(null, 0, 0);
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
        if (singingRef.current) {
          framesRef.current.push({ timeSec: t, hz: forScore ? hz : null, clarity });
        }
        if (meterRef.current) {
          publish(useCrepe || (Number.isFinite(yinHz) && yinHz > 0) ? hz : null, clarity, rms);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      src.disconnect();
      if (!tap) void ctx.close();
    };
  }, [micStream, audioRef]);

  useEffect(() => {
    if (isScoringClip(room, myPlayerId) && !singingRef.current) {
      framesRef.current = [];
      postedRef.current = false;
      singingRef.current = true;
    }
  }, [room, myPlayerId]);

  useEffect(() => {
    if (!room || !melody || !myPlayerId) return;
    if (isScoringClip(room, myPlayerId)) return;
    flushRef.current();
  }, [room, melody, myPlayerId]);

  const remote =
    !mine && livePitch && livePitch.playerId !== myPlayerId ? livePitch : null;
  const shownHz = mine ? liveHz : (remote?.hz ?? null);
  const shownClarity = mine ? liveClarity : (remote?.clarity ?? 0);
  const shownRms = mine ? liveRms : (remote?.rms ?? 0);
  const grade = gradeLive(melody, playhead, shownHz);

  return (
    <div className="pitch-stage">
      <PitchMeter
        melody={melody}
        playheadSec={playhead}
        liveHz={shownHz}
        liveClarity={shownClarity}
        liveRms={shownRms}
      />
      {mine ? <HitCallout grade={grade} /> : null}
    </div>
  );
}

export function StageResults() {
  const navigate = useNavigate();
  const { room, myPlayerId } = useStage();
  const { matchOver, scores, ready } = useRoom();
  if (!matchOver || !room || !myPlayerId) return null;

  const you = scores[myPlayerId] ?? matchOver.scores[myPlayerId];
  const opponent = room.players.find((p) => p.id !== myPlayerId);
  const oppCard = opponent
    ? (scores[opponent.id] ?? matchOver.scores[opponent.id] ?? null)
    : null;
  if (!you) return null;

  const shared =
    room.mode === "duet" && oppCard
      ? Math.round((you.overall + oppCard.overall) / 2)
      : null;
  const myDelta =
    room.mode === "ranked"
      ? matchOver.winnerId === myPlayerId
        ? Math.abs(matchOver.eloDelta)
        : matchOver.winnerId
          ? -Math.abs(matchOver.eloDelta)
          : 0
      : null;

  return (
    <ResultsModal
      you={you}
      youName="You"
      opponent={oppCard}
      opponentName={opponent?.displayName ?? "Them"}
      revealOpponent
      winnerId={matchOver.winnerId}
      youId={myPlayerId}
      opponentId={opponent?.id}
      eloDelta={myDelta}
      shared={shared}
      onHome={() => navigate("/")}
      onRematch={() => ready()}
    />
  );
}
