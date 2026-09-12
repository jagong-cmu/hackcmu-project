/**
 * One AudioContext for karaoke playback DSP and LiveKit remote audio.
 * Separate contexts stay suspended after Ready, which is how opponent mics
 * go silent even though the instrumental still plays.
 */
let ctx: AudioContext | null = null;

export function sharedAudioContext(): AudioContext {
  if (!ctx || ctx.state === "closed") {
    ctx = new AudioContext();
  }
  return ctx;
}

export async function unlockSharedAudio(): Promise<void> {
  const audio = sharedAudioContext();
  if (audio.state !== "running") await audio.resume();
}
