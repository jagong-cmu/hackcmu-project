/**
 * The stage: a karaoke machine (pitch lane + lyrics) between two score
 * panels that carry the face cams. Chaos keeps its camera grid.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  chaosLoungeName,
  DemoRoomCode,
  isPublicChaosCode,
  MatchCountdownMs,
  songById,
  votesToRemove,
  type Mode,
  type RoomState,
} from "@karaoke/shared";
import { useRoom } from "../rooms/RoomProvider.tsx";
import { useSafety } from "../rooms/useSafety.ts";
import { useLiveKit } from "../media/useLiveKit.ts";
import { useBlockedMedia } from "../media/useBlockedMedia.ts";
import SafetyMenu, { SafetySheet, type LeaveEffect, type RemoveRule } from "./SafetyMenu.tsx";
import VideoGrid, { CameraPane, Tile } from "../media/VideoGrid.tsx";
import { RankedMatched } from "../home/RankedWaiting.tsx";
import { StageContext, type DuetVoiceCue, type StageContextValue } from "./StageContext.tsx";
import { Slot, useStageSlots } from "./slots.tsx";
import { useSharedClock } from "./useSharedClock.ts";
import { leaveEffectOf, leaveSuffix, msUntilForfeit } from "./leaveEffect.ts";
import { serverNow } from "../rooms/timeSync.ts";
import TurnBadge from "./TurnBadge.tsx";
import ClipTimer, { ClipClock } from "./ClipTimer.tsx";
import TurnOverlay from "./TurnOverlay.tsx";
import { VoiceWave } from "../theme/VoiceWave.tsx";
import { KaraokeMachine, MachineStage, ModeTabs, ScorePanel } from "./KaraokeMachine.tsx";
import { useStageHud } from "./stageHud.ts";
import { KeyHintBar } from "../ui/KeyHints.tsx";
import { Button } from "../ui/Button.tsx";

const ModeNames: Record<Mode, string> = { ranked: "Ranked", duet: "Duet", chaos: "Chaos", training: "Training" };
const PhaseNames: Partial<Record<RoomState["status"], string>> = {
  countdown: "Get ready",
  turnA: "Turn A",
  turnB: "Turn B",
  swap: "Swap",
  live: "Live",
  results: "Results",
};

const initialOf = (name: string | undefined) => (name?.trim()[0] ?? "?").toUpperCase();

/** The panels and the machine, fed by the scores StagePitch publishes. */
function MachineRow({
  mode,
  you,
  them,
  machine,
}: {
  mode: Mode;
  you: { name: string; camera: ReactNode };
  them: { name: string; camera: ReactNode };
  machine: (lock: number | null) => ReactNode;
}) {
  const hud = useStageHud();
  const lock = (hud.laneSide === "you" ? hud.you : hud.them)?.pitch ?? null;
  if (mode !== "duet") {
    return (
      <div className="km-row">
        <ScorePanel side="you" {...you} card={hud.you} combo={hud.combo.you} />
        {machine(lock)}
        <ScorePanel side="them" {...them} card={hud.them} combo={hud.combo.them} />
      </div>
    );
  }
  // Duet is one team: the shared score (the results card's average) on the left only.
  const cards = [hud.you, hud.them].filter((c) => c != null);
  const shared = cards.length
    ? { overall: Math.round(cards.reduce((n, c) => n + c.overall, 0) / cards.length), pitch: 0, tone: 0 }
    : null;
  return (
    <div className="km-row">
      <ScorePanel side="you" {...you} card={hud.you && shared ? { ...hud.you, overall: shared.overall } : null} combo={hud.combo.you} scoreLabel="Team" />
      {machine(lock)}
      <ScorePanel side="them" {...them} card={hud.them} combo={hud.combo.them} hideScore />
    </div>
  );
}

/** Pre-match countdown in whole seconds, for lobby copy. */
const countdownSec = Math.round(MatchCountdownMs / 1000);

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

  const navigate = useNavigate();
  const safety = useSafety(room?.code === code ? code : null, code);
  const removed = safety.removed;
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(id);
  }, [toast]);

  // LiveKit identity is our public player id, and the server only mints a
  // token once we hold a seat here. Latch it per room so a stray room:state
  // without our seat does not tear the call down.
  const seatedHere = Boolean(
    me && room?.code === code && room.players.some((p) => p.id === me.id),
  );
  const [mediaSeat, setMediaSeat] = useState<{ code: string; id: string } | null>(null);
  useEffect(() => {
    if (!seatedHere || !me) return;
    setMediaSeat((prev) => (prev?.code === code && prev.id === me.id ? prev : { code, id: me.id }));
  }, [seatedHere, me?.id, code]);
  const identity = mediaSeat && mediaSeat.code === code && mediaSeat.id === me?.id ? mediaSeat.id : null;
  // Removed: drop the camera connection and never ask for another token.
  const livekit = useLiveKit(removed ? null : code, identity, me?.displayName ?? "Singer");

  // Blocked people vanish and go silent here at once (server keeps the block).
  // LiveKit identities are public player ids, so the blocked set maps directly.
  useBlockedMedia(livekit.room, safety.blocked);

  useEffect(() => {
    if (!connected || !me || removed) return;
    if (room?.code === code) return;
    const join = () => {
      if (isPublicChaosCode(code)) chaosJoin(code);
      else roomJoin(code);
    };
    join();
    const id = window.setInterval(join, 800);
    return () => window.clearInterval(id);
  }, [connected, me?.id, room?.code, code, roomJoin, chaosJoin, removed]);

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
  const loungeName = chaosLoungeName(code);
  const song = room?.songId ? songById(room.songId) : undefined;
  const privateCode = /^\d{4}$/.test(code) && code !== DemoRoomCode;
  // Private Ranked rooms are friendly: same match, no ELO for either player.
  const friendly = room?.mode === "ranked" && room.rated === false;
  // What leaving does right now, mirroring the server's forfeitWouldRate:
  // a forfeit only once a rated match is ForfeitSkipMs in; results before
  // settlement still count on the scores; otherwise nothing.
  const [, setLeaveTick] = useState(0);
  const forfeitInMs = msUntilForfeit(room, serverNow());
  const forfeitPending = forfeitInMs != null;
  useEffect(() => {
    if (!forfeitPending) return;
    const left = msUntilForfeit(room, serverNow());
    if (left == null) return;
    const id = window.setTimeout(() => setLeaveTick((n) => n + 1), left + 20);
    return () => window.clearTimeout(id);
  }, [forfeitPending, room?.matchId, room?.status]);
  // Queue matches open on the ranked match-found screen until GO, once per room.
  const [playedIn, setPlayedIn] = useState<string | null>(null);
  useEffect(() => {
    if (room && room.status !== "lobby" && room.status !== "countdown") setPlayedIn(room.code);
  }, [room?.code, room?.status]);
  const matchFound =
    room?.mode === "ranked" &&
    room.isPrivate === false &&
    playedIn !== room.code &&
    !matchOver &&
    room.players.length >= 2 &&
    (room.status === "lobby" || room.status === "countdown");
  const leaveEffect: LeaveEffect = leaveEffectOf(room, Boolean(matchOver), serverNow());

  const visible = livekit.participants.filter((p) => !safety.blocked.has(p.identity));
  const them = visible.find((p) => p.identity !== identity);
  const you = livekit.participants.find((p) => p.identity === identity);
  const opponent = !isChaos ? room?.players.find((p) => p.id !== me?.id) : undefined;
  const opponentBlocked = Boolean(opponent && safety.blocked.has(opponent.id));

  const leaveSafely = useCallback(async () => {
    const ack = await safety.leave();
    if (ack.ok) navigate("/");
    else setToast(ack.message);
  }, [safety.leave, navigate]);

  /** The "…" for one remote person, with what the server will let me do to them. */
  const safetyMenuFor = (player: { id: string; displayName: string } | undefined) => {
    if (!player || !me || player.id === me.id || !room) return null;
    const amHost = Boolean(safety.state?.isPrivate && safety.state.hostId === me.id);
    let rule: RemoveRule = { kind: "none" };
    if (amHost) rule = { kind: "host" };
    else if (isChaos) {
      const others = Math.max(0, room.players.length - 1);
      const tally = safety.state?.votes[player.id];
      const needed = tally?.needed ?? votesToRemove(others);
      rule = {
        kind: "vote",
        count: tally?.count ?? 0,
        needed,
        voted: safety.myVotes.has(player.id),
        possible: needed <= others,
      };
    }
    return (
      <SafetyMenu
        key={player.id}
        target={{ id: player.id, name: player.displayName }}
        rule={rule}
        oneOnOne={!isChaos}
        leaveEffect={leaveEffect}
        safety={safety}
        onLeft={() => navigate("/")}
        onToast={isChaos ? setToast : undefined}
      />
    );
  };

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
    // LiveKit identities are public player ids, so the active singer's id is theirs.
    return room.activeSingerId;
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
      ? `Waiting for someone to sit down — match starts in ${countdownSec} seconds once they do.`
      : room.status === "countdown"
        ? "Match starts on GO."
        : room.players.length >= 2
          ? "Starting…"
          : seated;

  const machineLabel = [room ? ModeNames[room.mode] : "…", room ? PhaseNames[room.status] : null]
    .filter(Boolean)
    .join(" · ");
  const timer = (
    <ClipTimer
      clockPlay={clockPlay}
      playAtUnixMs={room?.playAtUnixMs}
      status={room?.status ?? "lobby"}
      label={song ? `${song.title} · ${song.artist}` : machineLabel}
    />
  );

  // Esc leaves, after a confirm that says what leaving costs right now.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // A sheet or the results card is up: Esc belongs to it.
      if (document.querySelector('[role="dialog"]')) return;
      if (!window.confirm(`Leave the room? (${leaveSuffix(leaveEffect)})`)) return;
      roomLeave();
      navigate("/");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [leaveEffect, roomLeave, navigate]);

  return (
    <StageContext.Provider value={stageValue}>
      {/* Their ranked turn: the lyric fill and progress are theirs, so blue. */}
      <div className={`stage stage-fit km-page${room?.mode === "ranked" && themSinging ? " is-their-turn" : ""}`}>
        <VoiceWave stream={livekit.micStream} />
        <header className="stage-top">
          <Link to="/" onClick={() => roomLeave()}>
            ← Leave
          </Link>
          <strong>{loungeName ?? `Room ${code}`}</strong>
          {friendly ? (
            <span
              className="stage-friendly"
              title="Private rooms are friendly matches. Nobody's ELO changes."
            >
              Friendly match · doesn't affect ELO
            </span>
          ) : null}
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
                : friendly
                  ? `Friendly match: doesn't affect ELO. Starts in ${countdownSec} seconds when you both sit down.`
                  : `Match starts in ${countdownSec} seconds when you both sit down.`}
            </span>
          </div>
        ) : null}

        <div className="stage-alerts">
          {!connected && <p className="warn">Reconnecting…</p>}
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
              <Button variant="primary" onClick={() => {
                unlock();
                void livekit.startAudio();
              }}>
                {livekit.audioBlocked ? "Tap to hear your opponent" : "Tap to hear the track"}
              </Button>
            </p>
          )}
          {toast && <p className="warn safety-toast" role="status">{toast}</p>}
          {safety.notice && (
            <p className="warn" role="status">
              {safety.notice.message}{" "}
              {safety.notice.kind === "opponent-left" ? (
                <Link className="link" to="/">
                  back to home
                </Link>
              ) : (
                <button type="button" className="link" onClick={safety.dismissNotice}>
                  ok
                </button>
              )}
            </p>
          )}
          {opponentBlocked && !showResults && (
            <p className="warn">
              You blocked {opponent?.displayName ?? "your opponent"}.{" "}
              <button type="button" className="link" onClick={() => void leaveSafely()}>
                {`leave the match · ${leaveSuffix(leaveEffect)}`}
              </button>
            </p>
          )}
        </div>

        {room ? <ModeTabs mode={room.mode} /> : null}

        {isChaos ? (
          <div className="stage-chaos">
            <VideoGrid
              participants={visible}
              activeIdentity={activeIdentity}
              localIdentity={identity}
              compact
              renderMenu={(p) =>
                safetyMenuFor(room?.players.find((player) => player.id === p.identity))
              }
            />
            <KaraokeMachine
              title={song?.title ?? loungeName ?? "Chaos"}
              label={machineLabel}
              time={<ClipClock clockPlay={clockPlay} playAtUnixMs={room?.playAtUnixMs} />}
              lyrics={<Slot component={slots.LyricsOverlay} label="LyricsOverlay" />}
              lock={null}
            />
            {timer}
          </div>
        ) : (
          <MachineStage>
            <MachineRow
              mode={room?.mode ?? "ranked"}
              you={{
                name: me?.displayName ?? "You",
                camera: (
                  <CameraPane
                    participant={you}
                    singing={youSinging}
                    waiting={Boolean(duetActive && !youSinging)}
                    cue={youCue}
                    isLocal
                    emptyLabel={initialOf(me?.displayName)}
                  />
                ),
              }}
              them={{
                name: opponent?.displayName ?? "Opponent",
                camera: (
                  <CameraPane
                    participant={them}
                    singing={themSinging}
                    waiting={Boolean(duetActive && !themSinging)}
                    cue={themCue}
                    isLocal={false}
                    emptyLabel={opponentBlocked ? "blocked" : opponent ? initialOf(opponent.displayName) : "waiting…"}
                    menu={safetyMenuFor(opponent)}
                  />
                ),
              }}
              machine={(lock) => (
                <KaraokeMachine
                  title={song?.title ?? "Karaoke Arena"}
                  label={machineLabel}
                  time={<ClipClock clockPlay={clockPlay} playAtUnixMs={room?.playAtUnixMs} />}
                  lanes={
                    room && room.status !== "lobby" ? (
                      <div className={showResults ? "pitch-hold" : "km-lane-slot"}>
                        <Slot component={slots.PitchMeter} label="PitchMeter" />
                      </div>
                    ) : (
                      <p className="km-idle t-label">{waitingHint}</p>
                    )
                  }
                  lyrics={<Slot component={slots.LyricsOverlay} label="LyricsOverlay" />}
                  lock={lock}
                />
              )}
            />
            {timer}
          </MachineStage>
        )}

        {!isChaos && !showResults && (inLobby || room?.status === "countdown") && (
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
        {matchFound && room && me ? (
          <RankedMatched
            room={room}
            myId={me.id}
            playAtUnixMs={clockPlay?.playAtUnixMs ?? room.playAtUnixMs}
            youCamera={you ? <Tile participant={you} singing={false} isLocal /> : null}
            themCamera={them ? <Tile participant={them} singing={false} isLocal={false} /> : null}
            onHome={() => roomLeave()}
          />
        ) : null}
        <KeyHintBar hints={[{ keys: ["Esc"], label: "Leave" }]} />
        <audio ref={audioRef} className="instrumental" preload="auto" loop={false} />

        {removed ? (
          <SafetySheet label="Removed from room">
            <p className="safety-kicker">Removed</p>
            <h2 className="safety-title">You're out of {loungeName ?? `room ${code}`}</h2>
            <p className="safety-body">{removed.message} You can't rejoin this room.</p>
            <div className="safety-foot">
              <Link className="safety-primary" to="/">
                Back to home
              </Link>
            </div>
          </SafetySheet>
        ) : null}
      </div>
    </StageContext.Provider>
  );
}
