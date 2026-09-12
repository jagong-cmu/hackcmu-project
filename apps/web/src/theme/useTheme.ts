import { useCallback, useEffect, useState } from "react";

export type Theme = "dark" | "light";

const KEY = "aria.theme";

function systemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/** What the document is actually showing right now. */
export function currentTheme(): Theme {
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "dark" || attr === "light") return attr;
  return systemTheme();
}

/**
 * Theme state, persisted per browser.
 *
 * index.html stamps `data-theme` before first paint, so this hook only has to
 * keep up with it — there is no flash to guard against here.
 */
export function useTheme(): { theme: Theme; setTheme: (next: Theme) => void; toggle: () => void } {
  const [theme, setThemeState] = useState<Theme>(() =>
    typeof document === "undefined" ? "dark" : currentTheme(),
  );

  const setTheme = useCallback((next: Theme) => {
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Private window or blocked storage: the choice just won't outlive the tab.
    }
    setThemeState(next);
  }, []);

  const toggle = useCallback(() => {
    setTheme(currentTheme() === "dark" ? "light" : "dark");
  }, [setTheme]);

  // Follow the OS until the user picks a side.
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(KEY);
    } catch {
      stored = null;
    }
    if (stored === "dark" || stored === "light") return;

    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const sync = () => setThemeState(systemTheme());
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  return { theme, setTheme, toggle };
}
