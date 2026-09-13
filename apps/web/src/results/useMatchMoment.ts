import { useEffect, useState } from "react";
import {
  armRandomCapture,
  flushCapture,
  getMatchMoment,
  resetMatchMoment,
  subscribeMatchMoment,
  type MatchMoment,
} from "./matchMoment.ts";

export function useMatchMoment(): MatchMoment | null {
  const [moment, setMoment] = useState<MatchMoment | null>(getMatchMoment);
  useEffect(() => subscribeMatchMoment(() => setMoment(getMatchMoment())), []);
  return moment;
}

type CaptureOpts = {
  matchKey: string;
  singing: boolean;
  windowMs: number;
  /** Grab immediately if the random beat missed (results screen). */
  settle?: boolean;
  /** New lobby / leave — drop the still so the next match is clean. */
  reset?: boolean;
};

/** Arm a one-shot still somewhere in the clip. Safe to call every render. */
export function useMatchMomentCapture({
  matchKey,
  singing,
  windowMs,
  settle = false,
  reset = false,
}: CaptureOpts) {
  useEffect(() => {
    if (reset || !matchKey) {
      if (reset) resetMatchMoment();
      return;
    }
    if (singing) armRandomCapture(matchKey, windowMs);
    if (settle) flushCapture(matchKey);
  }, [matchKey, singing, windowMs, settle, reset]);
}
