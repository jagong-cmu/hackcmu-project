/**
 * LANE A — camera tiles with names.
 *
 * Ranked/Duet: one large face cam per person. Chaos: equal grid.
 */
import { useEffect, useRef } from "react";
import { Track, type Participant } from "livekit-client";

function useAttachedTrack(
  participant: Participant,
  source: Track.Source,
) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const publication = participant.getTrackPublication(source);
    const track = publication?.track;
    if (!track) return;

    track.attach(element);
    return () => {
      track.detach(element);
    };
  });

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
  const videoRef = useAttachedTrack(participant, Track.Source.Camera);
  const cameraOn = participant.getTrackPublication(Track.Source.Camera)?.isMuted === false;

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

function RemoteAudio({ participant, volume = 1 }: { participant: Participant; volume?: number }) {
  const ref = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.volume = volume;
  }, [volume]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const track = participant.getTrackPublication(Track.Source.Microphone)?.track;
    if (!track) return;
    element.volume = volume;
    element.muted = false;
    track.attach(element);
    void element.play().catch(() => {
      /* Ready/unlock calls room.startAudio() to satisfy autoplay. */
    });
    return () => {
      track.detach(element);
    };
  });

  return <audio ref={ref} autoPlay playsInline />;
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
  heard = true,
  cue = null,
}: {
  participant: Participant | undefined;
  singing: boolean;
  isLocal: boolean;
  emptyLabel: string;
  waiting?: boolean;
  heard?: boolean;
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
          {!isLocal && <RemoteAudio participant={participant} volume={heard ? 1 : 0.06} />}
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
