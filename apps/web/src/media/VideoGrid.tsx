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
}: {
  participant: Participant;
  singing: boolean;
  isLocal: boolean;
}) {
  const videoRef = useAttachedTrack(participant, Track.Source.Camera);
  const cameraOn = participant.getTrackPublication(Track.Source.Camera)?.isMuted === false;

  return (
    <div className={singing ? "tile singing" : "tile"}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isLocal}
        style={isLocal ? { transform: "scaleX(-1)" } : undefined}
      />
      {!cameraOn && <div className="placeholder">camera off</div>}
      <div className="name">
        {participant.name || participant.identity}
        {isLocal ? " (you)" : ""}
        {singing ? " · singing" : ""}
      </div>
    </div>
  );
}

function RemoteAudio({ participant }: { participant: Participant }) {
  const ref = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const track = participant.getTrackPublication(Track.Source.Microphone)?.track;
    if (!track) return;
    track.attach(element);
    return () => {
      track.detach(element);
    };
  });

  return <audio ref={ref} autoPlay />;
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
}: {
  participant: Participant | undefined;
  singing: boolean;
  isLocal: boolean;
  emptyLabel: string;
}) {
  return (
    <div className="stage-cam">
      {participant ? (
        <>
          <Tile participant={participant} singing={singing} isLocal={isLocal} />
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
