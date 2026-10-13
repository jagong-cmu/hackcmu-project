/**
 * Supabase Auth client (Google sign-in). Only the public URL + anon /
 * publishable key ever reach the bundle — never the service role key.
 *
 * Accounts are required to play. Without VITE_SUPABASE_* the app does not
 * fall back to guests: play routes say accounts aren't configured. The only
 * way around that is the local-dev opt-out (VITE_AUTH_REQUIRED=0 under
 * `vite dev`), see authMode.ts.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { resolveClientAuthMode, type ClientAuthMode } from "./authMode.ts";

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const key = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

export const authMode: ClientAuthMode = resolveClientAuthMode({
  dev: import.meta.env.DEV,
  url,
  key,
  optOut: import.meta.env.VITE_AUTH_REQUIRED,
});

let client: SupabaseClient | null = null;

/** True when Google accounts are on (always, outside the dev opt-out, once configured). */
export function authConfigured(): boolean {
  return authMode === "accounts";
}

export function getSupabase(): SupabaseClient | null {
  if (authMode !== "accounts" || !url || !key) return null;
  if (!client) {
    client = createClient(url, key, {
      auth: {
        flowType: "pkce",
        persistSession: true,
        autoRefreshToken: true,
        // Exchanges the `?code=` Google sends back to /signin on page load.
        detectSessionInUrl: true,
      },
    });
  }
  return client;
}

/** Current access token (refreshed if stale), or null when signed out. */
export async function getAccessToken(): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;
  try {
    // Never let a slow token refresh stall the socket handshake forever.
    const timeout = new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 5000));
    const session = sb.auth.getSession().then(({ data }) => data.session?.access_token ?? null);
    return await Promise.race([session, timeout]);
  } catch {
    return null;
  }
}

/** `Authorization` header for our own API, so the server can verify who we are. */
export async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** `sub` claim of a JWT, read without verifying (the server verifies). */
export function jwtSubject(token: string): string | null {
  try {
    const part = token.split(".")[1] ?? "";
    const json = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/"))) as { sub?: unknown };
    return typeof json.sub === "string" ? json.sub : null;
  } catch {
    return null;
  }
}
