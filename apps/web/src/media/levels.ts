import { sharedAudioContext } from "./audioContext.ts";

/** Mix so a sung vocal sits above the backing track. */
export const InstrumentalVolume = 0.32;
/** Extra gain on the opponent’s mic. LiveKit’s own volume node is unity. */
export const RemoteVoiceGain = 5;

type RemoteMic = {
  kind?: string;
  setVolume?: (volume: number) => void;
  setWebAudioPlugins?: (nodes: AudioNode[]) => void;
};

const plugins = new WeakMap<object, GainNode>();

/** Boost a subscribed LiveKit mic so it isn’t buried under the instrumental. */
export function boostRemoteAudioTrack(track: RemoteMic): void {
  if (track.kind && track.kind !== "audio") return;
  const ctx = sharedAudioContext();
  let gain = plugins.get(track);
  if (!gain) {
    gain = ctx.createGain();
    plugins.set(track, gain);
  }
  gain.gain.value = RemoteVoiceGain;
  track.setWebAudioPlugins?.([gain]);
  // LiveKit’s mixer gain stays at unity; the plugin does the lift. Fallback
  // if this client’s SDK has no plugin hook.
  if (!track.setWebAudioPlugins) track.setVolume?.(RemoteVoiceGain);
  else track.setVolume?.(1);
}
