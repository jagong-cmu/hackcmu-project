/**
 * LANE A — the one place that talks to the Socket.IO server.
 *
 * Everything Lane B needs about the live match is read off this context; B
 * never opens a socket or a LiveKit connection of their own.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import {
  ClientEvents,
  ServerEvents,
  type Mode,
  type PlayerPublic,
  type RoomState,
  type ScoreCard,
} from "@karaoke/shared";
import { getClientId, getDisplayName, setDisplayName, socket } from "./socket.ts";
import { syncClock } from "./timeSync.ts";

export type ClockPlay = {
  songId: string | null;
  startSec: number;
  durationSec: number;
  playAtUnixMs: number;
};

export type MatchOver = {
  scores: Record<string, ScoreCard>;
  winnerId: string | null;
  eloDelta: number;
  forfeit?: boolean;
};

export type SocketError = { code: string; message: string };

export type LivePitch = {
  playerId: string;
  hz: number | null;
  clarity: number;
  rms: number;
};

type RoomContextValue = {
  connected: boolean;
  me: PlayerPublic | null;
  room: RoomState | null;
  clockPlay: ClockPlay | null;
  livePitch: LivePitch | null;
  scores: Record<string, ScoreCard>;
  matchOver: MatchOver | null;
  error: SocketError | null;
  queuedMode: Mode | null;
  hello: (displayName: string) => void;
  queueJoin: (mode: Mode) => void;
  queueLeave: () => void;
  roomCreate: (mode: Mode) => void;
  roomJoin: (code: string) => void;
  roomLeave: () => void;
  chaosJoin: (code?: string) => void;
  ready: () => void;
  emitPitchLive: (sample: { hz: number | null; clarity: number; rms: number }) => void;
};

const RoomContext = createContext<RoomContextValue | null>(null);

export function useRoom(): RoomContextValue {
  const value = useContext(RoomContext);
  if (!value) throw new Error("useRoom must be used inside <RoomProvider>");
  return value;
}

export function RoomProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [connected, setConnected] = useState(socket.connected);
  const [me, setMe] = useState<PlayerPublic | null>(null);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [clockPlay, setClockPlay] = useState<ClockPlay | null>(null);
  const [livePitch, setLivePitch] = useState<LivePitch | null>(null);
  const [scores, setScores] = useState<Record<string, ScoreCard>>({});
  const [matchOver, setMatchOver] = useState<MatchOver | null>(null);
  const [error, setError] = useState<SocketError | null>(null);
  const [queuedMode, setQueuedMode] = useState<Mode | null>(null);

  // Re-sent on every reconnect so a dropped socket re-establishes identity.
  const nameRef = useRef(getDisplayName());
  const wantQueueRef = useRef<Mode | null>(null);
  const roomRef = useRef<RoomState | null>(null);
  const joinSentRef = useRef(false);
  roomRef.current = room;

  const flushQueueRef = useRef<() => void>(() => {});

  useEffect(() => {
    void syncClock();

    const sayHello = () => {
      socket.emit(ClientEvents.playerHello, {
        clientId: getClientId(),
        displayName: nameRef.current || "Singer",
      });
    };

    const flushQueue = () => {
      const mode = wantQueueRef.current;
      if (!mode || roomRef.current || joinSentRef.current) return;
      if (!socket.connected) return;
      joinSentRef.current = true;
      socket.emit(ClientEvents.queueJoin, { mode });
    };
    flushQueueRef.current = flushQueue;

    const goToRoom = (code: string) => {
      wantQueueRef.current = null;
      joinSentRef.current = false;
      setQueuedMode(null);
      setError(null);
      if (!window.location.pathname.startsWith(`/room/${code}`)) {
        navigate(`/room/${code}`);
      }
    };

    const onConnect = () => {
      setConnected(true);
      joinSentRef.current = false;
      sayHello();
    };
    const onDisconnect = () => {
      setConnected(false);
      // Keep queuedMode / wantQueue so a blip re-joins instead of dumping
      // the player back on the Join button.
    };
    const onPlayerOk = (p: { player: PlayerPublic }) => {
      setMe(p.player);
      flushQueue();
    };
    const onRoomState = (state: RoomState) => {
      setRoom(state);
      setError(null);
      if (state.status === "lobby") {
        setMatchOver(null);
        setScores({});
        setClockPlay(null);
        setLivePitch(null);
      }
      if (state.status === "results") {
        setClockPlay(null);
        setLivePitch(null);
      }
      // match:found can be missed on a remount; room:state still means seated.
      if (
        state.code &&
        state.players.length > 0 &&
        window.location.pathname.startsWith("/play")
      ) {
        goToRoom(state.code);
      }
    };
    const onMatchFound = ({ code }: { code: string }) => {
      goToRoom(code);
    };
    const onQueueWaiting = ({ mode }: { mode: Mode }) => {
      joinSentRef.current = true;
      setQueuedMode(mode);
      setError(null);
    };
    const onClockPlay = (payload: ClockPlay) => setClockPlay(payload);
    const onScoreReady = ({ playerId, score }: { playerId: string; score: ScoreCard }) => {
      setScores((prev) => ({ ...prev, [playerId]: score }));
      setMatchOver((prev) =>
        prev ? { ...prev, scores: { ...prev.scores, [playerId]: score } } : prev,
      );
    };
    const onMatchOver = (payload: MatchOver) => {
      setMatchOver(payload);
      setScores(payload.scores);
      setClockPlay(null);
      setLivePitch(null);
    };
    const onPitchLive = (payload: LivePitch) => setLivePitch(payload);
    const onError = (payload: SocketError) => {
      setError(payload);
      if (payload.code === "NO_SESSION") {
        joinSentRef.current = false;
        sayHello();
      }
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on(ServerEvents.playerOk, onPlayerOk);
    socket.on(ServerEvents.roomState, onRoomState);
    socket.on(ServerEvents.matchFound, onMatchFound);
    socket.on(ServerEvents.queueWaiting, onQueueWaiting);
    socket.on(ServerEvents.clockPlay, onClockPlay);
    socket.on(ServerEvents.scoreReady, onScoreReady);
    socket.on(ServerEvents.matchOver, onMatchOver);
    socket.on(ServerEvents.pitchLive, onPitchLive);
    socket.on(ServerEvents.error, onError);

    if (socket.connected) sayHello();

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off(ServerEvents.playerOk, onPlayerOk);
      socket.off(ServerEvents.roomState, onRoomState);
      socket.off(ServerEvents.matchFound, onMatchFound);
      socket.off(ServerEvents.queueWaiting, onQueueWaiting);
      socket.off(ServerEvents.clockPlay, onClockPlay);
      socket.off(ServerEvents.scoreReady, onScoreReady);
      socket.off(ServerEvents.matchOver, onMatchOver);
      socket.off(ServerEvents.pitchLive, onPitchLive);
      socket.off(ServerEvents.error, onError);
    };
  }, [navigate]);

  const hello = useCallback((displayName: string) => {
    const name = displayName.trim().slice(0, 24) || "Singer";
    nameRef.current = name;
    setDisplayName(name);
    socket.emit(ClientEvents.playerHello, { clientId: getClientId(), displayName: name });
  }, []);

  const queueJoin = useCallback((mode: Mode) => {
    wantQueueRef.current = mode;
    joinSentRef.current = false;
    setError(null);
    setQueuedMode(mode);
    socket.emit(ClientEvents.playerHello, {
      clientId: getClientId(),
      displayName: nameRef.current || "Singer",
    });
    flushQueueRef.current();
  }, []);

  const queueLeave = useCallback(() => {
    wantQueueRef.current = null;
    joinSentRef.current = false;
    setQueuedMode(null);
    socket.emit(ClientEvents.queueLeave);
  }, []);

  const roomCreate = useCallback((mode: Mode) => {
    wantQueueRef.current = null;
    setError(null);
    setQueuedMode(null);
    socket.emit(ClientEvents.roomCreate, { mode });
  }, []);

  const roomJoin = useCallback((code: string) => {
    wantQueueRef.current = null;
    setError(null);
    setQueuedMode(null);
    socket.emit(ClientEvents.roomJoin, { code: code.trim() });
  }, []);

  const roomLeave = useCallback(() => {
    wantQueueRef.current = null;
    setQueuedMode(null);
    setRoom(null);
    setClockPlay(null);
    setLivePitch(null);
    setMatchOver(null);
    setScores({});
    socket.emit(ClientEvents.roomLeave);
  }, []);

  const chaosJoin = useCallback((code?: string) => {
    wantQueueRef.current = null;
    setError(null);
    setQueuedMode(null);
    socket.emit(ClientEvents.chaosJoin, code ? { code: code.trim() } : {});
  }, []);

  const ready = useCallback(() => {
    setMatchOver(null);
    setLivePitch(null);
    socket.emit(ClientEvents.roomReady);
  }, []);

  const emitPitchLive = useCallback((sample: { hz: number | null; clarity: number; rms: number }) => {
    socket.emit(ClientEvents.pitchLive, sample);
  }, []);

  const value = useMemo<RoomContextValue>(
    () => ({
      connected,
      me,
      room,
      clockPlay,
      livePitch,
      scores,
      matchOver,
      error,
      queuedMode,
      hello,
      queueJoin,
      queueLeave,
      roomCreate,
      roomJoin,
      roomLeave,
      chaosJoin,
      ready,
      emitPitchLive,
    }),
    [
      connected, me, room, clockPlay, livePitch, scores, matchOver, error, queuedMode,
      hello, queueJoin, queueLeave, roomCreate, roomJoin, roomLeave, chaosJoin, ready,
      emitPitchLive,
    ],
  );

  return <RoomContext.Provider value={value}>{children}</RoomContext.Provider>;
}
