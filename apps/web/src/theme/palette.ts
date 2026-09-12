/**
 * Canvas surfaces can't use CSS variables, so they read the resolved theme
 * from here. The result is cached and invalidated when the theme actually
 * changes — getComputedStyle every animation frame is far too expensive for
 * something drawn while the DSP is running.
 */
export type Palette = {
  isLight: boolean;
  bg: string;
  fg: string;
  /** fg at a given alpha, e.g. grid lines and spent notes. */
  ink: (alpha: number) => string;
  accent: string;
};

let cached: Palette | null = null;

function build(): Palette {
  const root = document.documentElement;
  const attr = root.getAttribute("data-theme");
  const isLight =
    attr === "light" ||
    (attr !== "dark" && window.matchMedia("(prefers-color-scheme: light)").matches);

  const css = getComputedStyle(root);
  const read = (name: string, fallback: string) =>
    css.getPropertyValue(name).trim() || fallback;

  const rgb = isLight ? "0,0,0" : "255,255,255";
  return {
    isLight,
    bg: read("--surface", isLight ? "#f6f6f7" : "#0a0a0c"),
    fg: read("--fg", isLight ? "#000000" : "#ffffff"),
    ink: (alpha: number) => `rgba(${rgb},${alpha})`,
    accent: read("--accent", isLight ? "#0e8fa8" : "#40cbe0"),
  };
}

export function palette(): Palette {
  if (!cached) cached = build();
  return cached;
}

/**
 * Hue by pitch class, so the staff reads as a spectrum: every semitone is a
 * step around the wheel and an octave is a full turn.
 */
export function pitchColor(midi: number, alpha = 1): string {
  const { isLight } = palette();
  const hue = (((midi % 12) + 12) % 12) * 30;
  const sat = isLight ? 72 : 85;
  const light = isLight ? 42 : 62;
  return `hsla(${hue}, ${sat}%, ${light}%, ${alpha})`;
}

/** Re-read on the next frame after the theme flips. */
function invalidate() {
  cached = null;
}

if (typeof window !== "undefined") {
  new MutationObserver(invalidate).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", invalidate);
}
