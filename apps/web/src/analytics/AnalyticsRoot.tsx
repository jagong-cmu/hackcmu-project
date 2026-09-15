import { useEffect } from "react";
import { identifyPlayer } from "./posthog.ts";

/** Identifies the local singer once PostHog is up. Lives inside the router. */
export function AnalyticsRoot() {
  useEffect(() => {
    identifyPlayer();
  }, []);
  return null;
}
