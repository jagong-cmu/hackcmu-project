import { getSupabase } from "./supabase.ts";

const NAME = "karaoke.displayName";
const ID = "karaoke.clientId";
const COLOR = "karaoke.avatarColor";
const GUEST = "karaoke.guestClientId";
const AUTH = "karaoke.authUserId";

const COLORS = ["#e8c36a", "#c4312e", "#7eb8c9", "#d9783a", "#b86b9a", "#6dbf8b"];

export function getClientId(): string {
  let id = localStorage.getItem(ID);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(ID, id);
  }
  return id;
}

export function getDisplayName(): string {
  return localStorage.getItem(NAME) ?? "";
}

export function setDisplayName(name: string): string {
  const trimmed = name.trim().slice(0, 16);
  localStorage.setItem(NAME, trimmed);
  getClientId();
  if (!localStorage.getItem(COLOR)) {
    localStorage.setItem(COLOR, COLORS[Math.floor(Math.random() * COLORS.length)]);
  }
  return trimmed;
}

export function getAvatarColor(): string {
  return localStorage.getItem(COLOR) || COLORS[0];
}

export function validName(name: string): boolean {
  const n = name.trim().length;
  return n >= 2 && n <= 16;
}

/** Point ELO / sockets at the signed-in Supabase user, keeping the guest id. */
export function bindAccount(userId: string, displayName: string): string {
  const current = localStorage.getItem(ID);
  const authId = localStorage.getItem(AUTH);
  if (current && current !== userId && authId !== current) {
    localStorage.setItem(GUEST, current);
  }
  localStorage.setItem(AUTH, userId);
  localStorage.setItem(ID, userId);
  if (validName(displayName)) return setDisplayName(displayName);
  const existing = getDisplayName();
  if (validName(existing)) return existing;
  return setDisplayName("Singer");
}

export function unbindAccount(): void {
  localStorage.removeItem(AUTH);
  const guest = localStorage.getItem(GUEST);
  if (guest) localStorage.setItem(ID, guest);
  else {
    localStorage.removeItem(ID);
    getClientId();
  }
}

/** Persist the name locally and tell Atlas. Socket hello is the caller's job. */
export async function commitDisplayName(name: string): Promise<string> {
  const saved = setDisplayName(name);
  const sb = getSupabase();
  if (sb && localStorage.getItem(AUTH)) {
    try {
      await sb.auth.updateUser({ data: { display_name: saved } });
    } catch {
      /* still continue */
    }
  }
  try {
    await fetch("/api/player/hello", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: getClientId(), displayName: saved }),
    });
  } catch {
    /* still continue */
  }
  return saved;
}
