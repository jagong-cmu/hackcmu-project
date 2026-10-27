import type { LrcLine } from "./parseLrc.ts";
import { lineSpan } from "./wipe.ts";

/** How early before the next line the count-in appears, seconds. */
export const CountInSec = 4;

export type RowState = "active" | "upcoming";
export type RowView = { line: LrcLine; index: number; state: RowState };
export type Rows = {
  /** [top, bottom]. Even-numbered lines live in the top row, odd-numbered in the bottom. */
  rows: [RowView | null, RowView | null];
  /** The row being sung, or null between lines. */
  activeRow: 0 | 1 | null;
  /** Seconds until the next line, once it is close and nothing is being sung. */
  countIn: number | null;
};

function place(
  lines: LrcLine[],
  picks: { index: number; state: RowState }[],
): [RowView | null, RowView | null] {
  const rows: [RowView | null, RowView | null] = [null, null];
  for (const { index, state } of picks) {
    const line = lines[index];
    if (line) rows[index % 2] = { line, index, state };
  }
  return rows;
}

/** Two upcoming lines laid out by parity: the lead-in's view, before anything is sung. */
export function upcomingRows(lines: LrcLine[], startIndex: number): Rows {
  return {
    rows: place(lines, [
      { index: startIndex, state: "upcoming" },
      { index: startIndex + 1, state: "upcoming" },
    ]),
    activeRow: null,
    countIn: null,
  };
}

/**
 * Noraebang rows for a playback time. The line being sung is active in its own
 * row; the other row already shows the next line, and is only replaced once its
 * line has been sung. Once a line's span is spent (a long instrumental gap) both
 * rows preview what is coming, and a count-in runs for the last CountInSec.
 */
export function lyricRows(lines: LrcLine[], t: number): Rows {
  if (!lines.length) return { rows: [null, null], activeRow: null, countIn: null };

  let c = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].timeSec <= t) c = i;
    else break;
  }
  if (c < 0) return upcomingRows(lines, 0);

  const cur = lines[c];
  const next = lines[c + 1] ?? null;
  const spent = t >= cur.timeSec + lineSpan(cur, next);
  if (!spent) {
    return {
      rows: place(lines, [
        { index: c, state: "active" },
        { index: c + 1, state: "upcoming" },
      ]),
      activeRow: (c % 2) as 0 | 1,
      countIn: null,
    };
  }

  const wait = next ? next.timeSec - t : null;
  return {
    ...upcomingRows(lines, c + 1),
    countIn: wait != null && wait <= CountInSec ? wait : null,
  };
}
