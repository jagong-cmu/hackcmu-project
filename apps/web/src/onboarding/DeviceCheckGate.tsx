import type { ReactNode } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { checkPathFor, deviceCheckCleared } from "./deviceCheck.ts";
import { voiceCheckPathFor } from "./voiceProfile.ts";

/**
 * Route wrapper: a singer who has never run the mic + camera check is sent
 * there first, then returned to exactly where they were headed.
 */
export function DeviceCheckGate({ children }: { children: ReactNode }) {
  const loc = useLocation();
  if (deviceCheckCleared()) return <>{children}</>;
  return <Navigate to={checkPathFor(loc.pathname + loc.search)} replace />;
}

/** Small "re-run the checks" links (mic + camera, voice range) for Settings and the mode picker. */
export function DeviceCheckLink({ next, className }: { next?: string; className?: string }) {
  const loc = useLocation();
  const back = next ?? loc.pathname + loc.search;
  return (
    <p className={className ?? "device-check-link"}>
      <Link to={checkPathFor(back)}>Check mic &amp; camera</Link>
      <Link to={voiceCheckPathFor(back)}>Voice range</Link>
    </p>
  );
}
