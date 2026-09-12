/**
 * LANE A — LiveKit lifecycle as a hook.
 *
 * Connects on mount, tears down on unmount, and re-renders whenever the
 * participant set or their tracks change.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  connectToStage,
  type CaptureState,
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

  useEffect(() => {
    if (!code || !identity) return;

    let cancelled = false;
    let opened: Room | null = null;
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
        if (err instanceof LiveKitUnconfiguredError) {
          setUnconfigured(true);
          setError(err.message);
        } else {
          setError(err instanceof Error ? err.message : String(err));
        }
      });

    return () => {
      cancelled = true;
      void opened?.disconnect();
      setRoom(null);
      setStatus("idle");
      setCapture({ mic: false, camera: false, error: null });
    };
  }, [code, identity, displayName]);

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
