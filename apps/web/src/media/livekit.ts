/**
 * LANE A — LiveKit Cloud (Build tier) connection.
 *
 * Cameras and mics only. The karaoke instrumental is played by a local <audio>
 * element on each client and must never be published as a track — routing it
 * through WebRTC would re-encode it and desync the two sides.
 */
import { Room, RoomEvent, Track } from "livekit-client";

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
    adaptiveStream: true,
    dynacast: true,
    // Singing into an open laptop next to a speaker; keep the browser's echo
    // cancellation on but leave the voice itself unprocessed enough to judge.
    audioCaptureDefaults: {
      echoCancellation: true,
      noiseSuppression: false,
      autoGainControl: false,
    },
    videoCaptureDefaults: { resolution: { width: 640, height: 480 } },
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
  const track = pub?.track?.mediaStreamTrack;
  return track ? new MediaStream([track]) : null;
}

export { Room, RoomEvent, Track };
