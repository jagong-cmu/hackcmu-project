/**
 * LANE A — LiveKit lifecycle as a hook.
 *
 * Connects on mount, tears down on unmount, and re-renders whenever the
 * participant set or their tracks change.
 */
import { useEffect, useMemo, useState } from "react";
import {
  connectToStage,
  LiveKitUnconfiguredError,
  micStreamOf,
  Room,
  RoomEvent,
  setCameraEnabled,
  setMicEnabled,
} from "./livekit.ts";
import type { Participant } from "livekit-client";

export type LiveKitState = {
  room: Room | null;
  participants: Participant[];
  micStream: MediaStream | null;
  status: "idle" | "connecting" | "connected" | "error";
  error: string | null;
  /** True when the server has no LiveKit keys — Training still works (PRD §3). */
  unconfigured: boolean;
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

  useEffect(() => {
    if (!code || !identity) return;

    let cancelled = false;
    let opened: Room | null = null;
    setStatus("connecting");
    setError(null);

    connectToStage(code, identity, displayName)
      .then(({ room: connected }) => {
        if (cancelled) {
          void connected.disconnect();
          return;
        }
        opened = connected;
        setRoom(connected);
        setStatus("connected");
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
      RoomEvent.ActiveSpeakersChanged,
      RoomEvent.Disconnected,
    ];
    for (const event of events) room.on(event, bump);
    return () => {
      for (const event of events) room.off(event, bump);
    };
  }, [room]);

  const participants = useMemo<Participant[]>(() => {
    if (!room) return [];
    void tick;
    return [room.localParticipant, ...Array.from(room.remoteParticipants.values())];
  }, [room, tick]);

  const micStream = useMemo(() => {
    if (!room) return null;
    void tick;
    return micStreamOf(room);
  }, [room, tick]);

  return {
    room,
    participants,
    micStream,
    status,
    error,
    unconfigured,
    toggleMic: (on) => {
      if (room) void setMicEnabled(room, on);
    },
    toggleCamera: (on) => {
      if (room) void setCameraEnabled(room, on);
    },
    startAudio: async () => {
      if (room) await room.startAudio().catch(() => undefined);
    },
  };
}
