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
  const channels = new Map<string, string>();
  const channel = (name: string) => {
    let v = channels.get(name);
    if (v == null) channels.set(name, (v = read(`--${name}`)));
    return v;
  };
  cached = {
    bg: read("--surface"),
    fg: read("--text"),
    ink: (alpha: number) => `rgb(${line} / ${alpha})`,
    tone: (name: string, alpha: number) => `rgb(${channel(name)} / ${alpha})`,
    accent: read("--red"),
  };
  return cached;
}
