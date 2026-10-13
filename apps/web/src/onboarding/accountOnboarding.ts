/**
 * Local mirror of an account's onboarding record (onboardingState.ts), keyed
 * by Supabase user id so two accounts on one browser never share it.
 *
 * The account metadata is the source of truth. The mirror is only:
 * - a fast / offline copy of the last account value we saw, and
 * - a queue of writes (`pending`) that have not reached Supabase yet, so a
 *   failed metadata write neither loses the result nor sends the player back
 *   through onboarding. AuthProvider retries `pending` until it lands.
 *
 * Storage can throw (private windows, blocked site data); an in-memory copy
 * covers this tab.
 */
import {
  EmptyOnboarding,
  applyPatch,
  fromMetadata,
  mergePatches,
  type OnboardingPatch,
  type OnboardingState,
} from "./onboardingState.ts";

export type OnboardingMirror = { state: OnboardingState; pending: OnboardingPatch | null };

const PREFIX = "karaoke.onboarding.v1.";
const memory = new Map<string, OnboardingMirror>();

function key(uid: string): string {
  return `${PREFIX}${uid}`;
}

export function readMirror(uid: string): OnboardingMirror {
  try {
    const raw = window.localStorage.getItem(key(uid));
    if (raw) {
      const parsed = JSON.parse(raw) as { state?: unknown; pending?: unknown };
      // Re-validate through the metadata reader: storage is not trusted.
      const state = fromMetadata(toMetaShape(parsed.state));
      const pending =
        parsed.pending && typeof parsed.pending === "object"
          ? (parsed.pending as OnboardingPatch)
          : null;
      return { state, pending };
    }
  } catch {
    /* blocked storage or bad JSON */
  }
  return memory.get(uid) ?? { state: { ...EmptyOnboarding }, pending: null };
}

export function writeMirror(uid: string, mirror: OnboardingMirror): void {
  memory.set(uid, mirror);
  try {
    window.localStorage.setItem(key(uid), JSON.stringify(mirror));
  } catch {
    /* storage blocked; the in-memory copy covers this tab */
  }
}

/** Record a result locally (synchronously) and queue it for the account. */
export function queuePatch(uid: string, patch: OnboardingPatch): OnboardingMirror {
  const cur = readMirror(uid);
  const next = { state: applyPatch(cur.state, patch), pending: mergePatches(cur.pending, patch) };
  writeMirror(uid, next);
  return next;
}

/** The account answered: refresh the mirror, dropping the pending writes it now holds. */
export function syncFromAccount(uid: string, account: OnboardingState, sent?: OnboardingPatch): void {
  const cur = readMirror(uid);
  let pending = cur.pending;
  if (sent && pending && JSON.stringify(pending) === JSON.stringify(sent)) pending = null;
  writeMirror(uid, { state: applyPatch(keepOnboarded(account, cur.state), pending), pending });
}

/** Account value + anything still queued locally: what the UI should believe. */
export function effectiveOnboarding(account: OnboardingState | null, mirror: OnboardingMirror): OnboardingState {
  const base = account ? keepOnboarded(account, mirror.state) : mirror.state;
  return applyPatch(base, mirror.pending);
}

/**
 * A stale account copy (an old stored session) must never undo onboarding
 * this browser already saw land on the account.
 */
function keepOnboarded(account: OnboardingState, local: OnboardingState): OnboardingState {
  if (account.onboardedAt != null || local.onboardedAt == null) return account;
  return { ...account, onboardedAt: local.onboardedAt, device: account.device ?? local.device };
}

function toMetaShape(state: unknown): Record<string, unknown> {
  const s = (state && typeof state === "object" ? state : {}) as Record<string, unknown>;
  return {
    onboarded_at: s.onboardedAt,
    onboarding_device: s.device,
    onboarding_voice: s.voice,
    voice_profile: s.voiceProfile,
  };
}
