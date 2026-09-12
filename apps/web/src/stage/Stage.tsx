/**
 * LANE A — the stage.
 *
 * One viewport: two large face cams on top, lyrics and pitch underneath.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { chaosLoungeName, DemoRoomCode, isPublicChaosCode, songById } from "@karaoke/shared";
import { useRoom } from "../rooms/RoomProvider.tsx";
import { useLiveKit } from "../media/useLiveKit.ts";
import VideoGrid, { CameraPane } from "../media/VideoGrid.tsx";
import { StageContext, type DuetVoiceCue, type StageContextValue } from "./StageContext.tsx";
import { Slot, useStageSlots } from "./slots.tsx";
import { useSharedClock } from "./useSharedClock.ts";
import TurnBadge from "./TurnBadge.tsx";
import ClipTimer from "./ClipTimer.tsx";
import TurnOverlay from "./TurnOverlay.tsx";
import { VoiceWave } from "../theme/VoiceWave.tsx";

export default function Stage() {
  const { code = DemoRoomCode } = useParams();
  const { connected, me, room, clockPlay, matchOver, error, roomJoin, chaosJoin, roomLeave } =
    useRoom();
  const slots = useStageSlots();
  const { audioRef, blocked, unlock, playing } = useSharedClock(clockPlay);
  const [copied, setCopied] = useState(false);
  const [duetVoice, setDuetVoice] = useState<DuetVoiceCue | null>(null);
  const reportDuetVoice = useCallback((voice: DuetVoiceCue | null) => {
    setDuetVoice((prev) => (prev === voice ? prev : voice));
  }, []);

  const identity = me?.clientId ?? null;
  const livekit = useLiveKit(code, identity, me?.displayName ?? "Singer");

  useEffect(() => {
    if (!connected || !me) return;
    if (room?.code === code) return;
    const join = () => {
      if (isPublicChaosCode(code)) chaosJoin(code);
      else roomJoin(code);
    };
    join();
    const id = window.setInterval(join, 800);
    return () => window.clearInterval(id);
  }, [connected, me?.id, room?.code, code, roomJoin, chaosJoin]);

  useEffect(() => {
    if (livekit.status !== "connected") return;
    if (!livekit.capture.mic) return;
    livekit.toggleMic(true);
  }, [livekit.status, livekit.capture.mic, livekit.toggleMic]);

  useEffect(() => {
    const tap = () => {
      unlock();
      void livekit.startAudio();
    };
    window.addEventListener("pointerdown", tap);
    return () => window.removeEventListener("pointerdown", tap);
  }, [code, unlock, livekit.startAudio]);

  const isChaos = room?.mode === "chaos";
  const inLobby = !room || room.status === "lobby";
  const showResults = room?.status === "results";
  const singing =
    room?.status === "turnA" ||
    room?.status === "turnB" ||
    room?.status === "live";
  const loungeName = chaosLoungeName(code);
  const song = room?.songId ? songById(room.songId) : undefined;
  const privateCode = /^\d{4}$/.test(code) && code !== DemoRoomCode;

  const them = livekit.participants.find((p) => p.identity !== identity);
  const you = livekit.participants.find((p) => p.identity === identity);

  const stageValue = useMemo<StageContextValue>(
    () => ({
      audioRef,
      micStream: livekit.micStream,
      room,
      myPlayerId: me?.id ?? null,
      duetVoice,
      reportDuetVoice,
    }),
    [audioRef, livekit.micStream, room, me?.id, duetVoice, reportDuetVoice],
  );

  const activeIdentity = useMemo(() => {
    if (!room?.activeSingerId) return null;
    return room.players.find((p) => p.id === room.activeSingerId)?.clientId ?? null;
  }, [room]);

  const mySeat =
    me?.id && room?.players[0]?.id === me.id ? "a" : me?.id && room?.players[1]?.id === me.id ? "b" : null;
  const duetLive = room?.mode === "duet" && (room.status === "live" || room.status === "countdown");
  const duetActive = room?.mode === "duet" && room.status === "live";
  const themSeat = mySeat === "a" ? "b" : mySeat === "b" ? "a" : null;
  const youSinging = duetLive
    ? Boolean(duetVoice && duetVoice !== "rest" && (duetVoice === "both" || duetVoice === mySeat))
    : Boolean(you && you.identity === activeIdentity);
  const themSinging = duetLive
    ? Boolean(duetVoice && duetVoice !== "rest" && (duetVoice === "both" || duetVoice === themSeat))
    : Boolean(them && them.identity === activeIdentity);
  const youCue: "you" | "them" | "together" | "wait" | null = duetLive
    ? duetVoice === "both"
      ? "together"
      : youSinging
        ? "you"
        : "wait"
    : null;
  const themCue: "you" | "them" | "together" | "wait" | null = duetLive
    ? duetVoice === "both"
      ? "together"
      : themSinging
        ? "them"
        : "wait"
    : null;

  const copyCode = () => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    });
  };

  const seated = room?.players.map((p) => p.displayName).join(" vs ") ?? "joining…";
  const waitingHint = !room
    ? "Joining the room…"
    : room.players.length < 2
      ? "Waiting for someone to sit down — match starts in 10 seconds once they do."
      : room.status === "countdown"
        ? "Match starts on GO."
        : seated;

  return (
    <StageContext.Provider value={stageValue}>
      <div className="stage stage-fit">
        <VoiceWave stream={livekit.micStream} />
        <header className="stage-top">
          <Link to="/" onClick={() => roomLeave()}>
            ← leave
          </Link>
          <strong>{loungeName ?? `Room ${code}`}</strong>
          {song ? (
            <span className="stage-song">
              {song.title}
              <em> {song.artist}</em>
            </span>
          ) : (
            <span className="stage-song dim">{room?.mode ?? "…"}</span>
          )}
          <TurnBadge room={room} myPlayerId={me?.id ?? null} duetVoice={duetVoice} />
        </header>

        {privateCode && (inLobby || isChaos) ? (
          <div className="room-code-bar">
            <span className="room-code-digits">{code}</span>
            <button type="button" onClick={copyCode}>
              {copied ? "Copied" : "Copy code"}
            </button>
            <span>
              {isChaos
                ? "Send this to a friend — they can walk in anytime."
                : "Match starts in 10 seconds when you both sit down."}
            </span>
          </div>
        ) : null}

        <div className="stage-alerts">
          {!connected && <p className="warn">reconnecting…</p>}
          {error && (
            <p className="err">{error.message}</p>
          )}
          {livekit.unconfigured && (
            <p className="warn">Cameras are off. Lyrics still work.</p>
          )}
          {livekit.status === "error" && !livekit.unconfigured && (
            <p className="err">{livekit.error}</p>
          )}
          {livekit.status === "connected" && livekit.capture.error && (
            <p className={livekit.capture.mic ? "warn" : "err"}>
              {livekit.capture.error}{" "}
              <button
                type="button"
                className="link"
                onClick={() => {
                  if (!livekit.capture.mic) livekit.toggleMic(true);
                  if (!livekit.capture.camera) livekit.toggleCamera(true);
                }}
              >
                try again
              </button>
            </p>
          )}
          {(blocked || livekit.audioBlocked || (isChaos && clockPlay && !playing)) && (
            <p className="warn">
              <button type="button" className="primary" onClick={() => {
                unlock();
                void livekit.startAudio();
              }}>
                {livekit.audioBlocked ? "Tap to hear your opponent" : "Tap to hear the track"}
              </button>
            </p>
          )}
        </div>

        {isChaos ? (
          <div className="stage-chaos">
            <VideoGrid
              participants={livekit.participants}
              activeIdentity={activeIdentity}
              localIdentity={identity}
              compact
            />
            <div className="stage-board">
              <ClipTimer clockPlay={clockPlay} status={room?.status ?? "lobby"} />
              <Slot component={slots.LyricsOverlay} label="LyricsOverlay" />
            </div>
          </div>
        ) : (
          <div className="stage-arena">
            <CameraPane
              participant={them}
              singing={themSinging}
              waiting={Boolean(duetActive && !themSinging)}
              cue={themCue}
              isLocal={false}
              emptyLabel="waiting…"
            />
            <div className="stage-board">
              {singing ? (
                <ClipTimer clockPlay={clockPlay} status={room?.status ?? "lobby"} />
              ) : (
                <div className="timer timer-compact ghost">
                  {inLobby
                    ? room && room.players.length >= 2
                      ? "Starting in 10 seconds"
                      : "Waiting for someone to sit down"
                    : "\u00a0"}
                </div>
              )}
              <Slot component={slots.LyricsOverlay} label="LyricsOverlay" />
              {room && room.status !== "lobby" ? (
                <div className={showResults ? "pitch-hold" : undefined}>
                  <Slot component={slots.PitchMeter} label="PitchMeter" />
                </div>
              ) : null}
            </div>
            <CameraPane
              participant={you}
              singing={youSinging}
              waiting={Boolean(duetActive && !youSinging)}
              cue={youCue}
              isLocal
              emptyLabel="you"
            />
          </div>
        )}

        {!isChaos && !showResults && (
          <div className="stage-dock">
            <div className="ready-meta">
              <p>{waitingHint}</p>
              {room && inLobby ? (
                <div className="ready-chips">
                  {room.players.map((p) => (
                    <span key={p.id} className="ready-chip on">
                      <i />
                      {p.displayName}
                      {room.players.length >= 2 ? " seated" : " here"}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        )}

        {showResults && (
          <div className="stage-results-layer">
            <Slot component={slots.ResultsModal} label="ResultsModal" />
          </div>
        )}

        {isChaos && (
          <p className="stage-dock dim">
            {loungeName ?? "Chaos"} · {room?.players.length ?? 0} live · no scoring
          </p>
        )}

        {matchOver && !slots.ResultsModal && (
          <pre className="slot-empty">
            match:over → winner {matchOver.winnerId ?? "draw"}
          </pre>
        )}

        <TurnOverlay room={room} myPlayerId={me?.id ?? null} clockPlay={clockPlay} />
        <audio ref={audioRef} className="instrumental" preload="auto" />
      </div>
    </StageContext.Provider>
  );
}
