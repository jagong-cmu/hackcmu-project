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

/** Shared playhead in song seconds. Same on every client, even if local audio is blocked. */
export function playheadFromClock(clock: ClockPlay | null): number | null {
  if (!clock || clock.playAtUnixMs == null || !clock.songId) return null;
  const t = clock.startSec + (serverNow() - clock.playAtUnixMs) / 1000;
  const end = clock.startSec + clock.durationSec;
  return Math.min(end, Math.max(clock.startSec, t));
}

function whenMeta(audio: HTMLAudioElement, fn: () => void): () => void {
  if (audio.readyState >= 1) {
    fn();
    return () => {};
  }
  audio.addEventListener("loadedmetadata", fn, { once: true });
  return () => audio.removeEventListener("loadedmetadata", fn);
}

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
    if (!audio || !clockPlay?.songId) {
      const el = audioRef.current;
      if (!el) return;
      livePlaybackRef.current = false;
      el.pause();
      setPlaying(false);
      return;
    }

    const songId = clockPlay.songId;
    const startSec = clockPlay.startSec;
    const durationSec = clockPlay.durationSec;
    const playAtUnixMs = clockPlay.playAtUnixMs;
    const endSec = startSec + durationSec;
    const src = `/songs/${songId}/instrumental.mp3`;
    if (!audio.src.endsWith(src)) audio.src = src;
    audio.loop = false;
    audio.volume = InstrumentalVolume;
    audio.pause();
    setPlaying(false);
    livePlaybackRef.current = false;

    /** Where the playhead should be, in song seconds, at a given server time. */
    const expectedAt = (serverMs: number) => startSec + (serverMs - playAtUnixMs) / 1000;

    let spinFrame = 0;
    let startTimer: number | undefined;
    let driftTimer: number | undefined;
    let stopTimer: number | undefined;
    let dropMeta = () => {};
    let done = false;
    let halted = false;

    const halt = () => {
      if (halted) return;
      halted = true;
      livePlaybackRef.current = false;
      audio.pause();
      try {
        audio.currentTime = endSec;
      } catch {
        /* not seekable yet */
      }
      setPlaying(false);
      if (driftTimer) {
        clearInterval(driftTimer);
        driftTimer = undefined;
      }
    };

    const clipGuard = () => {
      if (done) return;
      if (expectedAt(serverNow()) >= endSec || audio.currentTime >= endSec - 0.02) halt();
    };

    const begin = () => {
      if (done) return;
      const target = Math.max(startSec, expectedAt(serverNow()));

      // Past the end already (a very late join) — nothing to play.
      if (target >= endSec) {
        halt();
        return;
      }

      dropMeta();
      dropMeta = whenMeta(audio, () => {
        if (done) return;
        try {
          audio.currentTime = target;
        } catch {
          /* Chrome can throw if the element is still HAVE_NOTHING. */
        }
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
      });

      driftTimer = window.setInterval(() => {
        const want = expectedAt(serverNow());
        if (want >= endSec) {
          halt();
          return;
        }
        if (Math.abs(audio.currentTime - want) > MaxDriftSec) {
          audio.currentTime = want;
        }
      }, DRIFT_CHECK_MS);

      const remainingMs = (endSec - target) * 1000;
      stopTimer = window.setTimeout(halt, remainingMs);
    };

    // Burn the last few milliseconds in rAF; setTimeout alone is too coarse to
    // hold two laptops inside 100ms of each other.
    const spin = () => {
      if (done) return;
      if (serverNow() >= playAtUnixMs) begin();
      else spinFrame = requestAnimationFrame(spin);
    };

    dropMeta = whenMeta(audio, () => {
      if (done) return;
      try {
        audio.currentTime = startSec;
      } catch {
        /* wait for begin() */
      }
    });

    audio.addEventListener("timeupdate", clipGuard);
    audio.addEventListener("ended", halt);

    const leadMs = playAtUnixMs - serverNow();
    if (leadMs <= 0) begin();
    else if (leadMs <= SPIN_LEAD_MS) spinFrame = requestAnimationFrame(spin);
    else startTimer = window.setTimeout(spin, leadMs - SPIN_LEAD_MS);

    return () => {
      done = true;
      dropMeta();
      cancelAnimationFrame(spinFrame);
      if (startTimer) clearTimeout(startTimer);
      if (driftTimer) clearInterval(driftTimer);
      if (stopTimer) clearTimeout(stopTimer);
      audio.removeEventListener("timeupdate", clipGuard);
      audio.removeEventListener("ended", halt);
      livePlaybackRef.current = false;
      audio.pause();
      setPlaying(false);
    };
  }, [clockPlay?.songId, clockPlay?.startSec, clockPlay?.durationSec, clockPlay?.playAtUnixMs]);

  return { audioRef, blocked, unlock, playing };
}
