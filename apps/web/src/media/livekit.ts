/**
 * LANE A — LiveKit Cloud (Build tier) connection.
 *
 * Cameras and mics only. The karaoke instrumental is played by a local <audio>
 * element on each client and must never be published as a track — routing it
 * through WebRTC would re-encode it and desync the two sides.
 */
import { Room, RoomEvent, Track } from "livekit-client";
import { sharedAudioContext } from "./audioContext.ts";

export type StageConnection = {
  room: Room;
  wsUrl: string;
};

type TokenResponse = {
  token: string;
  wsUrl: string;
  room: string;
};

export class LiveKitUnconfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LiveKitUnconfiguredError";
  }
}

async function fetchToken(
  code: string,
  identity: string,
  displayName: string,
): Promise<TokenResponse> {
  const res = await fetch("/api/livekit/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, identity, displayName }),
  });

  if (res.status === 503) {
    const body = (await res.json()) as { message?: string };
    throw new LiveKitUnconfiguredError(body.message ?? "LiveKit is not configured");
  }
  if (!res.ok) throw new Error(`token request failed: ${res.status}`);
  return (await res.json()) as TokenResponse;
}

export async function connectToStage(
  code: string,
  identity: string,
  displayName: string,
): Promise<StageConnection> {
  const { token, wsUrl } = await fetchToken(code, identity, displayName);

  const room = new Room({
    // This capture is what the DSP pitch-tracks (StageContext.micStream), not
    // just what gets published, so it is opened raw like Training's.
    // autoGainControl moves the levels the RMS gates key off, and
    // echoCancellation is tuned for speech: it attenuates a sustained sung
    // note it mistakes for returning far-end audio.
    //
    // The trade is real. With AEC off, anyone on SPEAKERS re-broadcasts the
    // backing track and the other singers to the room. Headphones are assumed.
    audioCaptureDefaults: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      voiceIsolation: false,
    },
    publishDefaults: {
      dtx: false,
    },
    videoCaptureDefaults: { resolution: { width: 640, height: 480 } },
    adaptiveStream: false,
    dynacast: false,
    // Mix remote mics in Web Audio so Chrome autoplay does not pin them to a
    // 0×0 <audio> that never received the Ready gesture.
    webAudioMix: { audioContext: sharedAudioContext() },
  });

  await room.connect(wsUrl, token);
  await room.localParticipant.enableCameraAndMicrophone();

  return { room, wsUrl };
}

export async function setMicEnabled(room: Room, enabled: boolean): Promise<void> {
  await room.localParticipant.setMicrophoneEnabled(enabled);
}

export async function setCameraEnabled(room: Room, enabled: boolean): Promise<void> {
  await room.localParticipant.setCameraEnabled(enabled);
}

/**
 * The raw mic MediaStream, handed to Lane B through StageContext so their pitch
 * meter and DSP can read the same capture LiveKit is publishing.
 */
export function micStreamOf(room: Room): MediaStream | null {
  const pub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
  if (!pub || pub.isMuted) return null;
  const track = pub.track?.mediaStreamTrack;
  if (!track || track.readyState === "ended") return null;
  return new MediaStream([track]);
}

export { Room, RoomEvent, Track };
