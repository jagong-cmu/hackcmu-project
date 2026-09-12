export type LrcLine = { timeSec: number; text: string };

export function parseLrc(src: string): LrcLine[] {
  const lines: LrcLine[] = [];
  const re = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\](.*)/;
  for (const raw of src.split(/\r?\n/)) {
    const m = raw.match(re);
    if (!m) continue;
    const min = Number(m[1]);
    const sec = Number(m[2]);
    const frac = m[3] ? Number(m[3].padEnd(3, "0").slice(0, 3)) / 1000 : 0;
    const text = m[4].trim();
    if (!text) continue;
    lines.push({ timeSec: min * 60 + sec + frac, text });
  }
  return lines.sort((a, b) => a.timeSec - b.timeSec);
}

export function lineAt(lines: LrcLine[], timeSec: number): { current: LrcLine | null; next: LrcLine | null } {
  let current: LrcLine | null = null;
  let next: LrcLine | null = null;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].timeSec <= timeSec) current = lines[i];
    else {
      next = lines[i];
      break;
    }
  }
  return { current, next };
}
