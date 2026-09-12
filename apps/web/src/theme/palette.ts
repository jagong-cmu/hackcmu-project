/**
 * Canvas surfaces can't use CSS variables, so they read the resolved theme
 * from here. Cached: getComputedStyle every animation frame is far too
 * expensive for something drawn while the DSP is running.
 */
export type Palette = {
  bg: string;
  fg: string;
  /** White at a given alpha — grid lines, spent notes, dim labels. */
  ink: (alpha: number) => string;
  accent: string;
};

let cached: Palette | null = null;

export function palette(): Palette {
  if (cached) return cached;
  const css = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) =>
    css.getPropertyValue(name).trim() || fallback;
  cached = {
    // Translucent on purpose: the canvas paints this over whatever is behind
    // the element, so the voice wave shows through the meter.
    bg: read("--meter-bg", "rgba(9, 14, 24, 0.55)"),
    fg: read("--fg", "#ffffff"),
    ink: (alpha: number) => `rgba(206,224,255,${alpha})`,
    accent: read("--accent", "#79b4ff"),
  };
  return cached;
}

/**
 * Brightness by pitch height rather than hue: the palette is monochrome, so a
 * high note reads as hotter light, a low note as deeper blue. `lit` is the
 * in-tune state and gets the full white-hot end of the ramp.
 */
export function pitchColor(midi: number, alpha = 1, lit = true): string {
  // C2..C6 covers every melody in the catalogue plus the singers' range.
  const t = Math.max(0, Math.min(1, (midi - 36) / 48));
  const hue = 212 - t * 14;
  const sat = lit ? 95 : 45;
  const light = lit ? 62 + t * 26 : 46 + t * 12;
  return `hsla(${hue}, ${sat}%, ${light}%, ${alpha})`;
}
