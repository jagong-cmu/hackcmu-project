/**
 * LANE A — camera tiles with names.
 *
 * Ranked/Duet: one large face cam per person. Chaos: equal grid.
 *
 * Attach once per track. Re-attaching on every parent render (speaker ticks,
 * lyric cues, timers) blacks out the video and tears down remote audio.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { Track, type Participant, type TrackPublication } from "livekit-client";
import { boostRemoteAudioTrack } from "./levels.ts";

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
    if (source === Track.Source.Microphone) {
      boostRemoteAudioTrack(track);
    }
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
  menu = null,
  side,
}: {
  participant: Participant;
  singing: boolean;
  isLocal: boolean;
  /** Seat: opponent left ("a"), you right ("b"). Absent in the Chaos grid. */
  side?: "a" | "b";
  waiting?: boolean;
  cue?: "you" | "them" | "together" | "wait" | null;
  /** Safety controls ("…") for a remote tile. */
  menu?: ReactNode;
}) {
  const videoRef = useAttachedMedia<HTMLVideoElement>(participant, Track.Source.Camera);
  const cameraPub = publicationOf(participant, Track.Source.Camera);
  const cameraOn = Boolean(cameraPub?.track) && cameraPub?.isMuted === false;

  return (
    <div
      className={`tile feed${singing ? " singing" : waiting ? " waiting" : ""}`}
      data-state={cameraOn ? "live" : "off"}
      data-side={side}
      data-you={isLocal ? "" : undefined}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isLocal}
        style={isLocal ? { transform: "scaleX(-1)" } : undefined}
      />
      {!cameraOn && (
        <div className="feed-state">
          <strong>Camera off</strong>
        </div>
      )}
      {cue ? <div className={singing || cue === "together" ? "cam-cue on" : "cam-cue"}>{cue}</div> : null}
      <div className="feed-label">{participant.name || participant.identity}</div>
      {menu}
    </div>
  );
}

function RemoteAudio({ participant }: { participant: Participant }) {
  const ref = useAttachedMedia<HTMLAudioElement>(participant, Track.Source.Microphone);
  return <audio ref={ref} className="remote-mic" autoPlay playsInline />;
}

function EmptyTile({ label }: { label: string }) {
  return (
    <div className="tile feed" data-state="off">
      <div className="feed-state">{label}</div>
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
  menu = null,
}: {
  participant: Participant | undefined;
  singing: boolean;
  isLocal: boolean;
  emptyLabel: string;
  waiting?: boolean;
  cue?: "you" | "them" | "together" | "wait" | null;
  /**
   * Safety controls. Rendered on the pane, not the tile, so the menu stays
   * mounted when blocking swaps the camera for an empty tile.
   */
  menu?: ReactNode;
}) {
  return (
    <div className="stage-cam">
      {participant ? (
        <>
          <Tile
            participant={participant}
            singing={singing}
            isLocal={isLocal}
            side={isLocal ? "b" : "a"}
            waiting={waiting}
            cue={cue}
          />
          {!isLocal && <RemoteAudio participant={participant} />}
        </>
      ) : (
        <EmptyTile label={emptyLabel} />
      )}
      {menu}
    </div>
  );
}

export default function VideoGrid({
  participants,
  activeIdentity,
  localIdentity,
  compact = false,
  renderMenu,
}: {
  participants: Participant[];
  activeIdentity: string | null;
  localIdentity: string | null;
  compact?: boolean;
  /** Safety controls for each remote tile. */
  renderMenu?: (participant: Participant) => ReactNode;
}) {
  if (participants.length === 0) {
    return (
      <div className={compact ? "grid compact" : "grid"}>
        <EmptyTile label="waiting for cameras…" />
      </div>
    );
  }

  // Chaos: one featured singer (whoever has the mic, else you) above a strip of
  // everyone else, so up to 8 feeds fit without every tile shrinking.
  const featured =
    participants.find((p) => p.identity === activeIdentity) ??
    participants.find((p) => p.identity === localIdentity) ??
    participants[0];
  const ordered = [featured, ...participants.filter((p) => p !== featured)];

  return (
    <div className={compact ? "grid compact has-featured" : "grid"}>
      {ordered.map((participant) => {
        const isLocal = participant.identity === localIdentity;
        return (
          <div
            key={participant.sid || participant.identity}
            className={compact && participant === featured ? "chaos-featured" : undefined}
          >
            <Tile
              participant={participant}
              singing={participant.identity === activeIdentity}
              isLocal={isLocal}
              menu={!isLocal && renderMenu ? renderMenu(participant) : null}
            />
            {!isLocal && <RemoteAudio participant={participant} />}
          </div>
        );
      })}
    </div>
  );
}
