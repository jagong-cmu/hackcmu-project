/**
 * LANE A — camera tiles with names.
 *
 * Ranked/Duet: one large face cam per person. Chaos: equal grid.
 *
 * Attach once per track. Re-attaching on every parent render (speaker ticks,
 * lyric cues, timers) blacks out the video and tears down remote audio.
 */
import { useEffect, useRef } from "react";
import { Track, type Participant, type TrackPublication } from "livekit-client";

function publicationOf(participant: Participant, source: Track.Source): TrackPublication | undefined {
  return participant.getTrackPublication(source);
}

function useAttachedMedia<T extends HTMLMediaElement>(
  participant: Participant,
  source: Track.Source,
) {
  const ref = useRef<T>(null);
  const publication = publicationOf(participant, source);
  const track = publication?.track;
  const trackSid = publication?.trackSid ?? track?.sid ?? null;

  useEffect(() => {
    const element = ref.current;
    if (!element || !track) return;
    track.attach(element);
    const unlock = () => {
      if (!(element instanceof HTMLAudioElement)) return;
      // webAudioMix keeps this element muted on purpose; room.startAudio()
      // resumes the shared AudioContext that actually plays the opponent.
      void element.play().catch(() => undefined);
    };
    unlock();
    window.addEventListener("pointerdown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      track.detach(element);
    };
  }, [track, trackSid]);

  return ref;
}

function Tile({
  participant,
  singing,
  isLocal,
  waiting = false,
  cue = null,
}: {
  participant: Participant;
  singing: boolean;
  isLocal: boolean;
  waiting?: boolean;
  cue?: "you" | "them" | "together" | "wait" | null;
}) {
  const videoRef = useAttachedMedia<HTMLVideoElement>(participant, Track.Source.Camera);
  const cameraPub = publicationOf(participant, Track.Source.Camera);
  const cameraOn = Boolean(cameraPub?.track) && cameraPub?.isMuted === false;

  return (
    <div className={singing ? "tile singing" : waiting ? "tile waiting" : "tile"}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isLocal}
        style={isLocal ? { transform: "scaleX(-1)" } : undefined}
      />
      {!cameraOn && <div className="placeholder">camera off</div>}
      {cue ? <div className={singing || cue === "together" ? "cam-cue on" : "cam-cue"}>{cue}</div> : null}
      <div className="name">
        {participant.name || participant.identity}
        {isLocal ? " (you)" : ""}
      </div>
    </div>
  );
}

function RemoteAudio({ participant }: { participant: Participant }) {
  const ref = useAttachedMedia<HTMLAudioElement>(participant, Track.Source.Microphone);
  return <audio ref={ref} className="remote-mic" autoPlay playsInline />;
}

function EmptyTile({ label }: { label: string }) {
  return (
    <div className="tile">
      <div className="placeholder">{label}</div>
    </div>
  );
}

export function CameraPane({
  participant,
  singing,
  isLocal,
  emptyLabel,
  waiting = false,
  cue = null,
}: {
  participant: Participant | undefined;
  singing: boolean;
  isLocal: boolean;
  emptyLabel: string;
  waiting?: boolean;
  cue?: "you" | "them" | "together" | "wait" | null;
}) {
  return (
    <div className="stage-cam">
      {participant ? (
        <>
          <Tile
            participant={participant}
            singing={singing}
            isLocal={isLocal}
            waiting={waiting}
            cue={cue}
          />
          {!isLocal && <RemoteAudio participant={participant} />}
        </>
      ) : (
        <EmptyTile label={emptyLabel} />
      )}
    </div>
  );
}

export default function VideoGrid({
  participants,
  activeIdentity,
  localIdentity,
  compact = false,
}: {
  participants: Participant[];
  activeIdentity: string | null;
  localIdentity: string | null;
  compact?: boolean;
}) {
  if (participants.length === 0) {
    return (
      <div className={compact ? "grid compact" : "grid"}>
        <EmptyTile label="waiting for cameras…" />
      </div>
    );
  }

  return (
    <div className={compact ? "grid compact" : "grid"}>
      {participants.map((participant) => {
        const isLocal = participant.identity === localIdentity;
        return (
          <div key={participant.sid || participant.identity}>
            <Tile
              participant={participant}
              singing={participant.identity === activeIdentity}
              isLocal={isLocal}
            />
            {!isLocal && <RemoteAudio participant={participant} />}
          </div>
        );
      })}
    </div>
  );
}
