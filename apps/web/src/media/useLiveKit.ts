/**
 * LANE A — LiveKit lifecycle as a hook.
 *
 * Connects on mount, tears down on unmount, and re-renders whenever the
 * participant set or their tracks change.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  connectToStage,
  type CaptureState,
  DisconnectReason,
  LiveKitUnconfiguredError,
  micStreamOf,
  Room,
  RoomEvent,
  setCameraEnabled,
  setMicEnabled,
  Track,
  whyFailed,
} from "./livekit.ts";
import { unlockSharedAudio, sharedAudioContext } from "./audioContext.ts";
import { rejoinDelayMs, rejoinOnPageShow, retryFailedConnectMs } from "./rejoin.ts";
import type { Participant } from "livekit-client";

export type LiveKitState = {
  room: Room | null;
  participants: Participant[];
  micStream: MediaStream | null;
  status: "idle" | "connecting" | "connected" | "error";
  error: string | null;
  /** True when the server has no LiveKit keys — Training still works (PRD §3). */
  unconfigured: boolean;
  /**
   * Which halves of the capture opened. A dead camera no longer implies a dead
   * mic, so the stage has to be able to tell the two apart.
   */
  capture: CaptureState;
  /** Chrome is still blocking remote mic playback. */
  audioBlocked: boolean;
  toggleMic: (on: boolean) => void;
  toggleCamera: (on: boolean) => void;
  startAudio: () => Promise<void>;
};

export function useLiveKit(
  code: string | null,
  identity: string | null,
  displayName: string,
): LiveKitState {
  const [room, setRoom] = useState<Room | null>(null);
  const [status, setStatus] = useState<LiveKitState["status"]>("idle");
  const [error, setError] = useState<string | null>(null);
  const [unconfigured, setUnconfigured] = useState(false);
  const [tick, setTick] = useState(0);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [capture, setCapture] = useState<CaptureState>({
    mic: false,
    camera: false,
    error: null,
  });

  // Bumped to reconnect from scratch (fresh token) after an unexpected drop.
  const [rejoin, setRejoin] = useState(0);
  const rejoinsRef = useRef(0);
  /** The next connect is a rejoin: a failure there retries on the same budget. */
  const rejoiningRef = useRef(false);
  /** The same identity joined elsewhere: never rejoin from this tab. */
  const intentionalRef = useRef(false);
  useEffect(() => {
    rejoinsRef.current = 0;
    rejoiningRef.current = false;
    intentionalRef.current = false;
  }, [code, identity]);

  useEffect(() => {
    if (!code || !identity) return;

    let cancelled = false;
    let opened: Room | null = null;
    let retry: number | undefined;
    setStatus("connecting");
    setError(null);
    setCapture({ mic: false, camera: false, error: null });

    connectToStage(code, identity, displayName)
      .then(({ room: connected, capture: opening }) => {
        if (cancelled) {
          void connected.disconnect();
          return;
        }
        opened = connected;
        rejoiningRef.current = false;
        setRoom(connected);
        // A half-open capture is still a usable stage. Only a failed connect
        // is an error; a missing camera is a notice.
        setStatus("connected");
        setCapture(opening);
        setAudioBlocked(!connected.canPlaybackAudio);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setStatus("error");
        const permanent = err instanceof LiveKitUnconfiguredError;
        if (permanent) {
          setUnconfigured(true);
          setError(err.message);
        } else {
          setError(err instanceof Error ? err.message : String(err));
        }
        // A failed rejoin (403 NOT_SEATED before the Stage re-seats us, a
        // network blip) fires no Disconnected event, so retry from here.
        if (!rejoiningRef.current) return;
        rejoinsRef.current += 1;
        const delay = retryFailedConnectMs(rejoinsRef.current, {
          intentional: intentionalRef.current,
          rejoining: true,
          permanent,
        });
        if (delay === null) return;
        retry = window.setTimeout(() => setRejoin((n) => n + 1), delay);
      });

    return () => {
      cancelled = true;
      if (retry !== undefined) window.clearTimeout(retry);
      void opened?.disconnect();
      setRoom(null);
      setStatus("idle");
      setCapture({ mic: false, camera: false, error: null });
    };
  }, [code, identity, displayName, rejoin]);

  // The SDK resumes and reconnects on its own with server-refreshed tokens.
  // If it gives up (or the server dropped us while we still hold the seat),
  // fetch a fresh token and join again. The server refuses a token if we
  // are no longer seated or were removed, which ends the retries.
  useEffect(() => {
    if (!room) return;
    let timer: number | undefined;
    const onDisconnected = (reason?: DisconnectReason) => {
      if (reason === DisconnectReason.DUPLICATE_IDENTITY) intentionalRef.current = true;
      const intentional =
        reason === DisconnectReason.CLIENT_INITIATED || reason === DisconnectReason.DUPLICATE_IDENTITY;
      if (intentional) return;
      rejoiningRef.current = true;
      rejoinsRef.current += 1;
      const delay = rejoinDelayMs(rejoinsRef.current, { intentional });
      if (delay === null) return;
      timer = window.setTimeout(() => setRejoin((n) => n + 1), delay);
    };
    room.on(RoomEvent.Disconnected, onDisconnected);
    return () => {
      room.off(RoomEvent.Disconnected, onDisconnected);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [room]);

  // Back from the bfcache: pagehide sent room:leave and the server dropped
  // our media (the SDK also disconnected itself on pagehide). The Stage's
  // join retry re-seats us (RoomProvider clears the stale room on pageshow);
  // reconnect media with a fresh budget, retrying while the seat comes back.
  // Unmount (an intentional leave) removes this listener.
  useEffect(() => {
    if (!code || !identity) return;
    const onShow = (event: PageTransitionEvent) => {
      if (!rejoinOnPageShow({ persisted: event.persisted, intentional: intentionalRef.current })) return;
      rejoinsRef.current = 0;
      rejoiningRef.current = true;
      setRejoin((n) => n + 1);
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, [code, identity]);

  // LiveKit mutates its participant objects in place, so mirror its events into
  // a counter and recompute the list from the room each time.
  useEffect(() => {
    if (!room) return;
    const bump = () => setTick((n) => n + 1);
    const events: RoomEvent[] = [
      RoomEvent.ParticipantConnected,
      RoomEvent.ParticipantDisconnected,
      RoomEvent.TrackSubscribed,
      RoomEvent.TrackUnsubscribed,
      RoomEvent.TrackPublished,
      RoomEvent.TrackUnpublished,
      RoomEvent.TrackMuted,
      RoomEvent.TrackUnmuted,
      RoomEvent.LocalTrackPublished,
      RoomEvent.LocalTrackUnpublished,
      RoomEvent.Disconnected,
    ];
    for (const event of events) room.on(event, bump);
    const onPlayback = (allowed: boolean) => setAudioBlocked(!allowed);
    room.on(RoomEvent.AudioPlaybackStatusChanged, onPlayback);
    return () => {
      for (const event of events) room.off(event, bump);
      room.off(RoomEvent.AudioPlaybackStatusChanged, onPlayback);
    };
  }, [room]);

  const micTrackId =
    room?.localParticipant.getTrackPublication(Track.Source.Microphone)?.track?.mediaStreamTrack?.id ??
    null;

  const participants = useMemo<Participant[]>(() => {
    if (!room) return [];
    void tick;
    return [room.localParticipant, ...Array.from(room.remoteParticipants.values())];
  }, [room, tick]);

  const micStream = useMemo(() => {
    if (!room) return null;
    return micStreamOf(room);
  }, [room, micTrackId]);

  // Turning a source on re-runs getUserMedia, so these double as the retry for
  // a half that failed at connect: plug the mic back in, hit the button, sing.
  // They must not throw — a rejected toggle used to surface as an unhandled
  // rejection once a failed camera stopped aborting the whole connect.
  const toggleMic = useCallback((on: boolean) => {
    if (!room) return;
    setMicEnabled(room, on)
      .then(() => setCapture((c) => ({ ...c, mic: on, error: on ? null : c.error })))
      .catch((err: unknown) => {
        setCapture((c) => ({ ...c, mic: false, error: `Mic unavailable — ${whyFailed(err)}` }));
      });
  }, [room]);

  const toggleCamera = useCallback((on: boolean) => {
    if (!room) return;
    setCameraEnabled(room, on)
      .then(() => setCapture((c) => ({ ...c, camera: on, error: on ? null : c.error })))
      .catch(() => {
        setCapture((c) => ({
          ...c,
          camera: false,
          error: c.mic ? "Camera unavailable — you can still sing." : c.error,
        }));
      });
  }, [room]);

  const startAudio = useCallback(async () => {
    await unlockSharedAudio();
    if (!room) return;
    try {
      await room.startAudio();
      setAudioBlocked(!room.canPlaybackAudio);
    } catch {
      setAudioBlocked(true);
    }
  }, [room]);

  useEffect(() => {
    if (status !== "connected") return;
    void startAudio();
  }, [status, startAudio]);

  useEffect(() => {
    if (!room) return;
    const onGesture = () => {
      if (room.canPlaybackAudio && sharedAudioContext().state === "running") return;
      void startAudio();
    };
    window.addEventListener("pointerdown", onGesture);
    window.addEventListener("keydown", onGesture);
    return () => {
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
    };
  }, [room, startAudio]);

  return {
    room,
    participants,
    micStream,
    status,
    error,
    unconfigured,
    capture,
    audioBlocked,
    toggleMic,
    toggleCamera,
    startAudio,
  };
}
