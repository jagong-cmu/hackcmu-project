/**
 * Menu keyboard navigation as a pure function, so it can be tested without a
 * browser. Arrow keys wrap and skip disabled items; Enter selects; Esc goes back.
 */
export type NavState = { index: number; count: number; disabled?: ReadonlySet<number> };
export type NavResult = { index: number; action: "select" | "back" | null };

function seek(s: NavState, from: number, step: 1 | -1): number {
  for (let i = 1; i <= s.count; i++) {
    const at = (((from + step * i) % s.count) + s.count) % s.count;
    if (!s.disabled?.has(at)) return at;
  }
  return s.index; // everything is disabled: stay put
}

export function navigate(s: NavState, key: string): NavResult {
  if (s.count <= 0) return { index: s.index, action: null };
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
