import { useEffect, useState } from "react";
import {
  armRandomCapture,
  flushCapture,
  getMatchMoment,
  resetMatchMoment,
  subscribeMatchMoment,
  type MatchMoment,
} from "./matchMoment.ts";
import {
  getMatchReel,
  matchReelPending,
  resetMatchReel,
  startMatchReel,
  stopMatchReel,
  subscribeMatchReel,
  type MatchReel,
} from "./matchReel.ts";

export function useMatchMoment(): MatchMoment | null {
  const [moment, setMoment] = useState<MatchMoment | null>(getMatchMoment);
  useEffect(() => subscribeMatchMoment(() => setMoment(getMatchMoment())), []);
  return moment;
}

export function useMatchReel(): MatchReel | null {
  const [reel, setReel] = useState<MatchReel | null>(getMatchReel);
  useEffect(() => subscribeMatchReel(() => setReel(getMatchReel())), []);
  return reel;
}

export function useMatchReelPending(): boolean {
  const [pending, setPending] = useState(matchReelPending);
  useEffect(() => subscribeMatchReel(() => setPending(matchReelPending())), []);
  return pending;
}

type CaptureOpts = {
  matchKey: string;
  singing: boolean;
  /** Broader than singing — countdown through swap — so the video has both turns. */
  recording?: boolean;
  windowMs: number;
  micStream?: MediaStream | null;
  /** Grab immediately if the random beat missed (results screen). */
  settle?: boolean;
  /** New lobby / leave — drop the still so the next match is clean. */
  reset?: boolean;
};

/** Arm a still and start the share video. Safe to call every render. */
export function useMatchMomentCapture({
  matchKey,
  singing,
  recording,
  windowMs,
  micStream = null,
  settle = false,
  reset = false,
}: CaptureOpts) {
  const shouldRecord = recording ?? singing;
  useEffect(() => {
    if (reset || !matchKey) {
      if (reset) {
        resetMatchMoment();
        resetMatchReel();
      }
      return;
    }
    if (singing) armRandomCapture(matchKey, windowMs);
    if (shouldRecord) startMatchReel(matchKey, micStream);
    if (settle) {
      flushCapture(matchKey);
      void stopMatchReel(matchKey);
    }
  }, [matchKey, singing, shouldRecord, windowMs, micStream, settle, reset]);
}
