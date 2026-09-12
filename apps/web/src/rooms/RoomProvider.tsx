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
  type RoomStatus,
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
  pitch?: number;
  tone?: number;
  overall?: number;
};

export type PitchLiveSample = {
  hz: number | null;
  clarity: number;
  rms: number;
  pitch?: number;
  tone?: number;
  overall?: number;
};

type RoomContextValue = {
  connected: boolean;
  me: PlayerPublic | null;
  room: RoomState | null;
  clockPlay: ClockPlay | null;
  livePitch: LivePitch | null;
  livePitches: Record<string, LivePitch>;
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
  emitPitchLive: (sample: PitchLiveSample) => void;
};

const RoomContext = createContext<RoomContextValue | null>(null);

export function useRoom(): RoomContextValue {
  const value = useContext(RoomContext);
  if (!value) throw new Error("useRoom must be used inside <RoomProvider>");
  return value;
}

const STATUS_ORDER: RoomStatus[] = [
  "lobby",
  "countdown",
  "turnA",
  "swap",
  "turnB",
  "live",
  "results",
];

function mergeRoom(prev: RoomState | null, incoming: RoomState): RoomState {
  if (!prev || prev.code !== incoming.code) return incoming;
  if (prev.status === "results" && incoming.status === "lobby") return incoming;
  if (incoming.status === "results") return incoming;
  const ahead = STATUS_ORDER.indexOf(incoming.status) >= STATUS_ORDER.indexOf(prev.status);
  return {
    ...incoming,
    status: ahead ? incoming.status : prev.status,
    players: incoming.players.length >= prev.players.length ? incoming.players : prev.players,
    songId: incoming.songId ?? prev.songId,
    playAtUnixMs: incoming.playAtUnixMs ?? prev.playAtUnixMs,
    activeSingerId: incoming.activeSingerId ?? prev.activeSingerId,
  };
}

export function RoomProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [connected, setConnected] = useState(socket.connected);
  const [me, setMe] = useState<PlayerPublic | null>(null);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [clockPlay, setClockPlay] = useState<ClockPlay | null>(null);
  const [livePitch, setLivePitch] = useState<LivePitch | null>(null);
  const [livePitches, setLivePitches] = useState<Record<string, LivePitch>>({});
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
      if (!mode || roomRef.current) return;
      if (!socket.connected) return;
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
        setLivePitches({});
      }
      if (state.status === "results") {
        setClockPlay(null);
        setLivePitch(null);
        setLivePitches({});
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
      setLivePitches({});
    };
    const onPitchLive = (payload: LivePitch) => {
      setLivePitch(payload);
      setLivePitches((prev) => ({ ...prev, [payload.playerId]: payload }));
    };
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

    const queueBeat = window.setInterval(() => {
      if (!wantQueueRef.current || roomRef.current) return;
      flushQueueRef.current();
    }, 1000);

    return () => {
      window.clearInterval(queueBeat);
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

  useEffect(() => {
    const pollCode = () => {
      const fromRoom = roomRef.current?.code;
      const fromPath = window.location.pathname.match(/^\/room\/([^/]+)/)?.[1];
      return fromRoom || fromPath || null;
    };

    const tick = async () => {
      const code = pollCode();
      if (!code) return;
      try {
        const res = await fetch(`/api/rooms/${encodeURIComponent(code)}`);
        if (!res.ok) return;
        const data = (await res.json()) as {
          room?: RoomState;
          clock?: ClockPlay | null;
          scores?: Record<string, ScoreCard>;
          matchOver?: MatchOver | null;
        };
        if (data.clock) setClockPlay(data.clock);
        else if (
          data.room &&
          (data.room.status === "results" || data.room.status === "lobby")
        ) {
          setClockPlay(null);
        }
        if (data.room) {
          setRoom((prev) => mergeRoom(prev, data.room!));
          if (data.room.players.length > 0 && window.location.pathname.startsWith("/play")) {
            wantQueueRef.current = null;
            joinSentRef.current = false;
            setQueuedMode(null);
            navigate(`/room/${data.room.code}`);
          }
        }
        if (data.scores && Object.keys(data.scores).length > 0) {
          setScores((prev) => ({ ...prev, ...data.scores }));
        }
        if (data.matchOver) setMatchOver(data.matchOver);
      } catch {
        /* isolate blip */
      }
    };

    void tick();
    const id = window.setInterval(() => void tick(), 750);
    return () => window.clearInterval(id);
  }, [navigate, room?.code]);

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
    setLivePitches({});
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
    setLivePitches({});
    socket.emit(ClientEvents.roomReady);
  }, []);

  const emitPitchLive = useCallback((sample: PitchLiveSample) => {
    socket.emit(ClientEvents.pitchLive, sample);
  }, []);

  const value = useMemo<RoomContextValue>(
    () => ({
      connected,
      me,
      room,
      clockPlay,
      livePitch,
      livePitches,
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
      connected, me, room, clockPlay, livePitch, livePitches, scores, matchOver, error, queuedMode,
      hello, queueJoin, queueLeave, roomCreate, roomJoin, roomLeave, chaosJoin, ready,
      emitPitchLive,
    ],
  );

  return <RoomContext.Provider value={value}>{children}</RoomContext.Provider>;
}
