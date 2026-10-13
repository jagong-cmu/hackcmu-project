/**
 * Blocking is a local mute + hide: stop receiving a blocked person's camera
 * and mic entirely, not just hide the element. Unsubscribing means no bytes
 * arrive, so there is nothing to un-hide by accident (e.g. the web-audio mix).
 */
import { useEffect } from "react";
import {
  RoomEvent,
  type RemoteParticipant,
  type RemoteTrackPublication,
  type Room,
} from "livekit-client";

export function useBlockedMedia(room: Room | null, identities: ReadonlySet<string>): void {
  useEffect(() => {
    if (!room || identities.size === 0) return;

    const silence = (pub: RemoteTrackPublication, participant: RemoteParticipant) => {
      if (!identities.has(participant.identity)) return;
      if (pub.isSubscribed || pub.isDesired) pub.setSubscribed(false);
    };
    const sweep = () => {
      for (const participant of room.remoteParticipants.values()) {
        for (const pub of participant.trackPublications.values()) silence(pub, participant);
      }
    };

    sweep();
    const onPublished = (pub: RemoteTrackPublication, participant: RemoteParticipant) =>
      silence(pub, participant);
    const onSubscribed = (_track: unknown, pub: RemoteTrackPublication, participant: RemoteParticipant) =>
      silence(pub, participant);
    room.on(RoomEvent.TrackPublished, onPublished);
    room.on(RoomEvent.TrackSubscribed, onSubscribed);
    room.on(RoomEvent.ParticipantConnected, sweep);
    return () => {
      room.off(RoomEvent.TrackPublished, onPublished);
      room.off(RoomEvent.TrackSubscribed, onSubscribed);
      room.off(RoomEvent.ParticipantConnected, sweep);
    };
  }, [room, identities]);
}
