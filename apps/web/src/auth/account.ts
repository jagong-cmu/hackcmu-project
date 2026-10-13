/**
 * Point the local player identity (the `karaoke.clientId` every socket hello
 * and score post uses) at the signed-in Supabase user. Accounts start with a
 * fresh rating: guest ratings are not carried over (guest ids were once
 * visible to opponents, so owning one proves nothing).
 */
import type { User } from "@supabase/supabase-js";
import { getDisplayName, validName } from "../home/identity.ts";
import { safeAuthNext } from "../lib/safeNext.ts";

const ID = "karaoke.clientId";
/** The pre-account id (PR #5 guest uuid, or a PR #3 email account id). */
const GUEST = "karaoke.guestClientId";
/** The Supabase user this browser is currently bound to (Google era). */
const ACCOUNT = "karaoke.accountId";
/** Left over from guest-rating linking; cleared on bind. */
const PENDING_LINK = "karaoke.pendingLink";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage blocked */
  }
}

/**
 * Make `userId` the player id. If this browser was playing under some other
 * id that was not a previous Google-era account, remember it so signing out
 * returns to it.
 */
export function bindAccount(userId: string): void {
  const current = read(ID);
  const previousAccount = read(ACCOUNT);
  if (current && current !== userId && current !== previousAccount) {
    write(GUEST, current);
  }
  write(PENDING_LINK, null);
  write(ACCOUNT, userId);
  write(ID, userId);
}

/** Back to the guest id this browser had before signing in. */
export function unbindAccount(): void {
  write(ACCOUNT, null);
  const guest = read(GUEST);
  if (guest) write(ID, guest);
  else write(ID, crypto.randomUUID());
}

function fit(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const n = name.trim().replace(/\s+/g, " ");
  if (validName(n)) return n;
  // Long Google names: try just the first name.
  const first = n.split(" ")[0] ?? "";
  if (validName(first)) return first;
  if (n.length > 16 && validName(n.slice(0, 16))) return n.slice(0, 16).trim();
  return null;
}

/**
 * Display name for a signed-in user: a name they chose in Settings (saved to
 * user_metadata.display_name) wins, then their Google profile name, then the
 * name this browser already used, then their email's local part.
 */
export function nameFromUser(user: User): string {
  const meta = user.user_metadata ?? {};
  return (
    fit(meta.display_name) ??
    fit(meta.full_name) ??
    fit(meta.name) ??
    fit(getDisplayName()) ??
    fit(user.email?.split("@")[0]) ??
    "Singer"
  );
}

/** Only same-site paths are allowed as a post-sign-in destination. */
export const safeNext = safeAuthNext;
