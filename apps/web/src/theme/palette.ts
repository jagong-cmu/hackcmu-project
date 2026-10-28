/**
 * Canvas surfaces can't use CSS variables, so they read the resolved theme
 * from here. Cached: getComputedStyle every animation frame is far too
 * expensive for something drawn while the DSP is running.
 */
export type Palette = {
  bg: string;
  fg: string;
  /** The guide-line colour (--line-rgb) at a given alpha: grid lines, spent notes, dim labels. */
  ink: (alpha: number) => string;
  /** Any `--*-rgb` channel token at a given alpha, e.g. tone("ice-rgb", 0.4). */
  tone: (channel: string, alpha: number) => string;
  accent: string;
};

let cached: Palette | null = null;

export function palette(): Palette {
  if (cached) return cached;
  const css = getComputedStyle(document.documentElement);
  const read = (name: string) => css.getPropertyValue(name).trim();
  const line = read("--line-rgb");
  cached = {
    bg: read("--surface"),
    fg: read("--text"),
    ink: (alpha: number) => `rgb(${line} / ${alpha})`,
    tone: (channel: string, alpha: number) => `rgb(${read(`--${channel}`)} / ${alpha})`,
    accent: read("--red"),
  };
  return cached;
}

/**
 * Your voice in the pitch lane: red (red = you). Higher notes read a little
 * lighter; `lit` is the in-tune state and gets the full-strength end.
 */
export function pitchColor(midi: number, alpha = 1, lit = true): string {
  // C2..C6 covers every melody in the catalogue plus the singers' range.
  const t = Math.max(0, Math.min(1, (midi - 36) / 48));
  const sat = lit ? 80 : 40;
  const light = lit ? 50 + t * 14 : 40 + t * 10;
  return `hsla(350, ${sat}%, ${light}%, ${alpha})`;
}
