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

type RoomContextValue = {
  connected: boolean;
  me: PlayerPublic | null;
  room: RoomState | null;
  clockPlay: ClockPlay | null;
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
  const [scores, setScores] = useState<Record<string, ScoreCard>>({});
  const [matchOver, setMatchOver] = useState<MatchOver | null>(null);
  const [error, setError] = useState<SocketError | null>(null);
  const [queuedMode, setQueuedMode] = useState<Mode | null>(null);

  // Re-sent on every reconnect so a dropped socket re-establishes identity.
  const nameRef = useRef(getDisplayName());

  useEffect(() => {
    void syncClock();

    const sayHello = () => {
      socket.emit(ClientEvents.playerHello, {
        clientId: getClientId(),
        displayName: nameRef.current || "Singer",
      });
    };

    const onConnect = () => {
      setConnected(true);
      sayHello();
    };
    const onDisconnect = () => {
      setConnected(false);
      setQueuedMode(null);
    };
    const onPlayerOk = (p: { player: PlayerPublic }) => setMe(p.player);
    const onRoomState = (state: RoomState) => {
      setRoom(state);
      setError(null);
      // A fresh lobby means the previous result is stale.
      if (state.status === "lobby") {
        setMatchOver(null);
        setScores({});
      }
    };
    const onMatchFound = ({ code }: { code: string }) => {
      setError(null);
      setQueuedMode(null);
      navigate(`/room/${code}`);
    };
    const onQueueWaiting = ({ mode }: { mode: Mode }) => {
      setQueuedMode(mode);
      setError(null);
    };
    const onClockPlay = (payload: ClockPlay) => setClockPlay(payload);
    const onScoreReady = ({ playerId, score }: { playerId: string; score: ScoreCard }) =>
      setScores((prev) => ({ ...prev, [playerId]: score }));
    const onMatchOver = (payload: MatchOver) => {
      setMatchOver(payload);
      setScores(payload.scores);
    };
    const onError = (payload: SocketError) => setError(payload);

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on(ServerEvents.playerOk, onPlayerOk);
    socket.on(ServerEvents.roomState, onRoomState);
    socket.on(ServerEvents.matchFound, onMatchFound);
    socket.on(ServerEvents.queueWaiting, onQueueWaiting);
    socket.on(ServerEvents.clockPlay, onClockPlay);
    socket.on(ServerEvents.scoreReady, onScoreReady);
    socket.on(ServerEvents.matchOver, onMatchOver);
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
    setError(null);
    setQueuedMode(mode);
    socket.emit(ClientEvents.queueJoin, { mode });
  }, []);

  const queueLeave = useCallback(() => {
    setQueuedMode(null);
    socket.emit(ClientEvents.queueLeave);
  }, []);

  const roomCreate = useCallback((mode: Mode) => {
    setError(null);
    setQueuedMode(null);
    socket.emit(ClientEvents.roomCreate, { mode });
  }, []);

  const roomJoin = useCallback((code: string) => {
    setError(null);
    setQueuedMode(null);
    socket.emit(ClientEvents.roomJoin, { code: code.trim() });
  }, []);

  const roomLeave = useCallback(() => {
    setQueuedMode(null);
    setRoom(null);
    setClockPlay(null);
    setMatchOver(null);
    setScores({});
    socket.emit(ClientEvents.roomLeave);
  }, []);

  const chaosJoin = useCallback((code?: string) => {
    setError(null);
    setQueuedMode(null);
    socket.emit(ClientEvents.chaosJoin, code ? { code: code.trim() } : {});
  }, []);

  const ready = useCallback(() => {
    setMatchOver(null);
    socket.emit(ClientEvents.roomReady);
  }, []);

  const value = useMemo<RoomContextValue>(
    () => ({
      connected,
      me,
      room,
      clockPlay,
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
    }),
    [
      connected, me, room, clockPlay, scores, matchOver, error, queuedMode,
      hello, queueJoin, queueLeave, roomCreate, roomJoin, roomLeave, chaosJoin, ready,
    ],
  );

  return <RoomContext.Provider value={value}>{children}</RoomContext.Provider>;
}
