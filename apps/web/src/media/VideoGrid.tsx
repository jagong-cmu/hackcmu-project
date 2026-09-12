/**
 * LANE A — camera tiles with names.
 *
 * The active singer's tile is highlighted so the room reads at a glance
 * (PRD §6.1 "on stage").
 */
import { useEffect, useRef } from "react";
import { Track, type Participant } from "livekit-client";

function useAttachedTrack(
  participant: Participant,
  source: Track.Source,
): React.RefObject<HTMLVideoElement> {
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
      {/* Local video is mirrored and silent; hearing your own mic is a nightmare. */}
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
        {singing ? " 🎤" : ""}
      </div>
    </div>
  );
}

/**
 * Remote audio needs its own element per participant — LiveKit does not play
 * subscribed audio unless it is attached to the DOM.
 */
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

export default function VideoGrid({
  participants,
  activeIdentity,
  localIdentity,
}: {
  participants: Participant[];
  activeIdentity: string | null;
  localIdentity: string | null;
}) {
  if (participants.length === 0) {
    return <div className="grid"><div className="tile"><div className="placeholder">waiting for cameras…</div></div></div>;
  }

  return (
    <div className="grid">
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
