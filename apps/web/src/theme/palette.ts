/**
 * Canvas surfaces can't use CSS variables, so they read the resolved theme
 * from here. Cached: getComputedStyle every animation frame is far too
 * expensive for something drawn while the DSP is running.
 */
export type Palette = {
  bg: string;
  fg: string;
  /** Cream at a given alpha: grid lines, spent notes, dim labels. */
  ink: (alpha: number) => string;
  /** Any `--*-rgb` channel token at a given alpha, e.g. tone("amber-rgb", 0.4). */
  tone: (channel: string, alpha: number) => string;
  accent: string;
};

let cached: Palette | null = null;

export function palette(): Palette {
  if (cached) return cached;
  const css = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) =>
    css.getPropertyValue(name).trim() || fallback;
  const cream = read("--cream-rgb", "255 232 205");
  cached = {
    // Translucent on purpose: the canvas paints this over whatever is behind
    // the element, so the voice wave shows through the meter.
    bg: read("--meter-bg", "rgba(26, 20, 16, 0.6)"),
    fg: read("--fg", "#f6efe4"),
    ink: (alpha: number) => `rgb(${cream} / ${alpha})`,
    tone: (channel: string, alpha: number) =>
      `rgb(${read(`--${channel}`, cream)} / ${alpha})`,
    accent: read("--accent", "#f5a21f"),
  };
  return cached;
}

/**
 * Brightness by pitch height rather than hue: the palette is one bulb, so a
 * high note reads as hotter light, a low note as deeper amber. `lit` is the
 * in-tune state and gets the full white-hot end of the ramp.
 */
export function pitchColor(midi: number, alpha = 1, lit = true): string {
  // C2..C6 covers every melody in the catalogue plus the singers' range.
  const t = Math.max(0, Math.min(1, (midi - 36) / 48));
  const hue = 28 + t * 16;
  const sat = lit ? 95 : 45;
  const light = lit ? 62 + t * 26 : 46 + t * 12;
  return `hsla(${hue}, ${sat}%, ${light}%, ${alpha})`;
}
