/**
 * List and grid keyboard navigation as a pure function, so it can be tested
 * without a browser. Vertical lists (columns 1, the default): Up/Down wrap.
 * Grids: arrows move in 2D and stop at the edges. Both skip disabled items;
 * Enter/Space select; Esc goes back.
 */
export type NavState = {
  index: number;
  count: number;
  /** Items per row; 1 (default) is a vertical list. */
  columns?: number;
  disabled?: ReadonlySet<number>;
};
export type NavResult = { index: number; action: "select" | "back" | null };

function seek(s: NavState, from: number, step: 1 | -1): number {
  for (let i = 1; i <= s.count; i++) {
    const at = (((from + step * i) % s.count) + s.count) % s.count;
    if (!s.disabled?.has(at)) return at;
  }
  return s.index; // everything is disabled: stay put
}

/** Grid step without wrapping: the first enabled cell along the direction, or stay. */
function step(s: NavState, delta: number, sameRow: boolean): number {
  const cols = s.columns ?? 1;
  const row = Math.floor(s.index / cols);
  for (let at = s.index + delta; at >= 0 && at < s.count; at += delta) {
    if (sameRow && Math.floor(at / cols) !== row) break;
    if (!s.disabled?.has(at)) return at;
  }
  return s.index;
}

export function navigate(s: NavState, key: string): NavResult {
  if (s.count <= 0) return { index: s.index, action: null };
  const cols = s.columns ?? 1;
  if (cols > 1) {
    const move = { ArrowLeft: [-1, true], ArrowRight: [1, true], ArrowUp: [-cols, false], ArrowDown: [cols, false] } as const;
    if (key in move) {
      const [delta, sameRow] = move[key as keyof typeof move];
      return { index: step(s, delta, sameRow), action: null };
    }
  }
  switch (key) {
    case "ArrowDown":
      return { index: seek(s, s.index, 1), action: null };
    case "ArrowUp":
      return { index: seek(s, s.index, -1), action: null };
    case "Home":
      return { index: seek(s, -1, 1), action: null };
    case "End":
      return { index: seek(s, s.count, -1), action: null };
    case "Enter":
    case " ":
      return { index: s.index, action: s.disabled?.has(s.index) ? null : "select" };
    case "Escape":
      return { index: s.index, action: "back" };
    default:
      return { index: s.index, action: null };
  }
}
