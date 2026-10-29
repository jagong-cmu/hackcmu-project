/**
 * PITCH LOCK for a room with no pitch lane (Chaos): reads your own mic
 * against the song's melody at the shared playhead. Display only — Chaos is
 * never scored. Same detector and gates as the Ranked/Duet stage.
 */
import { PitchDetector } from "pitchy";
import { useEffect, useRef, useState } from "react";
import type { MelodyFile } from "@karaoke/shared";
import { sharedAudioContext, unlockSharedAudio } from "../media/audioContext.ts";
import type { ClockPlay } from "../rooms/RoomProvider.tsx";
import { playheadFromClock } from "../stage/useSharedClock.ts";
import { isMusicOnly, PITCH_FFT } from "./cancelPlayback.ts";
import { loadSongPack } from "./catalog.ts";
import { pitchAnalyser, rmsOf } from "./pitchGuide.ts";
import { PitchLock } from "./pitchLock.ts";

export function useMicPitchLock({
  micStream,
  songId,
  clockPlay,
}: {
  /** Null turns the meter off (and releases the analyser). */
  micStream: MediaStream | null;
  songId: string | null | undefined;
  clockPlay: ClockPlay | null;
}): number | null {
  const [melody, setMelody] = useState<MelodyFile | null>(null);
  const [lock, setLock] = useState<number | null>(null);
  const melodyRef = useRef(melody);
  const clockRef = useRef(clockPlay);
  const lockRef = useRef(new PitchLock());
  melodyRef.current = melody;
  clockRef.current = clockPlay;

  useEffect(() => {
    setMelody(null);
    lockRef.current.reset();
    setLock(null);
    if (!songId) return;
    let cancelled = false;
    void loadSongPack(songId)
      .then((pack) => {
        if (!cancelled) setMelody(pack.melody);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [songId]);

  useEffect(() => {
    const raw = micStream?.getAudioTracks()[0];
    if (!raw) {
      setLock(null);
      return;
    }
    // Clone so WebRTC encoding cannot starve the analyser (as on the stage).
    const clone = raw.clone();
    const ctx = sharedAudioContext();
    void unlockSharedAudio();
    const src = ctx.createMediaStreamSource(new MediaStream([clone]));
    const analyser = pitchAnalyser(ctx, src, PITCH_FFT);
    const buf = new Float32Array(PITCH_FFT);
    const silent = new Float32Array(PITCH_FFT);
    const detector = PitchDetector.forFloat32Array(PITCH_FFT);
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const t = playheadFromClock(clockRef.current);
      const mel = melodyRef.current;
      if (t == null || !mel) return;
      analyser.getFloatTimeDomainData(buf);
      let hz: number | null = null;
      let clarity = 0;
      if (!isMusicOnly(buf, buf, silent)) {
        const [yinHz, yinClarity] = detector.findPitch(buf, ctx.sampleRate);
        clarity = yinClarity;
        const rms = rmsOf(buf);
        hz = Number.isFinite(yinHz) && yinHz > 0 && rms >= 0.008 ? yinHz : null;
      }
      setLock(lockRef.current.push(mel, t, hz, clarity));
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      src.disconnect();
      clone.stop();
    };
  }, [micStream]);

  return lock;
}
