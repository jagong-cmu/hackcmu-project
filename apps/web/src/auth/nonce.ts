/**
 * Nonce for Google Identity Services + supabase.auth.signInWithIdToken.
 *
 * Google puts whatever we pass as `nonce` into the ID token's `nonce` claim.
 * Supabase hashes the nonce we hand signInWithIdToken with SHA-256 and checks
 * it against that claim. So: Google gets sha256hex(raw), Supabase gets raw.
 * A replayed ID token then fails, because only this tab knows `raw`.
 *
 * Pure Web Crypto, so it runs in the browser and under `node --test`.
 */

/** Random nonce: `bytes` random bytes as lower-case hex. */
export function randomNonce(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return toHex(buf);
}

/** Lower-case hex SHA-256 of a UTF-8 string. */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return toHex(new Uint8Array(digest));
}

export type NoncePair = {
  /** Kept in this tab; passed to supabase.auth.signInWithIdToken. */
  raw: string;
  /** sha256Hex(raw); passed to google.accounts.id.initialize({ nonce }). */
  hashed: string;
};

export async function createNoncePair(): Promise<NoncePair> {
  const raw = randomNonce();
  return { raw, hashed: await sha256Hex(raw) };
}

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}
