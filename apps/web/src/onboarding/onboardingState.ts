/**
 * Onboarding (mic + camera check, then voice range) runs once per Google
 * account, not once per browser. The record lives on the Supabase account as
 * user_metadata, so it follows the account to every browser and device:
 *
 *   user_metadata.onboarded_at       ISO string; present = onboarding done, never auto-run again
 *   user_metadata.onboarding_device  "done" | "skipped"   (mic + camera step)
 *   user_metadata.onboarding_voice   "done" | "skipped"   (voice step; absent = never reached)
 *   user_metadata.voice_profile      { lowMidi, highMidi, centerMidi, measuredAt (epoch ms) }
 *
 * Top-level keys on purpose: supabase `updateUser({ data })` merges
 * user_metadata one level deep, so each write touches only its own keys and
 * never clobbers display_name or a write from another tab.
 *
 * Skipping counts as done. Device ids (which mic / camera) are per machine and
 * stay in localStorage (deviceCheck.ts).
 *
 * Pure: no storage, no network. accountOnboarding.ts does the I/O.
 */
import { parseVoiceProfile, type VoiceProfile } from "../scoring/voiceRange.ts";
import { checkPathFor, CheckPath } from "./deviceCheck.ts";
import { safeNextPath } from "../lib/safeNext.ts";

export type StepStatus = "done" | "skipped";

export type OnboardingState = {
  onboardedAt: string | null;
  device: StepStatus | null;
  voice: StepStatus | null;
  voiceProfile: VoiceProfile | null;
};

export type OnboardingPatch = Partial<OnboardingState>;

export const EmptyOnboarding: OnboardingState = {
  onboardedAt: null,
  device: null,
  voice: null,
  voiceProfile: null,
};

export const MetaKeys = {
  onboardedAt: "onboarded_at",
  device: "onboarding_device",
  voice: "onboarding_voice",
  voiceProfile: "voice_profile",
} as const satisfies Record<keyof OnboardingState, string>;

function status(v: unknown): StepStatus | null {
  return v === "done" || v === "skipped" ? v : null;
}

function iso(v: unknown): string | null {
  return typeof v === "string" && v && !Number.isNaN(Date.parse(v)) ? v : null;
}

/** Read the onboarding record off a user's user_metadata (anything else is ignored). */
export function fromMetadata(meta: unknown): OnboardingState {
  if (!meta || typeof meta !== "object") return { ...EmptyOnboarding };
  const m = meta as Record<string, unknown>;
  return {
    onboardedAt: iso(m[MetaKeys.onboardedAt]),
    device: status(m[MetaKeys.device]),
    voice: status(m[MetaKeys.voice]),
    voiceProfile: parseVoiceProfile(m[MetaKeys.voiceProfile]),
  };
}

/** The user_metadata keys a patch writes. Undefined fields are left alone. */
export function toMetadata(patch: OnboardingPatch): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of Object.keys(MetaKeys) as Array<keyof OnboardingState>) {
    if (patch[field] !== undefined) out[MetaKeys[field]] = patch[field];
  }
  return out;
}

export function applyPatch(state: OnboardingState, patch: OnboardingPatch | null): OnboardingState {
  if (!patch) return state;
  const next = { ...state };
  for (const field of Object.keys(MetaKeys) as Array<keyof OnboardingState>) {
    if (patch[field] !== undefined) (next as Record<string, unknown>)[field] = patch[field];
  }
  return next;
}

/** Union of two patches; later fields win. */
export function mergePatches(a: OnboardingPatch | null, b: OnboardingPatch): OnboardingPatch {
  return { ...(a ?? {}), ...b };
}

/** Has this account never been through onboarding (nor skipped it)? */
export function needsOnboarding(state: OnboardingState): boolean {
  return state.onboardedAt == null;
}

/** Device step finished (passed or skipped). Marks the account onboarded; re-runs keep the first date. */
export function deviceStepPatch(
  current: OnboardingState,
  result: StepStatus,
  now: Date = new Date(),
): OnboardingPatch {
  // A re-run never downgrades a passed check to skipped.
  const device = current.device === "done" && result === "skipped" ? "done" : result;
  return { onboardedAt: current.onboardedAt ?? now.toISOString(), device };
}

/** Voice range measured (first time or re-run): store it on the account. */
export function voiceSavedPatch(profile: VoiceProfile): OnboardingPatch {
  return { voice: "done", voiceProfile: profile };
}

/** Voice step skipped. A re-run that is abandoned keeps the saved profile. */
export function voiceSkippedPatch(current: OnboardingState): OnboardingPatch {
  return current.voice ? {} : { voice: "skipped" };
}

/** Step two of first-run onboarding: offer it only if never measured or skipped. */
export function shouldOfferVoice(state: OnboardingState): boolean {
  return !state.voiceProfile && state.voice == null;
}

/**
 * Where to send someone the moment sign-in completes: into onboarding (and on
 * to `next` afterwards) if this account has never done it, else straight to
 * `next`. `next` must already be a safe same-site path.
 */
export function postSignInPath(state: OnboardingState, rawNext: string): string {
  // Defence in depth: callers already pass a vetted path, but re-check here.
  const next = safeNextPath(rawNext, "/");
  if (!needsOnboarding(state)) return next;
  // Already headed into the checks (e.g. a Settings re-run link): go there.
  if (next === CheckPath || next.startsWith(`${CheckPath}?`) || next.startsWith(`${CheckPath}/`)) {
    return next;
  }
  return checkPathFor(next);
}
