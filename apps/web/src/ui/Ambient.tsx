import { useLocation } from "react-router-dom";
import "./ui.css";

/**
 * The only background decoration: two static radial glows on the flat --bg,
 * a faint blue one top-right and a dim red one low. Plain gradients, painted
 * once: no animation, no blur filter, no backdrop-filter. Decorative only.
 * Mounted once, app-wide, by RouteAmbient in App.tsx; screens do not mount their own.
 */
export function Ambient({ variant = "home" }: { variant?: "home" | "game" }) {
  return <div className={`ambient ambient-${variant}`} aria-hidden="true" />;
}

/** App-wide mount: the singing screens get the "game" layout, everything else "home". */
export function RouteAmbient() {
  const { pathname } = useLocation();
  const game = pathname.startsWith("/room/") || pathname === "/training";
  return <Ambient variant={game ? "game" : "home"} />;
}
