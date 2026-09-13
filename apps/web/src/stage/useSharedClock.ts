/**
 * LANE A — the shared clock.
 *
 * Each client plays its own local <audio>. The server only says *when*:
 * `playAtUnixMs`. We correct for the browser/server clock offset, spin the last
 * few frames for accuracy, and re-seek whenever playback drifts past
 * MaxDriftSec (TECHNICAL_PRD §6).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { MaxDriftSec } from "@karaoke/shared";
import { serverNow } from "../rooms/timeSync.ts";
import type { ClockPlay } from "../rooms/RoomProvider.tsx";
import { unlockSharedAudio } from "../media/audioContext.ts";
import { InstrumentalVolume } from "../media/levels.ts";

/** Hand off from setTimeout to a rAF spin this long before the downbeat. */
const SPIN_LEAD_MS = 80;
const DRIFT_CHECK_MS = 500;

export type SharedClock = {
  audioRef: React.RefObject<HTMLAudioElement>;
  /** True when Chrome refused autoplay and we need a tap. */
  blocked: boolean;
  /** Call from a click handler to satisfy the autoplay policy. */
  unlock: () => void;
  playing: boolean;
};

export function useSharedClock(clockPlay: ClockPlay | null): SharedClock {
  const audioRef = useRef<HTMLAudioElement>(null);
  const primedRef = useRef(false);
  const livePlaybackRef = useRef(false);
  const [blocked, setBlocked] = useState(false);
  const [playing, setPlaying] = useState(false);

  /** Prime the element on a real user gesture so later timed plays are allowed. */
  const unlock = useCallback(() => {
    void unlockSharedAudio();
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = false;
    // A click on the pitch staff (or anywhere) must not hitch a clip that is
    // already rolling — the old play-then-pause prime stopped the song.
    if (!audio.paused || primedRef.current || livePlaybackRef.current) {
      primedRef.current = true;
      setBlocked(false);
      return;
    }
    void audio
      .play()
      .then(() => {
        primedRef.current = true;
        setBlocked(false);
        if (livePlaybackRef.current) return;
        audio.pause();
      })
      .catch(() => {
        /* Nothing loaded yet; the real play attempt will report. */
      });
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !clockPlay?.songId) return;

    const songId = clockPlay.songId;
    const startSec = clockPlay.startSec;
    const durationSec = clockPlay.durationSec;
    const playAtUnixMs = clockPlay.playAtUnixMs;
    const src = `/songs/${songId}/instrumental.mp3`;
    if (!audio.src.endsWith(src)) audio.src = src;
    audio.volume = InstrumentalVolume;
    audio.pause();
    audio.currentTime = startSec;
    setPlaying(false);
    livePlaybackRef.current = false;

    /** Where the playhead should be, in song seconds, at a given server time. */
    const expectedAt = (serverMs: number) => startSec + (serverMs - playAtUnixMs) / 1000;

    let spinFrame = 0;
    let startTimer: number | undefined;
    let driftTimer: number | undefined;
    let stopTimer: number | undefined;
    let done = false;

    const begin = () => {
      if (done) return;
      const target = Math.max(startSec, expectedAt(serverNow()));

      // Past the end already (a very late join) — nothing to play.
      if (target >= startSec + durationSec) return;

      audio.currentTime = target;
      livePlaybackRef.current = true;
      void audio
        .play()
        .then(() => {
          primedRef.current = true;
          setBlocked(false);
          setPlaying(true);
        })
        .catch(() => {
          livePlaybackRef.current = false;
          setBlocked(true);
        });

      driftTimer = window.setInterval(() => {
        const want = expectedAt(serverNow());
        const end = startSec + durationSec;
        if (want >= end) {
          livePlaybackRef.current = false;
          audio.pause();
          audio.currentTime = end;
          setPlaying(false);
          if (driftTimer) {
            clearInterval(driftTimer);
            driftTimer = undefined;
          }
          return;
        }
        if (Math.abs(audio.currentTime - want) > MaxDriftSec) {
          audio.currentTime = want;
        }
      }, DRIFT_CHECK_MS);

      const remainingMs = (startSec + durationSec - target) * 1000;
      stopTimer = window.setTimeout(() => {
        livePlaybackRef.current = false;
        audio.pause();
        audio.currentTime = startSec + durationSec;
        setPlaying(false);
        if (driftTimer) {
          clearInterval(driftTimer);
          driftTimer = undefined;
        }
      }, remainingMs);
    };

    // Burn the last few milliseconds in rAF; setTimeout alone is too coarse to
    // hold two laptops inside 100ms of each other.
    const spin = () => {
      if (done) return;
      if (serverNow() >= playAtUnixMs) begin();
      else spinFrame = requestAnimationFrame(spin);
    };

    const leadMs = playAtUnixMs - serverNow();
    if (leadMs <= 0) begin();
    else if (leadMs <= SPIN_LEAD_MS) spinFrame = requestAnimationFrame(spin);
    else startTimer = window.setTimeout(spin, leadMs - SPIN_LEAD_MS);

    return () => {
      done = true;
      cancelAnimationFrame(spinFrame);
      if (startTimer) clearTimeout(startTimer);
      if (driftTimer) clearInterval(driftTimer);
      if (stopTimer) clearTimeout(stopTimer);
      livePlaybackRef.current = false;
      audio.pause();
      setPlaying(false);
    };
  }, [clockPlay?.songId, clockPlay?.startSec, clockPlay?.durationSec, clockPlay?.playAtUnixMs]);

  return { audioRef, blocked, unlock, playing };
}
