import type { ReactNode } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider.tsx";
import { checkPathFor } from "./deviceCheck.ts";
import { voiceCheckPathFor } from "./voiceProfile.ts";

/**
 * Route wrapper (safety net behind the post-sign-in redirect): an account that
 * has never been through onboarding is sent to the mic + camera check first,
 * then returned to exactly where it was headed. Keyed to the account record,
 * so it never re-runs on a new browser for an account that already did it.
 */
export function DeviceCheckGate({ children }: { children: ReactNode }) {
  const loc = useLocation();
  const { needsOnboarding, accountFresh } = useAuth();
  if (!needsOnboarding) return <>{children}</>;
  if (!accountFresh) {
    return (
      <main className="page bloom-page shell">
        <p className="dim auth-wait">Checking your account…</p>
      </main>
    );
  }
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
