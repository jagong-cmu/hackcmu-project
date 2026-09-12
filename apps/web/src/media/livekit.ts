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
  capture: CaptureState;
};

/** Which halves of the capture actually opened, and why one didn't. */
export type CaptureState = {
  mic: boolean;
  camera: boolean;
  /** Human-readable reason a half is missing. Null when both opened. */
  error: string | null;
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

export function whyFailed(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  switch (err.name) {
    case "NotAllowedError":
      return "Chrome is blocking it — allow it in the address bar and reload.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "no device found.";
    case "NotReadableError":
    case "AbortError":
      return "another app has it open (Zoom, Teams, Photo Booth, OBS).";
    default:
      return err.message;
  }
}

/**
 * Open mic and camera without letting one take the other down.
 *
 * enableCameraAndMicrophone() is a SINGLE getUserMedia for both sources, so a
 * webcam that is missing or already held by another app rejects the whole call
 * and leaves the singer with no mic at all — the game is unplayable for them
 * while Training, which falls back to audio-only, works fine.
 *
 * Try the combined call first so healthy hardware still sees one permission
 * prompt, then retry the halves separately. The mic goes first: karaoke with no
 * face cam is still karaoke.
 */
async function openCapture(room: Room): Promise<CaptureState> {
  try {
    await room.localParticipant.enableCameraAndMicrophone();
    return { mic: true, camera: true, error: null };
  } catch {
    // One of the two failed. Which one is not reported, so ask them apart.
  }

  let micError: unknown = null;
  let mic = false;
  let camera = false;

  try {
    await room.localParticipant.setMicrophoneEnabled(true);
    mic = true;
  } catch (err) {
    micError = err;
  }

  try {
    await room.localParticipant.setCameraEnabled(true);
    camera = true;
  } catch {
    // Optional. VideoGrid already renders a "camera off" placeholder tile.
  }

  if (!mic) return { mic, camera, error: `Mic unavailable — ${whyFailed(micError)}` };
  if (!camera) return { mic, camera, error: "Camera unavailable — you can still sing." };
  return { mic, camera, error: null };
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
  const capture = await openCapture(room);

  return { room, wsUrl, capture };
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
