import posthog from "posthog-js";
import { getClientId, getDisplayName } from "../home/identity.ts";

const KEY = import.meta.env.VITE_PUBLIC_POSTHOG_KEY?.trim() ?? "";
const HOST = import.meta.env.VITE_PUBLIC_POSTHOG_HOST?.trim() || "https://us.i.posthog.com";

let booted = false;

export function analyticsEnabled(): boolean {
  return Boolean(KEY);
}

/** Init once at boot. Returns the client, or null when the project token is unset. */
export function initPostHog(): typeof posthog | null {
  if (!KEY || typeof window === "undefined") return null;
  if (booted) return posthog;
  posthog.init(KEY, {
    api_host: HOST,
    defaults: "2026-05-30",
    // The stage has webcams. Never record the DOM/session.
    disable_session_recording: true,
    person_profiles: "identified_only",
    persistence: "localStorage+cookie",
  });
  booted = true;
  return posthog;
}

export function capture(event: string, properties?: Record<string, unknown>): void {
  if (!KEY || !booted) return;
  try {
    posthog.capture(event, properties);
  } catch {
    /* analytics must never break the room */
  }
}

export function identifyPlayer(): void {
  if (!KEY || !booted) return;
  try {
    const id = getClientId();
    const name = getDisplayName().trim();
    if (name) posthog.identify(id, { display_name: name });
    else posthog.identify(id);
  } catch {
    /* ignore */
  }
}
