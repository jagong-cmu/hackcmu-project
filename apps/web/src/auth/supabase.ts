/**
 * Supabase Auth client (Google sign-in). Only the public URL + anon /
 * publishable key ever reach the bundle — never the service role key.
 *
 * Unset VITE_SUPABASE_* means "accounts off": the app falls back to the
 * old guest flow so local hacking without a project still works.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const key = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

let client: SupabaseClient | null = null;

export function authConfigured(): boolean {
  return Boolean(url && key);
}

export function getSupabase(): SupabaseClient | null {
  if (!url || !key) return null;
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
