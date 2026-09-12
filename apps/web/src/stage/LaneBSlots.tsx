import { PitchDetector } from "pitchy";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { MelodyFile } from "@karaoke/shared";
import type { LayersModel } from "@tensorflow/tfjs";
import { LyricsOverlay } from "../lyrics/LyricsOverlay.tsx";
import { ResultsModal } from "../results/ResultsModal.tsx";
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

function isMyTurn(room: RoomState | null, myPlayerId: string | null): boolean {
  if (!room || !myPlayerId || room.mode === "chaos") return false;
  if (room.mode === "duet") return room.status === "live";
  return (
    (room.status === "turnA" || room.status === "turnB") &&
    room.activeSingerId === myPlayerId
  );
}

export function StageLyrics() {
  const { audioRef, room } = useStage();
  const [lrc, setLrc] = useState("");
  const [t, setT] = useState(0);

  useEffect(() => {
    const id = room?.songId;
    if (!id) return;
    let cancelled = false;
    void loadSongPack(id).then((pack) => {
      if (!cancelled) setLrc(pack.lrc);
    });
    return () => {
      cancelled = true;
    };
  }, [room?.songId]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      setT(audioRef.current?.currentTime ?? 0);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [audioRef]);

  if (!lrc) return null;
  return <LyricsOverlay lrc={lrc} currentTime={t} />;
}

export function StagePitch() {
  const { audioRef, micStream, room, myPlayerId } = useStage();
  const { clockPlay } = useRoom();
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
        if (singingRef.current) {
          framesRef.current.push({ timeSec: t, hz: null, clarity: 0 });
        }
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
        if (singingRef.current) {
          framesRef.current.push({ timeSec: t, hz: forScore ? hz : null, clarity });
        }
        setLiveHz(useCrepe || (Number.isFinite(yinHz) && yinHz > 0) ? hz : null);
        setLiveClarity(clarity);
        setLiveRms(rms);
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
    if (isMyTurn(room, myPlayerId) && !singingRef.current) {
      framesRef.current = [];
      postedRef.current = false;
      singingRef.current = true;
    }
  }, [room, myPlayerId]);

  useEffect(() => {
    if (!room || !melody || !clockPlay || !myPlayerId) return;
    if (isMyTurn(room, myPlayerId)) return;
    if (!singingRef.current || postedRef.current) return;
    singingRef.current = false;
    postedRef.current = true;
    const dsp = scoreContour(framesRef.current, melody, {
      startSec: clockPlay.startSec,
      durationSec: clockPlay.durationSec,
    });
    void postTurnScore(room.code, {
      clientId: getClientId(),
      displayName: getDisplayName() || "Singer",
      score: dsp,
      mode: room.mode,
      songId: room.songId ?? undefined,
      lyrics: lrcRef.current.slice(0, 600),
    });
  }, [room, melody, clockPlay, myPlayerId]);

  return (
    <PitchMeter
      melody={melody}
      playheadSec={playhead}
      liveHz={liveHz}
      liveClarity={liveClarity}
      liveRms={liveRms}
    />
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
