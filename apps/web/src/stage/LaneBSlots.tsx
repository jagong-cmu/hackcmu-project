import { PitchDetector } from "pitchy";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { MelodyFile } from "@karaoke/shared";
import { LyricsOverlay } from "../lyrics/LyricsOverlay.tsx";
import { ResultsModal } from "../results/ResultsModal.tsx";
import { PitchMeter } from "../scoring/PitchMeter.tsx";
import { loadSongPack } from "../scoring/catalog.ts";
import { scoreContour, type PitchFrame } from "../scoring/scoreClip.ts";
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
  const lrcRef = useRef("");
  const framesRef = useRef<PitchFrame[]>([]);
  const singingRef = useRef(false);
  const postedRef = useRef(false);

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
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(micStream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    src.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const detector = PitchDetector.forFloat32Array(analyser.fftSize);
    let raf = 0;
    const tick = () => {
      const t = audioRef.current?.currentTime ?? 0;
      setPlayhead(t);
      analyser.getFloatTimeDomainData(buf);
      const [hz, clarity] = detector.findPitch(buf, ctx.sampleRate);
      const voiced = clarity >= 0.6 && hz >= 70 && hz <= 1200;
      if (singingRef.current) {
        framesRef.current.push({ timeSec: t, hz: voiced ? hz : null, clarity });
      }
      setLiveHz(voiced ? hz : null);
      setLiveClarity(clarity);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      void ctx.close();
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
    <PitchMeter melody={melody} playheadSec={playhead} liveHz={liveHz} liveClarity={liveClarity} />
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
