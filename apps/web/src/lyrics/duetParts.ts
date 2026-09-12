import { lineAt, type DuetVoice, type LrcLine } from "./parseLrc.ts";

export type DuetCueVoice = DuetVoice | "rest";
export type DuetSeat = "a" | "b";

/** Light the next singer a hair before the lyric so the first syllable isn't late. */
export const DUET_LEAD_SEC = 0.28;
/** After this, a line yields to rest if the next line hasn't started (instrumental gaps). */
export const DUET_LINE_HOLD_SEC = 5.4;

export function duetSeat(
  players: { id: string }[],
  myPlayerId: string | null,
): DuetSeat | null {
  if (!myPlayerId) return null;
  if (players[0]?.id === myPlayerId) return "a";
  if (players[1]?.id === myPlayerId) return "b";
  return null;
}

export function singingNow(
  voice: DuetCueVoice | null,
  seat: DuetSeat | null,
): { me: boolean; them: boolean } {
  if (!voice || voice === "rest" || !seat) return { me: false, them: false };
  if (voice === "both") return { me: true, them: true };
  const mine = voice === seat;
  return { me: mine, them: !mine };
}

export function seatSings(voice: DuetCueVoice | null, seat: DuetSeat): boolean {
  if (!voice || voice === "rest") return false;
  return voice === "both" || voice === seat;
}

export function cueLabel(
  voice: DuetCueVoice | null,
  seat: DuetSeat | null,
  nameA: string,
  nameB: string,
): { text: string; kind: "you" | "them" | "together" | "wait" } {
  if (!voice || voice === "rest") return { text: "wait", kind: "wait" };
  if (voice === "both") return { text: "together", kind: "together" };
  if (seat && voice === seat) return { text: "you", kind: "you" };
  return { text: voice === "a" ? nameA : nameB, kind: "them" };
}

function holdEnd(current: LrcLine, next: LrcLine | null): number {
  const cap = current.timeSec + DUET_LINE_HOLD_SEC;
  if (!next) return cap;
  return Math.min(next.timeSec, cap);
}

export function cueAt(
  lines: LrcLine[],
  timeSec: number,
  leadSec = DUET_LEAD_SEC,
): {
  current: LrcLine | null;
  next: LrcLine | null;
  voice: DuetCueVoice | null;
  waiting: boolean;
} {
  const t = timeSec + leadSec;
  const { current, next } = lineAt(lines, t);
  if (!current && next) {
    return { current: null, next, voice: next.voice, waiting: true };
  }
  if (!current) return { current: null, next: null, voice: null, waiting: false };
  if (t > holdEnd(current, next)) {
    return { current, next, voice: "rest", waiting: Boolean(next) };
  }
  return { current, next, voice: current.voice, waiting: false };
}

export function windowsForSeat(
  lines: LrcLine[],
  seat: DuetSeat,
  clip: { startSec: number; durationSec: number },
): { startSec: number; endSec: number }[] {
  const clipEnd = clip.startSec + clip.durationSec;
  const raw: { startSec: number; endSec: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.voice !== "both" && line.voice !== seat) continue;
    const next = lines[i + 1] ?? null;
    const start = Math.max(line.timeSec, clip.startSec);
    const end = Math.min(holdEnd(line, next), clipEnd);
    if (end <= start) continue;
    raw.push({ startSec: start, endSec: end });
  }
  if (raw.length === 0) return [];
  const out = [{ ...raw[0] }];
  for (let i = 1; i < raw.length; i++) {
    const prev = out[out.length - 1];
    if (raw[i].startSec <= prev.endSec + 0.05) {
      prev.endSec = Math.max(prev.endSec, raw[i].endSec);
    } else {
      out.push({ ...raw[i] });
    }
  }
  return out;
}
