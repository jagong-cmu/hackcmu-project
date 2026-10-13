/**
 * Persistence for the voice range profile measured at /check/voice.
 *
 * The profile only steers the live pitch visualizer (see scoring/voiceRange.ts).
 * It never reaches scoring or the server. Every storage access is wrapped:
 * private windows and blocked site data throw, and this must never break play.
 */
import { parseVoiceProfile, type VoiceProfile } from "../scoring/voiceRange.ts";
import { CheckPath } from "./deviceCheck.ts";

const PROFILE_KEY = "karaoke.voiceProfile.v1";
const SKIP_KEY = "karaoke.voiceProfile.skipped";

export const VoiceCheckPath = `${CheckPath}/voice`;

/** In-memory fallbacks, set only when a storage write failed. */
let profileThisTab: VoiceProfile | null = null;
let skippedThisTab = false;

export function loadVoiceProfile(): VoiceProfile | null {
  try {
    const raw = window.localStorage.getItem(PROFILE_KEY);
    if (raw) return parseVoiceProfile(JSON.parse(raw));
  } catch {
    /* blocked storage or bad JSON: fall through */
  }
  return profileThisTab;
}

export function saveVoiceProfile(profile: VoiceProfile): void {
  try {
    window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    window.localStorage.removeItem(SKIP_KEY);
    profileThisTab = null;
  } catch {
    profileThisTab = profile; // storage blocked; cover this tab
  }
}

/** "Skip voice check": don't offer it again automatically. Still re-runnable from links. */
export function skipVoiceCheck(): void {
  try {
    window.localStorage.setItem(SKIP_KEY, "1");
  } catch {
    skippedThisTab = true; // storage blocked; cover this tab
  }
}

export function voiceCheckSkipped(): boolean {
  if (skippedThisTab) return true;
  try {
    return window.localStorage.getItem(SKIP_KEY) === "1";
  } catch {
    return false;
  }
}

/** Offer the voice step after the device check only if it was never done or skipped. */
export function shouldOfferVoiceCheck(): boolean {
  return !loadVoiceProfile() && !voiceCheckSkipped();
}

export function voiceCheckPathFor(next: string): string {
  return `${VoiceCheckPath}?next=${encodeURIComponent(next)}`;
}
