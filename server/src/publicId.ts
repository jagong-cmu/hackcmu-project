/**
 * Public player ids.
 *
 * `clientId` is a credential: in guest mode, whoever sends it in
 * `player:hello` (or a score POST) plays as that person and moves their ELO.
 * So it must never leave the server toward other players. Rooms, scores,
 * rematch offers, and LiveKit identities all use the public id from here.
 *
 * - Auth on: the Supabase user id. Knowing it is useless without the
 *   access token, so it is fine to share.
 * - Guest mode: an HMAC of the clientId under a server secret. One-way and
 *   stable across restarts and Vercel isolates (same env everywhere), so a
 *   Mongo room snapshot written by one isolate matches the next.
 */
import { createHash, createHmac } from "node:crypto";

import { authRequired } from "./auth.ts";

let cachedSecret: string | null = null;

function secret(): string {
  if (cachedSecret) return cachedSecret;
  const explicit = process.env.PLAYER_ID_SECRET?.trim();
  if (explicit) {
    cachedSecret = explicit;
    return cachedSecret;
  }
  // No dedicated secret: derive one from server-only secrets that every
  // isolate already shares. Falls back to a fixed salt in bare local dev,
  // which is still one-way because clientIds are random UUIDs.
  const material = [
    process.env.LIVEKIT_API_SECRET,
    process.env.MONGODB_URI,
  ]
    .map((v) => v?.trim() ?? "")
    .join("|");
  cachedSecret = createHash("sha256")
    .update(`karaoke-arena/public-id|${material}`)
    .digest("hex");
  return cachedSecret;
}

/** Guest-mode public id for a clientId. Exported for tests. */
export function hashedPlayerId(clientId: string, key = secret()): string {
  const mac = createHmac("sha256", key).update(clientId).digest("base64url");
  return `p_${mac.slice(0, 22)}`;
}

/** The id other players see for this (server-verified) clientId. */
export function publicPlayerId(clientId: string): string {
  return authRequired() ? clientId : hashedPlayerId(clientId);
}
