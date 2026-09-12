/**
 * LANE A — the stage.
 *
 * Owns: LiveKit tiles, turn badge, clip timer, the shared-clock <audio>.
 * Slots in Lane B's LyricsOverlay, PitchMeter and ResultsModal via the runtime
 * registry in slots.tsx (TECHNICAL_PRD §5.3).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { chaosLoungeName, DemoRoomCode, songById } from "@karaoke/shared";
import { useRoom } from "../rooms/RoomProvider.tsx";
import { useLiveKit } from "../media/useLiveKit.ts";
import VideoGrid from "../media/VideoGrid.tsx";
import { StageContext, type StageContextValue } from "./StageContext.tsx";
import { Slot, useStageSlots } from "./slots.tsx";
import { useSharedClock } from "./useSharedClock.ts";
import TurnBadge from "./TurnBadge.tsx";
import ClipTimer from "./ClipTimer.tsx";

export default function Stage() {
  const { code = DemoRoomCode } = useParams();
  const { connected, me, room, clockPlay, matchOver, error, roomJoin, chaosJoin, roomLeave, ready } =
    useRoom();
  const slots = useStageSlots();
  const { audioRef, blocked, unlock, playing } = useSharedClock(clockPlay);
  const [copied, setCopied] = useState(false);

  // LiveKit identity must be stable per player per room, and must match what
  // the server minted the token for.
  const identity = me?.clientId ?? null;
  const livekit = useLiveKit(code, identity, me?.displayName ?? "Singer");
  const joinAttempt = useRef<string | null>(null);

  useEffect(() => {
    joinAttempt.current = null;
  }, [code]);

  // Landing straight on /room/0000 (or a refresh) means we are not seated yet.
  // Do not re-join a room we already occupy — that used to leave+delete it.
  useEffect(() => {
    if (!connected || !me) return;
    if (room?.code === code) {
      joinAttempt.current = code;
      return;
    }
    if (joinAttempt.current === code) return;
    joinAttempt.current = code;
    if (chaosLoungeName(code)) chaosJoin(code);
    else roomJoin(code);
  }, [connected, me?.id, room?.code, code, roomJoin, chaosJoin]);

  const isChaos = room?.mode === "chaos";
  const inLobby = room?.status === "lobby";
  const showResults = room?.status === "results";
  const loungeName = chaosLoungeName(code);
  const song = room?.songId ? songById(room.songId) : undefined;
  const privateCode = !isChaos && /^\d{4}$/.test(code);

  const stageValue = useMemo<StageContextValue>(
    () => ({
      audioRef,
      micStream: livekit.micStream,
      room,
      myPlayerId: me?.id ?? null,
    }),
    [audioRef, livekit.micStream, room, me?.id],
  );

  const activeIdentity = useMemo(() => {
    if (!room?.activeSingerId) return null;
    return room.players.find((p) => p.id === room.activeSingerId)?.clientId ?? null;
  }, [room]);

  const onReady = () => {
    // Same click both satisfies Chrome's autoplay policy and arms the match.
    unlock();
    ready();
  };

  const copyCode = () => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    });
  };

  return (
    <StageContext.Provider value={stageValue}>
      <div className="stage">
        <header>
          <div className="row">
            <Link to="/" onClick={() => roomLeave()}>
              ← leave
            </Link>
            <strong>{loungeName ?? `Room ${code}`}</strong>
            <span className="slot-empty">{room?.mode ?? "…"}</span>
            {song ? (
              <span className="slot-empty">
                {song.title} — {song.artist}
              </span>
            ) : null}
            <TurnBadge room={room} myPlayerId={me?.id ?? null} />
          </div>
          <ClipTimer clockPlay={clockPlay} status={room?.status ?? "lobby"} />
        </header>

        {privateCode && inLobby ? (
          <div className="room-code-bar">
            <span className="room-code-digits">{code}</span>
            <button type="button" onClick={copyCode}>
              {copied ? "Copied" : "Copy code"}
            </button>
            <span className="slot-empty">Send this to your friend, then both tap Ready.</span>
          </div>
        ) : null}

        {!connected && <p className="warn">reconnecting…</p>}
        {error && (
          <p className="err">
            {error.code}: {error.message}
          </p>
        )}
        {livekit.unconfigured && (
          <p className="warn">
            LiveKit keys missing — cameras are off, everything else still works.
            Add LIVEKIT_* to .env.
          </p>
        )}
        {livekit.status === "error" && !livekit.unconfigured && (
          <p className="err">camera/mic: {livekit.error}</p>
        )}
        {(blocked || (isChaos && clockPlay && !playing)) && (
          <p className="warn">
            <button type="button" className="primary" onClick={unlock}>
              Tap to hear the track
            </button>{" "}
            Chrome blocked autoplay.
          </p>
        )}

        <VideoGrid
          participants={livekit.participants}
          activeIdentity={activeIdentity}
          localIdentity={identity}
          compact={isChaos}
        />

        <Slot component={slots.LyricsOverlay} label="LyricsOverlay" />
        {!isChaos && <Slot component={slots.PitchMeter} label="PitchMeter" />}
        {showResults && <Slot component={slots.ResultsModal} label="ResultsModal" />}

        {!isChaos && (
          <div className="row">
            <button
              className="primary"
              onClick={onReady}
              disabled={!room || (!inLobby && !showResults)}
            >
              {showResults ? "Rematch" : "Ready"}
            </button>
            <span className="slot-empty">
              {room
                ? `${room.players.length}/2 seated · ${room.players.map((p) => p.displayName).join(" vs ")}`
                : "joining…"}
            </span>
          </div>
        )}

        {isChaos && (
          <p className="slot-empty">
            {loungeName ?? "Chaos lounge"} · {room?.players.length ?? 0}/8 · cameras on, lyrics
            on, no scoring
          </p>
        )}

        {matchOver && !slots.ResultsModal && (
          <pre className="slot-empty">
            match:over → winner {matchOver.winnerId ?? "draw"} ·{" "}
            {JSON.stringify(matchOver.scores)}
          </pre>
        )}

        {/* The instrumental. Local playback only — never published to LiveKit. */}
        <audio ref={audioRef} preload="auto" />
        <span className="slot-empty">{playing ? "♪ playing" : ""}</span>
      </div>
    </StageContext.Provider>
  );
}
