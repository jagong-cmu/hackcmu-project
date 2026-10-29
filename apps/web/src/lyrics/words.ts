import type { LrcLine } from "./parseLrc.ts";

/** One word of words.json (tools/note_extraction `./ne align`), karaoke-track seconds. */
export type TimedWord = {
  text: string;
  start: number;
  end: number;
  score?: number | null;
  /** When the word is sung over several notes: each note's [start, end]. */
  notes?: [number, number][];
  flags?: string[];
};

export type WordsFile = { version: number; lines: { text: string; words: TimedWord[] }[] };

/** Lines switch this early so the singer can read ahead. */
export const LINE_LEAD_SEC = 0.15;

/**
 * words.json lined up with the LRC, one entry per LRC line. A line whose words
 * don't spell the LRC line gets null (it falls back to the line estimate); a
 * file with a different line count is ignored outright.
 */
export function wordsByLine(lines: LrcLine[], file: WordsFile | null): (TimedWord[] | null)[] | null {
  if (!file || file.lines.length !== lines.length) return null;
  return lines.map((line, i) => {
    const words = file.lines[i].words;
    const want = line.text.split(/\s+/).filter(Boolean);
    return words.length === want.length && words.every((w, k) => w.text === want[k]) ? words : null;
  });
}

/** The LRC lines with each timed line moved to LINE_LEAD_SEC before its first word. */
export function retimeLines(lines: LrcLine[], byLine: (TimedWord[] | null)[] | null): LrcLine[] {
  if (!byLine) return lines;
  return lines.map((line, i) => {
    const first = byLine[i]?.[0];
    return first ? { ...line, timeSec: first.start - LINE_LEAD_SEC } : line;
  });
}

/**
 * 0..1 through a word at time t. A word sung over several notes fills one
 * note's share per note, as each note is sung, and holds between notes.
 */
export function wordProgress(w: TimedWord, t: number): number {
  if (t < w.start) return 0;
  if (t >= w.end) return 1;
  const parts = w.notes?.length ? w.notes : [[w.start, w.end]];
  for (let k = 0; k < parts.length; k++) {
    const [s, e] = parts[k];
    if (t < s) return k / parts.length;
    if (t < e) return (k + (t - s) / Math.max(1e-3, e - s)) / parts.length;
  }
  return 1;
}
